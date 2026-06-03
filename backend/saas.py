"""SaaS / multi-tenant layer for ClinicOS.

Holds plan catalog, clinic helpers, feature gating, and subscription/registration
endpoints. Imported by server.py."""
from __future__ import annotations
import os
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import HTTPException, APIRouter, Depends, UploadFile, File, Form
from pydantic import BaseModel, EmailStr

# ---------------- Plan Catalog ----------------
DEFAULT_LOYALTY_TIERS: List[Dict[str, Any]] = [
    {"name": "Silver",   "min_spend_idr": 10_000_000, "benefit": "5% off all treatments",  "color": "#9CA3AF", "discount_percent": 5},
    {"name": "Gold",     "min_spend_idr": 15_000_000, "benefit": "10% off + complimentary consultation", "color": "#F59E0B", "discount_percent": 10},
    {"name": "Platinum", "min_spend_idr": 30_000_000, "benefit": "15% off + VIP perks + birthday gift", "color": "#7C3AED", "discount_percent": 15},
]

PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    "starter": {
        "key": "starter",
        "name": "Starter",
        "price_idr": 800_000,
        "max_staff": 3,
        "storage_gb": 2,
        "features": [
            "patients", "online_booking", "whatsapp_templates", "treatments", "billing",
        ],
        "highlights": [
            "Patient directory & tags",
            "Treatment & service catalog (for booking)",
            "Appointment calendar & online booking page",
            "WhatsApp reminder templates",
            "Check-in visits from bookings (overview only)",
            "Up to 3 staff accounts",
            "2 GB storage",
        ],
    },
    "clinic": {
        "key": "clinic",
        "name": "Clinic",
        "price_idr": 1_200_000,
        "max_staff": 7,
        "storage_gb": 5,
        "most_popular": True,
        "features": [
            "patients", "online_booking", "whatsapp_templates", "treatments",
            "emr", "photos", "mapping", "signature", "billing",
            "packages", "consent",
        ],
        "highlights": [
            "Everything in Starter, plus:",
            "Full EMR — doctor & therapist clinical forms",
            "Treatment lines per visit (qty, area, product)",
            "Before/after photo gallery",
            "Face/body mapping canvas",
            "Digital signatures & visit payment / receipts",
            "Treatment packages catalog",
            "Up to 7 staff accounts",
            "5 GB storage",
        ],
    },
    "complete": {
        "key": "complete",
        "name": "Complete",
        "price_idr": 1_500_000,
        "max_staff": 9999,
        "storage_gb": 20,
        "features": [
            "patients", "online_booking", "photos", "whatsapp_templates",
            "emr", "billing", "mapping", "signature", "treatments",
            "reports", "commissions", "multi_location", "audit_log", "whatsapp_automation", "products",
            "packages", "consent", "online_booking_payment",
        ],
        "highlights": [
            "Everything in Clinic, plus:",
            "Advanced reports & analytics",
            "Staff commission rules & payout tracking",
            "Multi-location support",
            "WhatsApp automation log",
            "Full audit log",
            "Internal products inventory",
            "Priority support",
            "Unlimited staff accounts",
            "20 GB storage",
        ],
    },
}

# Trial gets full Complete features
TRIAL_FEATURES = set(PLAN_CATALOG["complete"]["features"]) | {"packages", "consent"}

TRIAL_DAYS = 14
GRACE_DAYS_PAST_DUE = 7

SUBSCRIPTION_STATUSES = frozenset({
    "trial", "active", "past_due", "suspended", "cancelled", "expired", "archived",
})

PLAN_ORDER = ("starter", "clinic", "complete")


def minimum_plan_for_feature(feature: str) -> Optional[str]:
    """Lowest paid plan key that includes a feature (for upgrade messaging)."""
    for key in PLAN_ORDER:
        if feature in PLAN_CATALOG.get(key, {}).get("features", []):
            return key
    return None


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return s or "clinic"


RESERVED_BOOKING_SLUGS = frozenset({
    "login", "register", "admin", "api", "billing", "book", "superadmin",
    "onboarding", "patients", "visits", "bookings", "treatments", "packages",
    "products", "audit", "reports", "print", "settings", "platform",
})


class BookingSlugError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


async def validate_booking_slug(db, raw: str, clinic_id: str) -> str:
    """Normalize and ensure a public booking slug is available for this clinic."""
    slug = slugify(raw or "")
    if len(slug) < 2:
        raise BookingSlugError("Booking URL must be at least 2 characters")
    if len(slug) > 48:
        raise BookingSlugError("Booking URL must be 48 characters or fewer")
    if slug in RESERVED_BOOKING_SLUGS:
        raise BookingSlugError("This booking URL is reserved")
    existing = await db.clinics.find_one({"slug": slug, "id": {"$ne": clinic_id}}, {"_id": 0, "id": 1})
    if existing:
        raise BookingSlugError("This booking URL is already taken by another clinic", 409)
    return slug


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


