"""Phase 4: commercial readiness — onboarding checklist, clinic notifications, usage alerts, demo reset."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from saas import iso, now_utc, TRIAL_DAYS

LIFECYCLE_TYPES = frozenset({
    "trial_started", "trial_ending", "trial_expired", "payment_submitted",
    "payment_approved", "payment_rejected", "renewed", "past_due", "suspended", "reactivated",
})


def compute_usage_alerts(usage: dict, limits: dict) -> List[dict]:
    """Return tenant-facing usage alerts at 80%, 95%, and 100% thresholds."""
    alerts: List[dict] = []
    max_staff = int(limits.get("max_staff") or 3)
    max_storage = float(limits.get("storage_gb") or 2)
    staff = int(usage.get("staff_count") or 0)
    storage = float(usage.get("storage_used_gb") or 0)

    if max_staff < 9999:
        pct = (staff / max_staff * 100) if max_staff else 0
        for threshold, level in ((100, "critical"), (95, "critical"), (80, "warning")):
            if pct >= threshold:
                alerts.append({
                    "metric": "staff",
                    "level": level,
                    "used": staff,
                    "limit": max_staff,
                    "percent": round(pct, 1),
                    "message": f"Staff accounts at {round(pct)}% of plan limit ({staff}/{max_staff})",
                    "link": "/billing/plans",
                })
                break

    if max_storage > 0:
        pct = storage / max_storage * 100
        for threshold, level in ((100, "critical"), (95, "critical"), (80, "warning")):
            if pct >= threshold:
                alerts.append({
                    "metric": "storage",
                    "level": level,
                    "used": storage,
                    "limit": max_storage,
                    "percent": round(pct, 1),
                    "message": f"Storage at {round(pct)}% of plan limit ({storage} GB / {max_storage} GB)",
                    "link": "/billing/plans",
                })
                break
    return alerts


async def create_clinic_notification(
    db,
    *,
    clinic_id: str,
    ntype: str,
    title: str,
    body: str,
    link: Optional[str] = None,
    meta: Optional[dict] = None,
    dedupe_hours: int = 72,
) -> Optional[str]:
    """Insert a clinic-scoped notification if no duplicate of same type within dedupe window."""
    if dedupe_hours > 0:
        since = iso(now_utc() - timedelta(hours=dedupe_hours))
        existing = await db.clinic_notifications.find_one({
            "clinic_id": clinic_id,
            "type": ntype,
            "created_at": {"$gte": since},
        })
        if existing:
            return existing.get("id")
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "type": ntype,
        "title": title,
        "body": body,
        "link": link or "/billing/plans",
        "meta": meta or {},
        "read_at": None,
        "created_at": iso(now_utc()),
    }
    await db.clinic_notifications.insert_one(doc)
    return doc["id"]


async def build_onboarding_checklist(db, clinic: dict) -> dict:
    cid = clinic["id"]
    staff_count = await db.users.count_documents({"clinic_id": cid})
    treatment_count = await db.treatments.count_documents({"clinic_id": cid})
    patient_count = await db.patients.count_documents({"clinic_id": cid})
    visit_count = await db.visits.count_documents({"clinic_id": cid})
    schedule_count = await db.weekly_staff_schedules.count_documents(
        {"clinic_id": cid, "is_working": True},
    )
    booking_count = await db.bookings.count_documents({
        "clinic_id": cid,
        "$nor": [{"status": "blocked"}, {"booking_type": "block"}],
    })
    invoice_count = await db.invoices.count_documents({"clinic_id": cid})

    profile_done = bool(
        (clinic.get("name") or "").strip()
        and (clinic.get("address") or "").strip()
        and (clinic.get("phone") or "").strip()
    )

    items = [
        {
            "id": "clinic_profile",
            "label": "Add clinic profile",
            "link": "/onboarding",
            "done": profile_done,
        },
        {
            "id": "first_staff",
            "label": "Add first staff member",
            "link": "/staff/directory",
            "done": staff_count > 1,
        },
        {
            "id": "first_treatment",
            "label": "Add first treatment",
            "link": "/treatments",
            "done": treatment_count > 0,
        },
        {
            "id": "staff_schedule",
            "label": "Set staff schedule",
            "link": "/staff/schedule",
            "done": schedule_count > 0,
        },
        {
            "id": "first_patient",
            "label": "Add first patient",
            "link": "/patients",
            "done": patient_count > 0,
        },
        {
            "id": "first_booking",
            "label": "Create first appointment",
            "link": "/bookings",
            "done": booking_count > 0,
        },
        {
            "id": "first_visit",
            "label": "Start first treatment session",
            "link": "/visits",
            "done": visit_count > 0,
        },
        {
            "id": "first_invoice",
            "label": "Create first invoice",
            "link": "/invoices",
            "done": invoice_count > 0,
        },
    ]
    done_count = sum(1 for i in items if i["done"])
    total = len(items)
    return {
        "items": items,
        "completed": done_count,
        "total": total,
        "percent": round(100 * done_count / total) if total else 0,
        "complete": done_count == total,
    }


async def sync_billing_lifecycle_notifications(db, clinic: dict) -> None:
    """Ensure in-app lifecycle notifications exist for current subscription state."""
    sub = clinic.get("subscription") or {}
    status = sub.get("status", "trial")
    cid = clinic["id"]
    link = "/billing/plans"

    if status == "trial":
        trial_end = sub.get("trial_end")
        if trial_end:
            try:
                end = datetime.fromisoformat(trial_end.replace("Z", "+00:00") if isinstance(trial_end, str) else trial_end)
                days = (end - now_utc()).days
                if days <= 0:
                    await create_clinic_notification(
                        db, clinic_id=cid, ntype="trial_expired",
                        title="Your free trial has ended",
                        body="Choose a plan to restore full access to your clinic.",
                        link=link, dedupe_hours=168,
                    )
                elif days <= 7:
                    await create_clinic_notification(
                        db, clinic_id=cid, ntype="trial_ending",
                        title=f"Trial ending in {days} day{'s' if days != 1 else ''}",
                        body="Upgrade now to keep your data and avoid interruption.",
                        link=link, dedupe_hours=24,
                    )
            except Exception:
                pass
    elif status == "past_due":
        await create_clinic_notification(
            db, clinic_id=cid, ntype="past_due",
            title="Payment overdue",
            body="Your subscription is past due. Renew to avoid losing access.",
            link=link, dedupe_hours=48,
        )
    elif status == "suspended":
        await create_clinic_notification(
            db, clinic_id=cid, ntype="suspended",
            title="Account suspended",
            body="Contact support or renew your plan to reactivate your clinic.",
            link=link, dedupe_hours=168,
        )
    elif status == "expired":
        await create_clinic_notification(
            db, clinic_id=cid, ntype="trial_expired",
            title="Subscription expired",
            body="Choose a plan to continue using ClinicOS.",
            link=link, dedupe_hours=168,
        )
    elif status == "active" and sub.get("expiry_date"):
        try:
            exp = datetime.fromisoformat(sub["expiry_date"])
            days = (exp - now_utc()).days
            if 0 < days <= 7:
                await create_clinic_notification(
                    db, clinic_id=cid, ntype="renewed",
                    title=f"Subscription renews in {days} day{'s' if days != 1 else ''}",
                    body="Renew early to avoid any interruption.",
                    link=link, dedupe_hours=24,
                )
        except Exception:
            pass


async def notify_trial_started(db, clinic: dict) -> None:
    await create_clinic_notification(
        db,
        clinic_id=clinic["id"],
        ntype="trial_started",
        title="Welcome to ClinicOS!",
        body=f"Your {TRIAL_DAYS}-day free trial has started. Complete the setup checklist to get the most from your clinic.",
        link="/",
        dedupe_hours=0,
    )


async def notify_payment_submitted(db, clinic_id: str, *, plan: str, amount_idr: int) -> None:
    await create_clinic_notification(
        db, clinic_id=clinic_id, ntype="payment_submitted",
        title="Payment proof submitted",
        body=f"We received your {plan} plan payment (Rp {amount_idr:,}). We'll verify within 1–2 business days.",
        link="/billing/plans", dedupe_hours=0,
    )


async def notify_payment_approved(db, clinic_id: str, *, plan: str) -> None:
    await create_clinic_notification(
        db, clinic_id=clinic_id, ntype="payment_approved",
        title="Payment approved",
        body=f"Your {plan} plan is now active. Thank you!",
        link="/billing/plans", dedupe_hours=0,
    )
    await create_clinic_notification(
        db, clinic_id=clinic_id, ntype="renewed",
        title="Subscription renewed",
        body=f"Your clinic is on the {plan} plan.",
        link="/billing/plans", dedupe_hours=0,
    )


async def notify_payment_rejected(db, clinic_id: str, *, reason: str = "") -> None:
    await create_clinic_notification(
        db, clinic_id=clinic_id, ntype="payment_rejected",
        title="Payment could not be verified",
        body=reason or "Please review your payment proof and submit again, or contact support.",
        link="/billing/plans", dedupe_hours=0,
    )


async def notify_reactivated(db, clinic_id: str) -> None:
    await create_clinic_notification(
        db, clinic_id=clinic_id, ntype="reactivated",
        title="Account reactivated",
        body="Your clinic account is active again.",
        link="/", dedupe_hours=0,
    )


async def list_clinic_notifications(db, clinic_id: str, limit: int = 50) -> dict:
    rows = await db.clinic_notifications.find(
        {"clinic_id": clinic_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    unread = sum(1 for r in rows if not r.get("read_at"))
    return {"notifications": rows, "unread_count": unread}


async def purge_clinic_tenant_data(
    db,
    clinic_id: str,
    *,
    init_storage=None,
    storage_url: str = "",
) -> Dict[str, int]:
    """Delete all tenant data but keep the clinic record and owner user(s)."""
    from platform_ops import _VISIT_LINKED_COLLECTIONS, _CLINIC_DATA_COLLECTIONS

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

    skip = {"clinics", "users"}
    for coll in _CLINIC_DATA_COLLECTIONS:
        if coll in skip:
            continue
        try:
            r = await db[coll].delete_many({"clinic_id": clinic_id})
            if r.deleted_count:
                counts[coll] = r.deleted_count
        except Exception:
            pass

    r = await db.audit_logs.delete_many({"clinic_id": clinic_id})
    if r.deleted_count:
        counts["audit_logs"] = r.deleted_count
    r = await db.clinic_notifications.delete_many({"clinic_id": clinic_id})
    if r.deleted_count:
        counts["clinic_notifications"] = r.deleted_count
    return counts


class DemoResetIn(BaseModel):
    confirm_slug: str
    reason: str


def register_commercial(
    api: APIRouter,
    db,
    get_current_user,
    get_active_clinic,
    audit,
    require_permission,
    *,
    DEFAULT_SETTINGS=None,
    seed_clinic_settings=None,
    init_storage=None,
    STORAGE_URL: str = "",
):
    async def subscribe_dep(user: dict = Depends(require_permission("billing.subscribe", skip_operational_check=True))):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Clinic account required")
        return user

    async def owner_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Clinic account required")
        if user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Owner or manager only")
        return user

    @api.get("/clinic/notifications")
    async def clinic_notifications(user: dict = Depends(get_current_user)):
        if user.get("platform_admin") or not user.get("clinic_id"):
            return {"notifications": [], "unread_count": 0}
        return await list_clinic_notifications(db, user["clinic_id"])

    @api.post("/clinic/notifications/{nid}/read")
    async def clinic_notification_read(nid: str, user: dict = Depends(get_current_user)):
        if not user.get("clinic_id"):
            raise HTTPException(status_code=400, detail="No clinic")
        r = await db.clinic_notifications.update_one(
            {"id": nid, "clinic_id": user["clinic_id"]},
            {"$set": {"read_at": iso(now_utc())}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"ok": True}

    @api.post("/clinic/notifications/read-all")
    async def clinic_notifications_read_all(user: dict = Depends(get_current_user)):
        if not user.get("clinic_id"):
            raise HTTPException(status_code=400, detail="No clinic")
        await db.clinic_notifications.update_many(
            {"clinic_id": user["clinic_id"], "read_at": None},
            {"$set": {"read_at": iso(now_utc())}},
        )
        return {"ok": True}

    @api.get("/clinic/onboarding-checklist")
    async def clinic_onboarding_checklist(user: dict = Depends(owner_dep)):
        c = await get_active_clinic(user)
        return await build_onboarding_checklist(db, c)

    @api.get("/clinic/support-diagnostics")
    async def clinic_support_diagnostics(user: dict = Depends(get_current_user)):
        if user.get("platform_admin") or not user.get("clinic_id"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        c = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0, "name": 1, "slug": 1, "subscription": 1})
        sub = (c or {}).get("subscription") or {}
        return {
            "clinic_id": user.get("clinic_id"),
            "clinic_name": (c or {}).get("name"),
            "slug": (c or {}).get("slug"),
            "plan": sub.get("plan"),
            "status": sub.get("status"),
            "user_email": user.get("email"),
            "user_role": user.get("role"),
            "app_version": "ClinicOS",
        }

    @api.get("/billing/payment-requests")
    async def clinic_payment_requests(user: dict = Depends(subscribe_dep)):
        cid = user.get("clinic_id")
        rows = await db.payment_requests.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
        return rows

    @api.post("/superadmin/clinics/{cid}/reset-demo")
    async def sa_reset_demo_clinic(cid: str, payload: DemoResetIn, user: dict = Depends(get_current_user)):
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        if not c.get("is_test_clinic"):
            raise HTTPException(status_code=400, detail="Demo reset is only available for test/demo clinics")
        if payload.confirm_slug.strip() != c.get("slug"):
            raise HTTPException(status_code=400, detail="Slug confirmation does not match")

        counts = await purge_clinic_tenant_data(db, cid, init_storage=init_storage, storage_url=STORAGE_URL)
        now = iso(now_utc())
        await db.clinics.update_one({"id": cid}, {"$set": {
            "onboarded": False,
            "logo_path": "",
            "subscription": {
                "plan": "trial",
                "status": "trial",
                "trial_end": iso(now_utc() + timedelta(days=TRIAL_DAYS)),
                "expiry_date": None,
                "started_at": now,
            },
        }})
        if seed_clinic_settings and DEFAULT_SETTINGS:
            await seed_clinic_settings(db, cid, c.get("name", "Clinic"), DEFAULT_SETTINGS, c.get("template_preset") or "default")

        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid, "name": "Platform Admin"},
            "demo_clinic_reset",
            "clinic",
            cid,
            meta={"clinic_name": c.get("name"), "slug": c.get("slug"), "purged_counts": counts},
            reason=reason,
        )
        updated = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return {"ok": True, "purged": counts, "clinic": updated}
