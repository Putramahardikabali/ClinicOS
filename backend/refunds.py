"""Refund / adjustment records for POS, invoices, and payments."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from permissions import user_has_permission

REFUND_REFERENCE_TYPES = frozenset({
    "pos_sale", "invoice", "payment", "gift_card", "package",
})
REFUND_METHODS = frozenset({"cash", "card", "bank_transfer", "qris", "store_credit", "other"})
REFUND_STATUSES = frozenset({"recorded", "cancelled"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def refund_to_api(doc: dict) -> dict:
    if not doc:
        return {}
    return {
        "id": doc.get("id"),
        "clinic_id": doc.get("clinic_id"),
        "reference_type": doc.get("reference_type"),
        "reference_id": doc.get("reference_id"),
        "parent_reference_type": doc.get("parent_reference_type"),
        "parent_reference_id": doc.get("parent_reference_id"),
        "amount_idr": int(doc.get("amount_idr") or 0),
        "method": doc.get("method") or "cash",
        "reason": doc.get("reason") or "",
        "notes": doc.get("notes") or "",
        "status": doc.get("status") or "recorded",
        "business_date": doc.get("business_date"),
        "created_by": doc.get("created_by"),
        "created_by_name_snapshot": doc.get("created_by_name_snapshot"),
        "created_at": doc.get("created_at"),
    }


async def create_refund_record(
    db,
    user: dict,
    *,
    reference_type: str,
    reference_id: str,
    amount_idr: int,
    method: str,
    reason: str,
    notes: str = "",
    parent_reference_type: Optional[str] = None,
    parent_reference_id: Optional[str] = None,
    business_date: Optional[str] = None,
) -> dict:
    ref_type = (reference_type or "").strip().lower()
    if ref_type not in REFUND_REFERENCE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid refund reference_type")
    m = (method or "cash").strip().lower()
    if m not in REFUND_METHODS:
        raise HTTPException(status_code=400, detail="Invalid refund method")
    amt = int(amount_idr or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be positive")
    rsn = (reason or "").strip()
    if len(rsn) < 3:
        raise HTTPException(status_code=400, detail="Refund reason is required (min 3 characters)")

    now = _now_iso()
    biz = (business_date or now)[:10]
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": user["clinic_id"],
        "reference_type": ref_type,
        "reference_id": reference_id,
        "parent_reference_type": parent_reference_type,
        "parent_reference_id": parent_reference_id,
        "amount_idr": amt,
        "method": m,
        "reason": rsn,
        "notes": (notes or "").strip(),
        "status": "recorded",
        "business_date": biz,
        "created_by": user.get("id"),
        "created_by_name_snapshot": user.get("name") or "",
        "created_at": now,
    }
    await db.refunds.insert_one(doc)
    doc.pop("_id", None)
    return refund_to_api(doc)


async def aggregate_refunds_for_date(db, clinic_id: str, date_str: str) -> dict:
    """Sum recorded refunds for daily closing / accounting."""
    date_str = (date_str or "").strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {"total_idr": 0, "by_method": {}, "count": 0, "items": []}

    rows = await db.refunds.find(
        {
            "clinic_id": clinic_id,
            "status": "recorded",
            "business_date": date_str,
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    by_method: Dict[str, int] = {}
    total = 0
    for r in rows:
        amt = int(r.get("amount_idr") or 0)
        total += amt
        m = (r.get("method") or "other").strip().lower()
        by_method[m] = by_method.get(m, 0) + amt

    return {
        "total_idr": total,
        "by_method": by_method,
        "count": len(rows),
        "items": [refund_to_api(r) for r in rows],
    }


class RefundCreateIn(BaseModel):
    reference_type: str
    reference_id: str
    amount_idr: int = Field(..., gt=0)
    method: str = "cash"
    reason: str = Field(..., min_length=3)
    notes: str = ""
    parent_reference_type: Optional[str] = None
    parent_reference_id: Optional[str] = None
    business_date: Optional[str] = None


def register_refunds(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    audit,
    scope,
):
    def _can_view(user: dict) -> bool:
        return user_has_permission(user, "refunds.view") or user_has_permission(user, "accounting.view")

    def _can_create(user: dict) -> bool:
        return user_has_permission(user, "refunds.create")

    @api.get("/refunds")
    async def list_refunds(
        user: dict = Depends(get_current_user),
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        flt: Dict[str, Any] = {"clinic_id": user["clinic_id"], "status": "recorded"}
        if reference_type:
            flt["reference_type"] = reference_type.strip().lower()
        if reference_id:
            flt["reference_id"] = reference_id
        if date_from:
            flt.setdefault("business_date", {})["$gte"] = date_from[:10]
        if date_to:
            flt.setdefault("business_date", {})["$lte"] = date_to[:10]
        skip = (page - 1) * page_size
        rows = await db.refunds.find(flt, {"_id": 0}).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.refunds.count_documents(flt)
        return {
            "items": [refund_to_api(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    @api.post("/refunds")
    async def create_refund(payload: RefundCreateIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        doc = await create_refund_record(
            db,
            user,
            reference_type=payload.reference_type,
            reference_id=payload.reference_id,
            amount_idr=payload.amount_idr,
            method=payload.method,
            reason=payload.reason,
            notes=payload.notes,
            parent_reference_type=payload.parent_reference_type,
            parent_reference_id=payload.parent_reference_id,
            business_date=payload.business_date,
        )
        await audit(
            user,
            "refund_recorded",
            payload.reference_type,
            payload.reference_id,
            {"refund_id": doc["id"], "amount_idr": doc["amount_idr"]},
        )
        return doc
