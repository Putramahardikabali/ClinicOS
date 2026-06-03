"""Weekly staff schedules and date overrides (no clinic-hours fallback)."""
from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_LABELS = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}

OFF_OVERRIDE_STATUSES = frozenset({"off", "sick_leave", "annual_leave", "training"})
WORKING_OVERRIDE_STATUS = "working"
BLOCKED_OVERRIDE_STATUS = "blocked_time"
VALID_OVERRIDE_STATUSES = OFF_OVERRIDE_STATUSES | {WORKING_OVERRIDE_STATUS, BLOCKED_OVERRIDE_STATUS}

APPLY_SINGLE = "single"
APPLY_WEEKDAY_IN_MONTH = "weekday_in_month"
APPLY_DATE_RANGE = "date_range"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def day_key_from_date(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return DAY_KEYS[d.weekday()]


def _day_key_from_dt(dt: datetime) -> str:
    return DAY_KEYS[dt.weekday()] if dt.weekday() < 6 else "sun"


def hhmm_to_minutes(s: Optional[str]) -> Optional[int]:
    if not s or ":" not in str(s):
        return None
    parts = str(s).strip().split(":")
    try:
        h, m = int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return None
    if h < 0 or h > 23 or m < 0 or m > 59:
        return None
    return h * 60 + m


def _parse_working_times(is_working: bool, start: str, end: str) -> Optional[Tuple[int, int]]:
    if not is_working:
        return None
    o = hhmm_to_minutes(start)
    c = hhmm_to_minutes(end)
    if o is None or c is None or o >= c:
        return None
    return o, c


def _validate_times(is_working: bool, start: str, end: str, label: str) -> Tuple[int, int]:
    parsed = _parse_working_times(is_working, start, end)
    if is_working and parsed is None:
        raise HTTPException(status_code=400, detail=f"{label}: start and end time required when working")
    return parsed or (0, 0)


def _break_ranges(
    work_open: int,
    work_close: int,
    break_start: Optional[str],
    break_end: Optional[str],
) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]]]:
    """Return (work_windows, unavailable_ranges) including break as blocked."""
    block_ranges: List[Tuple[int, int]] = []
    bs = hhmm_to_minutes(break_start or "")
    be = hhmm_to_minutes(break_end or "")
    if bs is not None and be is not None and bs < be:
        if work_open <= bs and be <= work_close:
            block_ranges.append((bs, be))
            windows = []
            if work_open < bs:
                windows.append((work_open, bs))
            if be < work_close:
                windows.append((be, work_close))
            return windows, block_ranges
    return [(work_open, work_close)], block_ranges


def slot_fits(
    work_windows: List[Tuple[int, int]],
    block_ranges: List[Tuple[int, int]],
    s_start: int,
    s_end: int,
) -> bool:
    if not work_windows:
        return False
    if not any(w[0] <= s_start and s_end <= w[1] for w in work_windows):
        return False
    for b0, b1 in block_ranges:
        if s_end > b0 and s_start < b1:
            return False
    return True


class WeeklyDayIn(BaseModel):
    day_of_week: str
    is_working: bool = False
    start_time: str = ""
    end_time: str = ""
    break_start: Optional[str] = ""
    break_end: Optional[str] = ""
    notes: Optional[str] = ""


class WeeklyScheduleIn(BaseModel):
    days: List[WeeklyDayIn]


class DateOverrideIn(BaseModel):
    date: str
    status: str
    start_time: Optional[str] = ""
    end_time: Optional[str] = ""
    break_start: Optional[str] = ""
    break_end: Optional[str] = ""
    reason: Optional[str] = ""
    notes: Optional[str] = ""
    apply_mode: str = APPLY_SINGLE
    range_end: Optional[str] = None


def _dates_for_apply_mode(base_date: str, apply_mode: str, range_end: Optional[str]) -> List[str]:
    d0 = datetime.strptime(base_date, "%Y-%m-%d").date()
    if apply_mode == APPLY_SINGLE:
        return [base_date]
    if apply_mode == APPLY_WEEKDAY_IN_MONTH:
        weekday = d0.weekday()
        year, month = d0.year, d0.month
        _, last_day = calendar.monthrange(year, month)
        out = []
        for day in range(1, last_day + 1):
            cur = date(year, month, day)
            if cur.weekday() == weekday:
                out.append(cur.isoformat())
        return out
    if apply_mode == APPLY_DATE_RANGE:
        if not range_end:
            raise HTTPException(status_code=400, detail="range_end required for date range apply")
        d1 = datetime.strptime(range_end, "%Y-%m-%d").date()
        if d1 < d0:
            raise HTTPException(status_code=400, detail="range_end must be on or after date")
        out = []
        cur = d0
        while cur <= d1:
            out.append(cur.isoformat())
            cur = date.fromordinal(cur.toordinal() + 1)
        return out
    raise HTTPException(status_code=400, detail="Invalid apply_mode")


