from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import asyncio
import uuid
import logging
import bcrypt
import jwt
import re
import requests
import mimetypes
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, Query, Header, Response
from fastapi.responses import FileResponse, Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from patient_io import (
    build_patient_doc,
    parse_csv_text,
    parse_xlsx_bytes,
    patient_to_export_row,
    rows_to_csv,
    rows_to_xlsx,
)

# ---------------- Setup ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
APP_NAME = os.environ.get("APP_NAME", "clinicos")
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
BETA_MODE = os.environ.get("BETA_MODE", "").strip().lower() in ("1", "true", "yes", "on")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").strip()
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").strip()
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "platform@clinicos.id")
SUPER_ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "ChangeMe123!")
SUPPORT_WHATSAPP = os.environ.get("SUPPORT_WHATSAPP", "")
SUPPORT_HOURS = os.environ.get("SUPPORT_HOURS", "Mon-Fri 9am-6pm")
STORAGE_URL = os.environ.get("STORAGE_URL", "https://integrations.emergentagent.com/objstore/api/v1/storage")
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "").strip()
PUBLIC_UPLOAD_BASE_URL = os.environ.get("PUBLIC_UPLOAD_BASE_URL", "").strip()
USE_LOCAL_UPLOADS = os.environ.get("USE_LOCAL_UPLOADS", "").strip().lower() in ("1", "true", "yes", "on")

PRODUCTION_ENVS = {"production", "prod", "production_beta"}
IS_PRODUCTION = APP_ENV in PRODUCTION_ENVS
ENABLE_API_DOCS = os.environ.get("ENABLE_API_DOCS", "").strip().lower() in ("1", "true", "yes", "on")

def _parse_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    if raw.strip():
        return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if FRONTEND_URL:
        return [FRONTEND_URL.rstrip("/")]
    return ["http://localhost:3000"]

CORS_ORIGINS = _parse_cors_origins()

if not PUBLIC_UPLOAD_BASE_URL and BACKEND_URL:
    PUBLIC_UPLOAD_BASE_URL = f"{BACKEND_URL.rstrip('/')}/uploads"

if not UPLOAD_DIR:
    if IS_PRODUCTION or APP_ENV == "production_beta":
        UPLOAD_DIR = "/app/uploads"
    else:
        UPLOAD_DIR = str((ROOT_DIR.parent / "uploads").resolve())

if not USE_LOCAL_UPLOADS:
    # Local uploads are safest default for dev/beta and production fallback.
    USE_LOCAL_UPLOADS = APP_ENV in {"development", "dev", "production_beta"} or IS_PRODUCTION

UPLOAD_ROOT = Path(UPLOAD_DIR).resolve()
try:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    log = logging.getLogger("emr")
    log.warning("Could not create upload directory %s: %s", UPLOAD_ROOT, exc)

ROLES = ["super_admin", "doctor", "therapist", "fo", "manager"]

from saas import (
    PLAN_CATALOG, TRIAL_DAYS, TRIAL_FEATURES,
    ClinicRegisterIn, ClinicUpdateIn,
    get_clinic_features, get_plan_limits, clinic_is_readonly, clinic_login_blocked,
    refresh_subscription_state, resolve_clinic_limits, clinic_access_mode,
    public_clinic_view, new_clinic_doc, now_utc, iso, slugify,
    validate_booking_slug, BookingSlugError,
)
from bookings import register_bookings, DEFAULT_TREATMENTS, DEFAULT_WA_TEMPLATES
from campaigns import register_campaigns
from dashboard_operations import register_dashboard_operations
from front_desk_dashboard import register_front_desk_dashboard
from clinic_realtime import register_realtime, safe_emit_visit_event
from invoices import register_invoices
from commissions import register_commissions, sync_commission_records_for_invoice, ensure_default_commission_rules
from patient_packages import register_patient_packages
from patient_profile import (
    FO_PATIENT_EDIT_FIELDS,
    filter_patient_update_fields,
    register_patient_profile,
    validate_patient_marketing_fields,
)
from consent_forms import (
    register_consent_forms,
    ensure_consent_forms_for_visit,
    assert_required_consents_signed,
    visit_consent_required,
    build_visit_consent_context,
)
from clinic_analytics import register_clinic_analytics
from clinic_reports import register_clinic_reports
from inventory_usage import register_inventory_usage, create_product_usage, reverse_usages_for_treatment_item
from superadmin import register_superadmin, require_platform_admin
from platform_admin_2fa import platform_admin_login_payload
from clinic_user_2fa import assert_clinic_role_2fa_policy, register_clinic_user_2fa
from clinic_account import register_clinic_account
from pos_sales import register_pos_sales
from daily_closing import register_daily_closing
from gift_cards import register_gift_cards
from refunds import register_refunds
from patient_wallets import register_patient_wallets
from prepaid import register_prepaid
from patient_labels import register_patient_labels
from patient_spending_history import register_patient_spending_history
import totp_2fa as t2fa
from platform_ops import create_platform_notification, seed_clinic_settings, invalidate_user_sessions
from subscription_gates import assert_operational_access, maybe_notify_trial_expired_platform
from commercial import (
    register_commercial,
    build_onboarding_checklist,
    compute_usage_alerts,
    sync_billing_lifecycle_notifications,
    notify_trial_started,
    list_clinic_notifications,
)
from customer_lifecycle import register_customer_lifecycle
from platform_reliability import register_platform_reliability, log_failed_login, log_platform_error
from platform_settings import register_platform_settings, get_platform_settings, merged_plans, merged_platform_branding
from permissions import attach_permissions_to_user, ensure_clinic_roles, user_has_permission
from staff_scheduling import migrate_legacy_user_schedule, ensure_demo_clinical_schedules
from staff import register_staff

app = FastAPI(
    title="ClinicOS API",
    docs_url=None if (IS_PRODUCTION and not ENABLE_API_DOCS) else "/docs",
    redoc_url=None if (IS_PRODUCTION and not ENABLE_API_DOCS) else "/redoc",
    openapi_url=None if (IS_PRODUCTION and not ENABLE_API_DOCS) else "/openapi.json",
)
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger("emr")

# ---------------- Auth Helpers ----------------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())

def create_token(user_id: str, email: str, role: str, clinic_id: Optional[str] = None, platform_admin: bool = False, **extra) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "clinic_id": clinic_id, "platform_admin": platform_admin,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    payload.update({k: v for k, v in extra.items() if v is not None})
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") == "platform_2fa_challenge":
        raise HTTPException(status_code=401, detail="Two-factor verification required")
    if payload.get("type") == "clinic_2fa_challenge":
        raise HTTPException(status_code=401, detail="Two-factor verification required")
    # Platform super admin path
    if payload.get("platform_admin"):
        db_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not db_user and payload.get("email"):
            db_user = await db.users.find_one(
                {
                    "email": (payload["email"] or "").lower(),
                    "$or": [{"role": "platform_admin"}, {"platform_admin": True}],
                },
                {"_id": 0, "password_hash": 0},
            )
        if db_user:
            return {
                "id": db_user["id"],
                "email": db_user.get("email") or payload["email"],
                "name": db_user.get("name") or "Platform Admin",
                "role": "platform_admin",
                "clinic_id": None,
                "platform_admin": True,
            }
        return {
            "id": payload["sub"], "email": payload["email"], "name": "Platform Admin",
            "role": "platform_admin", "clinic_id": None, "platform_admin": True,
        }
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user_ver = int(user.get("auth_version") or 0)
    token_ver = int(payload.get("auth_version") or 0)
    if token_ver != user_ver:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    user["clinic_id"] = user.get("clinic_id") or payload.get("clinic_id")
    if payload.get("impersonating"):
        user["impersonating"] = True
        user["impersonator_id"] = payload.get("impersonator_id")
        user["impersonator_email"] = payload.get("impersonator_email")
        user["impersonator_clinic_name"] = payload.get("impersonator_clinic_name")
    return await attach_permissions_to_user(db, user)

# ---------------- Tenant Scoping Helpers ----------------
def scope(user: dict, filt: Optional[dict] = None) -> dict:
    f = dict(filt or {})
    if user.get("clinic_id"):
        f["clinic_id"] = user["clinic_id"]
    return f


from performers import (
    visit_staff_filter,
    booking_staff_filter,
    PERFORMER_SLOT_ROLES,
    staff_ids_from_performers,
    get_performers,
    validate_visit_treatment_item,
)
from clinical_notes import (
    DEFAULT_NOTE_TEMPLATES,
    effective_note_status,
    enrich_record_status,
    check_primary_record_edit,
    check_performer_note_edit,
    lock_all_visit_notes,
    visit_performer_slots,
    CLINICAL_EDITOR_ROLES,
)


async def apply_staff_visit_filter(db, user: dict, filt: Optional[dict] = None) -> dict:
    """Scope visits: all clinic visits or own assignments only."""
    f = scope(user, filt)
    if user_has_permission(user, "visits.view"):
        return f
    if user_has_permission(user, "visits.view_own") and user.get("id"):
        uid = user["id"]
        ors = list(visit_staff_filter(uid).get("$or", []))
        async for b in db.bookings.find(
            {**scope(user), **booking_staff_filter(uid)},
            {"_id": 0, "id": 1},
        ):
            ors.append({"booking_id": b["id"]})
        f["$or"] = ors
    return f


async def assert_staff_visit_access(db, user: dict, visit: dict):
    """Block cross-assignee access by ID for clinical staff."""
    if user.get("platform_admin") or user.get("role") == "super_admin":
        return
    if user_has_permission(user, "visits.view"):
        return
    if not user_has_permission(user, "visits.view_own"):
        raise HTTPException(status_code=403, detail="Not allowed to view this visit")
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=403, detail="Not allowed to view this visit")
    assigned = staff_ids_from_performers(visit)
    if uid in assigned or visit.get("assigned_to") == uid:
        return
    bid = visit.get("booking_id")
    if bid and user.get("clinic_id"):
        b = await db.bookings.find_one(
            {"clinic_id": user["clinic_id"], "id": bid},
            {"_id": 0, "performers": 1, "performer_id": 1},
        )
        if b and (uid in staff_ids_from_performers(b) or b.get("performer_id") == uid):
            return
    raise HTTPException(status_code=404, detail="Visit not found")


async def apply_patient_list_filter(db, user: dict, flt: dict) -> dict:
    """Restrict patient list to assigned bookings/visits when user lacks patients.view."""
    if user_has_permission(user, "patients.view"):
        return flt
    if not user_has_permission(user, "patients.view_assigned") or not user.get("id"):
        return flt
    uid = user["id"]
    patient_ids: set = set()
    bflt = scope(user, {})
    bflt.update(booking_staff_filter(uid))
    async for b in db.bookings.find(bflt, {"_id": 0, "patient_id": 1}):
        if b.get("patient_id"):
            patient_ids.add(b["patient_id"])
    vflt = await apply_staff_visit_filter(db, user, {})
    async for v in db.visits.find(vflt, {"_id": 0, "patient_id": 1}):
        if v.get("patient_id"):
            patient_ids.add(v["patient_id"])
    flt = dict(flt)
    if not patient_ids:
        flt["id"] = "__no_assigned_patients__"
    else:
        flt["id"] = {"$in": list(patient_ids)}
    return flt


async def assert_patient_access(db, user: dict, patient_id: str) -> None:
    if user_has_permission(user, "patients.view"):
        return
    if not user_has_permission(user, "patients.view_assigned"):
        raise HTTPException(status_code=403, detail="Not allowed to view this patient")
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=403, detail="Not allowed to view this patient")
    b = await db.bookings.find_one(
        {**scope(user), **booking_staff_filter(uid), "patient_id": patient_id},
        {"_id": 0, "id": 1},
    )
    if b:
        return
    v = await db.visits.find_one(
        await apply_staff_visit_filter(db, user, {"patient_id": patient_id}),
        {"_id": 0, "id": 1},
    )
    if v:
        return
    raise HTTPException(status_code=404, detail="Patient not found")

def with_clinic(user: dict, doc: dict) -> dict:
    if user.get("clinic_id") and "clinic_id" not in doc:
        doc["clinic_id"] = user["clinic_id"]
    return doc

async def get_active_clinic(user: dict) -> dict:
    if not user.get("clinic_id"):
        raise HTTPException(status_code=400, detail="User is not associated with a clinic")
    c = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Clinic not found")
    prev_sub = dict(c.get("subscription") or {})
    c, changed = refresh_subscription_state(c)
    if changed:
        await db.clinics.update_one({"id": c["id"]}, {"$set": {"subscription": c["subscription"]}})
        await maybe_notify_trial_expired_platform(db, c, previous_sub=prev_sub)
    return c


async def get_operational_user(request: Request) -> dict:
    """Authenticated clinic user with an active (non-expired) subscription."""
    user = await get_current_user(request)
    await assert_operational_access(user, db)
    return user


async def _clinic_storage_bytes(clinic_id: str) -> int:
    agg = await db.photos.aggregate([
        {"$match": {"clinic_id": clinic_id}},
        {"$group": {"_id": None, "bytes": {"$sum": {"$ifNull": ["$size_bytes", 0]}}}},
    ]).to_list(1)
    return int((agg[0]["bytes"] if agg else 0) or 0)


