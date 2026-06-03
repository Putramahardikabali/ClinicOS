"""Centralized subscription / trial expiry gates for clinic operations and public booking."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException

from saas import (
    clinic_access_mode,
    clinic_is_readonly,
    clinic_login_blocked,
    iso,
    now_utc,
    refresh_subscription_state,
)

OPERATIONAL_BLOCKED_DETAIL = (
    "Your subscription has expired. Please renew to continue using ClinicOS."
)

PUBLIC_BOOKING_UNAVAILABLE_MSG = (
    "Online booking is temporarily unavailable. Please contact the clinic directly."
)


def public_booking_blocked_reason(clinic: dict) -> Optional[str]:
    """Return a user-facing message if public online booking must be disabled, else None."""
    c = dict(clinic)
    c, _ = refresh_subscription_state(c)
    sub = c.get("subscription") or {}
    status = sub.get("status", "trial")
    if status not in ("trial", "active"):
        return PUBLIC_BOOKING_UNAVAILABLE_MSG
    if clinic_access_mode(c) != "full":
        return PUBLIC_BOOKING_UNAVAILABLE_MSG
    if clinic_is_readonly(c):
        return PUBLIC_BOOKING_UNAVAILABLE_MSG
    return None


async def load_clinic_subscription(db, clinic_id: str) -> Optional[dict]:
    c = await db.clinics.find_one({"id": clinic_id}, {"_id": 0})
    if not c:
        return None
    prev_sub = dict(c.get("subscription") or {})
    c, changed = refresh_subscription_state(c)
    if changed:
        await db.clinics.update_one({"id": c["id"]}, {"$set": {"subscription": c["subscription"]}})
        await maybe_notify_trial_expired_platform(db, c, previous_sub=prev_sub)
    return c


async def resolve_clinic_for_public_booking(db, clinic: dict) -> Tuple[dict, Optional[str]]:
    """Refresh subscription state and return (clinic, block_message)."""
    c = dict(clinic)
    prev_sub = dict(c.get("subscription") or {})
    c, changed = refresh_subscription_state(c)
    if changed:
        await db.clinics.update_one({"id": c["id"]}, {"$set": {"subscription": c["subscription"]}})
        await maybe_notify_trial_expired_platform(db, c, previous_sub=prev_sub)
    return c, public_booking_blocked_reason(c)


async def assert_operational_access(user: dict, db) -> None:
    """Block clinic operational APIs when subscription is not in full access mode."""
    if user.get("platform_admin"):
        return
    cid = user.get("clinic_id")
    if not cid:
        return
    c = await load_clinic_subscription(db, cid)
    if not c:
        return
    mode = clinic_access_mode(c)
    if mode == "full":
        return
    blocked_login = clinic_login_blocked(c)
    detail = blocked_login or OPERATIONAL_BLOCKED_DETAIL
    raise HTTPException(status_code=402, detail=detail)


async def maybe_notify_trial_expired_platform(
    db,
    clinic: dict,
    *,
    previous_sub: Optional[Dict[str, Any]] = None,
) -> None:
    """Create a single Super Admin notification when a clinic trial/subscription becomes expired."""
    from platform_ops import create_platform_notification, owner_account_info

    sub = clinic.get("subscription") or {}
    if sub.get("status") != "expired":
        return
    if clinic.get("trial_expired_platform_notified"):
        return

    prev = previous_sub or {}
    was_trial = prev.get("status") == "trial" or sub.get("plan") == "trial" or bool(sub.get("trial_end"))
    if not was_trial and prev.get("status") not in ("trial", "active", "past_due", None):
        return

    cid = clinic["id"]
    cname = clinic.get("name") or "Clinic"
    owner = await owner_account_info(db, cid)
    owner_email = (owner or {}).get("email") or clinic.get("owner_email") or ""

    expired_at = sub.get("trial_end") or sub.get("past_due_until") or iso(now_utc())

    await create_platform_notification(
        db,
        ntype="trial_expired",
        title=f"Trial expired: {cname}",
        body=f"Owner: {owner_email or 'unknown'} · Expired {expired_at[:10] if expired_at else '—'}",
        clinic_id=cid,
        clinic_name=cname,
        link=f"/superadmin/clinics/{cid}",
        meta={
            "owner_email": owner_email,
            "expired_at": expired_at,
            "plan": sub.get("plan"),
        },
    )
    await db.clinics.update_one({"id": cid}, {"$set": {"trial_expired_platform_notified": True}})
