"""Internal (FO) appointment scheduling rules for past date/time slots."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from public_booking_time import is_public_slot_in_past

PAST_POLICY_WARN_ALLOW = "warn_allow"
PAST_POLICY_ALLOW = "allow"
PAST_POLICY_BLOCK = "block"
PAST_POLICIES = frozenset({PAST_POLICY_WARN_ALLOW, PAST_POLICY_ALLOW, PAST_POLICY_BLOCK})


async def resolve_past_appointment_policy(db, clinic_id: str) -> str:
    from booking_conflicts import get_scheduling_settings

    settings = await get_scheduling_settings(db, clinic_id)
    policy = str(settings.get("past_appointment_policy") or PAST_POLICY_WARN_ALLOW).strip().lower()
    if policy not in PAST_POLICIES:
        return PAST_POLICY_WARN_ALLOW
    return policy


def is_internal_slot_in_past(clinic: dict, scheduled_at: str, now=None) -> bool:
    return is_public_slot_in_past(clinic, scheduled_at, now=now)


async def enforce_internal_past_booking_policy(
    db,
    user: dict,
    clinic_id: str,
    scheduled_at: str,
    *,
    past_booking_acknowledged: bool = False,
    booking_id: str = "",
    action: str = "create",
) -> None:
    """Apply clinic past-booking policy for internal create/update. Public booking uses separate validation."""
    clinic_doc = await db.clinics.find_one({"id": clinic_id}, {"_id": 0, "timezone": 1})
    if not is_internal_slot_in_past(clinic_doc or {}, scheduled_at):
        return

    policy = await resolve_past_appointment_policy(db, clinic_id)
    if policy == PAST_POLICY_BLOCK:
        raise HTTPException(
            status_code=400,
            detail="Cannot create or update appointments in the past",
        )
    if policy == PAST_POLICY_WARN_ALLOW and not past_booking_acknowledged:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "past_booking_warning",
                "message": "This appointment time is in the past.",
            },
        )

    from audit_log import log_internal_past_booking

    await log_internal_past_booking(
        db,
        user,
        booking_id or "",
        scheduled_at,
        action=action,
    )
