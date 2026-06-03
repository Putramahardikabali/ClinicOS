"""Gift card issuance, balance, and redemption (value/credit core)."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from gift_card_codes import allocate_gift_card_code, validate_gift_card_code_format
from gift_card_models import (
    REDEEM_REFERENCE_TYPES,
    REDEEMABLE_STATUSES,
    GIFT_CARD_TYPES,
    GiftCard,
    GiftCardRedemption,
    effective_gift_card_status,
    gift_card_list_row,
    gift_card_to_api,
    is_entitlement_gift_card,
    is_gift_card_expired,
    normalize_gift_card_code,
    normalize_gift_card_document,
    normalize_redemption_document,
    redemption_to_api,
    status_after_entitlement_redemption,
    status_after_redemption,
)
from gift_card_redemption import find_entitlement_match_line, line_payable_amount
from permissions import user_has_permission

def _now_iso() -> str:
    from gift_card_models import _now_iso as now
    return now()


async def _persist_expired_status(db, card: dict) -> dict:
    """Mark card expired in DB when past expiry_date."""
    if not is_gift_card_expired(card):
        return card
    if card.get("status") in ("cancelled", "redeemed"):
        return card
    if card.get("status") == "expired":
        return card
    now = _now_iso()
    await db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {"status": "expired", "updated_at": now}},
    )
    card = dict(card)
    card["status"] = "expired"
    card["updated_at"] = now
    return card


async def find_gift_card_by_code(db, clinic_id: str, code: str) -> Optional[dict]:
    norm = normalize_gift_card_code(code)
    if not norm:
        return None
    try:
        validate_gift_card_code_format(norm)
    except HTTPException:
        return None
    raw = await db.gift_cards.find_one({"clinic_id": clinic_id, "code": norm}, {"_id": 0})
    if not raw:
        return None
    card = normalize_gift_card_document(raw)
    return await _persist_expired_status(db, card)


async def find_gift_card(db, clinic_id: str, gift_card_id: str) -> Optional[dict]:
    raw = await db.gift_cards.find_one({"clinic_id": clinic_id, "id": gift_card_id}, {"_id": 0})
    if not raw:
        return None
    card = normalize_gift_card_document(raw)
    return await _persist_expired_status(db, card)


def _assert_redeemable_value_card(card: dict) -> None:
    stored = (card.get("status") or "").strip().lower()
    if stored == "cancelled":
        raise HTTPException(status_code=400, detail="Gift card is cancelled")
    effective = effective_gift_card_status(card)
    if effective == "cancelled":
        raise HTTPException(status_code=400, detail="Gift card is cancelled")
    if effective == "expired":
        raise HTTPException(status_code=400, detail="Gift card has expired")
    if effective == "redeemed":
        raise HTTPException(status_code=400, detail="Gift card is fully redeemed")
    if effective == "draft":
        raise HTTPException(status_code=400, detail="Gift card is not active")
    if effective not in REDEEMABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Gift card cannot be redeemed")
    if card.get("gift_card_type") != "value_credit":
        raise HTTPException(
            status_code=400,
            detail="Only value/credit gift cards can be redeemed as payment at this time",
        )
    balance = int(card.get("balance_value") or 0)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="Gift card has no remaining balance")


def _assert_redeemable_entitlement_card(card: dict) -> None:
    stored = (card.get("status") or "").strip().lower()
    if stored == "cancelled":
        raise HTTPException(status_code=400, detail="Gift card is cancelled")
    effective = effective_gift_card_status(card)
    if effective == "cancelled":
        raise HTTPException(status_code=400, detail="Gift card is cancelled")
    if effective == "expired":
        raise HTTPException(status_code=400, detail="Gift card has expired")
    if effective == "redeemed":
        raise HTTPException(status_code=400, detail="Gift card is fully redeemed")
    if effective == "draft":
        raise HTTPException(status_code=400, detail="Gift card is not active")
    if not is_entitlement_gift_card(card):
        raise HTTPException(
            status_code=400,
            detail="Only treatment or package gift cards can use entitlement redemption",
        )
    remaining = int(card.get("remaining_redemptions") or 0)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="Gift card has no remaining redemptions")


async def issue_gift_card_from_pos_item(
    db,
    sale: dict,
    item: dict,
    *,
    created_by: str,
    issuer_user: Optional[dict] = None,
) -> Tuple[str, str]:
    """Create active gift card when POS line is fulfilled (paid sale only). Returns (id, code)."""
    if issuer_user and not user_has_permission(issuer_user, "gift_cards.create"):
        raise HTTPException(status_code=403, detail="Insufficient permissions to issue gift cards")
    if item.get("gift_card_id"):
        existing = await find_gift_card(db, sale["clinic_id"], item["gift_card_id"])
        if existing:
            return item["gift_card_id"], existing.get("code") or ""
        return item["gift_card_id"], item.get("gift_card_code") or ""
    clinic_id = sale["clinic_id"]
    meta = item.get("metadata") or {}
    gc_type = (meta.get("gift_card_type") or "value_credit").strip().lower()
    if gc_type not in GIFT_CARD_TYPES:
        gc_type = "value_credit"
    now = _now_iso()
    original = int(meta.get("value_idr") or item.get("unit_price") or 0)
    if original <= 0 and gc_type == "value_credit":
        raise HTTPException(status_code=400, detail="Gift card value must be greater than zero")
    balance = original if gc_type == "value_credit" else 0
    treatment_name = meta.get("treatment_name_snapshot")
    package_name = meta.get("package_name_snapshot")
    if gc_type == "treatment" and meta.get("treatment_catalog_id") and not treatment_name:
        tr = await db.treatments.find_one(
            {"clinic_id": clinic_id, "id": meta["treatment_catalog_id"]},
            {"_id": 0, "name": 1},
        )
        treatment_name = tr.get("name") if tr else None
    if gc_type == "package" and meta.get("package_catalog_id") and not package_name:
        pkg = await db.packages.find_one(
            {"clinic_id": clinic_id, "id": meta["package_catalog_id"]},
            {"_id": 0, "name": 1},
        )
        package_name = pkg.get("name") if pkg else None
    expiry = meta.get("expiry_date") or meta.get("expires_at")
    if expiry and len(str(expiry)) > 10:
        expiry = str(expiry)[:10]

    manual_code = (meta.get("gift_card_code") or meta.get("code") or "").strip() or None
    allow_manual = False
    if issuer_user:
        allow_manual = user_has_permission(issuer_user, "gift_cards.set_code")
    code = await allocate_gift_card_code(
        db,
        clinic_id,
        manual_code=manual_code,
        allow_manual=allow_manual,
    )

    issue_status = "expired" if expiry and is_gift_card_expired({"expiry_date": expiry}) else "active"
    entitlement_remaining = 1 if gc_type in ("treatment", "package") else 0

    card = GiftCard(
        id=str(uuid.uuid4()),
        clinic_id=clinic_id,
        code=code,
        gift_card_type=gc_type,
        status=issue_status,
        purchaser_patient_id=sale.get("patient_id"),
        purchaser_name=(sale.get("customer_name") or "").strip() or None,
        purchaser_phone=(sale.get("customer_phone") or "").strip() or None,
        recipient_name=(meta.get("recipient_name") or "").strip() or None,
        recipient_phone=(meta.get("recipient_phone") or "").strip() or None,
        recipient_email=(meta.get("recipient_email") or "").strip() or None,
        message=(meta.get("message") or "").strip() or None,
        notes=(meta.get("notes") or "").strip() or None,
        original_value=original,
        balance_value=balance,
        redemption_count=0,
        remaining_redemptions=entitlement_remaining,
        treatment_catalog_id=meta.get("treatment_catalog_id"),
        treatment_name_snapshot=treatment_name,
        package_catalog_id=meta.get("package_catalog_id"),
        package_name_snapshot=package_name,
        expiry_date=expiry,
        issued_sale_id=sale.get("id"),
        issued_sale_item_id=item.get("id"),
        issued_at=now,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    await db.gift_cards.insert_one(card.to_mongo())
    return card.id, card.code


async def cancel_gift_cards_for_pos_sale(
    db,
    clinic_id: str,
    pos_sale_id: str,
    *,
    reason: str = "POS sale cancelled",
) -> int:
    now = _now_iso()
    result = await db.gift_cards.update_many(
        {
            "clinic_id": clinic_id,
            "$or": [{"issued_sale_id": pos_sale_id}, {"pos_sale_id": pos_sale_id}],
            "status": {"$in": list(REDEEMABLE_STATUSES) + ["redeemed", "depleted", "active"]},
        },
        {"$set": {
            "status": "cancelled",
            "balance_value": 0,
            "remaining_redemptions": 0,
            "cancelled_at": now,
            "cancelled_reason": reason,
            "updated_at": now,
        }},
    )
    return int(result.modified_count)


async def reverse_redemption_by_id(
    db,
    clinic_id: str,
    redemption_id: str,
) -> bool:
    """Reverse a single gift card redemption row (e.g. void one invoice payment)."""
    raw = await db.gift_card_redemptions.find_one(
        {"clinic_id": clinic_id, "id": redemption_id, "reversed": {"$ne": True}},
        {"_id": 0},
    )
    if not raw:
        return False
    row = normalize_redemption_document(raw)
    card = await find_gift_card(db, clinic_id, row["gift_card_id"])
    if not card or card.get("status") == "cancelled":
        return False
    now = _now_iso()
    amt = int(row.get("amount_redeemed") or 0)
    if is_entitlement_gift_card(card):
        new_remaining = int(card.get("remaining_redemptions") or 0) + 1
        new_count = max(0, int(card.get("redemption_count") or 0) - 1)
        new_status = status_after_entitlement_redemption(new_remaining)
        await db.gift_cards.update_one(
            {"id": card["id"]},
            {"$set": {
                "remaining_redemptions": new_remaining,
                "redemption_count": new_count,
                "status": new_status,
                "redeemed_at": None if new_status == "active" else card.get("redeemed_at"),
                "reserved_booking_id": None if new_status == "active" else card.get("reserved_booking_id"),
                "updated_at": now,
            }},
        )
    elif card.get("gift_card_type") == "value_credit" and amt > 0:
        new_balance = int(card.get("balance_value") or 0) + amt
        cap = int(card.get("original_value") or 0)
        new_balance = min(new_balance, cap) if cap > 0 else new_balance
        new_status = status_after_redemption(new_balance, cap or new_balance)
        await db.gift_cards.update_one(
            {"id": card["id"]},
            {"$set": {
                "balance_value": new_balance,
                "status": new_status,
                "redeemed_at": None if new_status == "active" else card.get("redeemed_at"),
                "updated_at": now,
            }},
        )
    await db.gift_card_redemptions.update_one(
        {"id": row["id"]},
        {"$set": {"reversed": True, "reversed_at": now}},
    )
    return True


async def reverse_redemptions_for_reference(
    db,
    clinic_id: str,
    reference_type: str,
    reference_id: str,
) -> int:
    rows = await db.gift_card_redemptions.find(
        {
            "clinic_id": clinic_id,
            "reference_type": reference_type,
            "reference_id": reference_id,
            "reversed": {"$ne": True},
        },
        {"_id": 0},
    ).to_list(500)
    count = 0
    now = _now_iso()
    for raw in rows:
        row = normalize_redemption_document(raw)
        card = await find_gift_card(db, clinic_id, row["gift_card_id"])
        if not card or card.get("status") == "cancelled":
            continue
        amt = int(row.get("amount_redeemed") or 0)
        if is_entitlement_gift_card(card):
            new_remaining = int(card.get("remaining_redemptions") or 0) + 1
            new_count = max(0, int(card.get("redemption_count") or 0) - 1)
            new_status = status_after_entitlement_redemption(new_remaining)
            await db.gift_cards.update_one(
                {"id": card["id"]},
                {"$set": {
                    "remaining_redemptions": new_remaining,
                    "redemption_count": new_count,
                    "status": new_status,
                    "redeemed_at": None if new_status == "active" else card.get("redeemed_at"),
                    "updated_at": now,
                }},
            )
        elif card.get("gift_card_type") == "value_credit" and amt > 0:
            new_balance = int(card.get("balance_value") or 0) + amt
            cap = int(card.get("original_value") or 0)
            new_balance = min(new_balance, cap) if cap > 0 else new_balance
            new_status = status_after_redemption(new_balance, cap or new_balance)
            await db.gift_cards.update_one(
                {"id": card["id"]},
                {"$set": {
                    "balance_value": new_balance,
                    "status": new_status,
                    "redeemed_at": None if new_status == "active" else card.get("redeemed_at"),
                    "updated_at": now,
                }},
            )
        await db.gift_card_redemptions.update_one(
            {"id": row["id"]},
            {"$set": {"reversed": True, "reversed_at": now}},
        )
        count += 1
    return count


def make_payment_record(
    method: str,
    amount_idr: int,
    user: dict,
    *,
    gift_card_code: Optional[str] = None,
    gift_card_id: Optional[str] = None,
    gift_card_redemption_id: Optional[str] = None,
    reference: str = "",
) -> dict:
    """Ledger row for POS sale or invoice payment history."""
    return {
        "id": str(uuid.uuid4()),
        "method": (method or "other").strip().lower(),
        "amount_idr": int(amount_idr or 0),
        "gift_card_code": gift_card_code,
        "gift_card_id": gift_card_id,
        "gift_card_redemption_id": gift_card_redemption_id,
        "reference": (reference or "").strip() or None,
        "created_at": _now_iso(),
        "created_by": user.get("id"),
        "created_by_name_snapshot": user.get("name") or "",
    }


async def redeem_value_credit(
    db,
    *,
    clinic_id: str,
    user: dict,
    gift_card_code: str,
    amount_idr: int,
    reference_type: str,
    reference_id: str,
    notes: str = "",
    patient_id: Optional[str] = None,
) -> dict:
    if reference_type not in REDEEM_REFERENCE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid redemption reference")
    amount = int(amount_idr or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Redemption amount must be greater than zero")
    card = await find_gift_card_by_code(db, clinic_id, gift_card_code)
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    _assert_redeemable_value_card(card)
    balance = int(card.get("balance_value") or 0)
    if amount > balance:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient gift card balance (available {balance:,} IDR)",
        )
    original = int(card.get("original_value") or 0)
    new_balance = balance - amount
    new_status = status_after_redemption(new_balance, original)
    now = _now_iso()
    redemption = GiftCardRedemption(
        id=str(uuid.uuid4()),
        clinic_id=clinic_id,
        gift_card_id=card["id"],
        gift_card_code=card["code"],
        redeemed_by_user_id=user.get("id"),
        redeemed_by_name_snapshot=user.get("name") or "",
        patient_id=patient_id,
        reference_type=reference_type,
        reference_id=reference_id,
        amount_redeemed=amount,
        balance_before=balance,
        balance_after=new_balance,
        notes=(notes or "").strip() or None,
        created_at=now,
    )
    await db.gift_card_redemptions.insert_one(redemption.to_mongo())
    card_update: Dict[str, Any] = {
        "balance_value": new_balance,
        "status": new_status,
        "updated_at": now,
    }
    if new_status == "redeemed":
        card_update["redeemed_at"] = now
    await db.gift_cards.update_one({"id": card["id"]}, {"$set": card_update})
    return redemption_to_api({**redemption.to_mongo(), "gift_card_type": card.get("gift_card_type")})


async def redeem_entitlement_gift_card(
    db,
    *,
    clinic_id: str,
    user: dict,
    gift_card_id: str,
    patient_id: str,
    notes: str = "",
    reference_type: str = "entitlement",
    reference_id: Optional[str] = None,
    amount_redeemed: Optional[int] = None,
    create_patient_package: bool = True,
) -> dict:
    """Redeem a treatment or package gift card (single-use entitlement)."""
    from permissions import user_has_permission

    if not user_has_permission(user, "gift_cards.redeem"):
        raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")
    if reference_type not in REDEEM_REFERENCE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid redemption reference")
    card = await find_gift_card(db, clinic_id, gift_card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    _assert_redeemable_entitlement_card(card)
    pid = (patient_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id is required")
    remaining_before = int(card.get("remaining_redemptions") or 0)
    count_before = int(card.get("redemption_count") or 0)
    face_value = int(card.get("original_value") or 0)
    redeem_amount = int(amount_redeemed if amount_redeemed is not None else face_value)
    if redeem_amount < 0:
        redeem_amount = 0
    now = _now_iso()
    redemption_id = str(uuid.uuid4())
    ref_id = (reference_id or "").strip() or redemption_id
    patient_package_id: Optional[str] = None
    if card.get("gift_card_type") == "package" and create_patient_package:
        from patient_packages import create_patient_package_from_gift_card_redemption

        patient_package_id = await create_patient_package_from_gift_card_redemption(
            db,
            clinic_id=clinic_id,
            patient_id=pid,
            gift_card=card,
            redemption_id=redemption_id,
        )
        if patient_package_id:
            reference_type = "patient_package"
            ref_id = patient_package_id

    redemption = GiftCardRedemption(
        id=redemption_id,
        clinic_id=clinic_id,
        gift_card_id=card["id"],
        gift_card_code=card["code"],
        redeemed_by_user_id=user.get("id"),
        redeemed_by_name_snapshot=user.get("name") or "",
        patient_id=pid,
        reference_type=reference_type,
        reference_id=ref_id,
        amount_redeemed=redeem_amount,
        balance_before=remaining_before,
        balance_after=0,
        notes=(notes or "").strip() or None,
        created_at=now,
    )
    await db.gift_card_redemptions.insert_one(redemption.to_mongo())
    new_remaining = max(0, remaining_before - 1)
    new_count = count_before + 1
    new_status = status_after_entitlement_redemption(new_remaining)
    await db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {
            "remaining_redemptions": new_remaining,
            "redemption_count": new_count,
            "status": new_status,
            "redeemed_at": now,
            "updated_at": now,
        }},
    )
    out = redemption_to_api({**redemption.to_mongo(), "gift_card_type": card.get("gift_card_type")})
    if patient_package_id:
        out["patient_package_id"] = patient_package_id
    return out


async def redeem_entitlement_as_payment(
    db,
    *,
    user: dict,
    card: dict,
    total_idr: int,
    reference_type: str,
    reference_id: str,
    patient_id: Optional[str] = None,
    line_items: Optional[List[dict]] = None,
    notes: str = "",
) -> Tuple[dict, int]:
    """
    Redeem treatment/package gift card for POS/invoice payment.
    Returns (redemption_api, amount_applied_to_payment).
    """
    _assert_redeemable_entitlement_card(card)
    gc_type = (card.get("gift_card_type") or "").strip().lower()
    total = int(total_idr or 0)
    match = find_entitlement_match_line(card, line_items)
    create_pkg = True
    payment_amount = 0
    redeem_amount = int(card.get("original_value") or 0)

    if gc_type == "treatment":
        if not match:
            label = card.get("treatment_name_snapshot") or "this treatment"
            raise HTTPException(
                status_code=400,
                detail=f"This gift card is for {label}. Add the matching treatment before redeeming.",
            )
        line_amt = line_payable_amount(match)
        payment_amount = min(line_amt, total) if total > 0 else line_amt
        redeem_amount = payment_amount if payment_amount > 0 else line_amt
        if payment_amount <= 0 and redeem_amount <= 0:
            raise HTTPException(status_code=400, detail="Matching treatment line has no payable amount")
        create_pkg = False
    elif gc_type == "package":
        if match:
            line_amt = line_payable_amount(match)
            payment_amount = min(line_amt, total) if total > 0 else line_amt
            redeem_amount = payment_amount if payment_amount > 0 else line_amt
            create_pkg = False
        else:
            pid = (patient_id or "").strip()
            if not pid:
                raise HTTPException(
                    status_code=400,
                    detail="Select a patient before redeeming a package gift card.",
                )
            payment_amount = 0
            redeem_amount = int(card.get("original_value") or 0)
            create_pkg = True
    else:
        raise HTTPException(status_code=400, detail="Invalid entitlement gift card type")

    red = await redeem_entitlement_gift_card(
        db,
        clinic_id=user["clinic_id"],
        user=user,
        gift_card_id=card["id"],
        patient_id=(patient_id or "").strip() or card.get("recipient_patient_id") or "",
        notes=notes,
        reference_type=reference_type,
        reference_id=reference_id,
        amount_redeemed=redeem_amount,
        create_patient_package=create_pkg,
    )
    return red, payment_amount


async def apply_gift_card_payment(
    db,
    user: dict,
    *,
    total_idr: int,
    gift_card_code: Optional[str],
    gift_card_amount_idr: Optional[int],
    cash_amount_paid: Optional[int],
    reference_type: str,
    reference_id: str,
    payment_method: str = "cash",
    patient_id: Optional[str] = None,
    line_items: Optional[List[dict]] = None,
) -> Tuple[int, int, List[dict], str, List[dict]]:
    """Apply gift card redemption and optional cash. Returns cash, gc_paid, redemptions, settled method, payment records."""
    from permissions import user_has_permission

    if not user_has_permission(user, "gift_cards.redeem"):
        raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")

    total = int(total_idr or 0)
    redemptions: List[dict] = []
    payment_records: List[dict] = []
    gc_paid = 0
    code = (gift_card_code or "").strip()
    pm = (payment_method or "cash").strip().lower()

    if pm == "gift_card" and not code:
        raise HTTPException(status_code=400, detail="Gift card code is required")

    if code:
        card = await find_gift_card_by_code(db, user["clinic_id"], code)
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        if is_entitlement_gift_card(card):
            from gift_cards_booking import pos_entitlement_redemption_blocked_message
            raise HTTPException(
                status_code=400,
                detail=pos_entitlement_redemption_blocked_message(card),
            )
        else:
            requested = int(gift_card_amount_idr or 0)
            if requested <= 0:
                raise HTTPException(status_code=400, detail="Gift card redemption amount is required")
            if requested > total:
                raise HTTPException(
                    status_code=400,
                    detail=f"Redemption amount cannot exceed amount due ({total:,} IDR)",
                )
            balance = int(card.get("balance_value") or 0)
            if requested > balance:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient gift card balance (available {balance:,} IDR)",
                )
            red = await redeem_value_credit(
                db,
                clinic_id=user["clinic_id"],
                user=user,
                gift_card_code=code,
                amount_idr=requested,
                reference_type=reference_type,
                reference_id=reference_id,
                patient_id=patient_id,
            )
            gc_paid = int(red["amount_redeemed"])
            redemptions.append(red)
            payment_records.append(
                make_payment_record(
                    "gift_card",
                    gc_paid,
                    user,
                    gift_card_code=code,
                    gift_card_id=card.get("id"),
                    gift_card_redemption_id=red.get("id"),
                )
            )

    if pm == "gift_card" and cash_amount_paid is None:
        cash = max(0, total - gc_paid)
    else:
        cash = int(cash_amount_paid or 0)

    if gc_paid + cash < total:
        if redemptions:
            await reverse_redemptions_for_reference(db, user["clinic_id"], reference_type, reference_id)
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient payment: need {total:,} IDR (gift card {gc_paid:,} + other {cash:,})",
        )

    if cash > 0:
        cash_method = "cash" if pm == "gift_card" else pm
        payment_records.append(make_payment_record(cash_method, cash, user))

    if gc_paid >= total and cash <= 0:
        settled = "gift_card"
    elif gc_paid > 0 and cash > 0:
        settled = "mixed"
    elif gc_paid > 0:
        settled = "gift_card"
    else:
        settled = pm

    return cash, gc_paid, redemptions, settled, payment_records


async def aggregate_outstanding_summary(db, clinic_id: str) -> dict:
    rows = await db.gift_cards.find(
        {"clinic_id": clinic_id, "gift_card_type": "value_credit"},
        {"_id": 0},
    ).to_list(10000)
    outstanding = 0
    active_count = 0
    for raw in rows:
        c = normalize_gift_card_document(raw)
        if c.get("status") not in REDEEMABLE_STATUSES:
            continue
        bal = int(c.get("balance_value") or 0)
        if bal > 0:
            outstanding += bal
            active_count += 1
    issued = await db.gift_cards.count_documents(
        {"clinic_id": clinic_id, "gift_card_type": "value_credit"},
    )
    redeemed_pipeline = [
        {"$match": {"clinic_id": clinic_id, "reversed": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_redeemed"}}},
    ]
    redeemed_total = 0
    async for row in db.gift_card_redemptions.aggregate(redeemed_pipeline):
        redeemed_total = int(row.get("total") or 0)
    if redeemed_total == 0:
        legacy_pipeline = [
            {"$match": {"clinic_id": clinic_id, "reversed": {"$ne": True}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount_idr"}}},
        ]
        async for row in db.gift_card_redemptions.aggregate(legacy_pipeline):
            redeemed_total = int(row.get("total") or 0)
    return {
        "outstanding_balance_idr": outstanding,
        "outstanding_balance_value": outstanding,
        "active_cards_count": active_count,
        "issued_value_cards_count": issued,
        "total_redeemed_idr": redeemed_total,
        "total_redeemed_value": redeemed_total,
    }
