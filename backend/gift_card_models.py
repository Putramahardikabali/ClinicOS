"""Gift card and redemption document models (MongoDB collections)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

GIFT_CARD_TYPES = frozenset({"value_credit", "treatment", "package"})
GIFT_CARD_STATUSES = frozenset({
    "draft",
    "active",
    "reserved",
    "partially_redeemed",
    "redeemed",
    "expired",
    "cancelled",
})
REDEEM_REFERENCE_TYPES = frozenset({"invoice", "pos_sale", "patient_package", "entitlement"})

REDEEMABLE_STATUSES = frozenset({"active", "partially_redeemed"})

# Unambiguous charset (no 0/O, 1/I/L) — easy to type, hard to guess
GC_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
GC_CODE_SEGMENT_LEN = 4
GC_CODE_PATTERN = r"^GC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class GiftCard(BaseModel):
    id: str
    clinic_id: str
    code: str
    gift_card_type: str = "value_credit"
    status: str = "draft"
    purchaser_patient_id: Optional[str] = None
    purchaser_name: Optional[str] = None
    purchaser_phone: Optional[str] = None
    recipient_patient_id: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_email: Optional[str] = None
    message: Optional[str] = None
    notes: Optional[str] = None
    original_value: int = 0
    balance_value: int = 0
    redemption_count: int = 0
    remaining_redemptions: int = 0
    treatment_catalog_id: Optional[str] = None
    treatment_name_snapshot: Optional[str] = None
    package_catalog_id: Optional[str] = None
    package_name_snapshot: Optional[str] = None
    expiry_date: Optional[str] = None
    issued_sale_id: Optional[str] = None
    issued_sale_item_id: Optional[str] = None
    issued_at: Optional[str] = None
    redeemed_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    cancelled_reason: Optional[str] = None
    reserved_booking_id: Optional[str] = None
    reserved_patient_id: Optional[str] = None
    reserved_at: Optional[str] = None
    reserved_patient_package_id: Optional[str] = None
    redeemed_booking_id: Optional[str] = None
    redeemed_invoice_id: Optional[str] = None
    redeemed_patient_package_id: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)

    def to_mongo(self) -> dict:
        return self.model_dump(exclude_none=False)

    @classmethod
    def from_mongo(cls, raw: dict) -> "GiftCard":
        return cls(**normalize_gift_card_document(raw))


class GiftCardRedemption(BaseModel):
    id: str
    clinic_id: str
    gift_card_id: str
    gift_card_code: str
    redeemed_by_user_id: Optional[str] = None
    patient_id: Optional[str] = None
    reference_type: str
    reference_id: str
    amount_redeemed: int = 0
    balance_before: int = 0
    balance_after: int = 0
    notes: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    # Internal — reversal bookkeeping (not exposed on primary API schema)
    reversed: bool = False
    reversed_at: Optional[str] = None
    redeemed_by_name_snapshot: Optional[str] = None

    def to_mongo(self) -> dict:
        return self.model_dump(exclude_none=False)

    @classmethod
    def from_mongo(cls, raw: dict) -> "GiftCardRedemption":
        return cls(**normalize_redemption_document(raw))


def _int(val: Any, default: int = 0) -> int:
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return default


def normalize_gift_card_document(raw: dict) -> dict:
    """Map legacy Mongo fields to canonical GiftCard shape."""
    if not raw:
        return {}
    d = dict(raw)
    original = _int(
        d.get("original_value")
        if d.get("original_value") is not None
        else d.get("initial_value_idr", d.get("value_idr"))
    )
    balance = _int(
        d.get("balance_value")
        if d.get("balance_value") is not None
        else d.get("balance_idr")
    )
    status = (d.get("status") or "draft").strip().lower()
    gc_type = (d.get("gift_card_type") or "value_credit").strip().lower()
    if status == "depleted":
        if gc_type in ("treatment", "package"):
            status = "redeemed"
        else:
            status = "redeemed" if balance <= 0 else "partially_redeemed"
    redemption_count = _int(d.get("redemption_count"))
    remaining_redemptions = d.get("remaining_redemptions")
    if remaining_redemptions is None:
        if gc_type in ("treatment", "package"):
            remaining_redemptions = 0 if status == "redeemed" or redemption_count > 0 else 1
        else:
            remaining_redemptions = 0
    else:
        remaining_redemptions = _int(remaining_redemptions)
    issued_sale = d.get("issued_sale_id") or d.get("pos_sale_id")
    purchaser_name = d.get("purchaser_name") or d.get("customer_name_snapshot")
    expiry = d.get("expiry_date") or d.get("expires_at")
    if expiry and len(str(expiry)) > 10:
        expiry = str(expiry)[:10]
    return {
        "id": d.get("id"),
        "clinic_id": d.get("clinic_id"),
        "code": d.get("code"),
        "gift_card_type": gc_type,
        "status": status,
        "redemption_count": redemption_count,
        "remaining_redemptions": remaining_redemptions,
        "purchaser_patient_id": d.get("purchaser_patient_id"),
        "purchaser_name": purchaser_name,
        "purchaser_phone": d.get("purchaser_phone"),
        "recipient_patient_id": d.get("recipient_patient_id"),
        "recipient_name": d.get("recipient_name"),
        "recipient_phone": d.get("recipient_phone"),
        "recipient_email": d.get("recipient_email"),
        "message": d.get("message"),
        "notes": d.get("notes"),
        "original_value": original,
        "balance_value": balance,
        "treatment_catalog_id": d.get("treatment_catalog_id"),
        "treatment_name_snapshot": d.get("treatment_name_snapshot"),
        "package_catalog_id": d.get("package_catalog_id"),
        "package_name_snapshot": d.get("package_name_snapshot"),
        "expiry_date": expiry,
        "issued_sale_id": issued_sale,
        "issued_sale_item_id": d.get("issued_sale_item_id") or d.get("pos_sale_item_id"),
        "issued_at": d.get("issued_at"),
        "redeemed_at": d.get("redeemed_at"),
        "cancelled_at": d.get("cancelled_at"),
        "cancelled_reason": d.get("cancelled_reason"),
        "reserved_booking_id": d.get("reserved_booking_id"),
        "reserved_patient_id": d.get("reserved_patient_id"),
        "reserved_at": d.get("reserved_at"),
        "reserved_patient_package_id": d.get("reserved_patient_package_id"),
        "redeemed_booking_id": d.get("redeemed_booking_id"),
        "redeemed_invoice_id": d.get("redeemed_invoice_id"),
        "redeemed_patient_package_id": d.get("redeemed_patient_package_id"),
        "created_by": d.get("created_by") or d.get("created_by_user_id"),
        "created_at": d.get("created_at") or _now_iso(),
        "updated_at": d.get("updated_at") or d.get("created_at") or _now_iso(),
    }


def normalize_redemption_document(raw: dict) -> dict:
    if not raw:
        return {}
    d = dict(raw)
    amount = _int(
        d.get("amount_redeemed")
        if d.get("amount_redeemed") is not None
        else d.get("amount_idr")
    )
    ref_type = (d.get("reference_type") or "pos_sale").strip().lower()
    if ref_type == "pos":
        ref_type = "pos_sale"
    return {
        "id": d.get("id"),
        "clinic_id": d.get("clinic_id"),
        "gift_card_id": d.get("gift_card_id"),
        "gift_card_code": d.get("gift_card_code"),
        "redeemed_by_user_id": d.get("redeemed_by_user_id"),
        "patient_id": d.get("patient_id"),
        "reference_type": ref_type,
        "reference_id": d.get("reference_id"),
        "amount_redeemed": amount,
        "balance_before": _int(
            d.get("balance_before")
            if d.get("balance_before") is not None
            else d.get("balance_before_idr")
        ),
        "balance_after": _int(
            d.get("balance_after")
            if d.get("balance_after") is not None
            else d.get("balance_after_idr")
        ),
        "notes": d.get("notes"),
        "created_at": d.get("created_at") or d.get("redeemed_at") or _now_iso(),
        "reversed": bool(d.get("reversed")),
        "reversed_at": d.get("reversed_at"),
        "redeemed_by_name_snapshot": d.get("redeemed_by_name_snapshot"),
    }


def normalize_gift_card_code(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def is_gift_card_expired(card: dict, *, today: Optional[str] = None) -> bool:
    expiry = card.get("expiry_date")
    if not expiry:
        return False
    if today is None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return str(expiry)[:10] < today[:10]


def is_entitlement_gift_card(card: dict) -> bool:
    return (card.get("gift_card_type") or "").strip().lower() in ("treatment", "package")


def effective_gift_card_status(card: dict, *, today: Optional[str] = None) -> str:
    """Derive status including expiry (does not persist)."""
    norm = normalize_gift_card_document(card)
    status = (norm.get("status") or "draft").strip().lower()
    if status == "cancelled":
        return "cancelled"
    if status == "reserved":
        return "reserved"
    if is_gift_card_expired(norm, today=today):
        return "expired"
    if is_entitlement_gift_card(norm):
        remaining = _int(norm.get("remaining_redemptions"))
        if remaining > 0 and status not in ("redeemed",):
            return status if status in ("active", "reserved") else "active"
        if status == "redeemed" or _int(norm.get("redemption_count")) > 0:
            return "redeemed"
        return "active"
    balance = _int(norm.get("balance_value"))
    if status in ("active", "partially_redeemed") and balance <= 0:
        return "redeemed"
    return status


def status_after_value_redemption(balance: int, original: int) -> str:
    if balance <= 0:
        return "redeemed"
    if balance < original:
        return "partially_redeemed"
    return "active"


def status_after_entitlement_redemption(remaining_redemptions: int) -> str:
    return "redeemed" if remaining_redemptions <= 0 else "active"


# Backward-compatible alias
status_after_redemption = status_after_value_redemption


def gift_card_remaining_display(card: dict) -> Dict[str, Any]:
    """UI-facing remaining balance (money vs entitlement count)."""
    norm = normalize_gift_card_document(card)
    eff = effective_gift_card_status(norm)
    gc_type = norm.get("gift_card_type")
    if gc_type == "value_credit":
        bal = _int(norm.get("balance_value"))
        return {
            "kind": "money",
            "amount_idr": bal,
            "label": f"Rp {bal:,}".replace(",", ".") if bal else "Rp 0",
        }
    remaining = _int(norm.get("remaining_redemptions"))
    if eff == "redeemed" or remaining <= 0:
        return {"kind": "text", "text": "Redeemed", "label": "Redeemed"}
    if gc_type == "treatment":
        return {"kind": "text", "text": "1 treatment", "label": "1 treatment"}
    if gc_type == "package":
        return {"kind": "text", "text": "1 package", "label": "1 package"}
    return {"kind": "text", "text": "Available", "label": "Available"}


def gift_card_to_api(doc: dict) -> dict:
    """Canonical document plus legacy aliases for existing clients."""
    norm = normalize_gift_card_document(doc)
    effective = effective_gift_card_status(norm)
    out = dict(norm)
    out["status"] = effective
    out["balance_idr"] = norm["balance_value"]
    out["initial_value_idr"] = norm["original_value"]
    out["value_idr"] = norm["original_value"]
    out["pos_sale_id"] = norm.get("issued_sale_id")
    out["pos_sale_item_id"] = norm.get("issued_sale_item_id")
    out["customer_name_snapshot"] = norm.get("purchaser_name")
    out["expires_at"] = norm.get("expiry_date")
    if is_entitlement_gift_card(norm):
        out["redeemable"] = (
            effective in REDEEMABLE_STATUSES
            and effective != "reserved"
            and _int(norm.get("remaining_redemptions")) > 0
        )
    else:
        out["redeemable"] = (
            effective in REDEEMABLE_STATUSES
            and _int(norm.get("balance_value")) > 0
        )
    out["remaining_display"] = gift_card_remaining_display(norm)
    out["redemption_count"] = norm.get("redemption_count", 0)
    out["remaining_redemptions"] = norm.get("remaining_redemptions", 0)
    return out


def redemption_to_api(doc: dict) -> dict:
    norm = normalize_redemption_document(doc)
    out = dict(norm)
    out["amount_idr"] = norm["amount_redeemed"]
    out["balance_before_idr"] = norm["balance_before"]
    out["balance_after_idr"] = norm["balance_after"]
    out["redeemed_at"] = norm["created_at"]
    out["gift_card_type"] = doc.get("gift_card_type")
    return out


def gift_card_list_row(doc: dict) -> dict:
    api = gift_card_to_api(doc)
    return {
        "id": api["id"],
        "code": api["code"],
        "status": api["status"],
        "gift_card_type": api["gift_card_type"],
        "original_value": api["original_value"],
        "balance_value": api["balance_value"],
        "initial_value_idr": api["initial_value_idr"],
        "balance_idr": api["balance_idr"],
        "recipient_name": api.get("recipient_name"),
        "recipient_phone": api.get("recipient_phone"),
        "purchaser_name": api.get("purchaser_name"),
        "purchaser_phone": api.get("purchaser_phone"),
        "issued_at": api.get("issued_at"),
        "issued_sale_id": api.get("issued_sale_id"),
        "expiry_date": api.get("expiry_date"),
        "redemption_count": api.get("redemption_count", 0),
        "remaining_redemptions": api.get("remaining_redemptions", 0),
        "remaining_display": api.get("remaining_display"),
    }


async def migrate_gift_card_collections(db) -> None:
    """One-time style migration: legacy field names → canonical schema."""
    now = _now_iso()
    async for raw in db.gift_cards.find({}):
        norm = normalize_gift_card_document(raw)
        if norm.get("balance_value") != _int(raw.get("balance_idr"), -1) or raw.get("pos_sale_id"):
            await db.gift_cards.update_one(
                {"id": raw["id"]},
                {"$set": {
                    "original_value": norm["original_value"],
                    "balance_value": norm["balance_value"],
                    "status": norm["status"],
                    "issued_sale_id": norm.get("issued_sale_id"),
                    "issued_sale_item_id": norm.get("issued_sale_item_id"),
                    "purchaser_name": norm.get("purchaser_name"),
                    "expiry_date": norm.get("expiry_date"),
                    "updated_at": now,
                }, "$unset": {
                    "balance_idr": "",
                    "initial_value_idr": "",
                    "value_idr": "",
                    "pos_sale_id": "",
                    "pos_sale_item_id": "",
                    "customer_name_snapshot": "",
                    "expires_at": "",
                }},
            )
    async for raw in db.gift_card_redemptions.find({}):
        norm = normalize_redemption_document(raw)
        if raw.get("amount_idr") is not None and raw.get("amount_redeemed") is None:
            await db.gift_card_redemptions.update_one(
                {"id": raw["id"]},
                {"$set": {
                    "amount_redeemed": norm["amount_redeemed"],
                    "balance_before": norm["balance_before"],
                    "balance_after": norm["balance_after"],
                }, "$unset": {
                    "amount_idr": "",
                    "balance_before_idr": "",
                    "balance_after_idr": "",
                }},
            )
    await repair_entitlement_gift_cards(db)


async def repair_entitlement_gift_cards(db) -> int:
    """Fix treatment/package cards wrongly marked redeemed at purchase (no redemption rows)."""
    repaired = 0
    now = _now_iso()
    cursor = db.gift_cards.find(
        {
            "gift_card_type": {"$in": ["treatment", "package"]},
            "status": "redeemed",
            "$or": [
                {"issued_sale_id": {"$exists": True, "$ne": None, "$ne": ""}},
                {"pos_sale_id": {"$exists": True, "$ne": None, "$ne": ""}},
            ],
        },
        {"_id": 0},
    )
    async for raw in cursor:
        card_id = raw.get("id")
        if not card_id:
            continue
        red_count = await db.gift_card_redemptions.count_documents(
            {"gift_card_id": card_id, "reversed": {"$ne": True}},
        )
        if red_count > 0:
            continue
        before = {
            "status": raw.get("status"),
            "remaining_redemptions": raw.get("remaining_redemptions"),
            "redemption_count": raw.get("redemption_count"),
        }
        await db.gift_cards.update_one(
            {"id": card_id},
            {"$set": {
                "status": "active",
                "remaining_redemptions": 1,
                "redemption_count": 0,
                "redeemed_at": None,
                "updated_at": now,
            }},
        )
        await db.gift_card_repair_log.insert_one({
            "id": str(uuid.uuid4()),
            "gift_card_id": card_id,
            "clinic_id": raw.get("clinic_id"),
            "code": raw.get("code"),
            "repair_type": "entitlement_false_redeemed",
            "before": before,
            "after": {
                "status": "active",
                "remaining_redemptions": 1,
                "redemption_count": 0,
            },
            "created_at": now,
        })
        repaired += 1
    return repaired
