"""Super Admin / Platform endpoints for ClinicOS.

Mounted onto the main /api router via register_superadmin().
All endpoints here require platform_admin = True in the auth payload
(only the env-credentialed login can grant this).
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, EmailStr

from platform_ops import (
    build_admin_clinic_doc,
    seed_clinic_settings,
    create_platform_notification,
    active_announcements_for_clinic,
    plan_change_preview,
    reminder_whatsapp_text,
    scan_platform_alerts,
    clinic_support_panel,
    owner_account_info,
    invalidate_user_sessions,
    invalidate_clinic_sessions,
    purge_test_clinic_data,
    preview_test_clinic_delete,
    _sum_preview_counts,
    _gen_password,
)
from commercial import (
    notify_payment_submitted,
    notify_payment_approved,
    notify_payment_rejected,
    notify_reactivated,
    create_clinic_notification,
)
from platform_admin_2fa import is_2fa_enabled, recovery_codes_remaining, register_platform_admin_2fa
from saas import (
    BILLING_CYCLES, BILLING_CYCLE_KEYS, compute_plan_charge,
    SUBSCRIPTION_STATUSES, resolve_clinic_limits, refresh_subscription_state,
    public_clinic_view as build_clinic_view,
    slugify, validate_booking_slug, BookingSlugError,
)


# ---------------- Models ----------------
class SubscriptionUpdateIn(BaseModel):
    plan: Optional[str] = None
    status: Optional[str] = None
    extend_days: Optional[int] = None
    expiry_date: Optional[str] = None
    trial_end: Optional[str] = None
    billing_cycle: Optional[str] = None
    grace_days: Optional[int] = None
    limit_overrides: Optional[Dict[str, Any]] = None
    force_plan_change: bool = False
    reason: Optional[str] = None


class ClinicProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    reason: Optional[str] = None


class OwnerEmailChangeIn(BaseModel):
    new_email: EmailStr
    confirm_email: EmailStr
    reason: str
    update_primary_clinic_email: bool = False
    invalidate_sessions: bool = True


class OwnerTransferIn(BaseModel):
    new_owner_user_id: str
    reason: str
    invalidate_sessions: bool = True


class ArchiveClinicIn(BaseModel):
    reason: str
    churn_reason: Optional[str] = None
    churn_note: Optional[str] = None


class PermanentDeleteIn(BaseModel):
    confirm_slug: str
    reason: str
    confirm_phrase: str
    confirmed: bool = False


class TestClinicFlagIn(BaseModel):
    is_test_clinic: bool
    reason: Optional[str] = None


BULK_DELETE_QA_CONFIRM = "DELETE QA CLINICS"
PLATFORM_ADMIN_USER_ID = "platform-admin"


class BulkDeleteTestClinicsIn(BaseModel):
    clinic_ids: List[str]
    confirmation_text: Optional[str] = None
    reason: Optional[str] = None
    dry_run: bool = True


class CreateClinicIn(BaseModel):
    clinic_name: str
    slug: Optional[str] = None
    owner_name: str
    owner_email: EmailStr
    password: Optional[str] = None
    invite_mode: str = "password"  # password | invite
    plan: str = "trial"
    billing_cycle: str = "monthly"
    trial_days: int = 14
    template_preset: str = "default"
    initial_status: Optional[str] = None


class PaymentRejectIn(BaseModel):
    reason: str
    request_clarification: bool = False


class LimitOverridesIn(BaseModel):
    max_staff: Optional[int] = None
    storage_gb: Optional[int] = None


class ImpersonateEndIn(BaseModel):
    clinic_id: str


class SuperAdminProfileUpdateIn(BaseModel):
    full_name: str
    email: EmailStr


class SuperAdminEmailChangeIn(BaseModel):
    new_email: EmailStr
    current_password: str


class SuperAdminPasswordChangeIn(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str
    logout_other_sessions: bool = True


class AnnouncementIn(BaseModel):
    title: str
    body: str
    severity: str = "info"
    audience: str = "all"
    target_type: str = "all"  # all | clinic | plan | status
    target_clinic_id: Optional[str] = None
    target_plan: Optional[str] = None
    target_status: Optional[str] = None
    active: bool = True
    status: str = "published"  # published | archived


class AnnouncementUpdateIn(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    severity: Optional[str] = None
    target_type: Optional[str] = None
    target_clinic_id: Optional[str] = None
    target_plan: Optional[str] = None
    target_status: Optional[str] = None
    active: Optional[bool] = None
    status: Optional[str] = None


class ReminderMarkIn(BaseModel):
    reminder_type: str = "renewal"  # renewal | payment_due


# ---------------- Helpers ----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def iso(dt: datetime) -> str:
    return dt.isoformat()


def require_platform_admin(get_current_user):
    async def checker(user: dict = Depends(get_current_user)):
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")
        return user
    return checker


def _sa_actor(user: dict, clinic_id: str) -> dict:
    return {
        "id": "platform-admin",
        "email": user["email"],
        "role": "platform_admin",
        "clinic_id": clinic_id,
        "name": "Platform Admin",
    }


async def _sa_audit(
    audit,
    user: dict,
    clinic_id: str,
    clinic_name: str,
    action: str,
    record_id: str = "",
    *,
    old_value: Any = None,
    new_value: Any = None,
    reason: Optional[str] = None,
    meta: Optional[dict] = None,
):
    merged = dict(meta or {})
    merged["clinic_name"] = clinic_name
    merged["performed_by"] = user.get("email")
    await audit(
        _sa_actor(user, clinic_id),
        action,
        "clinic",
        record_id or clinic_id,
        meta=merged,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
    )


async def _clinic_usage(db, clinic_id: str) -> Dict[str, Any]:
    staff_count = await db.users.count_documents({"clinic_id": clinic_id})
    agg = await db.photos.aggregate([
        {"$match": {"clinic_id": clinic_id}},
        {"$group": {"_id": None, "bytes": {"$sum": {"$ifNull": ["$size_bytes", 0]}}}},
    ]).to_list(1)
    storage_bytes = int((agg[0]["bytes"] if agg else 0) or 0)
    return {
        "staff_count": staff_count,
        "storage_bytes": storage_bytes,
        "storage_used_gb": round(storage_bytes / (1024 ** 3), 2),
    }


async def _enriched_clinic(db, c: dict, public_clinic_view) -> dict:
    c, changed = refresh_subscription_state(c)
    if changed:
        await db.clinics.update_one({"id": c["id"]}, {"$set": {"subscription": c["subscription"]}})
    usage = await _clinic_usage(db, c["id"])
    limits = resolve_clinic_limits(c)
    view = public_clinic_view(c, usage=usage, limits=limits)
    view["staff_count"] = usage["staff_count"]
    view["patient_count"] = await db.patients.count_documents({"clinic_id": c["id"]})
    view["visit_count"] = await db.visits.count_documents({"clinic_id": c["id"]})
    view["booking_count"] = await db.bookings.count_documents({"clinic_id": c["id"]})
    view["invoice_count"] = await db.invoices.count_documents({"clinic_id": c["id"]})
    return view


# ---------------- Public router builder ----------------
def register_superadmin(api: APIRouter, db, get_current_user, audit, public_clinic_view, PLAN_CATALOG, STORAGE_URL, init_storage, put_object, APP_NAME, scope, require_permission, require_any_permission, create_token=None, hash_password=None, verify_password=None, ensure_clinic_roles=None, DEFAULT_SETTINGS=None, get_platform_settings=None, SUPPORT_WHATSAPP="", SUPPORT_HOURS=""):
    """Wire super admin endpoints onto the /api router."""

    admin_dep = require_platform_admin(get_current_user)

    saas_billing_read_dep = require_any_permission(
        "billing.subscription_view", "billing.subscribe", skip_operational_check=True,
    )

    async def subscribe_dep(user: dict = Depends(require_permission("billing.subscribe", skip_operational_check=True))):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Clinic account required")
        return user

    async def _ensure_platform_admin_user(user: dict) -> dict:
        """Resolve or bootstrap the platform admin row for account settings."""
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")

        uid = user.get("id") or PLATFORM_ADMIN_USER_ID
        email = (user.get("email") or "").strip().lower()

        db_user = await db.users.find_one({"id": uid}, {"_id": 0})
        if not db_user:
            db_user = await db.users.find_one({"id": PLATFORM_ADMIN_USER_ID}, {"_id": 0})
        if not db_user and email:
            db_user = await db.users.find_one(
                {
                    "email": email,
                    "$or": [{"role": "platform_admin"}, {"platform_admin": True}],
                },
                {"_id": 0},
            )

        if db_user:
            if db_user.get("role") != "platform_admin" and not db_user.get("platform_admin"):
                raise HTTPException(status_code=403, detail="Invalid platform admin account")
            return db_user

        if not hash_password:
            raise HTTPException(status_code=500, detail="Platform admin bootstrap unavailable")

        default_email = (os.environ.get("SUPER_ADMIN_EMAIL") or "platform@clinicos.id").lower()
        default_password = os.environ.get("SUPER_ADMIN_PASSWORD") or "ChangeMe123!"
        now = iso(now_utc())
        doc = {
            "id": PLATFORM_ADMIN_USER_ID,
            "email": email or default_email,
            "name": (user.get("name") or "Platform Admin").strip() or "Platform Admin",
            "role": "platform_admin",
            "platform_admin": True,
            "password_hash": hash_password(default_password),
            "updated_at": now,
        }
        await db.users.update_one(
            {"id": PLATFORM_ADMIN_USER_ID},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        created = await db.users.find_one({"id": PLATFORM_ADMIN_USER_ID}, {"_id": 0})
        if not created:
            raise HTTPException(status_code=500, detail="Failed to initialize platform admin account")
        return created

    def _validate_password_strength(new_password: str) -> None:
        p = (new_password or "").strip()
        if len(p) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        if p.lower() == p or p.upper() == p:
            raise HTTPException(status_code=400, detail="Password must include upper and lower case letters")
        if not any(ch.isdigit() for ch in p):
            raise HTTPException(status_code=400, detail="Password must include at least one number")

    # ---------- Platform Admin account ----------
    @api.get("/superadmin/account")
    async def sa_get_account(user: dict = Depends(admin_dep)):
        db_user = await _ensure_platform_admin_user(user)
        stored = db_user.get("totp_recovery_codes") or []
        return {
            "id": db_user["id"],
            "full_name": db_user.get("name") or "",
            "email": db_user.get("email") or "",
            "role": "super_admin",
            "platform_admin": True,
            "totp_enabled": is_2fa_enabled(db_user),
            "recovery_codes_remaining": recovery_codes_remaining(stored) if is_2fa_enabled(db_user) else 0,
        }

    @api.put("/superadmin/account/profile")
    async def sa_update_account_profile(payload: SuperAdminProfileUpdateIn, user: dict = Depends(admin_dep)):
        db_user = await _ensure_platform_admin_user(user)
        new_name = (payload.full_name or "").strip()
        new_email = (payload.email or "").strip().lower()
        if not new_name:
            raise HTTPException(status_code=400, detail="Full name is required")

        email_changed = new_email != (db_user.get("email") or "").lower()
        if email_changed:
            raise HTTPException(
                status_code=400,
                detail="Use account email endpoint with current password to change email",
            )

        patch = {"name": new_name, "updated_at": iso(now_utc())}

        await db.users.update_one({"id": db_user["id"]}, {"$set": patch})

        await audit(
            {
                "id": db_user["id"],
                "email": db_user.get("email"),
                "role": "platform_admin",
                "platform_admin": True,
            },
            "super_admin_profile_updated",
            "platform_admin_account",
            db_user["id"],
            old_value={"name": db_user.get("name"), "email": db_user.get("email")},
            new_value={"name": new_name, "email": db_user.get("email")},
        )

        updated = await db.users.find_one({"id": db_user["id"]}, {"_id": 0})
        return {
            "id": updated["id"],
            "full_name": updated.get("name") or "",
            "email": updated.get("email") or "",
            "role": "super_admin",
            "platform_admin": True,
        }

    @api.put("/superadmin/account/email")
    async def sa_update_account_email(payload: SuperAdminEmailChangeIn, user: dict = Depends(admin_dep)):
        if not verify_password:
            raise HTTPException(status_code=500, detail="Password verification unavailable")
        db_user = await _ensure_platform_admin_user(user)
        cur_hash = db_user.get("password_hash") or ""
        if not cur_hash or not verify_password(payload.current_password, cur_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        old_email = (db_user.get("email") or "").lower()
        new_email = (payload.new_email or "").strip().lower()
        if new_email == old_email:
            raise HTTPException(status_code=400, detail="New email must be different")
        existing = await db.users.find_one({"email": new_email, "id": {"$ne": db_user["id"]}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=400, detail="Email is already used")

        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {"email": new_email, "updated_at": iso(now_utc())}},
        )

        await audit(
            {
                "id": db_user["id"],
                "email": old_email,
                "role": "platform_admin",
                "platform_admin": True,
            },
            "super_admin_email_changed",
            "platform_admin_account",
            db_user["id"],
            old_value={"old_email": old_email},
            new_value={"new_email": new_email, "changed_by": db_user.get("id")},
        )
        return {
            "ok": True,
            "message": "Email updated successfully. Please use the new email next time you log in.",
        }

    @api.put("/superadmin/account/password")
    async def sa_update_account_password(payload: SuperAdminPasswordChangeIn, user: dict = Depends(admin_dep)):
        if not hash_password or not verify_password:
            raise HTTPException(status_code=500, detail="Password update unavailable")
        db_user = await _ensure_platform_admin_user(user)
        cur_hash = db_user.get("password_hash") or ""
        if not cur_hash or not verify_password(payload.current_password, cur_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if payload.new_password != payload.confirm_new_password:
            raise HTTPException(status_code=400, detail="New password and confirmation do not match")
        _validate_password_strength(payload.new_password)
        if verify_password(payload.new_password, cur_hash):
            raise HTTPException(status_code=400, detail="New password must be different from current password")

        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": iso(now_utc())}},
        )

        if payload.logout_other_sessions:
            await invalidate_user_sessions(db, db_user["id"])

        await audit(
            {
                "id": db_user["id"],
                "email": db_user.get("email"),
                "role": "platform_admin",
                "platform_admin": True,
            },
            "super_admin_password_changed",
            "platform_admin_account",
            db_user["id"],
            new_value={"changed_by": db_user.get("id")},
        )
        return {"ok": True, "message": "Password updated successfully."}

    register_platform_admin_2fa(
        api,
        db,
        audit=audit,
        verify_password=verify_password,
        hash_password=hash_password,
        create_token=create_token,
        ensure_platform_admin_user=_ensure_platform_admin_user,
        admin_dep=admin_dep,
    )

    # ---------- Dashboard ----------
    @api.get("/superadmin/dashboard")
    async def sa_dashboard(_user: dict = Depends(admin_dep)):
        await scan_platform_alerts(db, PLAN_CATALOG)
        clinics = await db.clinics.find({}, {"_id": 0}).to_list(2000)
        total = len(clinics)
        by_status: Dict[str, int] = {}
        by_plan: Dict[str, int] = {}
        mrr_idr = 0
        for c in clinics:
            sub = c.get("subscription") or {}
            status = sub.get("status", "trial")
            plan = sub.get("plan", "trial")
            by_status[status] = by_status.get(status, 0) + 1
            by_plan[plan] = by_plan.get(plan, 0) + 1
            if status == "active" and plan in PLAN_CATALOG:
                mrr_idr += PLAN_CATALOG[plan]["price_idr"]
        pending_payments = await db.payment_requests.count_documents({"status": "submitted"})
        # New clinics last 30 days
        thirty = iso(now_utc() - timedelta(days=30))
        new_clinics = sum(1 for c in clinics if (c.get("created_at") or "") >= thirty)
        return {
            "total_clinics": total,
            "by_status": by_status,
            "by_plan": by_plan,
            "mrr_idr": mrr_idr,
            "pending_payments": pending_payments,
            "new_clinics_30d": new_clinics,
        }

    @api.get("/superadmin/revenue-chart")
    async def sa_revenue_chart(months: int = 6, _user: dict = Depends(admin_dep)):
        """Returns last `months` of activated subscription revenue, stacked by plan.
        Source: verified payment_requests (one verification = one month of revenue at that plan's price).
        Falls back to current active MRR if no verified payments yet (so the chart isn't empty)."""
        from datetime import date
        # Build month buckets going back N months
        now = now_utc()
        buckets: List[Dict[str, Any]] = []
        for i in range(months - 1, -1, -1):
            # First day of (now.month - i)
            y = now.year
            m = now.month - i
            while m <= 0:
                y -= 1
                m += 12
            label = date(y, m, 1).strftime("%b %y")
            buckets.append({"key": f"{y}-{m:02d}", "label": label, "starter": 0, "clinic": 0, "complete": 0, "total": 0})

        # Aggregate verified payments by month + plan
        payments = await db.payment_requests.find({"status": "verified"}, {"_id": 0}).to_list(2000)
        bucket_by_key = {b["key"]: b for b in buckets}
        any_verified = False
        for p in payments:
            t = p.get("verified_at") or p.get("created_at") or ""
            if not t or len(t) < 7:
                continue
            key = t[:7].replace("-", "-")  # YYYY-MM
            # Normalize key to match (year-month with two-digit month)
            try:
                y, mo = key.split("-")[:2]
                key = f"{int(y)}-{int(mo):02d}"
            except Exception:
                continue
            b = bucket_by_key.get(key)
            if not b:
                continue
            plan = p.get("plan", "")
            if plan in ("starter", "clinic", "complete"):
                b[plan] = b.get(plan, 0) + int(p.get("amount_idr", 0))
                b["total"] = b.get("total", 0) + int(p.get("amount_idr", 0))
                any_verified = True

        # If no verified payments yet, populate the LATEST bucket with current active MRR snapshot
        # so the chart has something to show.
        if not any_verified and buckets:
            clinics = await db.clinics.find({}, {"_id": 0}).to_list(2000)
            latest = buckets[-1]
            for c in clinics:
                sub = c.get("subscription") or {}
                if sub.get("status") != "active":
                    continue
                plan = sub.get("plan")
                if plan in ("starter", "clinic", "complete"):
                    price = PLAN_CATALOG[plan]["price_idr"]
                    latest[plan] += price
                    latest["total"] += price

        return {"months": buckets, "source": "verified_payments" if any_verified else "active_mrr_snapshot"}

    # ---------- Clinics ----------
    @api.get("/superadmin/clinics")
    async def sa_list_clinics(
        q: Optional[str] = None,
        status: Optional[str] = None,
        plan: Optional[str] = None,
        list_filter: Optional[str] = None,
        test_only: bool = False,
        _user: dict = Depends(admin_dep),
    ):
        flt: Dict[str, Any] = {}
        if test_only:
            flt["is_test_clinic"] = True
        if status:
            flt["subscription.status"] = status
        elif list_filter:
            lf = list_filter.lower().strip()
            if lf == "all":
                pass
            elif lf in SUBSCRIPTION_STATUSES:
                flt["subscription.status"] = lf
            elif lf == "active":
                flt["subscription.status"] = "active"
        else:
            flt["subscription.status"] = {"$ne": "archived"}
        if plan:
            flt["subscription.plan"] = plan
        if q:
            flt["$or"] = [
                {"name": {"$regex": q, "$options": "i"}},
                {"owner_email": {"$regex": q, "$options": "i"}},
                {"email": {"$regex": q, "$options": "i"}},
                {"slug": {"$regex": q, "$options": "i"}},
            ]
        rows = await db.clinics.find(flt, {"_id": 0}).sort("created_at", -1).to_list(1000)
        # Augment with counts
        for r in rows:
            cid = r["id"]
            r["staff_count"] = await db.users.count_documents({"clinic_id": cid})
            r["patient_count"] = await db.patients.count_documents({"clinic_id": cid})
            r["booking_count"] = await db.bookings.count_documents({"clinic_id": cid})
        return rows

    @api.post("/superadmin/clinics/bulk-delete-test")
    async def sa_bulk_delete_test_clinics(payload: BulkDeleteTestClinicsIn, user: dict = Depends(admin_dep)):
        clinic_ids = [cid.strip() for cid in (payload.clinic_ids or []) if cid and str(cid).strip()]
        if not clinic_ids:
            raise HTTPException(status_code=400, detail="Select at least one clinic")
        if len(clinic_ids) != len(set(clinic_ids)):
            raise HTTPException(status_code=400, detail="Duplicate clinic IDs in selection")

        clinics: List[dict] = []
        missing: List[str] = []
        non_test: List[dict] = []
        for cid in clinic_ids:
            c = await db.clinics.find_one({"id": cid}, {"_id": 0})
            if not c:
                missing.append(cid)
                continue
            if not c.get("is_test_clinic"):
                non_test.append({
                    "id": c.get("id"),
                    "name": c.get("name"),
                    "slug": c.get("slug"),
                    "is_test_clinic": bool(c.get("is_test_clinic", False)),
                })
            clinics.append(c)

        if missing:
            raise HTTPException(status_code=404, detail={"message": "Clinic not found", "missing_ids": missing})
        if non_test:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": "Bulk delete is only allowed for test/demo clinics (is_test_clinic=true)",
                    "blocked_clinics": non_test,
                },
            )

        previews = []
        for c in clinics:
            counts = await preview_test_clinic_delete(db, c["id"])
            previews.append({
                "id": c["id"],
                "name": c.get("name", ""),
                "slug": c.get("slug", ""),
                "owner_email": c.get("owner_email") or c.get("email", ""),
                "is_test_clinic": True,
                "subscription_status": (c.get("subscription") or {}).get("status"),
                "created_at": c.get("created_at"),
                **counts,
            })
        totals = _sum_preview_counts([{k: v for k, v in p.items() if k.endswith("_count")} for p in previews])

        if payload.dry_run:
            return {
                "dry_run": True,
                "selected_count": len(previews),
                "clinics": previews,
                "totals": totals,
            }

        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Deletion reason is required")
        if (payload.confirmation_text or "").strip() != BULK_DELETE_QA_CONFIRM:
            raise HTTPException(
                status_code=400,
                detail=f'Confirmation text must be exactly "{BULK_DELETE_QA_CONFIRM}"',
            )

        now = iso(now_utc())
        deleted_results: List[dict] = []
        for c in clinics:
            cid = c["id"]
            clinic_name = c.get("name", "")
            clinic_slug = c.get("slug", "")
            preview = next((p for p in previews if p["id"] == cid), {})
            await audit(
                {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None, "name": "Platform Admin"},
                "clinic_permanently_deleted",
                "clinic",
                cid,
                meta={
                    "clinic_id": cid,
                    "clinic_name": clinic_name,
                    "slug": clinic_slug,
                    "deleted_by": user.get("email"),
                    "reason": reason,
                    "timestamp": now,
                    "is_test_clinic": True,
                    "bulk_qa_cleanup": True,
                    "preview": {k: preview.get(k) for k in preview if k.endswith("_count")},
                },
                old_value={"name": clinic_name, "slug": clinic_slug},
                new_value={"deleted": True, "deleted_at": now},
                reason=reason,
            )
            counts = await purge_test_clinic_data(
                db, cid, init_storage=init_storage, storage_url=STORAGE_URL,
            )
            deleted_results.append({
                "clinic_id": cid,
                "slug": clinic_slug,
                "name": clinic_name,
                "deleted": counts,
            })

        await _sa_audit(
            audit, user, "", "Bulk QA cleanup", "bulk_test_clinics_deleted", "",
            old_value={"clinic_ids": clinic_ids},
            new_value={
                "deleted_count": len(deleted_results),
                "clinic_ids": [r["clinic_id"] for r in deleted_results],
                "deleted_at": now,
            },
            reason=reason,
            meta={
                "clinic_ids": clinic_ids,
                "deleted_count": len(deleted_results),
                "totals_preview": totals,
                "results": deleted_results,
            },
        )

        return {
            "dry_run": False,
            "deleted_count": len(deleted_results),
            "selected_count": len(clinic_ids),
            "results": deleted_results,
            "totals_preview": totals,
        }

    @api.post("/superadmin/clinics")
    async def sa_create_clinic(payload: CreateClinicIn, user: dict = Depends(admin_dep)):
        if not hash_password or not ensure_clinic_roles or not DEFAULT_SETTINGS:
            raise HTTPException(status_code=500, detail="Clinic provisioning not configured")
        email = payload.owner_email.lower().strip()
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="Owner email already registered")
        existing_slugs = [c["slug"] async for c in db.clinics.find({}, {"_id": 0, "slug": 1})]
        clinic = build_admin_clinic_doc(
            clinic_name=payload.clinic_name,
            slug=payload.slug,
            owner_name=payload.owner_name,
            owner_email=email,
            existing_slugs=existing_slugs,
            plan=payload.plan,
            billing_cycle=payload.billing_cycle,
            trial_days=payload.trial_days,
            template_preset=payload.template_preset,
            initial_status=payload.initial_status,
        )
        temp_password = payload.password or _gen_password()
        invite_token = str(uuid.uuid4()) if payload.invite_mode == "invite" else None
        await db.clinics.insert_one(clinic)
        user_id = str(uuid.uuid4())
        user_doc = {
            "id": user_id,
            "email": email,
            "password_hash": hash_password(temp_password),
            "name": payload.owner_name.strip(),
            "role": "super_admin",
            "clinic_id": clinic["id"],
            "created_at": iso(now_utc()),
            "invite_token": invite_token,
            "must_change_password": payload.invite_mode == "invite",
        }
        await db.users.insert_one(user_doc)
        await ensure_clinic_roles(db, clinic["id"])
        await seed_clinic_settings(db, clinic["id"], clinic["name"], DEFAULT_SETTINGS, payload.template_preset)
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": clinic["id"]},
            "clinic_created", "clinic", clinic["id"],
            {"plan": payload.plan, "owner_email": email, "template": payload.template_preset},
        )
        await create_platform_notification(
            db,
            ntype="clinic_created",
            title=f"New clinic: {clinic['name']}",
            body=f"Created for {payload.owner_name} ({email}) on {payload.plan} plan",
            clinic_id=clinic["id"],
            clinic_name=clinic["name"],
            link=f"/superadmin/clinics/{clinic['id']}",
        )
        enriched = await _enriched_clinic(db, clinic, public_clinic_view)
        return {
            **enriched,
            "owner_credentials": {
                "email": email,
                "temporary_password": temp_password if payload.invite_mode == "password" else None,
                "invite_mode": payload.invite_mode,
            },
        }

    @api.get("/superadmin/clinics/{cid}")
    async def sa_get_clinic(cid: str, _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        users = await db.users.find({"clinic_id": cid}, {"_id": 0, "password_hash": 0}).to_list(200)
        recent_payments = await db.payment_requests.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
        for p in recent_payments:
            if p.get("proof_path"):
                photo = await db.photos.find_one({"storage_path": p["proof_path"]}, {"_id": 0, "content_type": 1})
                p["proof_content_type"] = (photo or {}).get("content_type", "image/jpeg")
        enriched = await _enriched_clinic(db, c, public_clinic_view)
        enriched["users"] = users
        enriched["recent_payments"] = recent_payments
        enriched["support"] = await clinic_support_panel(db, c, cid)
        enriched["owner_account"] = await owner_account_info(db, cid)
        enriched["public_booking_url"] = f"/book/{c.get('slug')}"
        return enriched

    @api.put("/superadmin/clinics/{cid}/profile")
    async def sa_update_clinic_profile(cid: str, payload: ClinicProfileUpdateIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        upd: Dict[str, Any] = {}
        old_profile = {
            "name": c.get("name"),
            "slug": c.get("slug"),
            "email": c.get("email"),
            "phone": c.get("phone"),
            "timezone": c.get("timezone"),
            "currency": c.get("currency"),
        }
        if payload.name is not None:
            upd["name"] = payload.name.strip()
        if payload.slug is not None:
            try:
                new_slug = await validate_booking_slug(db, payload.slug.strip(), cid)
            except BookingSlugError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message)
            upd["slug"] = new_slug
        if payload.email is not None:
            upd["email"] = payload.email.lower().strip()
        if payload.phone is not None:
            upd["phone"] = payload.phone.strip()
        if payload.timezone is not None:
            upd["timezone"] = payload.timezone.strip()
        if payload.currency is not None:
            upd["currency"] = payload.currency.strip().upper()
        if not upd:
            raise HTTPException(status_code=400, detail="No profile fields to update")
        await db.clinics.update_one({"id": cid}, {"$set": upd})
        new_profile = {**old_profile, **upd}
        action = "slug_changed" if upd.get("slug") and upd.get("slug") != old_profile.get("slug") else "clinic_profile_changed"
        if upd.get("email") and upd.get("email") != old_profile.get("email"):
            await _sa_audit(
                audit, user, cid, c.get("name", ""), "primary_email_changed", cid,
                old_value={"email": old_profile.get("email")}, new_value={"email": upd.get("email")},
                reason=payload.reason,
            )
        await _sa_audit(
            audit, user, cid, new_profile.get("name") or c.get("name", ""), action, cid,
            old_value=old_profile, new_value=new_profile, reason=payload.reason,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.post("/superadmin/clinics/{cid}/change-owner-email")
    async def sa_change_owner_email(cid: str, payload: OwnerEmailChangeIn, user: dict = Depends(admin_dep)):
        new_email = payload.new_email.lower().strip()
        confirm = payload.confirm_email.lower().strip()
        if new_email != confirm:
            raise HTTPException(status_code=400, detail="Email confirmation does not match")
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        old_email = owner.get("email")
        if new_email == old_email:
            raise HTTPException(status_code=400, detail="New email is the same as current owner email")
        existing = await db.users.find_one({"email": new_email}, {"_id": 0, "id": 1, "clinic_id": 1})
        if existing and existing["id"] != owner["id"]:
            raise HTTPException(status_code=409, detail="Email already registered to another user")
        await db.users.update_one({"id": owner["id"]}, {"$set": {"email": new_email}})
        clinic_upd: Dict[str, Any] = {"owner_email": new_email}
        if payload.update_primary_clinic_email:
            clinic_upd["email"] = new_email
        await db.clinics.update_one({"id": cid}, {"$set": clinic_upd})
        if payload.invalidate_sessions:
            await invalidate_user_sessions(db, owner["id"])
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "owner_email_changed", owner["id"],
            old_value={"email": old_email}, new_value={"email": new_email},
            reason=reason,
            meta={"update_primary_clinic_email": payload.update_primary_clinic_email, "changed_by": user.get("email")},
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        enriched = await _enriched_clinic(db, c2, public_clinic_view)
        enriched["owner_account"] = await owner_account_info(db, cid)
        return enriched

    @api.post("/superadmin/clinics/{cid}/transfer-ownership")
    async def sa_transfer_ownership(cid: str, payload: OwnerTransferIn, user: dict = Depends(admin_dep)):
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        target = await db.users.find_one({"id": payload.new_owner_user_id, "clinic_id": cid}, {"_id": 0, "password_hash": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Target user not found in this clinic")
        if target["id"] == owner["id"]:
            raise HTTPException(status_code=400, detail="User is already the owner")
        await db.users.update_one({"id": owner["id"]}, {"$set": {"role": "manager"}})
        await db.users.update_one({"id": target["id"]}, {"$set": {"role": "super_admin"}})
        await db.clinics.update_one({"id": cid}, {"$set": {
            "owner_email": target.get("email"),
            "owner_name": target.get("name"),
        }})
        if payload.invalidate_sessions:
            await invalidate_clinic_sessions(db, cid)
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "ownership_transferred", target["id"],
            old_value={"owner_id": owner["id"], "owner_email": owner.get("email")},
            new_value={"owner_id": target["id"], "owner_email": target.get("email")},
            reason=reason,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        enriched = await _enriched_clinic(db, c2, public_clinic_view)
        enriched["owner_account"] = await owner_account_info(db, cid)
        return enriched

    @api.post("/superadmin/clinics/{cid}/force-logout-owner")
    async def sa_force_logout_owner(cid: str, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "name": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0, "id": 1, "email": 1})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        await invalidate_user_sessions(db, owner["id"])
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "force_logout_owner", owner["id"],
            new_value={"owner_email": owner.get("email")},
        )
        return {"ok": True, "owner_id": owner["id"]}

    @api.post("/superadmin/clinics/{cid}/force-logout-all")
    async def sa_force_logout_all(cid: str, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "name": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        count = await invalidate_clinic_sessions(db, cid)
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "force_logout_all_users", cid,
            new_value={"users_affected": count},
        )
        return {"ok": True, "users_affected": count}

    @api.post("/superadmin/clinics/{cid}/archive")
    async def sa_archive_clinic(cid: str, payload: ArchiveClinicIn, user: dict = Depends(admin_dep)):
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        prev = sub.get("status")
        now = iso(now_utc())
        sub["status"] = "archived"
        sub["archived_previous_status"] = prev
        patch = {
            "subscription": sub,
            "archived_at": now,
            "archived_by": user["email"],
            "archived_reason": reason,
        }
        churn_reason = (payload.churn_reason or "").strip().lower() or None
        churn_note = (payload.churn_note or "").strip() or None
        if churn_reason:
            patch["churn_reason"] = churn_reason
            patch["churn_note"] = churn_note or reason
            patch["churned_at"] = now
            patch["churned_by"] = user["email"]
        await db.clinics.update_one({"id": cid}, {"$set": patch})
        await invalidate_clinic_sessions(db, cid)
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "clinic_archived", cid,
            old_value={"status": prev}, new_value={"status": "archived"}, reason=reason,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.post("/superadmin/clinics/{cid}/restore")
    async def sa_restore_clinic(cid: str, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        if sub.get("status") != "archived":
            raise HTTPException(status_code=400, detail="Clinic is not archived")
        restore_status = sub.pop("archived_previous_status", None) or "active"
        sub["status"] = restore_status
        await db.clinics.update_one({"id": cid}, {"$set": {
            "subscription": sub,
            "archived_at": None,
            "archived_by": None,
            "archived_reason": None,
            "restored_at": iso(now_utc()),
            "restored_by": user["email"],
        }})
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "clinic_restored", cid,
            old_value={"status": "archived"}, new_value={"status": restore_status},
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.put("/superadmin/clinics/{cid}/test-flag")
    async def sa_set_test_clinic_flag(cid: str, payload: TestClinicFlagIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        prev = bool(c.get("is_test_clinic", False))
        await db.clinics.update_one({"id": cid}, {"$set": {"is_test_clinic": bool(payload.is_test_clinic)}})
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "test_clinic_flag_changed", cid,
            old_value={"is_test_clinic": prev},
            new_value={"is_test_clinic": bool(payload.is_test_clinic)},
            reason=payload.reason,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.post("/superadmin/clinics/{cid}/delete-permanent")
    async def sa_delete_permanent(cid: str, payload: PermanentDeleteIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        if not c.get("is_test_clinic"):
            raise HTTPException(
                status_code=403,
                detail="Permanent deletion is only allowed for test/demo clinics. Archive this clinic instead.",
            )
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Deletion reason is required")
        if payload.confirm_slug.strip() != c.get("slug"):
            raise HTTPException(status_code=400, detail="Clinic slug confirmation does not match")
        if payload.confirm_phrase.strip() != "DELETE PERMANENTLY":
            raise HTTPException(status_code=400, detail='Confirmation phrase must be exactly "DELETE PERMANENTLY"')
        if not payload.confirmed:
            raise HTTPException(status_code=400, detail="Second confirmation is required")
        clinic_name = c.get("name", "")
        clinic_slug = c.get("slug", "")
        now = iso(now_utc())
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None, "name": "Platform Admin"},
            "clinic_permanently_deleted",
            "clinic",
            cid,
            meta={
                "clinic_id": cid,
                "clinic_name": clinic_name,
                "slug": clinic_slug,
                "deleted_by": user.get("email"),
                "reason": reason,
                "timestamp": now,
                "is_test_clinic": True,
            },
            old_value={"name": clinic_name, "slug": clinic_slug},
            new_value={"deleted": True, "deleted_at": now},
            reason=reason,
        )
        counts = await purge_test_clinic_data(
            db, cid, init_storage=init_storage, storage_url=STORAGE_URL,
        )
        return {"ok": True, "deleted": counts, "clinic_id": cid, "slug": clinic_slug}

    @api.get("/superadmin/clinics/{cid}/plan-change-preview")
    async def sa_plan_change_preview(cid: str, plan: str, _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        usage = await _clinic_usage(db, cid)
        return plan_change_preview(c, plan, usage, PLAN_CATALOG)

    @api.put("/superadmin/clinics/{cid}/subscription")
    async def sa_update_subscription(cid: str, payload: SubscriptionUpdateIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        old_sub = dict(sub)
        old_plan = sub.get("plan")
        if payload.plan:
            if payload.plan not in PLAN_CATALOG:
                raise HTTPException(status_code=400, detail="Unknown plan")
            usage = await _clinic_usage(db, cid)
            preview = plan_change_preview(c, payload.plan, usage, PLAN_CATALOG)
            if preview.get("blocked") and not payload.force_plan_change:
                raise HTTPException(
                    status_code=409,
                    detail={"message": "Plan change blocked by usage limits", "preview": preview},
                )
            sub["plan"] = payload.plan
        if payload.status:
            if payload.status not in SUBSCRIPTION_STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status")
            prev_status = sub.get("status")
            sub["status"] = payload.status
            if payload.status == "active" and not sub.get("expiry_date"):
                sub["expiry_date"] = iso(now_utc() + timedelta(days=30))
            if payload.status == "active":
                sub.pop("past_due_since", None)
                sub.pop("past_due_until", None)
            if payload.status == "suspended" and prev_status != "suspended":
                await create_platform_notification(
                    db, ntype="clinic_suspended", title=f"Clinic suspended: {c.get('name')}",
                    body="Subscription status set to suspended", clinic_id=cid, clinic_name=c.get("name"),
                    link=f"/superadmin/clinics/{cid}",
                )
                await create_clinic_notification(
                    db, clinic_id=cid, ntype="suspended",
                    title="Account suspended",
                    body="Your clinic account has been suspended. Contact support or renew your plan.",
                    link="/billing/plans", dedupe_hours=0,
                )
            if prev_status == "suspended" and payload.status == "active":
                await create_platform_notification(
                    db, ntype="clinic_reactivated", title=f"Clinic reactivated: {c.get('name')}",
                    body="Subscription status set to active", clinic_id=cid, clinic_name=c.get("name"),
                    link=f"/superadmin/clinics/{cid}",
                )
                await notify_reactivated(db, cid)
        if payload.extend_days:
            base_field = "expiry_date" if sub.get("status") != "trial" else "trial_end"
            base_val = sub.get(base_field)
            try:
                base_dt = datetime.fromisoformat(base_val) if base_val else now_utc()
            except Exception:
                base_dt = now_utc()
            if base_dt < now_utc():
                base_dt = now_utc()
            sub[base_field] = iso(base_dt + timedelta(days=payload.extend_days))
        if payload.expiry_date:
            sub["expiry_date"] = payload.expiry_date
        if payload.trial_end:
            sub["trial_end"] = payload.trial_end
        if payload.billing_cycle:
            if payload.billing_cycle not in BILLING_CYCLE_KEYS:
                raise HTTPException(status_code=400, detail="Invalid billing cycle")
            sub["billing_cycle"] = payload.billing_cycle
        if payload.grace_days is not None:
            days = max(0, int(payload.grace_days))
            sub["past_due_since"] = sub.get("past_due_since") or iso(now_utc())
            sub["past_due_until"] = iso(now_utc() + timedelta(days=days))
            if sub.get("status") not in ("past_due", "suspended", "archived"):
                sub["status"] = "past_due"

        clinic_upd: Dict[str, Any] = {"subscription": sub}
        if payload.limit_overrides is not None:
            clinic_upd["limit_overrides"] = payload.limit_overrides
        if payload.status in ("trial", "active"):
            clinic_upd["trial_expired_platform_notified"] = False

        await db.clinics.update_one({"id": cid}, {"$set": clinic_upd})
        audit_action = "subscription_update"
        if payload.plan and payload.plan != old_plan:
            audit_action = "plan_changed"
        elif payload.status and payload.status != old_sub.get("status"):
            audit_action = "status_changed"
        elif payload.extend_days:
            audit_action = "trial_extended" if old_sub.get("status") == "trial" else "renewal_date_changed"
        elif payload.expiry_date:
            audit_action = "renewal_date_changed"
        await _sa_audit(
            audit, user, cid, c.get("name", ""), audit_action, cid,
            old_value=old_sub, new_value=sub, reason=payload.reason,
            meta={"force_plan_change": payload.force_plan_change} if payload.force_plan_change else None,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.delete("/superadmin/clinics/{cid}")
    async def sa_delete_clinic(cid: str, user: dict = Depends(admin_dep)):
        """Legacy soft-cancel — prefer archive via POST /archive."""
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "name": 1, "subscription": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        prev = sub.get("status")
        sub["status"] = "cancelled"
        await db.clinics.update_one({"id": cid}, {"$set": {
            "subscription": sub,
            "cancelled_at": iso(now_utc()),
        }})
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "clinic_cancelled", cid,
            old_value={"status": prev}, new_value={"status": "cancelled"},
        )
        return {"ok": True}

    # ---------- Payment Verification Queue ----------
    @api.get("/superadmin/payments")
    async def sa_list_payments(status: Optional[str] = None, clinic: Optional[str] = None, _user: dict = Depends(admin_dep)):
        flt = {}
        if status:
            flt["status"] = status
        if clinic:
            flt["clinic_id"] = clinic
        rows = await db.payment_requests.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        # Augment with clinic name + proof URL (auth-required, served by /api/files)
        for r in rows:
            c = await db.clinics.find_one({"id": r.get("clinic_id")}, {"_id": 0, "name": 1, "slug": 1, "owner_email": 1})
            if c:
                r["clinic_name"] = c["name"]
                r["clinic_slug"] = c["slug"]
                r["owner_email"] = c.get("owner_email")
            # proof url + content type for SA preview
            if r.get("proof_path"):
                photo = await db.photos.find_one({"storage_path": r["proof_path"]}, {"_id": 0, "content_type": 1})
                r["proof_content_type"] = (photo or {}).get("content_type", "image/jpeg")
        return rows

    @api.post("/superadmin/payments/{pid}/verify")
    async def sa_verify_payment(pid: str, user: dict = Depends(admin_dep)):
        p = await db.payment_requests.find_one({"id": pid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Payment request not found")
        if p.get("status") == "verified":
            return p
        # Activate the clinic's subscription based on payment plan
        cid = p["clinic_id"]
        plan = p["plan"]
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        sub["plan"] = plan
        sub["status"] = "active"
        # Extend 30 days from now or current expiry whichever is later
        base = sub.get("expiry_date")
        try:
            base_dt = datetime.fromisoformat(base) if base else now_utc()
        except Exception:
            base_dt = now_utc()
        if base_dt < now_utc():
            base_dt = now_utc()
        cycle_key = p.get("billing_cycle") or "monthly"
        if cycle_key not in BILLING_CYCLE_KEYS:
            cycle_key = "monthly"
        months = int(BILLING_CYCLES[cycle_key]["months"])
        sub["billing_cycle"] = cycle_key
        sub["expiry_date"] = iso(base_dt + timedelta(days=30 * months))
        sub["started_at"] = sub.get("started_at") or iso(now_utc())
        sub.pop("past_due_since", None)
        sub.pop("past_due_until", None)
        await db.clinics.update_one({"id": cid}, {"$set": {"subscription": sub}})
        now = iso(now_utc())
        await db.payment_requests.update_one({"id": pid}, {"$set": {
            "status": "verified",
            "verified_at": now,
            "verified_by": user["email"],
            "approved_at": now,
            "approved_by": user["email"],
        }})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "approve_payment", "payment_request", pid, {"plan": plan, "amount_idr": p.get("amount_idr")},
        )
        await notify_payment_approved(db, cid, plan=plan)
        return await db.payment_requests.find_one({"id": pid}, {"_id": 0})

    @api.post("/superadmin/payments/{pid}/reject")
    async def sa_reject_payment(pid: str, payload: PaymentRejectIn, user: dict = Depends(admin_dep)):
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Rejection reason is required")
        p = await db.payment_requests.find_one({"id": pid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Payment request not found")
        new_status = "needs_clarification" if payload.request_clarification else "rejected"
        now = iso(now_utc())
        await db.payment_requests.update_one({"id": pid}, {"$set": {
            "status": new_status,
            "verified_at": now,
            "verified_by": user["email"],
            "rejected_at": now,
            "rejected_by": user["email"],
            "rejection_reason": reason,
        }})
        action = "request_clarification" if payload.request_clarification else "reject_payment"
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": p.get("clinic_id")},
            action, "payment_request", pid, {"reason": reason},
            reason=reason,
        )
        if new_status == "rejected":
            await notify_payment_rejected(db, p.get("clinic_id"), reason=reason)
        return await db.payment_requests.find_one({"id": pid}, {"_id": 0})

    @api.put("/superadmin/clinics/{cid}/limits")
    async def sa_update_limits(cid: str, payload: LimitOverridesIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        overrides = dict(c.get("limit_overrides") or {})
        if payload.max_staff is not None:
            overrides["max_staff"] = max(1, int(payload.max_staff))
        if payload.storage_gb is not None:
            overrides["storage_gb"] = max(1, int(payload.storage_gb))
        await db.clinics.update_one({"id": cid}, {"$set": {"limit_overrides": overrides}})
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "storage_staff_override_changed", cid,
            old_value=c.get("limit_overrides"), new_value=overrides,
        )
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return await _enriched_clinic(db, c2, public_clinic_view)

    @api.post("/superadmin/clinics/{cid}/reset-owner-password")
    async def sa_reset_owner_password(cid: str, user: dict = Depends(admin_dep)):
        if not hash_password:
            raise HTTPException(status_code=500, detail="Password reset unavailable")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        temp_password = _gen_password()
        await db.users.update_one(
            {"id": owner["id"]},
            {"$set": {"password_hash": hash_password(temp_password)}},
        )
        await invalidate_user_sessions(db, owner["id"])
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "password_reset_generated", owner["id"],
            new_value={"owner_email": owner.get("email")},
        )
        return {
            "ok": True,
            "owner_email": owner.get("email"),
            "temporary_password": temp_password,
            "message": "Share this temporary password securely with the clinic owner. It is shown once.",
        }

    @api.post("/superadmin/clinics/{cid}/impersonate")
    async def sa_impersonate(cid: str, user: dict = Depends(admin_dep)):
        if not create_token:
            raise HTTPException(status_code=500, detail="Impersonation unavailable")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0, "password_hash": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        token = create_token(
            owner["id"],
            owner["email"],
            owner["role"],
            clinic_id=cid,
            auth_version=int(owner.get("auth_version") or 0),
            impersonating=True,
            impersonator_id=user.get("id", "platform-admin"),
            impersonator_email=user.get("email"),
            impersonator_clinic_name=c.get("name"),
        )
        await _sa_audit(
            audit, user, cid, c.get("name", ""), "impersonation_start", cid,
            new_value={"owner_id": owner["id"], "owner_email": owner.get("email")},
        )
        return {
            "token": token,
            "clinic_id": cid,
            "clinic_name": c.get("name"),
            "user": {
                "id": owner["id"],
                "email": owner["email"],
                "name": owner.get("name"),
                "role": owner["role"],
                "clinic_id": cid,
                "impersonating": True,
                "impersonator_email": user.get("email"),
                "impersonator_clinic_name": c.get("name"),
            },
        }

    @api.post("/superadmin/clinics/{cid}/resend-owner-invite")
    async def sa_resend_owner_invite(cid: str, user: dict = Depends(admin_dep)):
        if not hash_password:
            raise HTTPException(status_code=500, detail="Invite unavailable")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await db.users.find_one({"clinic_id": cid, "role": "super_admin"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Clinic owner not found")
        invite_token = str(uuid.uuid4())
        temp_password = _gen_password()
        await db.users.update_one(
            {"id": owner["id"]},
            {"$set": {
                "password_hash": hash_password(temp_password),
                "invite_token": invite_token,
                "must_change_password": True,
            }},
        )
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "resend_owner_invite", "user", owner["id"], {"owner_email": owner.get("email")},
        )
        return {
            "ok": True,
            "owner_email": owner.get("email"),
            "invite_token": invite_token,
            "temporary_password": temp_password,
            "message": "Share invite credentials securely. Password is shown once.",
        }

    @api.get("/superadmin/clinics/{cid}/reminder-text")
    async def sa_reminder_text(cid: str, reminder_type: str = "renewal", _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        support = {}
        if get_platform_settings:
            try:
                ps = await get_platform_settings() or {}
                support = {
                    "whatsapp": ps.get("support_whatsapp") or SUPPORT_WHATSAPP,
                    "support_whatsapp": ps.get("support_whatsapp") or SUPPORT_WHATSAPP,
                }
            except Exception:
                pass
        if not support.get("whatsapp") and SUPPORT_WHATSAPP:
            support["whatsapp"] = SUPPORT_WHATSAPP
        text = reminder_whatsapp_text(c, reminder_type if reminder_type in ("renewal", "payment_due") else "renewal", support)
        return {"text": text, "reminder_type": reminder_type}

    @api.post("/superadmin/clinics/{cid}/mark-reminder-sent")
    async def sa_mark_reminder_sent(cid: str, payload: ReminderMarkIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        now = iso(now_utc())
        sub["reminder_sent_at"] = now
        sub["reminder_sent_by"] = user["email"]
        sub["reminder_type"] = payload.reminder_type
        await db.clinics.update_one({"id": cid}, {"$set": {"subscription": sub}})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "reminder_sent", "clinic", cid, {"reminder_type": payload.reminder_type},
        )
        return {"ok": True, "reminder_sent_at": now, "reminder_sent_by": user["email"]}

    @api.post("/superadmin/impersonate/end")
    async def sa_impersonate_end(payload: ImpersonateEndIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": payload.clinic_id}, {"_id": 0, "name": 1})
        await _sa_audit(
            audit, user, payload.clinic_id, (c or {}).get("name", ""), "impersonation_end", payload.clinic_id, {},
        )
        return {"ok": True}

    @api.get("/superadmin/audit-log")
    async def sa_audit_log(
        limit: int = 100,
        module: Optional[str] = None,
        clinic_id: Optional[str] = None,
        _user: dict = Depends(admin_dep),
    ):
        flt: Dict[str, Any] = {}
        if module:
            flt["module"] = module
        if clinic_id:
            flt["clinic_id"] = clinic_id
        cap = min(max(1, limit), 500)
        rows = await db.audit_logs.find(flt, {"_id": 0}).sort("created_at", -1).limit(cap).to_list(cap)
        for r in rows:
            if r.get("clinic_id"):
                c = await db.clinics.find_one({"id": r["clinic_id"]}, {"_id": 0, "name": 1})
                r["clinic_name"] = (c or {}).get("name")
        return rows

    @api.get("/superadmin/notifications")
    async def sa_list_notifications(unread_only: bool = False, limit: int = 50, _user: dict = Depends(admin_dep)):
        flt: Dict[str, Any] = {}
        if unread_only:
            flt["read_at"] = None
        cap = min(max(1, limit), 200)
        rows = await db.platform_notifications.find(flt, {"_id": 0}).sort("created_at", -1).limit(cap).to_list(cap)
        unread = await db.platform_notifications.count_documents({"read_at": None})
        return {"items": rows, "unread_count": unread}

    @api.post("/superadmin/notifications/{nid}/read")
    async def sa_mark_notification_read(nid: str, _user: dict = Depends(admin_dep)):
        now = iso(now_utc())
        r = await db.platform_notifications.update_one({"id": nid, "read_at": None}, {"$set": {"read_at": now}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"ok": True}

    @api.post("/superadmin/notifications/read-all")
    async def sa_mark_all_notifications_read(_user: dict = Depends(admin_dep)):
        now = iso(now_utc())
        await db.platform_notifications.update_many({"read_at": None}, {"$set": {"read_at": now}})
        return {"ok": True}

    # ---------- Clinic-side: billing options & quotes ----------
    @api.get("/billing/cycles")
    async def list_billing_cycles(_user: dict = Depends(saas_billing_read_dep)):
        return [
            {"key": k, "label": v["label"], "months": v["months"], "discount_percent": int(round((1 - v["discount"]) * 100))}
            for k, v in BILLING_CYCLES.items()
        ]

    @api.get("/billing/quote")
    async def billing_quote(
        plan: str,
        cycle: str = "monthly",
        user: dict = Depends(saas_billing_read_dep),
    ):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if plan not in PLAN_CATALOG:
            raise HTTPException(status_code=400, detail="Unknown plan")
        if cycle not in BILLING_CYCLE_KEYS:
            raise HTTPException(status_code=400, detail="Unknown billing cycle")
        price = int(PLAN_CATALOG[plan]["price_idr"])
        q = compute_plan_charge(price, cycle)
        q["plan"] = plan
        q["plan_name"] = PLAN_CATALOG[plan]["name"]
        return q

    # ---------- Clinic-side: create a payment request (auth, owner) ----------
    @api.post("/billing/payment-request")
    async def create_payment_request(
        plan: str = Form(...),
        amount: int = Form(...),
        unique_code: int = Form(...),
        billing_cycle: str = Form("monthly"),
        file: Optional[UploadFile] = File(None),
        user: dict = Depends(subscribe_dep),
    ):
        if plan not in PLAN_CATALOG:
            raise HTTPException(status_code=400, detail="Unknown plan")
        if billing_cycle not in BILLING_CYCLE_KEYS:
            raise HTTPException(status_code=400, detail="Unknown billing cycle")
        proof_path = ""
        if file is not None:
            ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "webp", "pdf"):
                raise HTTPException(status_code=400, detail="Unsupported proof format")
            pid_obj = str(uuid.uuid4())
            path = f"{APP_NAME}/payments/{user.get('clinic_id')}/{pid_obj}.{ext}"
            data = await file.read()
            max_upload_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
            if len(data) > max_upload_bytes:
                raise HTTPException(status_code=413, detail=f"Proof file too large. Maximum {max_upload_bytes // (1024 * 1024)} MB.")
            ct = file.content_type or ("application/pdf" if ext == "pdf" else f"image/{ext}")
            try:
                result = put_object(path, data, ct)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=502, detail="Payment proof upload failed. Please try again.")
            proof_path = result["path"]
            await db.photos.insert_one({
                "id": pid_obj,
                "visit_id": "",
                "patient_id": "",
                "clinic_id": user.get("clinic_id"),
                "storage_path": result["path"],
                "photo_type": "payment_proof",
                "angle": "proof",
                "content_type": ct,
                "size_bytes": len(data),
                "uploaded_by": user["id"],
                "created_at": iso(now_utc()),
            })
        req_id = str(uuid.uuid4())
        req = {
            "id": req_id,
            "clinic_id": user.get("clinic_id"),
            "plan": plan,
            "billing_cycle": billing_cycle,
            "amount_idr": amount,
            "unique_code": unique_code,
            "proof_path": proof_path,
            "status": "submitted",
            "created_at": iso(now_utc()),
            "submitted_by": user["email"],
        }
        await db.payment_requests.insert_one(req)
        await audit(user, "submit", "payment_request", req_id, {"plan": plan, "amount": amount, "billing_cycle": billing_cycle})
        c = await db.clinics.find_one({"id": user.get("clinic_id")}, {"_id": 0, "name": 1})
        await create_platform_notification(
            db,
            ntype="payment_proof_submitted",
            title=f"Payment proof submitted: {(c or {}).get('name', 'Clinic')}",
            body=f"{plan} plan · Rp {amount:,} · cycle {billing_cycle}",
            clinic_id=user.get("clinic_id"),
            clinic_name=(c or {}).get("name"),
            link=f"/superadmin/payments?clinic={user.get('clinic_id')}",
            meta={"payment_request_id": req_id, "plan": plan, "amount_idr": amount},
        )
        await notify_payment_submitted(db, user.get("clinic_id"), plan=plan, amount_idr=amount)
        return {"id": req_id, "status": "submitted"}

    # ---------- Announcements ----------
    @api.get("/superadmin/announcements")
    async def sa_list_announcements(_user: dict = Depends(admin_dep)):
        rows = await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return rows

    @api.post("/superadmin/announcements")
    async def sa_create_announcement(payload: AnnouncementIn, user: dict = Depends(admin_dep)):
        data = payload.model_dump()
        now = iso(now_utc())
        ann = {**data, "id": str(uuid.uuid4()), "created_at": now, "created_by": user["email"]}
        if ann.get("status", "published") == "published":
            ann["published_at"] = now
            ann["active"] = True
        if ann.get("target_type") == "clinic" and ann.get("target_clinic_id"):
            ann["target_clinic_ids"] = [ann["target_clinic_id"]]
        await db.announcements.insert_one(ann)
        ann.pop("_id", None)
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "post_announcement", "announcement", ann["id"], {"title": ann.get("title")},
        )
        return ann

    @api.put("/superadmin/announcements/{aid}")
    async def sa_update_announcement(aid: str, payload: AnnouncementUpdateIn, user: dict = Depends(admin_dep)):
        ann = await db.announcements.find_one({"id": aid}, {"_id": 0})
        if not ann:
            raise HTTPException(status_code=404, detail="Not found")
        upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
        if upd.get("target_type") == "clinic" and upd.get("target_clinic_id"):
            upd["target_clinic_ids"] = [upd["target_clinic_id"]]
        if upd:
            await db.announcements.update_one({"id": aid}, {"$set": upd})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "update_announcement", "announcement", aid, upd,
        )
        return await db.announcements.find_one({"id": aid}, {"_id": 0})

    @api.post("/superadmin/announcements/{aid}/publish")
    async def sa_publish_announcement(aid: str, user: dict = Depends(admin_dep)):
        ann = await db.announcements.find_one({"id": aid}, {"_id": 0})
        if not ann:
            raise HTTPException(status_code=404, detail="Not found")
        now = iso(now_utc())
        await db.announcements.update_one({"id": aid}, {"$set": {
            "status": "published", "active": True, "published_at": now, "archived_at": None,
        }})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "publish_announcement", "announcement", aid, {},
        )
        return await db.announcements.find_one({"id": aid}, {"_id": 0})

    @api.post("/superadmin/announcements/{aid}/archive")
    async def sa_archive_announcement(aid: str, user: dict = Depends(admin_dep)):
        ann = await db.announcements.find_one({"id": aid}, {"_id": 0})
        if not ann:
            raise HTTPException(status_code=404, detail="Not found")
        now = iso(now_utc())
        await db.announcements.update_one({"id": aid}, {"$set": {
            "status": "archived", "active": False, "archived_at": now,
        }})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "archive_announcement", "announcement", aid, {},
        )
        return await db.announcements.find_one({"id": aid}, {"_id": 0})

    @api.delete("/superadmin/announcements/{aid}")
    async def sa_delete_announcement(aid: str, _user: dict = Depends(admin_dep)):
        r = await db.announcements.delete_one({"id": aid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}

    # ---------- Public-facing active announcement (auth required) ----------
    @api.get("/announcements/active")
    async def active_announcement(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            return []
        cid = user.get("clinic_id")
        if not cid:
            return []
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            return []
        return await active_announcements_for_clinic(db, c)