# ---------------- Billing cycles (subscription payments) ----------------
BILLING_CYCLES: Dict[str, Dict[str, Any]] = {
    "monthly": {"label": "Monthly", "months": 1, "discount": 1.0},
    "semiannual": {"label": "6 months", "months": 6, "discount": 0.95},
    "annual": {"label": "Annually", "months": 12, "discount": 0.90},
}

BILLING_CYCLE_KEYS = frozenset(BILLING_CYCLES.keys())


def compute_plan_charge(price_idr: int, cycle_key: str) -> Dict[str, Any]:
    """Return list price for a plan at a billing cycle (before unique transfer code)."""
    cycle = BILLING_CYCLES.get(cycle_key) or BILLING_CYCLES["monthly"]
    months = int(cycle["months"])
    per_month = int(round(int(price_idr) * float(cycle["discount"])))
    total = per_month * months
    return {
        "cycle": cycle_key if cycle_key in BILLING_CYCLES else "monthly",
        "label": cycle["label"],
        "months": months,
        "per_month_idr": per_month,
        "total_idr": total,
        "discount_percent": int(round((1 - float(cycle["discount"])) * 100)),
    }


# ---------------- Subscription Helpers ----------------
def get_clinic_features(clinic: dict) -> set:
    sub = clinic.get("subscription", {})
    plan = sub.get("plan", "trial")
    status = sub.get("status", "trial")
    if status == "trial":
        return set(TRIAL_FEATURES)
    if plan in PLAN_CATALOG:
        return set(PLAN_CATALOG[plan]["features"])
    return set()


def get_plan_limits(clinic: dict) -> Dict[str, Any]:
    """Resolved plan row for limits (staff count, storage). Trial uses Complete caps."""
    sub = clinic.get("subscription", {})
    plan = sub.get("plan", "trial")
    status = sub.get("status", "trial")
    if status == "trial":
        base = dict(PLAN_CATALOG["complete"])
    else:
        base = dict(PLAN_CATALOG.get(plan, PLAN_CATALOG["starter"]))
    return resolve_clinic_limits(clinic, base)


