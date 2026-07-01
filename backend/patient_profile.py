"""Patient profile hub: tab access rules and unified activity timeline."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from nationalities import normalize_nationality_fields
from permissions import user_has_permission
from performers import booking_staff_filter

PATIENT_SOURCE_VALUES = frozenset({
    "instagram",
    "tiktok",
    "facebook",
    "google",
    "website",
    "referral",
    "walk_in",
    "whatsapp",
    "hotel_villa",
    "other",
})

FO_PATIENT_EDIT_FIELDS = frozenset({
    "full_name",
    "phone",
    "email",
    "gender",
    "date_of_birth",
    "address",
    "nationality",
    "nationality_code",
    "patient_source",
    "source_detail",
    "allergies",
    "consent_status",
    "consent_notes",
})


def normalize_patient_source(value: Optional[str]) -> Optional[str]:
    """Normalize optional patient source to a stable slug for analytics."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return ""
    key = raw.lower().replace("-", "_").replace("/", "_").replace(" ", "_")
    while "__" in key:
        key = key.replace("__", "_")
    aliases = {
        "walkin": "walk_in",
        "walk_in": "walk_in",
        "hotel_villa": "hotel_villa",
        "hotel__villa": "hotel_villa",
    }
    key = aliases.get(key, key)
    if key in PATIENT_SOURCE_VALUES:
        return key
    return None


def validate_patient_marketing_fields(doc: dict) -> dict:
    """Normalize optional nationality / source fields for create and update."""
    if "nationality" in doc or "nationality_code" in doc:
        nc, nn = normalize_nationality_fields(
            doc.get("nationality_code"),
            doc.get("nationality"),
        )
        if nc is None and nn is None:
            raise HTTPException(status_code=400, detail="Invalid nationality")
        doc["nationality_code"] = nc
        doc["nationality"] = nn
    if "source_detail" in doc and doc["source_detail"] is not None:
        doc["source_detail"] = str(doc["source_detail"]).strip()
    if "patient_source" not in doc:
        return doc
    raw = doc.get("patient_source")
    if raw in (None, ""):
        doc["patient_source"] = ""
        return doc
    normalized = normalize_patient_source(raw)
    if normalized is None:
        raise HTTPException(status_code=400, detail="Invalid patient source")
    doc["patient_source"] = normalized
    return doc


def filter_patient_update_fields(user: dict, upd: dict) -> dict:
    """Front desk may only update basic demographics (+ consent fields from consent tab)."""
    if user.get("platform_admin") or user.get("role") in ("super_admin", "manager"):
        return upd
    if user.get("role") == "fo":
        return {k: v for k, v in upd.items() if k in FO_PATIENT_EDIT_FIELDS}
    return upd


def _tab_access(
    user: dict,
    permission: Optional[str] = None,
    *,
    any_permissions: Optional[List[str]] = None,
    legacy_roles: Optional[tuple] = None,
) -> bool:
    if user.get("platform_admin") or user.get("role") == "super_admin":
        return True
    perms = user.get("permissions")
    if perms is not None and len(perms) > 0:
        if any_permissions and any(user_has_permission(user, p) for p in any_permissions):
            return True
        if permission and user_has_permission(user, permission):
            return True
        return False
    if legacy_roles and user.get("role") in legacy_roles:
        return True
    return False