async def resolve_effective_day(db, clinic_id: str, staff_id: str, date_str: str) -> Dict[str, Any]:
    """Resolve staff availability for one date. Never uses clinic operating hours."""
    batch = await resolve_effective_day_batch(db, clinic_id, [staff_id], date_str)
    eff = batch.get(staff_id) or {
        "staff_id": staff_id,
        "date": date_str,
        "is_working": False,
        "work_windows": [],
        "block_ranges": [],
    }
    override = await db.staff_date_overrides.find_one(
        {"clinic_id": clinic_id, "staff_id": staff_id, "date": date_str},
        {"_id": 0, "status": 1, "reason": 1},
    )
    weekly = await db.weekly_staff_schedules.find_one(
        {"clinic_id": clinic_id, "staff_id": staff_id, "day_of_week": day_key_from_date(date_str)},
        {"_id": 0, "is_working": 1},
    )
    if override:
        st = override.get("status") or "off"
        source = "override"
        label = st.replace("_", " ")
        if st == WORKING_OVERRIDE_STATUS:
            label = "Date override (working)"
        elif st == BLOCKED_OVERRIDE_STATUS:
            label = "Blocked time"
    elif eff.get("is_working"):
        source = "weekly"
        label = "Weekly schedule"
    else:
        source = "unavailable"
        label = "Not scheduled"
    return {
        **eff,
        "source": source,
        "status": override.get("status") if override else ("working" if eff.get("is_working") else "off"),
        "reason": (override or {}).get("reason") or "",
        "label": label,
    }


def _resolve_effective_from_data(
    weekly: Optional[dict],
    override: Optional[dict],
    staff_id: str,
    date_str: str,
) -> Dict[str, Any]:
    """In-memory resolution (same rules as resolve_effective_day)."""

    def weekly_windows() -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]], bool]:
        if not weekly or not weekly.get("is_working"):
            return [], [], False
        parsed = _parse_working_times(True, weekly.get("start_time", ""), weekly.get("end_time", ""))
        if not parsed:
            return [], [], False
        o, c = parsed
        ww, br = _break_ranges(o, c, weekly.get("break_start"), weekly.get("break_end"))
        return ww, br, True

    if override:
        st = override.get("status") or "off"
        if st in OFF_OVERRIDE_STATUSES:
            return {
                "staff_id": staff_id,
                "date": date_str,
                "is_working": False,
                "work_windows": [],
                "block_ranges": [],
            }
        if st == WORKING_OVERRIDE_STATUS:
            parsed = _parse_working_times(True, override.get("start_time", ""), override.get("end_time", ""))
            if not parsed:
                return {"staff_id": staff_id, "date": date_str, "is_working": False, "work_windows": [], "block_ranges": []}
            o, c = parsed
            ww, br = _break_ranges(o, c, override.get("break_start"), override.get("break_end"))
            return {
                "staff_id": staff_id,
                "date": date_str,
                "is_working": True,
                "work_windows": [{"start": a, "end": b} for a, b in ww],
                "block_ranges": [{"start": a, "end": b} for a, b in br],
            }
        if st == BLOCKED_OVERRIDE_STATUS:
            ww, wbr, working = weekly_windows()
            b0 = hhmm_to_minutes(override.get("start_time"))
            b1 = hhmm_to_minutes(override.get("end_time"))
            block_ranges = list(wbr)
            if b0 is not None and b1 is not None and b0 < b1:
                block_ranges.append((b0, b1))
            return {
                "staff_id": staff_id,
                "date": date_str,
                "is_working": working,
                "work_windows": [{"start": a, "end": b} for a, b in ww],
                "block_ranges": [{"start": a, "end": b} for a, b in block_ranges],
            }

    ww, br, working = weekly_windows()
    return {
        "staff_id": staff_id,
        "date": date_str,
        "is_working": working,
        "work_windows": [{"start": a, "end": b} for a, b in ww],
        "block_ranges": [{"start": a, "end": b} for a, b in br],
    }


