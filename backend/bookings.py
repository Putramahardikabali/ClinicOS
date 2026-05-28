"""Booking system & availability engine for ClinicOS.

Endpoints (registered onto the main `api` router):
  - Public (no auth)
      GET  /api/public/clinics/{slug}/treatments      -> list of bookable treatments
      GET  /api/public/clinics/{slug}/availability    -> available slots for a date
      POST /api/public/clinics/{slug}/bookings        -> create a booking (status=booked)
  - Auth (clinic-scoped)
      GET    /api/bookings                            -> list bookings (filters: status, from/to, date)
      POST   /api/bookings                            -> manual FO create
      GET    /api/bookings/{id}                       -> detail
      PUT    /api/bookings/{id}                       -> update notes / fields
      PUT    /api/bookings/{id}/status                -> status transition
      POST   /api/bookings/{id}/wa-sent               -> mark a WA reminder template as sent
      DELETE /api/bookings/{id}                       -> cancel/delete (status=cancelled)
      GET    /api/wa-templates                        -> WhatsApp message templates
      GET    /api/dashboard/owner                     -> owner KPIs
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


# ---------------- Models ----------------
BOOKING_STATUSES = ["booked", "confirmed", "checked_in", "completed", "cancelled", "no_show"]


class PublicBookingIn(BaseModel):
    patient_name: str
    patient_phone: str
    patient_email: Optional[str] = ""
    treatment: str
    duration_min: int = 30
    scheduled_at: str  # ISO datetime
    notes: Optional[str] = ""


class BookingIn(BaseModel):
    patient_name: str
    patient_phone: str
    patient_email: Optional[str] = ""
    treatment: str
    duration_min: int = 30
    scheduled_at: str
    notes: Optional[str] = ""
    patient_id: Optional[str] = None  # link to existing patient if known
    performer_id: Optional[str] = None  # assigned staff member id


class BookingUpdateIn(BaseModel):
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    treatment: Optional[str] = None
    duration_min: Optional[int] = None
    scheduled_at: Optional[str] = None
    notes: Optional[str] = None


class BookingStatusIn(BaseModel):
    status: str


class WaSentIn(BaseModel):
    template_key: str  # "confirmation" | "reminder" | "follow_up" | "custom"


class TreatmentCatalogIn(BaseModel):
    name: str
    category: str = "general"          # facial | injectable | laser | body | peel | consult | general
    performer_type: str = "therapist"  # "doctor" | "therapist" | "either"
    duration_min: int = 30
    price_idr: int = 0
    slots_per_session: int = 1          # concurrent capacity (e.g., 2 chairs = 2)
    active: bool = True
    description: Optional[str] = ""


class TreatmentCatalogUpdateIn(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    performer_type: Optional[str] = None
    duration_min: Optional[int] = None
    price_idr: Optional[int] = None
    slots_per_session: Optional[int] = None
    active: Optional[bool] = None
    description: Optional[str] = None


# ---------------- Defaults ----------------
DEFAULT_TREATMENTS = [
    {"key": "consult",     "name": "Consultation",            "category": "consult",    "performer_type": "doctor",    "duration_min": 30, "price_idr": 200_000},
    {"key": "facial",      "name": "Signature Facial",        "category": "facial",     "performer_type": "therapist", "duration_min": 60, "price_idr": 450_000},
    {"key": "peel",        "name": "Chemical Peel",           "category": "peel",       "performer_type": "therapist", "duration_min": 45, "price_idr": 600_000},
    {"key": "microneedle", "name": "Microneedling",           "category": "facial",     "performer_type": "therapist", "duration_min": 60, "price_idr": 850_000},
    {"key": "laser",       "name": "Laser Treatment",         "category": "laser",      "performer_type": "therapist", "duration_min": 45, "price_idr": 1_200_000},
    {"key": "filler",      "name": "Dermal Filler",           "category": "injectable", "performer_type": "doctor",    "duration_min": 45, "price_idr": 3_500_000},
    {"key": "toxin",       "name": "Anti-wrinkle (Toxin)",    "category": "injectable", "performer_type": "doctor",    "duration_min": 30, "price_idr": 2_800_000},
    {"key": "body",        "name": "Body Treatment / RF",     "category": "body",       "performer_type": "therapist", "duration_min": 75, "price_idr": 1_500_000},
]

DEFAULT_WA_TEMPLATES = [
    {
        "key": "confirmation",
        "name": "Booking Confirmation",
        "body": "Hi {patient_name}! Your appointment for {treatment} at {clinic_name} is confirmed for {date} at {time}. See you then! Reply if you need to reschedule.",
    },
    {
        "key": "reminder",
        "name": "Day-before Reminder",
        "body": "Hi {patient_name}, this is a reminder that you have a {treatment} appointment tomorrow ({date}) at {time} at {clinic_name}. We're looking forward to seeing you!",
    },
    {
        "key": "follow_up",
        "name": "Follow-up Care",
        "body": "Hi {patient_name}, thank you for visiting {clinic_name} today. Here are your aftercare instructions for {treatment}. Reach out anytime if you have questions.",
    },
]

DEFAULT_OPERATING_HOURS = {
    "mon": {"open": "09:00", "close": "20:00"},
    "tue": {"open": "09:00", "close": "20:00"},
    "wed": {"open": "09:00", "close": "20:00"},
    "thu": {"open": "09:00", "close": "20:00"},
    "fri": {"open": "09:00", "close": "20:00"},
    "sat": {"open": "10:00", "close": "18:00"},
    "sun": {"open": "", "close": ""},
}


# ---------------- Helpers ----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def _day_key(dt: datetime) -> str:
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][dt.weekday()]


def _parse_iso(s: str) -> datetime:
    # accept Z, offset, or naive datetime (assume UTC for naive)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _hhmm_to_minutes(s: str) -> Optional[int]:
    if not s:
        return None
    try:
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _gen_slots(open_min: int, close_min: int, step_min: int = 30) -> List[int]:
    slots = []
    t = open_min
    while t + step_min <= close_min:
        slots.append(t)
        t += step_min
    return slots


def _format_slot(date_str: str, minute_of_day: int) -> str:
    h = minute_of_day // 60
    m = minute_of_day % 60
    return f"{date_str}T{h:02d}:{m:02d}:00"


# ---------------- Router builder ----------------
def register_bookings(api: APIRouter, db, get_current_user, assert_writeable, assert_feature, audit, scope, get_active_clinic, public_clinic_view, DEFAULT_SETTINGS):
    """Wire booking endpoints onto the given /api router."""

    # ---------- Public endpoints ----------
    @api.get("/public/clinics/{slug}/treatments")
    async def public_treatments(slug: str):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        # Auto-seed collection if empty for this clinic
        await _seed_default_treatments(c["id"])
        treatments = await db.treatments.find({"clinic_id": c["id"], "active": True}, {"_id": 0}).sort("name", 1).to_list(200)
        return {
            "clinic": {"name": c["name"], "slug": c["slug"], "city": c.get("city", ""), "phone": c.get("phone", ""), "logo_path": c.get("logo_path", ""), "booking_slot_interval": int(c.get("booking_slot_interval") or 30)},
            "treatments": treatments,
        }

    @api.get("/public/clinics/{slug}/availability")
    async def public_availability(slug: str, date: str = Query(...), duration: int = 30, treatment: Optional[str] = None, performer_id: Optional[str] = None):
        """Performer-based availability.
        Rule: a slot is available if at least one eligible performer (matching treatment.performer_type)
        is free at that time. If performer_id is given, check only that staff member.
        """
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        try:
            d = datetime.fromisoformat(date)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date — use YYYY-MM-DD")
        hours = c.get("operating_hours") or {}
        day_key = _day_key(d)
        day_hours = hours.get(day_key)
        if not day_hours or not day_hours.get("open"):
            day_hours = DEFAULT_OPERATING_HOURS.get(day_key, {})
        open_min = _hhmm_to_minutes(day_hours.get("open", ""))
        close_min = _hhmm_to_minutes(day_hours.get("close", ""))
        if open_min is None or close_min is None or open_min >= close_min:
            return {"date": date, "slots": [], "closed": True, "closed_reason": "Clinic closed on this weekday"}
        # Special closed dates (holidays, public closures, etc.)
        closed_match = next((cd for cd in (c.get("closed_dates") or []) if cd.get("date") == date), None)
        if closed_match:
            return {"date": date, "slots": [], "closed": True, "closed_reason": closed_match.get("reason") or "Clinic closed"}
        base = _gen_slots(open_min, close_min, step_min=int(c.get("booking_slot_interval") or 30))

        # Resolve eligible performer pool
        performer_type = "either"
        if treatment:
            t = await db.treatments.find_one({"clinic_id": c["id"], "name": treatment, "active": True}, {"_id": 0, "performer_type": 1})
            if t:
                performer_type = t.get("performer_type", "either")
        role_filter = ["doctor", "therapist"] if performer_type == "either" else [performer_type]
        staff = await db.users.find({"clinic_id": c["id"], "role": {"$in": role_filter}, "active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "role": 1, "working_hours": 1, "days_off": 1}).to_list(200)
        # Pre-compute each staff member's effective availability for this date (open/close minutes + on-leave flag)
        # Rule:
        #   - days_off match -> None (off)
        #   - working_hours empty {} -> inherit clinic hours
        #   - working_hours set with explicit day open/close -> use that
        #   - working_hours set but this day missing or empty -> None (explicitly off)
        staff_window: Dict[str, Optional[tuple]] = {}  # id -> (open_min, close_min) or None if off
        for s in staff:
            # Day off?
            doff = s.get("days_off") or []
            if any(d.get("date") == date for d in doff):
                staff_window[s["id"]] = None
                continue
            wh = s.get("working_hours") or {}
            if not wh:
                # No personal hours set → inherit clinic hours
                staff_window[s["id"]] = (open_min, close_min)
                continue
            day_h = wh.get(day_key) or {}
            if day_h.get("open") and day_h.get("close"):
                o = _hhmm_to_minutes(day_h["open"]) or 0
                cl = _hhmm_to_minutes(day_h["close"]) or 0
                staff_window[s["id"]] = (o, cl) if o < cl else None
            else:
                # Day explicitly off (user took control and left this day blank)
                staff_window[s["id"]] = None
        # eligible_ids only includes staff who actually have a window today (i.e. not on leave)
        eligible_ids = {sid for sid, w in staff_window.items() if w is not None}
        eligible_count = len(eligible_ids)
        staff_count = len(staff)  # total role-matching staff (even if all off today)

        # Fetch ALL active bookings for this day (we'll compute occupancy per slot)
        day_start = datetime(d.year, d.month, d.day, 0, 0, 0).isoformat()
        day_end = datetime(d.year, d.month, d.day, 23, 59, 59).isoformat()
        booked = await db.bookings.find(
            {"clinic_id": c["id"], "scheduled_at": {"$gte": day_start, "$lte": day_end}, "status": {"$in": ["booked", "confirmed", "checked_in"]}},
            {"_id": 0, "scheduled_at": 1, "duration_min": 1, "performer_id": 1},
        ).to_list(500)
        # Pre-parse bookings into minute ranges
        ranges = []
        for b in booked:
            try:
                bt = _parse_iso(b["scheduled_at"])
                start = bt.hour * 60 + bt.minute
                end = start + int(b.get("duration_min", 30))
                ranges.append((start, end, b.get("performer_id")))
            except Exception:
                continue

        slots: List[Dict[str, Any]] = []
        # Compute "now" in the clinic's local timezone for past-slot filtering
        tz_name = c.get("timezone") or "Asia/Makassar"
        try:
            local_now = datetime.now(ZoneInfo(tz_name)) if ZoneInfo else datetime.now(timezone.utc)
        except Exception:
            local_now = datetime.now(timezone.utc)
        today_str = local_now.strftime("%Y-%m-%d")
        is_today = (date == today_str)
        now_minute = local_now.hour * 60 + local_now.minute if is_today else None
        for s_min in base:
            s_end = s_min + duration
            if s_end > close_min:
                continue
            past = is_today and s_min < (now_minute or 0)
            # Overlapping bookings
            busy_assigned = set()
            unassigned = 0
            for bs, be, pid in ranges:
                if s_end <= bs or s_min >= be:
                    continue
                if pid:
                    busy_assigned.add(pid)
                else:
                    unassigned += 1
            # Per-staff schedule: a performer is only available if (s_min, s_end) fits inside their window
            in_window_ids = {sid for sid, w in staff_window.items() if w is not None and w[0] <= s_min and s_end <= w[1]}
            if performer_id:
                available = (
                    performer_id in eligible_ids
                    and performer_id in in_window_ids
                    and performer_id not in busy_assigned
                )
            else:
                # Headroom = (eligible+in-window) - busy among them - generic unassigned bookings
                window_count = len(in_window_ids)
                remaining = window_count - len(busy_assigned & in_window_ids) - unassigned
                if staff_count > 0:
                    # Clinic has role-matching staff; availability depends on whether any are on duty + free
                    available = remaining > 0
                else:
                    available = True  # no role-matching staff at all (legacy/setup-incomplete) → open
            if past:
                available = False
            slots.append({
                "time": _format_slot(date, s_min),
                "label": f"{s_min // 60:02d}:{s_min % 60:02d}",
                "available": available,
                "past": past,
            })
        return {
            "date": date,
            "slots": slots,
            "closed": False,
            "eligible_count": eligible_count,
            "performer_type": performer_type,
        }

    @api.post("/public/clinics/{slug}/bookings")
    async def public_create_booking(slug: str, payload: PublicBookingIn):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = c.get("subscription", {})
        if sub.get("status") not in ("trial", "active"):
            raise HTTPException(status_code=402, detail="Bookings temporarily disabled for this clinic")
        # check feature: online_booking is included for all current plans + trial
        try:
            scheduled = _parse_iso(payload.scheduled_at)
            if scheduled < now_utc() - timedelta(minutes=5):
                raise HTTPException(status_code=400, detail="Scheduled time must be in the future")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at")
        # Special closed date check
        day_str = scheduled.strftime("%Y-%m-%d")
        cd_match = next((cd for cd in (c.get("closed_dates") or []) if cd.get("date") == day_str), None)
        if cd_match:
            raise HTTPException(status_code=409, detail=f"Clinic is closed on {day_str}" + (f" ({cd_match.get('reason')})" if cd_match.get("reason") else ""))
        # Capacity-aware slot check
        if await _has_slot_conflict(c["id"], payload.treatment, payload.scheduled_at, payload.duration_min):
            raise HTTPException(status_code=409, detail="Slot just got taken — please pick another")
        booking = {
            "id": str(uuid.uuid4()),
            "clinic_id": c["id"],
            "patient_id": None,
            "patient_name": payload.patient_name,
            "patient_phone": payload.patient_phone,
            "patient_email": (payload.patient_email or "").lower(),
            "treatment": payload.treatment,
            "duration_min": payload.duration_min,
            "scheduled_at": payload.scheduled_at,
            "notes": payload.notes or "",
            "status": "booked",
            "source": "public",
            "wa_history": [],
            "created_at": iso(now_utc()),
        }
        await db.bookings.insert_one(booking)
        booking.pop("_id", None)
        return booking

    # ---------- Authenticated FO Bookings ----------
    @api.get("/bookings")
    async def list_bookings(
        status: Optional[str] = None,
        date: Optional[str] = None,
        scope_filter: Optional[str] = Query(None, alias="scope"),  # 'today' | 'upcoming' | 'past'
        user: dict = Depends(get_current_user),
    ):
        flt: Dict[str, Any] = scope(user)
        if status:
            flt["status"] = status
        if date:
            day_start = f"{date}T00:00:00"
            day_end = f"{date}T23:59:59"
            flt["scheduled_at"] = {"$gte": day_start, "$lte": day_end}
        elif scope_filter:
            today = now_utc().strftime("%Y-%m-%d")
            if scope_filter == "today":
                flt["scheduled_at"] = {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}
            elif scope_filter == "upcoming":
                flt["scheduled_at"] = {"$gte": iso(now_utc())}
            elif scope_filter == "past":
                flt["scheduled_at"] = {"$lt": iso(now_utc())}
        items = await db.bookings.find(flt, {"_id": 0}).sort("scheduled_at", 1).to_list(500)
        return items

    async def _has_slot_conflict(cid: str, treatment_name: str, scheduled_at: str, duration_min: int, performer_id: Optional[str] = None) -> bool:
        """Return True if no eligible performer is free at this slot.
        Rule:
          - If performer_id is provided: that specific staff member must be free AND on duty (not day-off, in working hours).
          - Otherwise: at least ONE eligible performer (matching treatment.performer_type) must be free + on duty.
          - Unassigned bookings consume one generic eligible slot each.
        """
        # Get clinic operating hours for day to fall back to
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "operating_hours": 1})
        c_hours = (c or {}).get("operating_hours") or {}
        # Resolve treatment performer_type
        t = await db.treatments.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0, "performer_type": 1})
        performer_type = (t or {}).get("performer_type", "either")
        role_filter = ["doctor", "therapist"] if performer_type == "either" else [performer_type]
        staff = await db.users.find({"clinic_id": cid, "role": {"$in": role_filter}, "active": {"$ne": False}}, {"_id": 0, "id": 1, "working_hours": 1, "days_off": 1}).to_list(200)
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            return False
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        day_str = sched.strftime("%Y-%m-%d")
        day_key = _day_key(sched)
        # Compute clinic window for fallback
        cd_h = c_hours.get(day_key) or DEFAULT_OPERATING_HOURS.get(day_key, {})
        c_open = _hhmm_to_minutes(cd_h.get("open", "")) or 0
        c_close = _hhmm_to_minutes(cd_h.get("close", "")) or 24 * 60
        # Per-staff effective window for today (same rule as public_availability)
        staff_window: Dict[str, Optional[tuple]] = {}
        for s in staff:
            doff = s.get("days_off") or []
            if any(d.get("date") == day_str for d in doff):
                staff_window[s["id"]] = None
                continue
            wh = s.get("working_hours") or {}
            if not wh:
                staff_window[s["id"]] = (c_open, c_close)
                continue
            day_h = wh.get(day_key) or {}
            if day_h.get("open") and day_h.get("close"):
                o = _hhmm_to_minutes(day_h["open"]) or 0
                cl = _hhmm_to_minutes(day_h["close"]) or 0
                staff_window[s["id"]] = (o, cl) if o < cl else None
            else:
                staff_window[s["id"]] = None
        in_window_ids = {sid for sid, w in staff_window.items() if w is not None and w[0] <= s_start and s_end <= w[1]}
        # If clinic has no eligible staff at all (legacy), allow except for explicit unknown performer
        if performer_id:
            all_ids = {*{s["id"] for s in staff}, *await _all_clinic_user_ids(cid)}
            if performer_id not in all_ids:
                return True
        existing = await db.bookings.find({
            "clinic_id": cid,
            "scheduled_at": {"$gte": f"{day_str}T00:00:00", "$lte": f"{day_str}T23:59:59"},
            "status": {"$in": ["booked", "confirmed", "checked_in"]},
        }, {"_id": 0, "scheduled_at": 1, "duration_min": 1, "performer_id": 1}).to_list(500)
        busy_assigned = set()
        unassigned = 0
        for b in existing:
            try:
                bs_dt = _parse_iso(b["scheduled_at"])
            except Exception:
                continue
            bs = bs_dt.hour * 60 + bs_dt.minute
            be = bs + int(b.get("duration_min", 30))
            if s_end <= bs or s_start >= be:
                continue
            pid = b.get("performer_id")
            if pid:
                busy_assigned.add(pid)
            else:
                unassigned += 1
        if performer_id:
            if performer_id not in in_window_ids:
                return True  # performer is off-duty / on leave / outside working hours
            return performer_id in busy_assigned
        if len(staff) == 0:
            # No eligible staff configured — slot is "open" (legacy/setup-incomplete clinic)
            return False
        window_count = len(in_window_ids)
        if window_count == 0:
            return True  # no eligible performer is on duty in this window
        remaining = window_count - len(busy_assigned & in_window_ids) - unassigned
        return remaining <= 0

    async def _all_clinic_user_ids(cid: str) -> set:
        ids = await db.users.find({"clinic_id": cid}, {"_id": 0, "id": 1}).to_list(500)
        return {u["id"] for u in ids}

    @api.post("/bookings")
    async def create_booking(payload: BookingIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only FO, owner, or manager can create bookings")
        await assert_writeable(user)
        cid = user.get("clinic_id")
        # Validate performer if given (must belong to same clinic)
        if payload.performer_id:
            p = await db.users.find_one({"id": payload.performer_id, "clinic_id": cid}, {"_id": 0, "role": 1, "name": 1})
            if not p:
                raise HTTPException(status_code=400, detail="Performer not found in clinic")
        # Special closed date check
        try:
            sched_dt = _parse_iso(payload.scheduled_at)
            day_str = sched_dt.strftime("%Y-%m-%d")
            c = await db.clinics.find_one({"id": cid}, {"_id": 0, "closed_dates": 1})
            cd_match = next((cd for cd in ((c or {}).get("closed_dates") or []) if cd.get("date") == day_str), None)
            if cd_match:
                raise HTTPException(status_code=409, detail=f"Clinic is closed on {day_str}" + (f" ({cd_match.get('reason')})" if cd_match.get("reason") else ""))
        except HTTPException:
            raise
        except Exception:
            pass
        # Performer-availability check
        if await _has_slot_conflict(cid, payload.treatment, payload.scheduled_at, payload.duration_min, payload.performer_id):
            if payload.performer_id:
                raise HTTPException(status_code=409, detail="Selected performer is already booked at this time")
            raise HTTPException(status_code=409, detail="No available performer for this slot")
        b = payload.model_dump()
        b["id"] = str(uuid.uuid4())
        b["clinic_id"] = cid
        b["status"] = "booked"
        b["source"] = "fo"
        b["wa_history"] = []
        b["created_at"] = iso(now_utc())
        b["created_by"] = user["id"]
        await db.bookings.insert_one(b)
        b.pop("_id", None)
        await audit(user, "create", "booking", b["id"])
        return b

    @api.get("/bookings/{bid}")
    async def get_booking(bid: str, user: dict = Depends(get_current_user)):
        b = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        return b

    @api.put("/bookings/{bid}")
    async def update_booking(bid: str, payload: BookingUpdateIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        r = await db.bookings.update_one(scope(user, {"id": bid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        await audit(user, "update", "booking", bid)
        return await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})

    @api.put("/bookings/{bid}/status")
    async def transition_status(bid: str, payload: BookingStatusIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if payload.status not in BOOKING_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        await assert_writeable(user)
        upd: Dict[str, Any] = {"status": payload.status, "status_updated_at": iso(now_utc())}
        r = await db.bookings.update_one(scope(user, {"id": bid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        await audit(user, "status_change", "booking", bid, {"to": payload.status})
        return await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})

    @api.post("/bookings/{bid}/wa-sent")
    async def mark_wa_sent(bid: str, payload: WaSentIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        entry = {"template_key": payload.template_key, "sent_at": iso(now_utc()), "sent_by": user["id"]}
        r = await db.bookings.update_one(
            scope(user, {"id": bid}),
            {"$push": {"wa_history": entry}, "$set": {"wa_last_sent_at": iso(now_utc())}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        await audit(user, "wa_sent", "booking", bid, {"template": payload.template_key})
        return await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})

    @api.delete("/bookings/{bid}")
    async def delete_booking(bid: str, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        r = await db.bookings.update_one(scope(user, {"id": bid}), {"$set": {"status": "cancelled", "status_updated_at": iso(now_utc())}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        await audit(user, "cancel", "booking", bid)
        return {"ok": True}

    # ---------- WhatsApp Templates ----------
    @api.get("/wa-templates")
    async def list_wa_templates(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            return DEFAULT_WA_TEMPLATES
        c = await get_active_clinic(user)
        s = await db.settings.find_one({"id": "global", "clinic_id": c["id"]}, {"_id": 0})
        templates = ((s or {}).get("wa_templates")) or DEFAULT_WA_TEMPLATES
        return templates

    # ---------- Treatments Catalog (CRUD per clinic, owner/FO/manager) ----------
    async def _seed_default_treatments(cid: str):
        """Auto-seed the default treatments for a clinic if its catalog is empty."""
        existing = await db.treatments.count_documents({"clinic_id": cid})
        if existing:
            return
        for t in DEFAULT_TREATMENTS:
            await db.treatments.insert_one({
                "id": str(uuid.uuid4()),
                "clinic_id": cid,
                "key": t["key"],
                "name": t["name"],
                "category": t.get("category", "general"),
                "performer_type": t.get("performer_type", "therapist"),
                "duration_min": t["duration_min"],
                "price_idr": t["price_idr"],
                "slots_per_session": 1,
                "active": True,
                "description": "",
                "created_at": iso(now_utc()),
            })

    @api.get("/treatments-catalog")
    async def treatments_catalog(user: dict = Depends(get_current_user), active_only: bool = False):
        c = await get_active_clinic(user)
        cid = c["id"]
        await _seed_default_treatments(cid)
        flt = {"clinic_id": cid}
        if active_only:
            flt["active"] = True
        rows = await db.treatments.find(flt, {"_id": 0}).sort("name", 1).to_list(500)
        return rows

    @api.post("/treatments-catalog")
    async def create_treatment(payload: TreatmentCatalogIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only owner, FO, or manager can manage treatments")
        await assert_writeable(user)
        cid = user.get("clinic_id")
        t = payload.model_dump()
        t["id"] = str(uuid.uuid4())
        t["clinic_id"] = cid
        t["key"] = t["name"].lower().replace(" ", "_")[:32]
        t["created_at"] = iso(now_utc())
        t["created_by"] = user["id"]
        await db.treatments.insert_one(t)
        t.pop("_id", None)
        await audit(user, "create", "treatment", t["id"], {"name": t["name"]})
        return t

    @api.put("/treatments-catalog/{tid}")
    async def update_treatment(tid: str, payload: TreatmentCatalogUpdateIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only owner, FO, or manager can manage treatments")
        await assert_writeable(user)
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "name" in upd:
            upd["key"] = upd["name"].lower().replace(" ", "_")[:32]
        r = await db.treatments.update_one(scope(user, {"id": tid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Treatment not found")
        await audit(user, "update", "treatment", tid, upd)
        return await db.treatments.find_one(scope(user, {"id": tid}), {"_id": 0})

    @api.delete("/treatments-catalog/{tid}")
    async def delete_treatment(tid: str, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only owner, FO, or manager can manage treatments")
        await assert_writeable(user)
        r = await db.treatments.delete_one(scope(user, {"id": tid}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Treatment not found")
        await audit(user, "delete", "treatment", tid)
        return {"ok": True}

    # ---------- Dashboard (Owner / FO KPIs) ----------
    @api.get("/dashboard/me-queue")
    async def me_queue(user: dict = Depends(get_current_user)):
        """Role-aware 'what should I do next' queue."""
        cid = user.get("clinic_id")
        if not cid:
            return {"role": user.get("role"), "items": []}
        today = now_utc().strftime("%Y-%m-%d")
        role = user.get("role")
        items: List[Dict[str, Any]] = []

        if role in ("doctor",):
            # Pending clinical work: in_progress visits with no doctor signature
            visits = await db.visits.find({"clinic_id": cid, "status": "in_progress"}, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                rec = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0, "signature": 1})
                needs_doctor = not (rec and rec.get("signature"))
                if needs_doctor:
                    items.append({"kind": "visit_clinical", "visit_id": v["id"], "patient_name": v.get("patient_name", ""), "label": "Awaiting clinical form", "sub": v.get("chief_complaint") or "—"})
        elif role == "therapist":
            # Visits in progress with no therapist record yet
            visits = await db.visits.find({"clinic_id": cid, "status": "in_progress"}, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                rec = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0, "signature": 1})
                needs = not (rec and rec.get("signature"))
                if needs:
                    items.append({"kind": "visit_therapist", "visit_id": v["id"], "patient_name": v.get("patient_name", ""), "label": "Awaiting therapist form", "sub": v.get("visit_type") or "—"})
            # Plus today's confirmed/checked_in bookings
            bks = await db.bookings.find({"clinic_id": cid, "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}, "status": {"$in": ["confirmed", "checked_in"]}}, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                items.append({"kind": "booking", "booking_id": b["id"], "patient_name": b["patient_name"], "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}", "sub": b["status"].replace("_", " ")})
        elif role == "fo":
            # Today's bookings that need confirmation or check-in
            bks = await db.bookings.find({"clinic_id": cid, "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}, "status": {"$in": ["booked", "confirmed"]}}, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                next_label = "Confirm" if b["status"] == "booked" else "Check in"
                items.append({"kind": "booking", "booking_id": b["id"], "patient_name": b["patient_name"], "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}", "sub": next_label})
            # Plus completed-doctor visits ready for FO completion
            visits = await db.visits.find({"clinic_id": cid, "status": "in_progress"}, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                items.append({"kind": "visit_fo", "visit_id": v["id"], "patient_name": v.get("patient_name", ""), "label": "Visit in progress", "sub": "Mark complete after care"})
        elif role in ("manager", "super_admin"):
            # Manager / Owner overview — show all pending items lightly
            pending_bk = await db.bookings.count_documents({"clinic_id": cid, "status": "booked"})
            in_progress = await db.visits.count_documents({"clinic_id": cid, "status": "in_progress"})
            today_bk = await db.bookings.count_documents({"clinic_id": cid, "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}, "status": {"$ne": "cancelled"}})
            items.append({"kind": "summary", "label": f"{today_bk} bookings today", "sub": "View bookings page", "link": "/bookings"})
            items.append({"kind": "summary", "label": f"{pending_bk} pending confirmations", "sub": "FO needs to confirm", "link": "/bookings"})
            items.append({"kind": "summary", "label": f"{in_progress} visits in progress", "sub": "Doctor/therapist work pending", "link": "/visits"})

        return {"role": role, "items": items[:20]}

    # ---------- Patient stats & transactions ----------
    @api.get("/patients/{pid}/stats")
    async def patient_stats(pid: str, user: dict = Depends(get_current_user)):
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        # Total spent: sum of price * quantity across treatment_items for this patient
        # treatment_items hang off visits; find visit ids first.
        visit_ids = [v["id"] async for v in db.visits.find({"clinic_id": user.get("clinic_id"), "patient_id": pid}, {"_id": 0, "id": 1})]
        total_spent = 0.0
        item_count = 0
        if visit_ids:
            pipeline = [
                {"$match": {"clinic_id": user.get("clinic_id"), "visit_id": {"$in": visit_ids}}},
                {"$group": {"_id": None, "total": {"$sum": {"$multiply": [{"$ifNull": ["$price", 0]}, {"$ifNull": ["$quantity", 1]}]}}, "n": {"$sum": 1}}},
            ]
            async for r in db.treatment_items.aggregate(pipeline):
                total_spent = float(r.get("total", 0) or 0)
                item_count = int(r.get("n", 0) or 0)
        visits_total = len(visit_ids)
        last_visit = await db.visits.find_one({"clinic_id": user.get("clinic_id"), "patient_id": pid}, {"_id": 0, "visit_date": 1, "created_at": 1}, sort=[("created_at", -1)])
        # Compute loyalty tier from clinic config
        clinic = await db.clinics.find_one({"id": user.get("clinic_id")}, {"_id": 0, "loyalty_tiers": 1})
        tiers = (clinic or {}).get("loyalty_tiers") or []
        loyalty = None
        next_tier = None
        for t in sorted(tiers, key=lambda x: x.get("min_spend_idr", 0)):
            if total_spent >= float(t.get("min_spend_idr", 0)):
                loyalty = t
            else:
                if next_tier is None:
                    next_tier = t
        return {
            "total_spent_idr": total_spent,
            "visits_total": visits_total,
            "treatment_items_total": item_count,
            "last_visit_at": (last_visit or {}).get("visit_date") or (last_visit or {}).get("created_at"),
            "avg_per_visit_idr": (total_spent / visits_total) if visits_total else 0,
            "loyalty_tier": loyalty,
            "next_tier": next_tier,
            "next_tier_progress": (
                {"current": total_spent, "needed": float(next_tier.get("min_spend_idr", 0)) - total_spent}
                if next_tier else None
            ),
        }

    @api.get("/patients/{pid}/transactions")
    async def patient_transactions(pid: str, user: dict = Depends(get_current_user)):
        # Verify patient access scope
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        visits = await db.visits.find({"clinic_id": user.get("clinic_id"), "patient_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(500)
        out = []
        for v in visits:
            items = await db.treatment_items.find({"clinic_id": user.get("clinic_id"), "visit_id": v["id"]}, {"_id": 0}).to_list(50)
            subtotal = sum(float(i.get("price", 0) or 0) * float(i.get("quantity", 1) or 1) for i in items)
            out.append({
                "visit_id": v["id"],
                "visit_date": v.get("visit_date") or v.get("created_at"),
                "visit_type": v.get("visit_type", ""),
                "status": v.get("status"),
                "items": items,
                "subtotal_idr": subtotal,
            })
        return out

    # ---------- Dashboard (Owner / FO KPIs) ----------
    @api.get("/dashboard/owner")
    async def owner_dashboard(user: dict = Depends(get_current_user)):
        c = await get_active_clinic(user)
        today = now_utc().strftime("%Y-%m-%d")
        month_start = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        prev_month_end = month_start - timedelta(seconds=1)

        flt = {"clinic_id": c["id"]}

        bookings_today = await db.bookings.count_documents({**flt, "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}, "status": {"$ne": "cancelled"}})
        upcoming_bookings = await db.bookings.count_documents({**flt, "scheduled_at": {"$gte": iso(now_utc())}, "status": {"$in": ["booked", "confirmed"]}})
        pending_confirm = await db.bookings.count_documents({**flt, "status": "booked"})

        # Revenue from completed visits' treatment_items
        async def revenue_in_range(start: datetime, end: datetime) -> float:
            pipeline = [
                {"$match": {"clinic_id": c["id"], "created_at": {"$gte": iso(start), "$lte": iso(end)}}},
                {"$group": {"_id": None, "total": {"$sum": {"$multiply": [{"$ifNull": ["$price", 0]}, {"$ifNull": ["$quantity", 1]}]}}}},
            ]
            cur = db.treatment_items.aggregate(pipeline)
            async for row in cur:
                return float(row.get("total", 0) or 0)
            return 0.0

        rev_mtd = await revenue_in_range(month_start, now_utc())
        rev_prev = await revenue_in_range(prev_month_start, prev_month_end)
        rev_delta_pct = ((rev_mtd - rev_prev) / rev_prev * 100) if rev_prev > 0 else None

        # Top treatments (MTD by count)
        top_pipeline = [
            {"$match": {"clinic_id": c["id"], "created_at": {"$gte": iso(month_start)}}},
            {"$group": {"_id": "$name", "count": {"$sum": 1}, "revenue": {"$sum": {"$multiply": [{"$ifNull": ["$price", 0]}, {"$ifNull": ["$quantity", 1]}]}}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
        ]
        top_treatments = [{"name": r["_id"] or "—", "count": r["count"], "revenue": float(r.get("revenue", 0))} async for r in db.treatment_items.aggregate(top_pipeline)]

        # Plain totals
        total_patients = await db.patients.count_documents(flt)
        visits_today = await db.visits.count_documents({**flt, "visit_date": {"$regex": f"^{today}"}})
        total_visits = await db.visits.count_documents(flt)
        in_progress = await db.visits.count_documents({**flt, "status": "in_progress"})

        return {
            "bookings_today": bookings_today,
            "upcoming_bookings": upcoming_bookings,
            "pending_confirm": pending_confirm,
            "revenue_mtd": rev_mtd,
            "revenue_prev_month": rev_prev,
            "revenue_delta_pct": rev_delta_pct,
            "top_treatments": top_treatments,
            "total_patients": total_patients,
            "visits_today": visits_today,
            "total_visits": total_visits,
            "in_progress": in_progress,
        }

    @api.get("/reports/revenue-monthly")
    async def reports_revenue_monthly(
        months: int = Query(12, ge=1, le=36),
        user: dict = Depends(get_current_user),
    ):
        """Revenue by month for the last N months (default 12).
        Only clinic owner or manager can view financial reports.
        """
        if user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Only owner or manager can view reports")
        c = await get_active_clinic(user)
        now = now_utc()
        # Compute first day of month, then back N months
        anchor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        boundaries: List[tuple] = []  # (label, start_iso, end_iso)
        cur = anchor
        for _ in range(months):
            # next month start
            if cur.month == 12:
                nm = cur.replace(year=cur.year + 1, month=1)
            else:
                nm = cur.replace(month=cur.month + 1)
            boundaries.append((cur.strftime("%Y-%m"), iso(cur), iso(nm - timedelta(seconds=1))))
            # step back one month
            if cur.month == 1:
                cur = cur.replace(year=cur.year - 1, month=12)
            else:
                cur = cur.replace(month=cur.month - 1)
        boundaries.reverse()
        results = []
        total_revenue = 0.0
        total_items = 0
        for label, start_iso, end_iso in boundaries:
            pipe = [
                {"$match": {"clinic_id": c["id"], "created_at": {"$gte": start_iso, "$lte": end_iso}}},
                {"$group": {"_id": None, "total": {"$sum": {"$multiply": [{"$ifNull": ["$price", 0]}, {"$ifNull": ["$quantity", 1]}]}}, "n": {"$sum": 1}}},
            ]
            month_total = 0.0
            month_items = 0
            async for row in db.treatment_items.aggregate(pipe):
                month_total = float(row.get("total", 0) or 0)
                month_items = int(row.get("n", 0) or 0)
            total_revenue += month_total
            total_items += month_items
            results.append({"month": label, "revenue": month_total, "items": month_items})
        avg = (total_revenue / len(results)) if results else 0
        return {
            "months": results,
            "total_revenue": total_revenue,
            "total_items": total_items,
            "average_monthly": avg,
        }

    return api