def resolve_patient_profile_tabs(user: dict) -> Dict[str, bool]:
    clinical_roles = ("doctor", "therapist", "nurse")
    return {
        "overview": True,
        "appointments": _tab_access(
            user, "appointments.view",
            any_permissions=["appointments.view", "schedule.view_own"],
            legacy_roles=("fo", "manager", "super_admin", *clinical_roles),
        ),
        "visits": _tab_access(
            user, "visits.view",
            any_permissions=["visits.view", "visits.view_own"],
            legacy_roles=("fo", "manager", "super_admin", *clinical_roles),
        ),
        "clinical_notes": _tab_access(
            user, "clinical_records.view",
            legacy_roles=("fo", "manager", "super_admin", *clinical_roles),
        ),
        "photos": _tab_access(
            user, "clinical_records.view",
            legacy_roles=("fo", "manager", "super_admin", *clinical_roles),
        ),
        "packages": _tab_access(
            user, "packages.view",
            legacy_roles=("fo", "manager", "super_admin", "doctor", "therapist", "nurse"),
        ),
        "invoices": _tab_access(
            user, "billing.view",
            legacy_roles=("fo", "manager", "super_admin"),
        ),
        "prepaid": _tab_access(
            user, "prepaid.view",
            any_permissions=["prepaid.view", "billing.view", "accounting.view"],
            legacy_roles=("fo", "manager", "super_admin", "accounting"),
        ),
        "wallet": _tab_access(
            user, "wallet.view",
            legacy_roles=("fo", "manager", "super_admin"),
        ),
        "consents": True,
        "timeline": False,
    }


def _coerce_at(value: Any) -> str:
    """Normalize Mongo/datetime values for stable JSON + sorting."""
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value).strip()


def _event(
    kind: str,
    at: Any,
    title: str,
    *,
    record_id: str = "",
    subtitle: str = "",
    status: str = "",
    visit_id: str = "",
    meta: Optional[dict] = None,
) -> dict:
    return {
        "kind": kind,
        "at": _coerce_at(at),
        "title": title,
        "subtitle": subtitle,
        "status": status,
        "record_id": record_id,
        "visit_id": visit_id,
        "meta": meta or {},
    }


