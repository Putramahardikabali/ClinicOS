"""Phase 5: Customer lifecycle & growth ops — pipeline, follow-ups, templates, health score."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from commercial import build_onboarding_checklist
from saas import (
    BILLING_CYCLES,
    PLAN_CATALOG,
    compute_plan_charge,
    iso,
    now_utc,
    refresh_subscription_state,
)

PIPELINE_STATUSES = frozenset({
    "new_signup",
    "trial_active",
    "setup_incomplete",
    "active_trial",
    "trial_ending_soon",
    "payment_pending",
    "paid_customer",
    "past_due",
    "churn_risk",
    "cancelled",
})

FOLLOW_UP_TYPES = frozenset({"whatsapp", "email", "call", "demo", "internal"})
TEMPLATE_CHANNELS = frozenset({"whatsapp", "email"})
TEMPLATE_VARIABLES = frozenset({
    "clinic_name", "owner_name", "trial_end_date", "plan_name",
    "amount_due", "payment_link", "support_whatsapp",
})

CHURN_REASONS = frozenset({
    "price_too_high",
    "not_using",
    "switched_competitor",
    "missing_features",
    "business_closed",
    "other",
})

HEALTH_LABELS = (
    (75, "Ready to convert"),
    (50, "Active"),
    (25, "Needs help"),
    (0, "Cold"),
)


def health_label(score: int) -> str:
    for threshold, label in HEALTH_LABELS:
        if score >= threshold:
            return label
    return "Cold"


def compute_trial_health_score(
    *,
    checklist_percent: int,
    staff_count: int,
    treatment_count: int,
    booking_count: int,
    invoice_count: int,
    has_public_booking: bool,
    last_activity_at: Optional[str],
) -> dict:
    """0–100 score from onboarding + product usage signals."""
    score = 0
    score += int(round(checklist_percent * 0.35))
    if staff_count > 1:
        score += 10
    if treatment_count > 0:
        score += 10
    if booking_count > 0:
        score += 15
    if invoice_count > 0:
        score += 10
    if has_public_booking:
        score += 10
    if last_activity_at:
        try:
            la = datetime.fromisoformat(last_activity_at.replace("Z", "+00:00"))
            days = (now_utc() - la).days
            if days <= 3:
                score += 10
            elif days <= 7:
                score += 7
            elif days <= 14:
                score += 4
        except Exception:
            pass
    score = max(0, min(100, score))
    return {"score": score, "label": health_label(score)}


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _trial_days_left(sub: dict) -> Optional[int]:
    trial_end = sub.get("trial_end")
    if not trial_end:
        return None
    end = _parse_dt(trial_end)
    if not end:
        return None
    return (end - now_utc()).days


def _is_churn_risk(
    *,
    sub_status: str,
    health_score: int,
    trial_days: Optional[int],
    last_activity_at: Optional[str],
    setup_percent: int,
) -> bool:
    if sub_status in ("cancelled", "archived", "past_due"):
        return False
    if sub_status == "trial" and trial_days is not None and trial_days <= 7 and health_score < 40:
        return True
    if sub_status == "active" and health_score < 25:
        return True
    la = _parse_dt(last_activity_at)
    if la:
        inactive_days = (now_utc() - la).days
        if sub_status == "active" and inactive_days >= 30:
            return True
        if sub_status == "trial" and inactive_days >= 14 and setup_percent < 50:
            return True
    return False


def classify_pipeline_status(
    *,
    clinic: dict,
    sub_status: str,
    sub_plan: str,
    has_pending_payment: bool,
    checklist_percent: int,
    health_score: int,
    last_activity_at: Optional[str],
) -> str:
    if sub_status in ("cancelled", "archived"):
        return "cancelled"
    if sub_status == "past_due":
        return "past_due"
    if has_pending_payment:
        return "payment_pending"
    if sub_status == "active" and sub_plan in PLAN_CATALOG:
        if _is_churn_risk(
            sub_status=sub_status,
            health_score=health_score,
            trial_days=None,
            last_activity_at=last_activity_at,
            setup_percent=checklist_percent,
        ):
            return "churn_risk"
        return "paid_customer"
    if sub_status == "trial":
        trial_days = _trial_days_left(clinic.get("subscription") or {})
        if trial_days is not None and trial_days <= 7:
            return "trial_ending_soon"
        if _is_churn_risk(
            sub_status=sub_status,
            health_score=health_score,
            trial_days=trial_days,
            last_activity_at=last_activity_at,
            setup_percent=checklist_percent,
        ):
            return "churn_risk"
        created = _parse_dt(clinic.get("created_at"))
        if created and (now_utc() - created).total_seconds() < 48 * 3600:
            return "new_signup"
        if checklist_percent < 50:
            return "setup_incomplete"
        if health_score >= 50:
            return "active_trial"
        return "trial_active"
    if sub_status in ("suspended", "expired"):
        return "churn_risk"
    return "trial_active"


async def _clinic_last_activity(db, clinic_id: str) -> Optional[str]:
    """Best-effort last tenant activity timestamp."""
    candidates: List[str] = []
    for coll, field in (
        ("bookings", "updated_at"),
        ("bookings", "created_at"),
        ("visits", "created_at"),
        ("invoices", "created_at"),
        ("patients", "created_at"),
        ("audit_logs", "created_at"),
    ):
        row = await db[coll].find_one(
            {"clinic_id": clinic_id},
            {"_id": 0, field: 1},
            sort=[(field, -1)],
        )
        if row and row.get(field):
            candidates.append(row[field])
    owner = await db.users.find_one(
        {"clinic_id": clinic_id, "role": "super_admin"},
        {"_id": 0, "last_login_at": 1},
    )
    if owner and owner.get("last_login_at"):
        candidates.append(owner["last_login_at"])
    if not candidates:
        return None
    return max(candidates)


async def _owner_info(db, clinic: dict) -> dict:
    owner_email = clinic.get("owner_email") or clinic.get("email")
    owner = await db.users.find_one(
        {"clinic_id": clinic["id"], "role": "super_admin"},
        {"_id": 0, "name": 1, "email": 1, "phone": 1},
    )
    if not owner and owner_email:
        owner = await db.users.find_one(
            {"email": owner_email.lower()},
            {"_id": 0, "name": 1, "email": 1, "phone": 1},
        )
    return {
        "owner_name": (owner or {}).get("name") or clinic.get("owner_name") or "—",
        "owner_email": (owner or {}).get("email") or owner_email or "—",
        "whatsapp": clinic.get("phone") or (owner or {}).get("phone") or "",
    }


async def build_pipeline_row(
    db,
    clinic: dict,
    *,
    pending_payment: Optional[dict] = None,
    next_follow_up: Optional[str] = None,
) -> dict:
    c, _ = refresh_subscription_state(clinic)
    sub = c.get("subscription") or {}
    cid = c["id"]
    checklist = await build_onboarding_checklist(db, c)
    staff_count = await db.users.count_documents({"clinic_id": cid})
    treatment_count = await db.treatments.count_documents({"clinic_id": cid})
    booking_count = await db.bookings.count_documents({"clinic_id": cid})
    invoice_count = await db.invoices.count_documents({"clinic_id": cid})
    last_activity = await _clinic_last_activity(db, cid)
    health = compute_trial_health_score(
        checklist_percent=checklist["percent"],
        staff_count=staff_count,
        treatment_count=treatment_count,
        booking_count=booking_count,
        invoice_count=invoice_count,
        has_public_booking=bool(c.get("slug")),
        last_activity_at=last_activity,
    )
    if pending_payment is None:
        pending_payment = await db.payment_requests.find_one(
            {"clinic_id": cid, "status": "submitted"},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
    if next_follow_up is None:
        note = await db.follow_up_notes.find_one(
            {"clinic_id": cid, "next_follow_up_date": {"$ne": None}},
            {"_id": 0, "next_follow_up_date": 1},
            sort=[("next_follow_up_date", 1)],
        )
        next_follow_up = (note or {}).get("next_follow_up_date")
    owner = await _owner_info(db, c)
    sub_status = sub.get("status", "trial")
    sub_plan = sub.get("plan", "trial")
    pipeline_status = classify_pipeline_status(
        clinic=c,
        sub_status=sub_status,
        sub_plan=sub_plan,
        has_pending_payment=bool(pending_payment),
        checklist_percent=checklist["percent"],
        health_score=health["score"],
        last_activity_at=last_activity,
    )
    payment_status = "none"
    if pending_payment:
        payment_status = pending_payment.get("status", "submitted")
    elif sub_status == "active":
        payment_status = "paid"
    elif sub_status == "past_due":
        payment_status = "past_due"
    return {
        "clinic_id": cid,
        "clinic_name": c.get("name"),
        "slug": c.get("slug"),
        "owner_name": owner["owner_name"],
        "owner_email": owner["owner_email"],
        "whatsapp": owner["whatsapp"],
        "plan": sub_plan,
        "subscription_status": sub_status,
        "trial_start": sub.get("started_at"),
        "trial_end": sub.get("trial_end"),
        "trial_days_left": _trial_days_left(sub),
        "setup_progress": checklist["percent"],
        "setup_complete": checklist["complete"],
        "last_activity_at": last_activity,
        "payment_status": payment_status,
        "pipeline_status": pipeline_status,
        "next_follow_up_date": next_follow_up,
        "health_score": health["score"],
        "health_label": health["label"],
        "created_at": c.get("created_at"),
    }


def render_template(body: str, variables: dict) -> str:
    out = body
    for key, val in variables.items():
        out = out.replace(f"{{{{{key}}}}}", str(val or ""))
    return out


def _extract_template_vars(body: str) -> List[str]:
    return sorted(set(re.findall(r"\{\{(\w+)\}\}", body)))


# ---------------- Models ----------------
class FollowUpNoteIn(BaseModel):
    note_type: str = Field(..., alias="type")
    content: str
    next_follow_up_date: Optional[str] = None

    class Config:
        populate_by_name = True


class MessageTemplateIn(BaseModel):
    name: str
    channel: str
    subject: Optional[str] = None
    body: str


class MessageTemplateUpdateIn(BaseModel):
    name: Optional[str] = None
    channel: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class TemplateRenderIn(BaseModel):
    clinic_id: str
    variables: Optional[dict] = None


class PlanChangeRequestIn(BaseModel):
    requested_plan: str
    billing_cycle: str = "monthly"
    note: Optional[str] = None


class PlanChangeDecisionIn(BaseModel):
    reason: Optional[str] = None


class CancelClinicIn(BaseModel):
    churn_reason: str
    churn_note: str
    reason: Optional[str] = None


def register_customer_lifecycle(
    api: APIRouter,
    db,
    get_current_user,
    audit,
    require_permission,
    require_platform_admin,
    PLAN_CATALOG: dict,
    SUPPORT_WHATSAPP: str = "",
    public_clinic_view=None,
    sa_update_subscription=None,
):
    """Wire Phase 5 customer lifecycle endpoints."""

    admin_dep = require_platform_admin(get_current_user)

    async def subscribe_dep(user: dict = Depends(require_permission("billing.subscribe", skip_operational_check=True))):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Clinic account required")
        return user

    async def owner_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Clinic owners only")
        if user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Owner or manager only")
        return user

    # ---------- Pipeline ----------
    @api.get("/superadmin/pipeline")
    async def sa_pipeline_list(
        status: Optional[str] = None,
        q: Optional[str] = None,
        overdue_follow_up: bool = False,
        _user: dict = Depends(admin_dep),
    ):
        clinics = await db.clinics.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        rows = []
        today = iso(now_utc())[:10]
        for c in clinics:
            if q:
                ql = q.lower()
                if ql not in (c.get("name") or "").lower() and ql not in (c.get("owner_email") or c.get("email") or "").lower():
                    if ql not in (c.get("slug") or "").lower():
                        continue
            row = await build_pipeline_row(db, c)
            if status and row["pipeline_status"] != status:
                continue
            if overdue_follow_up:
                nfd = row.get("next_follow_up_date")
                if not nfd or nfd[:10] >= today:
                    continue
            rows.append(row)
        return {"items": rows, "total": len(rows)}

    @api.get("/superadmin/pipeline/{cid}")
    async def sa_pipeline_detail(cid: str, _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        row = await build_pipeline_row(db, c)
        notes = await db.follow_up_notes.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        pending = await db.plan_change_requests.find(
            {"clinic_id": cid}, {"_id": 0},
        ).sort("created_at", -1).to_list(20)
        return {"pipeline": row, "follow_up_notes": notes, "plan_change_requests": pending}

    # ---------- Follow-up notes ----------
    @api.get("/superadmin/clinics/{cid}/follow-ups")
    async def sa_list_follow_ups(cid: str, _user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        rows = await db.follow_up_notes.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return rows

    @api.post("/superadmin/clinics/{cid}/follow-ups")
    async def sa_add_follow_up(cid: str, payload: FollowUpNoteIn, user: dict = Depends(admin_dep)):
        c = await db.clinics.find_one({"id": cid}, {"_id": 0, "id": 1, "name": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        ntype = (payload.note_type or "").strip().lower()
        if ntype not in FOLLOW_UP_TYPES:
            raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(sorted(FOLLOW_UP_TYPES))}")
        content = (payload.content or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="content is required")
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "type": ntype,
            "content": content,
            "next_follow_up_date": payload.next_follow_up_date,
            "created_at": iso(now_utc()),
            "created_by": user.get("email"),
        }
        await db.follow_up_notes.insert_one(doc)
        doc.pop("_id", None)
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "follow_up_note_added",
            "clinic",
            doc["id"],
            meta={"clinic_name": c.get("name"), "type": ntype},
        )
        return doc

    # ---------- Message templates ----------
    @api.get("/superadmin/message-templates")
    async def sa_list_templates(_user: dict = Depends(admin_dep)):
        rows = await db.message_templates.find({}, {"_id": 0}).sort("name", 1).to_list(200)
        return {"items": rows, "variables": sorted(TEMPLATE_VARIABLES)}

    @api.post("/superadmin/message-templates")
    async def sa_create_template(payload: MessageTemplateIn, user: dict = Depends(admin_dep)):
        channel = (payload.channel or "").strip().lower()
        if channel not in TEMPLATE_CHANNELS:
            raise HTTPException(status_code=400, detail=f"channel must be whatsapp or email")
        body = (payload.body or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="body is required")
        unknown = set(_extract_template_vars(body)) - TEMPLATE_VARIABLES
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown variables: {', '.join(sorted(unknown))}")
        doc = {
            "id": str(uuid.uuid4()),
            "name": payload.name.strip(),
            "channel": channel,
            "subject": (payload.subject or "").strip() or None,
            "body": body,
            "variables": _extract_template_vars(body),
            "created_at": iso(now_utc()),
            "updated_at": iso(now_utc()),
            "created_by": user.get("email"),
        }
        await db.message_templates.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put("/superadmin/message-templates/{tid}")
    async def sa_update_template(tid: str, payload: MessageTemplateUpdateIn, _user: dict = Depends(admin_dep)):
        existing = await db.message_templates.find_one({"id": tid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")
        patch = {"updated_at": iso(now_utc())}
        if payload.name is not None:
            patch["name"] = payload.name.strip()
        if payload.channel is not None:
            ch = payload.channel.strip().lower()
            if ch not in TEMPLATE_CHANNELS:
                raise HTTPException(status_code=400, detail="Invalid channel")
            patch["channel"] = ch
        if payload.subject is not None:
            patch["subject"] = payload.subject.strip() or None
        if payload.body is not None:
            body = payload.body.strip()
            unknown = set(_extract_template_vars(body)) - TEMPLATE_VARIABLES
            if unknown:
                raise HTTPException(status_code=400, detail=f"Unknown variables: {', '.join(sorted(unknown))}")
            patch["body"] = body
            patch["variables"] = _extract_template_vars(body)
        await db.message_templates.update_one({"id": tid}, {"$set": patch})
        return await db.message_templates.find_one({"id": tid}, {"_id": 0})

    @api.delete("/superadmin/message-templates/{tid}")
    async def sa_delete_template(tid: str, _user: dict = Depends(admin_dep)):
        r = await db.message_templates.delete_one({"id": tid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"ok": True}

    @api.post("/superadmin/message-templates/{tid}/render")
    async def sa_render_template(tid: str, payload: TemplateRenderIn, _user: dict = Depends(admin_dep)):
        tpl = await db.message_templates.find_one({"id": tid}, {"_id": 0})
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")
        c = await db.clinics.find_one({"id": payload.clinic_id}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        owner = await _owner_info(db, c)
        sub = c.get("subscription") or {}
        plan_key = sub.get("plan", "trial")
        plan_name = PLAN_CATALOG.get(plan_key, {}).get("name", plan_key.title())
        cycle = sub.get("billing_cycle") or "monthly"
        amount = 0
        if plan_key in PLAN_CATALOG:
            amount = compute_plan_charge(PLAN_CATALOG[plan_key]["price_idr"], cycle)
        defaults = {
            "clinic_name": c.get("name", ""),
            "owner_name": owner["owner_name"],
            "trial_end_date": (sub.get("trial_end") or "")[:10],
            "plan_name": plan_name,
            "amount_due": f"Rp {amount:,}".replace(",", "."),
            "payment_link": "/billing/plans",
            "support_whatsapp": SUPPORT_WHATSAPP,
        }
        merged = {**defaults, **(payload.variables or {})}
        return {
            "channel": tpl["channel"],
            "subject": render_template(tpl.get("subject") or "", merged) if tpl.get("subject") else None,
            "body": render_template(tpl["body"], merged),
            "copy_only": True,
        }

    # ---------- Commercial dashboard ----------
    @api.get("/superadmin/commercial/dashboard")
    async def sa_commercial_dashboard(_user: dict = Depends(admin_dep)):
        clinics = await db.clinics.find({}, {"_id": 0}).to_list(2000)
        kpis = {
            "new_trials_7d": 0,
            "active_trials": 0,
            "trials_ending_soon": 0,
            "paid_clinics": 0,
            "payment_pending": 0,
            "past_due": 0,
            "churn_risk": 0,
            "estimated_mrr_idr": 0,
        }
        funnel = {
            "signup": 0,
            "setup_complete": 0,
            "first_booking": 0,
            "payment_submitted": 0,
            "paid": 0,
        }
        seven = now_utc() - timedelta(days=7)
        pipeline_counts: Dict[str, int] = {}
        for c in clinics:
            row = await build_pipeline_row(db, c)
            ps = row["pipeline_status"]
            pipeline_counts[ps] = pipeline_counts.get(ps, 0) + 1
            sub = c.get("subscription") or {}
            if sub.get("status") == "trial":
                kpis["active_trials"] += 1
                td = row.get("trial_days_left")
                if td is not None and td <= 7:
                    kpis["trials_ending_soon"] += 1
            if sub.get("status") == "active" and sub.get("plan") in PLAN_CATALOG:
                kpis["paid_clinics"] += 1
                kpis["estimated_mrr_idr"] += PLAN_CATALOG[sub["plan"]]["price_idr"]
            if ps == "payment_pending":
                kpis["payment_pending"] += 1
            if ps == "past_due":
                kpis["past_due"] += 1
            if ps == "churn_risk":
                kpis["churn_risk"] += 1
            created = _parse_dt(c.get("created_at"))
            if created and created >= seven and sub.get("status") == "trial":
                kpis["new_trials_7d"] += 1
            funnel["signup"] += 1
            if row["setup_complete"]:
                funnel["setup_complete"] += 1
            if await db.bookings.count_documents({"clinic_id": c["id"]}) > 0:
                funnel["first_booking"] += 1
            if await db.payment_requests.count_documents({"clinic_id": c["id"], "status": {"$in": ["submitted", "verified"]}}) > 0:
                funnel["payment_submitted"] += 1
            if sub.get("status") == "active" and sub.get("plan") in PLAN_CATALOG:
                funnel["paid"] += 1
        return {
            "kpis": kpis,
            "funnel": funnel,
            "pipeline_counts": pipeline_counts,
            "pipeline_statuses": sorted(PIPELINE_STATUSES),
        }

    # ---------- Churn report ----------
    @api.get("/superadmin/churn-report")
    async def sa_churn_report(_user: dict = Depends(admin_dep)):
        flt = {
            "$or": [
                {"subscription.status": {"$in": ["cancelled", "archived"]}},
                {"churn_reason": {"$exists": True, "$ne": None}},
            ]
        }
        rows = await db.clinics.find(flt, {"_id": 0}).sort("churned_at", -1).to_list(500)
        items = []
        by_reason: Dict[str, int] = {}
        for c in rows:
            reason = c.get("churn_reason") or c.get("archived_reason") or "unknown"
            by_reason[reason] = by_reason.get(reason, 0) + 1
            sub = c.get("subscription") or {}
            owner = await _owner_info(db, c)
            items.append({
                "clinic_id": c["id"],
                "clinic_name": c.get("name"),
                "owner_email": owner["owner_email"],
                "plan": sub.get("plan"),
                "status": sub.get("status"),
                "churn_reason": c.get("churn_reason"),
                "churn_note": c.get("churn_note"),
                "churned_at": c.get("churned_at") or c.get("archived_at") or c.get("cancelled_at"),
            })
        return {"items": items, "by_reason": by_reason, "total": len(items)}

    # ---------- Plan change requests (clinic) ----------
    @api.post("/billing/plan-change-request")
    async def clinic_plan_change_request(payload: PlanChangeRequestIn, user: dict = Depends(subscribe_dep)):
        cid = user.get("clinic_id")
        if not cid:
            raise HTTPException(status_code=400, detail="No clinic context")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = c.get("subscription") or {}
        current = sub.get("plan", "trial")
        requested = payload.requested_plan.strip().lower()
        if requested not in PLAN_CATALOG:
            raise HTTPException(status_code=400, detail="Invalid plan")
        cycle = (payload.billing_cycle or "monthly").lower()
        if cycle not in BILLING_CYCLES:
            raise HTTPException(status_code=400, detail="Invalid billing cycle")
        if requested == current and sub.get("status") == "active":
            raise HTTPException(status_code=400, detail="Already on this plan")
        existing = await db.plan_change_requests.find_one(
            {"clinic_id": cid, "status": "pending"},
        )
        if existing:
            raise HTTPException(status_code=409, detail="A pending plan change request already exists")
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "clinic_name": c.get("name"),
            "current_plan": current,
            "requested_plan": requested,
            "billing_cycle": cycle,
            "note": (payload.note or "").strip() or None,
            "status": "pending",
            "requested_by": user.get("email"),
            "created_at": iso(now_utc()),
            "resolved_at": None,
            "resolved_by": None,
            "resolution_reason": None,
        }
        await db.plan_change_requests.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.get("/billing/plan-change-requests")
    async def clinic_list_plan_change_requests(user: dict = Depends(subscribe_dep)):
        cid = user.get("clinic_id")
        rows = await db.plan_change_requests.find({"clinic_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(20)
        return rows

    # ---------- Plan change requests (SA) ----------
    @api.get("/superadmin/plan-change-requests")
    async def sa_list_plan_change_requests(status: Optional[str] = None, _user: dict = Depends(admin_dep)):
        flt = {}
        if status:
            flt["status"] = status
        rows = await db.plan_change_requests.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        return rows

    @api.post("/superadmin/plan-change-requests/{rid}/approve")
    async def sa_approve_plan_change(rid: str, payload: PlanChangeDecisionIn, user: dict = Depends(admin_dep)):
        req = await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")
        now = iso(now_utc())
        await db.plan_change_requests.update_one({"id": rid}, {"$set": {
            "status": "approved",
            "resolved_at": now,
            "resolved_by": user.get("email"),
            "resolution_reason": (payload.reason or "").strip() or None,
        }})
        return await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})

    @api.post("/superadmin/plan-change-requests/{rid}/reject")
    async def sa_reject_plan_change(rid: str, payload: PlanChangeDecisionIn, user: dict = Depends(admin_dep)):
        req = await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Reason is required for rejection")
        now = iso(now_utc())
        await db.plan_change_requests.update_one({"id": rid}, {"$set": {
            "status": "rejected",
            "resolved_at": now,
            "resolved_by": user.get("email"),
            "resolution_reason": reason,
        }})
        return await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})

    @api.post("/superadmin/plan-change-requests/{rid}/apply")
    async def sa_apply_plan_change(rid: str, user: dict = Depends(admin_dep)):
        req = await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] not in ("pending", "approved"):
            raise HTTPException(status_code=400, detail="Request cannot be applied")
        cid = req["clinic_id"]
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        old_plan = sub.get("plan")
        sub["plan"] = req["requested_plan"]
        sub["billing_cycle"] = req["billing_cycle"]
        if sub.get("status") in ("trial", "expired"):
            sub["status"] = "active"
            sub["started_at"] = sub.get("started_at") or iso(now_utc())
        await db.clinics.update_one({"id": cid}, {"$set": {"subscription": sub}})
        now = iso(now_utc())
        await db.plan_change_requests.update_one({"id": rid}, {"$set": {
            "status": "applied",
            "resolved_at": now,
            "resolved_by": user.get("email"),
        }})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "plan_change_applied",
            "clinic",
            rid,
            old_value={"plan": old_plan},
            new_value={"plan": req["requested_plan"], "billing_cycle": req["billing_cycle"]},
        )
        return await db.plan_change_requests.find_one({"id": rid}, {"_id": 0})

    # ---------- Cancel with churn reason ----------
    @api.post("/superadmin/clinics/{cid}/cancel")
    async def sa_cancel_clinic_with_churn(cid: str, payload: CancelClinicIn, user: dict = Depends(admin_dep)):
        churn_reason = (payload.churn_reason or "").strip().lower()
        churn_note = (payload.churn_note or "").strip()
        if churn_reason not in CHURN_REASONS:
            raise HTTPException(status_code=400, detail=f"churn_reason must be one of: {', '.join(sorted(CHURN_REASONS))}")
        if not churn_note:
            raise HTTPException(status_code=400, detail="churn_note is required")
        c = await db.clinics.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = dict(c.get("subscription") or {})
        prev = sub.get("status")
        now = iso(now_utc())
        sub["status"] = "cancelled"
        await db.clinics.update_one({"id": cid}, {"$set": {
            "subscription": sub,
            "cancelled_at": now,
            "churn_reason": churn_reason,
            "churn_note": churn_note,
            "churned_at": now,
            "churned_by": user.get("email"),
        }})
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": cid},
            "clinic_cancelled",
            "clinic",
            cid,
            old_value={"status": prev},
            new_value={"status": "cancelled", "churn_reason": churn_reason},
            reason=churn_note,
        )
        return {"ok": True, "churn_reason": churn_reason}