async def assert_storage_capacity(user: dict, incoming_bytes: int = 0):
    if user.get("platform_admin"):
        return
    cid = user.get("clinic_id")
    if not cid:
        return
    c = await db.clinics.find_one({"id": cid}, {"_id": 0, "subscription": 1, "limit_overrides": 1})
    if not c:
        return
    limits = resolve_clinic_limits(c)
    cap_gb = int(limits.get("storage_gb") or 2)
    cap_bytes = cap_gb * (1024 ** 3)
    used = await _clinic_storage_bytes(cid)
    if used + max(0, int(incoming_bytes or 0)) > cap_bytes:
        clinic_name = (await db.clinics.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}).get("name")
        await create_platform_notification(
            db,
            ntype="storage_limit",
            title=f"Storage limit reached: {clinic_name or cid}",
            body=f"Clinic hit {cap_gb} GB storage cap on current plan",
            clinic_id=cid,
            clinic_name=clinic_name,
            link=f"/superadmin/clinics/{cid}",
        )
        raise HTTPException(
            status_code=403,
            detail=f"Storage limit reached ({cap_gb} GB on your plan). Upgrade or remove files to upload more.",
        )

async def assert_writeable(user: dict):
    """Block writes if clinic is in read-only mode (expired/suspended)."""
    if user.get("platform_admin"):
        return
    if not user.get("clinic_id"):
        return
    c = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0, "subscription": 1})
    if c and clinic_is_readonly(c):
        raise HTTPException(status_code=402, detail="Your subscription has expired. Please choose a plan to continue.")

async def assert_feature(user: dict, feature: str):
    if user.get("platform_admin"):
        return
    c = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0, "subscription": 1})
    if not c:
        return
    feats = get_clinic_features(c)
    if feature not in feats:
        raise HTTPException(status_code=403, detail=f"Feature '{feature}' is not included in your current plan. Upgrade to unlock.")

async def assert_staff_capacity(user: dict):
    """Enforce max_staff from the active plan before adding clinic users."""
    if user.get("platform_admin"):
        return
    cid = user.get("clinic_id")
    if not cid:
        return
    c = await db.clinics.find_one({"id": cid}, {"_id": 0, "subscription": 1, "name": 1, "limit_overrides": 1})
    if not c:
        return
    limits = resolve_clinic_limits(c)
    max_staff = int(limits.get("max_staff") or 3)
    count = await db.users.count_documents({"clinic_id": cid})
    if count >= max_staff:
        plan_name = limits.get("name", c.get("subscription", {}).get("plan", "your"))
        clinic_name = c.get("name") or cid
        await create_platform_notification(
            db,
            ntype="staff_limit",
            title=f"Staff limit reached: {clinic_name}",
            body=f"{count} staff on plan (max {max_staff})",
            clinic_id=cid,
            clinic_name=clinic_name,
            link=f"/superadmin/clinics/{cid}",
        )
        raise HTTPException(
            status_code=403,
            detail=f"Staff limit reached ({max_staff} on {plan_name} plan). Upgrade to add more users.",
        )

def require_roles(*allowed: str, skip_operational_check: bool = False):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in allowed and user["role"] != "super_admin":
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if not skip_operational_check:
            await assert_operational_access(user, db)
        return user
    return checker


def require_permission(perm: str, skip_operational_check: bool = False):
    async def checker(user: dict = Depends(get_current_user)):
        if not user_has_permission(user, perm):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if not skip_operational_check:
            await assert_operational_access(user, db)
        return user
    return checker


def require_any_permission(*perms: str, skip_operational_check: bool = False):
    async def checker(user: dict = Depends(get_current_user)):
        if not any(user_has_permission(user, p) for p in perms):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if not skip_operational_check:
            await assert_operational_access(user, db)
        return user
    return checker

# ---------------- Audit ----------------
from audit_log import write_audit, log_clinical_note, log_consent

async def audit(
    user: dict,
    action: str,
    entity: str,
    entity_id: str = "",
    meta: Optional[dict] = None,
    *,
    old_value: Any = None,
    new_value: Any = None,
    reason: Optional[str] = None,
    module: Optional[str] = None,
):
    """Backward-compatible audit wrapper; prefer structured old_value/new_value/reason."""
    reason = reason or (meta or {}).get("edit_reason") or (meta or {}).get("reason")
    await write_audit(
        db, user,
        action=action,
        module=module or entity,
        record_id=entity_id,
        old_value=old_value,
        new_value=new_value if new_value is not None else meta,
        reason=reason,
        meta=meta,
    )

# ---------------- Object Storage ----------------
storage_key: Optional[str] = None
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
PHOTO_TOO_LARGE_MESSAGE = "Photo is too large. Please try another photo or reduce camera resolution."
UNSUPPORTED_PHOTO_MESSAGE = "Unsupported photo format. Please use JPG, PNG, or WebP."

def _safe_rel_path(path: str) -> str:
    rel = str(path or "").strip().lstrip("/").replace("\\", "/")
    if ".." in rel:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return rel

def _public_file_url(path: str) -> str:
    rel = _safe_rel_path(path)
    if PUBLIC_UPLOAD_BASE_URL:
        return f"{PUBLIC_UPLOAD_BASE_URL.rstrip('/')}/{rel}"
    return f"/uploads/{rel}"

def _write_local_upload(path: str, data: bytes) -> None:
    abs_path = _upload_abs_path(path)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)

def _upload_abs_path(rel: str) -> Path:
    rel = _safe_rel_path(rel)
    abs_path = (UPLOAD_ROOT / rel).resolve()
    if UPLOAD_ROOT not in abs_path.parents and abs_path != UPLOAD_ROOT:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return abs_path

def _read_local_upload(path: str) -> tuple[bytes, str]:
    abs_path = _upload_abs_path(path)
    if not abs_path.exists() or not abs_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    guessed = mimetypes.guess_type(abs_path.name)[0] or "application/octet-stream"
    return abs_path.read_bytes(), guessed

def _is_public_upload_rel_path(rel: str) -> bool:
    parts = _safe_rel_path(rel).split("/")
    return len(parts) >= 2 and parts[1] in ("branding", "templates", "platform")

async def _resolve_clinic_id_for_upload(rel: str) -> Optional[str]:
    parts = _safe_rel_path(rel).split("/")
    if len(parts) >= 3 and parts[1] == "visits":
        visit = await db.visits.find_one({"id": parts[2]}, {"_id": 0, "clinic_id": 1})
        if visit:
            return visit.get("clinic_id")
    if parts:
        clinic = await db.clinics.find_one({"slug": parts[0]}, {"_id": 0, "id": 1})
        if clinic:
            return clinic.get("id")
    return None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        storage_key = r.json()["storage_key"]
        return storage_key
    except Exception as e:
        log.error(f"Storage init failed: {e}")
        return None

def put_object(path: str, data: bytes, content_type: str) -> dict:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if USE_LOCAL_UPLOADS:
        _write_local_upload(path, data)
        return {"path": _safe_rel_path(path), "file_url": _public_file_url(path)}
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 403:
        # refresh
        global storage_key
        storage_key = None
        key = init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    r.raise_for_status()
    body = r.json()
    body["path"] = _safe_rel_path(body.get("path") or path)
    body["file_url"] = _public_file_url(body["path"])
    return body

def get_object(path: str):
    if USE_LOCAL_UPLOADS:
        return _read_local_upload(path)
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")

# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

class PatientIn(BaseModel):
    full_name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    nationality: Optional[str] = None
    nationality_code: Optional[str] = None
    patient_source: Optional[str] = None
    source_detail: Optional[str] = None
    medical_history: Optional[str] = None
    allergies: Optional[str] = None
    notes: Optional[str] = None
    user_code: Optional[str] = None
    membership_name: Optional[str] = None
    last_visit: Optional[str] = None
    guest_icon_information: Optional[str] = None
    consent_status: Optional[str] = None  # unsigned | signed | cancelled
    consent_notes: Optional[str] = None
    consent_signed_at: Optional[str] = None
    profile_alert: Optional[bool] = None
    profile_alert_label: Optional[str] = None

class VisitIn(BaseModel):
    patient_id: str
    visit_type: str  # doctor | therapist | nurse
    assigned_to: Optional[str] = None
    performers: Optional[List[dict]] = None
    chief_complaint: Optional[str] = None
    visit_date: Optional[str] = None
    booking_id: Optional[str] = None

class ClinicalRecordIn(BaseModel):
    anamnesis: Optional[str] = ""
    diagnosis: Optional[str] = ""
    treatment_plan: Optional[str] = ""  # TERAPI
    therapy_notes: Optional[str] = ""
    assessment: Dict[str, Any] = {}  # structured face assessment
    product_used: Optional[str] = ""
    dosage: Optional[str] = ""
    area_treated: Optional[str] = ""
    doctor_notes: Optional[str] = ""
    follow_up_recommendation: Optional[str] = ""
    next_session_recommendation: Optional[str] = ""
    template_id: Optional[str] = None
    signature: Optional[str] = ""  # base64 png
    submit: bool = False
    edit_reason: Optional[str] = None

class TherapistRecordIn(BaseModel):
    concern_notes: Optional[str] = ""
    body_concern: Optional[str] = ""
    treatment_area: Optional[str] = ""
    contraindication: List[str] = []
    device_used: Optional[str] = ""
    treatment_parameter: Optional[str] = ""
    intensity: Optional[str] = ""
    duration: Optional[str] = ""
    area_treated: Optional[str] = ""
    therapist_notes: Optional[str] = ""
    follow_up_recommendation: Optional[str] = ""
    next_session_recommendation: Optional[str] = ""
    template_id: Optional[str] = None
    signature: Optional[str] = ""
    submit: bool = False
    edit_reason: Optional[str] = None

class PerformerNoteIn(BaseModel):
    content: Optional[str] = ""
    follow_up_recommendation: Optional[str] = ""
    next_session_recommendation: Optional[str] = ""
    template_id: Optional[str] = None
    submit: bool = False
    edit_reason: Optional[str] = None

class TreatmentItemIn(BaseModel):
    category: str
    name: str
    product_used: Optional[str] = ""
    area_treated: Optional[str] = ""
    quantity: float = 1
    unit_type: str = "session"
    notes: Optional[str] = ""
    price: float = 0
    performer_id: Optional[str] = None
    product_id: Optional[str] = None
    quantity_used: Optional[float] = None
    dose_notes: Optional[str] = ""
    source: Optional[str] = None
    confirmed_by_staff: Optional[bool] = None

class TreatmentOutcomeIn(BaseModel):
    no_treatment_performed: bool = False
    no_treatment_reason: Optional[str] = ""

class MappingIn(BaseModel):
    map_type: str  # face | body_front | body_back
    image_data: str  # base64 png
    raw_json: Optional[Any] = None
    notes: Optional[str] = ""

class VisitPaymentIn(BaseModel):
    payment_status: str = "paid"  # unpaid | paid
    payment_method: Optional[str] = "cash"
    amount_idr: Optional[int] = None
    notes: Optional[str] = ""

class VisitStatusIn(BaseModel):
    status: str  # in_progress | completed

class UserIn(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    name: str
    role: str

class ProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    job_title: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None

class SettingsIn(BaseModel):
    branding: Optional[Dict[str, Any]] = None
    form_config: Optional[Dict[str, Any]] = None
    mapping_templates: Optional[Dict[str, Any]] = None
    booking_slug: Optional[str] = None

# ---------------- Default Settings ----------------
DEFAULT_FACE_SECTIONS = [
    {"key":"skin_quality","label":"Skin Quality","subs":[
        {"key":"thickness","label":"Thickness","options":["Thin","Normal","Thick"]},
        {"key":"hydration","label":"Hydration","options":["Hydrated","Dry"]},
        {"key":"laxity","label":"Laxity","options":["Good","Poor"]},
    ]},
    {"key":"forehead_lines","label":"Forehead Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"frown_lines","label":"Frown Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"tear_trough","label":"Tear Trough","subs":[
        {"key":"status","label":"","options":["Observed","Not Observed"]},
    ]},
    {"key":"temples","label":"Temples","subs":[
        {"key":"status","label":"","options":["Full","Hollow"]},
    ]},
    {"key":"cheeks","label":"Cheeks","subs":[
        {"key":"status","label":"","options":["Full","Hollow"]},
    ]},
    {"key":"nasolabial_folds","label":"Nasolabial Folds","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"marionette_line","label":"Marionette Line","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"projection","label":"Projection","options":["Protruded","Proportionate","Receded"]},
    ]},
    {"key":"lips","label":"Lips","subs":[
        {"key":"thickness","label":"Thickness","options":["Thin","Thick"]},
        {"key":"vermilion_border","label":"Vermilion Border","options":["Defined","Not Defined"]},
        {"key":"cupids_bow","label":"Cupid's Bow","options":["Defined","Not Defined"]},
    ]},
    {"key":"chin","label":"Chin","subs":[
        {"key":"length","label":"Length","options":["Short","Proportionate","Long"]},
        {"key":"projection","label":"Projection","options":["Protruded","Proportionate","Receded"]},
    ]},
    {"key":"jawline","label":"Jaw Line","subs":[
        {"key":"status","label":"","options":["Strong","Weak"]},
    ]},
    {"key":"neck_lines","label":"Neck Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
]

DEFAULT_TEMPLATES = {
    "face": {
        "label": "Face outline",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><ellipse cx="200" cy="220" rx="120" ry="160" fill="none" stroke="#C7BFA7" stroke-width="2"/><circle cx="155" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><circle cx="245" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><path d="M180 250 Q200 270 220 250" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><path d="M165 305 Q200 325 235 305" fill="none" stroke="#C7BFA7" stroke-width="1.5"/></svg>',
    },
    "body_front": {
        "label": "Body front",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/><path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/></svg>',
    },
    "body_back": {
        "label": "Body back",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/><path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/><line x1="150" y1="100" x2="150" y2="350" stroke="#C7BFA7" stroke-width="1" stroke-dasharray="4 4"/></svg>',
    },
}