def register_patient_profile(
    api: APIRouter,
    db,
    get_current_user,
    scope,
    assert_patient_access,
    apply_staff_visit_filter,
    assert_feature,
):
    async def _load_accessible_visit_ids(user: dict, pid: str) -> List[str]:
        vflt = await apply_staff_visit_filter(db, user, {"patient_id": pid})
        return [v["id"] async for v in db.visits.find(vflt, {"_id": 0, "id": 1})]

    @api.get("/patients/{pid}/profile/access")
    async def patient_profile_access(pid: str, user: dict = Depends(get_current_user)):
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        return resolve_patient_profile_tabs(user)

    @api.get("/patients/{pid}/photos")
    async def patient_photos(pid: str, user: dict = Depends(get_current_user)):
        tabs = resolve_patient_profile_tabs(user)
        if not tabs.get("photos"):
            raise HTTPException(status_code=403, detail="Not allowed to view photos")
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        await assert_feature(user, "photos")
        visit_ids = await _load_accessible_visit_ids(user, pid)
        if not visit_ids:
            return []
        photos = await db.photos.find(
            {"clinic_id": user.get("clinic_id"), "visit_id": {"$in": visit_ids}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(500)
        visit_meta = {}
        async for v in db.visits.find(
            {"clinic_id": user.get("clinic_id"), "id": {"$in": visit_ids}},
            {"_id": 0, "id": 1, "visit_date": 1, "visit_type": 1},
        ):
            visit_meta[v["id"]] = v
        for ph in photos:
            v = visit_meta.get(ph.get("visit_id")) or {}
            ph["visit_date"] = v.get("visit_date")
            ph["visit_type"] = v.get("visit_type")
        return photos

    @api.get("/patients/{pid}/consents")
    async def patient_consents(pid: str, user: dict = Depends(get_current_user)):
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        history = await db.audit_logs.find(
            {
                "clinic_id": user.get("clinic_id"),
                "module": "consent",
                "record_id": pid,
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(100)
        forms = await db.consent_forms.find(
            scope(user, {"patient_id": pid}),
            {"_id": 0, "patient_signature": 0, "staff_signature": 0},
        ).sort("created_at", -1).to_list(100)
        return {
            "current": {
                "consent_status": p.get("consent_status") or "unsigned",
                "consent_notes": p.get("consent_notes"),
                "consent_signed_at": p.get("consent_signed_at"),
            },
            "forms": forms,
            "history": history,
        }

    @api.get("/patients/{pid}/activity")
    async def patient_activity(pid: str, user: dict = Depends(get_current_user)):
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1, "full_name": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        tabs = resolve_patient_profile_tabs(user)
        events: List[dict] = []

        if tabs.get("appointments"):
            bflt: Dict[str, Any] = {**scope(user), "patient_id": pid}
            if not user_has_permission(user, "appointments.view") and user.get("id"):
                bflt.update(booking_staff_filter(user["id"]))
            async for b in db.bookings.find(bflt, {"_id": 0}).sort("scheduled_at", -1).to_list(200):
                if b.get("booking_type") == "block" or b.get("status") == "blocked":
                    continue
                at = b.get("scheduled_at") or b.get("created_at") or ""
                events.append(_event(
                    "booking",
                    at,
                    b.get("treatment") or "Appointment",
                    record_id=b.get("id", ""),
                    subtitle=b.get("patient_name") or p.get("full_name", ""),
                    status=b.get("status") or "",
                    meta={
                        "scheduled_at": b.get("scheduled_at"),
                        "duration_min": b.get("duration_min"),
                        "source": b.get("source"),
                    },
                ))

        visit_ids = await _load_accessible_visit_ids(user, pid)
        visit_by_id: Dict[str, dict] = {}
        if visit_ids:
            async for v in db.visits.find(
                {"clinic_id": user.get("clinic_id"), "id": {"$in": visit_ids}},
                {"_id": 0},
            ).sort("created_at", -1):
                visit_by_id[v["id"]] = v
                if tabs.get("visits"):
                    at = v.get("visit_date") or v.get("created_at") or ""
                    events.append(_event(
                        "visit",
                        at,
                        f"{(v.get('visit_type') or 'Clinical').capitalize()} visit",
                        record_id=v.get("id", ""),
                        visit_id=v.get("id", ""),
                        status=v.get("status") or "",
                        subtitle=v.get("chief_complaint") or "",
                    ))

        if tabs.get("packages"):
            async for pkg in db.patient_packages.find(
                scope(user, {"patient_id": pid}),
                {"_id": 0},
            ).sort("created_at", -1).to_list(100):
                at = pkg.get("start_date") or pkg.get("created_at") or ""
                events.append(_event(
                    "package_purchase",
                    at,
                    pkg.get("package_name_snapshot") or "Package purchased",
                    record_id=pkg.get("id", ""),
                    status=pkg.get("status") or "",
                    subtitle=f"{pkg.get('remaining_sessions', 0)}/{pkg.get('total_sessions', 0)} sessions",
                    meta={"purchase_price_snapshot": pkg.get("purchase_price_snapshot")},
                ))
            async for usage in db.package_usage.find(
                scope(user, {"patient_id": pid}),
                {"_id": 0},
            ).sort("usage_date", -1).to_list(200):
                at = usage.get("usage_date") or usage.get("created_at") or ""
                events.append(_event(
                    "package_usage",
                    at,
                    usage.get("treatment_name_snapshot") or "Package session used",
                    record_id=usage.get("id", ""),
                    visit_id=usage.get("visit_id") or "",
                    status=usage.get("status") or "",
                    subtitle=f"{usage.get('used_sessions_count', 1)} session(s)",
                ))

        if tabs.get("invoices"):
            try:
                await assert_feature(user, "billing")
                async for inv in db.invoices.find(
                    scope(user, {"patient_id": pid}),
                    {"_id": 0},
                ).sort("created_at", -1).to_list(100):
                    at = inv.get("paid_at") or inv.get("created_at") or ""
                    events.append(_event(
                        "invoice",
                        at,
                        f"Invoice {inv.get('invoice_number') or inv.get('id', '')[:8]}",
                        record_id=inv.get("id", ""),
                        visit_id=inv.get("visit_id") or "",
                        status=inv.get("payment_status") or "",
                        subtitle=f"Total {inv.get('total_amount', 0)}",
                        meta={
                            "amount_paid": inv.get("amount_paid"),
                            "total_amount": inv.get("total_amount"),
                        },
                    ))
            except HTTPException:
                pass

        if tabs.get("consents"):
            patient = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
            if patient and patient.get("consent_signed_at"):
                events.append(_event(
                    "consent",
                    patient.get("consent_signed_at"),
                    "Consent signed",
                    record_id=pid,
                    status=patient.get("consent_status") or "signed",
                    subtitle=patient.get("consent_notes") or "",
                ))
            async for cf in db.consent_forms.find(
                scope(user, {"patient_id": pid}),
                {"_id": 0},
            ).sort("signed_at", -1).to_list(50):
                at = cf.get("signed_at") or cf.get("sent_at") or cf.get("created_at") or ""
                events.append(_event(
                    "consent",
                    at,
                    f"Digital consent {cf.get('status')} — {cf.get('treatment_name_snapshot') or 'Treatment'}",
                    record_id=cf.get("id", ""),
                    visit_id=cf.get("visit_id") or "",
                    status=cf.get("status") or "",
                ))
            async for row in db.audit_logs.find(
                {
                    "clinic_id": user.get("clinic_id"),
                    "module": "consent",
                    "record_id": pid,
                },
                {"_id": 0},
            ).sort("created_at", -1).to_list(50):
                events.append(_event(
                    "consent",
                    row.get("created_at") or "",
                    f"Consent {row.get('action') or 'updated'}",
                    record_id=pid,
                    status=row.get("action") or "",
                    subtitle=(row.get("reason") or ""),
                ))

        if tabs.get("photos") and visit_ids:
            try:
                await assert_feature(user, "photos")
                async for ph in db.photos.find(
                    {"clinic_id": user.get("clinic_id"), "visit_id": {"$in": visit_ids}},
                    {"_id": 0},
                ).sort("created_at", -1).to_list(200):
                    at = ph.get("created_at") or ""
                    events.append(_event(
                        "photo",
                        at,
                        f"{(ph.get('photo_type') or 'Photo').replace('_', ' ').title()} uploaded",
                        record_id=ph.get("id", ""),
                        visit_id=ph.get("visit_id") or "",
                        subtitle=ph.get("angle") or ph.get("notes") or "",
                        meta={"photo_type": ph.get("photo_type"), "angle": ph.get("angle")},
                    ))
            except HTTPException:
                pass

        if tabs.get("clinical_notes") and visit_ids:
            for vid in visit_ids:
                v = visit_by_id.get(vid) or {}
                for coll, note_type in (
                    ("clinical_records", "doctor"),
                    ("therapist_records", "therapist"),
                ):
                    rec = await db[coll].find_one({"visit_id": vid}, {"_id": 0})
                    if not rec:
                        continue
                    if rec.get("note_status") not in ("completed", "locked") and not rec.get("submitted"):
                        continue
                    at = rec.get("submitted_at") or rec.get("updated_at") or rec.get("created_at") or ""
                    title = f"{note_type.capitalize()} note {rec.get('note_status') or 'completed'}"
                    snippet = rec.get("diagnosis") or rec.get("body_concern") or rec.get("treatment_plan") or ""
                    events.append(_event(
                        "clinical_note",
                        at,
                        title,
                        record_id=vid,
                        visit_id=vid,
                        status=rec.get("note_status") or "",
                        subtitle=(snippet[:120] if snippet else ""),
                        meta={"note_type": note_type},
                    ))
                performer_notes = await db.performer_visit_notes.find(
                    {"visit_id": vid},
                    {"_id": 0},
                ).to_list(20)
                for rec in performer_notes:
                    if rec.get("note_status") not in ("completed", "locked") and not rec.get("submitted"):
                        continue
                    at = rec.get("submitted_at") or rec.get("updated_at") or ""
                    events.append(_event(
                        "clinical_note",
                        at,
                        f"Performer note {rec.get('note_status') or 'completed'}",
                        record_id=vid,
                        visit_id=vid,
                        status=rec.get("note_status") or "",
                        subtitle=rec.get("staff_name") or "",
                        meta={"note_type": "performer", "staff_id": rec.get("staff_id")},
                    ))

        events.sort(key=lambda e: e.get("at") or "", reverse=True)
        return events[:300]
