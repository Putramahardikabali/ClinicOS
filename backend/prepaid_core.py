"""Patient prepaid issuance, redemption, refund, and liability aggregates."""
from __future__ import annotations

import random
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from permissions import user_has_permission
from prepaid_models import (
    PREPAID_CODE_ALPHABET,
    PREPAID_TYPES,
    PatientPrepaid,
    PrepaidRedemption,
    REDEEMABLE_PREPAID_STATUSES,
    effective_prepaid_status,
    normalize_prepaid_code,
    prepaid_to_api,
)


def _now_iso() -> str:
    from prepaid_models import _now_iso as now
    return now()


def _segment(n: int = 4) -> str:
    return "".join(random.choice(PREPAID_CODE_ALPHABET) for _ in range(n))


async def allocate_prepaid_code(db, clinic_id: str, max_attempts: int = 20) -> str:
    for _ in range(max_attempts):
        code = f"PP-{_segment()}-{_segment()}"
        exists = await db.patient_prepaid.find_one({"clinic_id": clinic_id, "code": code}, {"_id": 1})
        if not exists:
            return code
    raise HTTPException(status_code=500, detail="Could not allocate prepaid code")


async def find_prepaid(db, clinic_id: str, prepaid_id: str) -> Optional[dict]:
    raw = await db.patient_prepaid.find_one({"clinic_id": clinic_id, "id": prepaid_id}, {"_id": 0})
    return prepaid_to_api(raw) if raw else None


async def find_prepaid_by_code(db, clinic_id: str, code: str) -> Optional[dict]:
    norm = normalize_prepaid_code(code)
    if not norm:
        return None
    raw = await db.patient_prepaid.find_one({"clinic_id": clinic_id, "code": norm}, {"_id": 0})
    return prepaid_to_api(raw) if raw else None


def _assert_can_sell(user: dict) -> None:
    if not user_has_permission(user, "prepaid.sell"):
        raise HTTPException(status_code=403, detail="prepaid.sell permission required")


def _assert_can_redeem(user: dict) -> None:
    if not user_has_permission(user, "prepaid.redeem"):
        raise HTTPException(status_code=403, detail="prepaid.redeem permission required")


def _assert_can_refund(user: dict) -> None:
    if not user_has_permission(user, "prepaid.refund"):
        raise HTTPException(status_code=403, detail="prepaid.refund permission required")


def _assert_can_void(user: dict) -> None:
    if not user_has_permission(user, "prepaid.void"):
        raise HTTPException(status_code=403, detail="prepaid.void permission required")


def _assert_redeemable(doc: dict, *, allow_expired_override: bool = False) -> None:
    status = effective_prepaid_status(doc)
    if status == "voided":
        raise HTTPException(status_code=400, detail="Prepaid is voided")
    if status == "refunded":
        raise HTTPException(status_code=400, detail="Prepaid is refunded")
    if status == "used":
        raise HTTPException(status_code=400, detail="Prepaid is fully used")
    if status == "expired" and not allow_expired_override:
        raise HTTPException(status_code=400, detail="Prepaid has expired")
    if status not in REDEEMABLE_PREPAID_STATUSES and status != "expired":
        raise HTTPException(status_code=400, detail="Prepaid cannot be redeemed")
    bal = int(doc.get("remaining_balance_idr") or 0)
    if bal <= 0:
        raise HTTPException(status_code=400, detail="Prepaid has no remaining balance")


