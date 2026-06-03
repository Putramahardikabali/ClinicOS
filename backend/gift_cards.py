"""Gift card API — list, lookup, summary, redemption history."""
from __future__ import annotations

import csv
import io
import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from gift_card_models import REDEEMABLE_STATUSES, gift_card_to_api, redemption_to_api
from gift_cards_core import (
    aggregate_outstanding_summary,
    find_gift_card,
    find_gift_card_by_code,
    gift_card_list_row,
    redeem_entitlement_gift_card,
)
from permissions import user_has_permission


class GiftCardCancelIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class GiftCardEntitlementRedeemIn(BaseModel):
    patient_id: str = Field(..., min_length=1)
    notes: str = Field("", max_length=500)
    reference_type: str = Field("entitlement", max_length=64)
    reference_id: Optional[str] = Field(None, max_length=128)


def register_gift_cards(
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
            user_has_permission(user, "gift_cards.view")
            or user_has_permission(user, "accounting.view")
            or user_has_permission(user, "pos.view")
        )

    def _can_cancel(user: dict) -> bool:
        return user_has_permission(user, "gift_cards.cancel")

    @api.get("/gift-cards/summary")
    async def gift_cards_summary(user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        return await aggregate_outstanding_summary(db, user["clinic_id"])

    @api.get("/gift-cards/lookup")
    async def gift_cards_lookup(
        user: dict = Depends(get_current_user),
        code: str = Query(..., min_length=3),
    ):
        if not _can_view(user) and not user_has_permission(user, "gift_cards.redeem"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        card = await find_gift_card_by_code(db, user["clinic_id"], code)
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        raw_redemptions = await db.gift_card_redemptions.find(
            {"clinic_id": user["clinic_id"], "gift_card_id": card["id"], "reversed": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).limit(20).to_list(20)
        return {
            "card": gift_card_to_api(card),
            "recent_redemptions": [redemption_to_api(r) for r in raw_redemptions],
        }

    @api.get("/gift-cards/booking-lookup")
    async def gift_cards_booking_lookup(
        user: dict = Depends(get_current_user),
        code: str = Query(..., min_length=3),
        booking_kind: Optional[str] = Query(None),
        patient_id: Optional[str] = Query(None),
    ):
        if not user_has_permission(user, "gift_cards.redeem"):
            raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")
        await _require_products(user)
        from gift_cards_booking import validate_gift_card_for_booking
        return await validate_gift_card_for_booking(
            db,
            user["clinic_id"],
            code,
            booking_kind=booking_kind,
            patient_id=patient_id,
        )

    @api.get("/gift-cards")
    async def list_gift_cards(
        user: dict = Depends(get_current_user),
        q: Optional[str] = None,
        tab: Optional[str] = Query(None, description="active|redeemed|expired|cancelled|all"),
        status: Optional[str] = None,
        gift_card_type: Optional[str] = None,
        recipient_name: Optional[str] = None,
        recipient_phone: Optional[str] = None,
        purchaser_name: Optional[str] = None,
        purchaser_phone: Optional[str] = None,
        issued_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
        issued_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
        expiry_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
        expiry_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=1, le=100),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        from gift_cards_filters import build_gift_card_list_filter

        flt = build_gift_card_list_filter(
            user["clinic_id"],
            tab=tab,
            status=status,
            gift_card_type=gift_card_type,
            q=q,
            recipient_name=recipient_name,
            recipient_phone=recipient_phone,
            purchaser_name=purchaser_name,
            purchaser_phone=purchaser_phone,
            issued_from=issued_from,
            issued_to=issued_to,
            expiry_from=expiry_from,
            expiry_to=expiry_to,
        )
        skip = (page - 1) * page_size
        rows = await db.gift_cards.find(flt, {"_id": 0}).sort("issued_at", -1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.gift_cards.count_documents(flt)
        return {
            "items": [gift_card_list_row(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "tab": (tab or "all").strip().lower(),
            "summary": await aggregate_outstanding_summary(db, user["clinic_id"]),
        }

    @api.get("/gift-cards/export")
    async def export_gift_cards(
        user: dict = Depends(get_current_user),
        q: Optional[str] = None,
        tab: Optional[str] = Query(None, description="active|redeemed|expired|cancelled|all"),
        status: Optional[str] = None,
        gift_card_type: Optional[str] = None,
        recipient_name: Optional[str] = None,
        recipient_phone: Optional[str] = None,
        purchaser_name: Optional[str] = None,
        purchaser_phone: Optional[str] = None,
        issued_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
        issued_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
        expiry_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
        expiry_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        from gift_cards_filters import build_gift_card_list_filter

        flt = build_gift_card_list_filter(
            user["clinic_id"],
            tab=tab,
            status=status,
            gift_card_type=gift_card_type,
            q=q,
            recipient_name=recipient_name,
            recipient_phone=recipient_phone,
            purchaser_name=purchaser_name,
            purchaser_phone=purchaser_phone,
            issued_from=issued_from,
            issued_to=issued_to,
            expiry_from=expiry_from,
            expiry_to=expiry_to,
        )
        rows = await db.gift_cards.find(flt, {"_id": 0}).sort("issued_at", -1).to_list(5000)
        buf = io.StringIO()
        w = csv.DictWriter(
            buf,
            fieldnames=[
                "code", "status", "gift_card_type", "original_value", "balance_value",
                "recipient_name", "purchaser_name", "issued_at", "issued_sale_id", "expiry_date",
            ],
        )
        w.writeheader()
        for r in rows:
            api_row = gift_card_to_api(r)
            w.writerow({
                "code": api_row.get("code"),
                "status": api_row.get("status"),
                "gift_card_type": api_row.get("gift_card_type"),
                "original_value": api_row.get("original_value"),
                "balance_value": api_row.get("balance_value"),
                "recipient_name": api_row.get("recipient_name"),
                "purchaser_name": api_row.get("purchaser_name"),
                "issued_at": api_row.get("issued_at"),
                "issued_sale_id": api_row.get("issued_sale_id"),
                "expiry_date": api_row.get("expiry_date"),
            })
        return Response(
            content=buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="gift-cards.csv"'},
        )

    @api.get("/gift-cards/{gift_card_id}")
    async def get_gift_card(gift_card_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        card = await find_gift_card(db, user["clinic_id"], gift_card_id)
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        raw_redemptions = await db.gift_card_redemptions.find(
            {"clinic_id": user["clinic_id"], "gift_card_id": gift_card_id},
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        out = gift_card_to_api(card)
        sale_id = out.get("issued_sale_id") or out.get("pos_sale_id")
        if sale_id:
            sale = await db.pos_sales.find_one(
                {"clinic_id": user["clinic_id"], "id": sale_id},
                {"_id": 0, "sale_number": 1, "paid_at": 1},
            )
            if sale:
                out["issued_sale_number"] = sale.get("sale_number")
                out["issued_sale_paid_at"] = sale.get("paid_at")
        rb = out.get("reserved_booking_id")
        if rb:
            bk = await db.bookings.find_one(
                {"clinic_id": user["clinic_id"], "id": rb},
                {"_id": 0, "id": 1, "scheduled_at": 1, "treatment": 1, "patient_name": 1},
            )
            if bk:
                out["reserved_booking"] = bk
        return {
            **out,
            "redemptions": [redemption_to_api(r) for r in raw_redemptions],
        }

    @api.post("/gift-cards/{gift_card_id}/release-reservation")
    async def release_gift_card_reservation_endpoint(
        gift_card_id: str,
        user: dict = Depends(get_current_user),
    ):
        """Manager/FO: release a reserved entitlement gift card (e.g. after cancelled booking)."""
        from permissions import user_has_permission
        role = (user.get("role") or "").strip().lower()
        if not user_has_permission(user, "gift_cards.redeem"):
            raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")
        if role not in ("owner", "manager", "fo", "front_office"):
            raise HTTPException(status_code=403, detail="Only front office or managers can release reservations")
        await _require_products(user)
        await assert_writeable(user)
        card = await find_gift_card(db, user["clinic_id"], gift_card_id)
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        if (card.get("status") or "") != "reserved":
            raise HTTPException(status_code=400, detail="Gift card is not reserved")
        from gift_cards_booking import release_gift_card_reservation
        ok = await release_gift_card_reservation(
            db,
            user,
            gift_card_id=gift_card_id,
            reason="manual_release",
        )
        if not ok:
            raise HTTPException(status_code=400, detail="Could not release reservation")
        await audit(user, "release_reservation", "gift_card", gift_card_id, {})
        updated = await find_gift_card(db, user["clinic_id"], gift_card_id)
        return gift_card_to_api(updated)

    @api.post("/gift-cards/{gift_card_id}/redeem-entitlement")
    async def redeem_entitlement(
        gift_card_id: str,
        payload: GiftCardEntitlementRedeemIn = Body(...),
        user: dict = Depends(get_current_user),
    ):
        if not user_has_permission(user, "gift_cards.redeem"):
            raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")
        await _require_products(user)
        await assert_writeable(user)
        red = await redeem_entitlement_gift_card(
            db,
            clinic_id=user["clinic_id"],
            user=user,
            gift_card_id=gift_card_id,
            patient_id=payload.patient_id,
            notes=payload.notes,
            reference_type=payload.reference_type,
            reference_id=payload.reference_id,
        )
        await audit(
            user,
            "redeem_entitlement",
            "gift_card",
            gift_card_id,
            {"patient_id": payload.patient_id, "redemption_id": red.get("id")},
        )
        return red

    @api.post("/gift-cards/{gift_card_id}/cancel")
    async def cancel_gift_card(
        gift_card_id: str,
        payload: GiftCardCancelIn = Body(...),
        user: dict = Depends(get_current_user),
    ):
        if not _can_cancel(user):
            raise HTTPException(status_code=403, detail="gift_cards.cancel permission is required")
        await _require_products(user)
        await assert_writeable(user)
        card = await find_gift_card(db, user["clinic_id"], gift_card_id)
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        stored_status = (card.get("status") or "").strip().lower()
        if stored_status == "cancelled":
            return gift_card_to_api(card)
        if stored_status == "reserved":
            raise HTTPException(
                status_code=400,
                detail="Release the booking reservation before cancelling this gift card",
            )
        if stored_status not in REDEEMABLE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Only active or partially redeemed gift cards can be cancelled",
            )
        reason = payload.reason.strip()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        cancel_set: Dict[str, Any] = {
            "status": "cancelled",
            "balance_value": 0,
            "remaining_redemptions": 0,
            "cancelled_at": now,
            "cancelled_reason": reason,
            "updated_at": now,
        }
        await db.gift_cards.update_one(
            {"id": gift_card_id},
            {"$set": cancel_set},
        )
        await audit(
            user,
            "cancel",
            "gift_card",
            gift_card_id,
            {"code": card.get("code"), "reason": reason},
        )
        updated = await find_gift_card(db, user["clinic_id"], gift_card_id)
        return gift_card_to_api(updated)