DEFAULT_SETTINGS = {
    "branding": {
        "clinic_name": "Body Lab Bali",
        "tagline": "Aesthetic Clinic · Patient chart",
        "logo_path": "",  # storage path for logo
        "primary_color": "#8A9A86",
        "accent_color": "#D4A373",
        "background": "#FDFBF7",
        "surface": "#FFFFFF",
        "text_primary": "#2D3A33",
    },
    "form_config": {
        "face_sections": DEFAULT_FACE_SECTIONS,
        "contraindications": [
            "Pregnancy", "Breastfeeding", "Active skin infection", "Recent surgery",
            "Pacemaker / metal implant", "Keloid history", "Photosensitivity",
            "Active acne flare", "Anti-coagulant medication", "Open wound in treatment area",
        ],
        "devices": [
            "RF (Radio Frequency)", "HIFU", "Cryolipolysis", "Laser CO2", "IPL",
            "Microneedling", "Ultrasound", "Cavitation", "EMS", "LED Light",
            "Manual / Hands-on", "Other",
        ],
        "treatment_categories": [
            "Injectable", "Filler", "Toxin", "PRP", "Mesotherapy",
            "Laser", "RF", "HIFU", "Cryolipolysis", "Microneedling",
            "Facial", "Body Treatment", "Oral Medication", "Skincare", "Other",
        ],
        "treatment_units": ["session", "ml", "cc", "unit", "vial", "tube", "shot", "minute"],
        "payment_methods": ["Cash", "Debit Card", "Credit Card", "QRIS", "Bank Transfer", "E-Wallet", "Other"],
        "note_templates": DEFAULT_NOTE_TEMPLATES,
    },
    "mapping_templates": DEFAULT_TEMPLATES,
    "online_booking_payment": {
        "enable_online_booking_payment": False,
        "payment_requirement": "none",
        "deposit_type": "fixed",
        "deposit_value": 0,
        "payment_provider": "none",
        "provider_mode": "sandbox",
        "payment_expiry_minutes": 30,
        "booking_confirmation_rule": "confirm_after_payment",
        "provider_credentials_encrypted": None,
    },
    "clinic_messaging": {
        "enable_messaging": False,
        "provider": "none",
        "sender_name": "",
        "sender_phone_number": "",
        "webhook_url": "",
        "provider_credentials_encrypted": None,
    },
    "scheduling": {
        "conflict_policy": "warn_allow",
        "fo_can_override_conflict": True,
        "past_appointment_policy": "warn_allow",
    },
    "inventory": {
        "allow_negative_stock": False,
    },
    "security": {
        "require_2fa_for_owner_manager": False,
    },
    "patient_labels": {
        "blacklist_booking_policy": "require_confirmation",
        "fo_can_assign_labels": True,
    },
}

# ---------------- Auth Endpoints ----------------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()

    # Platform admin stored in users collection (supports changed email/password)
    platform_user = await db.users.find_one(
        {
            "email": email,
            "$or": [{"role": "platform_admin"}, {"platform_admin": True}],
        },
        {"_id": 0},
    )
    if platform_user and verify_password(payload.password, platform_user.get("password_hash") or ""):
        def _set_cookie(token: str) -> None:
            response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")

        return platform_admin_login_payload(
            platform_user,
            create_token_fn=lambda *a, **kw: create_token(*a, **kw),
            set_cookie_fn=_set_cookie,
        )

    # Platform super admin path (env-var credentials) — bootstraps DB account on first login
    if email == SUPER_ADMIN_EMAIL.lower() and payload.password == SUPER_ADMIN_PASSWORD:
        now = iso(now_utc())
        pid = "platform-admin"
        await db.users.update_one(
            {"id": pid},
            {"$set": {
                "id": pid,
                "email": email,
                "name": "Platform Admin",
                "role": "platform_admin",
                "platform_admin": True,
                "password_hash": hash_password(payload.password),
                "updated_at": now,
            }, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        platform_user = await db.users.find_one({"id": pid}, {"_id": 0})

        def _set_cookie_env(token: str) -> None:
            response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")

        return platform_admin_login_payload(
            platform_user,
            create_token_fn=lambda *a, **kw: create_token(*a, **kw),
            set_cookie_fn=_set_cookie_env,
        )
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await log_failed_login(db, email, clinic_id=(user or {}).get("clinic_id"))
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Check clinic suspension
    if user.get("clinic_id"):
        clinic = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0})
        if clinic:
            blocked = clinic_login_blocked(clinic)
            if blocked:
                raise HTTPException(status_code=403, detail=blocked)
    await assert_clinic_role_2fa_policy(db, user)

    if t2fa.is_2fa_enabled(user):
        return {
            "requires_2fa": True,
            "challenge_token": t2fa.create_challenge_token(
                user["id"], user["email"], challenge_type="clinic_2fa_challenge",
            ),
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user.get("name") or "",
                "role": user["role"],
                "clinic_id": user.get("clinic_id"),
                "platform_admin": False,
            },
        }

    is_platform_admin = bool(user.get("platform_admin")) or user.get("role") == "platform_admin"
    token = create_token(
        user["id"],
        user["email"],
        user["role"],
        clinic_id=user.get("clinic_id"),
        auth_version=int(user.get("auth_version") or 0),
        platform_admin=is_platform_admin,
    )
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": iso(now_utc())}})
    await audit(user, "login", "auth")
    if user.get("clinic_id"):
        await ensure_clinic_roles(db, user["clinic_id"])
    me_user = await attach_permissions_to_user(db, user)
    return {
        "token": token,
        "user": {
            "id": me_user["id"],
            "email": me_user["email"],
            "name": me_user["name"],
            "role": me_user["role"],
            "clinic_id": me_user.get("clinic_id"),
            "platform_admin": is_platform_admin,
            "role_id": me_user.get("role_id"),
            "role_name": me_user.get("role_name"),
            "role_key": me_user.get("role_key"),
            "permissions": me_user.get("permissions", []),
        },
    }

# ---------------- SaaS: Registration & Clinic Management ----------------
@api.post("/auth/register-clinic")
async def register_clinic(payload: ClinicRegisterIn, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    existing_slugs = [c["slug"] async for c in db.clinics.find({}, {"_id": 0, "slug": 1})]
    clinic = new_clinic_doc(payload, existing_slugs)
    await db.clinics.insert_one(clinic)
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.owner_name,
        "role": "super_admin",  # clinic-level admin
        "clinic_id": clinic["id"],
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(user_doc)
    await ensure_clinic_roles(db, clinic["id"])
    await seed_clinic_settings(db, clinic["id"], clinic["name"], DEFAULT_SETTINGS, "default")
    await notify_trial_started(db, clinic)
    await create_platform_notification(
        db,
        ntype="new_clinic_signup",
        title=f"New trial signup: {clinic['name']}",
        body=f"Owner {payload.owner_name} ({email}) · /{clinic['slug']}",
        clinic_id=clinic["id"],
        clinic_name=clinic["name"],
        link=f"/superadmin/clinics/{clinic['id']}",
    )
    await audit(user_doc, "register", "clinic", clinic["id"], meta={"source": "public_signup", "slug": clinic["slug"]})
    token = create_token(user_id, email, "super_admin", clinic_id=clinic["id"])
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    return {
        "token": token,
        "user": {"id": user_id, "email": email, "name": payload.owner_name, "role": "super_admin", "clinic_id": clinic["id"]},
        "clinic": public_clinic_view(clinic),
    }

@api.get("/clinics/me")
async def my_clinic(user: dict = Depends(get_current_user)):
    if user.get("platform_admin"):
        return {"platform_admin": True}
    c = await get_active_clinic(user)
    usage = {
        "staff_count": await db.users.count_documents({"clinic_id": c["id"]}),
        "storage_bytes": await _clinic_storage_bytes(c["id"]),
    }
    usage["storage_used_gb"] = round(usage["storage_bytes"] / (1024 ** 3), 2)
    limits = resolve_clinic_limits(c)
    await sync_billing_lifecycle_notifications(db, c)
    view = public_clinic_view(c, usage=usage, limits=limits)
    view["usage_alerts"] = compute_usage_alerts(usage, limits)
    view["onboarding_checklist"] = await build_onboarding_checklist(db, c)
    notifs = await list_clinic_notifications(db, c["id"], limit=10)
    view["notifications"] = notifs.get("notifications") or []
    view["unread_notifications"] = notifs.get("unread_count") or 0
    return view

@api.put("/clinics/me")
async def update_my_clinic(payload: ClinicUpdateIn, user: dict = Depends(get_operational_user)):
    if user.get("platform_admin"):
        raise HTTPException(status_code=400, detail="Platform admin has no clinic")
    role = user.get("role")
    if role not in ("super_admin", "manager", "fo"):
        raise HTTPException(status_code=403, detail="Only owner, manager, or FO can update clinic settings")
    await assert_writeable(user)
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    # FO + Manager are limited to schedule fields; only Owner can change brand/identity/timezone/currency/onboarded/logo
    if role == "fo":
        allowed = {"operating_hours", "booking_slot_interval", "closed_dates"}
        disallowed = set(upd.keys()) - allowed
        if disallowed:
            raise HTTPException(status_code=403, detail=f"FO cannot change: {', '.join(sorted(disallowed))}")
    elif role == "manager":
        allowed = {"operating_hours", "booking_slot_interval", "closed_dates", "loyalty_tiers", "setup_checklist_dismissed"}
        disallowed = set(upd.keys()) - allowed
        if disallowed:
            raise HTTPException(status_code=403, detail=f"Manager cannot change: {', '.join(sorted(disallowed))}")
    if "booking_slot_interval" in upd:
        try:
            iv = int(upd["booking_slot_interval"])
        except Exception:
            raise HTTPException(status_code=400, detail="booking_slot_interval must be an integer")
        if iv < 5 or iv > 240:
            raise HTTPException(status_code=400, detail="booking_slot_interval must be between 5 and 240 minutes")
        upd["booking_slot_interval"] = iv
    if "closed_dates" in upd:
        cd = upd["closed_dates"] or []
        norm = []
        seen = set()
        for item in cd:
            if isinstance(item, str):
                item = {"date": item, "reason": ""}
            if not isinstance(item, dict):
                raise HTTPException(status_code=400, detail="closed_dates entries must be objects with 'date' and 'reason'")
            d = (item.get("date") or "").strip()
            try:
                datetime.strptime(d, "%Y-%m-%d")
            except Exception:
                raise HTTPException(status_code=400, detail=f"Invalid closed date '{d}' — use YYYY-MM-DD")
            if d in seen:
                continue
            seen.add(d)
            norm.append({"date": d, "reason": (item.get("reason") or "").strip()[:100]})
        norm.sort(key=lambda x: x["date"])
        upd["closed_dates"] = norm
    if "loyalty_tiers" in upd:
        tiers = upd["loyalty_tiers"] or []
        if not isinstance(tiers, list):
            raise HTTPException(status_code=400, detail="loyalty_tiers must be a list")
        norm_t = []
        for t in tiers:
            if not isinstance(t, dict):
                raise HTTPException(status_code=400, detail="Each loyalty tier must be an object")
            name = (t.get("name") or "").strip()[:30]
            if not name:
                raise HTTPException(status_code=400, detail="Tier name is required")
            try:
                ms = int(t.get("min_spend_idr", 0))
            except Exception:
                raise HTTPException(status_code=400, detail=f"Tier '{name}': min_spend_idr must be a number")
            if ms < 0:
                raise HTTPException(status_code=400, detail=f"Tier '{name}': min_spend_idr cannot be negative")
            norm_t.append({
                "name": name,
                "min_spend_idr": ms,
                "benefit": (t.get("benefit") or "").strip()[:200],
                "color": (t.get("color") or "#9CA3AF").strip()[:20],
            })
        norm_t.sort(key=lambda x: x["min_spend_idr"])
        upd["loyalty_tiers"] = norm_t
    await db.clinics.update_one({"id": user["clinic_id"]}, {"$set": upd})
    await audit(user, "update", "clinic", user["clinic_id"])
    c = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0})
    return public_clinic_view(c)

@api.get("/plans")
async def list_plans():
    s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
    return merged_plans(PLAN_CATALOG, s.get("plan_overrides") or {})

@api.get("/clinics/by-slug/{slug}")
async def public_clinic_by_slug(slug: str):
    c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Clinic not found")
    sub = c.get("subscription", {})
    return {
        "id": c["id"],
        "name": c["name"],
        "slug": c["slug"],
        "logo_path": c.get("logo_path", ""),
        "address": c.get("address", ""),
        "city": c.get("city", ""),
        "phone": c.get("phone", ""),
        "active": sub.get("status") in ("trial", "active"),
    }

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    if user.get("clinic_id"):
        await ensure_clinic_roles(db, user["clinic_id"])
    return await attach_permissions_to_user(db, user)

