"""Platform operations helpers: notifications, announcements, clinic provisioning, plan changes."""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

PLAN_ORDER = ["starter", "clinic", "complete"]

from saas import (
    PLAN_CATALOG,
    DEFAULT_LOYALTY_TIERS,
    iso,
    now_utc,
    resolve_clinic_limits,
    slugify,
)


def _gen_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def build_admin_clinic_doc(
    *,
    clinic_name: str,
    slug: Optional[str],
    owner_name: str,
    owner_email: str,
    existing_slugs: List[str],
    plan: str = "trial",
    billing_cycle: str = "monthly",
    trial_days: int = 14,
    template_preset: str = "default",
    initial_status: Optional[str] = None,
) -> dict:
    email = owner_email.lower().strip()
    raw_slug = slugify(slug or clinic_name)
    base = raw_slug or "clinic"
    candidate = base
    i = 1
    while candidate in existing_slugs:
        i += 1
        candidate = f"{base}-{i}"

    now = now_utc()
    use_trial = plan == "trial" or (initial_status or "") == "trial"
    status = "trial" if use_trial else (initial_status or "active")
    sub: Dict[str, Any] = {
        "started_at": iso(now),
        "billing_cycle": billing_cycle if billing_cycle in ("monthly", "semiannual", "annual") else "monthly",
    }
    if use_trial or status == "trial":
        sub.update({
            "plan": "trial",
            "status": "trial",
            "trial_end": iso(now + timedelta(days=max(1, int(trial_days or 14)))),
            "expiry_date": None,
        })
    else:
        months = {"monthly": 1, "semiannual": 6, "annual": 12}.get(billing_cycle, 1)
        sub.update({
            "plan": plan if plan in PLAN_CATALOG else "clinic",
            "status": status,
            "trial_end": None,
            "expiry_date": iso(now + timedelta(days=30 * months)),
        })

    return {
        "id": str(uuid.uuid4()),
        "name": clinic_name.strip(),
        "slug": candidate,
        "logo_path": "",
        "address": "",
        "city": "",
        "phone": "",
        "email": email,
        "owner_name": owner_name.strip(),
        "owner_email": email,
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
        "subscription": sub,
        "template_preset": template_preset or "default",
        "onboarded": False,
        "created_at": iso(now),
        "created_by_platform": True,
        "is_test_clinic": False,
    }


async def seed_clinic_settings(db, clinic_id: str, clinic_name: str, default_settings: dict, template_preset: str = "default"):
    seeded = {**default_settings, "id": "global", "clinic_id": clinic_id}
    seeded["branding"] = {
        **default_settings.get("branding", {}),
        "clinic_name": clinic_name,
        "tagline": "Aesthetic Clinic",
    }
    if template_preset == "minimal":
        fc = dict(seeded.get("form_config") or {})
        fc["contraindications"] = (fc.get("contraindications") or [])[:5]
        fc["devices"] = (fc.get("devices") or [])[:5]
        seeded["form_config"] = fc
    await db.settings.update_one(
        {"id": "global", "clinic_id": clinic_id},
        {"$setOnInsert": seeded},
        upsert=True,
    )


async def create_platform_notification(
    db,
    *,
    ntype: str,
    title: str,
    body: str,
    clinic_id: Optional[str] = None,
    clinic_name: Optional[str] = None,
    meta: Optional[dict] = None,
    link: Optional[str] = None,
):
    """Insert a platform notification if no duplicate of same type+clinic in last 24h (for scans)."""
    if clinic_id and ntype == "trial_expired":
        existing = await db.platform_notifications.find_one({
            "type": ntype,
            "clinic_id": clinic_id,
        })
        if existing:
            return existing.get("id")
    if clinic_id and ntype in ("trial_ending", "subscription_expiring", "staff_limit", "storage_limit"):
        since = iso(now_utc() - timedelta(hours=24))
        existing = await db.platform_notifications.find_one({
            "type": ntype,
            "clinic_id": clinic_id,
            "created_at": {"$gte": since},
        })
        if existing:
            return existing.get("id")
    doc = {
        "id": str(uuid.uuid4()),
        "type": ntype,
        "title": title,
        "body": body,
        "clinic_id": clinic_id,
        "clinic_name": clinic_name,
        "meta": meta or {},
        "link": link,
        "read_at": None,
        "created_at": iso(now_utc()),
    }
    await db.platform_notifications.insert_one(doc)
    return doc["id"]


