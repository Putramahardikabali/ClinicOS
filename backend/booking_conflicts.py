"""Staff schedule conflict detection and internal overlap override policy."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from permissions import user_has_permission

SLOT_OCCUPYING_STATUSES = ["booked", "confirmed", "checked_in", "blocked", "pending_payment"]
CONFLICT_POLICIES = ("strict", "warn_allow", "allow_silent")


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def _booking_end_min(scheduled_at: str, duration_min: int) -> int:
    dt = _parse_iso(scheduled_at)
    return dt.hour * 60 + dt.minute + int(duration_min or 30)


def _booking_start_min(scheduled_at: str) -> int:
    dt = _parse_iso(scheduled_at)
    return dt.hour * 60 + dt.minute


def _ranges_overlap(s_start: int, s_end: int, b_start: int, b_end: int) -> bool:
    return not (s_end <= b_start or s_start >= b_end)


def _staff_ids_from_booking(doc: dict) -> List[str]:
    ids: List[str] = []
    if doc.get("performer_id"):
        ids.append(doc["performer_id"])
    for pe in doc.get("performers") or []:
        sid = pe.get("staff_id")
        if sid and sid not in ids:
            ids.append(sid)
    return ids


def _conflict_summary(doc: dict) -> dict:
    start = _parse_iso(doc["scheduled_at"])
    dur = int(doc.get("duration_min") or 30)
    end = start + timedelta(minutes=dur)
    blocked = doc.get("status") == "blocked" or doc.get("booking_type") == "block"
    return {
        "id": doc.get("id"),
        "patient_name": doc.get("patient_name") or "",
        "treatment": doc.get("treatment") or "",
        "status": doc.get("status") or "",
        "scheduled_at": doc.get("scheduled_at"),
        "duration_min": dur,
        "scheduled_end_at": end.isoformat(),
        "is_block": blocked,
        "performer_id": doc.get("performer_id"),
    }


async def find_staff_slot_conflicts(
    db,
    clinic_id: str,
    staff_id: str,
    scheduled_at: str,
    duration_min: int,
    *,
    exclude_booking_id: Optional[str] = None,
) -> List[dict]:
    if not staff_id:
        return []
    try:
        sched = _parse_iso(scheduled_at)
    except Exception:
        return []
    s_start = _booking_start_min(scheduled_at)
    s_end = _booking_end_min(scheduled_at, duration_min)
    day_str = sched.strftime("%Y-%m-%d")
    existing = await db.bookings.find(
        {
            "clinic_id": clinic_id,
            "scheduled_at": {"$gte": f"{day_str}T00:00:00", "$lte": f"{day_str}T23:59:59"},
            "status": {"$in": SLOT_OCCUPYING_STATUSES},
        },
        {
            "_id": 0,
            "id": 1,
            "scheduled_at": 1,
            "duration_min": 1,
            "performer_id": 1,
            "performers": 1,
            "patient_name": 1,
            "treatment": 1,
            "status": 1,
            "booking_type": 1,
        },
    ).to_list(500)

    conflicts: List[dict] = []
    seen: set = set()
    for b in existing:
        if exclude_booking_id and b.get("id") == exclude_booking_id:
            continue
        if staff_id not in _staff_ids_from_booking(b):
            continue
        bs = _booking_start_min(b["scheduled_at"])
        be = _booking_end_min(b["scheduled_at"], int(b.get("duration_min") or 30))
        if not _ranges_overlap(s_start, s_end, bs, be):
            continue
        bid = b.get("id")
        if bid in seen:
            continue
        seen.add(bid)
        conflicts.append(_conflict_summary(b))
    return conflicts


async def get_scheduling_settings(db, clinic_id: str) -> dict:
    s = await db.settings.find_one({"clinic_id": clinic_id}, {"_id": 0, "scheduling": 1})
    raw = (s or {}).get("scheduling") or {}
    policy = str(raw.get("conflict_policy") or "warn_allow").strip().lower()
    if policy not in CONFLICT_POLICIES:
        policy = "warn_allow"
    return {
        "conflict_policy": policy,
        "fo_can_override_conflict": raw.get("fo_can_override_conflict", True) is not False,
    }


def user_can_override_conflict(user: dict, settings: dict) -> bool:
    role = user.get("role")
    if role in ("super_admin", "manager"):
        return True
    if user_has_permission(user, "appointments.override_conflict"):
        return True
    if role == "fo" and settings.get("fo_can_override_conflict"):
        return user_has_permission(user, "appointments.create") or user_has_permission(user, "appointments.edit")
    return False


def conflict_http_detail(conflicts: List[dict], message: str = "Schedule conflict") -> dict:
    return {
        "code": "schedule_conflict",
        "message": message,
        "conflicts": conflicts,
    }


async def enforce_staff_schedule_conflicts(
    db,
    user: dict,
    clinic_id: str,
    staff_ids: List[str],
    scheduled_at: str,
    duration_min: int,
    *,
    overlap_override: bool = False,
    overlap_override_reason: Optional[str] = None,
    exclude_booking_id: Optional[str] = None,
) -> Optional[List[dict]]:
    """
    Raise HTTP 409 on unresolved conflicts, or return conflict list when override applied.
    """
    settings = await get_scheduling_settings(db, clinic_id)
    policy = settings["conflict_policy"]

    all_conflicts: List[dict] = []
    for sid in staff_ids:
        found = await find_staff_slot_conflicts(
            db, clinic_id, sid, scheduled_at, duration_min, exclude_booking_id=exclude_booking_id,
        )
        for c in found:
            if not any(x.get("id") == c.get("id") for x in all_conflicts):
                all_conflicts.append(c)

    if not all_conflicts:
        return None

    if policy == "allow_silent":
        return None

    if overlap_override:
        if not user_can_override_conflict(user, settings):
            raise HTTPException(status_code=403, detail="Not allowed to override schedule conflicts")
        return all_conflicts

    if policy == "strict":
        raise HTTPException(
            status_code=409,
            detail=conflict_http_detail(
                all_conflicts,
                "This staff member already has another appointment during this time",
            ),
        )

    # warn_allow — require explicit override
    raise HTTPException(
        status_code=409,
        detail=conflict_http_detail(
            all_conflicts,
            "This staff already has another appointment during this time",
        ),
    )


def apply_overlap_override_fields(doc: dict, user: dict, conflicts: Optional[List[dict]], reason: Optional[str]) -> None:
    if not conflicts:
        return
    from datetime import datetime, timezone

    doc["overlap_override"] = True
    doc["overlap_override_by"] = user.get("id")
    doc["overlap_override_at"] = datetime.now(timezone.utc).isoformat()
    if reason:
        doc["overlap_override_reason"] = reason.strip()
    doc["overlap_conflict_ids"] = [c.get("id") for c in conflicts if c.get("id")]
