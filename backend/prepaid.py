"""Patient prepaid API routes."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from permissions import user_has_permission
from prepaid_core import (
    aggregate_outstanding_prepaid_liability,
    aggregate_prepaid_for_date,
    find_prepaid,
    find_prepaid_by_code,
    list_patient_prepaid,
    list_redeemable_for_patient,
    refund_prepaid,
    void_prepaid,
)
from prepaid_models import prepaid_list_row, prepaid_to_api


class PrepaidRefundIn(BaseModel):
    amount_idr: Optional[int] = None
    reason: str = Field(..., min_length=3, max_length=500)


class PrepaidVoidIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


def register_prepaid(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    audit,
    scope,
):
    async def _require_products(user: dict) -> None:
        await assert_feature(user, "products")

    def _can_view(user: dict) -> bool:
        return (
            user_has_permission(user, "prepaid.view")
            or user_has_permission(user, "accounting.view")
            or user_has_permission(user, "pos.view")
        )

    @api.get("/prepaid/summary")
    async def prepaid_summary(user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        return await aggregate_outstanding_prepaid_liability(db, user["clinic_id"])

    @api.get("/prepaid/report/daily")
    async def prepaid_daily_report(
        user: dict = Depends(get_current_user),
        date: str = Query(..., description="YYYY-MM-DD"),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        return await aggregate_prepaid_for_date(db, user["clinic_id"], date)

    @api.get("/prepaid/lookup")
    async def prepaid_lookup(
        user: dict = Depends(get_current_user),
        code: str = Query(..., min_length=3),
    ):
        if not _can_view(user) and not user_has_permission(user, "prepaid.redeem"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        doc = await find_prepaid_by_code(db, user["clinic_id"], code)
        if not doc:
            raise HTTPException(status_code=404, detail="Prepaid not found")
        reds = await db.prepaid_redemptions.find(
            {"clinic_id": user["clinic_id"], "prepaid_id": doc["id"], "reversed": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).limit(20).to_list(20)
        return {"prepaid": doc, "redemptions": reds}

    @api.get("/patients/{patient_id}/prepaid")
    async def patient_prepaid_list(patient_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        rows = await list_patient_prepaid(db, user["clinic_id"], patient_id)
        return [prepaid_list_row(r) for r in rows]

    @api.get("/patients/{patient_id}/prepaid/redeemable")
    async def patient_prepaid_redeemable(patient_id: str, user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "prepaid.redeem") and not user_has_permission(user, "billing.edit"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        return await list_redeemable_for_patient(db, user["clinic_id"], patient_id)

    @api.get("/prepaid/{prepaid_id}")
    async def prepaid_detail(prepaid_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        doc = await find_prepaid(db, user["clinic_id"], prepaid_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Prepaid not found")
        reds = await db.prepaid_redemptions.find(
            {"clinic_id": user["clinic_id"], "prepaid_id": prepaid_id},
            {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        return {"prepaid": prepaid_to_api(doc), "redemptions": reds}

    @api.post("/prepaid/{prepaid_id}/refund")
    async def prepaid_refund(
        prepaid_id: str,
        payload: PrepaidRefundIn,
        user: dict = Depends(get_current_user),
    ):
        await assert_writeable(user)
        await _require_products(user)
        updated = await refund_prepaid(
            db, user, prepaid_id, amount_idr=payload.amount_idr, reason=payload.reason,
        )
        await audit(user, "refund", "prepaid", prepaid_id, {"amount_idr": payload.amount_idr, "reason": payload.reason})
        return updated

    @api.post("/prepaid/{prepaid_id}/void")
    async def prepaid_void(
        prepaid_id: str,
        payload: PrepaidVoidIn,
        user: dict = Depends(get_current_user),
    ):
        await assert_writeable(user)
        await _require_products(user)
        updated = await void_prepaid(db, user, prepaid_id, reason=payload.reason)
        await audit(user, "void", "prepaid", prepaid_id, {"reason": payload.reason})
        return updated