def announcement_matches_clinic(ann: dict, clinic: dict) -> bool:
    if ann.get("status") == "archived" or not ann.get("active", True):
        return False
    if ann.get("published_at") and ann["published_at"] > iso(now_utc()):
        return False
    target = ann.get("target_type") or ann.get("audience") or "all"
    if target in ("all", ""):
        return True
    if target == "clinic":
        ids = ann.get("target_clinic_ids") or ([ann["target_clinic_id"]] if ann.get("target_clinic_id") else [])
        return clinic.get("id") in ids
    if target == "plan":
        tp = ann.get("target_plan") or ann.get("audience")
        sub = clinic.get("subscription") or {}
        return sub.get("plan") == tp
    if target == "status":
        ts = ann.get("target_status") or ann.get("audience")
        sub = clinic.get("subscription") or {}
        st = sub.get("status", "trial")
        if ts == "expired":
            return st in ("expired", "cancelled", "past_due")
        return st == ts
    # legacy audience field
    sub = clinic.get("subscription") or {}
    st = sub.get("status", "trial")
    aud = ann.get("audience", "all")
    if aud == "all":
        return True
    if aud == "trial":
        return st == "trial"
    if aud == "active":
        return st == "active"
    if aud == "expired":
        return st in ("expired", "cancelled", "past_due")
    return False


