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
PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    "starter": {
        "key": "starter",
        "name": "Starter",
        "price_idr": 800_000,
        "max_staff": 3,
        "storage_gb": 2,
        "features": [
            "patients", "online_booking", "photos", "whatsapp_templates",
        ],
        "highlights": [
            "Patient profiles + medical history + tags",
            "Visit history (view only)",
            "Before/after photo gallery",
            "Online booking page + appointment calendar",
            "WhatsApp reminder templates",
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
            "patients", "online_booking", "photos", "whatsapp_templates",
            "emr", "billing", "mapping", "signature", "treatments",
        ],
        "highlights": [
            "Everything in Starter, plus:",
            "Full doctor & therapist clinical forms",
            "Face/body mapping canvas",
            "Treatment items & dosage tracking",
            "Digital signatures",
            "Billing & invoices",
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
            "reports", "multi_location", "audit_log", "whatsapp_automation",
        ],
        "highlights": [
            "Everything in Clinic, plus:",
            "Advanced reports & analytics",
            "Multi-location support",
            "WhatsApp automation log",
            "Full audit log",
            "Priority support",
            "Unlimited staff accounts",
            "20 GB storage",
        ],
    },
}

# Trial gets full Complete features
TRIAL_FEATURES = set(PLAN_CATALOG["complete"]["features"])

TRIAL_DAYS = 14


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return s or "clinic"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


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


def clinic_is_readonly(clinic: dict) -> bool:
    sub = clinic.get("subscription", {})
    status = sub.get("status", "trial")
    if status in ("expired", "suspended"):
        return True
    # If trial expired by date but status not updated
    trial_end = sub.get("trial_end")
    if status == "trial" and trial_end:
        try:
            if datetime.fromisoformat(trial_end) < now_utc():
                return True
        except Exception:
            pass
    return False


def clinic_login_blocked(clinic: dict) -> Optional[str]:
    sub = clinic.get("subscription", {})
    if sub.get("status") == "suspended":
        return "Your account has been suspended. Please contact support."
    return None


def public_clinic_view(clinic: dict) -> dict:
    sub = clinic.get("subscription", {})
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
        "onboarded": clinic.get("onboarded", False),
        "subscription": {
            "plan": sub.get("plan", "trial"),
            "status": sub.get("status", "trial"),
            "trial_end": sub.get("trial_end"),
            "expiry_date": sub.get("expiry_date"),
            "started_at": sub.get("started_at"),
        },
        "plan_details": PLAN_CATALOG.get(sub.get("plan"), None),
        "features": sorted(get_clinic_features(clinic)),
        "readonly": clinic_is_readonly(clinic),
        "created_at": clinic.get("created_at"),
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
        "subscription": {
            "plan": "trial",
            "status": "trial",
            "trial_end": iso(now_utc() + timedelta(days=TRIAL_DAYS)),
            "expiry_date": None,
            "started_at": iso(now_utc()),
        },
        "onboarded": False,
        "created_at": iso(now_utc()),
    }