async def issue_prepaid_from_pos_item(
    db,
    sale: dict,
    item: dict,
    *,
    user: dict,
) -> Tuple[str, str]:
    """Issue prepaid record when POS prepaid line is fulfilled. Returns (id, code)."""
    _assert_can_sell(user)
    if item.get("prepaid_id"):
        existing = await find_prepaid(db, sale["clinic_id"], item["prepaid_id"])
        if existing:
            return item["prepaid_id"], existing.get("code") or ""
    patient_id = sale.get("patient_id")
    if not patient_id:
        raise HTTPException(status_code=400, detail="Patient is required for prepaid purchase")
    meta = item.get("metadata") or {}
    ptype = (meta.get("prepaid_type") or "credit").strip().lower()
    if ptype not in PREPAID_TYPES:
        ptype = "credit"
    amount = int(meta.get("amount_idr") or item.get("unit_price") or item.get("total") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Prepaid amount must be greater than zero")
    now = _now_iso()
    code = await allocate_prepaid_code(db, sale["clinic_id"])
    campaign_id = (meta.get("campaign_id") or "").strip() or None
    campaign_name = (meta.get("campaign_name_snapshot") or meta.get("campaign_name") or "").strip() or None
    doc = PatientPrepaid(
        id=str(uuid.uuid4()),
        clinic_id=sale["clinic_id"],
        patient_id=patient_id,
        code=code,
        prepaid_type=ptype,
        status="active",
        original_amount_idr=amount,
        remaining_balance_idr=amount,
        treatment_catalog_id=meta.get("treatment_catalog_id") or None,
        treatment_name_snapshot=meta.get("treatment_name_snapshot") or item.get("name_snapshot") or None,
        quantity=int(meta.get("quantity") or 1),
        remaining_quantity=int(meta.get("quantity") or 1),
        prepaid_price_snapshot=amount if ptype == "treatment" else None,
        promo_price_snapshot=amount,
        campaign_id=campaign_id,
        campaign_name_snapshot=campaign_name,
        expiry_date=(meta.get("expiry_date") or "").strip() or None,
        notes=(meta.get("notes") or "").strip() or None,
        pos_sale_id=sale.get("id"),
        pos_sale_item_id=item.get("id"),
        purchased_at=sale.get("paid_at") or now,
        created_by=user.get("id"),
        created_by_name_snapshot=user.get("name") or "",
        created_at=now,
        updated_at=now,
    )
    await db.patient_prepaid.insert_one(doc.to_mongo())
    return doc.id, code


async def list_patient_prepaid(db, clinic_id: str, patient_id: str) -> List[dict]:
    rows = await db.patient_prepaid.find(
        {"clinic_id": clinic_id, "patient_id": patient_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return [prepaid_to_api(r) for r in rows]


async def list_redeemable_for_patient(db, clinic_id: str, patient_id: str) -> List[dict]:
    rows = await list_patient_prepaid(db, clinic_id, patient_id)
    out = []
    for r in rows:
        st = effective_prepaid_status(r)
        if st in REDEEMABLE_PREPAID_STATUSES and int(r.get("remaining_balance_idr") or 0) > 0:
            out.append(r)
    return out


def make_prepaid_payment_record(
    amount_idr: int,
    user: dict,
    *,
    prepaid_id: str,
    prepaid_code: str,
    redemption_id: str,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "method": "prepaid",
        "amount_idr": int(amount_idr or 0),
        "prepaid_id": prepaid_id,
        "prepaid_code": prepaid_code,
        "prepaid_redemption_id": redemption_id,
        "created_at": _now_iso(),
        "created_by": user.get("id"),
        "created_by_name_snapshot": user.get("name") or "",
        "voided": False,
    }


async def redeem_prepaid_value(
    db,
    user: dict,
    *,
    prepaid_id: str,
    amount_idr: int,
    reference_type: str,
    reference_id: str,
    patient_id: Optional[str] = None,
    allow_expired_override: bool = False,
    notes: str = "",
) -> dict:
    _assert_can_redeem(user)
    doc = await find_prepaid(db, user["clinic_id"], prepaid_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Prepaid not found")
    if patient_id and doc.get("patient_id") != patient_id:
        raise HTTPException(status_code=400, detail="Prepaid does not belong to this patient")
    if allow_expired_override and not user_has_permission(user, "prepaid.redeem"):
        raise HTTPException(status_code=403, detail="Cannot override expired prepaid")
    _assert_redeemable(doc, allow_expired_override=allow_expired_override)
    amt = int(amount_idr or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Redemption amount must be greater than zero")
    bal_before = int(doc.get("remaining_balance_idr") or 0)
    if amt > bal_before:
        raise HTTPException(status_code=400, detail="Cannot redeem more than remaining prepaid balance")
    bal_after = bal_before - amt
    now = _now_iso()
    red = PrepaidRedemption(
        id=str(uuid.uuid4()),
        clinic_id=user["clinic_id"],
        prepaid_id=doc["id"],
        prepaid_code=doc.get("code") or "",
        patient_id=doc.get("patient_id") or "",
        reference_type=reference_type,
        reference_id=reference_id,
        amount_redeemed_idr=amt,
        balance_before_idr=bal_before,
        balance_after_idr=bal_after,
        recognized_revenue_idr=amt,
        notes=notes or None,
        created_by=user.get("id"),
        created_by_name_snapshot=user.get("name") or "",
        created_at=now,
    )
    new_status = "used" if bal_after <= 0 else "partially_used"
    await db.prepaid_redemptions.insert_one(red.to_mongo())
    await db.patient_prepaid.update_one(
        {"id": doc["id"]},
        {"$set": {
            "remaining_balance_idr": bal_after,
            "status": new_status,
            "redeemed_invoice_id": reference_id if reference_type == "invoice" else doc.get("redeemed_invoice_id"),
            "redeemed_at": now if bal_after <= 0 else doc.get("redeemed_at"),
            "updated_at": now,
        }},
    )
    return red.to_mongo()


async def apply_prepaid_payment(
    db,
    user: dict,
    *,
    total_idr: int,
    prepaid_id: str,
    prepaid_amount_idr: int,
    cash_amount_paid: Optional[int],
    reference_type: str,
    reference_id: str,
    patient_id: Optional[str] = None,
    payment_method: str = "cash",
) -> Tuple[int, int, List[dict], str, List[dict]]:
    """Apply prepaid + optional cash. Returns cash, prepaid_paid, reds, method, payments."""
    due = max(0, int(total_idr or 0))
    prepaid_req = int(prepaid_amount_idr or 0)
    if prepaid_req <= 0:
        prepaid_req = due
    prepaid_apply = min(due, prepaid_req)
    red_doc = None
    reds: List[dict] = []
    payments: List[dict] = []
    prepaid_paid = 0
    if prepaid_apply > 0:
        red_doc = await redeem_prepaid_value(
            db,
            user,
            prepaid_id=prepaid_id,
            amount_idr=prepaid_apply,
            reference_type=reference_type,
            reference_id=reference_id,
            patient_id=patient_id,
        )
        prepaid_paid = int(red_doc.get("amount_redeemed_idr") or 0)
        reds.append(red_doc)
        payments.append(
            make_prepaid_payment_record(
                prepaid_paid,
                user,
                prepaid_id=prepaid_id,
                prepaid_code=red_doc.get("prepaid_code") or "",
                redemption_id=red_doc.get("id") or "",
            )
        )
    remaining_after_prepaid = max(0, due - prepaid_paid)
    cash = int(cash_amount_paid or 0) if cash_amount_paid is not None else remaining_after_prepaid
    cash = min(cash, remaining_after_prepaid)
    if cash > 0:
        from gift_cards_core import make_payment_record
        pm = payment_method if payment_method not in ("prepaid", "mixed") else "cash"
        payments.append(make_payment_record(pm, cash, user))
    method = "prepaid" if prepaid_paid > 0 and cash <= 0 else ("mixed" if prepaid_paid > 0 and cash > 0 else payment_method)
    return cash, prepaid_paid, reds, method, payments


async def refund_prepaid(
    db,
    user: dict,
    prepaid_id: str,
    *,
    amount_idr: Optional[int] = None,
    reason: str = "",
) -> dict:
    _assert_can_refund(user)
    doc = await find_prepaid(db, user["clinic_id"], prepaid_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Prepaid not found")
    st = effective_prepaid_status(doc)
    if st in ("voided", "refunded"):
        raise HTTPException(status_code=400, detail=f"Prepaid is already {st}")
    remaining = int(doc.get("remaining_balance_idr") or 0)
    refund_amt = int(amount_idr or remaining)
    if refund_amt <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be greater than zero")
    if refund_amt > remaining:
        raise HTTPException(status_code=400, detail="Cannot refund more than remaining balance")
    now = _now_iso()
    new_bal = remaining - refund_amt
    new_status = "refunded" if new_bal <= 0 else "partially_used"
    await db.patient_prepaid.update_one(
        {"id": prepaid_id},
        {"$set": {
            "remaining_balance_idr": new_bal,
            "status": new_status,
            "refund_amount_idr": int(doc.get("refund_amount_idr") or 0) + refund_amt,
            "refunded_at": now,
            "updated_at": now,
        }},
    )
    return await find_prepaid(db, user["clinic_id"], prepaid_id)


async def void_prepaid(db, user: dict, prepaid_id: str, *, reason: str = "") -> dict:
    _assert_can_void(user)
    doc = await find_prepaid(db, user["clinic_id"], prepaid_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Prepaid not found")
    used = int(doc.get("original_amount_idr") or 0) - int(doc.get("remaining_balance_idr") or 0)
    if used > 0:
        raise HTTPException(status_code=400, detail="Cannot void prepaid that has already been used")
    now = _now_iso()
    await db.patient_prepaid.update_one(
        {"id": prepaid_id},
        {"$set": {
            "status": "voided",
            "remaining_balance_idr": 0,
            "voided_at": now,
            "void_reason": reason.strip() or None,
            "updated_at": now,
        }},
    )
    return await find_prepaid(db, user["clinic_id"], prepaid_id)


async def aggregate_outstanding_prepaid_liability(db, clinic_id: str) -> dict:
    pipeline = [
        {"$match": {
            "clinic_id": clinic_id,
            "status": {"$in": list(REDEEMABLE_PREPAID_STATUSES)},
        }},
        {"$group": {"_id": None, "total": {"$sum": "$remaining_balance_idr"}, "count": {"$sum": 1}}},
    ]
    cur = await db.patient_prepaid.aggregate(pipeline).to_list(1)
    row = cur[0] if cur else {}
    return {
        "outstanding_balance_idr": int(row.get("total") or 0),
        "active_count": int(row.get("count") or 0),
    }


async def aggregate_prepaid_for_date(db, clinic_id: str, date_str: str) -> dict:
    prefix = f"{date_str}"
    sold = 0
    sold_count = 0
    async for doc in db.patient_prepaid.find(
        {"clinic_id": clinic_id, "purchased_at": {"$gte": f"{prefix}T00:00:00", "$lte": f"{prefix}T23:59:59"}},
        {"_id": 0, "original_amount_idr": 1, "status": 1},
    ):
        if doc.get("status") == "voided":
            continue
        sold += int(doc.get("original_amount_idr") or 0)
        sold_count += 1
    redeemed = 0
    redeemed_count = 0
    async for doc in db.prepaid_redemptions.find(
        {
            "clinic_id": clinic_id,
            "created_at": {"$gte": f"{prefix}T00:00:00", "$lte": f"{prefix}T23:59:59"},
            "reversed": {"$ne": True},
        },
        {"_id": 0, "amount_redeemed_idr": 1},
    ):
        redeemed += int(doc.get("amount_redeemed_idr") or 0)
        redeemed_count += 1
    outstanding = await aggregate_outstanding_prepaid_liability(db, clinic_id)
    return {
        "prepaid_sold_idr": sold,
        "prepaid_sold_count": sold_count,
        "prepaid_redeemed_idr": redeemed,
        "prepaid_redeemed_count": redeemed_count,
        "prepaid_liability_added_idr": sold,
        "prepaid_liability_used_idr": redeemed,
        "outstanding_prepaid_liability_idr": outstanding.get("outstanding_balance_idr") or 0,
    }
