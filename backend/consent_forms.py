"""Digital consent forms: templates per treatment and signed form instances."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from permissions import user_has_permission

CONSENT_STATUSES = frozenset({"not_sent", "pending", "signed", "expired", "cancelled"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _template_snapshot(tpl: dict) -> dict:
    return {
        "id": tpl.get("id"),
        "name": tpl.get("name"),
        "title": tpl.get("title"),
        "body": tpl.get("body"),
        "sections": tpl.get("sections") or [],
        "validity_days": tpl.get("validity_days"),
        "requires_staff_signature": bool(tpl.get("requires_staff_signature")),
        "version": int(tpl.get("version") or 1),
        "treatment_id": tpl.get("treatment_id"),
    }


async def _find_treatment(db, clinic_id: str, *, treatment_id: str = "", name: str = "") -> Optional[dict]:
    if treatment_id:
        doc = await db.treatments.find_one({"clinic_id": clinic_id, "id": treatment_id}, {"_id": 0})
        if doc:
            return doc
    if name:
        clean = name.strip()
        if not clean:
            return None
        doc = await db.treatments.find_one(
            {"clinic_id": clinic_id, "name": clean, "active": True},
            {"_id": 0},
        )
        if doc:
            return doc
        doc = await db.treatments.find_one(
            {
                "clinic_id": clinic_id,
                "active": True,
                "name": {"$regex": f"^{re.escape(clean)}$", "$options": "i"},
            },
            {"_id": 0},
        )
        if doc:
            return doc
        matches = await db.treatments.find(
            {
                "clinic_id": clinic_id,
                "active": True,
                "name": {"$regex": re.escape(clean), "$options": "i"},
            },
            {"_id": 0},
        ).to_list(5)
        if len(matches) == 1:
            return matches[0]
    return None


async def _active_template_for_treatment(db, clinic_id: str, treatment_id: str) -> Optional[dict]:
    if not treatment_id:
        return None
    return await db.consent_templates.find_one(
        {"clinic_id": clinic_id, "treatment_id": treatment_id, "active": True},
        {"_id": 0},
        sort=[("version", -1)],
    )


def _can_manage(user: dict) -> bool:
    if user.get("platform_admin") or user.get("role") == "super_admin":
        return True
    if user.get("permissions"):
        return user_has_permission(user, "consent.manage")
    return user.get("role") in ("super_admin", "manager")


def _can_send(user: dict) -> bool:
    if _can_manage(user):
        return True
    if user.get("permissions"):
        return user_has_permission(user, "consent.send")
    return user.get("role") in ("super_admin", "manager", "fo", "owner")


def _can_view(user: dict) -> bool:
    if _can_send(user):
        return True
    if user.get("permissions"):
        return user_has_permission(user, "consent.view")
    return user.get("role") in ("super_admin", "manager", "fo", "doctor", "therapist", "nurse")


async def _assert_visit_consent_access(db, user: dict, visit: dict, assert_staff_visit_access) -> None:
    if user.get("platform_admin") or user.get("role") == "super_admin":
        return
    if _can_manage(user) or user_has_permission(user, "consent.send"):
        return
    if user_has_permission(user, "visits.view") and user_has_permission(user, "consent.view"):
        return
    if _can_view(user):
        await assert_staff_visit_access(db, user, visit)
        return
    raise HTTPException(status_code=403, detail="Not allowed to view consent for this visit")


async def _refresh_expired(form: dict, db) -> dict:
    if form.get("status") != "signed":
        return form
    exp = form.get("expires_at")
    if exp and exp < _now_iso():
        await db.consent_forms.update_one(
            {"id": form["id"]},
            {"$set": {"status": "expired", "updated_at": _now_iso()}},
        )
        form = {**form, "status": "expired"}
    return form


async def apply_consent_signature(
    db,
    form: dict,
    *,
    patient_signature: str,
    staff_signature: Optional[str] = None,
    staff_user: Optional[dict] = None,
) -> dict:
    """Apply patient (and optional staff) signature; returns updated form doc."""
    if form.get("status") in ("signed", "cancelled", "expired"):
        raise HTTPException(status_code=400, detail="Consent form cannot be signed")
    if not (patient_signature or "").strip().startswith("data:image"):
        raise HTTPException(status_code=400, detail="Patient signature is required")

    snap = form.get("template_snapshot") or {}
    if snap.get("requires_staff_signature") and not (staff_signature or "").strip().startswith("data:image"):
        raise HTTPException(status_code=400, detail="Staff signature is required for this consent")

    tpl = await db.consent_templates.find_one({"id": form.get("template_id")}, {"_id": 0})
    if tpl:
        snap = _template_snapshot(tpl)

    now = _now_iso()
    expires_at = None
    validity = snap.get("validity_days") or form.get("template_snapshot", {}).get("validity_days")
    if validity:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=int(validity))).isoformat()

    upd: Dict[str, Any] = {
        "status": "signed",
        "template_snapshot": snap,
        "patient_signature": patient_signature.strip(),
        "patient_signed_at": now,
        "signed_at": now,
        "updated_at": now,
        "expires_at": expires_at,
    }
    if staff_signature:
        upd["staff_signature"] = staff_signature.strip()
        upd["staff_signed_at"] = now
        if staff_user:
            upd["staff_signed_by_id"] = staff_user.get("id")
            upd["staff_signed_by_name"] = staff_user.get("name")
    if form.get("status") == "not_sent":
        upd["sent_at"] = form.get("sent_at") or now

    await db.consent_forms.update_one({"id": form["id"]}, {"$set": upd})
    return await db.consent_forms.find_one({"id": form["id"]}, {"_id": 0})


async def _visit_treatment_names(
    db,
    clinic_id: str,
    visit: dict,
    booking: Optional[dict] = None,
) -> set:
    names = set()
    if visit.get("chief_complaint"):
        names.add(visit["chief_complaint"].strip())
    bk = booking
    if not bk and visit.get("booking_id"):
        bk = await db.bookings.find_one(
            {"clinic_id": clinic_id, "id": visit["booking_id"]},
            {"_id": 0, "treatment": 1},
        )
    if bk and bk.get("treatment"):
        names.add(bk["treatment"].strip())
    items = await db.treatment_items.find({"visit_id": visit["id"]}, {"_id": 0, "name": 1}).to_list(50)
    names |= {i.get("name", "").strip() for i in items}
    names.discard("")
    return names


async def ensure_consent_forms_for_visit(
    db,
    clinic_id: str,
    visit: dict,
    booking: Optional[dict] = None,
    *,
    created_by: str = "",
    force: bool = False,
) -> dict:
    """Create not_sent consent forms for consent-required treatments on this visit."""
    created: List[dict] = []
    warnings: List[str] = []
    treatment_names = await _visit_treatment_names(db, clinic_id, visit, booking)

    if not treatment_names:
        warnings.append("No treatment linked to this visit yet — add a treatment item or booking first.")
        return {"created": created, "warnings": warnings}

    for name in treatment_names:
        treatment = await _find_treatment(db, clinic_id, name=name)
        if not treatment:
            continue
        if not treatment.get("consent_required") and not force:
            continue
        tpl = await _active_template_for_treatment(db, clinic_id, treatment["id"])
        if not tpl:
            warnings.append(f"No active consent template for “{name}”. Add one under Consent templates.")
            continue
        existing = await db.consent_forms.find_one(
            {
                "clinic_id": clinic_id,
                "visit_id": visit["id"],
                "treatment_id": treatment["id"],
                "status": {"$nin": ["cancelled"]},
            },
            {"_id": 0},
        )
        if existing:
            continue
        performer_id = visit.get("assigned_to") or ""
        performer_name = ""
        if performer_id:
            u = await db.users.find_one({"id": performer_id}, {"_id": 0, "name": 1})
            performer_name = (u or {}).get("name") or ""
        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": clinic_id,
            "patient_id": visit.get("patient_id"),
            "visit_id": visit.get("id"),
            "booking_id": visit.get("booking_id") or (booking or {}).get("id"),
            "treatment_id": treatment["id"],
            "treatment_name_snapshot": treatment.get("name") or name,
            "performer_id": performer_id or None,
            "performer_name_snapshot": performer_name or None,
            "template_id": tpl["id"],
            "template_version": int(tpl.get("version") or 1),
            "template_snapshot": _template_snapshot(tpl),
            "status": "not_sent",
            "patient_signature": None,
            "staff_signature": None,
            "staff_signed_by_id": None,
            "staff_signed_by_name": None,
            "patient_signed_at": None,
            "staff_signed_at": None,
            "signed_at": None,
            "sent_at": None,
            "expires_at": None,
            "prepared_by": created_by or None,
            "cancelled_at": None,
            "cancel_reason": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.consent_forms.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)

    required_without_form = []
    for name in treatment_names:
        treatment = await _find_treatment(db, clinic_id, name=name)
        if treatment and treatment.get("consent_required"):
            has_active = await db.consent_forms.find_one(
                {
                    "clinic_id": clinic_id,
                    "visit_id": visit["id"],
                    "treatment_id": treatment["id"],
                    "status": {"$nin": ["cancelled"]},
                },
                {"_id": 0, "id": 1},
            )
            if not has_active and not any(c.get("treatment_id") == treatment["id"] for c in created):
                required_without_form.append(name)

    if required_without_form and not created and not warnings:
        warnings.append(
            "Consent is required but forms could not be prepared. Check consent templates in Admin settings.",
        )

    return {"created": created, "warnings": warnings}


async def visit_consent_required(db, clinic_id: str, visit: dict, booking: Optional[dict] = None) -> bool:
    """True if any treatment linked to this visit requires consent."""
    ctx = await build_visit_consent_context(db, clinic_id, visit, booking)
    return bool(ctx.get("consent_required"))


async def build_visit_consent_context(
    db,
    clinic_id: str,
    visit: dict,
    booking: Optional[dict] = None,
) -> dict:
    """Summarize consent requirements and preparable treatments for a visit."""
    names = await _visit_treatment_names(db, clinic_id, visit, booking)
    treatments: List[dict] = []
    consent_required = False
    has_preparable_template = False

    for name in sorted(names):
        t = await _find_treatment(db, clinic_id, name=name)
        tpl = await _active_template_for_treatment(db, clinic_id, t["id"]) if t else None
        req = bool(t and t.get("consent_required"))
        if req:
            consent_required = True
        if tpl:
            has_preparable_template = True
        treatments.append({
            "linked_name": name,
            "catalog_name": (t or {}).get("name"),
            "catalog_matched": bool(t),
            "consent_required": req,
            "has_template": bool(tpl),
            "treatment_id": (t or {}).get("id"),
        })

    form_count = await db.consent_forms.count_documents({
        "clinic_id": clinic_id,
        "visit_id": visit.get("id"),
        "status": {"$ne": "cancelled"},
    })

    return {
        "treatment_names": sorted(names),
        "treatments": treatments,
        "consent_required": consent_required,
        "has_preparable_template": has_preparable_template,
        "has_forms": form_count > 0,
        "form_count": form_count,
    }


async def assert_required_consents_signed(db, clinic_id: str, visit_id: str) -> None:
    """Block treatment/visit completion if required consent is missing."""
    visit = await db.visits.find_one({"clinic_id": clinic_id, "id": visit_id}, {"_id": 0})
    if not visit:
        return
    names = await _visit_treatment_names(db, clinic_id, visit)
    for name in names:
        treatment = await _find_treatment(db, clinic_id, name=name)
        if not treatment or not treatment.get("consent_required"):
            continue
        signed = await db.consent_forms.find_one(
            {
                "clinic_id": clinic_id,
                "visit_id": visit_id,
                "treatment_id": treatment["id"],
                "status": "signed",
            },
            {"_id": 0, "id": 1},
        )
        if not signed:
            raise HTTPException(
                status_code=409,
                detail=f"Signed consent required for treatment '{name}' before proceeding",
            )


class ConsentTemplateIn(BaseModel):
    name: str
    treatment_id: str
    title: str = ""
    body: str = ""
    sections: Optional[List[dict]] = None
    validity_days: Optional[int] = Field(None, ge=1, le=3650)
    requires_staff_signature: bool = False
    active: bool = True


class ConsentTemplateUpdateIn(BaseModel):
    name: Optional[str] = None
    treatment_id: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    sections: Optional[List[dict]] = None
    validity_days: Optional[int] = Field(None, ge=1, le=3650)
    requires_staff_signature: Optional[bool] = None
    active: Optional[bool] = None


class ConsentFormCreateIn(BaseModel):
    visit_id: str
    treatment_id: Optional[str] = None
    template_id: Optional[str] = None
    performer_id: Optional[str] = None


class ConsentFormSignIn(BaseModel):
    patient_signature: str
    staff_signature: Optional[str] = None


class ConsentFormCancelIn(BaseModel):
    reason: str = ""


def register_consent_forms(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    scope,
    assert_staff_visit_access,
    audit,
):
    @api.get("/consent-templates")
    async def list_consent_templates(user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed to view consent templates")
        await assert_feature(user, "consent")
        rows = await db.consent_templates.find(scope(user), {"_id": 0}).sort("name", 1).to_list(500)
        return rows

    @api.post("/consent-templates")
    async def create_consent_template(payload: ConsentTemplateIn, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Not allowed to manage consent templates")
        await assert_writeable(user)
        await assert_feature(user, "consent")
        cid = user.get("clinic_id")
        treatment = await _find_treatment(db, cid, treatment_id=payload.treatment_id)
        if not treatment:
            raise HTTPException(status_code=400, detail="Treatment not found")
        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "name": payload.name.strip(),
            "treatment_id": payload.treatment_id,
            "treatment_name_snapshot": treatment.get("name"),
            "title": (payload.title or payload.name).strip(),
            "body": payload.body or "",
            "sections": payload.sections or [],
            "validity_days": payload.validity_days,
            "requires_staff_signature": payload.requires_staff_signature,
            "version": 1,
            "active": payload.active,
            "created_by": user["id"],
            "created_at": now,
            "updated_at": now,
        }
        await db.consent_templates.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "consent_template", doc["id"], {"name": doc["name"]})
        return doc

    @api.put("/consent-templates/{template_id}")
    async def update_consent_template(
        template_id: str,
        payload: ConsentTemplateUpdateIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Not allowed to manage consent templates")
        await assert_writeable(user)
        await assert_feature(user, "consent")
        existing = await db.consent_templates.find_one(scope(user, {"id": template_id}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")
        data = payload.model_dump(exclude_none=True)
        if "treatment_id" in data:
            treatment = await _find_treatment(db, user.get("clinic_id"), treatment_id=data["treatment_id"])
            if not treatment:
                raise HTTPException(status_code=400, detail="Treatment not found")
            data["treatment_name_snapshot"] = treatment.get("name")
        # Bump version when content changes so signed snapshots stay tied to version
        content_keys = {"title", "body", "sections", "validity_days", "requires_staff_signature"}
        if content_keys & set(data.keys()):
            data["version"] = int(existing.get("version") or 1) + 1
        data["updated_at"] = _now_iso()
        await db.consent_templates.update_one({"id": template_id}, {"$set": data})
        await audit(user, "update", "consent_template", template_id, data)
        return await db.consent_templates.find_one(scope(user, {"id": template_id}), {"_id": 0})

    @api.delete("/consent-templates/{template_id}")
    async def deactivate_consent_template(template_id: str, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="Not allowed to manage consent templates")
        await assert_writeable(user)
        r = await db.consent_templates.update_one(
            scope(user, {"id": template_id}),
            {"$set": {"active": False, "updated_at": _now_iso()}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Template not found")
        await audit(user, "deactivate", "consent_template", template_id)
        return {"ok": True}

    async def _serialize_form(form: dict, *, include_signatures: bool = True) -> dict:
        out = dict(form)
        if not include_signatures:
            out.pop("patient_signature", None)
            out.pop("staff_signature", None)
        return await _refresh_expired(out, db)

    @api.get("/visits/{visit_id}/consent-context")
    async def get_visit_consent_context(visit_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed to view consent")
        await assert_feature(user, "emr")
        visit = await db.visits.find_one(scope(user, {"id": visit_id}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await _assert_visit_consent_access(db, user, visit, assert_staff_visit_access)
        booking = None
        if visit.get("booking_id"):
            booking = await db.bookings.find_one({"id": visit["booking_id"]}, {"_id": 0})
        return await build_visit_consent_context(db, user.get("clinic_id"), visit, booking)

    @api.get("/visits/{visit_id}/consent-forms")
    async def list_visit_consent_forms(visit_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed to view consent forms")
        await assert_feature(user, "emr")
        visit = await db.visits.find_one(scope(user, {"id": visit_id}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await _assert_visit_consent_access(db, user, visit, assert_staff_visit_access)
        rows = await db.consent_forms.find(
            scope(user, {"visit_id": visit_id}),
            {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        can_see_sigs = _can_send(user) or user.get("role") in (
            "doctor", "therapist", "nurse", "super_admin", "manager", "fo",
        )
        out = []
        for row in rows:
            include_sigs = can_see_sigs and row.get("status") == "signed"
            serialized = await _serialize_form(row, include_signatures=include_sigs)
            from public_consent_links import attach_public_link_summary
            out.append(await attach_public_link_summary(db, serialized))
        return out

    @api.get("/bookings/{booking_id}/consent-forms")
    async def list_booking_consent_forms(booking_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed to view consent forms")
        await assert_feature(user, "emr")
        booking = await db.bookings.find_one(scope(user, {"id": booking_id}), {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        flt = scope(user, {"booking_id": booking_id})
        if booking.get("visit_id"):
            flt = {"$or": [flt, scope(user, {"visit_id": booking["visit_id"]})]}
        rows = await db.consent_forms.find(flt, {"_id": 0}).sort("created_at", -1).to_list(20)
        out = []
        for row in rows:
            out.append(await _serialize_form(row))
        return out

    @api.post("/consent-forms")
    async def create_consent_form(payload: ConsentFormCreateIn, user: dict = Depends(get_current_user)):
        if not _can_send(user):
            raise HTTPException(status_code=403, detail="Not allowed to prepare consent forms")
        await assert_writeable(user)
        await assert_feature(user, "emr")
        visit = await db.visits.find_one(scope(user, {"id": payload.visit_id}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        cid = user.get("clinic_id")
        treatment = None
        if payload.treatment_id:
            treatment = await _find_treatment(db, cid, treatment_id=payload.treatment_id)
        elif visit.get("chief_complaint"):
            treatment = await _find_treatment(db, cid, name=visit["chief_complaint"])
        if not treatment:
            raise HTTPException(status_code=400, detail="Treatment not found for consent")
        tpl = None
        if payload.template_id:
            tpl = await db.consent_templates.find_one(scope(user, {"id": payload.template_id}), {"_id": 0})
        if not tpl:
            tpl = await _active_template_for_treatment(db, cid, treatment["id"])
        if not tpl:
            raise HTTPException(status_code=400, detail="No active consent template for this treatment")

        performer_id = payload.performer_id or visit.get("assigned_to")
        performer_name = ""
        if performer_id:
            u = await db.users.find_one({"id": performer_id}, {"_id": 0, "name": 1})
            performer_name = (u or {}).get("name") or ""

        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "patient_id": visit["patient_id"],
            "visit_id": visit["id"],
            "booking_id": visit.get("booking_id"),
            "treatment_id": treatment["id"],
            "treatment_name_snapshot": treatment.get("name"),
            "performer_id": performer_id,
            "performer_name_snapshot": performer_name or None,
            "template_id": tpl["id"],
            "template_version": int(tpl.get("version") or 1),
            "template_snapshot": _template_snapshot(tpl),
            "status": "not_sent",
            "patient_signature": None,
            "staff_signature": None,
            "staff_signed_by_id": None,
            "staff_signed_by_name": None,
            "patient_signed_at": None,
            "staff_signed_at": None,
            "signed_at": None,
            "sent_at": None,
            "expires_at": None,
            "prepared_by": user["id"],
            "cancelled_at": None,
            "cancel_reason": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.consent_forms.insert_one(doc)
        doc.pop("_id", None)
        from audit_log import log_consent
        await log_consent(
            db, user, "prepared", visit["patient_id"],
            new_value={"form_id": doc["id"], "treatment": treatment.get("name"), "visit_id": visit["id"]},
        )
        return doc

    @api.post("/consent-forms/{form_id}/send")
    async def send_consent_form(form_id: str, user: dict = Depends(get_current_user)):
        if not _can_send(user):
            raise HTTPException(status_code=403, detail="Not allowed to send consent forms")
        await assert_writeable(user)
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        if form.get("status") in ("signed", "cancelled"):
            raise HTTPException(status_code=400, detail="Consent form is closed")
        now = _now_iso()
        await db.consent_forms.update_one(
            {"id": form_id},
            {"$set": {"status": "pending", "sent_at": now, "updated_at": now}},
        )
        from audit_log import log_consent
        await log_consent(
            db, user, "pending", form["patient_id"],
            new_value={"form_id": form_id, "visit_id": form.get("visit_id")},
        )
        return await db.consent_forms.find_one({"id": form_id}, {"_id": 0})

    @api.put("/consent-forms/{form_id}/sign")
    async def sign_consent_form(form_id: str, payload: ConsentFormSignIn, user: dict = Depends(get_current_user)):
        if not _can_send(user) and user.get("role") not in ("doctor", "therapist", "nurse", "fo", "super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Not allowed to sign consent forms")
        await assert_writeable(user)
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        if form.get("visit_id"):
            visit = await db.visits.find_one({"id": form["visit_id"]}, {"_id": 0})
            if visit and not _can_send(user):
                await _assert_visit_consent_access(db, user, visit, assert_staff_visit_access)
        if form.get("status") in ("signed", "cancelled", "expired"):
            raise HTTPException(status_code=400, detail="Consent form cannot be signed")
        if not (payload.patient_signature or "").strip().startswith("data:image"):
            raise HTTPException(status_code=400, detail="Patient signature is required")

        snap = form.get("template_snapshot") or {}
        if snap.get("requires_staff_signature") and not (payload.staff_signature or "").strip().startswith("data:image"):
            raise HTTPException(status_code=400, detail="Staff signature is required for this consent")

        saved = await apply_consent_signature(
            db,
            form,
            patient_signature=payload.patient_signature,
            staff_signature=payload.staff_signature,
            staff_user=user,
        )
        from audit_log import log_consent
        await log_consent(
            db, user, "signed", form["patient_id"],
            new_value={
                "form_id": form_id,
                "treatment": form.get("treatment_name_snapshot"),
                "visit_id": form.get("visit_id"),
            },
        )
        return saved

    @api.post("/consent-forms/{form_id}/cancel")
    async def cancel_consent_form(
        form_id: str,
        payload: ConsentFormCancelIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_send(user):
            raise HTTPException(status_code=403, detail="Not allowed to cancel consent forms")
        await assert_writeable(user)
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        if form.get("status") == "signed":
            raise HTTPException(status_code=400, detail="Signed consent cannot be cancelled")
        now = _now_iso()
        await db.consent_forms.update_one(
            {"id": form_id},
            {"$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "cancel_reason": (payload.reason or "").strip(),
                "updated_at": now,
            }},
        )
        await db.consent_public_links.update_many(
            {"consent_id": form_id, "status": {"$in": ["pending", "opened"]}},
            {"$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now}},
        )
        from audit_log import log_consent
        await log_consent(
            db, user, "cancelled", form["patient_id"],
            reason=(payload.reason or "").strip(),
            new_value={"form_id": form_id},
        )
        return await db.consent_forms.find_one({"id": form_id}, {"_id": 0})

    @api.get("/consent-forms/{form_id}")
    async def get_consent_form(form_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed to view consent forms")
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        if form.get("visit_id"):
            visit = await db.visits.find_one({"id": form["visit_id"]}, {"_id": 0})
            if visit:
                await _assert_visit_consent_access(db, user, visit, assert_staff_visit_access)
        return await _serialize_form(form)

    @api.post("/visits/{visit_id}/consent-forms/ensure")
    async def ensure_visit_consents(
        visit_id: str,
        force: bool = False,
        user: dict = Depends(get_current_user),
    ):
        if not _can_send(user):
            raise HTTPException(status_code=403, detail="Not allowed to prepare consent forms")
        await assert_writeable(user)
        visit = await db.visits.find_one(scope(user, {"id": visit_id}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        booking = None
        if visit.get("booking_id"):
            booking = await db.bookings.find_one({"id": visit["booking_id"]}, {"_id": 0})
        result = await ensure_consent_forms_for_visit(
            db, user.get("clinic_id"), visit, booking, created_by=user["id"], force=force,
        )
        rows = await db.consent_forms.find(scope(user, {"visit_id": visit_id}), {"_id": 0}).sort("created_at", -1).to_list(50)
        created = result.get("created") or []
        return {
            "created": len(created),
            "warnings": result.get("warnings") or [],
            "forms": rows,
        }

    from public_consent_links import register_public_consent_links
    register_public_consent_links(
        api, db, get_current_user, assert_writeable, assert_feature, scope, audit,
    )
