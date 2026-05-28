"""Super Admin / Platform endpoints for ClinicOS.

Mounted onto the main /api router via register_superadmin().
All endpoints here require platform_admin = True in the auth payload
(only the env-credentialed login can grant this).
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel


# ---------------- Models ----------------
class SubscriptionUpdateIn(BaseModel):
    plan: Optional[str] = None       # 'starter' | 'clinic' | 'complete'
    status: Optional[str] = None     # 'trial' | 'active' | 'suspended' | 'expired' | 'cancelled'
    extend_days: Optional[int] = None  # extends current expiry_date (or trial_end) by N days
    expiry_date: Optional[str] = None  # explicit ISO override


class AnnouncementIn(BaseModel):
    title: str
    body: str
    severity: str = "info"   # info | warning | success
    audience: str = "all"    # all | trial | active | expired
    active: bool = True


# ---------------- Helpers ----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def require_platform_admin(get_current_user):
    async def checker(user: dict = Depends(get_current_user)):
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")
        return user
    return checker


# ---------------- Public router builder ----------------
def register_superadmin(api: APIRouter, db, get_current_user, audit, public_clinic_view, PLAN_CATALOG, STORAGE_URL, init_storage, put_object, APP_NAME, scope):
    """Wire super admin endpoints onto the /api router."""

    admin_dep = require_platform_admin(get_current_user)

    # ---------- Dashboard ----------
    @api.get("/superadmin/dashboard")
    async def sa_dashboard(_user: dict = Depends(admin_dep)):
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

    # ---------- Clinics ----------
    @api.get("/superadmin/clinics")
    async def sa_list_clinics(q: Optional[str] = None, status: Optional[str] = None, plan: Optional[str] = None, _user: dict = Depends(admin_dep)):
        flt: Dict[str, Any] = {}
        if status:
            flt["subscription.status"] = status
        if plan:
            flt["subscription.plan"] = plan
        if q:
            flt["$or"] = [
                {"name": {"$regex": q, "$options": "i"}},
                {"owner_email": {"$regex": q, "$options": "i"}},
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

    @api.get("/superadmin/clinics/{cid}")
    async def sa_get_clinic(cid: str, _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        users = await db.users.find({"clinic_id": cid}, {"_id": 0, "password_hash": 0}).to_list(200)
        recent_payments = await db.payment_requests.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
        return {
            **public_clinic_view(c),
            "staff_count": len(users),
            "users": users,
            "patient_count": await db.patients.count_documents({"clinic_id": cid}),
            "visit_count": await db.visits.count_documents({"clinic_id": cid}),
            "booking_count": await db.bookings.count_documents({"clinic_id": cid}),
            "recent_payments": recent_payments,
        }

    @api.put("/superadmin/clinics/{cid}/subscription")
    async def sa_update_subscription(cid: str, payload: SubscriptionUpdateIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        if payload.plan:
            if payload.plan not in PLAN_CATALOG:
                raise HTTPException(status_code=400, detail="Unknown plan")
            sub["plan"] = payload.plan
        if payload.status:
            if payload.status not in ("trial", "active", "suspended", "expired", "cancelled"):
                raise HTTPException(status_code=400, detail="Invalid status")
            sub["status"] = payload.status
            if payload.status == "active" and not sub.get("expiry_date"):
                sub["expiry_date"] = iso(now_utc() + timedelta(days=30))
        if payload.extend_days:
            # extend whichever date field is in use
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

        await db.clinics.update_one({"id": cid}, {"$set": {"subscription": sub}})
        await audit({"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid}, "subscription_update", "clinic", cid, payload.model_dump(exclude_none=True))
        c2 = await db.clinics.find_one({"id": cid}, {"_id": 0})
        return public_clinic_view(c2)

    @api.delete("/superadmin/clinics/{cid}")
    async def sa_delete_clinic(cid: str, user: dict = Depends(admin_dep)):
        # Soft-cancel rather than hard delete to preserve data
        r = await db.clinics.update_one({"id": cid}, {"$set": {"subscription.status": "cancelled", "cancelled_at": iso(now_utc())}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Clinic not found")
        await audit({"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid}, "cancel", "clinic", cid)
        return {"ok": True}

    # ---------- Payment Verification Queue ----------
    @api.get("/superadmin/payments")
    async def sa_list_payments(status: Optional[str] = None, _user: dict = Depends(admin_dep)):
        flt = {}
        if status:
            flt["status"] = status
        rows = await db.payment_requests.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        # Augment with clinic name
        for r in rows:
            c = await db.clinics.find_one({"id": r.get("clinic_id")}, {"_id": 0, "name": 1, "slug": 1, "owner_email": 1})
            if c:
                r["clinic_name"] = c["name"]
                r["clinic_slug"] = c["slug"]
                r["owner_email"] = c.get("owner_email")
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
        sub["expiry_date"] = iso(base_dt + timedelta(days=30))
        sub["started_at"] = sub.get("started_at") or iso(now_utc())
        await db.clinics.update_one({"id": cid}, {"$set": {"subscription": sub}})
        await db.payment_requests.update_one({"id": pid}, {"$set": {
            "status": "verified", "verified_at": iso(now_utc()), "verified_by": user["email"],
        }})
        await audit({"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid}, "verify_payment", "payment_request", pid, {"plan": plan})
        return await db.payment_requests.find_one({"id": pid}, {"_id": 0})

    @api.post("/superadmin/payments/{pid}/reject")
    async def sa_reject_payment(pid: str, user: dict = Depends(admin_dep)):
        r = await db.payment_requests.update_one({"id": pid}, {"$set": {
            "status": "rejected", "verified_at": iso(now_utc()), "verified_by": user["email"],
        }})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Payment request not found")
        await audit({"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None}, "reject_payment", "payment_request", pid)
        return await db.payment_requests.find_one({"id": pid}, {"_id": 0})

    # ---------- Clinic-side: create a payment request (auth, owner) ----------
    @api.post("/billing/payment-request")
    async def create_payment_request(
        plan: str = Form(...),
        amount: int = Form(...),
        unique_code: int = Form(...),
        file: Optional[UploadFile] = File(None),
        user: dict = Depends(get_current_user),
    ):
        if user.get("platform_admin") or user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Only clinic owner can submit payment")
        if plan not in PLAN_CATALOG:
            raise HTTPException(status_code=400, detail="Unknown plan")
        proof_path = ""
        if file is not None:
            ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "webp", "pdf"):
                raise HTTPException(status_code=400, detail="Unsupported proof format")
            pid_obj = str(uuid.uuid4())
            path = f"{APP_NAME}/payments/{user.get('clinic_id')}/{pid_obj}.{ext}"
            data = await file.read()
            ct = file.content_type or ("application/pdf" if ext == "pdf" else f"image/{ext}")
            result = put_object(path, data, ct)
            proof_path = result["path"]
            # Branding flag so it's served publicly for super-admin display? Keep auth.
            await db.photos.insert_one({
                "id": pid_obj,
                "visit_id": "",
                "patient_id": "",
                "clinic_id": user.get("clinic_id"),
                "storage_path": result["path"],
                "photo_type": "payment_proof",
                "angle": "proof",
                "content_type": ct,
                "uploaded_by": user["id"],
                "created_at": iso(now_utc()),
            })
        req_id = str(uuid.uuid4())
        req = {
            "id": req_id,
            "clinic_id": user.get("clinic_id"),
            "plan": plan,
            "amount_idr": amount,
            "unique_code": unique_code,
            "proof_path": proof_path,
            "status": "submitted",
            "created_at": iso(now_utc()),
            "submitted_by": user["email"],
        }
        await db.payment_requests.insert_one(req)
        await audit(user, "submit", "payment_request", req_id, {"plan": plan, "amount": amount})
        return {"id": req_id, "status": "submitted"}

    # ---------- Announcements ----------
    @api.get("/superadmin/announcements")
    async def sa_list_announcements(_user: dict = Depends(admin_dep)):
        rows = await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return rows

    @api.post("/superadmin/announcements")
    async def sa_create_announcement(payload: AnnouncementIn, user: dict = Depends(admin_dep)):
        ann = {**payload.model_dump(), "id": str(uuid.uuid4()), "created_at": iso(now_utc()), "created_by": user["email"]}
        await db.announcements.insert_one(ann)
        ann.pop("_id", None)
        return ann

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
            return None
        ann = await db.announcements.find_one({"active": True}, {"_id": 0}, sort=[("created_at", -1)])
        return ann
