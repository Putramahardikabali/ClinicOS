"""Patient wallet / store credit — balance ledger and payment application."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from permissions import user_has_permission

WALLET_TRANSACTION_TYPES = frozenset({
    "credit",
    "debit",
    "adjustment",
    "refund_to_credit",
    "gift_card_redeem",
    "overpayment",
    "payment_use",
    "reversal",
})

WALLET_REFERENCE_TYPES = frozenset({
    "invoice",
    "pos_sale",
    "refund",
    "gift_card",
    "manual_adjustment",
    "booking_payment",
})

CREDIT_TRANSACTION_TYPES = frozenset({
    "credit",
    "adjustment",
    "refund_to_credit",
    "gift_card_redeem",
    "overpayment",
    "reversal",
})

DEBIT_TRANSACTION_TYPES = frozenset({
    "debit",
    "payment_use",
})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def wallet_to_api(doc: dict) -> dict:
    if not doc:
        return {}
    return {
        "id": doc.get("id"),
        "clinic_id": doc.get("clinic_id"),
        "patient_id": doc.get("patient_id"),
        "balance": int(doc.get("balance") or 0),
        "balance_idr": int(doc.get("balance") or 0),
        "currency": doc.get("currency") or "IDR",
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def wallet_transaction_to_api(doc: dict) -> dict:
    if not doc:
        return {}
    return {
        "id": doc.get("id"),
        "clinic_id": doc.get("clinic_id"),
        "patient_id": doc.get("patient_id"),
        "wallet_id": doc.get("wallet_id"),
        "transaction_type": doc.get("transaction_type"),
        "amount": int(doc.get("amount") or doc.get("amount_idr") or 0),
        "amount_idr": int(doc.get("amount") or doc.get("amount_idr") or 0),
        "balance_before": int(doc.get("balance_before") or 0),
        "balance_after": int(doc.get("balance_after") or 0),
        "reference_type": doc.get("reference_type"),
        "reference_id": doc.get("reference_id"),
        "notes": doc.get("notes") or "",
        "created_by": doc.get("created_by"),
        "created_by_name_snapshot": doc.get("created_by_name_snapshot"),
        "created_at": doc.get("created_at"),
        "reversed": bool(doc.get("reversed")),
        "reversal_of": doc.get("reversal_of"),
    }


async def _wallet_settings(db, clinic_id: str) -> dict:
    clinic = await db.clinics.find_one({"id": clinic_id}, {"_id": 0, "settings": 1}) or {}
    settings = clinic.get("settings") or {}
    wallet = settings.get("wallet") or {}
    return {
        "allow_negative": bool(wallet.get("allow_negative", False)),
    }


async def get_or_create_wallet(db, clinic_id: str, patient_id: str) -> dict:
    pid = (patient_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id is required")
    existing = await db.patient_wallets.find_one(
        {"clinic_id": clinic_id, "patient_id": pid},
        {"_id": 0},
    )
    if existing:
        return existing
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "patient_id": pid,
        "balance": 0,
        "currency": "IDR",
        "created_at": now,
        "updated_at": now,
    }
    await db.patient_wallets.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def get_wallet_balance(db, clinic_id: str, patient_id: str) -> int:
    wallet = await db.patient_wallets.find_one(
        {"clinic_id": clinic_id, "patient_id": patient_id},
        {"_id": 0, "balance": 1},
    )
    return int((wallet or {}).get("balance") or 0)


async def _record_wallet_transaction(
    db,
    user: dict,
    wallet: dict,
    *,
    transaction_type: str,
    amount_idr: int,
    balance_before: int,
    balance_after: int,
    reference_type: str,
    reference_id: str,
    notes: str = "",
    reversal_of: Optional[str] = None,
) -> dict:
    tx_type = (transaction_type or "").strip().lower()
    if tx_type not in WALLET_TRANSACTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid wallet transaction_type")
    ref_type = (reference_type or "").strip().lower()
    if ref_type not in WALLET_REFERENCE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid wallet reference_type")
    amt = int(amount_idr or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Wallet transaction amount must be positive")

    now = _now_iso()
    tx = {
        "id": str(uuid.uuid4()),
        "clinic_id": wallet["clinic_id"],
        "patient_id": wallet["patient_id"],
        "wallet_id": wallet["id"],
        "transaction_type": tx_type,
        "amount": amt,
        "amount_idr": amt,
        "balance_before": int(balance_before),
        "balance_after": int(balance_after),
        "reference_type": ref_type,
        "reference_id": (reference_id or "").strip() or tx_type,
        "notes": (notes or "").strip(),
        "created_by": user.get("id"),
        "created_by_name_snapshot": user.get("name") or "",
        "created_at": now,
        "reversed": False,
        "reversal_of": reversal_of,
    }
    await db.patient_wallet_transactions.insert_one(tx)
    tx.pop("_id", None)
    return tx


async def _apply_wallet_balance_change(
    db,
    user: dict,
    patient_id: str,
    *,
    delta: int,
    transaction_type: str,
    reference_type: str,
    reference_id: str,
    notes: str = "",
    reversal_of: Optional[str] = None,
) -> Tuple[dict, dict]:
    """Apply signed balance change. delta > 0 credits, delta < 0 debits."""
    if delta == 0:
        raise HTTPException(status_code=400, detail="Wallet change amount cannot be zero")
    clinic_id = user["clinic_id"]
    wallet = await get_or_create_wallet(db, clinic_id, patient_id)
    balance_before = int(wallet.get("balance") or 0)
    balance_after = balance_before + int(delta)
    settings = await _wallet_settings(db, clinic_id)
    if balance_after < 0 and not settings["allow_negative"]:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient wallet balance (available {balance_before:,} IDR)",
        )
    now = _now_iso()
    await db.patient_wallets.update_one(
        {"id": wallet["id"]},
        {"$set": {"balance": balance_after, "updated_at": now}},
    )
    wallet = {**wallet, "balance": balance_after, "updated_at": now}
    tx = await _record_wallet_transaction(
        db,
        user,
        wallet,
        transaction_type=transaction_type,
        amount_idr=abs(delta),
        balance_before=balance_before,
        balance_after=balance_after,
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
        reversal_of=reversal_of,
    )
    return wallet, tx


async def credit_wallet(
    db,
    user: dict,
    patient_id: str,
    amount_idr: int,
    *,
    transaction_type: str,
    reference_type: str,
    reference_id: str,
    notes: str = "",
) -> Tuple[dict, dict]:
    amt = int(amount_idr or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Credit amount must be positive")
    tx_type = (transaction_type or "credit").strip().lower()
    if tx_type not in CREDIT_TRANSACTION_TYPES and tx_type != "adjustment":
        raise HTTPException(status_code=400, detail="Invalid credit transaction type")
    return await _apply_wallet_balance_change(
        db,
        user,
        patient_id,
        delta=amt,
        transaction_type=tx_type,
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
    )


async def debit_wallet(
    db,
    user: dict,
    patient_id: str,
    amount_idr: int,
    *,
    transaction_type: str = "payment_use",
    reference_type: str,
    reference_id: str,
    notes: str = "",
) -> Tuple[dict, dict]:
    if not user_has_permission(user, "wallet.use"):
        raise HTTPException(status_code=403, detail="wallet.use permission is required")
    amt = int(amount_idr or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Debit amount must be positive")
    tx_type = (transaction_type or "payment_use").strip().lower()
    if tx_type not in DEBIT_TRANSACTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid debit transaction type")
    return await _apply_wallet_balance_change(
        db,
        user,
        patient_id,
        delta=-amt,
        transaction_type=tx_type,
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
    )


async def reverse_wallet_transaction_by_id(
    db,
    user: dict,
    wallet_transaction_id: str,
    *,
    notes: str = "Payment void reversal",
) -> Optional[dict]:
    raw = await db.patient_wallet_transactions.find_one(
        {
            "clinic_id": user["clinic_id"],
            "id": wallet_transaction_id,
            "reversed": {"$ne": True},
        },
        {"_id": 0},
    )
    if not raw:
        return None
    tx_type = (raw.get("transaction_type") or "").strip().lower()
    amt = int(raw.get("amount") or raw.get("amount_idr") or 0)
    if tx_type in DEBIT_TRANSACTION_TYPES:
        delta = amt
    elif tx_type in CREDIT_TRANSACTION_TYPES:
        delta = -amt
    else:
        return None
    _, rev = await _apply_wallet_balance_change(
        db,
        user,
        raw["patient_id"],
        delta=delta,
        transaction_type="reversal",
        reference_type=raw.get("reference_type") or "manual_adjustment",
        reference_id=raw.get("reference_id") or raw["id"],
        notes=notes,
        reversal_of=raw["id"],
    )
    await db.patient_wallet_transactions.update_one(
        {"id": raw["id"]},
        {"$set": {"reversed": True, "reversed_at": _now_iso()}},
    )
    return rev


async def reverse_wallet_transactions_for_reference(
    db,
    user: dict,
    reference_type: str,
    reference_id: str,
) -> int:
    n = 0
    rows = await db.patient_wallet_transactions.find(
        {
            "clinic_id": user["clinic_id"],
            "reference_type": reference_type,
            "reference_id": reference_id,
            "reversed": {"$ne": True},
            "transaction_type": {"$in": list(DEBIT_TRANSACTION_TYPES)},
        },
        {"_id": 0, "id": 1},
    ).to_list(100)
    for row in rows:
        if await reverse_wallet_transaction_by_id(db, user, row["id"]):
            n += 1
    return n


def make_wallet_payment_record(
    amount_idr: int,
    user: dict,
    *,
    wallet_transaction_id: str,
    patient_id: str,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "method": "store_credit",
        "amount_idr": int(amount_idr or 0),
        "wallet_transaction_id": wallet_transaction_id,
        "patient_id": patient_id,
        "created_at": _now_iso(),
        "created_by": user.get("id"),
        "created_by_name_snapshot": user.get("name") or "",
    }


async def apply_wallet_payment(
    db,
    user: dict,
    *,
    patient_id: str,
    amount_idr: int,
    max_due: int,
    reference_type: str,
    reference_id: str,
) -> Tuple[int, dict, dict]:
    """Debit wallet for payment. Returns (amount_applied, wallet_tx, payment_record)."""
    pid = (patient_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Patient is required to use store credit")
    requested = int(amount_idr or 0)
    if requested <= 0:
        raise HTTPException(status_code=400, detail="Store credit amount is required")
    due = int(max_due or 0)
    if requested > due:
        raise HTTPException(
            status_code=400,
            detail=f"Store credit cannot exceed amount due ({due:,} IDR)",
        )
    balance = await get_wallet_balance(db, user["clinic_id"], pid)
    if requested > balance:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient wallet balance (available {balance:,} IDR)",
        )
    _, tx = await debit_wallet(
        db,
        user,
        pid,
        requested,
        transaction_type="payment_use",
        reference_type=reference_type,
        reference_id=reference_id,
        notes=f"Payment via store credit ({reference_type})",
    )
    pay = make_wallet_payment_record(
        requested,
        user,
        wallet_transaction_id=tx["id"],
        patient_id=pid,
    )
    return requested, tx, pay


async def redeem_gift_card_to_wallet(
    db,
    user: dict,
    *,
    gift_card_id: str,
    patient_id: str,
    amount_idr: Optional[int] = None,
) -> dict:
    from gift_card_models import is_entitlement_gift_card
    from gift_cards_core import find_gift_card, redeem_value_credit

    if not user_has_permission(user, "wallet.use") and not user_has_permission(user, "gift_cards.redeem"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    card = await find_gift_card(db, user["clinic_id"], gift_card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    if is_entitlement_gift_card(card):
        raise HTTPException(
            status_code=400,
            detail="Treatment and package gift cards cannot be redeemed to patient wallet",
        )
    if (card.get("gift_card_type") or "").strip().lower() != "value_credit":
        raise HTTPException(status_code=400, detail="Only value/credit gift cards can be redeemed to wallet")

    balance = int(card.get("balance_value") or 0)
    redeem_amt = int(amount_idr if amount_idr is not None else balance)
    if redeem_amt <= 0:
        raise HTTPException(status_code=400, detail="Redemption amount must be positive")
    if redeem_amt > balance:
        raise HTTPException(status_code=400, detail=f"Amount exceeds gift card balance ({balance:,} IDR)")

    pid = (patient_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id is required")

    red = await redeem_value_credit(
        db,
        clinic_id=user["clinic_id"],
        user=user,
        gift_card_code=card["code"],
        amount_idr=redeem_amt,
        reference_type="pos_sale" if card.get("issued_sale_id") else "entitlement",
        reference_id=card.get("issued_sale_id") or gift_card_id,
        patient_id=pid,
        notes="Redeemed to patient wallet",
    )
    _, tx = await credit_wallet(
        db,
        user,
        pid,
        redeem_amt,
        transaction_type="gift_card_redeem",
        reference_type="gift_card",
        reference_id=gift_card_id,
        notes=f"From gift card {card.get('code') or gift_card_id}",
    )
    return {
        "gift_card_redemption": red,
        "wallet_transaction": wallet_transaction_to_api(tx),
        "amount_idr": redeem_amt,
    }


async def credit_refund_to_wallet(
    db,
    user: dict,
    patient_id: str,
    amount_idr: int,
    refund_id: str,
    notes: str = "",
) -> dict:
    _, tx = await credit_wallet(
        db,
        user,
        patient_id,
        amount_idr,
        transaction_type="refund_to_credit",
        reference_type="refund",
        reference_id=refund_id,
        notes=notes or "Refund credited to patient wallet",
    )
    return wallet_transaction_to_api(tx)


async def credit_overpayment_to_wallet(
    db,
    user: dict,
    patient_id: str,
    amount_idr: int,
    reference_type: str,
    reference_id: str,
    notes: str = "",
) -> dict:
    _, tx = await credit_wallet(
        db,
        user,
        patient_id,
        amount_idr,
        transaction_type="overpayment",
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes or "Overpayment added to wallet",
    )
    return wallet_transaction_to_api(tx)


async def aggregate_outstanding_wallet_liability(db, clinic_id: str) -> dict:
    pipeline = [
        {"$match": {"clinic_id": clinic_id}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$balance", 0]}}, "count": {"$sum": 1}}},
    ]
    rows = await db.patient_wallets.aggregate(pipeline).to_list(1)
    total = int(rows[0]["total"]) if rows else 0
    count = int(rows[0]["count"]) if rows else 0
    return {"outstanding_balance_idr": total, "wallet_count": count}


async def aggregate_wallet_for_date(db, clinic_id: str, date_str: str) -> dict:
    """Wallet activity for daily closing / accounting."""
    date_str = (date_str or "").strip()[:10]
    flt = {
        "clinic_id": clinic_id,
        "created_at": {"$regex": f"^{date_str}"},
        "reversed": {"$ne": True},
    }
    rows = await db.patient_wallet_transactions.find(flt, {"_id": 0}).to_list(10000)

    credits_issued = 0
    credits_used = 0
    refunds_to_wallet = 0
    gift_card_to_wallet = 0
    overpayments = 0
    adjustments = 0

    for r in rows:
        amt = int(r.get("amount") or r.get("amount_idr") or 0)
        t = (r.get("transaction_type") or "").strip().lower()
        if t == "payment_use":
            credits_used += amt
        elif t == "refund_to_credit":
            refunds_to_wallet += amt
            credits_issued += amt
        elif t == "gift_card_redeem":
            gift_card_to_wallet += amt
            credits_issued += amt
        elif t == "overpayment":
            overpayments += amt
            credits_issued += amt
        elif t == "adjustment":
            adjustments += amt
            if amt > 0:
                credits_issued += amt
        elif t in ("credit", "reversal"):
            credits_issued += amt

    return {
        "wallet_credits_issued_idr": credits_issued,
        "wallet_credits_used_idr": credits_used,
        "refunds_to_wallet_idr": refunds_to_wallet,
        "gift_card_to_wallet_idr": gift_card_to_wallet,
        "overpayments_to_wallet_idr": overpayments,
        "adjustments_idr": adjustments,
        "store_credit_payments_idr": credits_used,
        "count": len(rows),
        "items": [wallet_transaction_to_api(r) for r in rows[:200]],
    }


async def aggregate_wallet_report(
    db,
    clinic_id: str,
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    flt: Dict[str, Any] = {"clinic_id": clinic_id, "reversed": {"$ne": True}}
    if date_from:
        flt.setdefault("created_at", {})["$gte"] = date_from[:10]
    if date_to:
        flt.setdefault("created_at", {})["$lte"] = f"{date_to[:10]}T23:59:59.999999"

    rows = await db.patient_wallet_transactions.find(flt, {"_id": 0}).sort("created_at", -1).to_list(10000)
    outstanding = await aggregate_outstanding_wallet_liability(db, clinic_id)

    credits_issued = 0
    credits_used = 0
    adjustments = 0
    by_type: Dict[str, int] = {}

    for r in rows:
        amt = int(r.get("amount") or r.get("amount_idr") or 0)
        t = (r.get("transaction_type") or "other").strip().lower()
        by_type[t] = by_type.get(t, 0) + amt
        if t == "payment_use":
            credits_used += amt
        elif t == "adjustment":
            adjustments += amt
        elif t in CREDIT_TRANSACTION_TYPES:
            credits_issued += amt

    wallets = await db.patient_wallets.find(
        {"clinic_id": clinic_id, "balance": {"$gt": 0}},
        {"_id": 0, "patient_id": 1, "balance": 1},
    ).sort("balance", -1).to_list(500)

    patient_ids = [w["patient_id"] for w in wallets if w.get("patient_id")]
    patients = {}
    if patient_ids:
        async for p in db.patients.find(
            {"clinic_id": clinic_id, "id": {"$in": patient_ids}},
            {"_id": 0, "id": 1, "full_name": 1, "phone": 1},
        ):
            patients[p["id"]] = p

    balances = []
    for w in wallets:
        p = patients.get(w["patient_id"]) or {}
        balances.append({
            "patient_id": w["patient_id"],
            "patient_name": p.get("full_name") or "—",
            "patient_phone": p.get("phone") or "",
            "balance_idr": int(w.get("balance") or 0),
        })

    return {
        "outstanding_liability_idr": outstanding.get("outstanding_balance_idr") or 0,
        "wallet_count": outstanding.get("wallet_count") or 0,
        "credits_issued_idr": credits_issued,
        "credits_used_idr": credits_used,
        "adjustments_idr": adjustments,
        "by_transaction_type": by_type,
        "patient_balances": balances,
        "transactions": [wallet_transaction_to_api(r) for r in rows[:500]],
        "transaction_count": len(rows),
    }
