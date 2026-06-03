"""Shared rules for void/cancel/refund against closed daily closings."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from correction_constants import CLOSING_LOCK_MESSAGE
from daily_closing import is_day_closed


async def assert_day_open_for_void(
    db,
    clinic_id: str,
    business_date: Optional[str],
    *,
    entity_label: str = "transaction",
) -> None:
    """Block void/cancel/edit when the business day is closed."""
    day = (business_date or "").strip()[:10]
    if not day or len(day) < 10:
        return
    if await is_day_closed(db, clinic_id, day):
        raise HTTPException(status_code=400, detail=CLOSING_LOCK_MESSAGE)


def active_payment_total(payments: list) -> int:
    return sum(
        int(p.get("amount_idr") or 0)
        for p in (payments or [])
        if not p.get("voided")
    )


def active_gift_card_payment_total(payments: list) -> int:
    return sum(
        int(p.get("amount_idr") or 0)
        for p in (payments or [])
        if not p.get("voided") and (p.get("method") or "").strip().lower() == "gift_card"
    )


def active_store_credit_payment_total(payments: list) -> int:
    return sum(
        int(p.get("amount_idr") or 0)
        for p in (payments or [])
        if not p.get("voided") and (p.get("method") or "").strip().lower() == "store_credit"
    )