@api.get("/profile/me")
async def get_profile_me(user: dict = Depends(get_current_user)):
    if not user_has_permission(user, "profile.view_own"):
        raise HTTPException(status_code=403, detail="Not allowed to view profile")
    u = await db.users.find_one(scope(user, {"id": user["id"]}), {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return await attach_permissions_to_user(db, u)

@api.put("/profile/me")
async def update_profile_me(payload: ProfileUpdateIn, user: dict = Depends(get_current_user)):
    if not user_has_permission(user, "profile.edit_own"):
        raise HTTPException(status_code=403, detail="Not allowed to edit profile")
    existing = await db.users.find_one(scope(user, {"id": user["id"]}))
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    upd: Dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        upd["name"] = name
    if payload.phone is not None:
        upd["phone"] = (payload.phone or "").strip()
    if payload.job_title is not None:
        upd["job_title"] = (payload.job_title or "").strip()
    if payload.new_password:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Current password is required to set a new password")
        if not verify_password(payload.current_password, existing.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if len(payload.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        upd["password_hash"] = hash_password(payload.new_password)
    if not upd:
        raise HTTPException(status_code=400, detail="No changes provided")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    await audit(user, "update", "profile", user["id"])
    u = await db.users.find_one(scope(user, {"id": user["id"]}), {"_id": 0, "password_hash": 0})
    return await attach_permissions_to_user(db, u)

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    await audit(user, "logout", "auth")
    return {"ok": True}

# ---------------- Users ----------------
@api.get("/users")
async def list_users(user: dict = Depends(require_roles("super_admin", "fo", "manager"))):
    users = await db.users.find(scope(user), {"_id": 0, "password_hash": 0}).to_list(500)
    return users

@api.post("/admin/users")
async def admin_create_user(payload: UserIn, user: dict = Depends(require_roles("super_admin"))):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password required")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    await assert_writeable(user)
    await assert_staff_capacity(user)
    new_user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "clinic_id": user.get("clinic_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(new_user)
    new_user.pop("_id", None); new_user.pop("password_hash", None)
    await audit(user, "create", "user", new_user["id"])
    return new_user

@api.put("/admin/users/{uid}")
async def admin_update_user(uid: str, payload: UserIn, user: dict = Depends(require_roles("super_admin"))):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    await assert_writeable(user)
    upd = {"email": payload.email.lower(), "name": payload.name, "role": payload.role}
    if payload.password:
        upd["password_hash"] = hash_password(payload.password)
    r = await db.users.update_one(scope(user, {"id": uid}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "update", "user", uid)
    return await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "password_hash": 0})

@api.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, user: dict = Depends(require_roles("super_admin"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    await assert_writeable(user)
    r = await db.users.delete_one(scope(user, {"id": uid}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "delete", "user", uid)
    return {"ok": True}

# ---------------- Staff Schedule (working hours + days off) ----------------
class StaffScheduleIn(BaseModel):
    working_hours: Optional[Dict[str, Any]] = None
    days_off: Optional[List[Dict[str, Any]]] = None

@api.get("/users/{uid}/schedule")
async def get_staff_schedule(uid: str, user: dict = Depends(get_operational_user)):
    user = await attach_permissions_to_user(db, user)
    if uid != user.get("id") and user.get("role") not in ("super_admin", "manager", "fo") and not user_has_permission(user, "staff.view"):
        raise HTTPException(status_code=403, detail="Not allowed")
    u = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "id": 1, "name": 1, "role": 1, "working_hours": 1, "days_off": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": u["id"],
        "name": u["name"],
        "role": u["role"],
        "working_hours": u.get("working_hours") or {},
        "days_off": u.get("days_off") or [],
    }

@api.put("/users/{uid}/schedule")
async def set_staff_schedule(uid: str, payload: StaffScheduleIn, user: dict = Depends(get_operational_user)):
    user = await attach_permissions_to_user(db, user)
    can_edit = uid == user.get("id") or user.get("role") in ("super_admin", "manager") or user_has_permission(user, "staff.manage")
    if not can_edit:
        raise HTTPException(status_code=403, detail="Only owner, manager, or self can edit a staff schedule")
    await assert_writeable(user)
    upd: Dict[str, Any] = {}
    if payload.working_hours is not None:
        # Validate per-day shape
        clean: Dict[str, Any] = {}
        for k, v in (payload.working_hours or {}).items():
            if k not in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
                continue
            if not isinstance(v, dict):
                continue
            o = (v.get("open") or "").strip()
            c = (v.get("close") or "").strip()
            if o and c and o >= c:
                raise HTTPException(status_code=400, detail=f"{k}: opening time must be before closing time")
            clean[k] = {"open": o, "close": c}
        upd["working_hours"] = clean
    if payload.days_off is not None:
        norm = []
        seen = set()
        for item in payload.days_off:
            if isinstance(item, str):
                item = {"date": item, "reason": ""}
            if not isinstance(item, dict):
                continue
            d = (item.get("date") or "").strip()
            try:
                datetime.strptime(d, "%Y-%m-%d")
            except Exception:
                raise HTTPException(status_code=400, detail=f"Invalid day-off date '{d}' — use YYYY-MM-DD")
            if d in seen:
                continue
            seen.add(d)
            norm.append({"date": d, "reason": (item.get("reason") or "").strip()[:100]})
        norm.sort(key=lambda x: x["date"])
        upd["days_off"] = norm
    r = await db.users.update_one(scope(user, {"id": uid}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "update", "user_schedule", uid)
    u = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "id": 1, "name": 1, "role": 1, "working_hours": 1, "days_off": 1})
    return {
        "id": u["id"], "name": u["name"], "role": u["role"],
        "working_hours": u.get("working_hours") or {},
        "days_off": u.get("days_off") or [],
    }

# ---------------- Settings ----------------
def _resolved_branding(raw: Optional[dict]) -> dict:
    from branding_theme import resolve_branding_theme
    return resolve_branding_theme(raw or DEFAULT_SETTINGS.get("branding") or {})


@api.get("/settings")
async def get_settings(user: dict = Depends(get_operational_user)):
    s = await db.settings.find_one(scope(user, {"id": "global"}), {"_id": 0})
    if not s:
        s = {"id": "global", "clinic_id": user.get("clinic_id"), **DEFAULT_SETTINGS}
        await db.settings.insert_one(s)
        s.pop("_id", None)
    fc = s.get("form_config") or {}
    if not fc.get("note_templates"):
        fc = {**fc, "note_templates": DEFAULT_NOTE_TEMPLATES}
        s["form_config"] = fc
    if not user_has_permission(user, "settings.view"):
        if not any(user_has_permission(user, p) for p in (
            "clinical_records.view", "clinical_records.edit", "appointments.view",
            "visits.view", "visits.view_own", "dashboard.view",
        )):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return {
            "id": s.get("id"),
            "clinic_id": s.get("clinic_id"),
            "branding": _resolved_branding(s.get("branding")),
            "form_config": s.get("form_config"),
            "mapping_templates": s.get("mapping_templates", []),
            "online_booking_payment": (s.get("online_booking_payment") or DEFAULT_SETTINGS.get("online_booking_payment")),
        }
    if s.get("branding"):
        s = {**s, "branding": _resolved_branding(s.get("branding"))}
    else:
        s = {**s, "branding": _resolved_branding(None)}
    return s

@api.put("/admin/settings")
async def update_settings(payload: SettingsIn, user: dict = Depends(require_roles("super_admin"))):
    await assert_writeable(user)
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    booking_slug_raw = upd.pop("booking_slug", None)
    if booking_slug_raw is not None and user.get("clinic_id"):
        try:
            new_slug = await validate_booking_slug(db, booking_slug_raw, user["clinic_id"])
        except BookingSlugError as e:
            raise HTTPException(status_code=e.status_code, detail=e.message)
        await db.clinics.update_one({"id": user["clinic_id"]}, {"$set": {"slug": new_slug}})
    branding_in = upd.get("branding")
    if isinstance(branding_in, dict):
        from branding_theme import branding_base_for_save
        upd["branding"] = branding_base_for_save(branding_in)
    await db.settings.update_one(scope(user, {"id": "global"}), {"$set": upd}, upsert=True)
    # Ensure clinic_id is set on upsert
    await db.settings.update_one(scope(user, {"id": "global"}), {"$set": {"clinic_id": user.get("clinic_id")}})
    # Keep clinics.name / logo in sync with branding (public booking + /clinics/me use clinic doc)
    branding = upd.get("branding")
    if isinstance(branding, dict) and user.get("clinic_id"):
        clinic_upd = {}
        if branding.get("clinic_name"):
            clinic_upd["name"] = str(branding["clinic_name"]).strip()
        if "logo_path" in branding:
            clinic_upd["logo_path"] = branding.get("logo_path") or ""
        if clinic_upd:
            await db.clinics.update_one({"id": user["clinic_id"]}, {"$set": clinic_upd})
    await audit(user, "update", "settings", "global")
    s = await db.settings.find_one(scope(user, {"id": "global"}), {"_id": 0})
    if s and s.get("branding"):
        s = {**s, "branding": _resolved_branding(s.get("branding"))}
    return s

@api.post("/admin/template-image")
async def upload_template_image(file: UploadFile = File(...), user: dict = Depends(require_roles("super_admin"))):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
    if ext not in ("png", "jpg", "jpeg", "webp", "svg"):
        raise HTTPException(status_code=400, detail="Unsupported image format")
    pid = str(uuid.uuid4())
    path = f"{APP_NAME}/templates/template-{pid}.{ext}"
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large. Maximum {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    ct = file.content_type or (f"image/{ext}" if ext != "svg" else "image/svg+xml")
    try:
        result = put_object(path, data, ct)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Template upload failed. Please check storage configuration.")
    # Mark as branding so it's served publicly (templates aren't sensitive)
    await db.photos.insert_one({
        "id": pid, "visit_id": "", "patient_id": "",
        "storage_path": result["path"], "photo_type": "branding", "angle": "template",
        "content_type": ct, "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await audit(user, "upload", "template_image", pid)
    return {"image_path": result["path"], "file_url": result.get("file_url") or _public_file_url(result["path"])}

@api.post("/admin/logo")
async def upload_logo(file: UploadFile = File(...), user: dict = Depends(require_roles("super_admin"))):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
    if ext not in ("png", "jpg", "jpeg", "webp", "svg"):
        raise HTTPException(status_code=400, detail="Unsupported logo format")
    pid = str(uuid.uuid4())
    path = f"{APP_NAME}/branding/logo-{pid}.{ext}"
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Logo too large. Maximum {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    ct = file.content_type or (f"image/{ext}" if ext != "svg" else "image/svg+xml")
    try:
        result = put_object(path, data, ct)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Logo upload failed. Please check storage configuration.")
    # Persist to settings + create photo-like record so /api/files/{path} can serve it
    await db.photos.insert_one({
        "id": pid, "visit_id": "", "patient_id": "",
        "storage_path": result["path"], "photo_type": "branding", "angle": "logo",
        "content_type": ct, "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.settings.update_one(
        scope(user, {"id": "global"}),
        {"$set": {"branding.logo_path": result["path"]}},
        upsert=True,
    )
    if user.get("clinic_id"):
        await db.clinics.update_one({"id": user["clinic_id"]}, {"$set": {"logo_path": result["path"]}})
    await audit(user, "upload", "logo", pid)
    return {"logo_path": result["path"], "file_url": result.get("file_url") or _public_file_url(result["path"])}

# ---------------- Patients ----------------
@api.post("/patients")
async def create_patient(payload: PatientIn, user: dict = Depends(require_permission("patients.create"))):
    await assert_writeable(user)
    p = payload.model_dump()
    if user.get("role") == "fo" and not user.get("platform_admin"):
        p = {k: v for k, v in p.items() if k in FO_PATIENT_EDIT_FIELDS}
        p["full_name"] = payload.full_name
    validate_patient_marketing_fields(p)
    p["id"] = str(uuid.uuid4())
    p["clinic_id"] = user.get("clinic_id")
    p["created_at"] = datetime.now(timezone.utc).isoformat()
    p["created_by"] = user["id"]
    if p.get("consent_status") == "signed" and not p.get("consent_signed_at"):
        p["consent_signed_at"] = p["created_at"]
    await db.patients.insert_one(p)
    p.pop("_id", None)
    await audit(user, "create", "patient", p["id"])
    try:
        from whatsgo_service import maybe_sync_patient_whatsgo
        asyncio.create_task(maybe_sync_patient_whatsgo(db, os.environ["JWT_SECRET"], user.get("clinic_id"), p, is_update=False))
    except Exception:
        pass
    if p.get("consent_status") in ("signed", "cancelled"):
        await log_consent(
            db, user, p["consent_status"],
            p["id"],
            new_value={
                "consent_status": p.get("consent_status"),
                "consent_notes": p.get("consent_notes"),
                "consent_signed_at": p.get("consent_signed_at"),
            },
        )
    return p

def _patient_list_filter(scope_flt: dict, q: Optional[str]) -> dict:
    flt = dict(scope_flt)
    if q:
        or_clauses = [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"user_code": {"$regex": q, "$options": "i"}},
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"membership_name": {"$regex": q, "$options": "i"}},
        ]
        digits = re.sub(r"\D", "", q)
        if len(digits) >= 3:
            phone_pattern = ".*?".join(re.escape(ch) for ch in digits)
            or_clauses.append({"phone": {"$regex": phone_pattern, "$options": "i"}})
        flt["$or"] = or_clauses
    return flt

@api.get("/patients")
async def list_patients(
    q: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_operational_user),
):
    if not user_has_permission(user, "patients.view") and not user_has_permission(user, "patients.view_assigned"):
        raise HTTPException(status_code=403, detail="Not allowed to list patients")
    flt = await apply_patient_list_filter(db, user, _patient_list_filter(scope(user), q))
    sort_field = "full_name" if q else "created_at"
    sort_dir = 1 if q else -1
    if page is not None:
        total = await db.patients.count_documents(flt)
        skip = (page - 1) * page_size
        items = await db.patients.find(flt, {"_id": 0}).sort(sort_field, sort_dir).skip(skip).limit(page_size).to_list(page_size)
        from visit_workflow import enrich_patients_loyalty
        from patient_labels_core import enrich_patients_with_labels
        await enrich_patients_loyalty(db, user.get("clinic_id"), items)
        await enrich_patients_with_labels(db, user.get("clinic_id"), items)
        total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": total_pages,
        }
    items = await db.patients.find(flt, {"_id": 0}).sort(sort_field, sort_dir).to_list(2000)
    from patient_labels_core import enrich_patients_with_labels
    await enrich_patients_with_labels(db, user.get("clinic_id"), items)
    return items

@api.get("/patients/export")
async def export_patients(
    user: dict = Depends(require_permission("patients.export")),
    format: str = Query("xlsx", description="xlsx or csv"),
):
    cid = user.get("clinic_id")
    rows_db = await db.patients.find({"clinic_id": cid}, {"_id": 0}).sort("full_name", 1).to_list(10000)
    export_rows = [patient_to_export_row(p) for p in rows_db]
    if format.lower() == "csv":
        csv_text = rows_to_csv(export_rows)
        return FastResponse(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="patients.csv"'},
        )
    xlsx_bytes = rows_to_xlsx(export_rows)
    return FastResponse(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="patients.xlsx"'},
    )

@api.get("/patients/import-template")
async def patients_import_template(
    user: dict = Depends(require_permission("patients.create")),
    format: str = Query("xlsx", description="xlsx or csv"),
):
    if format.lower() == "csv":
        csv_text = rows_to_csv([])
        return FastResponse(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="patients-import-template.csv"'},
        )
    xlsx_bytes = rows_to_xlsx([])
    return FastResponse(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="patients-import-template.xlsx"'},
    )

@api.post("/patients/import")
async def import_patients(
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("patients.create")),
):
    await assert_writeable(user)
    cid = user.get("clinic_id")
    raw = await file.read()
    fname = (file.filename or "").lower()
    try:
        if fname.endswith(".xlsx") or fname.endswith(".xlsm"):
            parsed, parse_errors = parse_xlsx_bytes(raw)
        elif fname.endswith(".csv"):
            text = raw.decode("utf-8-sig")
            parsed, parse_errors = parse_csv_text(text)
        else:
            try:
                parsed, parse_errors = parse_xlsx_bytes(raw)
            except Exception:
                text = raw.decode("utf-8-sig")
                parsed, parse_errors = parse_csv_text(text)
    except RuntimeError as ex:
        raise HTTPException(status_code=500, detail=str(ex))
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Could not read file: {ex}")

    if not parsed and parse_errors:
        raise HTTPException(status_code=400, detail=parse_errors[0]["message"])

    existing_rows = await db.patients.find({"clinic_id": cid}, {"_id": 0}).to_list(20000)
    import re as _re

    def _phone_key(p: str) -> str:
        return _re.sub(r"\D", "", p or "")

    by_code = {(p.get("user_code") or "").lower(): p for p in existing_rows if p.get("user_code")}
    by_phone = {_phone_key(p.get("phone", "")): p for p in existing_rows if p.get("phone")}
    by_name = {(p.get("full_name") or "").lower(): p for p in existing_rows if p.get("full_name")}

    created = 0
    updated = 0
    errors = list(parse_errors)

    for i, row in enumerate(parsed, start=2):
        code_key = (row.get("user_code") or "").lower()
        phone_key = _phone_key(row.get("phone", ""))
        name_key = (row.get("full_name") or "").lower()
        match = (
            (by_code.get(code_key) if code_key else None)
            or (by_phone.get(phone_key) if phone_key else None)
            or by_name.get(name_key)
        )
        try:
            doc = build_patient_doc(row, cid, user["id"], existing=match)
            if match:
                await db.patients.update_one(
                    {"clinic_id": cid, "id": match["id"]},
                    {"$set": {k: v for k, v in doc.items() if k not in ("id", "clinic_id", "created_at", "created_by")}},
                )
                if code_key:
                    by_code[code_key] = doc
                if phone_key:
                    by_phone[phone_key] = doc
                by_name[name_key] = doc
                updated += 1
            else:
                await db.patients.insert_one(doc)
                if code_key:
                    by_code[code_key] = doc
                if phone_key:
                    by_phone[phone_key] = doc
                by_name[name_key] = doc
                created += 1
        except Exception as ex:
            errors.append({"row": i, "message": str(ex)})

    await audit(user, "import", "patient", "", {"created": created, "updated": updated, "errors": len(errors)})
    return {"created": created, "updated": updated, "errors": errors, "total": len(parsed)}

@api.get("/patients/{pid}")
async def get_patient(pid: str, user: dict = Depends(get_operational_user)):
    p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    await assert_patient_access(db, user, pid)
    from patient_labels_core import enrich_patients_with_labels
    await enrich_patients_with_labels(db, user.get("clinic_id"), [p])
    return p

@api.put("/patients/{pid}")
async def update_patient(pid: str, payload: PatientIn, user: dict = Depends(require_permission("patients.edit"))):
    await assert_writeable(user)
    existing = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    upd = filter_patient_update_fields(user, upd)
    validate_patient_marketing_fields(upd)
    if not upd:
        raise HTTPException(status_code=400, detail="No allowed fields to update")
    if upd.get("consent_status") == "signed" and not upd.get("consent_signed_at"):
        upd["consent_signed_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.patients.update_one(scope(user, {"id": pid}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    updated = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
    await audit(user, "update", "patient", pid)
    old_c = {
        "consent_status": existing.get("consent_status") or "unsigned",
        "consent_notes": existing.get("consent_notes"),
        "consent_signed_at": existing.get("consent_signed_at"),
    }
    new_c = {
        "consent_status": updated.get("consent_status") or "unsigned",
        "consent_notes": updated.get("consent_notes"),
        "consent_signed_at": updated.get("consent_signed_at"),
    }
    if old_c != new_c:
        if new_c.get("consent_status") == "cancelled":
            consent_action = "cancelled"
        elif new_c.get("consent_status") == "signed" and old_c.get("consent_status") != "signed":
            consent_action = "signed"
        else:
            consent_action = "updated"
        await log_consent(db, user, consent_action, pid, old_value=old_c, new_value=new_c)
    try:
        from whatsgo_service import maybe_sync_patient_whatsgo
        asyncio.create_task(maybe_sync_patient_whatsgo(db, os.environ["JWT_SECRET"], user.get("clinic_id"), updated, is_update=True))
    except Exception:
        pass
    return updated

@api.delete("/patients/{pid}")
async def delete_patient(pid: str, user: dict = Depends(require_permission("patients.delete"))):
    """Remove a patient record. Blocked if visits or bookings exist."""
    await assert_writeable(user)
    cid = user.get("clinic_id")
    existing = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1, "full_name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    visit_count = await db.visits.count_documents({"clinic_id": cid, "patient_id": pid})
    if visit_count:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: patient has {visit_count} visit(s). Remove or reassign visits first.",
        )
    booking_count = await db.bookings.count_documents({"clinic_id": cid, "patient_id": pid})
    if booking_count:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: patient has {booking_count} booking(s). Cancel or reassign bookings first.",
        )
    await db.photos.delete_many({"clinic_id": cid, "patient_id": pid})
    r = await db.patients.delete_one({"clinic_id": cid, "id": pid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Patient not found")
    await audit(user, "delete", "patient", pid, {"name": existing.get("full_name")})
    return {"ok": True}

# ---------------- Visits ----------------
@api.post("/visits")
async def create_visit(payload: VisitIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    await assert_writeable(user)
    from performers import normalize_performers_input, sync_legacy_performer_fields

    cid = user.get("clinic_id")
    performers = await normalize_performers_input(
        db,
        cid,
        payload.performers,
        legacy_performer_id=payload.assigned_to,
        require_at_least_one=False,
        allow_multiple=True,
    )
    v = payload.model_dump(exclude={"performers"})
    v["performers"] = performers
    v["assigned_to"] = performers[0]["staff_id"] if performers else payload.assigned_to
    v["id"] = str(uuid.uuid4())
    v["clinic_id"] = cid
    v["status"] = "in_progress"  # in_progress | completed
    v["payment_status"] = "unpaid"
    v["created_at"] = datetime.now(timezone.utc).isoformat()
    v["created_by"] = user["id"]
    if not v.get("visit_date"):
        v["visit_date"] = datetime.now(timezone.utc).isoformat()
    if v.get("booking_id"):
        b = await db.bookings.find_one(
            {"clinic_id": user.get("clinic_id"), "id": v["booking_id"]},
            {"_id": 0, "visit_id": 1},
        )
        if b and b.get("visit_id"):
            raise HTTPException(status_code=409, detail="Booking already has a visit")
    sync_legacy_performer_fields(v)
    await db.visits.insert_one(v)
    if v.get("booking_id"):
        await db.bookings.update_one(
            {"clinic_id": user.get("clinic_id"), "id": v["booking_id"]},
            {"$set": {"visit_id": v["id"], "patient_id": v["patient_id"]}},
        )
    v.pop("_id", None)
    await audit(user, "create", "visit", v["id"])
    safe_emit_visit_event(v, "visit_created", message="Visit created")
    return v

@api.get("/visits")
async def list_visits(patient_id: Optional[str] = None, status: Optional[str] = None, assigned_to: Optional[str] = None, user: dict = Depends(get_operational_user)):
    if not user_has_permission(user, "visits.view") and not user_has_permission(user, "visits.view_own"):
        raise HTTPException(status_code=403, detail="Not allowed to list visits")
    await assert_feature(user, "emr")
    flt = await apply_staff_visit_filter(db, user)
    if patient_id:
        flt["patient_id"] = patient_id
    if status:
        flt["status"] = status
    # FO/manager may filter by assignee; clinical staff are always scoped to self
    if assigned_to and user_has_permission(user, "visits.view"):
        flt["assigned_to"] = assigned_to
    items = await db.visits.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
    for v in items:
        p = await db.patients.find_one({"id": v["patient_id"]}, {"_id": 0, "full_name": 1})
        v["patient_name"] = p["full_name"] if p else "Unknown"
    return items

@api.get("/visits/{vid}")
async def get_visit(vid: str, user: dict = Depends(get_operational_user)):
    if not user_has_permission(user, "visits.view") and not user_has_permission(user, "visits.view_own"):
        raise HTTPException(status_code=403, detail="Not allowed to view this visit")
    v = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, v)
    p = await db.patients.find_one({"id": v["patient_id"]}, {"_id": 0})
    if p:
        from patient_labels_core import enrich_patients_with_labels
        await enrich_patients_with_labels(db, v["clinic_id"], [p])
    v["patient"] = p
    v["clinical_record"] = enrich_record_status(
        await db.clinical_records.find_one({"visit_id": vid}, {"_id": 0}), v,
    )
    v["therapist_record"] = enrich_record_status(
        await db.therapist_records.find_one({"visit_id": vid}, {"_id": 0}), v,
    )
    performer_notes = await db.performer_visit_notes.find({"visit_id": vid}, {"_id": 0}).to_list(50)
    for n in performer_notes:
        n["note_status"] = effective_note_status(n, v)
    v["performer_notes"] = performer_notes
    v["performer_note_slots"] = visit_performer_slots(v)
    v["treatment_items"] = await db.treatment_items.find({"visit_id": vid}, {"_id": 0}).to_list(200)
    v["product_usages"] = await db.visit_product_usages.find(
        {"clinic_id": v["clinic_id"], "visit_id": vid},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    v["photos"] = await db.photos.find({"visit_id": vid}, {"_id": 0}).to_list(200)
    v["mappings"] = await db.mappings.find({"visit_id": vid}, {"_id": 0}).to_list(50)
    if v.get("assigned_to"):
        u = await db.users.find_one({"id": v["assigned_to"]}, {"_id": 0, "name": 1, "role": 1})
        v["assigned_user"] = u
    if v.get("booking_id"):
        v["booking"] = await db.bookings.find_one(
            {"clinic_id": v["clinic_id"], "id": v["booking_id"]},
            {"_id": 0},
        )
    try:
        v["consent_context"] = await build_visit_consent_context(
            db, v["clinic_id"], v, v.get("booking"),
        )
    except Exception:
        v["consent_context"] = None
    try:
        v["consent_forms"] = await db.consent_forms.find(
            {"clinic_id": v["clinic_id"], "visit_id": vid},
            {"_id": 0, "patient_signature": 0, "staff_signature": 0},
        ).sort("created_at", -1).to_list(20)
        for cf in v["consent_forms"]:
            cf["consent_required"] = True
    except Exception:
        v["consent_forms"] = []
    try:
        v["consent_required"] = await visit_consent_required(db, v["clinic_id"], v, v.get("booking"))
    except Exception:
        v["consent_required"] = bool(v.get("consent_forms")) or bool((v.get("consent_context") or {}).get("consent_required"))
    return v

@api.put("/visits/{vid}/status")
async def update_visit_status(vid: str, payload: VisitStatusIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    if payload.status not in ("in_progress", "submitted", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await assert_writeable(user)
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if payload.status == "completed":
        await assert_required_consents_signed(db, user.get("clinic_id"), vid)
    upd = {"status": payload.status}
    if payload.status == "completed":
        upd["completed_at"] = datetime.now(timezone.utc).isoformat()
        upd["completed_by"] = user["id"]
    await db.visits.update_one(scope(user, {"id": vid}), {"$set": upd})
    if payload.status == "completed":
        from visit_workflow import sync_booking_when_visit_completed
        await sync_booking_when_visit_completed(db, {**visit, **upd})
        await lock_all_visit_notes(db, vid, visit["clinic_id"])
        await log_clinical_note(
            db, user, "locked", vid, "visit",
            new_value={"trigger": "visit_completed"},
        )
        try:
            inv = await db.invoices.find_one(
                {"clinic_id": visit["clinic_id"], "visit_id": vid, "payment_status": {"$nin": ["cancelled"]}},
                {"_id": 0},
            )
            if inv:
                await sync_commission_records_for_invoice(db, inv, {**visit, **upd})
        except Exception:
            pass
    await audit(user, "status_change", "visit", vid, {"to": payload.status})
    updated_visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
    if updated_visit:
        if payload.status == "submitted":
            safe_emit_visit_event(
                updated_visit,
                "visit_submitted",
                message="Visit submitted",
            )
        elif payload.status == "completed":
            safe_emit_visit_event(
                updated_visit,
                "visit_updated",
                message="Visit completed",
                extra_payload={"completed": True},
            )
        else:
            safe_emit_visit_event(
                updated_visit,
                "visit_updated",
                message=f"Visit status: {payload.status}",
            )
    if payload.status == "completed":
        try:
            from messaging_automation import safe_trigger_automation_rules
            completed_visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
            if completed_visit:
                safe_trigger_automation_rules(
                    db,
                    os.environ.get("JWT_SECRET", ""),
                    user["clinic_id"],
                    "visit_completed",
                    visit=completed_visit,
                )
        except Exception:
            pass
    return await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})

@api.put("/visits/{vid}/payment")
async def record_visit_payment(vid: str, payload: VisitPaymentIn, user: dict = Depends(require_roles("super_admin", "fo", "manager"))):
    """Record payment for a visit (FO checkout)."""
    await assert_writeable(user)
    await assert_feature(user, "billing")
    if payload.payment_status not in ("unpaid", "paid"):
        raise HTTPException(status_code=400, detail="Invalid payment_status")
    visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    items = await db.treatment_items.find({"visit_id": vid}, {"_id": 0}).to_list(200)
    from visit_workflow import compute_visit_charges
    charges = compute_visit_charges(items)
    amount = int(payload.amount_idr) if payload.amount_idr is not None else charges["total_idr"]
    upd = {
        "payment_status": payload.payment_status,
        "payment_method": (payload.payment_method or "cash").strip(),
        "amount_idr": amount,
        "payment_notes": (payload.notes or "").strip(),
        "subtotal_idr": charges["subtotal_idr"],
    }
    if payload.payment_status == "paid":
        upd["paid_at"] = datetime.now(timezone.utc).isoformat()
        upd["paid_by"] = user["id"]
    await db.visits.update_one(scope(user, {"id": vid}), {"$set": upd})
    await audit(user, "payment", "visit", vid, {"amount_idr": amount, "status": payload.payment_status})
    v = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
    v["treatment_items"] = items
    return v

# ---------------- Clinical Record (Doctor) ----------------
@api.put("/visits/{vid}/clinical")
async def upsert_clinical(vid: str, payload: ClinicalRecordIn, user: dict = Depends(get_operational_user)):
    await assert_writeable(user)
    await assert_feature(user, "emr")
    if user.get("role") not in ("super_admin", "doctor") and not user.get("platform_admin"):
        raise HTTPException(status_code=403, detail="Only doctors can edit clinical records")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    existing = await db.clinical_records.find_one({"visit_id": vid})
    _, audit_reason = check_primary_record_edit(
        user, visit, existing, "doctor_id", frozenset({"doctor"}), payload.edit_reason,
    )
    data = payload.model_dump()
    edit_reason = (data.pop("edit_reason", None) or "").strip()
    data["visit_id"] = vid
    data["clinic_id"] = user.get("clinic_id")
    data["doctor_id"] = user["id"]
    data["doctor_name"] = user["name"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    submit = data.pop("submit", False)
    if submit:
        data["submitted"] = True
        data["submitted_at"] = datetime.now(timezone.utc).isoformat()
        data["note_status"] = "completed"
    else:
        data["note_status"] = "draft"
        data["submitted"] = False
    if visit.get("status") == "completed":
        data["note_status"] = "locked"
    await db.clinical_records.update_one({"visit_id": vid}, {"$set": data}, upsert=True)
    if submit:
        from visit_workflow import mark_visit_submitted
        await mark_visit_submitted(
            db, user.get("clinic_id"), vid, created_by=user["id"],
            note_role="doctor", staff_name=user.get("name") or "",
        )
    else:
        safe_emit_visit_event(
            visit, "visit_updated",
            message="Doctor note saved",
            extra_payload={"note_role": "doctor"},
        )
    if submit:
        await log_clinical_note(
            db, user, "completed", vid, "doctor",
            old_value={"note_status": (existing or {}).get("note_status")},
            new_value={"note_status": data.get("note_status")},
        )
    elif audit_reason:
        await log_clinical_note(
            db, user, "edited", vid, "doctor",
            old_value={"note_status": (existing or {}).get("note_status")},
            new_value={"note_status": data.get("note_status")},
            reason=edit_reason,
        )
    rec = await db.clinical_records.find_one({"visit_id": vid}, {"_id": 0})
    return enrich_record_status(rec, visit)

# ---------------- Therapist Record ----------------
@api.put("/visits/{vid}/therapist")
async def upsert_therapist(vid: str, payload: TherapistRecordIn, user: dict = Depends(get_operational_user)):
    await assert_writeable(user)
    await assert_feature(user, "emr")
    if user.get("role") not in ("super_admin", "therapist", "nurse") and not user.get("platform_admin"):
        raise HTTPException(status_code=403, detail="Only therapists or nurses can edit treatment records")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    existing = await db.therapist_records.find_one({"visit_id": vid})
    _, audit_reason = check_primary_record_edit(
        user, visit, existing, "therapist_id", frozenset({"therapist", "nurse"}), payload.edit_reason,
    )
    data = payload.model_dump()
    edit_reason = (data.pop("edit_reason", None) or "").strip()
    data["visit_id"] = vid
    data["clinic_id"] = user.get("clinic_id")
    data["therapist_id"] = user["id"]
    data["therapist_name"] = user["name"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    submit = data.pop("submit", False)
    if submit:
        data["submitted"] = True
        data["submitted_at"] = datetime.now(timezone.utc).isoformat()
        data["note_status"] = "completed"
    else:
        data["note_status"] = "draft"
        data["submitted"] = False
    if visit.get("status") == "completed":
        data["note_status"] = "locked"
    await db.therapist_records.update_one({"visit_id": vid}, {"$set": data}, upsert=True)
    if submit:
        from visit_workflow import mark_visit_submitted
        await mark_visit_submitted(
            db, user.get("clinic_id"), vid, created_by=user["id"],
            note_role="therapist", staff_name=user.get("name") or "",
        )
    else:
        safe_emit_visit_event(
            visit, "visit_updated",
            message="Therapist note saved",
            extra_payload={"note_role": "therapist"},
        )
    if submit:
        await log_clinical_note(
            db, user, "completed", vid, "therapist",
            old_value={"note_status": (existing or {}).get("note_status")},
            new_value={"note_status": data.get("note_status")},
        )
    elif audit_reason:
        await log_clinical_note(
            db, user, "edited", vid, "therapist",
            old_value={"note_status": (existing or {}).get("note_status")},
            new_value={"note_status": data.get("note_status")},
            reason=edit_reason,
        )
    rec = await db.therapist_records.find_one({"visit_id": vid}, {"_id": 0})
    return enrich_record_status(rec, visit)

# ---------------- Per-performer assistant notes ----------------
@api.put("/visits/{vid}/performer-notes/{staff_id}")
async def upsert_performer_note(vid: str, staff_id: str, payload: PerformerNoteIn, user: dict = Depends(get_operational_user)):
    await assert_writeable(user)
    await assert_feature(user, "emr")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    slot_ids = {s["staff_id"] for s in visit_performer_slots(visit)}
    if staff_id not in slot_ids and staff_id not in staff_ids_from_performers(visit):
        raise HTTPException(status_code=404, detail="Performer not on this visit")
    if staff_id != user.get("id") and user.get("role") not in ("super_admin",) and not user.get("platform_admin"):
        raise HTTPException(status_code=403, detail="You can only edit your own performer note")
    existing = await db.performer_visit_notes.find_one({"visit_id": vid, "staff_id": staff_id}, {"_id": 0})
    _, audit_reason = check_performer_note_edit(user, visit, existing, staff_id, payload.edit_reason)
    performer = next((p for p in get_performers(visit) if p.get("staff_id") == staff_id), {})
    data = payload.model_dump()
    edit_reason = (data.pop("edit_reason", None) or "").strip()
    submit = data.pop("submit", False)
    doc = {
        **data,
        "visit_id": vid,
        "clinic_id": user.get("clinic_id"),
        "staff_id": staff_id,
        "staff_name": performer.get("staff_name_snapshot") or user.get("name") or "",
        "staff_role": performer.get("staff_role_snapshot") or user.get("role") or "",
        "performer_type": performer.get("performer_type") or "assistant",
        "note_type": "assistant" if (performer.get("performer_type") or "") in ("assistant", "secondary") else (performer.get("performer_type") or "assistant"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": user["id"],
    }
    if submit:
        doc["submitted"] = True
        doc["submitted_at"] = datetime.now(timezone.utc).isoformat()
        doc["note_status"] = "completed"
    else:
        doc["note_status"] = "draft"
        doc["submitted"] = False
    if visit.get("status") == "completed":
        doc["note_status"] = "locked"
    if not existing:
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = doc["updated_at"]
        await db.performer_visit_notes.insert_one(doc)
    else:
        await db.performer_visit_notes.update_one({"visit_id": vid, "staff_id": staff_id}, {"$set": doc})
    if submit:
        role_label = doc.get("staff_role") or user.get("role") or "staff"
        safe_emit_visit_event(
            visit,
            "visit_submitted",
            message=f"{doc.get('staff_name') or user.get('name') or 'Staff'} submitted visit notes",
            extra_payload={"note_role": role_label},
        )
    else:
        safe_emit_visit_event(
            visit, "visit_updated",
            message="Performer note saved",
            extra_payload={"note_role": doc.get("staff_role") or user.get("role")},
        )
    if submit:
        await log_clinical_note(
            db, user, "completed", vid, doc.get("note_type") or "performer",
            old_value={"note_status": (existing or {}).get("note_status"), "staff_id": staff_id},
            new_value={"note_status": doc.get("note_status"), "staff_id": staff_id},
        )
    elif audit_reason:
        await log_clinical_note(
            db, user, "edited", vid, doc.get("note_type") or "performer",
            old_value={"note_status": (existing or {}).get("note_status"), "staff_id": staff_id},
            new_value={"note_status": doc.get("note_status"), "staff_id": staff_id},
            reason=edit_reason,
        )
    note = await db.performer_visit_notes.find_one({"visit_id": vid, "staff_id": staff_id}, {"_id": 0})
    note["note_status"] = effective_note_status(note, visit)
    return note

# ---------------- Treatment Items ----------------
@api.post("/visits/{vid}/treatments")
async def add_treatment(vid: str, payload: TreatmentItemIn, user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse"))):
    await assert_writeable(user)
    await assert_feature(user, "emr")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    await assert_required_consents_signed(db, user.get("clinic_id"), vid)
    _, performer_snap = await validate_visit_treatment_item(
        db,
        user.get("clinic_id"),
        visit,
        treatment_name=payload.name,
        performer_id=payload.performer_id,
    )
    item = payload.model_dump()
    product_id = item.pop("product_id", None)
    quantity_used = item.pop("quantity_used", None)
    dose_notes = item.pop("dose_notes", "") or ""
    if not item.get("source"):
        item["source"] = "manual"
    if item.get("confirmed_by_staff") is None:
        item["confirmed_by_staff"] = True
    item.update(performer_snap)
    item["id"] = str(uuid.uuid4())
    item["visit_id"] = vid
    item["clinic_id"] = user.get("clinic_id")
    item["created_by"] = user["id"]
    item["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.treatment_items.insert_one(item)
    item.pop("_id", None)
    if product_id and quantity_used and float(quantity_used) > 0:
        try:
            usage = await create_product_usage(
                db,
                clinic_id=user.get("clinic_id"),
                visit_id=vid,
                treatment_item_id=item["id"],
                product_id=product_id,
                quantity_used=float(quantity_used),
                dose_notes=dose_notes,
                used_by_staff_id=user["id"],
                performer_id=payload.performer_id,
                performer_snap=performer_snap,
                user_id=user["id"],
            )
            item["product_usage"] = usage
        except HTTPException:
            await db.treatment_items.delete_one({"id": item["id"]})
            raise
    await audit(user, "create", "treatment_item", item["id"])
    return item

@api.post("/visits/{vid}/treatments/confirm-booked")
async def confirm_booked_treatment(
    vid: str,
    user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse")),
):
    """Add the booking treatment as a confirmed performed treatment line."""
    await assert_writeable(user)
    await assert_feature(user, "emr")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    await assert_required_consents_signed(db, user.get("clinic_id"), vid)
    if not visit.get("booking_id"):
        raise HTTPException(status_code=400, detail="Visit has no linked booking")
    booking = await db.bookings.find_one(
        {"clinic_id": user.get("clinic_id"), "id": visit["booking_id"]},
        {"_id": 0},
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    from treatment_items_logic import confirm_booked_treatment_item
    item = await confirm_booked_treatment_item(
        db,
        clinic_id=user.get("clinic_id"),
        visit=visit,
        booking=booking,
        user_id=user["id"],
    )
    await audit(user, "create", "treatment_item", item["id"])
    return item

@api.put("/visits/{vid}/treatment-outcome")
async def set_visit_treatment_outcome(
    vid: str,
    payload: TreatmentOutcomeIn,
    user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse")),
):
    """Record that no treatment was performed during the visit."""
    await assert_writeable(user)
    await assert_feature(user, "emr")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    if payload.no_treatment_performed:
        reason = (payload.no_treatment_reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required when no treatment was performed.")
        upd = {
            "no_treatment_performed": True,
            "no_treatment_reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    else:
        upd = {
            "no_treatment_performed": False,
            "no_treatment_reason": "",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    await db.visits.update_one(scope(user, {"id": vid}), {"$set": upd})
    return {"ok": True, **upd}

@api.delete("/visits/{vid}/treatments/{iid}")
async def delete_treatment(vid: str, iid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse"))):
    await assert_writeable(user)
    await assert_feature(user, "emr")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    await reverse_usages_for_treatment_item(
        db, user.get("clinic_id"), iid, created_by=user["id"], reason="Treatment item removed",
    )
    await db.treatment_items.delete_one(scope(user, {"id": iid, "visit_id": vid}))
    await audit(user, "delete", "treatment_item", iid)
    return {"ok": True}

# ---------------- Photos ----------------
@api.post("/visits/{vid}/photos")
async def upload_photo(
    vid: str,
    file: UploadFile = File(...),
    photo_type: str = Form(...),
    angle: str = Form(...),
    notes: str = Form(""),
    user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse")),
):
    await assert_writeable(user)
    await assert_feature(user, "photos")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "webp"):
        raise HTTPException(status_code=400, detail=UNSUPPORTED_PHOTO_MESSAGE)
    pid = str(uuid.uuid4())
    path = f"{APP_NAME}/visits/{vid}/{pid}.{ext}"
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=PHOTO_TOO_LARGE_MESSAGE)
    await assert_storage_capacity(user, len(data))
    try:
        result = put_object(path, data, file.content_type or f"image/{ext}")
    except Exception as e:
        clinic = await db.clinics.find_one({"id": user.get("clinic_id")}, {"_id": 0, "name": 1}) if user.get("clinic_id") else None
        await log_platform_error(
            db, module="photos", message="Photo upload failed", severity="error", error_type="failed_upload",
            clinic_id=user.get("clinic_id"), clinic_name=(clinic or {}).get("name"),
            meta={"visit_id": vid, "error": str(e)[:120]},
        )
        raise HTTPException(status_code=502, detail="Upload failed. Please try again.")
    rec = {
        "id": pid,
        "visit_id": vid,
        "clinic_id": user.get("clinic_id"),
        "patient_id": visit["patient_id"],
        "storage_path": result["path"],
        "photo_type": photo_type,
        "angle": angle,
        "notes": notes,
        "content_type": file.content_type or f"image/{ext}",
        "size_bytes": len(data),
        "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.photos.insert_one(rec)
    rec.pop("_id", None)
    await audit(user, "upload", "photo", pid)
    rec["file_url"] = _public_file_url(rec["storage_path"])
    return rec

@api.delete("/visits/{vid}/photos/{pid}")
async def delete_photo(vid: str, pid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "nurse"))):
    await assert_writeable(user)
    await assert_feature(user, "photos")
    await db.photos.delete_one(scope(user, {"id": pid, "visit_id": vid}))
    await audit(user, "delete", "photo", pid)
    return {"ok": True}

async def _assert_file_access(rec: dict, auth: Optional[str], authorization: Optional[str]) -> None:
    if rec.get("photo_type") in ("branding", "platform_branding"):
        return
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Auth required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not payload.get("platform_admin"):
        owner = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "clinic_id": 1})
        file_cid = rec.get("clinic_id")
        if file_cid and owner and owner.get("clinic_id") != file_cid:
            raise HTTPException(status_code=403, detail="Access denied")

async def _serve_upload_response(
    path: str,
    auth: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    rel = _safe_rel_path(path)
    abs_path = _upload_abs_path(rel)
    if not abs_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    rec = await db.photos.find_one({"storage_path": rel}, {"_id": 0})
    content_type = None
    if rec:
        await _assert_file_access(rec, auth, authorization)
        content_type = rec.get("content_type")
    elif _is_public_upload_rel_path(rel):
        pass
    else:
        clinic_id = await _resolve_clinic_id_for_upload(rel)
        await _assert_file_access(
            {"clinic_id": clinic_id, "photo_type": "clinical"},
            auth,
            authorization,
        )

    if USE_LOCAL_UPLOADS:
        media = content_type or mimetypes.guess_type(abs_path.name)[0] or "application/octet-stream"
        return FileResponse(abs_path, media_type=media)

    data, guessed = get_object(rel)
    return FastResponse(content=data, media_type=content_type or guessed)

@api.get("/uploads/{path:path}")
async def serve_upload_api(path: str, auth: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    return await _serve_upload_response(path, auth, authorization)

@api.get("/files/{path:path}")
async def serve_file_api(path: str, auth: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    return await _serve_upload_response(path, auth, authorization)

@api.get("/branding")
async def public_branding():
    s = await db.settings.find_one({"id": "global"}, {"_id": 0, "branding": 1})
    return _resolved_branding((s or {}).get("branding"))

@api.get("/platform/support")
async def platform_support():
    """Public — returns platform support contact info (WhatsApp number, hours)."""
    s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
    return {
        "whatsapp": s.get("support_whatsapp", ""),
        "hours": s.get("support_hours", ""),
        "email": s.get("support_email", ""),
    }

# ---------------- Mappings ----------------
@api.post("/visits/{vid}/mappings")
async def upsert_mapping(vid: str, payload: MappingIn, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    await assert_writeable(user)
    await assert_feature(user, "mapping")
    visit = await db.visits.find_one(scope(user, {"id": vid}))
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    await assert_staff_visit_access(db, user, visit)
    rec = payload.model_dump()
    rec["id"] = str(uuid.uuid4())
    rec["visit_id"] = vid
    rec["clinic_id"] = user.get("clinic_id")
    rec["created_by"] = user["id"]
    rec["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.mappings.insert_one(rec)
    rec.pop("_id", None)
    await audit(user, "save", "mapping", rec["id"])
    return rec

@api.delete("/visits/{vid}/mappings/{mid}")
async def delete_mapping(vid: str, mid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    await assert_writeable(user)
    await db.mappings.delete_one(scope(user, {"id": mid, "visit_id": vid}))
    return {"ok": True}

# ---------------- History Timeline ----------------
@api.get("/patients/{pid}/timeline")
async def patient_timeline(pid: str, user: dict = Depends(get_operational_user)):
    p = await db.patients.find_one(scope(user, {"id": pid}))
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    await assert_patient_access(db, user, pid)
    visits = await db.visits.find(await apply_staff_visit_filter(db, user, {"patient_id": pid}), {"_id": 0}).sort("created_at", -1).to_list(500)
    for v in visits:
        v["clinical_record"] = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0})
        v["therapist_record"] = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0})
        v["treatment_items"] = await db.treatment_items.find({"visit_id": v["id"]}, {"_id": 0}).to_list(50)
        v["photo_count"] = await db.photos.count_documents({"visit_id": v["id"]})
    return visits

# ---------------- Audit Log ----------------
@api.get("/audit-logs")
async def list_audit(
    limit: int = Query(200, ge=1, le=1000),
    module: Optional[str] = None,
    user: dict = Depends(get_operational_user),
):
    if user.get("role") not in ("super_admin", "manager") and not user_has_permission(user, "audit.view"):
        raise HTTPException(status_code=403, detail="Not allowed to view audit log")
    await assert_feature(user, "audit_log")
    flt = scope(user)
    if module:
        flt["module"] = module
    logs = await db.audit_logs.find(flt, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

# ---------------- Stats ----------------
@api.get("/stats")
async def stats(user: dict = Depends(require_permission("dashboard.view"))):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    flt = scope(user)
    total_patients = await db.patients.count_documents(flt)
    total_visits = await db.visits.count_documents(flt)
    in_progress = await db.visits.count_documents({**flt, "status": "in_progress"})
    completed = await db.visits.count_documents({**flt, "status": "completed"})
    visits_today = await db.visits.count_documents({**flt, "visit_date": {"$regex": f"^{today}"}})
    return {
        "total_patients": total_patients,
        "total_visits": total_visits,
        "in_progress": in_progress,
        "completed": completed,
        "visits_today": visits_today,
    }

# Register booking & dashboard endpoints onto /api router before mounting
register_bookings(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
    get_active_clinic=get_active_clinic,
    public_clinic_view=public_clinic_view,
    DEFAULT_SETTINGS=DEFAULT_SETTINGS,
)

register_dashboard_operations(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    get_active_clinic=get_active_clinic,
)

register_front_desk_dashboard(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    get_active_clinic=get_active_clinic,
)

register_realtime(
    api=api,
    get_current_user=get_operational_user,
)

register_campaigns(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    audit=audit,
    scope=scope,
)

register_invoices(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    require_roles=require_roles,
    require_permission=require_permission,
    require_any_permission=require_any_permission,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_commissions(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    require_roles=require_roles,
    require_permission=require_permission,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_patient_packages(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    require_roles=require_roles,
    require_permission=require_permission,
    require_any_permission=require_any_permission,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_patient_profile(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    scope=scope,
    assert_patient_access=assert_patient_access,
    apply_staff_visit_filter=apply_staff_visit_filter,
    assert_feature=assert_feature,
)

register_patient_spending_history(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    scope=scope,
    assert_patient_access=assert_patient_access,
    audit=audit,
)

register_consent_forms(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    scope=scope,
    assert_staff_visit_access=assert_staff_visit_access,
    audit=audit,
)

register_clinic_reports(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_feature=assert_feature,
    scope=scope,
)

register_clinic_analytics(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_feature=assert_feature,
)

register_inventory_usage(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
    assert_staff_visit_access=assert_staff_visit_access,
)

register_pos_sales(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_daily_closing(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_gift_cards(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_refunds(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    audit=audit,
    scope=scope,
)

register_patient_wallets(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_prepaid(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    assert_feature=assert_feature,
    audit=audit,
    scope=scope,
)

register_patient_labels(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    assert_writeable=assert_writeable,
    audit=audit,
    scope=scope,
    assert_patient_access=assert_patient_access,
)

register_clinic_account(
    api=api,
    db=db,
    get_current_user=get_current_user,
    audit=audit,
    verify_password=verify_password,
    hash_password=hash_password,
    scope=scope,
    user_has_permission=user_has_permission,
    assert_writeable=assert_writeable,
    attach_permissions_to_user=attach_permissions_to_user,
    invalidate_user_sessions=invalidate_user_sessions,
)

register_clinic_user_2fa(
    api=api,
    db=db,
    audit=audit,
    verify_password=verify_password,
    create_token=create_token,
    get_current_user=get_current_user,
    attach_permissions_to_user=attach_permissions_to_user,
    ensure_clinic_roles=ensure_clinic_roles,
    iso=iso,
    now_utc=now_utc,
    user_has_permission=user_has_permission,
)

# Super Admin / Platform endpoints
async def _platform_settings_for_sa():
    return await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)

register_superadmin(
    api=api,
    db=db,
    get_current_user=get_current_user,
    audit=audit,
    public_clinic_view=public_clinic_view,
    PLAN_CATALOG=PLAN_CATALOG,
    STORAGE_URL=STORAGE_URL,
    init_storage=init_storage,
    put_object=put_object,
    APP_NAME=APP_NAME,
    scope=scope,
    require_permission=require_permission,
    require_any_permission=require_any_permission,
    create_token=create_token,
    hash_password=hash_password,
    verify_password=verify_password,
    ensure_clinic_roles=ensure_clinic_roles,
    DEFAULT_SETTINGS=DEFAULT_SETTINGS,
    get_platform_settings=_platform_settings_for_sa,
    SUPPORT_WHATSAPP=SUPPORT_WHATSAPP,
)

register_platform_reliability(
    api=api,
    db=db,
    get_current_user=get_current_user,
    audit=audit,
    init_storage=init_storage,
    PLAN_CATALOG=PLAN_CATALOG,
)

register_commercial(
    api=api,
    db=db,
    get_current_user=get_current_user,
    get_active_clinic=get_active_clinic,
    audit=audit,
    require_permission=require_permission,
    DEFAULT_SETTINGS=DEFAULT_SETTINGS,
    seed_clinic_settings=seed_clinic_settings,
    init_storage=init_storage,
    STORAGE_URL=STORAGE_URL,
)

register_customer_lifecycle(
    api=api,
    db=db,
    get_current_user=get_current_user,
    audit=audit,
    require_permission=require_permission,
    require_platform_admin=require_platform_admin,
    PLAN_CATALOG=PLAN_CATALOG,
    SUPPORT_WHATSAPP=SUPPORT_WHATSAPP,
)

# Platform-wide settings (Super Admin managed)
register_platform_settings(
    api=api,
    db=db,
    get_current_user=get_current_user,
    audit=audit,
    PLAN_CATALOG=PLAN_CATALOG,
    SUPPORT_WHATSAPP=SUPPORT_WHATSAPP,
    SUPPORT_HOURS=SUPPORT_HOURS,
    APP_NAME=APP_NAME,
    put_object=put_object,
)

register_staff(
    api=api,
    db=db,
    get_current_user=get_operational_user,
    require_roles=require_roles,
    assert_writeable=assert_writeable,
    audit=audit,
    scope=scope,
    assert_staff_capacity=assert_staff_capacity,
    hash_password=hash_password,
)

@app.get("/manifest.webmanifest")
async def dynamic_manifest():
    s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
    pb = merged_platform_branding(s)
    updated_at = str(pb.get("updated_at") or "").strip()
    version = updated_at.replace(":", "").replace("-", "").replace(".", "")

    def with_v(url: str) -> str:
        if not url:
            return ""
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}v={version}" if version else url

    icons = []
    icon_192 = pb.get("app_icon_192_url") or ""
    icon_512 = pb.get("app_icon_512_url") or ""
    maskable = pb.get("maskable_icon_url") or ""
    if icon_192:
        icons.append({"src": with_v(icon_192), "sizes": "192x192", "type": "image/png"})
    if icon_512:
        icons.append({"src": with_v(icon_512), "sizes": "512x512", "type": "image/png"})
    if maskable:
        icons.append({"src": with_v(maskable), "sizes": "512x512", "type": "image/png", "purpose": "maskable"})
    if not icons:
        fallback_svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%233F5A52'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-size='180' font-family='Inter,Arial,sans-serif' fill='white'%3ECO%3C/text%3E%3C/svg%3E"
        icons = [
            {"src": fallback_svg, "sizes": "192x192", "type": "image/svg+xml"},
            {"src": fallback_svg, "sizes": "512x512", "type": "image/svg+xml"},
        ]
    return {
        "name": pb.get("app_name") or "ClinicOS",
        "short_name": pb.get("short_name") or "ClinicOS",
        "description": pb.get("description") or "Clinic management system",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "theme_color": pb.get("theme_color") or "#3F5A52",
        "background_color": pb.get("background_color") or "#FDFBF7",
        "icons": icons,
    }

@app.get("/uploads/{path:path}")
async def serve_upload_root(path: str, auth: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    """Public upload URLs (PUBLIC_UPLOAD_BASE_URL) — not under /api."""
    return await _serve_upload_response(path, auth, authorization)

@app.get("/files/{path:path}")
async def serve_files_root(path: str, auth: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    return await _serve_upload_response(path, auth, authorization)

app.include_router(api)

if IS_PRODUCTION:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=CORS_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Webhook-Secret"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=["*"],
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ---------------- Seed & Indexes ----------------
DEMO_USERS = [
    {"email": "admin@bodylab.id", "password": "password123", "name": "Super Admin", "role": "super_admin"},
    {"email": "doctor@bodylab.id", "password": "password123", "name": "Dr. Maya Putri", "role": "doctor"},
    {"email": "therapist@bodylab.id", "password": "password123", "name": "Sari Therapist", "role": "therapist"},
    {"email": "nurse@bodylab.id", "password": "password123", "name": "Nina Nurse", "role": "nurse"},
    {"email": "fo@bodylab.id", "password": "password123", "name": "Front Office", "role": "fo"},
    {"email": "manager@bodylab.id", "password": "password123", "name": "Clinic Manager", "role": "manager"},
]

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.clinics.create_index("slug", unique=True)
    await db.patients.create_index([("clinic_id", 1), ("full_name", 1)])
    await db.visits.create_index([("clinic_id", 1), ("patient_id", 1)])
    await db.audit_logs.create_index([("clinic_id", 1), ("created_at", -1)])
    await db.bookings.create_index([("clinic_id", 1), ("scheduled_at", 1)])
    await db.bookings.create_index([("clinic_id", 1), ("status", 1)])
    await db.coupons.create_index([("clinic_id", 1), ("code", 1)], unique=True)
    await db.campaigns.create_index([("clinic_id", 1), ("code", 1)], unique=True, sparse=True)
    await db.campaigns.create_index([("clinic_id", 1), ("active", 1)])
    await db.commission_rules.create_index([("clinic_id", 1), ("is_active", 1)])
    await db.commission_records.create_index(
        [("clinic_id", 1), ("invoice_id", 1), ("invoice_item_id", 1), ("staff_id", 1)],
        unique=True,
        name="commission_item_staff_unique",
    )
    # Drop legacy unique index (one record per item) if present
    try:
        async for idx in db.commission_records.list_indexes():
            keys = dict(idx.get("key") or {})
            if idx.get("unique") and keys.get("invoice_item_id") and "staff_id" not in keys:
                await db.commission_records.drop_index(idx["name"])
    except Exception:
        pass
    await db.commission_records.create_index([("clinic_id", 1), ("staff_id", 1), ("status", 1)])
    await db.commission_records.create_index([("clinic_id", 1), ("created_at", -1)])
    await db.patient_packages.create_index(
        [("clinic_id", 1), ("invoice_item_id", 1)],
        unique=True,
    )
    await db.patient_packages.create_index([("clinic_id", 1), ("patient_id", 1), ("status", 1)])
    await db.package_usage.create_index([("clinic_id", 1), ("patient_package_id", 1)])
    await db.package_usage.create_index([("clinic_id", 1), ("usage_date", -1)])
    await db.clinic_roles.create_index([("clinic_id", 1), ("role_key", 1)], unique=True)
    await db.weekly_staff_schedules.create_index(
        [("clinic_id", 1), ("staff_id", 1), ("day_of_week", 1)],
        unique=True,
    )
    await db.staff_date_overrides.create_index(
        [("clinic_id", 1), ("staff_id", 1), ("date", 1)],
        unique=True,
    )
    await db.online_booking_payments.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
    await db.online_booking_payments.create_index([("provider_order_id", 1)], unique=True, sparse=True)
    await db.online_booking_payments.create_index([("booking_id", 1)])
    await db.messaging_templates.create_index([("clinic_id", 1), ("template_type", 1), ("active", 1)])
    await db.message_logs.create_index([("clinic_id", 1), ("status", 1), ("send_at", 1)])
    await db.messaging_automation_rules.create_index([("clinic_id", 1), ("enabled", 1), ("trigger_type", 1)])
    await db.automation_runs.create_index(
        [("clinic_id", 1), ("rule_id", 1), ("reference_type", 1), ("reference_id", 1), ("scheduled_for", 1)],
        unique=True,
    )
    await db.automation_runs.create_index([("status", 1), ("scheduled_for", 1)])
    await db.automation_runs.create_index([("status", 1), ("next_retry_at", 1)])
    await db.automation_runs.create_index([("clinic_id", 1), ("patient_id", 1), ("created_at", -1)])
    await db.message_logs.create_index([("clinic_id", 1), ("booking_id", 1), ("created_at", -1)])
    await db.consent_public_links.create_index([("token_hash", 1)], unique=True)
    await db.consent_public_links.create_index([("consent_id", 1), ("status", 1)])
    await db.consent_public_links.create_index([("clinic_id", 1), ("visit_id", 1)])
    await db.visit_product_usages.create_index([("clinic_id", 1), ("visit_id", 1), ("status", 1)])
    await db.visit_product_usages.create_index([("clinic_id", 1), ("treatment_item_id", 1)])
    await db.stock_movements.create_index([("clinic_id", 1), ("product_id", 1), ("created_at", -1)])
    await db.pos_sales.create_index([("clinic_id", 1), ("created_at", -1)])
    await db.pos_sales.create_index([("clinic_id", 1), ("paid_at", -1)])
    await db.pos_sales.create_index([("clinic_id", 1), ("status", 1), ("paid_at", -1)])
    await db.pos_sales.create_index([("clinic_id", 1), ("sale_number", 1)], unique=True)
    await db.daily_closings.create_index([("clinic_id", 1), ("business_date", -1)])
    await db.daily_closings.create_index([("clinic_id", 1), ("business_date", 1), ("status", 1)])
    await db.gift_cards.create_index([("clinic_id", 1), ("code", 1)], unique=True)
    await db.gift_cards.create_index([("clinic_id", 1), ("issued_sale_id", 1)])
    await db.gift_cards.create_index([("clinic_id", 1), ("status", 1)])
    await db.gift_cards.create_index([("clinic_id", 1), ("status", 1), ("gift_card_type", 1)])
    await db.gift_card_redemptions.create_index([("clinic_id", 1), ("gift_card_id", 1)])
    await db.gift_card_redemptions.create_index([("clinic_id", 1), ("reference_type", 1), ("reference_id", 1)])
    from gift_card_models import migrate_gift_card_collections
    await migrate_gift_card_collections(db)
    await db.patient_packages.create_index([("clinic_id", 1), ("pos_sale_item_id", 1)], sparse=True)

    if not IS_PRODUCTION:
        # Ensure local/dev default clinic and demo users exist.
        default_clinic = await db.clinics.find_one({"slug": "bodylabbali"})
        if not default_clinic:
            default_clinic = {
                "id": str(uuid.uuid4()),
                "name": "Body Lab Bali",
                "slug": "bodylabbali",
                "logo_path": "",
                "address": "",
                "city": "Bali",
                "phone": "",
                "email": "admin@bodylab.id",
                "owner_name": "Super Admin",
                "owner_email": "admin@bodylab.id",
                "timezone": "Asia/Makassar",
                "currency": "IDR",
                "operating_hours": {},
                "subscription": {
                    "plan": "complete",
                    "status": "active",
                    "trial_end": None,
                    "expiry_date": iso(now_utc() + timedelta(days=365 * 100)),
                    "started_at": iso(now_utc()),
                },
                "onboarded": True,
                "created_at": iso(now_utc()),
            }
            await db.clinics.insert_one(default_clinic)
        default_cid = default_clinic["id"]

        # Keep local demo clinic writable (bodylab seed accounts)
        sub = default_clinic.get("subscription") or {}
        if default_clinic.get("slug") == "bodylabbali" and sub.get("status") == "suspended":
            await db.clinics.update_one(
                {"id": default_cid},
                {"$set": {"subscription.status": "active"}},
            )

        # Seed demo accounts for local/dev usage only.
        for u in DEMO_USERS:
            existing = await db.users.find_one({"email": u["email"]})
            if not existing:
                await db.users.insert_one({
                    "id": str(uuid.uuid4()),
                    "email": u["email"],
                    "password_hash": hash_password(u["password"]),
                    "name": u["name"],
                    "role": u["role"],
                    "clinic_id": default_cid,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

        # Backfill legacy local data to default clinic_id.
        for coll in ("users", "patients", "visits", "clinical_records", "therapist_records",
                     "treatment_items", "photos", "mappings", "audit_logs", "settings"):
            await db[coll].update_many({"clinic_id": {"$exists": False}}, {"$set": {"clinic_id": default_cid}})
            await db[coll].update_many({"clinic_id": None}, {"$set": {"clinic_id": default_cid}})

        if default_clinic.get("slug") == "bodylabbali":
            await ensure_demo_clinical_schedules(db, default_cid)
    else:
        log.info("Production mode: skipping local demo clinic/user bootstrap")

    init_storage()
    # Seed default settings for local default clinic only.
    if not IS_PRODUCTION:
        if not await db.settings.find_one({"id": "global", "clinic_id": default_cid}):
            await db.settings.insert_one({"id": "global", "clinic_id": default_cid, **DEFAULT_SETTINGS})
    # Legacy status migration
    await db.visits.update_many({"status": "billed"}, {"$set": {"status": "completed"}})
    from visit_workflow import visit_emr_submitted, mark_visit_submitted
    async for v in db.visits.find({"status": "in_progress"}, {"_id": 0, "id": 1, "clinic_id": 1, "created_by": 1}):
        if await visit_emr_submitted(db, v["id"]):
            await db.visits.update_one(
                {"id": v["id"]},
                {"$set": {"status": "submitted", "submitted_at": iso(now_utc())}},
            )
            full = await db.visits.find_one({"id": v["id"]}, {"_id": 0})
            if full:
                from invoices import ensure_invoice_for_visit
                await ensure_invoice_for_visit(
                    db, v["clinic_id"], full, created_by=v.get("created_by") or full.get("created_by") or "",
                )
    async for c in db.clinics.find({}, {"_id": 0, "id": 1}):
        cid = c["id"]
        await ensure_clinic_roles(db, cid)
        await ensure_default_commission_rules(db, cid)
        async for u in db.users.find(
            {"clinic_id": cid, "$or": [{"working_hours": {"$exists": True}}, {"days_off": {"$exists": True}}]},
            {"_id": 0, "id": 1, "working_hours": 1, "days_off": 1},
        ):
            if u.get("working_hours") or u.get("days_off"):
                await migrate_legacy_user_schedule(db, cid, u["id"], u)
        async for u in db.users.find({"clinic_id": cid}, {"_id": 0, "id": 1, "role": 1, "role_id": 1, "active": 1}):
            upd = {}
            if u.get("active") is None:
                upd["active"] = True
            if not u.get("role_id") and u.get("role"):
                rd = await db.clinic_roles.find_one(
                    {"clinic_id": cid, "role_key": u["role"]},
                    {"_id": 0, "id": 1},
                )
                if rd:
                    upd["role_id"] = rd["id"]
            if upd:
                await db.users.update_one({"id": u["id"]}, {"$set": upd})
    log.info("ClinicOS multi-tenant ready")

    async def _messaging_worker():
        import asyncio
        from messaging import process_due_messages
        from messaging_automation import run_due_automation
        secret = os.environ.get("JWT_SECRET", "")
        while True:
            try:
                await process_due_messages(db, secret, limit=30)
                await run_due_automation(db, secret, limit=50)
            except Exception:
                log.exception("messaging worker tick failed")
            await asyncio.sleep(60)

    import asyncio
    asyncio.create_task(_messaging_worker())

@app.on_event("shutdown")
async def shutdown():
    client.close()