async def active_announcements_for_clinic(db, clinic: dict, limit: int = 5) -> List[dict]:
    rows = await db.announcements.find(
        {"active": True, "status": {"$ne": "archived"}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    matched = [r for r in rows if announcement_matches_clinic(r, clinic)]
    return matched[:limit]


def plan_change_preview(clinic: dict, new_plan: str, usage: dict, plan_catalog: dict) -> dict:
    if new_plan not in plan_catalog:
        return {"ok": False, "error": "Unknown plan"}
    current_plan = (clinic.get("subscription") or {}).get("plan", "trial")
    new_limits = resolve_clinic_limits({**clinic, "subscription": {**(clinic.get("subscription") or {}), "plan": new_plan, "status": "active"}})
    staff_used = int(usage.get("staff_count") or 0)
    storage_gb = float(usage.get("storage_used_gb") or 0)
    max_staff = int(new_limits.get("max_staff") or 3)
    max_storage = int(new_limits.get("storage_gb") or 2)
    warnings = []
    blocked = False
    if staff_used > max_staff and max_staff < 9999:
        warnings.append(f"Staff count ({staff_used}) exceeds {new_plan} limit ({max_staff})")
        blocked = True
    if storage_gb > max_storage:
        warnings.append(f"Storage ({storage_gb} GB) exceeds {new_plan} limit ({max_storage} GB)")
        blocked = True
    cur_rank = PLAN_ORDER.index(current_plan) if current_plan in PLAN_ORDER else 0
    new_rank = PLAN_ORDER.index(new_plan) if new_plan in PLAN_ORDER else 0
    is_downgrade = new_rank < cur_rank
    return {
        "ok": True,
        "current_plan": current_plan,
        "new_plan": new_plan,
        "is_downgrade": is_downgrade,
        "blocked": blocked,
        "warnings": warnings,
        "limits": {"max_staff": max_staff, "storage_gb": max_storage},
        "usage": {"staff_count": staff_used, "storage_used_gb": storage_gb},
    }


def reminder_whatsapp_text(clinic: dict, reminder_type: str, support: dict) -> str:
    name = clinic.get("name") or "your clinic"
    sub = clinic.get("subscription") or {}
    plan = sub.get("plan", "—")
    wa = support.get("whatsapp") or support.get("support_whatsapp") or ""
    if reminder_type == "payment_due":
        return (
            f"Hi {name}! This is ClinicOS support. "
            f"We noticed a subscription payment is due for your {plan} plan. "
            f"Please complete your bank transfer and upload proof in Billing & Plan. "
            f"Reply here if you need our account details. "
            + (f"WhatsApp: +{wa}" if wa else "")
        )
    return (
        f"Hi {name}! Your ClinicOS subscription ({plan}) is coming up for renewal. "
        f"Open Billing & Plan in the app to renew and avoid interruption. "
        + (f"Questions? WhatsApp +{wa}" if wa else "")
    )


async def scan_platform_alerts(db, plan_catalog: dict):
    """Create notifications for trials/subscriptions expiring within 7 days."""
    now = now_utc()
    horizon = now + timedelta(days=7)
    clinics = await db.clinics.find({}, {"_id": 0, "id": 1, "name": 1, "subscription": 1}).to_list(2000)
    for c in clinics:
        sub = c.get("subscription") or {}
        cid = c["id"]
        cname = c.get("name")
        if sub.get("status") == "trial" and sub.get("trial_end"):
            try:
                end = datetime.fromisoformat(sub["trial_end"])
                if now <= end <= horizon:
                    days = max(0, (end - now).days)
                    await create_platform_notification(
                        db,
                        ntype="trial_ending",
                        title=f"Trial ending: {cname}",
                        body=f"Trial ends in {days} day(s) on {end.date().isoformat()}",
                        clinic_id=cid,
                        clinic_name=cname,
                        link=f"/superadmin/clinics/{cid}",
                    )
            except Exception:
                pass
        if sub.get("status") == "active" and sub.get("expiry_date"):
            try:
                end = datetime.fromisoformat(sub["expiry_date"])
                if now <= end <= horizon:
                    days = max(0, (end - now).days)
                    await create_platform_notification(
                        db,
                        ntype="subscription_expiring",
                        title=f"Subscription expiring: {cname}",
                        body=f"Renews/expires in {days} day(s) on {end.date().isoformat()}",
                        clinic_id=cid,
                        clinic_name=cname,
                        link=f"/superadmin/clinics/{cid}",
                    )
            except Exception:
                pass


async def invalidate_user_sessions(db, user_id: str) -> int:
    """Bump auth_version so existing JWTs for this user are rejected."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "auth_version": 1})
    if not user:
        return 0
    ver = int(user.get("auth_version") or 0) + 1
    await db.users.update_one({"id": user_id}, {"$set": {"auth_version": ver}})
    return ver


async def invalidate_clinic_sessions(db, clinic_id: str) -> int:
    """Force logout all users belonging to a clinic."""
    count = 0
    async for u in db.users.find({"clinic_id": clinic_id}, {"_id": 0, "id": 1}):
        await invalidate_user_sessions(db, u["id"])
        count += 1
    return count


async def owner_account_info(db, clinic_id: str) -> Optional[dict]:
    owner = await db.users.find_one(
        {"clinic_id": clinic_id, "role": "super_admin"},
        {"_id": 0, "password_hash": 0, "invite_token": 0},
    )
    if not owner:
        return None
    last_login = owner.get("last_login_at")
    if not last_login:
        row = await db.audit_logs.find_one(
            {"clinic_id": clinic_id, "user_id": owner["id"], "action": "login"},
            {"_id": 0, "created_at": 1},
            sort=[("created_at", -1)],
        )
        last_login = (row or {}).get("created_at")
    suspended = owner.get("account_suspended", False)
    return {
        "id": owner["id"],
        "name": owner.get("name"),
        "email": owner.get("email"),
        "last_login_at": last_login,
        "created_at": owner.get("created_at"),
        "account_status": "suspended" if suspended else "active",
        "must_change_password": bool(owner.get("must_change_password")),
    }


async def clinic_support_panel(db, clinic: dict, clinic_id: str) -> dict:
    recent_logins = await db.audit_logs.find(
        {"clinic_id": clinic_id, "action": "login"},
        {"_id": 0},
    ).sort("created_at", -1).limit(10).to_list(10)

    recent_audit = await db.audit_logs.find(
        {"clinic_id": clinic_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(15).to_list(15)

    sub = clinic.get("subscription") or {}
    timeline = []
    for key in ("created_at", "started_at", "trial_end", "expiry_date", "past_due_since", "past_due_until"):
        if sub.get(key):
            timeline.append({"event": key.replace("_", " "), "at": sub[key]})
    if clinic.get("cancelled_at"):
        timeline.append({"event": "cancelled", "at": clinic["cancelled_at"]})
    for ev in recent_audit:
        if ev.get("action") in (
            "subscription_update", "approve_payment", "reject_payment",
            "impersonation_start", "update_limits", "reset_owner_password",
        ):
            timeline.append({
                "event": (ev.get("action") or "").replace("_", " "),
                "at": ev.get("created_at"),
                "by": ev.get("user_email"),
            })
    timeline.sort(key=lambda x: x.get("at") or "", reverse=True)

    users = await db.users.find({"clinic_id": clinic_id}, {"_id": 0, "password_hash": 0}).to_list(200)
    staff_summary = [
        {"name": u.get("name"), "email": u.get("email"), "role": u.get("role"), "created_at": u.get("created_at")}
        for u in users
    ]

    return {
        "recent_logins": recent_logins,
        "recent_audit": recent_audit,
        "subscription_timeline": timeline[:20],
        "staff_summary": staff_summary,
        "reminder_sent_at": sub.get("reminder_sent_at"),
        "reminder_sent_by": sub.get("reminder_sent_by"),
        "reminder_type": sub.get("reminder_type"),
        "owner": await owner_account_info(db, clinic_id),
    }


# Collections keyed by clinic_id (deleted in dependency-safe order).
_CLINIC_DATA_COLLECTIONS = (
    "package_usage",
    "patient_packages",
    "commission_records",
    "commission_rules",
    "coupons",
    "plan_change_requests",
    "consent_templates",
    "staff_date_overrides",
    "weekly_staff_schedules",
    "clinic_roles",
    "payment_requests",
    "invoices",
    "products",
    "packages",
    "treatments",
    "consent_forms",
    "mappings",
    "photos",
    "treatment_items",
    "bookings",
    "visits",
    "patients",
    "users",
    "settings",
    "platform_notifications",
)

# Visit-linked docs (may lack clinic_id on older rows).
_VISIT_LINKED_COLLECTIONS = (
    "clinical_records",
    "therapist_records",
    "performer_visit_notes",
)


async def preview_test_clinic_delete(db, clinic_id: str) -> Dict[str, int]:
    """Count tenant-scoped rows that would be removed for a test clinic."""
    photos_count = await db.photos.count_documents({"clinic_id": clinic_id})
    return {
        "users_count": await db.users.count_documents({"clinic_id": clinic_id}),
        "patients_count": await db.patients.count_documents({"clinic_id": clinic_id}),
        "bookings_count": await db.bookings.count_documents({"clinic_id": clinic_id}),
        "visits_count": await db.visits.count_documents({"clinic_id": clinic_id}),
        "invoices_count": await db.invoices.count_documents({"clinic_id": clinic_id}),
        "photos_count": photos_count,
        "files_count": photos_count,
        "payment_requests_count": await db.payment_requests.count_documents({"clinic_id": clinic_id}),
        "packages_count": await db.packages.count_documents({"clinic_id": clinic_id}),
        "treatments_count": await db.treatments.count_documents({"clinic_id": clinic_id}),
        "products_count": await db.products.count_documents({"clinic_id": clinic_id}),
        "settings_count": await db.settings.count_documents({"clinic_id": clinic_id}),
        "notifications_count": await db.clinic_notifications.count_documents({"clinic_id": clinic_id}),
    }


def _sum_preview_counts(previews: List[Dict[str, int]]) -> Dict[str, int]:
    totals: Dict[str, int] = {}
    for row in previews:
        for key, val in row.items():
            if key.endswith("_count"):
                totals[key] = totals.get(key, 0) + int(val or 0)
    return totals


async def purge_test_clinic_data(
    db,
    clinic_id: str,
    *,
    init_storage=None,
    storage_url: str = "",
) -> Dict[str, int]:
    """Hard-delete all tenant data for a test clinic. Returns per-collection delete counts."""
    counts: Dict[str, int] = {}

    visit_ids = [v["id"] async for v in db.visits.find({"clinic_id": clinic_id}, {"_id": 0, "id": 1})]
    if visit_ids:
        for coll in _VISIT_LINKED_COLLECTIONS:
            r = await db[coll].delete_many({"visit_id": {"$in": visit_ids}})
            if r.deleted_count:
                counts[coll] = counts.get(coll, 0) + r.deleted_count

    if init_storage and storage_url:
        try:
            import requests
            key = init_storage()
            async for photo in db.photos.find({"clinic_id": clinic_id}, {"_id": 0, "storage_path": 1}):
                path = photo.get("storage_path")
                if not path:
                    continue
                try:
                    requests.delete(
                        f"{storage_url}/objects/{path}",
                        headers={"X-Storage-Key": key},
                        timeout=15,
                    )
                except Exception:
                    pass
        except Exception:
            pass

    for coll in _CLINIC_DATA_COLLECTIONS:
        try:
            r = await db[coll].delete_many({"clinic_id": clinic_id})
            if r.deleted_count:
                counts[coll] = r.deleted_count
        except Exception:
            pass

    # Clinic-scoped audit rows (platform SA audit for this delete is written before purge).
    r = await db.audit_logs.delete_many({"clinic_id": clinic_id})
    if r.deleted_count:
        counts["audit_logs"] = r.deleted_count

    r = await db.clinics.delete_one({"id": clinic_id})
    counts["clinics"] = r.deleted_count
    return counts