async def resolve_effective_day_batch(
    db,
    clinic_id: str,
    staff_ids: List[str],
    date_str: str,
) -> Dict[str, Dict[str, Any]]:
    if not staff_ids:
        return {}
    dow = day_key_from_date(date_str)
    weekly_rows = await db.weekly_staff_schedules.find(
        {"clinic_id": clinic_id, "staff_id": {"$in": staff_ids}, "day_of_week": dow},
        {"_id": 0},
    ).to_list(500)
    weekly_by_staff = {r["staff_id"]: r for r in weekly_rows}
    override_rows = await db.staff_date_overrides.find(
        {"clinic_id": clinic_id, "staff_id": {"$in": staff_ids}, "date": date_str},
        {"_id": 0},
    ).to_list(500)
    override_by_staff = {r["staff_id"]: r for r in override_rows}
    out = {}
    for sid in staff_ids:
        out[sid] = _resolve_effective_from_data(
            weekly_by_staff.get(sid),
            override_by_staff.get(sid),
            sid,
            date_str,
        )
    return out


async def staff_slot_available(
    db,
    clinic_id: str,
    staff_id: str,
    date_str: str,
    s_start: int,
    s_end: int,
    effective: Optional[dict] = None,
) -> bool:
    eff = effective or await resolve_effective_day(db, clinic_id, staff_id, date_str)
    if not eff.get("is_working"):
        return False
    ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
    br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
    return slot_fits(ww, br, s_start, s_end)


