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


# ---------------- Defaults ----------------
DEFAULT_TREATMENTS = [
    {"key": "consult",     "name": "Consultation",            "duration_min": 30, "price_idr": 200_000},
    {"key": "facial",      "name": "Signature Facial",        "duration_min": 60, "price_idr": 450_000},
    {"key": "peel",        "name": "Chemical Peel",           "duration_min": 45, "price_idr": 600_000},
    {"key": "microneedle", "name": "Microneedling",           "duration_min": 60, "price_idr": 850_000},
    {"key": "laser",       "name": "Laser Treatment",         "duration_min": 45, "price_idr": 1_200_000},
    {"key": "filler",      "name": "Dermal Filler",           "duration_min": 45, "price_idr": 3_500_000},
    {"key": "toxin",       "name": "Anti-wrinkle (Toxin)",    "duration_min": 30, "price_idr": 2_800_000},
    {"key": "body",        "name": "Body Treatment / RF",     "duration_min": 75, "price_idr": 1_500_000},
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
        s = await db.settings.find_one({"id": "global", "clinic_id": c["id"]}, {"_id": 0})
        treatments = ((s or {}).get("treatments_catalog")) or DEFAULT_TREATMENTS
        return {"clinic": {"name": c["name"], "slug": c["slug"], "city": c.get("city", ""), "phone": c.get("phone", ""), "logo_path": c.get("logo_path", "")}, "treatments": treatments}

    @api.get("/public/clinics/{slug}/availability")
    async def public_availability(slug: str, date: str = Query(...), duration: int = 30):
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
            return {"date": date, "slots": [], "closed": True}
        base = _gen_slots(open_min, close_min, step_min=30)
        # Fetch existing bookings for this day for this clinic
        day_start = datetime(d.year, d.month, d.day, 0, 0, 0).isoformat()
        day_end = datetime(d.year, d.month, d.day, 23, 59, 59).isoformat()
        booked = await db.bookings.find(
            {"clinic_id": c["id"], "scheduled_at": {"$gte": day_start, "$lte": day_end}, "status": {"$in": ["booked", "confirmed", "checked_in"]}},
            {"_id": 0, "scheduled_at": 1, "duration_min": 1},
        ).to_list(500)
        # Build "busy" minute ranges
        busy: List[tuple] = []
        for b in booked:
            try:
                bt = _parse_iso(b["scheduled_at"])
                start = bt.hour * 60 + bt.minute
                end = start + int(b.get("duration_min", 30))
                busy.append((start, end))
            except Exception:
                continue
        slots: List[Dict[str, Any]] = []
        for s_min in base:
            s_end = s_min + duration
            if s_end > close_min:
                continue
            overlap = any(not (s_end <= bs or s_min >= be) for bs, be in busy)
            slots.append({"time": _format_slot(date, s_min), "label": f"{s_min // 60:02d}:{s_min % 60:02d}", "available": not overlap})
        return {"date": date, "slots": slots, "closed": False}

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
        # Overlap check
        overlap = await db.bookings.find_one({
            "clinic_id": c["id"],
            "scheduled_at": payload.scheduled_at,
            "status": {"$in": ["booked", "confirmed", "checked_in"]},
        })
        if overlap:
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

    @api.post("/bookings")
    async def create_booking(payload: BookingIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo"):
            raise HTTPException(status_code=403, detail="Only FO or owner can create bookings")
        await assert_writeable(user)
        b = payload.model_dump()
        b["id"] = str(uuid.uuid4())
        b["clinic_id"] = user.get("clinic_id")
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
        if user.get("role") not in ("super_admin", "fo"):
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
        if user.get("role") not in ("super_admin", "fo"):
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
        if user.get("role") not in ("super_admin", "fo"):
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
        if user.get("role") not in ("super_admin", "fo"):
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

    # ---------- Treatments Catalog (auth, for FO booking form) ----------
    @api.get("/treatments-catalog")
    async def treatments_catalog(user: dict = Depends(get_current_user)):
        c = await get_active_clinic(user)
        s = await db.settings.find_one({"id": "global", "clinic_id": c["id"]}, {"_id": 0})
        return ((s or {}).get("treatments_catalog")) or DEFAULT_TREATMENTS

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

    return api
