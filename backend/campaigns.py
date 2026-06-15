"""Campaign management API — promotions applied at invoice time."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from campaign_io import (
    apply_campaign_to_invoice_subtotal,
    build_campaign_doc,
    campaign_applies_to_summary,
    campaign_is_applicable_to_items,
    campaign_status,
    clinic_today_str,
    coupon_to_campaign,
    eligible_subtotal_for_campaign,
    normalize_applies_to,
    normalize_campaign_code,
    validate_campaign_for_invoice,
    validate_campaign_scope,
)
from permissions import user_has_permission


class CampaignIn(BaseModel):
    name: str
    code: Optional[str] = ""
    description: Optional[str] = ""
    active: bool = True
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    discount_type: str = "percent"
    discount_value: int = 0
    max_discount_idr: Optional[int] = None
    min_invoice_amount_idr: int = 0
    applies_to: str = "all"
    treatment_ids: Optional[List[str]] = None
    category_keys: Optional[List[str]] = None
    package_ids: Optional[List[str]] = None
    eligible_treatment_ids: Optional[List[str]] = None
    eligible_treatment_category_ids: Optional[List[str]] = None
    eligible_package_ids: Optional[List[str]] = None
    max_uses_total: Optional[int] = None
    max_uses_per_patient: Optional[int] = None
    allowed_days_of_week: Optional[List[str]] = None
    allowed_time_start: Optional[str] = None
    allowed_time_end: Optional[str] = None
    new_patients_only: bool = False
    returning_patients_only: bool = False
    stackable_with_package: bool = False
    stackable_with_gift_card: bool = False
    stackable_with_other_discounts: bool = False


class CampaignUpdateIn(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[int] = None
    max_discount_idr: Optional[int] = None
    min_invoice_amount_idr: Optional[int] = None
    applies_to: Optional[str] = None
    treatment_ids: Optional[List[str]] = None
    category_keys: Optional[List[str]] = None
    package_ids: Optional[List[str]] = None
    eligible_treatment_ids: Optional[List[str]] = None
    eligible_treatment_category_ids: Optional[List[str]] = None
    eligible_package_ids: Optional[List[str]] = None
    max_uses_total: Optional[int] = None
    max_uses_per_patient: Optional[int] = None
    allowed_days_of_week: Optional[List[str]] = None
    allowed_time_start: Optional[str] = None
    allowed_time_end: Optional[str] = None
    new_patients_only: Optional[bool] = None
    returning_patients_only: Optional[bool] = None
    stackable_with_package: Optional[bool] = None
    stackable_with_gift_card: Optional[bool] = None
    stackable_with_other_discounts: Optional[bool] = None


async def enrich_invoice_items_for_campaign(db, clinic_id: str, items: List[dict]) -> List[dict]:
    """Attach treatment category to invoice lines for category-scoped campaigns."""
    enriched: List[dict] = []
    for it in items or []:
        row = dict(it)
        if (
            not row.get("category")
            and row.get("catalog_id")
            and (row.get("item_type") or "").lower() in ("treatment", "custom")
        ):
            tdoc = await db.treatments.find_one(
                {"clinic_id": clinic_id, "id": row["catalog_id"]},
                {"_id": 0, "category": 1},
            )
            if not tdoc:
                tdoc = await db.treatments.find_one(
                    {"clinic_id": clinic_id, "key": row["catalog_id"]},
                    {"_id": 0, "category": 1},
                )
            if not tdoc and row.get("name"):
                tdoc = await db.treatments.find_one(
                    {"clinic_id": clinic_id, "name": row["name"]},
                    {"_id": 0, "category": 1, "id": 1},
                )
                if tdoc and not row.get("catalog_id"):
                    row["catalog_id"] = tdoc.get("id")
            if tdoc:
                row["category"] = tdoc.get("category")
        enriched.append(row)
    return enriched


async def prepare_campaign_for_invoice(db, user: dict, invoice: dict, campaign_id: str, invoice_date: str):
    """Validate campaign eligibility and return (campaign, pricing dict)."""
    cid = user["clinic_id"]
    clinic = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1}) or {}
    campaign = await db.campaigns.find_one({"clinic_id": cid, "id": campaign_id, "active": True}, {"_id": 0})
    if not campaign:
        raise HTTPException(status_code=400, detail="Campaign not found or inactive")
    items = await enrich_invoice_items_for_campaign(db, cid, invoice.get("items") or [])
    subtotal = sum(
        int(round(float(it.get("quantity") or 1) * int(it.get("unit_price_idr") or 0)))
        for it in items if it.get("paid_by") != "package"
    )
    eligible = eligible_subtotal_for_campaign(campaign, items)
    patient_id = invoice.get("patient_id")
    patient_is_new = None
    if patient_id:
        paid_count = await db.invoices.count_documents({
            "clinic_id": cid,
            "patient_id": patient_id,
            "payment_status": "paid",
            "id": {"$ne": invoice.get("id")},
        })
        patient_is_new = paid_count == 0
    uses_for_patient = 0
    uses_total = 0
    if patient_id:
        uses_for_patient = await db.invoices.count_documents({
            "clinic_id": cid,
            "patient_id": patient_id,
            "campaign_id": campaign_id,
            "payment_status": "paid",
            "id": {"$ne": invoice.get("id")},
        })
    uses_total = await db.invoices.count_documents({
        "clinic_id": cid,
        "campaign_id": campaign_id,
        "payment_status": "paid",
        "id": {"$ne": invoice.get("id")},
    })
    campaign_for_check = {**campaign, "uses_count": uses_total}
    has_package = any(it.get("paid_by") == "package" for it in items)
    has_gc = int(invoice.get("gift_card_payment_total_idr") or 0) > 0
    err = validate_campaign_for_invoice(
        campaign_for_check,
        clinic=clinic,
        invoice_date=invoice_date,
        subtotal_idr=subtotal,
        eligible_subtotal_idr=eligible,
        items=items,
        patient_id=patient_id,
        patient_is_new=patient_is_new,
        uses_for_patient=uses_for_patient,
        has_package_payment=has_package,
        has_gift_card_payment=has_gc,
        has_other_discount=False,
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    pricing = apply_campaign_to_invoice_subtotal(campaign, eligible)
    return campaign, pricing


def register_campaigns(api: APIRouter, db, get_current_user, audit, scope):
    def _can_manage(user: dict) -> bool:
        return user_has_permission(user, "campaigns.manage") or user_has_permission(user, "coupons.manage")

    def _can_view(user: dict) -> bool:
        return (
            _can_manage(user)
            or user_has_permission(user, "campaigns.view")
            or user_has_permission(user, "billing.edit")
        )

    async def _ensure_migrated(clinic_id: str) -> None:
        count = await db.campaigns.count_documents({"clinic_id": clinic_id})
        if count > 0:
            return
        coupons = await db.coupons.find({"clinic_id": clinic_id}, {"_id": 0}).to_list(500)
        for c in coupons:
            doc = coupon_to_campaign(c)
            await db.campaigns.insert_one(doc)

    def _with_status(campaign: dict, clinic: dict, ref_date: Optional[str] = None) -> dict:
        row = dict(campaign)
        row["status"] = campaign_status(campaign, clinic, ref_date)
        row["applies_to"] = normalize_applies_to(row.get("applies_to"))
        row["applies_to_summary"] = campaign_applies_to_summary(row)
        return row

    def _payload_to_row(payload: dict) -> dict:
        data = dict(payload)
        if data.get("eligible_treatment_ids") is None and data.get("treatment_ids") is not None:
            data["eligible_treatment_ids"] = data["treatment_ids"]
        if data.get("eligible_treatment_category_ids") is None and data.get("category_keys") is not None:
            data["eligible_treatment_category_ids"] = data["category_keys"]
        if data.get("eligible_package_ids") is None and data.get("package_ids") is not None:
            data["eligible_package_ids"] = data["package_ids"]
        return data

    @api.get("/campaigns")
    async def list_campaigns(
        user: dict = Depends(get_current_user),
        active_only: bool = False,
        date: Optional[str] = None,
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        cid = user["clinic_id"]
        clinic = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1}) or {}
        await _ensure_migrated(cid)
        flt: Dict[str, Any] = {"clinic_id": cid}
        if active_only:
            flt["active"] = True
        rows = await db.campaigns.find(flt, {"_id": 0}).sort("name", 1).to_list(500)
        ref = date or clinic_today_str(clinic)
        out = [_with_status(r, clinic, ref) for r in rows]
        if active_only:
            out = [r for r in out if r.get("status") == "active"]
        return out

    @api.get("/campaigns/active")
    async def list_active_campaigns(
        user: dict = Depends(get_current_user),
        date: Optional[str] = None,
        invoice_id: Optional[str] = None,
    ):
        if not user_has_permission(user, "billing.edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        cid = user["clinic_id"]
        clinic = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1}) or {}
        await _ensure_migrated(cid)
        ref_date = date or clinic_today_str(clinic)
        rows = await db.campaigns.find({"clinic_id": cid, "active": True}, {"_id": 0}).sort("name", 1).to_list(500)
        active_rows = [r for r in rows if campaign_status(r, clinic, ref_date) == "active"]
        invoice_items: List[dict] = []
        if invoice_id:
            inv = await db.invoices.find_one(scope(user, {"id": invoice_id}), {"_id": 0, "items": 1})
            if inv:
                invoice_items = await enrich_invoice_items_for_campaign(db, cid, inv.get("items") or [])
        out = []
        for r in active_rows:
            row = _with_status(r, clinic, ref_date)
            if invoice_items:
                if not campaign_is_applicable_to_items(r, invoice_items):
                    continue
                row["eligible_subtotal_idr"] = eligible_subtotal_for_campaign(r, invoice_items)
            out.append(row)
        return out

    @api.post("/campaigns")
    async def create_campaign(payload: CampaignIn, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        cid = user["clinic_id"]
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Campaign name is required")
        body = _payload_to_row(payload.model_dump())
        scope_err = validate_campaign_scope(body)
        if scope_err:
            raise HTTPException(status_code=400, detail=scope_err)
        code = normalize_campaign_code(payload.code or "")
        if code:
            existing = await db.campaigns.find_one({"clinic_id": cid, "code": code}, {"_id": 0, "id": 1})
            if existing:
                raise HTTPException(status_code=409, detail="Campaign code already exists")
        doc = build_campaign_doc(body, cid, user["id"])
        await db.campaigns.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "campaign", doc["id"], {"name": doc["name"]})
        return doc

    @api.put("/campaigns/{campaign_id}")
    async def update_campaign(campaign_id: str, payload: CampaignUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        existing = await db.campaigns.find_one(scope(user, {"id": campaign_id}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Campaign not found")
        upd = payload.model_dump(exclude_none=True)
        if "code" in upd:
            upd["code"] = normalize_campaign_code(upd["code"] or "") or None
        merged = _payload_to_row({**existing, **upd})
        scope_err = validate_campaign_scope(merged)
        if scope_err:
            raise HTTPException(status_code=400, detail=scope_err)
        doc = build_campaign_doc(merged, user["clinic_id"], user["id"], existing=existing)
        await db.campaigns.update_one(scope(user, {"id": campaign_id}), {"$set": doc})
        await audit(user, "update", "campaign", campaign_id, upd)
        return await db.campaigns.find_one(scope(user, {"id": campaign_id}), {"_id": 0})

    @api.delete("/campaigns/{campaign_id}")
    async def delete_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        r = await db.campaigns.delete_one(scope(user, {"id": campaign_id}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Campaign not found")
        await audit(user, "delete", "campaign", campaign_id)
        return {"ok": True}
