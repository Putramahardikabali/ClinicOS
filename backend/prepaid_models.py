"""Patient prepaid (unearned revenue / liability) document models."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

PREPAID_TYPES = frozenset({"credit", "treatment"})
PREPAID_STATUSES = frozenset({
    "active", "partially_used", "used", "expired", "refunded", "voided",
})
REDEEMABLE_PREPAID_STATUSES = frozenset({"active", "partially_used"})
PREPAID_CODE_PATTERN = r"^PP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$"
PREPAID_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _int(val: Any, default: int = 0) -> int:
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return default


def normalize_prepaid_code(code: str) -> str:
    return (code or "").strip().upper()


def effective_prepaid_status(doc: dict) -> str:
    stored = (doc.get("status") or "active").strip().lower()
    if stored in ("voided", "refunded", "used"):
        return stored
    expiry = (doc.get("expiry_date") or "").strip()
    if expiry and expiry < datetime.now(timezone.utc).strftime("%Y-%m-%d"):
        if stored in REDEEMABLE_PREPAID_STATUSES:
            return "expired"
    bal = _int(doc.get("remaining_balance_idr"))
    orig = _int(doc.get("original_amount_idr"))
    if stored == "active" and bal < orig and bal > 0:
        return "partially_used"
    if bal <= 0 and orig > 0 and stored not in ("voided", "refunded"):
        return "used"
    return stored


def prepaid_to_api(doc: dict) -> dict:
    if not doc:
        return {}
    row = dict(doc)
    row["status"] = effective_prepaid_status(row)
    row["prepaid_type_label"] = "Prepaid Credit" if row.get("prepaid_type") == "credit" else "Prepaid Treatment"
    return row


def prepaid_list_row(doc: dict) -> dict:
    api = prepaid_to_api(doc)
    return {
        "id": api.get("id"),
        "code": api.get("code"),
        "patient_id": api.get("patient_id"),
        "prepaid_type": api.get("prepaid_type"),
        "prepaid_type_label": api.get("prepaid_type_label"),
        "status": api.get("status"),
        "original_amount_idr": api.get("original_amount_idr"),
        "remaining_balance_idr": api.get("remaining_balance_idr"),
        "purchased_at": api.get("purchased_at"),
        "expiry_date": api.get("expiry_date"),
        "campaign_name_snapshot": api.get("campaign_name_snapshot"),
        "treatment_name_snapshot": api.get("treatment_name_snapshot"),
        "pos_sale_id": api.get("pos_sale_id"),
        "invoice_id": api.get("redeemed_invoice_id"),
        "created_by_name_snapshot": api.get("created_by_name_snapshot"),
    }


class PatientPrepaid(BaseModel):
    id: str
    clinic_id: str
    patient_id: str
    code: str
    prepaid_type: str = "credit"
    status: str = "active"
    original_amount_idr: int = 0
    remaining_balance_idr: int = 0
    treatment_catalog_id: Optional[str] = None
    treatment_name_snapshot: Optional[str] = None
    quantity: int = 1
    remaining_quantity: int = 1
    prepaid_price_snapshot: Optional[int] = None
    campaign_id: Optional[str] = None
    campaign_name_snapshot: Optional[str] = None
    promo_price_snapshot: Optional[int] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None
    pos_sale_id: Optional[str] = None
    pos_sale_item_id: Optional[str] = None
    purchased_at: Optional[str] = None
    redeemed_invoice_id: Optional[str] = None
    redeemed_at: Optional[str] = None
    voided_at: Optional[str] = None
    void_reason: Optional[str] = None
    refunded_at: Optional[str] = None
    refund_amount_idr: int = 0
    created_by: Optional[str] = None
    created_by_name_snapshot: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)

    def to_mongo(self) -> dict:
        return self.model_dump(exclude_none=False)


class PrepaidRedemption(BaseModel):
    id: str
    clinic_id: str
    prepaid_id: str
    prepaid_code: str
    patient_id: str
    reference_type: str
    reference_id: str
    amount_redeemed_idr: int = 0
    balance_before_idr: int = 0
    balance_after_idr: int = 0
    recognized_revenue_idr: int = 0
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_by_name_snapshot: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    reversed: bool = False
    reversed_at: Optional[str] = None

    def to_mongo(self) -> dict:
        return self.model_dump(exclude_none=False)
