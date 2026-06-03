"""Patient wallet API — balance, adjustments, history, reports."""
from __future__ import annotations

import csv
import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from permissions import user_has_permission
from wallet_core import (
    aggregate_outstanding_wallet_liability,
    aggregate_wallet_report,
    credit_wallet,
    get_or_create_wallet,
    get_wallet_balance,
    redeem_gift_card_to_wallet,
    wallet_to_api,
    wallet_transaction_to_api,
)


class WalletAdjustIn(BaseModel):
    amount_idr: int = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=500)
    notes: str = ""


class GiftCardToWalletIn(BaseModel):
    patient_id: str = Field(..., min_length=1)
    amount_idr: Optional[int] = Field(None, gt=0)
    notes: str = ""


def register_patient_wallets(
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
        return user_has_permission(user, "wallet.view") or user_has_permission(user, "accounting.view")

    def _can_adjust(user: dict) -> bool:
        return user_has_permission(user, "wallet.adjust")

    def _can_export(user: dict) -> bool:
        return user_has_permission(user, "wallet.export") or user_has_permission(user, "accounting.view")

    @api.get("/patients/{patient_id}/wallet")
    async def get_patient_wallet(patient_id: str, user: dict = Depends(get_current_user)):
        await _require_products(user)
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1, "full_name": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        wallet = await get_or_create_wallet(db, user["clinic_id"], patient_id)
        return {
            "wallet": wallet_to_api(wallet),
            "patient": {"id": p["id"], "full_name": p.get("full_name")},
        }

    @api.get("/patients/{patient_id}/wallet/transactions")
    async def list_wallet_transactions(
        patient_id: str,
        user: dict = Depends(get_current_user),
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        await _require_products(user)
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        wallet = await db.patient_wallets.find_one(
            {"clinic_id": user["clinic_id"], "patient_id": patient_id},
            {"_id": 0, "id": 1},
        )
        if not wallet:
            return {"items": [], "total": 0, "page": page, "page_size": page_size}
        flt = {"clinic_id": user["clinic_id"], "wallet_id": wallet["id"]}
        skip = (page - 1) * page_size
        rows = await db.patient_wallet_transactions.find(flt, {"_id": 0}).sort(
            "created_at", -1,
        ).skip(skip).limit(page_size).to_list(page_size)
        total = await db.patient_wallet_transactions.count_documents(flt)
        return {
            "items": [wallet_transaction_to_api(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    @api.post("/patients/{patient_id}/wallet/adjust")
    async def adjust_wallet(
        patient_id: str,
        payload: WalletAdjustIn,
        user: dict = Depends(get_current_user),
    ):
        await _require_products(user)
        if not _can_adjust(user):
            raise HTTPException(status_code=403, detail="wallet.adjust permission is required")
        await assert_writeable(user)
        p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        _, tx = await credit_wallet(
            db,
            user,
            patient_id,
            payload.amount_idr,
            transaction_type="adjustment",
            reference_type="manual_adjustment",
            reference_id=str(uuid.uuid4()),
            notes=f"{payload.reason}. {payload.notes}".strip(),
        )
        await audit(
            user,
            "wallet_adjust",
            "patient_wallet",
            patient_id,
            {"amount_idr": payload.amount_idr, "transaction_id": tx["id"], "reason": payload.reason},
        )
        wallet = await get_or_create_wallet(db, user["clinic_id"], patient_id)
        return {"wallet": wallet_to_api(wallet), "transaction": wallet_transaction_to_api(tx)}

    @api.get("/wallet/balance")
    async def wallet_balance_lookup(
        user: dict = Depends(get_current_user),
        patient_id: str = Query(..., min_length=1),
    ):
        await _require_products(user)
        if not _can_view(user) and not user_has_permission(user, "wallet.use"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        bal = await get_wallet_balance(db, user["clinic_id"], patient_id)
        return {"patient_id": patient_id, "balance_idr": bal}

    @api.post("/gift-cards/{gift_card_id}/redeem-to-wallet")
    async def gift_card_redeem_to_wallet(
        gift_card_id: str,
        payload: GiftCardToWalletIn,
        user: dict = Depends(get_current_user),
    ):
        await _require_products(user)
        if not user_has_permission(user, "wallet.use"):
            raise HTTPException(status_code=403, detail="wallet.use permission is required")
        await assert_writeable(user)
        result = await redeem_gift_card_to_wallet(
            db,
            user,
            gift_card_id=gift_card_id,
            patient_id=payload.patient_id,
            amount_idr=payload.amount_idr,
        )
        await audit(
            user,
            "gift_card_to_wallet",
            "gift_card",
            gift_card_id,
            {"patient_id": payload.patient_id, "amount_idr": result["amount_idr"]},
        )
        wallet = await get_or_create_wallet(db, user["clinic_id"], payload.patient_id)
        return {**result, "wallet": wallet_to_api(wallet)}

    @api.get("/wallet/report")
    async def wallet_report(
        user: dict = Depends(get_current_user),
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        preset: Optional[str] = None,
    ):
        await _require_products(user)
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if preset and not date_from and not date_to:
            from reports_common import resolve_date_range
            start_iso, end_iso = resolve_date_range(preset=preset)
            date_from = start_iso[:10]
            date_to = end_iso[:10]
        return await aggregate_wallet_report(
            db,
            user["clinic_id"],
            date_from=date_from,
            date_to=date_to,
        )

    @api.get("/wallet/report/export")
    async def wallet_report_export(
        user: dict = Depends(get_current_user),
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        preset: Optional[str] = None,
    ):
        await _require_products(user)
        if not _can_export(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if preset and not date_from and not date_to:
            from reports_common import resolve_date_range
            start_iso, end_iso = resolve_date_range(preset=preset)
            date_from = start_iso[:10]
            date_to = end_iso[:10]
        report = await aggregate_wallet_report(
            db,
            user["clinic_id"],
            date_from=date_from,
            date_to=date_to,
        )
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Patient", "Phone", "Balance IDR"])
        for row in report.get("patient_balances") or []:
            w.writerow([row.get("patient_name"), row.get("patient_phone"), row.get("balance_idr")])
        w.writerow([])
        w.writerow(["Transaction ID", "Type", "Amount", "Balance After", "Reference", "Created"])
        for tx in report.get("transactions") or []:
            w.writerow([
                tx.get("id"),
                tx.get("transaction_type"),
                tx.get("amount_idr"),
                tx.get("balance_after"),
                f"{tx.get('reference_type')}:{tx.get('reference_id')}",
                tx.get("created_at"),
            ])
        content = buf.getvalue()
        return Response(
            content=content.encode("utf-8-sig"),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="wallet-report.csv"'},
        )

    @api.get("/wallet/summary")
    async def wallet_summary(user: dict = Depends(get_current_user)):
        await _require_products(user)
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return await aggregate_outstanding_wallet_liability(db, user["clinic_id"])
