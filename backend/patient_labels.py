"""Patient labels API routes."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from patient_labels_core import (
    assign_label,
    ensure_default_patient_labels,
    enrich_patients_with_labels,
    get_label,
    get_patient_labels_settings,
    list_clinic_labels,
    list_patient_assignments,
    remove_label_assignment,
    update_patient_labels_settings,
)
from patient_labels_models import (
    LABEL_SEVERITIES,
    LABEL_TYPES,
    PatientLabelAssignIn,
    PatientLabelIn,
    PatientLabelUpdateIn,
    PatientLabelsSettingsIn,
    SYSTEM_LABEL_KEY_BLACKLIST,
    label_to_api,
)
from permissions import user_has_permission


def register_patient_labels(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    audit,
    scope,
    assert_patient_access,
):
    def _can_view(user: dict) -> bool:
        return user_has_permission(user, "patient_labels.view") or user_has_permission(user, "patients.view")

    def _can_manage(user: dict) -> bool:
        return user_has_permission(user, "patient_labels.manage")

    def _can_assign(user: dict) -> bool:
        if user_has_permission(user, "patient_labels.assign"):
            return True
        if user.get("role") in ("super_admin", "manager"):
            return True
        return False

    def _can_remove(user: dict) -> bool:
        return user_has_permission(user, "patient_labels.remove") or _can_manage(user) or _can_assign(user)

    @api.get("/patient-labels")
    async def patient_labels_list(
        user: dict = Depends(get_current_user),
        include_inactive: bool = False,
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return await list_clinic_labels(db, user["clinic_id"], include_inactive=include_inactive)

    @api.get("/patient-labels/settings")
    async def patient_labels_settings_get(user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return await get_patient_labels_settings(db, user["clinic_id"])

    @api.put("/patient-labels/settings")
    async def patient_labels_settings_put(
        payload: PatientLabelsSettingsIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage(user) and not user_has_permission(user, "settings.manage"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        merged = await update_patient_labels_settings(
            db,
            user["clinic_id"],
            payload.model_dump(exclude_none=True),
        )
        await audit(user, "update", "patient_labels_settings", user["clinic_id"], merged)
        return merged

    @api.post("/patient-labels")
    async def patient_labels_create(payload: PatientLabelIn, user: dict = Depends(get_current_user)):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="patient_labels.manage permission required")
        await assert_writeable(user)
        severity = (payload.severity or "normal").strip().lower()
        if severity not in LABEL_SEVERITIES:
            raise HTTPException(status_code=400, detail="Invalid severity")
        import uuid
        from patient_labels_models import _now_iso

        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": user["clinic_id"],
            "name": payload.name.strip(),
            "color": (payload.color or "#6B7280").strip(),
            "type": "custom",
            "severity": severity,
            "description": (payload.description or "").strip() or None,
            "system_key": None,
            "active": payload.active,
            "created_by": user.get("id"),
            "created_by_name_snapshot": user.get("name") or "",
            "created_at": now,
            "updated_at": now,
        }
        await db.patient_labels.insert_one(doc)
        await audit(user, "create", "patient_label", doc["id"], {"name": doc["name"]})
        return label_to_api(doc)

    @api.put("/patient-labels/{label_id}")
    async def patient_labels_update(
        label_id: str,
        payload: PatientLabelUpdateIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_manage(user):
            raise HTTPException(status_code=403, detail="patient_labels.manage permission required")
        await assert_writeable(user)
        raw = await db.patient_labels.find_one({"clinic_id": user["clinic_id"], "id": label_id}, {"_id": 0})
        if not raw:
            raise HTTPException(status_code=404, detail="Label not found")
        upd = payload.model_dump(exclude_none=True)
        if not upd:
            return label_to_api(raw)
        if raw.get("system_key") == SYSTEM_LABEL_KEY_BLACKLIST and "name" in upd:
            upd["name"] = "Blacklist"
        if "severity" in upd and upd["severity"] not in LABEL_SEVERITIES:
            raise HTTPException(status_code=400, detail="Invalid severity")
        from patient_labels_models import _now_iso

        upd["updated_at"] = _now_iso()
        await db.patient_labels.update_one({"id": label_id}, {"$set": upd})
        updated = await db.patient_labels.find_one({"id": label_id}, {"_id": 0})
        await audit(user, "update", "patient_label", label_id, {"before": label_to_api(raw), "after": label_to_api(updated)})
        return label_to_api(updated)

    @api.get("/patients/{patient_id}/labels")
    async def patient_labels_for_patient(patient_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, patient_id)
        return await list_patient_assignments(db, user["clinic_id"], patient_id)

    @api.post("/patients/{patient_id}/labels")
    async def patient_labels_assign(
        patient_id: str,
        payload: PatientLabelAssignIn,
        user: dict = Depends(get_current_user),
    ):
        settings = await get_patient_labels_settings(db, user["clinic_id"])
        if user.get("role") == "fo" and not settings.get("fo_can_assign_labels", True):
            raise HTTPException(status_code=403, detail="Front office cannot assign labels")
        if not _can_assign(user):
            raise HTTPException(status_code=403, detail="patient_labels.assign permission required")
        await assert_writeable(user)
        await assert_patient_access(db, user, patient_id)
        label = await get_label(db, user["clinic_id"], payload.label_id)
        if not label:
            raise HTTPException(status_code=404, detail="Label not found")
        is_blacklist = (label.get("system_key") or "").lower() == SYSTEM_LABEL_KEY_BLACKLIST
        if is_blacklist and not (payload.notes or "").strip():
            raise HTTPException(status_code=400, detail="Reason for blacklist is required")
        result = await assign_label(
            db,
            user,
            patient_id=patient_id,
            label_id=payload.label_id,
            notes=payload.notes,
        )
        action = "blacklist_assigned" if is_blacklist else "label_assigned"
        await audit(
            user,
            action,
            "patient_label",
            result.get("id") or "",
            {
                "patient_id": patient_id,
                "label_id": payload.label_id,
                "label_name": label.get("name"),
                "notes": payload.notes,
            },
        )
        return result

    @api.delete("/patients/{patient_id}/labels/{assignment_id}")
    async def patient_labels_remove(
        patient_id: str,
        assignment_id: str,
        user: dict = Depends(get_current_user),
    ):
        settings = await get_patient_labels_settings(db, user["clinic_id"])
        if user.get("role") == "fo" and not settings.get("fo_can_assign_labels", True):
            raise HTTPException(status_code=403, detail="Front office cannot remove labels")
        if not _can_remove(user):
            raise HTTPException(status_code=403, detail="patient_labels.remove permission required")
        await assert_writeable(user)
        await assert_patient_access(db, user, patient_id)
        before = await list_patient_assignments(db, user["clinic_id"], patient_id)
        row = next((a for a in before if a.get("id") == assignment_id), None)
        result = await remove_label_assignment(db, user, patient_id=patient_id, assignment_id=assignment_id)
        is_blacklist = (result.get("label") or {}).get("system_key") == SYSTEM_LABEL_KEY_BLACKLIST
        action = "blacklist_removed" if is_blacklist else "label_removed"
        await audit(
            user,
            action,
            "patient_label",
            assignment_id,
            {
                "patient_id": patient_id,
                "label_id": result.get("label_id"),
                "notes": result.get("notes"),
            },
        )
        return result

    return ensure_default_patient_labels, enrich_patients_with_labels