def resolve_clinic_limits(clinic: dict, base_limits: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Apply per-clinic limit_overrides on top of plan defaults."""
    if base_limits is None:
        sub = clinic.get("subscription", {})
        if sub.get("status") == "trial":
            base_limits = dict(PLAN_CATALOG["complete"])
        else:
            base_limits = dict(PLAN_CATALOG.get(sub.get("plan"), PLAN_CATALOG["starter"]))
    merged = dict(base_limits)
    overrides = clinic.get("limit_overrides") or {}
    if overrides.get("max_staff") is not None:
        merged["max_staff"] = int(overrides["max_staff"])
    if overrides.get("storage_gb") is not None:
        merged["storage_gb"] = int(overrides["storage_gb"])
    return merged


def refresh_subscription_state(clinic: dict) -> tuple:
    """Normalize subscription status from dates. Returns (clinic, changed: bool)."""
    sub = dict(clinic.get("subscription") or {})
    changed = False
    now = now_utc()
    status = sub.get("status", "trial")

    if status == "active" and sub.get("expiry_date"):
        try:
            exp = datetime.fromisoformat(sub["expiry_date"])
            if exp < now:
                sub["status"] = "past_due"
                sub["past_due_since"] = sub.get("past_due_since") or iso(exp)
                sub["past_due_until"] = iso(exp + timedelta(days=GRACE_DAYS_PAST_DUE))
                changed = True
                status = "past_due"
        except Exception:
            pass

    if status == "past_due" and sub.get("past_due_until"):
        try:
            grace_end = datetime.fromisoformat(sub["past_due_until"])
            if grace_end < now:
                sub["status"] = "expired"
                changed = True
                status = "expired"
        except Exception:
            pass

    if status == "trial" and sub.get("trial_end"):
        try:
            if datetime.fromisoformat(sub["trial_end"]) < now:
                sub["status"] = "expired"
                changed = True
        except Exception:
            pass

    if changed:
        clinic = dict(clinic)
        clinic["subscription"] = sub
    return clinic, changed


def clinic_is_readonly(clinic: dict) -> bool:
    sub = clinic.get("subscription", {})
    status = sub.get("status", "trial")
    if status in ("expired", "suspended", "cancelled", "archived"):
        return True
    if status == "past_due" and sub.get("past_due_until"):
        try:
            if datetime.fromisoformat(sub["past_due_until"]) < now_utc():
                return True
        except Exception:
            return True
    trial_end = sub.get("trial_end")
    if status == "trial" and trial_end:
        try:
            if datetime.fromisoformat(trial_end) < now_utc():
                return True
        except Exception:
            pass
    return False


def clinic_access_mode(clinic: dict) -> str:
    """full | billing_only | blocked"""
    sub = clinic.get("subscription", {})
    status = sub.get("status", "trial")
    if status == "suspended" or status == "archived":
        return "blocked"
    if status in ("expired", "cancelled"):
        return "billing_only"
    if status == "past_due":
        until = sub.get("past_due_until")
        if until:
            try:
                if datetime.fromisoformat(until) >= now_utc():
                    return "full"
            except Exception:
                pass
        return "billing_only"
    if status == "trial" and sub.get("trial_end"):
        try:
            if datetime.fromisoformat(sub["trial_end"]) < now_utc():
                return "billing_only"
        except Exception:
            pass
    if clinic_is_readonly(clinic):
        return "billing_only"
    return "full"


def clinic_login_blocked(clinic: dict) -> Optional[str]:
    sub = clinic.get("subscription", {})
    status = sub.get("status", "trial")
    if status == "suspended":
        return "Your account has been suspended. Please contact support."
    if status == "archived":
        return "This clinic has been archived. Please contact support to restore access."
    return None


def public_clinic_view(clinic: dict, *, usage: Optional[Dict[str, Any]] = None, limits: Optional[Dict[str, Any]] = None) -> dict:
    sub = clinic.get("subscription", {})
    resolved_limits = limits or resolve_clinic_limits(clinic)
    plan_key = sub.get("plan", "trial")
    return {
        "id": clinic["id"],
        "name": clinic["name"],
        "slug": clinic["slug"],
        "logo_path": clinic.get("logo_path", ""),
        "city": clinic.get("city", ""),
        "phone": clinic.get("phone", ""),
        "email": clinic.get("email", ""),
        "address": clinic.get("address", ""),
        "owner_name": clinic.get("owner_name", ""),
        "owner_email": clinic.get("owner_email", ""),
        "timezone": clinic.get("timezone", "Asia/Makassar"),
        "currency": clinic.get("currency", "IDR"),
        "operating_hours": clinic.get("operating_hours", {}),
        "booking_slot_interval": int(clinic.get("booking_slot_interval") or 30),
        "closed_dates": clinic.get("closed_dates", []),
        "loyalty_tiers": clinic.get("loyalty_tiers") or DEFAULT_LOYALTY_TIERS,
        "onboarded": clinic.get("onboarded", False),
        "subscription": {
            "plan": plan_key,
            "status": sub.get("status", "trial"),
            "trial_end": sub.get("trial_end"),
            "expiry_date": sub.get("expiry_date"),
            "started_at": sub.get("started_at"),
            "billing_cycle": sub.get("billing_cycle"),
            "past_due_since": sub.get("past_due_since"),
            "past_due_until": sub.get("past_due_until"),
        },
        "plan_details": PLAN_CATALOG.get(plan_key) if plan_key in PLAN_CATALOG else None,
        "limit_overrides": clinic.get("limit_overrides") or {},
        "limits": {
            "max_staff": int(resolved_limits.get("max_staff") or 3),
            "storage_gb": int(resolved_limits.get("storage_gb") or 2),
        },
        "usage": usage or {},
        "features": sorted(get_clinic_features(clinic)),
        "readonly": clinic_is_readonly(clinic),
        "access_mode": clinic_access_mode(clinic),
        "created_at": clinic.get("created_at"),
        "archived_at": clinic.get("archived_at"),
        "is_archived": (sub.get("status") == "archived"),
        "is_test_clinic": bool(clinic.get("is_test_clinic", False)),
    }


# ---------------- Pydantic models ----------------
class ClinicRegisterIn(BaseModel):
    clinic_name: str
    owner_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = ""
    city: Optional[str] = ""


class ClinicUpdateIn(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    operating_hours: Optional[Dict[str, Any]] = None
    booking_slot_interval: Optional[int] = None
    closed_dates: Optional[List[Dict[str, Any]]] = None
    loyalty_tiers: Optional[List[Dict[str, Any]]] = None
    onboarded: Optional[bool] = None
    logo_path: Optional[str] = None


# ---------------- Build defaults ----------------
def new_clinic_doc(reg: ClinicRegisterIn, existing_slugs: List[str]) -> dict:
    slug = slugify(reg.clinic_name)
    base = slug
    i = 1
    while slug in existing_slugs:
        i += 1
        slug = f"{base}-{i}"
    return {
        "id": str(uuid.uuid4()),
        "name": reg.clinic_name,
        "slug": slug,
        "logo_path": "",
        "address": "",
        "city": reg.city or "",
        "phone": reg.phone or "",
        "email": reg.email.lower(),
        "owner_name": reg.owner_name,
        "owner_email": reg.email.lower(),
        "timezone": "Asia/Makassar",
        "currency": "IDR",
        "operating_hours": {
            "mon": {"open": "09:00", "close": "20:00"},
            "tue": {"open": "09:00", "close": "20:00"},
            "wed": {"open": "09:00", "close": "20:00"},
            "thu": {"open": "09:00", "close": "20:00"},
            "fri": {"open": "09:00", "close": "20:00"},
            "sat": {"open": "10:00", "close": "18:00"},
            "sun": {"open": "", "close": ""},
        },
        "booking_slot_interval": 30,
        "closed_dates": [],
        "loyalty_tiers": list(DEFAULT_LOYALTY_TIERS),
        "subscription": {
            "plan": "trial",
            "status": "trial",
            "trial_end": iso(now_utc() + timedelta(days=TRIAL_DAYS)),
            "expiry_date": None,
            "started_at": iso(now_utc()),
        },
        "onboarded": False,
        "created_at": iso(now_utc()),
        "is_test_clinic": False,
    }
