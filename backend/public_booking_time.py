"""Clinic-timezone helpers for public online booking availability and validation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DEFAULT_CLINIC_TZ = "Asia/Makassar"
PAST_SLOT_MSG = "This time slot is no longer available. Please choose a new time."
PAST_DATE_MSG = "This date has passed. Please choose a future date."

# Fallback when tzdata is unavailable (e.g. some Windows Python installs).
_TZ_OFFSETS = {
    "Asia/Makassar": timedelta(hours=8),
    "Asia/Ujung_Pandang": timedelta(hours=8),
    "Asia/Jakarta": timedelta(hours=7),
    "Asia/Jayapura": timedelta(hours=9),
}


def _resolve_tz(tz_name: str):
    try:
        if ZoneInfo:
            return ZoneInfo(tz_name)
    except Exception:
        pass
    return timezone(_TZ_OFFSETS.get(tz_name, timedelta(hours=8)))


def clinic_timezone(clinic: dict) -> str:
    return clinic.get("timezone") or DEFAULT_CLINIC_TZ


def clinic_local_now(clinic: dict, now: Optional[datetime] = None) -> datetime:
    tz = _resolve_tz(clinic_timezone(clinic))
    base = now if now is not None else datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base.astimezone(tz)


def clinic_today_str(clinic: dict, now: Optional[datetime] = None) -> str:
    return clinic_local_now(clinic, now).strftime("%Y-%m-%d")


def parse_public_scheduled_at(clinic: dict, scheduled_at: str) -> datetime:
    """Parse public booking datetime as clinic-local wall time when naive."""
    s = (scheduled_at or "").strip()
    if not s:
        raise ValueError("empty scheduled_at")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=_resolve_tz(clinic_timezone(clinic)))


def is_public_date_in_past(clinic: dict, date_str: str, now: Optional[datetime] = None) -> bool:
    return date_str < clinic_today_str(clinic, now)


def is_public_slot_in_past(clinic: dict, scheduled_at: str, now: Optional[datetime] = None) -> bool:
    try:
        scheduled = parse_public_scheduled_at(clinic, scheduled_at)
        local_now = clinic_local_now(clinic, now).replace(second=0, microsecond=0)
        return scheduled.replace(second=0, microsecond=0) < local_now
    except Exception:
        return True


def assert_public_scheduled_at_valid(clinic: dict, scheduled_at: str, now: Optional[datetime] = None) -> datetime:
    try:
        scheduled = parse_public_scheduled_at(clinic, scheduled_at)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at")
    if is_public_slot_in_past(clinic, scheduled_at, now=now):
        raise HTTPException(status_code=400, detail=PAST_SLOT_MSG)
    return scheduled
