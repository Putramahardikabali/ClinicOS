"""Booking system & availability engine for ClinicOS.

Endpoints (registered onto the main `api` router):
  - Public (no auth)
      GET  /api/public/clinics/{slug}/treatments      -> list of bookable treatments
      GET  /api/public/clinics/{slug}/packages        -> list of bookable packages
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

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field

from treatment_catalog_io import (
    build_treatment_doc,
    build_treatment_lookup,
    find_treatment_match,
    parse_csv_text,
    parse_xlsx_bytes as parse_treatment_xlsx,
    register_treatment_in_lookup,
    rows_to_csv,
    rows_to_xlsx as treatment_rows_to_xlsx,
    treatment_to_export_row,
)
from product_catalog_io import (
    build_product_doc,
    build_product_lookup,
    find_product_match,
    parse_csv_text as parse_product_csv,
    parse_xlsx_bytes as parse_product_xlsx,
    product_to_export_row,
    register_product_in_lookup,
    rows_to_csv as product_rows_to_csv,
    rows_to_xlsx as product_rows_to_xlsx,
)
from package_io import (
    build_package_doc,
    package_to_export_row,
    parse_csv_text as parse_package_csv,
    parse_xlsx_bytes as parse_package_xlsx,
    rows_to_csv as package_rows_to_csv,
    rows_to_xlsx as package_rows_to_xlsx,
)
from coupon_io import (
    apply_coupon_to_subtotal,
    build_coupon_doc,
    coupon_is_valid_now,
    normalize_coupon_code,
)
from performers import (
    CLINICAL_PERFORMER_ROLES,
    PERFORMER_SLOT_ROLES,
    booking_staff_filter,
    get_performers,
    normalize_allowed_performer_roles,
    normalize_performers_input,
    primary_performer_id,
    roles_from_legacy_performer_type,
    staff_ids_from_performers,
    sync_legacy_performer_fields,
    treatment_allows_multiple,
    visit_staff_filter,
)
from visit_workflow import create_visit_from_booking, patient_loyalty_discount_percent
from staff_scheduling import resolve_effective_day, resolve_effective_day_batch, staff_slot_available, slot_fits
from permissions import user_has_permission


def _can_view_treatments_catalog(user: dict) -> bool:
    return any(user_has_permission(user, p) for p in (
        "treatments.manage", "appointments.view", "billing.view", "visits.view",
        "visits.view_own", "clinical_records.edit", "packages_catalog.manage", "packages.view",
    ))


def _can_view_packages_catalog(user: dict) -> bool:
    return any(user_has_permission(user, p) for p in (
        "packages_catalog.manage", "packages.view", "appointments.view", "billing.view",
    ))


def _can_manage_treatments(user: dict) -> bool:
    return user_has_permission(user, "treatments.manage")


def _can_manage_packages(user: dict) -> bool:
    return user_has_permission(user, "packages_catalog.manage")


def _can_view_owner_dashboard(user: dict) -> bool:
    return any(user_has_permission(user, p) for p in ("billing.view", "reports.view"))


def _assert_catalog_view(user: dict, catalog: str) -> None:
    ok = _can_view_treatments_catalog(user) if catalog == "treatments" else _can_view_packages_catalog(user)
    if not ok:
        raise HTTPException(status_code=403, detail="Insufficient permissions to view catalog")


# ---------------- Models ----------------
BOOKING_STATUSES = [
    "booked", "confirmed", "checked_in", "completed", "cancelled", "no_show", "blocked",
    "pending_payment", "payment_expired", "payment_failed", "treatment_started", "closed",
]
# Statuses that occupy a performer slot (including FO time blocks and payment hold)
SLOT_OCCUPYING_STATUSES = ["booked", "confirmed", "checked_in", "blocked", "pending_payment"]
# Real appointments only (excludes time blocks)
APPOINTMENT_QUEUE_STATUSES = ["booked", "confirmed", "checked_in"]


def is_time_block(doc: dict) -> bool:
    return doc.get("status") == "blocked" or doc.get("booking_type") == "block"


class PublicBookingIn(BaseModel):
    patient_name: str
    patient_phone: str
    patient_email: Optional[str] = ""
    nationality: Optional[str] = None
    nationality_code: Optional[str] = None
    patient_source: Optional[str] = None
    source_detail: Optional[str] = None
    treatment: str
    duration_min: int = 30
    scheduled_at: str  # ISO datetime
    notes: Optional[str] = ""
    package_id: Optional[str] = None
    booking_type: Optional[str] = "treatment"  # treatment | package


class PerformerEntryIn(BaseModel):
    staff_id: str
    performer_type: str = "primary"
    notes: Optional[str] = ""
    commission_eligible: bool = True


class BookingIn(BaseModel):
    patient_name: str
    patient_phone: str
    patient_email: Optional[str] = ""
    treatment: str
    duration_min: int = 30
    scheduled_at: str
    notes: Optional[str] = ""
    patient_id: Optional[str] = None
    performer_id: Optional[str] = None
    performers: Optional[List[PerformerEntryIn]] = None
    package_id: Optional[str] = None
    booking_type: Optional[str] = "treatment"  # treatment | package | block
    block_reason: Optional[str] = None
    coupon_code: Optional[str] = None
    gift_card_id: Optional[str] = None
    is_overtime: Optional[bool] = False
    overtime_reason: Optional[str] = None
    overtime_note: Optional[str] = None
    specific_staff_requested: Optional[bool] = False
    requested_performer_id: Optional[str] = None
    requested_staff_name_snapshot: Optional[str] = None
    duration_source: Optional[str] = None
    duration_override_reason: Optional[str] = None
    treatment_default_duration_minutes: Optional[int] = None
    overlap_override: Optional[bool] = False
    overlap_override_reason: Optional[str] = None


OVERTIME_REASONS = (
    "Patient request",
    "Emergency",
    "Schedule exception",
    "Manager approved",
    "Other",
)


def _apply_duration_metadata(doc: dict, data: dict) -> None:
    for key in ("duration_source", "duration_override_reason", "treatment_default_duration_minutes"):
        val = data.get(key)
        if val is not None and val != "":
            doc[key] = val


async def _staff_display_name(db, clinic_id: str, staff_id: Optional[str]) -> str:
    if not staff_id:
        return ""
    u = await db.users.find_one({"id": staff_id, "clinic_id": clinic_id}, {"_id": 0, "name": 1})
    return (u.get("name") or "").strip() if u else ""


def _primary_performer_id_from_booking(booking: dict) -> Optional[str]:
    from performers import primary_performer_id

    return primary_performer_id(booking) or booking.get("performer_id")


async def _apply_staff_request_fields(
    doc: dict,
    *,
    db,
    clinic_id: str,
    specific_staff_requested: bool,
    performer_id: Optional[str],
    requested_performer_id: Optional[str] = None,
    requested_staff_name_snapshot: Optional[str] = None,
) -> None:
    """Normalize explicit patient-requested staff flags on a booking document."""
    if not specific_staff_requested:
        doc["specific_staff_requested"] = False
        doc["requested_performer_id"] = None
        doc["requested_staff_name_snapshot"] = None
        return
    rid = (requested_performer_id or performer_id or "").strip() or None
    if not rid:
        raise HTTPException(status_code=400, detail="Select assigned staff before marking a patient staff request")
    doc["specific_staff_requested"] = True
    doc["requested_performer_id"] = rid
    snapshot = (requested_staff_name_snapshot or "").strip()
    if not snapshot:
        snapshot = await _staff_display_name(db, clinic_id, rid)
    doc["requested_staff_name_snapshot"] = snapshot or None


def _staff_request_reassign_conflict(existing: dict, merged: dict) -> Optional[dict]:
    """Return conflict detail when reassigning away from a patient-requested provider."""
    if not existing.get("specific_staff_requested"):
        return None
    requested = (existing.get("requested_performer_id") or "").strip()
    if not requested:
        return None
    new_primary = _primary_performer_id_from_booking(merged)
    if not new_primary or new_primary == requested:
        return None
    name = (existing.get("requested_staff_name_snapshot") or "").strip() or "this staff member"
    return {
        "code": "staff_request_conflict",
        "message": f"This patient requested {name}. Are you sure you want to move this appointment to another staff?",
        "requested_staff_id": requested,
        "requested_staff_name": name,
    }


async def _enforce_booking_staff_conflicts(
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
    from booking_conflicts import enforce_staff_schedule_conflicts

    if not staff_ids:
        return None
    return await enforce_staff_schedule_conflicts(
        db,
        user,
        clinic_id,
        staff_ids,
        scheduled_at,
        duration_min,
        overlap_override=bool(overlap_override),
        overlap_override_reason=overlap_override_reason,
        exclude_booking_id=exclude_booking_id,
    )


class BookingUpdateIn(BaseModel):
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    treatment: Optional[str] = None
    duration_min: Optional[int] = None
    scheduled_at: Optional[str] = None
    performer_id: Optional[str] = None
    performers: Optional[List[PerformerEntryIn]] = None
    package_id: Optional[str] = None
    booking_type: Optional[str] = None
    notes: Optional[str] = None
    block_reason: Optional[str] = None
    coupon_code: Optional[str] = None
    specific_staff_requested: Optional[bool] = None
    requested_performer_id: Optional[str] = None
    requested_staff_name_snapshot: Optional[str] = None
    duration_source: Optional[str] = None
    duration_override_reason: Optional[str] = None
    treatment_default_duration_minutes: Optional[int] = None
    overlap_override: Optional[bool] = None
    overlap_override_reason: Optional[str] = None
    schedule_change_source: Optional[str] = None
    staff_request_override: Optional[bool] = False
    staff_request_override_reason: Optional[str] = None


class CouponIn(BaseModel):
    code: str
    name: Optional[str] = ""
    discount_type: str = "percent"  # percent | fixed
    discount_value: int = 0
    max_discount_idr: Optional[int] = None
    min_subtotal_idr: int = 0
    active: bool = True
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    max_uses: Optional[int] = None


class CouponUpdateIn(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[int] = None
    max_discount_idr: Optional[int] = None
    min_subtotal_idr: Optional[int] = None
    active: Optional[bool] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    max_uses: Optional[int] = None


class CouponValidateIn(BaseModel):
    code: str
    subtotal_idr: int = 0
    booking_type: Optional[str] = "treatment"
    treatment: Optional[str] = None
    package_id: Optional[str] = None


class BookingStatusIn(BaseModel):
    status: str
    reason: Optional[str] = Field(default=None, max_length=500)


class WaSentIn(BaseModel):
    template_key: str  # "confirmation" | "reminder" | "follow_up" | "custom"


class TreatmentCatalogIn(BaseModel):
    name: str
    category: str = "general"          # facial | injectable | laser | body | peel | consult | general
    sub_category: Optional[str] = ""
    service_code: Optional[str] = ""
    business_unit: Optional[str] = "Default"
    service_type: Optional[str] = "None"
    tax_included: bool = True
    tax_group: Optional[str] = ""
    performer_type: str = "therapist"  # legacy: doctor | therapist | either | nurse
    allowed_performer_roles: Optional[List[str]] = None
    allow_multiple_performers: bool = False
    requires_assistant: bool = False
    duration_min: int = 30
    price_idr: int = 0
    slots_per_session: int = 1          # concurrent capacity (e.g., 2 chairs = 2)
    active: bool = True
    description: Optional[str] = ""
    consent_required: bool = False
    consent_template_id: Optional[str] = None


class TreatmentCatalogUpdateIn(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    service_code: Optional[str] = None
    business_unit: Optional[str] = None
    service_type: Optional[str] = None
    tax_included: Optional[bool] = None
    tax_group: Optional[str] = None
    performer_type: Optional[str] = None
    allowed_performer_roles: Optional[List[str]] = None
    allow_multiple_performers: Optional[bool] = None
    requires_assistant: Optional[bool] = None
    duration_min: Optional[int] = None
    price_idr: Optional[int] = None
    slots_per_session: Optional[int] = None
    active: Optional[bool] = None
    description: Optional[str] = None
    consent_required: Optional[bool] = None
    consent_template_id: Optional[str] = None


class PackageComponentIn(BaseModel):
    id: Optional[str] = None
    treatment_id: str
    treatment_name_snapshot: Optional[str] = ""
    quantity: int = 1
    sort_order: int = 0
    is_required: bool = True
    notes: Optional[str] = ""


class PackageCatalogIn(BaseModel):
    name: str
    package_code: Optional[str] = ""
    package_type: str = "series_package"
    category: Optional[str] = "Default"
    business_unit: Optional[str] = "Default"
    performer_type: str = "therapist"
    duration_min: int = 60
    price_idr: int = 0
    sessions_total: int = 6
    validity_days: int = 365
    valid_days: Optional[int] = None
    redemption_rule: Optional[str] = None
    unused_component_policy: Optional[str] = None
    is_active: bool = True
    active: Optional[bool] = None
    online_booking: bool = False
    description: Optional[str] = ""
    components: Optional[List[PackageComponentIn]] = None
    series_treatment_id: Optional[str] = None


class PackageCatalogUpdateIn(BaseModel):
    name: Optional[str] = None
    package_code: Optional[str] = None
    package_type: Optional[str] = None
    category: Optional[str] = None
    business_unit: Optional[str] = None
    performer_type: Optional[str] = None
    duration_min: Optional[int] = None
    price_idr: Optional[int] = None
    sessions_total: Optional[int] = None
    validity_days: Optional[int] = None
    valid_days: Optional[int] = None
    redemption_rule: Optional[str] = None
    unused_component_policy: Optional[str] = None
    is_active: Optional[bool] = None
    active: Optional[bool] = None
    online_booking: Optional[bool] = None
    description: Optional[str] = None
    components: Optional[List[PackageComponentIn]] = None
    series_treatment_id: Optional[str] = None


class ProductCatalogIn(BaseModel):
    name: str
    product_code: Optional[str] = ""
    brand: Optional[str] = ""
    category: Optional[str] = "Default"
    sub_category: Optional[str] = ""
    business_unit: Optional[str] = "Default"
    product_type: Optional[str] = "Consumable"
    sale_price_idr: Optional[int] = None
    cost_price_idr: Optional[int] = None
    mrp_idr: Optional[int] = None
    pos_enabled: bool = True
    track_stock: bool = True
    amount: Optional[str] = ""
    current_stock: int = 0
    minimum_stock: int = 0
    unit: Optional[str] = "pcs"
    notes: Optional[str] = ""
    active: bool = True


class ProductCatalogUpdateIn(BaseModel):
    name: Optional[str] = None
    product_code: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    business_unit: Optional[str] = None
    product_type: Optional[str] = None
    sale_price_idr: Optional[int] = None
    cost_price_idr: Optional[int] = None
    mrp_idr: Optional[int] = None
    pos_enabled: Optional[bool] = None
    track_stock: Optional[bool] = None
    amount: Optional[str] = None
    current_stock: Optional[int] = None
    minimum_stock: Optional[int] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


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


def _public_online_bookable_filter() -> Dict[str, Any]:
    """Active catalog rows; require online_booking when that field exists."""
    return {
        "active": True,
        "$or": [
            {"online_booking": True},
            {"online_booking": {"$exists": False}},
        ],
    }


def _public_package_component_summary(pkg: dict) -> str:
    from package_engine import normalize_package_type
    ptype = normalize_package_type(pkg.get("package_type"))
    components = pkg.get("components") or []
    if ptype == "series_package":
        sessions = int(pkg.get("sessions_total") or 0)
        if components:
            name = (components[0].get("treatment_name_snapshot") or "").strip()
            if name and sessions:
                return f"{name} · {sessions} session{'s' if sessions != 1 else ''}"
            if name:
                return name
        if sessions:
            return f"{sessions} session{'s' if sessions != 1 else ''}"
        return ""
    parts = []
    for comp in sorted(components, key=lambda c: int(c.get("sort_order") or 0)):
        name = (comp.get("treatment_name_snapshot") or "Treatment").strip()
        qty = max(1, int(comp.get("quantity") or 1))
        parts.append(f"{name} x{qty}")
    return " + ".join(parts)


def _public_package_view(pkg: dict) -> dict:
    from package_engine import normalize_package_type, package_type_label
    ptype = normalize_package_type(pkg.get("package_type"))
    desc = (pkg.get("description") or "").strip()
    if len(desc) > 160:
        desc = desc[:157] + "..."
    return {
        "id": pkg["id"],
        "key": pkg.get("key") or pkg.get("package_code") or pkg["id"],
        "name": pkg["name"],
        "package_type": ptype,
        "package_type_label": package_type_label(ptype),
        "category": pkg.get("category") or "Default",
        "description": desc,
        "duration_min": int(pkg.get("duration_min") or 60),
        "price_idr": pkg.get("price_idr"),
        "sessions_total": int(pkg.get("sessions_total") or 0),
        "component_summary": _public_package_component_summary(pkg),
    }


# ---------------- Router builder ----------------
def register_bookings(api: APIRouter, db, get_current_user, assert_writeable, assert_feature, audit, scope, get_active_clinic, public_clinic_view, DEFAULT_SETTINGS):
    """Wire booking endpoints onto the given /api router."""

    async def _public_clinic_info(c: dict) -> dict:
        s = await db.settings.find_one({"id": "global", "clinic_id": c["id"]}, {"_id": 0, "branding": 1})
        branding = (s or {}).get("branding") or {}
        return {
            "name": (branding.get("clinic_name") or c.get("name") or "").strip() or c["name"],
            "slug": c["slug"],
            "tagline": (branding.get("tagline") or "").strip(),
            "city": c.get("city", ""),
            "phone": c.get("phone", ""),
            "logo_path": branding.get("logo_path") or c.get("logo_path", ""),
            "booking_slot_interval": int(c.get("booking_slot_interval") or 30),
            "timezone": c.get("timezone") or "Asia/Makassar",
        }

    # ---------- Public endpoints ----------
    @api.get("/public/clinics/{slug}/treatments")
    async def public_treatments(slug: str):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        from subscription_gates import resolve_clinic_for_public_booking
        c, blocked = await resolve_clinic_for_public_booking(db, c)
        if blocked:
            return {
                "clinic": await _public_clinic_info(c),
                "treatments": [],
                "booking_disabled": True,
                "message": blocked,
            }
        # Auto-seed collection if empty for this clinic
        await _seed_default_treatments(c["id"])
        treatments = await db.treatments.find(
            {"clinic_id": c["id"], **_public_online_bookable_filter()},
            {"_id": 0},
        ).sort("name", 1).to_list(200)
        return {
            "clinic": await _public_clinic_info(c),
            "treatments": treatments,
        }

    @api.get("/public/clinics/{slug}/packages")
    async def public_packages(slug: str):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        from subscription_gates import resolve_clinic_for_public_booking
        c, blocked = await resolve_clinic_for_public_booking(db, c)
        if blocked:
            return {
                "clinic": await _public_clinic_info(c),
                "packages": [],
                "booking_disabled": True,
                "message": blocked,
            }
        rows = await db.packages.find(
            {"clinic_id": c["id"], **_public_online_bookable_filter()},
            {"_id": 0, "id": 1, "key": 1, "package_code": 1, "name": 1, "package_type": 1,
             "category": 1, "description": 1, "duration_min": 1, "price_idr": 1,
             "sessions_total": 1, "components": 1},
        ).sort("name", 1).to_list(200)
        return {
            "clinic": await _public_clinic_info(c),
            "packages": [_public_package_view(p) for p in rows],
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
        from subscription_gates import resolve_clinic_for_public_booking, PUBLIC_BOOKING_UNAVAILABLE_MSG
        c, blocked = await resolve_clinic_for_public_booking(db, c)
        if blocked:
            return {
                "date": date,
                "slots": [],
                "closed": True,
                "closed_reason": blocked,
                "booking_disabled": True,
            }
        try:
            d = datetime.fromisoformat(date)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date — use YYYY-MM-DD")
        from public_booking_time import (
            PAST_DATE_MSG,
            clinic_local_now,
            clinic_today_str,
            is_public_date_in_past,
        )
        if is_public_date_in_past(c, date):
            return {"date": date, "slots": [], "closed": True, "closed_reason": PAST_DATE_MSG}
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
        treatment_doc = None
        if treatment:
            pub = _public_online_bookable_filter()
            treatment_doc = await db.treatments.find_one(
                {"clinic_id": c["id"], "name": treatment, **pub}, {"_id": 0},
            )
            if not treatment_doc:
                treatment_doc = await db.packages.find_one(
                    {"clinic_id": c["id"], "name": treatment, **pub}, {"_id": 0},
                )
        role_filter = normalize_allowed_performer_roles(treatment_doc)
        performer_type = (treatment_doc or {}).get("performer_type") or "either"
        staff = await db.users.find(
            {"clinic_id": c["id"], "role": {"$in": role_filter}, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "role": 1},
        ).to_list(200)
        staff_ids = [s["id"] for s in staff]
        effective_map = await resolve_effective_day_batch(db, c["id"], staff_ids, date)
        eligible_ids = {sid for sid, eff in effective_map.items() if eff.get("is_working")}
        eligible_count = len(eligible_ids)
        staff_count = len(staff)  # total role-matching staff (even if all off today)

        # Fetch ALL active bookings for this day (we'll compute occupancy per slot)
        day_start = datetime(d.year, d.month, d.day, 0, 0, 0).isoformat()
        day_end = datetime(d.year, d.month, d.day, 23, 59, 59).isoformat()
        booked = await db.bookings.find(
            {"clinic_id": c["id"], "scheduled_at": {"$gte": day_start, "$lte": day_end}, "status": {"$in": SLOT_OCCUPYING_STATUSES}},
            {"_id": 0, "scheduled_at": 1, "duration_min": 1, "performer_id": 1, "performers": 1},
        ).to_list(500)
        # Pre-parse bookings into minute ranges (one entry per assigned performer)
        ranges = []
        for b in booked:
            try:
                bt = _parse_iso(b["scheduled_at"])
                start = bt.hour * 60 + bt.minute
                end = start + int(b.get("duration_min", 30))
                pids = set()
                if b.get("performer_id"):
                    pids.add(b["performer_id"])
                for pe in b.get("performers") or []:
                    if pe.get("staff_id"):
                        pids.add(pe["staff_id"])
                if pids:
                    for pid in pids:
                        ranges.append((start, end, pid))
                else:
                    ranges.append((start, end, None))
            except Exception:
                continue

        slots: List[Dict[str, Any]] = []
        local_now = clinic_local_now(c)
        today_str = clinic_today_str(c, local_now)
        is_today = (date == today_str)
        now_minute = local_now.hour * 60 + local_now.minute if is_today else None
        for s_min in base:
            s_end = s_min + duration
            if s_end > close_min:
                continue
            past = is_today and s_min < (now_minute or 0)
            if past:
                continue
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
            in_window_ids = set()
            for sid in staff_ids:
                eff = effective_map.get(sid) or {}
                if not eff.get("is_working"):
                    continue
                ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
                br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
                if slot_fits(ww, br, s_min, s_end):
                    in_window_ids.add(sid)
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
            slots.append({
                "time": _format_slot(date, s_min),
                "label": f"{s_min // 60:02d}:{s_min % 60:02d}",
                "available": available,
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
        from subscription_gates import resolve_clinic_for_public_booking, PUBLIC_BOOKING_UNAVAILABLE_MSG
        c, blocked = await resolve_clinic_for_public_booking(db, c)
        if blocked:
            raise HTTPException(status_code=402, detail=blocked)
        # check feature: online_booking is included for all current plans + trial
        from public_booking_time import assert_public_scheduled_at_valid
        try:
            scheduled = assert_public_scheduled_at_valid(c, payload.scheduled_at)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at")
        # Special closed date check
        day_str = scheduled.strftime("%Y-%m-%d")
        cd_match = next((cd for cd in (c.get("closed_dates") or []) if cd.get("date") == day_str), None)
        if cd_match:
            raise HTTPException(status_code=409, detail=f"Clinic is closed on {day_str}" + (f" ({cd_match.get('reason')})" if cd_match.get("reason") else ""))

        booking_type = (payload.booking_type or "treatment").strip().lower()
        package_id = (payload.package_id or "").strip() or None
        treatment_name = payload.treatment.strip()
        duration_min = int(payload.duration_min or 30)
        pub_flt = _public_online_bookable_filter()

        if booking_type == "package" or package_id:
            pkg_flt: Dict[str, Any] = {"clinic_id": c["id"], **pub_flt}
            if package_id:
                pkg_flt["id"] = package_id
            else:
                pkg_flt["name"] = treatment_name
            pkg = await db.packages.find_one(pkg_flt, {"_id": 0})
            if not pkg:
                raise HTTPException(status_code=400, detail="Package not available for online booking")
            booking_type = "package"
            package_id = pkg["id"]
            treatment_name = pkg["name"]
            if not duration_min or duration_min == 30:
                duration_min = int(pkg.get("duration_min") or 60)
        else:
            tdoc = await db.treatments.find_one(
                {"clinic_id": c["id"], "name": treatment_name, **pub_flt},
                {"_id": 0, "duration_min": 1},
            )
            if not tdoc:
                raise HTTPException(status_code=400, detail="Treatment not available for online booking")
            booking_type = "treatment"
            package_id = None
            if not duration_min or duration_min == 30:
                duration_min = int(tdoc.get("duration_min") or 30)

        # Capacity-aware slot check
        if await _has_slot_conflict(
            c["id"], treatment_name, payload.scheduled_at, duration_min,
            package_id=package_id, booking_type=booking_type,
        ):
            raise HTTPException(status_code=409, detail="Slot just got taken — please pick another")
        # Auto-pick the least-busy on-duty performer (silent — guest doesn't choose)
        auto_performer_id = await _auto_pick_performer(
            c["id"], treatment_name, payload.scheduled_at, duration_min,
            package_id=package_id, booking_type=booking_type,
        )
        from public_booking_patient import resolve_public_booking_patient

        patient_id, patient_matched = await resolve_public_booking_patient(
            db,
            c["id"],
            patient_name=payload.patient_name,
            patient_phone=payload.patient_phone,
            patient_email=payload.patient_email or "",
            nationality=payload.nationality,
            nationality_code=payload.nationality_code,
            patient_source=payload.patient_source,
            source_detail=payload.source_detail,
        )
        booking = {
            "id": str(uuid.uuid4()),
            "clinic_id": c["id"],
            "patient_id": patient_id,
            "patient_name": payload.patient_name,
            "patient_phone": payload.patient_phone,
            "patient_email": (payload.patient_email or "").lower(),
            "treatment": treatment_name,
            "duration_min": duration_min,
            "scheduled_at": payload.scheduled_at,
            "performer_id": auto_performer_id,
            "performer_auto_assigned": bool(auto_performer_id),
            "patient_matched": patient_matched,
            "notes": payload.notes or "",
            "booking_type": booking_type,
            "package_id": package_id,
            "status": "booked",
            "source": "public",
            "wa_history": [],
            "created_at": iso(now_utc()),
        }
        await db.bookings.insert_one(booking)
        booking.pop("_id", None)
        from audit_log import log_appointment_created
        await log_appointment_created(
            db,
            {
                "id": "public_booking",
                "email": (payload.patient_email or "public@guest").lower(),
                "role": "guest",
                "name": payload.patient_name.strip(),
                "clinic_id": c["id"],
            },
            booking,
        )
        from clinic_realtime import safe_emit_booking_event
        safe_emit_booking_event(booking, "booking_created", message="Online booking received")
        return booking

    # ---------- Authenticated FO Bookings ----------
    @api.get("/bookings")
    async def list_bookings(
        status: Optional[str] = None,
        date: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        scope_filter: Optional[str] = Query(None, alias="scope"),  # 'today' | 'upcoming' | 'past'
        appointments_only: bool = Query(False),
        patient_id: Optional[str] = None,
        schedule_meta: bool = Query(False, description="Enrich with FO schedule card indicators"),
        user: dict = Depends(get_current_user),
    ):
        from permissions import user_has_permission
        from server import assert_patient_access
        if not user_has_permission(user, "appointments.view") and not user_has_permission(user, "schedule.view_own"):
            raise HTTPException(status_code=403, detail="Not allowed to list bookings")
        if patient_id:
            p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1})
            if not p:
                raise HTTPException(status_code=404, detail="Patient not found")
            await assert_patient_access(db, user, patient_id)
        flt: Dict[str, Any] = scope(user)
        if patient_id:
            flt["patient_id"] = patient_id
        if not user_has_permission(user, "appointments.view") and user.get("id"):
            flt.update(booking_staff_filter(user["id"]))
        elif user.get("role") in PERFORMER_SLOT_ROLES and user.get("id") and user_has_permission(user, "schedule.view_own"):
            flt.update(booking_staff_filter(user["id"]))
        if appointments_only and status != "blocked":
            flt["status"] = {"$ne": "blocked"}
            flt["booking_type"] = {"$ne": "block"}
        if status:
            flt["status"] = status
        if date:
            day_start = f"{date}T00:00:00"
            day_end = f"{date}T23:59:59"
            flt["scheduled_at"] = {"$gte": day_start, "$lte": day_end}
        elif from_date or to_date:
            sched: Dict[str, Any] = {}
            if from_date:
                sched["$gte"] = f"{from_date}T00:00:00"
            if to_date:
                sched["$lte"] = f"{to_date}T23:59:59"
            if sched:
                flt["scheduled_at"] = sched
        elif scope_filter:
            today = now_utc().strftime("%Y-%m-%d")
            if scope_filter == "today":
                flt["scheduled_at"] = {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}
            elif scope_filter == "upcoming":
                flt["scheduled_at"] = {"$gte": iso(now_utc())}
            elif scope_filter == "past":
                flt["scheduled_at"] = {"$lt": iso(now_utc())}
        items = await db.bookings.find(flt, {"_id": 0}).sort("scheduled_at", 1).to_list(500)
        if schedule_meta and items:
            from schedule_indicators import enrich_bookings_schedule_meta
            items = await enrich_bookings_schedule_meta(db, user.get("clinic_id"), items)
        return items

    @api.get("/bookings/appointment-log")
    async def appointment_activity_log(
        date: str = Query(..., description="YYYY-MM-DD"),
        action: Optional[str] = None,
        user_id: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = Query(200, ge=1, le=500),
        user: dict = Depends(get_current_user),
    ):
        """Appointment-focused audit log for FO schedule utility."""
        from permissions import user_has_permission
        from audit_log import MODULE_APPOINTMENT, MODULE_SCHEDULE

        allowed = (
            user.get("role") in ("super_admin", "manager", "fo")
            or user_has_permission(user, "audit.view")
            or user_has_permission(user, "appointments.view")
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not allowed to view appointment log")
        day = (date or "").strip()[:10]
        if len(day) != 10:
            raise HTTPException(status_code=400, detail="Invalid date")
        cid = user.get("clinic_id")
        day_start = f"{day}T00:00:00"
        day_end = f"{day}T23:59:59"
        flt: Dict[str, Any] = {
            "clinic_id": cid,
            "created_at": {"$gte": day_start, "$lte": day_end},
            "module": {"$in": [MODULE_APPOINTMENT, "booking", MODULE_SCHEDULE]},
        }
        if action:
            flt["action"] = action
        if user_id:
            flt["user_id"] = user_id
        rows = await db.audit_logs.find(flt, {"_id": 0}).sort("created_at", -1).to_list(limit)
        booking_ids = list({r.get("record_id") for r in rows if r.get("record_id")})
        bookings_by_id: Dict[str, dict] = {}
        if booking_ids:
            async for b in db.bookings.find(
                {"clinic_id": cid, "id": {"$in": booking_ids}},
                {"_id": 0, "id": 1, "patient_name": 1, "treatment": 1, "scheduled_at": 1},
            ):
                bookings_by_id[b["id"]] = b
        out = []
        q_lower = (q or "").strip().lower()
        for row in rows:
            bid = row.get("record_id") or ""
            bk = bookings_by_id.get(bid) or {}
            if bk:
                row["booking_patient_name"] = bk.get("patient_name")
                row["booking_treatment"] = bk.get("treatment")
            if q_lower:
                hay = " ".join(
                    str(x or "")
                    for x in (
                        row.get("booking_patient_name"),
                        (row.get("new_value") or {}).get("patient_name"),
                        (row.get("old_value") or {}).get("patient_name"),
                        (row.get("new_value") or {}).get("treatment"),
                        row.get("user_name"),
                        row.get("user_email"),
                    )
                ).lower()
                if q_lower not in hay:
                    continue
            out.append(row)
        return {"date": day, "items": out[:limit]}

    async def _get_treatment_doc(
        cid: str,
        treatment_name: str,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
    ) -> Optional[dict]:
        if package_id or booking_type == "package":
            if package_id:
                p = await db.packages.find_one({"clinic_id": cid, "id": package_id}, {"_id": 0})
                if p:
                    return p
            return await db.packages.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0})
        return await db.treatments.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0})

    async def _resolve_allowed_roles(
        cid: str,
        treatment_name: str,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
    ) -> List[str]:
        doc = await _get_treatment_doc(cid, treatment_name, package_id, booking_type)
        return normalize_allowed_performer_roles(doc)

    async def _resolve_performer_type(
        cid: str,
        treatment_name: str,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
    ) -> str:
        if package_id or booking_type == "package":
            if package_id:
                p = await db.packages.find_one({"clinic_id": cid, "id": package_id}, {"_id": 0, "performer_type": 1})
                if p:
                    return p.get("performer_type", "therapist")
            p = await db.packages.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0, "performer_type": 1})
            if p:
                return p.get("performer_type", "therapist")
        t = await db.treatments.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0, "performer_type": 1})
        if t:
            return t.get("performer_type", "either")
        p = await db.packages.find_one({"clinic_id": cid, "name": treatment_name}, {"_id": 0, "performer_type": 1})
        return (p or {}).get("performer_type", "either")

    async def _busy_staff_ids_at_slot(
        cid: str,
        scheduled_at: str,
        duration_min: int,
        exclude_booking_id: Optional[str] = None,
    ) -> set:
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            return set()
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        day_str = sched.strftime("%Y-%m-%d")
        existing = await db.bookings.find({
            "clinic_id": cid,
            "scheduled_at": {"$gte": f"{day_str}T00:00:00", "$lte": f"{day_str}T23:59:59"},
            "status": {"$in": SLOT_OCCUPYING_STATUSES},
        }, {"_id": 0, "id": 1, "scheduled_at": 1, "duration_min": 1, "performer_id": 1, "performers": 1}).to_list(500)
        busy: set = set()
        for b in existing:
            if exclude_booking_id and b.get("id") == exclude_booking_id:
                continue
            try:
                bs_dt = _parse_iso(b["scheduled_at"])
            except Exception:
                continue
            bs = bs_dt.hour * 60 + bs_dt.minute
            be = bs + int(b.get("duration_min", 30))
            if s_end <= bs or s_start >= be:
                continue
            if b.get("performer_id"):
                busy.add(b["performer_id"])
            for pe in b.get("performers") or []:
                if pe.get("staff_id"):
                    busy.add(pe["staff_id"])
        return busy

    async def _staff_on_duty_at_slot(
        cid: str,
        staff_id: str,
        scheduled_at: str,
        duration_min: int,
    ) -> bool:
        user = await db.users.find_one(
            {"id": staff_id, "clinic_id": cid, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "role": 1},
        )
        if not user or user.get("role") not in CLINICAL_PERFORMER_ROLES:
            return False
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            return False
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        day_str = sched.strftime("%Y-%m-%d")
        effective_map = await resolve_effective_day_batch(db, cid, [staff_id], day_str)
        eff = effective_map.get(staff_id) or {}
        if not eff.get("is_working"):
            return False
        ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
        br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
        return slot_fits(ww, br, s_start, s_end)

    async def _is_staff_free_at_slot(
        cid: str,
        staff_id: str,
        scheduled_at: str,
        duration_min: int,
        exclude_booking_id: Optional[str] = None,
        *,
        require_on_duty: bool = True,
    ) -> bool:
        if not staff_id:
            return False
        if require_on_duty and not await _staff_on_duty_at_slot(cid, staff_id, scheduled_at, duration_min):
            return False
        busy = await _busy_staff_ids_at_slot(cid, scheduled_at, duration_min, exclude_booking_id)
        return staff_id not in busy

    async def _validate_overtime_booking(
        user: dict,
        cid: str,
        performer_id: str,
        scheduled_at: str,
        duration_min: int,
    ) -> None:
        """Overtime: outside staff work windows; overlap still enforced. Clinical staff cannot create."""
        if user.get("role") in CLINICAL_PERFORMER_ROLES:
            raise HTTPException(status_code=403, detail="Clinical staff cannot create overtime bookings")
        is_privileged = user.get("role") in ("super_admin", "manager")
        if not is_privileged and not user_has_permission(user, "bookings.create_overtime"):
            raise HTTPException(status_code=403, detail="Not allowed to create overtime bookings")
        if not performer_id:
            raise HTTPException(status_code=400, detail="Performer is required for overtime")
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at")
        day_str = sched.strftime("%Y-%m-%d")
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        eff = await resolve_effective_day(db, cid, performer_id, day_str)
        if eff.get("is_working"):
            ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
            br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
            if slot_fits(ww, br, s_start, s_end):
                raise HTTPException(
                    status_code=400,
                    detail="This time is within normal working hours. Create a standard booking instead.",
                )
        else:
            if not is_privileged:
                raise HTTPException(
                    status_code=403,
                    detail="Staff is not scheduled this day. A manager or owner must create this overtime booking.",
                )
        if not await _is_staff_free_at_slot(
            cid, performer_id, scheduled_at, duration_min, require_on_duty=False,
        ):
            raise HTTPException(status_code=409, detail="This performer is already booked at this time")

    async def _has_slot_conflict(
        cid: str,
        treatment_name: str,
        scheduled_at: str,
        duration_min: int,
        performer_id: Optional[str] = None,
        exclude_booking_id: Optional[str] = None,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
    ) -> bool:
        """Return True if no eligible performer is free at this slot.
        Rule:
          - If performer_id is provided: that specific staff member must be free AND on duty (not day-off, in working hours).
          - Otherwise: at least ONE eligible performer (matching treatment.performer_type) must be free + on duty.
          - Unassigned bookings consume one generic eligible slot each.
        """
        performer_type = await _resolve_performer_type(cid, treatment_name, package_id, booking_type)
        role_filter = await _resolve_allowed_roles(cid, treatment_name, package_id, booking_type)
        if performer_id:
            return not await _is_staff_free_at_slot(
                cid, performer_id, scheduled_at, duration_min, exclude_booking_id,
            )
        staff = await db.users.find(
            {"clinic_id": cid, "role": {"$in": role_filter}, "active": {"$ne": False}},
            {"_id": 0, "id": 1},
        ).to_list(200)
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            return False
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        day_str = sched.strftime("%Y-%m-%d")
        staff_ids = [s["id"] for s in staff]
        effective_map = await resolve_effective_day_batch(db, cid, staff_ids, day_str)
        in_window_ids = set()
        for sid in staff_ids:
            eff = effective_map.get(sid) or {}
            if not eff.get("is_working"):
                continue
            ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
            br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
            if slot_fits(ww, br, s_start, s_end):
                in_window_ids.add(sid)
        existing = await db.bookings.find({
            "clinic_id": cid,
            "scheduled_at": {"$gte": f"{day_str}T00:00:00", "$lte": f"{day_str}T23:59:59"},
            "status": {"$in": SLOT_OCCUPYING_STATUSES},
        }, {"_id": 0, "id": 1, "scheduled_at": 1, "duration_min": 1, "performer_id": 1, "performers": 1}).to_list(500)
        busy_assigned = set()
        unassigned = 0
        for b in existing:
            if exclude_booking_id and b.get("id") == exclude_booking_id:
                continue
            try:
                bs_dt = _parse_iso(b["scheduled_at"])
            except Exception:
                continue
            bs = bs_dt.hour * 60 + bs_dt.minute
            be = bs + int(b.get("duration_min", 30))
            if s_end <= bs or s_start >= be:
                continue
            performer_ids = set()
            pid = b.get("performer_id")
            if pid:
                performer_ids.add(pid)
            for pe in b.get("performers") or []:
                if pe.get("staff_id"):
                    performer_ids.add(pe["staff_id"])
            if performer_ids:
                busy_assigned.update(performer_ids)
            else:
                unassigned += 1
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

    async def _auto_pick_performer(
        cid: str,
        treatment_name: str,
        scheduled_at: str,
        duration_min: int,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
    ) -> Optional[str]:
        """Pick the least-busy on-duty performer eligible for this treatment at this slot.
        Returns performer id, or None if nobody qualifies.
        """
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            return None
        performer_type = await _resolve_performer_type(cid, treatment_name, package_id, booking_type)
        role_filter = await _resolve_allowed_roles(cid, treatment_name, package_id, booking_type)
        staff = await db.users.find(
            {"clinic_id": cid, "role": {"$in": role_filter}, "active": {"$ne": False}},
            {"_id": 0, "id": 1},
        ).to_list(200)
        if not staff:
            return None
        s_start = sched.hour * 60 + sched.minute
        s_end = s_start + int(duration_min or 30)
        day_str = sched.strftime("%Y-%m-%d")
        staff_ids = [s["id"] for s in staff]
        effective_map = await resolve_effective_day_batch(db, cid, staff_ids, day_str)
        # Existing same-day bookings for load + conflict
        day_existing = await db.bookings.find({
            "clinic_id": cid,
            "scheduled_at": {"$gte": f"{day_str}T00:00:00", "$lte": f"{day_str}T23:59:59"},
            "status": {"$in": SLOT_OCCUPYING_STATUSES},
        }, {"_id": 0, "scheduled_at": 1, "duration_min": 1, "performer_id": 1, "performers": 1}).to_list(500)
        busy_pids = set()
        load: Dict[str, int] = {}  # performer_id -> count of bookings today
        for b in day_existing:
            try:
                bs_dt = _parse_iso(b["scheduled_at"])
            except Exception:
                continue
            bs = bs_dt.hour * 60 + bs_dt.minute
            be = bs + int(b.get("duration_min", 30))
            slot_overlap = not (s_end <= bs or s_start >= be)
            pids = set()
            if b.get("performer_id"):
                pids.add(b["performer_id"])
            for pe in b.get("performers") or []:
                if pe.get("staff_id"):
                    pids.add(pe["staff_id"])
            for pid in pids:
                load[pid] = load.get(pid, 0) + 1
                if slot_overlap:
                    busy_pids.add(pid)
        # Build candidates
        candidates = []
        for s in staff:
            sid = s["id"]
            eff = effective_map.get(sid) or {}
            if not eff.get("is_working"):
                continue
            ww = [(w["start"], w["end"]) for w in eff.get("work_windows") or []]
            br = [(b["start"], b["end"]) for b in eff.get("block_ranges") or []]
            if not slot_fits(ww, br, s_start, s_end):
                continue
            if sid in busy_pids:
                continue
            candidates.append((load.get(sid, 0), sid))
        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

    @api.get("/bookings/available-performers")
    async def available_performers(
        date: str = Query(..., description="YYYY-MM-DD"),
        time: str = Query(..., description="HH:MM"),
        duration: int = Query(30, ge=5, le=480),
        treatment: Optional[str] = None,
        package_id: Optional[str] = None,
        booking_type: Optional[str] = None,
        role: Optional[str] = Query(None, description="Filter by staff role: doctor | therapist | nurse"),
        exclude_booking_id: Optional[str] = Query(None),
        is_overtime: bool = Query(False, description="Overtime: allow outside working hours if staff is working that day"),
        user: dict = Depends(get_current_user),
    ):
        """Return staff members who are eligible for this treatment AND on duty AND free at this slot.
        Used by the FO 'New Booking' modal to filter the performer dropdown.
        When is_overtime=true, staff must be working that day but may be outside work windows; overlap still applies.
        """
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only FO, owner, or manager can view performer availability")
        cid = user.get("clinic_id")
        scheduled_at = f"{date}T{time}:00"
        try:
            sched = _parse_iso(scheduled_at)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date/time")

        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "closed_dates": 1})
        if any(cd.get("date") == date for cd in ((c or {}).get("closed_dates") or [])):
            return {"performers": [], "closed": True, "reason": "Clinic closed on this date"}
        performer_type = "either"
        if treatment or package_id:
            performer_type = await _resolve_performer_type(cid, treatment or "", package_id, booking_type)
        if role and role in CLINICAL_PERFORMER_ROLES:
            role_filter = [role]
        else:
            role_filter = await _resolve_allowed_roles(cid, treatment or "", package_id, booking_type)
        staff = await db.users.find(
            {"clinic_id": cid, "role": {"$in": role_filter}, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "role": 1},
        ).to_list(200)

        # Load counts for sorting (all bookings today, not only overlapping)
        day_existing = await db.bookings.find({
            "clinic_id": cid,
            "scheduled_at": {"$gte": f"{date}T00:00:00", "$lte": f"{date}T23:59:59"},
            "status": {"$in": SLOT_OCCUPYING_STATUSES},
        }, {"_id": 0, "id": 1, "scheduled_at": 1, "duration_min": 1, "performer_id": 1, "performers": 1}).to_list(500)
        load: Dict[str, int] = {}
        for b in day_existing:
            if exclude_booking_id and b.get("id") == exclude_booking_id:
                continue
            pids = set()
            if b.get("performer_id"):
                pids.add(b["performer_id"])
            for pe in b.get("performers") or []:
                if pe.get("staff_id"):
                    pids.add(pe["staff_id"])
            for pid in pids:
                load[pid] = load.get(pid, 0) + 1

        effective_map = await resolve_effective_day_batch(db, cid, [s["id"] for s in staff], date)

        out = []
        for s in staff:
            sid = s["id"]
            eff = effective_map.get(sid) or {}
            if is_overtime:
                if not eff.get("is_working"):
                    continue
                if not await _is_staff_free_at_slot(
                    cid, sid, scheduled_at, duration, exclude_booking_id, require_on_duty=False,
                ):
                    continue
            elif not await _is_staff_free_at_slot(cid, sid, scheduled_at, duration, exclude_booking_id):
                continue
            out.append({"id": sid, "name": s["name"], "role": s["role"], "bookings_today": load.get(sid, 0)})
        out.sort(key=lambda p: (p["bookings_today"], p["name"]))
        suggested = out[0]["id"] if out else None
        return {"performers": out, "closed": False, "performer_type": performer_type, "suggested_performer_id": suggested}

    def _can_manage_coupons(user: dict) -> bool:
        return user_has_permission(user, "coupons.manage")

    async def _resolve_booking_subtotal(
        cid: str,
        booking_type: str,
        treatment_name: str,
        package_id: Optional[str],
    ) -> int:
        if booking_type == "package" or package_id:
            flt: Dict[str, Any] = {"clinic_id": cid}
            if package_id:
                flt["id"] = package_id
            else:
                flt["name"] = treatment_name
            pkg = await db.packages.find_one(flt, {"_id": 0, "price_idr": 1})
            if pkg:
                return int(pkg.get("price_idr") or 0)
        t = await db.treatments.find_one(
            {"clinic_id": cid, "name": treatment_name},
            {"_id": 0, "price_idr": 1},
        )
        if t:
            return int(t.get("price_idr") or 0)
        return 0

    async def _lookup_coupon(cid: str, code: str) -> Optional[dict]:
        norm = normalize_coupon_code(code)
        if not norm:
            return None
        return await db.coupons.find_one({"clinic_id": cid, "code": norm}, {"_id": 0})

    async def _pricing_with_coupon(
        cid: str,
        subtotal_idr: int,
        coupon_code: Optional[str],
    ) -> Dict[str, Any]:
        subtotal_idr = max(0, int(subtotal_idr or 0))
        if not coupon_code or not str(coupon_code).strip():
            return {
                "subtotal_idr": subtotal_idr,
                "discount_idr": 0,
                "total_idr": subtotal_idr,
                "coupon_code": None,
                "coupon_id": None,
            }
        coupon = await _lookup_coupon(cid, coupon_code)
        if not coupon:
            raise HTTPException(status_code=400, detail="Invalid coupon code")
        err = coupon_is_valid_now(coupon, subtotal_idr)
        if err:
            raise HTTPException(status_code=400, detail=err)
        prices = apply_coupon_to_subtotal(coupon, subtotal_idr)
        return {
            **prices,
            "coupon_code": coupon["code"],
            "coupon_id": coupon["id"],
        }

    async def _increment_coupon_use(cid: str, coupon_id: Optional[str]) -> None:
        if coupon_id:
            await db.coupons.update_one(
                {"clinic_id": cid, "id": coupon_id},
                {"$inc": {"uses_count": 1}},
            )

    @api.get("/coupons")
    async def list_coupons(user: dict = Depends(get_current_user), active_only: bool = False):
        if not _can_manage_coupons(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        flt = scope(user)
        if active_only:
            flt["active"] = True
        return await db.coupons.find(flt, {"_id": 0}).sort("code", 1).to_list(500)

    @api.post("/coupons")
    async def create_coupon(payload: CouponIn, user: dict = Depends(get_current_user)):
        if not _can_manage_coupons(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        await assert_writeable(user)
        cid = user.get("clinic_id")
        code = normalize_coupon_code(payload.code)
        if not code:
            raise HTTPException(status_code=400, detail="Coupon code is required")
        if payload.discount_type not in ("percent", "fixed"):
            raise HTTPException(status_code=400, detail="discount_type must be percent or fixed")
        existing = await db.coupons.find_one({"clinic_id": cid, "code": code}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Coupon code already exists")
        doc = build_coupon_doc(payload.model_dump(), cid, user["id"])
        doc["code"] = code
        await db.coupons.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "coupon", doc["id"], {"code": code})
        return doc

    @api.put("/coupons/{coupon_id}")
    async def update_coupon(coupon_id: str, payload: CouponUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_manage_coupons(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        await assert_writeable(user)
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "code" in upd:
            upd["code"] = normalize_coupon_code(upd["code"])
            if not upd["code"]:
                raise HTTPException(status_code=400, detail="Coupon code is required")
        if "discount_type" in upd and upd["discount_type"] not in ("percent", "fixed"):
            raise HTTPException(status_code=400, detail="discount_type must be percent or fixed")
        r = await db.coupons.update_one(scope(user, {"id": coupon_id}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Coupon not found")
        await audit(user, "update", "coupon", coupon_id, upd)
        return await db.coupons.find_one(scope(user, {"id": coupon_id}), {"_id": 0})

    @api.delete("/coupons/{coupon_id}")
    async def delete_coupon(coupon_id: str, user: dict = Depends(get_current_user)):
        if not _can_manage_coupons(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        await assert_writeable(user)
        r = await db.coupons.delete_one(scope(user, {"id": coupon_id}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Coupon not found")
        await audit(user, "delete", "coupon", coupon_id)
        return {"ok": True}

    @api.post("/bookings/validate-coupon")
    async def validate_booking_coupon(payload: CouponValidateIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Not allowed")
        cid = user.get("clinic_id")
        subtotal = int(payload.subtotal_idr or 0)
        if subtotal <= 0 and (payload.treatment or payload.package_id):
            subtotal = await _resolve_booking_subtotal(
                cid,
                payload.booking_type or "treatment",
                payload.treatment or "",
                payload.package_id,
            )
        pricing = await _pricing_with_coupon(cid, subtotal, payload.code)
        coupon = await _lookup_coupon(cid, payload.code)
        return {
            **pricing,
            "coupon_name": (coupon or {}).get("name"),
            "discount_type": (coupon or {}).get("discount_type"),
            "discount_value": (coupon or {}).get("discount_value"),
        }

    @api.post("/bookings")
    async def create_booking(payload: BookingIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Only FO, owner, or manager can create bookings")
        if user.get("role") in CLINICAL_PERFORMER_ROLES and payload.is_overtime:
            raise HTTPException(status_code=403, detail="Clinical staff cannot create overtime bookings")
        await assert_writeable(user)
        cid = user.get("clinic_id")
        is_overtime = bool(payload.is_overtime)
        booking_type = payload.booking_type or "treatment"
        package_id = payload.package_id
        treatment_name = payload.treatment
        duration_min = payload.duration_min

        if is_overtime and booking_type == "block":
            raise HTTPException(status_code=400, detail="Overtime does not apply to time blocks")

        if booking_type == "block":
            reason = (payload.block_reason or payload.patient_name or "").strip()
            if not reason:
                raise HTTPException(status_code=400, detail="Block reason is required")
            if not payload.performer_id:
                raise HTTPException(status_code=400, detail="Select a staff member to block")
            p = await db.users.find_one(
                {"id": payload.performer_id, "clinic_id": cid},
                {"_id": 0, "id": 1, "role": 1, "name": 1},
            )
            if not p:
                raise HTTPException(status_code=400, detail="Performer not found in clinic")
            if p.get("role") not in PERFORMER_SLOT_ROLES:
                raise HTTPException(status_code=400, detail="Time blocks apply to clinical performers only")
            try:
                sched_dt = _parse_iso(payload.scheduled_at)
                day_str = sched_dt.strftime("%Y-%m-%d")
                c = await db.clinics.find_one({"id": cid}, {"_id": 0, "closed_dates": 1})
                cd_match = next((cd for cd in ((c or {}).get("closed_dates") or []) if cd.get("date") == day_str), None)
                if cd_match:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Clinic is closed on {day_str}"
                        + (f" ({cd_match.get('reason')})" if cd_match.get("reason") else ""),
                    )
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid scheduled_at")
            from public_booking_time import clinic_local_now, clinic_today_str

            clinic_doc = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1})
            today_str = clinic_today_str(clinic_doc or {})
            if day_str < today_str:
                raise HTTPException(status_code=400, detail="Cannot block time in the past")
            if day_str == today_str:
                now_local = clinic_local_now(clinic_doc or {})
                start_min = sched_dt.hour * 60 + sched_dt.minute
                now_min = now_local.hour * 60 + now_local.minute
                if start_min < now_min:
                    raise HTTPException(status_code=400, detail="Cannot block time in the past")
            block_duration = int(duration_min or 30)
            if block_duration <= 0:
                raise HTTPException(status_code=400, detail="Block duration must be greater than zero")
            block_conflicts = await _enforce_booking_staff_conflicts(
                db,
                user,
                cid,
                [payload.performer_id],
                payload.scheduled_at,
                block_duration,
                overlap_override=bool(payload.overlap_override),
                overlap_override_reason=payload.overlap_override_reason,
            )
            doc = {
                "id": str(uuid.uuid4()),
                "clinic_id": cid,
                "patient_id": None,
                "patient_name": reason,
                "patient_phone": (payload.patient_phone or "").strip() or "—",
                "patient_email": "",
                "treatment": "Blocked",
                "duration_min": block_duration,
                "scheduled_at": payload.scheduled_at,
                "performer_id": payload.performer_id,
                "notes": (payload.notes or "").strip(),
                "booking_type": "block",
                "block_reason": reason,
                "package_id": None,
                "subtotal_idr": 0,
                "discount_idr": 0,
                "total_idr": 0,
                "coupon_code": None,
                "coupon_id": None,
                "status": "blocked",
                "source": "fo",
                "wa_history": [],
                "created_at": iso(now_utc()),
                "created_by": user["id"],
            }
            if block_conflicts and bool(payload.overlap_override):
                from booking_conflicts import apply_overlap_override_fields
                apply_overlap_override_fields(doc, user, block_conflicts, payload.overlap_override_reason)
                from audit_log import log_appointment_overlap_override
                await log_appointment_overlap_override(
                    db, user, doc["id"], block_conflicts, payload.overlap_override_reason or "",
                )
            await db.bookings.insert_one(doc)
            doc.pop("_id", None)
            await audit(user, "create", "booking", doc["id"], {"booking_type": "block", "reason": reason})
            return doc

        if booking_type == "package" or package_id:
            flt: Dict[str, Any] = {"clinic_id": cid, "active": True}
            if package_id:
                flt["id"] = package_id
            else:
                flt["name"] = treatment_name
            pkg = await db.packages.find_one(flt, {"_id": 0})
            if not pkg:
                raise HTTPException(status_code=400, detail="Package not found")
            booking_type = "package"
            package_id = pkg["id"]
            treatment_name = pkg["name"]
            if not duration_min or duration_min == 30:
                duration_min = int(pkg.get("duration_min") or 60)

        treatment_doc = await _get_treatment_doc(cid, treatment_name, package_id, booking_type)
        allowed_roles = normalize_allowed_performer_roles(treatment_doc)
        allow_multiple = treatment_allows_multiple(treatment_doc)
        raw_performers = [p.model_dump() for p in payload.performers] if payload.performers else None

        if not raw_performers and not payload.performer_id:
            staff_count = await db.users.count_documents(
                {"clinic_id": cid, "role": {"$in": allowed_roles}, "active": {"$ne": False}},
            )
            if staff_count > 0:
                auto = await _auto_pick_performer(
                    cid, treatment_name, payload.scheduled_at, duration_min, package_id, booking_type,
                )
                if auto:
                    payload.performer_id = auto
                else:
                    raise HTTPException(status_code=409, detail="No performer available at this slot")

        performers = await normalize_performers_input(
            db,
            cid,
            raw_performers,
            legacy_performer_id=payload.performer_id,
            allowed_roles=list(CLINICAL_PERFORMER_ROLES),
            primary_allowed_roles=allowed_roles,
            allow_multiple=allow_multiple,
            require_at_least_one=(booking_type == "treatment"),
        )
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
        staff_ids_booking = staff_ids_from_performers({"performers": performers})
        primary_pid = primary_performer_id({"performers": performers}) or payload.performer_id

        overlap_conflicts: Optional[List[dict]] = None
        if is_overtime:
            ot_reason = (payload.overtime_reason or "").strip()
            ot_note = (payload.overtime_note or "").strip()
            if not ot_reason:
                raise HTTPException(status_code=400, detail="Overtime reason is required")
            if ot_reason not in OVERTIME_REASONS:
                raise HTTPException(status_code=400, detail="Invalid overtime reason")
            if not ot_note:
                raise HTTPException(status_code=400, detail="Overtime note is required")
            if not primary_pid:
                raise HTTPException(status_code=400, detail="Select a performer for overtime")
            await _validate_overtime_booking(user, cid, primary_pid, payload.scheduled_at, duration_min)
            for sid in staff_ids_booking:
                if sid == primary_pid:
                    continue
                found = await _enforce_booking_staff_conflicts(
                    db,
                    user,
                    cid,
                    [sid],
                    payload.scheduled_at,
                    duration_min,
                    overlap_override=bool(payload.overlap_override),
                    overlap_override_reason=payload.overlap_override_reason,
                )
                if found:
                    overlap_conflicts = (overlap_conflicts or []) + [
                        c for c in found if not any(x.get("id") == c.get("id") for x in (overlap_conflicts or []))
                    ]
        else:
            overlap_conflicts = await _enforce_booking_staff_conflicts(
                db,
                user,
                cid,
                staff_ids_booking,
                payload.scheduled_at,
                duration_min,
                overlap_override=bool(payload.overlap_override),
                overlap_override_reason=payload.overlap_override_reason,
            )
        subtotal = await _resolve_booking_subtotal(cid, booking_type, treatment_name, package_id)
        b = payload.model_dump()
        b["treatment"] = treatment_name
        b["duration_min"] = duration_min
        b["booking_type"] = booking_type
        b["package_id"] = package_id if booking_type == "package" else None
        b["subtotal_idr"] = subtotal
        b["discount_idr"] = 0
        b["total_idr"] = subtotal
        b["coupon_code"] = None
        b["coupon_id"] = None
        b["performers"] = performers
        sync_legacy_performer_fields(b)
        await _apply_staff_request_fields(
            b,
            db=db,
            clinic_id=cid,
            specific_staff_requested=bool(payload.specific_staff_requested),
            performer_id=_primary_performer_id_from_booking(b),
            requested_performer_id=payload.requested_performer_id,
            requested_staff_name_snapshot=payload.requested_staff_name_snapshot,
        )
        b["id"] = str(uuid.uuid4())
        b["clinic_id"] = cid
        b["status"] = "booked"
        b["source"] = "fo"
        b["wa_history"] = []
        b["created_at"] = iso(now_utc())
        b["created_by"] = user["id"]
        _apply_duration_metadata(b, payload.model_dump())
        if overlap_conflicts and bool(payload.overlap_override):
            from booking_conflicts import apply_overlap_override_fields
            apply_overlap_override_fields(b, user, overlap_conflicts, payload.overlap_override_reason)
        if is_overtime:
            b["is_overtime"] = True
            b["overtime_reason"] = (payload.overtime_reason or "").strip()
            b["overtime_note"] = (payload.overtime_note or "").strip()
            b["overtime_created_by"] = user["id"]
            b["overtime_created_at"] = iso(now_utc())
        await db.bookings.insert_one(b)
        b.pop("_id", None)
        if payload.gift_card_id:
            from gift_cards_booking import attach_gift_card_to_new_booking
            b = await attach_gift_card_to_new_booking(
                db,
                user,
                booking=b,
                gift_card_id=payload.gift_card_id.strip(),
                patient_id=b.get("patient_id"),
            )
        if b.get("booking_type") != "block":
            from audit_log import log_appointment_created, log_appointment_overlap_override
            await log_appointment_created(db, user, b)
            if overlap_conflicts and b.get("overlap_override"):
                await log_appointment_overlap_override(
                    db, user, b["id"], overlap_conflicts, payload.overlap_override_reason or "",
                )
            try:
                from messaging_automation import safe_trigger_automation_rules
                safe_trigger_automation_rules(
                    db, os.environ.get("JWT_SECRET", ""), cid, "booking_created", booking=b,
                )
            except Exception:
                pass
        else:
            await audit(user, "create", "booking", b["id"], {"booking_type": "block"})
        from clinic_realtime import safe_emit_booking_event
        if b.get("booking_type") != "block":
            safe_emit_booking_event(b, "booking_created", message="Booking created")
        return b

    @api.get("/bookings/{bid}")
    async def get_booking(bid: str, user: dict = Depends(get_current_user)):
        b = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        if user.get("role") in PERFORMER_SLOT_ROLES and user.get("id"):
            uid = user["id"]
            assigned = staff_ids_from_performers(b)
            if uid not in assigned and b.get("performer_id") != uid:
                raise HTTPException(status_code=404, detail="Booking not found")
        from booking_detail import enrich_booking_detail
        return await enrich_booking_detail(db, user["clinic_id"], b)

    @api.put("/bookings/{bid}")
    async def update_booking(bid: str, payload: BookingUpdateIn, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        existing = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Booking not found")
        if existing.get("status") in ("cancelled", "completed", "no_show"):
            notes_only = set(raw.keys()) <= {"notes"} and "notes" in raw
            if not notes_only:
                raise HTTPException(status_code=400, detail="Cannot edit a cancelled or completed booking")

        raw = payload.model_dump(exclude_unset=True)
        upd = {k: v for k, v in raw.items() if v is not None}
        if "performer_id" in raw and raw["performer_id"] is None:
            upd["performer_id"] = None

        merged = {**existing, **upd}
        cid = user.get("clinic_id")

        if existing.get("booking_type") == "block" or existing.get("status") == "blocked":
            if upd.get("patient_name"):
                upd["block_reason"] = upd["patient_name"].strip()
            schedule_changed = any(k in upd for k in ("scheduled_at", "duration_min", "performer_id"))
            if schedule_changed:
                sched_at = merged.get("scheduled_at")
                try:
                    sched_dt = _parse_iso(sched_at)
                    day_str = sched_dt.strftime("%Y-%m-%d")
                    from public_booking_time import clinic_local_now, clinic_today_str

                    clinic_doc = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1})
                    today_str = clinic_today_str(clinic_doc or {})
                    if day_str < today_str:
                        raise HTTPException(status_code=400, detail="Cannot block time in the past")
                    if day_str == today_str:
                        now_local = clinic_local_now(clinic_doc or {})
                        start_min = sched_dt.hour * 60 + sched_dt.minute
                        now_min = now_local.hour * 60 + now_local.minute
                        if start_min < now_min:
                            raise HTTPException(status_code=400, detail="Cannot block time in the past")
                except HTTPException:
                    raise
                except Exception:
                    raise HTTPException(status_code=400, detail="Invalid scheduled_at")
                block_conflicts = await _enforce_booking_staff_conflicts(
                    db,
                    user,
                    cid,
                    [merged.get("performer_id")] if merged.get("performer_id") else [],
                    sched_at,
                    int(merged.get("duration_min") or 30),
                    overlap_override=bool(upd.get("overlap_override") or raw.get("overlap_override")),
                    overlap_override_reason=upd.get("overlap_override_reason") or raw.get("overlap_override_reason"),
                    exclude_booking_id=bid,
                )
                if block_conflicts and bool(upd.get("overlap_override") or raw.get("overlap_override")):
                    from booking_conflicts import apply_overlap_override_fields
                    apply_overlap_override_fields(upd, user, block_conflicts, upd.get("overlap_override_reason"))
            if upd.get("performer_id"):
                p = await db.users.find_one({"id": upd["performer_id"], "clinic_id": cid}, {"_id": 0, "role": 1})
                if not p or p.get("role") not in ("doctor", "therapist"):
                    raise HTTPException(status_code=400, detail="Invalid performer for time block")
            r = await db.bookings.update_one(scope(user, {"id": bid}), {"$set": upd})
            if r.matched_count == 0:
                raise HTTPException(status_code=404, detail="Booking not found")
            await audit(user, "update", "booking", bid, upd)
            return await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})

        booking_type = merged.get("booking_type") or "treatment"
        package_id = merged.get("package_id")
        if upd.get("booking_type") == "package" or upd.get("package_id") or (booking_type == "package" and "treatment" in upd):
            flt: Dict[str, Any] = {"clinic_id": cid, "active": True}
            if upd.get("package_id") or package_id:
                flt["id"] = upd.get("package_id") or package_id
            else:
                flt["name"] = merged.get("treatment", "")
            pkg = await db.packages.find_one(flt, {"_id": 0})
            if not pkg:
                raise HTTPException(status_code=400, detail="Package not found")
            upd["booking_type"] = "package"
            upd["package_id"] = pkg["id"]
            upd["treatment"] = pkg["name"]
            merged["booking_type"] = "package"
            merged["package_id"] = pkg["id"]
            merged["treatment"] = pkg["name"]
            if "duration_min" not in upd:
                upd["duration_min"] = int(pkg.get("duration_min") or merged.get("duration_min") or 60)
                merged["duration_min"] = upd["duration_min"]
        elif upd.get("booking_type") == "treatment":
            upd["package_id"] = None
            merged["package_id"] = None

        performers_in_payload = "performers" in raw or "performer_id" in raw
        if performers_in_payload and existing.get("booking_type") != "block":
            treatment_doc = await _get_treatment_doc(
                cid,
                merged.get("treatment", ""),
                merged.get("package_id"),
                merged.get("booking_type"),
            )
            allowed_roles = normalize_allowed_performer_roles(treatment_doc)
            allow_multiple = treatment_allows_multiple(treatment_doc)
            raw_performers = (
                [p.model_dump() for p in payload.performers]
                if payload.performers is not None
                else None
            )
            legacy_pid = merged.get("performer_id") if "performer_id" in raw else None
            if raw_performers is None and legacy_pid is None:
                raw_performers = get_performers(existing)
            performers = await normalize_performers_input(
                db,
                cid,
                raw_performers,
                legacy_performer_id=legacy_pid or merged.get("performer_id"),
                allowed_roles=list(CLINICAL_PERFORMER_ROLES),
                primary_allowed_roles=allowed_roles,
                allow_multiple=allow_multiple,
                require_at_least_one=(merged.get("booking_type") == "treatment"),
            )
            upd["performers"] = performers
            sync_legacy_performer_fields(upd)
            merged["performers"] = upd["performers"]
            merged["performer_id"] = upd.get("performer_id")

        if upd.get("performer_id"):
            p = await db.users.find_one({"id": upd["performer_id"], "clinic_id": cid}, {"_id": 0, "id": 1})
            if not p:
                raise HTTPException(status_code=400, detail="Performer not found in clinic")

        schedule_changed = any(
            k in upd
            for k in ("scheduled_at", "duration_min", "treatment", "performer_id", "performers", "package_id", "booking_type")
        )
        if schedule_changed:
            sched_at = merged.get("scheduled_at")
            try:
                sched_dt = _parse_iso(sched_at)
                day_str = sched_dt.strftime("%Y-%m-%d")
                c = await db.clinics.find_one({"id": cid}, {"_id": 0, "closed_dates": 1})
                cd_match = next((cd for cd in ((c or {}).get("closed_dates") or []) if cd.get("date") == day_str), None)
                if cd_match:
                    raise HTTPException(status_code=409, detail=f"Clinic is closed on {day_str}" + (f" ({cd_match.get('reason')})" if cd_match.get("reason") else ""))
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid scheduled_at")
            performer_ids = staff_ids_from_performers(merged) if merged.get("performers") else (
                [merged["performer_id"]] if merged.get("performer_id") else []
            )
            overlap_conflicts = None
            if performer_ids:
                overlap_conflicts = await _enforce_booking_staff_conflicts(
                    db,
                    user,
                    cid,
                    performer_ids,
                    sched_at,
                    int(merged.get("duration_min") or 30),
                    overlap_override=bool(upd.get("overlap_override") or raw.get("overlap_override")),
                    overlap_override_reason=upd.get("overlap_override_reason") or raw.get("overlap_override_reason"),
                    exclude_booking_id=bid,
                )
            if overlap_conflicts and bool(upd.get("overlap_override") or raw.get("overlap_override")):
                from booking_conflicts import apply_overlap_override_fields
                apply_overlap_override_fields(upd, user, overlap_conflicts, upd.get("overlap_override_reason"))
            _apply_duration_metadata(upd, {**existing, **upd})

        pricing_keys = ("treatment", "package_id", "booking_type")
        if any(k in upd for k in pricing_keys):
            subtotal = await _resolve_booking_subtotal(
                cid,
                merged.get("booking_type") or "treatment",
                merged.get("treatment", ""),
                merged.get("package_id"),
            )
            upd["subtotal_idr"] = subtotal
            upd["discount_idr"] = 0
            upd["total_idr"] = subtotal
            upd["coupon_code"] = None
            upd["coupon_id"] = None

        staff_request_override_logged = None
        if "specific_staff_requested" in raw:
            await _apply_staff_request_fields(
                upd,
                db=db,
                clinic_id=cid,
                specific_staff_requested=bool(raw.get("specific_staff_requested")),
                performer_id=_primary_performer_id_from_booking({**merged, **upd}),
                requested_performer_id=raw.get("requested_performer_id") or upd.get("requested_performer_id"),
                requested_staff_name_snapshot=raw.get("requested_staff_name_snapshot"),
            )
        elif performers_in_payload or "performer_id" in upd:
            merged_for_check = {**merged, **upd}
            staff_request_override_logged = _staff_request_reassign_conflict(existing, merged_for_check)
            if staff_request_override_logged and not bool(raw.get("staff_request_override")):
                raise HTTPException(status_code=409, detail=staff_request_override_logged)

        r = await db.bookings.update_one(scope(user, {"id": bid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        updated = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if staff_request_override_logged and bool(raw.get("staff_request_override")):
            from audit_log import log_staff_request_override
            await log_staff_request_override(
                db,
                user,
                bid,
                old_staff_id=existing.get("performer_id") or "",
                new_staff_id=updated.get("performer_id") or "",
                requested_staff_id=staff_request_override_logged["requested_staff_id"],
                requested_staff_name=staff_request_override_logged["requested_staff_name"],
                reason=raw.get("staff_request_override_reason"),
            )
        if "notes" in upd:
            from audit_log import log_booking_note_updated
            await log_booking_note_updated(
                db, user, bid,
                old_note=existing.get("notes") or "",
                new_note=updated.get("notes") or "",
            )
        if existing.get("booking_type") != "block" and existing.get("status") != "blocked":
            from audit_log import (
                log_appointment_rescheduled,
                log_performer_changes,
                log_appointment_overlap_override,
                log_appointment_schedule_changed,
            )
            change_source = upd.get("schedule_change_source") or raw.get("schedule_change_source") or ""
            if change_source and schedule_changed:
                await log_appointment_schedule_changed(
                    db, user, bid, existing, updated, change_source=change_source,
                )
            else:
                await log_performer_changes(
                    db, user, bid, get_performers(existing), get_performers(updated),
                )
                if (
                    existing.get("scheduled_at") != updated.get("scheduled_at")
                    or existing.get("duration_min") != updated.get("duration_min")
                ):
                    await log_appointment_rescheduled(db, user, bid, existing, updated)
            if updated.get("overlap_override") and schedule_changed:
                from booking_conflicts import find_staff_slot_conflicts

                perf_ids = staff_ids_from_performers(updated) or (
                    [updated["performer_id"]] if updated.get("performer_id") else []
                )
                conflicts_logged: List[dict] = []
                for sid in perf_ids:
                    found = await find_staff_slot_conflicts(
                        db,
                        cid,
                        sid,
                        updated.get("scheduled_at", ""),
                        int(updated.get("duration_min") or 30),
                        exclude_booking_id=bid,
                    )
                    for c in found:
                        if not any(x.get("id") == c.get("id") for x in conflicts_logged):
                            conflicts_logged.append(c)
                if conflicts_logged:
                    await log_appointment_overlap_override(
                        db,
                        user,
                        bid,
                        conflicts_logged,
                        upd.get("overlap_override_reason") or "",
                    )
                try:
                    from messaging import safe_trigger_booking_messaging
                    safe_trigger_booking_messaging(db, os.environ["JWT_SECRET"], cid, updated, "rescheduled")
                except Exception:
                    pass
        from clinic_realtime import safe_emit_booking_event
        msg = "Booking updated"
        if get_performers(existing) != get_performers(updated):
            msg = "Performer assigned to booking"
        safe_emit_booking_event(updated, "booking_updated", message=msg)
        return updated

    @api.put("/bookings/{bid}/status")
    async def transition_status(bid: str, payload: BookingStatusIn, user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "appointments.edit") and user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        existing = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Booking not found")
        if existing.get("status") == "blocked" and payload.status != "cancelled":
            raise HTTPException(status_code=400, detail="Time blocks can only be cancelled")

        from booking_detail import apply_booking_status_change, SENSITIVE_STATUS_CHANGES

        new_status = (payload.status or "").strip().lower()
        if new_status in SENSITIVE_STATUS_CHANGES and new_status not in ("closed",):
            if new_status == "cancelled" and existing.get("booking_type") != "block":
                pass  # confirmed via reason in apply or frontend

        updated = await apply_booking_status_change(
            db, user, existing, new_status, reason=payload.reason,
        )

        if new_status == "cancelled" and existing.get("booking_type") != "block":
            from gift_cards_booking import release_gift_card_for_cancelled_booking
            await release_gift_card_for_cancelled_booking(db, user, bid)
            from audit_log import log_appointment_cancelled
            await log_appointment_cancelled(db, user, bid, existing, reason=payload.reason or "")

        try:
            from messaging import safe_trigger_booking_messaging
            if new_status == "confirmed":
                safe_trigger_booking_messaging(db, os.environ["JWT_SECRET"], user["clinic_id"], updated, "confirmed")
            elif new_status == "cancelled":
                safe_trigger_booking_messaging(db, os.environ["JWT_SECRET"], user["clinic_id"], updated, "cancelled")
        except Exception:
            pass

        from booking_detail import enrich_booking_detail
        from clinic_realtime import safe_emit_booking_event
        evt_msg = "Booking cancelled" if new_status == "cancelled" else f"Booking status: {new_status}"
        safe_emit_booking_event(updated, "booking_updated", message=evt_msg)
        return await enrich_booking_detail(db, user["clinic_id"], updated)

    @api.post("/bookings/{bid}/start-visit")
    async def start_visit_from_booking(bid: str, user: dict = Depends(get_current_user)):
        """Check in (if needed) and create a visit from this booking in one step."""
        if user.get("role") not in ("super_admin", "fo", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        cid = user.get("clinic_id")
        booking = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking.get("booking_type") == "block" or booking.get("status") == "blocked":
            raise HTTPException(status_code=400, detail="Cannot start a visit from a time block")
        clinic = await db.clinics.find_one({"id": cid}, {"_id": 0, "subscription": 1})
        from saas import get_clinic_features
        seed_emr = "emr" in get_clinic_features(clinic or {})
        try:
            visit = await create_visit_from_booking(
                db, booking, cid, user["id"], check_in=True, seed_emr=seed_emr,
            )
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex
        await audit(user, "start_visit", "booking", bid, {"visit_id": visit["id"]})
        updated_booking = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        return {"visit": visit, "booking": updated_booking}

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
        await assert_writeable(user)
        existing = await db.bookings.find_one(scope(user, {"id": bid}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Booking not found")
        r = await db.bookings.update_one(
            scope(user, {"id": bid}),
            {"$set": {"status": "cancelled", "status_updated_at": iso(now_utc())}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
        if existing.get("booking_type") != "block":
            from gift_cards_booking import release_gift_card_for_cancelled_booking
            await release_gift_card_for_cancelled_booking(db, user, bid)
            from audit_log import log_appointment_cancelled
            await log_appointment_cancelled(db, user, bid, existing)
            try:
                from messaging import safe_trigger_booking_messaging
                cancelled = {**existing, "status": "cancelled"}
                safe_trigger_booking_messaging(db, os.environ["JWT_SECRET"], user.get("clinic_id"), cancelled, "cancelled")
            except Exception:
                pass
        else:
            await audit(user, "cancel", "booking", bid)
        from clinic_realtime import safe_emit_booking_event
        safe_emit_booking_event(
            {**existing, "status": "cancelled"},
            "booking_updated",
            message="Booking cancelled",
        )
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
                "service_code": t["key"],
                "name": t["name"],
                "category": t.get("category", "general"),
                "sub_category": "",
                "business_unit": "Default",
                "service_type": "None",
                "tax_included": True,
                "tax_group": "",
                "performer_type": t.get("performer_type", "therapist"),
                "duration_min": t["duration_min"],
                "price_idr": t["price_idr"],
                "slots_per_session": 1,
                "active": True,
                "description": "",
                "created_at": iso(now_utc()),
            })

    def _catalog_apply_search(flt: dict, q: Optional[str], search_fields: List[str]) -> dict:
        out = dict(flt)
        if q:
            out["$or"] = [{field: {"$regex": q, "$options": "i"}} for field in search_fields]
        return out

    async def _catalog_list_paginated(
        collection,
        flt: dict,
        page: int,
        page_size: int,
        sort_field: str = "name",
        facet_field: Optional[str] = None,
        clinic_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        total = await collection.count_documents(flt)
        skip = (page - 1) * page_size
        items = await collection.find(flt, {"_id": 0}).sort(sort_field, 1).skip(skip).limit(page_size).to_list(page_size)
        total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
        result: Dict[str, Any] = {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": total_pages,
        }
        if facet_field and clinic_id:
            facets = await collection.distinct(facet_field, {"clinic_id": clinic_id})
            result["facets"] = sorted(x for x in facets if x)
        return result

    @api.get("/treatments-catalog")
    async def treatments_catalog(
        user: dict = Depends(get_current_user),
        active_only: bool = False,
        q: Optional[str] = None,
        category: Optional[str] = None,
        page: Optional[int] = Query(None, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        include_facets: bool = False,
    ):
        _assert_catalog_view(user, "treatments")
        c = await get_active_clinic(user)
        cid = c["id"]
        await _seed_default_treatments(cid)
        flt: Dict[str, Any] = {"clinic_id": cid}
        if active_only:
            flt["active"] = True
        if category:
            flt["category"] = category
        flt = _catalog_apply_search(
            flt,
            q,
            ["name", "service_code", "key", "category", "sub_category", "business_unit"],
        )
        if page is not None:
            return await _catalog_list_paginated(
                db.treatments, flt, page, page_size, facet_field="category", clinic_id=cid,
            )
        rows = await db.treatments.find(flt, {"_id": 0}).sort("name", 1).to_list(2000)
        if include_facets:
            facets = await db.treatments.distinct("category", {"clinic_id": cid})
            return {"items": rows, "facets": sorted(x for x in facets if x)}
        return rows

    @api.post("/treatments-catalog")
    async def create_treatment(payload: TreatmentCatalogIn, user: dict = Depends(get_current_user)):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_writeable(user)
        await assert_feature(user, "treatments")
        cid = user.get("clinic_id")
        t = payload.model_dump()
        t["id"] = str(uuid.uuid4())
        t["clinic_id"] = cid
        code = (t.get("service_code") or "").strip()
        t["service_code"] = code or t["name"].lower().replace(" ", "_")[:32]
        t["key"] = t["service_code"][:32]
        t.setdefault("sub_category", "")
        t.setdefault("business_unit", "Default")
        t.setdefault("service_type", "None")
        t.setdefault("tax_included", True)
        t.setdefault("tax_group", "")
        t["created_at"] = iso(now_utc())
        t["created_by"] = user["id"]
        await db.treatments.insert_one(t)
        t.pop("_id", None)
        await audit(user, "create", "treatment", t["id"], {"name": t["name"]})
        return t

    @api.put("/treatments-catalog/{tid}")
    async def update_treatment(tid: str, payload: TreatmentCatalogUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_writeable(user)
        await assert_feature(user, "treatments")
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "service_code" in upd and upd["service_code"]:
            upd["key"] = upd["service_code"][:32]
        elif "name" in upd:
            upd["key"] = upd["name"].lower().replace(" ", "_")[:32]
        r = await db.treatments.update_one(scope(user, {"id": tid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Treatment not found")
        await audit(user, "update", "treatment", tid, upd)
        return await db.treatments.find_one(scope(user, {"id": tid}), {"_id": 0})

    @api.delete("/treatments-catalog/{tid}")
    async def delete_treatment(tid: str, user: dict = Depends(get_current_user)):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_writeable(user)
        await assert_feature(user, "treatments")
        r = await db.treatments.delete_one(scope(user, {"id": tid}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Treatment not found")
        await audit(user, "delete", "treatment", tid)
        return {"ok": True}

    @api.get("/treatments-catalog/export")
    async def export_treatments_catalog(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_feature(user, "treatments")
        c = await get_active_clinic(user)
        cid = c["id"]
        await _seed_default_treatments(cid)
        rows_db = await db.treatments.find({"clinic_id": cid}, {"_id": 0}).sort("name", 1).to_list(2000)
        export_rows = [treatment_to_export_row(t) for t in rows_db]
        if format.lower() == "csv":
            csv_text = rows_to_csv(export_rows)
            filename = f"treatments-{c.get('slug', 'clinic')}.csv"
            return Response(
                content=csv_text,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        xlsx_bytes = treatment_rows_to_xlsx(export_rows)
        filename = f"treatments-{c.get('slug', 'clinic')}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @api.get("/treatments-catalog/import-template")
    async def treatments_import_template(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_feature(user, "treatments")
        if format.lower() == "csv":
            csv_text = rows_to_csv([])
            return Response(
                content=csv_text,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="treatments-import-template.csv"'},
            )
        xlsx_bytes = treatment_rows_to_xlsx([])
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="treatments-import-template.xlsx"'},
        )

    @api.post("/treatments-catalog/import")
    async def import_treatments_catalog(
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage_treatments(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage treatments")
        await assert_writeable(user)
        await assert_feature(user, "treatments")
        cid = user.get("clinic_id")
        raw = await file.read()
        fname = (file.filename or "").lower()
        parsed: List[dict] = []
        parse_errors: List[dict] = []
        if fname.endswith(".xlsx") or fname.endswith(".xlsm") or raw[:2] == b"PK":
            try:
                parsed, parse_errors = parse_treatment_xlsx(raw)
            except RuntimeError as ex:
                raise HTTPException(status_code=500, detail=str(ex)) from ex
        else:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            parsed, parse_errors = parse_csv_text(text)
        if not parsed and parse_errors:
            raise HTTPException(status_code=400, detail=parse_errors[0]["message"])

        existing_rows = await db.treatments.find({"clinic_id": cid}, {"_id": 0}).to_list(5000)
        lookup = build_treatment_lookup(existing_rows)

        created = 0
        updated = 0
        errors = list(parse_errors)

        for i, row in enumerate(parsed, start=2):
            match = find_treatment_match(row, lookup)
            try:
                doc = build_treatment_doc(row, cid, user["id"], existing=match)
                if match:
                    await db.treatments.update_one(
                        {"clinic_id": cid, "id": match["id"]},
                        {"$set": {k: v for k, v in doc.items() if k not in ("id", "clinic_id", "created_at", "created_by")}},
                    )
                    register_treatment_in_lookup(lookup, doc)
                    updated += 1
                else:
                    await db.treatments.insert_one(doc)
                    register_treatment_in_lookup(lookup, doc)
                    created += 1
            except Exception as ex:
                errors.append({"row": i, "message": str(ex)})

        await audit(user, "import", "treatment", "", {"created": created, "updated": updated, "errors": len(errors)})
        return {"created": created, "updated": updated, "errors": errors, "total": len(parsed)}

    @api.get("/packages-catalog/export")
    async def export_packages_catalog(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_feature(user, "packages")
        c = await get_active_clinic(user)
        cid = c["id"]
        rows_db = await db.packages.find({"clinic_id": cid}, {"_id": 0}).sort("name", 1).to_list(2000)
        export_rows = [package_to_export_row(p) for p in rows_db]
        if format.lower() == "csv":
            csv_text = package_rows_to_csv(export_rows)
            filename = f"packages-{c.get('slug', 'clinic')}.csv"
            return Response(
                content=csv_text,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        xlsx_bytes = package_rows_to_xlsx(export_rows)
        filename = f"packages-{c.get('slug', 'clinic')}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @api.get("/packages-catalog/import-template")
    async def packages_import_template(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_feature(user, "packages")
        if format.lower() == "csv":
            csv_text = package_rows_to_csv([])
            return Response(
                content=csv_text,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="packages-import-template.csv"'},
            )
        xlsx_bytes = package_rows_to_xlsx([])
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="packages-import-template.xlsx"'},
        )

    @api.post("/packages-catalog/import")
    async def import_packages_catalog(
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_writeable(user)
        await assert_feature(user, "packages")
        cid = user.get("clinic_id")
        raw = await file.read()
        fname = (file.filename or "").lower()
        parsed: List[dict] = []
        parse_errors: List[dict] = []
        if fname.endswith(".xlsx") or fname.endswith(".xlsm") or raw[:2] == b"PK":
            try:
                parsed, parse_errors = parse_package_xlsx(raw)
            except RuntimeError as ex:
                raise HTTPException(status_code=500, detail=str(ex)) from ex
        else:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            parsed, parse_errors = parse_package_csv(text)
        if not parsed and parse_errors:
            raise HTTPException(status_code=400, detail=parse_errors[0]["message"])

        existing_rows = await db.packages.find({"clinic_id": cid}, {"_id": 0}).to_list(5000)
        by_code = {(p.get("package_code") or p.get("key") or "").lower(): p for p in existing_rows if (p.get("package_code") or p.get("key"))}
        by_name = {p.get("name", "").lower(): p for p in existing_rows if p.get("name")}

        created = 0
        updated = 0
        errors = list(parse_errors)

        for i, row in enumerate(parsed, start=2):
            code_key = row["package_code"].lower()
            match = by_code.get(code_key) or by_name.get(row["name"].lower())
            try:
                doc = build_package_doc(row, cid, user["id"], existing=match)
                if match:
                    await db.packages.update_one(
                        {"clinic_id": cid, "id": match["id"]},
                        {"$set": {k: v for k, v in doc.items() if k not in ("id", "clinic_id")}},
                    )
                    by_code[code_key] = doc
                    by_name[row["name"].lower()] = doc
                    updated += 1
                else:
                    await db.packages.insert_one(doc)
                    by_code[code_key] = doc
                    by_name[row["name"].lower()] = doc
                    created += 1
            except Exception as ex:
                errors.append({"row": i, "message": str(ex)})

        await audit(user, "import", "package", "", {"created": created, "updated": updated, "errors": len(errors)})
        return {"created": created, "updated": updated, "errors": errors, "total": len(parsed)}

    @api.get("/packages-catalog")
    async def packages_catalog(
        user: dict = Depends(get_current_user),
        active_only: bool = False,
        q: Optional[str] = None,
        package_type: Optional[str] = None,
        page: Optional[int] = Query(None, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ):
        _assert_catalog_view(user, "packages")
        c = await get_active_clinic(user)
        cid = c["id"]
        flt: Dict[str, Any] = {"clinic_id": cid}
        if active_only:
            flt["active"] = True
        if package_type:
            flt["package_type"] = package_type
        flt = _catalog_apply_search(
            flt,
            q,
            ["name", "package_code", "key", "category", "package_type", "business_unit"],
        )
        if page is not None:
            return await _catalog_list_paginated(
                db.packages, flt, page, page_size, facet_field="package_type", clinic_id=cid,
            )
        rows = await db.packages.find(flt, {"_id": 0}).sort("name", 1).to_list(2000)
        return rows

    @api.post("/packages-catalog")
    async def create_package(payload: PackageCatalogIn, user: dict = Depends(get_current_user)):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_writeable(user)
        await assert_feature(user, "packages")
        cid = user.get("clinic_id")
        from package_engine import normalize_catalog_components, normalize_catalog_doc, normalize_package_type

        p = payload.model_dump(exclude_none=True)
        ptype = p.get("package_type") or "series_package"
        components = await normalize_catalog_components(
            db, cid, ptype,
            [c if isinstance(c, dict) else c for c in (p.get("components") or [])],
            sessions_total=p.get("sessions_total", 6),
            series_treatment_id=p.get("series_treatment_id"),
        )
        p["components"] = components
        p["id"] = str(uuid.uuid4())
        p["clinic_id"] = cid
        code = (p.get("package_code") or "").strip()
        p["package_code"] = code or p["name"][:32]
        p["key"] = p["package_code"][:32]
        p.setdefault("category", "Default")
        p.setdefault("business_unit", "Default")
        p["created_at"] = iso(now_utc())
        p["created_by"] = user["id"]
        p = normalize_catalog_doc(p)
        await db.packages.insert_one(p)
        p.pop("_id", None)
        await audit(user, "create", "package", p["id"], {"name": p["name"]})
        return p

    @api.put("/packages-catalog/{pid}")
    async def update_package(pid: str, payload: PackageCatalogUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_writeable(user)
        await assert_feature(user, "packages")
        cid = user.get("clinic_id")
        from package_engine import normalize_catalog_components, normalize_catalog_doc, normalize_package_type

        existing = await db.packages.find_one(scope(user, {"id": pid}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Package not found")

        upd = {k: v for k, v in payload.model_dump(exclude_none=True).items() if v is not None}
        ptype = upd.get("package_type") or existing.get("package_type") or "series_package"
        rebuild_components = any(k in upd for k in ("components", "series_treatment_id", "sessions_total", "package_type"))
        if rebuild_components:
            comp_in = upd.get("components")
            if comp_in is None and normalize_package_type(ptype) != "series_package":
                comp_in = existing.get("components")
            series_tid = upd.get("series_treatment_id")
            if not series_tid and normalize_package_type(ptype) == "series_package":
                series_tid = ((existing.get("components") or [{}])[0].get("treatment_id"))
            components = await normalize_catalog_components(
                db, cid, ptype, comp_in,
                sessions_total=upd.get("sessions_total", existing.get("sessions_total", 6)),
                series_treatment_id=series_tid,
            )
            upd["components"] = components
        if "package_code" in upd and upd["package_code"]:
            upd["key"] = upd["package_code"][:32]
        elif "name" in upd:
            upd["key"] = (upd.get("package_code") or upd["name"])[:32]
        upd = normalize_catalog_doc({**existing, **upd})
        await db.packages.update_one(scope(user, {"id": pid}), {"$set": upd})
        await audit(user, "update", "package", pid, upd)
        return await db.packages.find_one(scope(user, {"id": pid}), {"_id": 0})

    @api.delete("/packages-catalog/{pid}")
    async def delete_package(pid: str, user: dict = Depends(get_current_user)):
        if not _can_manage_packages(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage packages catalog")
        await assert_writeable(user)
        await assert_feature(user, "packages")
        r = await db.packages.delete_one(scope(user, {"id": pid}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Package not found")
        await audit(user, "delete", "package", pid)
        return {"ok": True}

    def _can_view_products(user: dict) -> bool:
        if user.get("role") in ("super_admin", "fo", "manager"):
            return True
        return user_has_permission(user, "inventory.view") or user_has_permission(user, "inventory.usage_record")

    def _can_manage_products(user: dict) -> bool:
        return user_has_permission(user, "products.manage")

    async def _require_products_feature(user: dict) -> None:
        await assert_feature(user, "products")

    @api.get("/products-catalog")
    async def products_catalog(
        user: dict = Depends(get_current_user),
        active_only: bool = False,
        active: Optional[bool] = Query(None),
        q: Optional[str] = None,
        category: Optional[str] = None,
        product_type: Optional[str] = None,
        stock_status: Optional[str] = Query(None, description="out | low | in"),
        page: Optional[int] = Query(None, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ):
        if not _can_view_products(user):
            raise HTTPException(status_code=403, detail="Not allowed to view products")
        await _require_products_feature(user)
        c = await get_active_clinic(user)
        cid = c["id"]
        flt: Dict[str, Any] = {"clinic_id": cid}
        if active is not None:
            flt["active"] = active
        elif active_only:
            flt["active"] = True
        if category:
            flt["category"] = category
        if product_type:
            flt["product_type"] = product_type
        ss = (stock_status or "").strip().lower()
        if ss == "out":
            flt["$expr"] = {"$lte": [{"$ifNull": ["$current_stock", 0]}, 0]}
        elif ss == "low":
            flt["$expr"] = {
                "$and": [
                    {"$gt": [{"$ifNull": ["$current_stock", 0]}, 0]},
                    {"$lte": [{"$ifNull": ["$current_stock", 0]}, {"$ifNull": ["$minimum_stock", 0]}]},
                ]
            }
        elif ss == "in":
            flt["$expr"] = {"$gt": [{"$ifNull": ["$current_stock", 0]}, {"$ifNull": ["$minimum_stock", 0]}]}
        flt = _catalog_apply_search(
            flt,
            q,
            ["name", "product_code", "key", "brand", "category", "sub_category", "business_unit", "product_type", "amount", "unit", "notes"],
        )
        if page is not None:
            return await _catalog_list_paginated(
                db.products, flt, page, page_size, facet_field="category", clinic_id=cid,
            )
        rows = await db.products.find(flt, {"_id": 0}).sort("name", 1).to_list(2000)
        return rows

    @api.post("/products-catalog")
    async def create_product(payload: ProductCatalogIn, user: dict = Depends(get_current_user)):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage products")
        await _require_products_feature(user)
        await assert_writeable(user)
        cid = user.get("clinic_id")
        p = payload.model_dump()
        p["id"] = str(uuid.uuid4())
        p["clinic_id"] = cid
        code = (p.get("product_code") or "").strip()
        p["product_code"] = code or p["name"][:32]
        p["key"] = p["product_code"][:32]
        p.setdefault("brand", "")
        p.setdefault("sub_category", "")
        p.setdefault("amount", "")
        p.setdefault("current_stock", 0)
        p.setdefault("minimum_stock", 0)
        p.setdefault("unit", "pcs")
        p.setdefault("notes", "")
        p.setdefault("pos_enabled", True)
        p.setdefault("track_stock", True)
        if p.get("sale_price_idr") is None:
            p["sale_price_idr"] = 0
        if p.get("cost_price_idr") is None:
            p["cost_price_idr"] = int(p.get("mrp_idr") or 0)
        if p.get("mrp_idr") is None:
            p["mrp_idr"] = p.get("cost_price_idr") or 0
        p["stock_updated_at"] = iso(now_utc())
        p["created_at"] = iso(now_utc())
        p["created_by"] = user["id"]
        await db.products.insert_one(p)
        p.pop("_id", None)
        await audit(user, "create", "product", p["id"], {"name": p["name"]})
        return p

    @api.put("/products-catalog/{pid}")
    async def update_product(pid: str, payload: ProductCatalogUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage products")
        await _require_products_feature(user)
        await assert_writeable(user)
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "product_code" in upd and upd["product_code"]:
            upd["key"] = upd["product_code"][:32]
        elif "name" in upd:
            upd["key"] = (upd.get("product_code") or upd["name"])[:32]
        if upd:
            upd["stock_updated_at"] = iso(now_utc())
        r = await db.products.update_one(scope(user, {"id": pid}), {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Product not found")
        await audit(user, "update", "product", pid, upd)
        return await db.products.find_one(scope(user, {"id": pid}), {"_id": 0})

    @api.delete("/products-catalog/{pid}")
    async def delete_product(pid: str, user: dict = Depends(get_current_user)):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to manage products")
        await _require_products_feature(user)
        await assert_writeable(user)
        r = await db.products.delete_one(scope(user, {"id": pid}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Product not found")
        await audit(user, "delete", "product", pid)
        return {"ok": True}

    @api.get("/products-catalog/export")
    async def export_products_catalog(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to export products")
        await _require_products_feature(user)
        c = await get_active_clinic(user)
        cid = c["id"]
        rows_db = await db.products.find({"clinic_id": cid}, {"_id": 0}).sort("name", 1).to_list(5000)
        export_rows = [product_to_export_row(p) for p in rows_db]
        if format.lower() == "csv":
            csv_text = product_rows_to_csv(export_rows)
            filename = f"products-{c.get('slug', 'clinic')}.csv"
            return Response(
                content=csv_text,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        xlsx_bytes = product_rows_to_xlsx(export_rows)
        filename = f"products-{c.get('slug', 'clinic')}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @api.get("/products-catalog/import-template")
    async def products_import_template(
        user: dict = Depends(get_current_user),
        format: str = Query("xlsx", description="xlsx or csv"),
    ):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to download import template")
        await _require_products_feature(user)
        if format.lower() == "csv":
            return Response(
                content=product_rows_to_csv([]),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="products-import-template.csv"'},
            )
        return Response(
            content=product_rows_to_xlsx([]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="products-import-template.xlsx"'},
        )

    @api.post("/products-catalog/import")
    async def import_products_catalog(
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage_products(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to import products")
        await _require_products_feature(user)
        await assert_writeable(user)
        cid = user.get("clinic_id")
        raw = await file.read()
        fname = (file.filename or "").lower()
        parsed: List[dict] = []
        parse_errors: List[dict] = []
        if fname.endswith(".xlsx") or fname.endswith(".xlsm") or raw[:2] == b"PK":
            try:
                parsed, parse_errors = parse_product_xlsx(raw)
            except RuntimeError as ex:
                raise HTTPException(status_code=500, detail=str(ex)) from ex
        else:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            parsed, parse_errors = parse_product_csv(text)
        if not parsed and parse_errors:
            raise HTTPException(status_code=400, detail=parse_errors[0]["message"])

        existing_rows = await db.products.find({"clinic_id": cid}, {"_id": 0}).to_list(10000)
        lookup = build_product_lookup(existing_rows)

        created = 0
        updated = 0
        errors = list(parse_errors)

        for i, row in enumerate(parsed, start=2):
            match = find_product_match(row, lookup)
            try:
                doc = build_product_doc(row, cid, user["id"], existing=match)
                if match:
                    await db.products.update_one(
                        {"clinic_id": cid, "id": match["id"]},
                        {"$set": {k: v for k, v in doc.items() if k not in ("id", "clinic_id", "created_at", "created_by")}},
                    )
                    register_product_in_lookup(lookup, doc)
                    updated += 1
                else:
                    await db.products.insert_one(doc)
                    register_product_in_lookup(lookup, doc)
                    created += 1
            except Exception as ex:
                errors.append({"row": i, "message": str(ex)})

        await audit(user, "import", "product", "", {"created": created, "updated": updated, "errors": len(errors)})
        return {"created": created, "updated": updated, "errors": errors, "total": len(parsed)}

    # ---------- Dashboard (Owner / FO KPIs) ----------
    @api.get("/dashboard/clinical")
    async def clinical_dashboard(user: dict = Depends(get_current_user)):
        """Assigned-only dashboard for Doctor / Therapist / Nurse."""
        from permissions import user_has_permission

        if not user_has_permission(user, "schedule.view_own") and not user_has_permission(user, "visits.view_own"):
            raise HTTPException(status_code=403, detail="Not allowed")
        cid = user.get("clinic_id")
        uid = user.get("id")
        if not cid or not uid:
            return {
                "today_bookings": [],
                "upcoming_bookings": [],
                "awaiting_notes": [],
                "recent_visits": [],
            }

        def _visit_flt(extra: Optional[dict] = None) -> dict:
            f = scope(user, extra or {})
            if user_has_permission(user, "visits.view"):
                return f
            if user_has_permission(user, "visits.view_own"):
                f.update(visit_staff_filter(uid))
            return f
        today = now_utc().strftime("%Y-%m-%d")
        now_iso = iso(now_utc())
        bflt: Dict[str, Any] = {
            **scope(user),
            **booking_staff_filter(uid),
            "booking_type": {"$ne": "block"},
        }
        today_bookings = await db.bookings.find(
            {
                **bflt,
                "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
                "status": {"$nin": ["cancelled", "no_show", "blocked"]},
            },
            {"_id": 0},
        ).sort("scheduled_at", 1).to_list(50)
        upcoming_bookings = await db.bookings.find(
            {
                **bflt,
                "scheduled_at": {"$gte": now_iso},
                "status": {"$in": APPOINTMENT_QUEUE_STATUSES + ["checked_in"]},
            },
            {"_id": 0},
        ).sort("scheduled_at", 1).to_list(20)
        role = user.get("role")
        vflt = _visit_flt({"status": {"$in": ["in_progress", "submitted"]}})
        visit_rows = await db.visits.find(vflt, {"_id": 0}).sort("created_at", -1).to_list(50)
        awaiting_notes: List[Dict[str, Any]] = []
        for v in visit_rows:
            if v.get("status") not in ("in_progress",):
                continue
            needs = False
            if role == "doctor":
                rec = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                needs = not (rec and rec.get("submitted"))
            elif role in ("therapist", "nurse"):
                rec = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                needs = not (rec and rec.get("submitted"))
            else:
                cr = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                tr = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                needs = not ((cr and cr.get("submitted")) or (tr and tr.get("submitted")))
            if needs:
                p = await db.patients.find_one({"id": v.get("patient_id")}, {"_id": 0, "full_name": 1})
                awaiting_notes.append({
                    "visit_id": v["id"],
                    "patient_name": (p or {}).get("full_name") or v.get("patient_name") or "",
                    "chief_complaint": v.get("chief_complaint") or "",
                    "status": v.get("status"),
                })
        recent_flt = _visit_flt({})
        recent_visits = await db.visits.find(recent_flt, {"_id": 0}).sort("created_at", -1).to_list(6)
        for v in recent_visits:
            p = await db.patients.find_one({"id": v.get("patient_id")}, {"_id": 0, "full_name": 1})
            v["patient_name"] = (p or {}).get("full_name") or "Unknown"
        return {
            "today_bookings": today_bookings,
            "upcoming_bookings": upcoming_bookings,
            "awaiting_notes": awaiting_notes,
            "recent_visits": recent_visits,
        }

    @api.get("/dashboard/me-queue")
    async def me_queue(user: dict = Depends(get_current_user)):
        """Role-aware 'what should I do next' queue."""
        cid = user.get("clinic_id")
        if not cid:
            return {"role": user.get("role"), "items": []}
        today = now_utc().strftime("%Y-%m-%d")
        role = user.get("role")
        items: List[Dict[str, Any]] = []

        uid = user.get("id")
        if role in ("doctor",):
            visit_flt = {"clinic_id": cid, "status": "in_progress"}
            visit_flt.update(visit_staff_filter(uid))
            visits = await db.visits.find(visit_flt, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                rec = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                if not (rec and rec.get("submitted")):
                    p = await db.patients.find_one({"id": v.get("patient_id")}, {"_id": 0, "full_name": 1})
                    items.append({
                        "kind": "visit_clinical",
                        "visit_id": v["id"],
                        "patient_name": (p or {}).get("full_name") or v.get("patient_name", ""),
                        "label": "Awaiting clinical notes",
                        "sub": v.get("chief_complaint") or "—",
                    })
            bks = await db.bookings.find({
                "clinic_id": cid,
                **booking_staff_filter(uid),
                "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
                "status": {"$in": APPOINTMENT_QUEUE_STATUSES},
                "booking_type": {"$ne": "block"},
            }, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                if is_time_block(b):
                    continue
                sub = b["status"].replace("_", " ")
                if b.get("visit_id"):
                    sub = "Visit started"
                items.append({
                    "kind": "booking",
                    "booking_id": b["id"],
                    "visit_id": b.get("visit_id"),
                    "patient_name": b["patient_name"],
                    "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}",
                    "sub": sub,
                })
        elif role == "therapist":
            visit_flt = {"clinic_id": cid, "status": "in_progress"}
            visit_flt.update(visit_staff_filter(uid))
            visits = await db.visits.find(visit_flt, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                rec = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                if not (rec and rec.get("submitted")):
                    p = await db.patients.find_one({"id": v.get("patient_id")}, {"_id": 0, "full_name": 1})
                    items.append({
                        "kind": "visit_therapist",
                        "visit_id": v["id"],
                        "patient_name": (p or {}).get("full_name") or v.get("patient_name", ""),
                        "label": "Awaiting treatment notes",
                        "sub": v.get("chief_complaint") or "—",
                    })
            bks = await db.bookings.find({
                "clinic_id": cid,
                **booking_staff_filter(uid),
                "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
                "status": {"$in": APPOINTMENT_QUEUE_STATUSES},
                "booking_type": {"$ne": "block"},
            }, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                if is_time_block(b):
                    continue
                sub = b["status"].replace("_", " ")
                if b.get("visit_id"):
                    sub = "Visit started"
                items.append({
                    "kind": "booking",
                    "booking_id": b["id"],
                    "visit_id": b.get("visit_id"),
                    "patient_name": b["patient_name"],
                    "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}",
                    "sub": sub,
                })
        elif role == "nurse":
            visit_flt = {"clinic_id": cid, "status": "in_progress"}
            visit_flt.update(visit_staff_filter(uid))
            visits = await db.visits.find(visit_flt, {"_id": 0}).sort("created_at", -1).to_list(50)
            for v in visits:
                items.append({
                    "kind": "visit_therapist",
                    "visit_id": v["id"],
                    "patient_name": v.get("patient_name", ""),
                    "label": "Assigned visit in progress",
                    "sub": v.get("chief_complaint") or "—",
                })
            bflt = {
                "clinic_id": cid,
                "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
                "status": {"$in": APPOINTMENT_QUEUE_STATUSES},
                "booking_type": {"$ne": "block"},
            }
            bflt.update(booking_staff_filter(uid))
            bks = await db.bookings.find(bflt, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                if is_time_block(b):
                    continue
                sub = b["status"].replace("_", " ")
                if b.get("visit_id"):
                    sub = "Visit started"
                items.append({
                    "kind": "booking",
                    "booking_id": b["id"],
                    "visit_id": b.get("visit_id"),
                    "patient_name": b["patient_name"],
                    "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}",
                    "sub": sub,
                })
        elif role == "fo":
            # Today's bookings that need confirmation or check-in
            bks = await db.bookings.find({"clinic_id": cid, "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}, "status": {"$in": ["booked", "confirmed"]}}, {"_id": 0}).sort("scheduled_at", 1).to_list(50)
            for b in bks:
                if b.get("visit_id"):
                    continue
                next_label = "Confirm" if b["status"] == "booked" else "Start visit"
                items.append({
                    "kind": "booking",
                    "booking_id": b["id"],
                    "patient_name": b["patient_name"],
                    "label": f"{b['treatment']} at {b['scheduled_at'][11:16]}",
                    "sub": next_label,
                })
            # Plus completed-doctor visits ready for FO completion
            visits = await db.visits.find(
                {"clinic_id": cid, "status": {"$in": ["in_progress", "submitted"]}},
                {"_id": 0},
            ).sort("created_at", -1).to_list(50)
            for v in visits:
                p = await db.patients.find_one({"id": v.get("patient_id")}, {"_id": 0, "full_name": 1})
                pname = (p or {}).get("full_name") or v.get("patient_name") or ""
                is_submitted = v.get("status") == "submitted"
                if not is_submitted:
                    cr = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                    tr = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1})
                    is_submitted = (cr and cr.get("submitted")) or (tr and tr.get("submitted"))
                inv = await db.invoices.find_one(
                    {"visit_id": v["id"], "clinic_id": cid, "payment_status": {"$nin": ["cancelled", "paid"]}},
                    {"_id": 0, "payment_status": 1},
                )
                unpaid = bool(inv) or v.get("payment_status") not in ("paid",)
                if is_submitted and unpaid:
                    sub = "Collect payment"
                elif is_submitted:
                    sub = "Ready to close"
                else:
                    sub = "Care in progress"
                items.append({
                    "kind": "visit_fo",
                    "visit_id": v["id"],
                    "booking_id": v.get("booking_id"),
                    "patient_name": pname,
                    "label": "Visit in progress",
                    "sub": sub,
                })
        elif role in ("manager", "super_admin"):
            # Manager / Owner overview — show all pending items lightly
            pending_bk = await db.bookings.count_documents({"clinic_id": cid, "status": "booked"})
            in_progress = await db.visits.count_documents({"clinic_id": cid, "status": "in_progress"})
            today_bk = await db.bookings.count_documents({
                "clinic_id": cid,
                "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
                "status": {"$nin": ["cancelled", "no_show", "blocked"]},
                "booking_type": {"$ne": "block"},
            })
            items.append({"kind": "summary", "label": f"{today_bk} bookings today", "sub": "View bookings page", "link": "/bookings"})
            items.append({"kind": "summary", "label": f"{pending_bk} pending confirmations", "sub": "FO needs to confirm", "link": "/bookings"})
            items.append({"kind": "summary", "label": f"{in_progress} visits in progress", "sub": "Doctor/therapist work pending", "link": "/visits"})

        return {"role": role, "items": items[:20]}

    # ---------- Patient stats & transactions ----------
    @api.get("/patients/{pid}/stats")
    async def patient_stats(pid: str, user: dict = Depends(get_current_user)):
        from server import assert_patient_access, apply_staff_visit_filter
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        vflt = await apply_staff_visit_filter(db, user, {"patient_id": pid})
        visit_ids = [v["id"] async for v in db.visits.find(vflt, {"_id": 0, "id": 1})]
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
        last_visit = await db.visits.find_one(vflt, {"_id": 0, "visit_date": 1, "created_at": 1}, sort=[("created_at", -1)])
        from visit_workflow import clinic_loyalty_tiers, resolve_patient_loyalty

        cid = user.get("clinic_id")
        tiers = await clinic_loyalty_tiers(db, cid)
        loyalty_fields = resolve_patient_loyalty(total_spent, tiers)
        return {
            "total_spent_idr": total_spent,
            "visits_total": visits_total,
            "treatment_items_total": item_count,
            "last_visit_at": (last_visit or {}).get("visit_date") or (last_visit or {}).get("created_at"),
            "avg_per_visit_idr": (total_spent / visits_total) if visits_total else 0,
            **loyalty_fields,
        }

    @api.get("/patients/{pid}/transactions")
    async def patient_transactions(pid: str, user: dict = Depends(get_current_user)):
        from server import assert_patient_access, apply_staff_visit_filter
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        vflt = await apply_staff_visit_filter(db, user, {"patient_id": pid})
        visits = await db.visits.find(vflt, {"_id": 0}).sort("created_at", -1).to_list(500)
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
        if not _can_view_owner_dashboard(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions for owner dashboard")
        c = await get_active_clinic(user)
        today = now_utc().strftime("%Y-%m-%d")
        month_start = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        prev_month_end = month_start - timedelta(seconds=1)

        flt = {"clinic_id": c["id"]}

        bookings_today = await db.bookings.count_documents({
            **flt,
            "scheduled_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"},
            "status": {"$nin": ["cancelled", "no_show", "blocked"]},
            "booking_type": {"$ne": "block"},
        })
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
        await assert_feature(user, "reports")
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

    import os
    from online_booking_payment import register_online_booking_payment
    from audit_log import log_appointment_created as _log_appt_created

    register_online_booking_payment(
        api,
        db,
        get_current_user,
        audit,
        os.environ["JWT_SECRET"],
        assert_feature=assert_feature,
        public_booking_helpers={
            "parse_iso": _parse_iso,
            "public_online_bookable_filter": _public_online_bookable_filter,
            "has_slot_conflict": _has_slot_conflict,
            "auto_pick_performer": _auto_pick_performer,
            "log_appointment_created": _log_appt_created,
        },
    )

    from messaging import register_messaging
    register_messaging(api, db, get_current_user, audit, os.environ["JWT_SECRET"], assert_feature=assert_feature)

    return api