async def migrate_legacy_user_schedule(db, clinic_id: str, staff_id: str, user_doc: dict) -> None:
    """One-time style migration from users.working_hours / days_off."""
    wh = user_doc.get("working_hours") or {}
    if wh:
        for dow in DAY_KEYS:
            day_h = wh.get(dow) or {}
            open_t = (day_h.get("open") or "").strip()
            close_t = (day_h.get("close") or "").strip()
            is_working = bool(open_t and close_t)
            existing = await db.weekly_staff_schedules.find_one(
                {"clinic_id": clinic_id, "staff_id": staff_id, "day_of_week": dow},
                {"_id": 0, "id": 1},
            )
            if existing:
                continue
            doc = {
                "id": str(uuid.uuid4()),
                "clinic_id": clinic_id,
                "staff_id": staff_id,
                "day_of_week": dow,
                "is_working": is_working,
                "start_time": open_t if is_working else "",
                "end_time": close_t if is_working else "",
                "break_start": "",
                "break_end": "",
                "notes": "",
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            await db.weekly_staff_schedules.insert_one(doc)
    for item in user_doc.get("days_off") or []:
        d = (item.get("date") if isinstance(item, dict) else str(item)).strip()
        if not d:
            continue
        ex = await db.staff_date_overrides.find_one(
            {"clinic_id": clinic_id, "staff_id": staff_id, "date": d},
            {"_id": 0, "id": 1},
        )
        if ex:
            continue
        await db.staff_date_overrides.insert_one({
            "id": str(uuid.uuid4()),
            "clinic_id": clinic_id,
            "staff_id": staff_id,
            "date": d,
            "status": "off",
            "start_time": "",
            "end_time": "",
            "break_start": "",
            "break_end": "",
            "reason": (item.get("reason") if isinstance(item, dict) else "") or "Migrated day off",
            "notes": "",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })


CLINICAL_SCHEDULE_ROLES = frozenset({"doctor", "therapist", "nurse"})
DEMO_WEEKDAY_HOURS = ("09:00", "18:00")


async def ensure_demo_clinical_schedules(db, clinic_id: str) -> None:
    """Seed Mon–Fri working hours for clinical staff with no weekly schedule rows."""
    staff = await db.users.find(
        {"clinic_id": clinic_id, "role": {"$in": list(CLINICAL_SCHEDULE_ROLES)}},
        {"_id": 0, "id": 1},
    ).to_list(100)
    for u in staff:
        sid = u["id"]
        existing = await db.weekly_staff_schedules.find_one(
            {"clinic_id": clinic_id, "staff_id": sid},
            {"_id": 0, "id": 1},
        )
        if existing:
            continue
        for dow in DAY_KEYS:
            is_working = dow in ("mon", "tue", "wed", "thu", "fri")
            start, end = DEMO_WEEKDAY_HOURS if is_working else ("", "")
            await db.weekly_staff_schedules.update_one(
                {"clinic_id": clinic_id, "staff_id": sid, "day_of_week": dow},
                {
                    "$set": {
                        "clinic_id": clinic_id,
                        "staff_id": sid,
                        "day_of_week": dow,
                        "is_working": is_working,
                        "start_time": start,
                        "end_time": end,
                        "break_start": "",
                        "break_end": "",
                        "notes": "",
                        "updated_at": _now_iso(),
                    },
                    "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()},
                },
                upsert=True,
            )


def register_staff_scheduling(
    api: APIRouter,
    db,
    get_current_user,
    scope,
    audit,
    attach_permissions_to_user,
    user_has_permission,
    assert_writeable,
):
    def require_perm(permission: str):
        async def checker(user: dict = Depends(get_current_user)):
            user = await attach_permissions_to_user(db, user)
            if not user_has_permission(user, permission):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user
        return checker

    async def _staff_in_clinic(user: dict, uid: str) -> dict:
        u = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return u

    def _can_view_clinic_schedules(user: dict) -> bool:
        """Managers (staff.view) and FO booking desk (appointments.view) need read-only schedule data."""
        return user_has_permission(user, "staff.view") or user_has_permission(user, "appointments.view")

    async def _schedule_read_user(user: dict, uid: str) -> dict:
        user = await attach_permissions_to_user(db, user)
        if uid == user.get("id") and user_has_permission(user, "profile.view_own"):
            return user
        if _can_view_clinic_schedules(user):
            return user
        raise HTTPException(status_code=403, detail="Not allowed to view this schedule")

    @api.get("/staff/users/{uid}/weekly-schedule")
    async def get_weekly_schedule(uid: str, user: dict = Depends(get_current_user)):
        user = await _schedule_read_user(user, uid)
        await _staff_in_clinic(user, uid)
        cid = user.get("clinic_id")
        rows = await db.weekly_staff_schedules.find(
            scope(user, {"staff_id": uid}),
            {"_id": 0},
        ).to_list(20)
        by_day = {r["day_of_week"]: r for r in rows}
        days = []
        for dow in DAY_KEYS:
            r = by_day.get(dow)
            if r:
                days.append(r)
            else:
                days.append({
                    "day_of_week": dow,
                    "day_label": DAY_LABELS[dow],
                    "is_working": False,
                    "start_time": "",
                    "end_time": "",
                    "break_start": "",
                    "break_end": "",
                    "notes": "",
                })
        for d in days:
            d.setdefault("day_label", DAY_LABELS.get(d["day_of_week"], d["day_of_week"]))
        return {"staff_id": uid, "days": days}

    @api.put("/staff/users/{uid}/weekly-schedule")
    async def put_weekly_schedule(
        uid: str,
        payload: WeeklyScheduleIn,
        user: dict = Depends(require_perm("staff.manage")),
    ):
        await assert_writeable(user)
        await _staff_in_clinic(user, uid)
        cid = user.get("clinic_id")
        seen = set()
        for day in payload.days:
            dow = (day.day_of_week or "").strip().lower()
            if dow not in DAY_KEYS:
                raise HTTPException(status_code=400, detail=f"Invalid day_of_week: {dow}")
            if dow in seen:
                raise HTTPException(status_code=400, detail=f"Duplicate day: {dow}")
            seen.add(dow)
            if day.is_working:
                _validate_times(True, day.start_time, day.end_time, DAY_LABELS[dow])
            doc = {
                "clinic_id": cid,
                "staff_id": uid,
                "day_of_week": dow,
                "is_working": day.is_working,
                "start_time": (day.start_time or "").strip() if day.is_working else "",
                "end_time": (day.end_time or "").strip() if day.is_working else "",
                "break_start": (day.break_start or "").strip(),
                "break_end": (day.break_end or "").strip(),
                "notes": (day.notes or "").strip(),
                "updated_at": _now_iso(),
            }
            await db.weekly_staff_schedules.update_one(
                {"clinic_id": cid, "staff_id": uid, "day_of_week": dow},
                {
                    "$set": doc,
                    "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()},
                },
                upsert=True,
            )
        await audit(user, "update", "weekly_staff_schedule", uid)
        from audit_log import log_schedule_change
        await log_schedule_change(
            db, user, uid, "updated",
            new_value={"days": [d.model_dump() for d in payload.days]},
        )
        return await get_weekly_schedule(uid, user)

    @api.get("/staff/users/{uid}/date-overrides")
    async def list_date_overrides(
        uid: str,
        month: str = Query(..., description="YYYY-MM"),
        user: dict = Depends(get_current_user),
    ):
        user = await _schedule_read_user(user, uid)
        await _staff_in_clinic(user, uid)
        try:
            y, m = map(int, month.split("-"))
            start = f"{y:04d}-{m:02d}-01"
            _, last = calendar.monthrange(y, m)
            end = f"{y:04d}-{m:02d}-{last:02d}"
        except Exception:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
        rows = await db.staff_date_overrides.find(
            {**scope(user, {"staff_id": uid}), "date": {"$gte": start, "$lte": end}},
            {"_id": 0},
        ).sort("date", 1).to_list(100)
        return rows

    @api.put("/staff/users/{uid}/date-overrides")
    async def upsert_date_override(
        uid: str,
        payload: DateOverrideIn,
        user: dict = Depends(require_perm("staff.manage")),
    ):
        await assert_writeable(user)
        await _staff_in_clinic(user, uid)
        cid = user.get("clinic_id")
        st = (payload.status or "").strip().lower()
        if st not in VALID_OVERRIDE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid override status")
        if st == WORKING_OVERRIDE_STATUS:
            _validate_times(True, payload.start_time or "", payload.end_time or "", "Working override")
        if st == BLOCKED_OVERRIDE_STATUS:
            _validate_times(True, payload.start_time or "", payload.end_time or "", "Blocked time")
        dates = _dates_for_apply_mode(payload.date, payload.apply_mode, payload.range_end)
        saved = []
        for d in dates:
            doc = {
                "clinic_id": cid,
                "staff_id": uid,
                "date": d,
                "status": st,
                "start_time": (payload.start_time or "").strip(),
                "end_time": (payload.end_time or "").strip(),
                "break_start": (payload.break_start or "").strip(),
                "break_end": (payload.break_end or "").strip(),
                "reason": (payload.reason or "").strip(),
                "notes": (payload.notes or "").strip(),
                "created_by": user["id"],
                "updated_at": _now_iso(),
            }
            await db.staff_date_overrides.update_one(
                {"clinic_id": cid, "staff_id": uid, "date": d},
                {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
                upsert=True,
            )
            saved.append(d)
        await audit(user, "upsert", "staff_date_override", uid, {"dates": saved, "status": st})
        from audit_log import log_schedule_change
        await log_schedule_change(
            db, user, uid, "override_upserted",
            new_value={"dates": saved, "status": st, "reason": (payload.reason or "").strip()},
            reason=(payload.reason or "").strip(),
        )
        return {"ok": True, "dates": saved, "count": len(saved)}

    @api.delete("/staff/users/{uid}/date-overrides/{date}")
    async def delete_date_override(
        uid: str,
        date: str,
        user: dict = Depends(require_perm("staff.manage")),
    ):
        await assert_writeable(user)
        r = await db.staff_date_overrides.delete_one(scope(user, {"staff_id": uid, "date": date}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Override not found")
        await audit(user, "delete", "staff_date_override", uid, {"date": date})
        from audit_log import log_schedule_change
        await log_schedule_change(db, user, uid, "override_deleted", old_value={"date": date})
        return {"ok": True}

    @api.get("/staff/users/{uid}/availability-day")
    async def availability_day(
        uid: str,
        date: str = Query(..., description="YYYY-MM-DD"),
        user: dict = Depends(require_perm("staff.view")),
    ):
        await _staff_in_clinic(user, uid)
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date")
        return await resolve_effective_day(db, user["clinic_id"], uid, date)

    @api.get("/staff/schedule/effective")
    async def effective_schedules_for_date(
        date: str = Query(..., description="YYYY-MM-DD"),
        user: dict = Depends(get_current_user),
    ):
        user = await attach_permissions_to_user(db, user)
        if not _can_view_clinic_schedules(user):
            raise HTTPException(status_code=403, detail="Not allowed to view staff schedules")
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date")
        cid = user.get("clinic_id")
        staff = await db.users.find(
            scope(user, {"active": {"$ne": False}}),
            {"_id": 0, "id": 1, "name": 1, "role": 1},
        ).to_list(500)
        out = []
        for s in staff:
            eff = await resolve_effective_day(db, cid, s["id"], date)
            eff["name"] = s.get("name")
            eff["role"] = s.get("role")
            out.append(eff)
        return out
