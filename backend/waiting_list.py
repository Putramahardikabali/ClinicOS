"""Waiting list API routes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from audit_log import log_waiting_list
from permissions import user_has_permission
from waiting_list_core import (
    build_entry_doc,
    build_summary,
    enrich_waiting_list_entries,
    find_active_duplicate,
    validate_create_payload,
)
from waiting_list_models import ACTIVE_STATUSES, CANCEL_REASONS, VALID_STATUSES, WaitingListConvertIn, WaitingListCreateIn, WaitingListStatusIn, WaitingListUpdateIn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def register_waiting_list(api: APIRouter, db, get_current_user, assert_writeable, scope):
    def _can_view(user: dict) -> bool:
        return user_has_permission(user, "waiting_list.view")

    def _can_create(user: dict) -> bool:
        return user_has_permission(user, "waiting_list.create")

    def _can_update(user: dict) -> bool:
        return user_has_permission(user, "waiting_list.update")

    def _can_cancel(user: dict) -> bool:
        return user_has_permission(user, "waiting_list.cancel")

    def _can_convert(user: dict) -> bool:
        return user_has_permission(user, "waiting_list.convert_to_appointment")

    async def _get_entry(user: dict, entry_id: str) -> dict:
        entry = await db.waiting_list_entries.find_one(
            scope(user, {"id": entry_id}),
            {"_id": 0},
        )
        if not entry:
            raise HTTPException(status_code=404, detail="Waiting list entry not found")
        return entry

    def _apply_list_filters(
        flt: dict,
        *,
        from_date: Optional[str],
        to_date: Optional[str],
        status: Optional[str],
        treatment_id: Optional[str],
        staff_id: Optional[str],
        source: Optional[str],
        q: Optional[str],
    ) -> dict:
        if from_date:
            flt["desired_date"] = flt.get("desired_date", {})
            if isinstance(flt["desired_date"], dict):
                flt["desired_date"]["$gte"] = from_date
            else:
                flt["desired_date"] = {"$gte": from_date}
        if to_date:
            if isinstance(flt.get("desired_date"), dict):
                flt["desired_date"]["$lte"] = to_date
            else:
                flt["desired_date"] = {"$lte": to_date}
        if status:
            flt["status"] = status
        if treatment_id:
            flt["treatment_id"] = treatment_id
        if staff_id:
            flt["preferred_staff_id"] = staff_id
        if source:
            flt["source"] = source
        return flt

    @api.get("/waiting-list")
    async def list_waiting_list(
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        status: Optional[str] = None,
        treatment_id: Optional[str] = None,
        staff_id: Optional[str] = None,
        source: Optional[str] = None,
        q: Optional[str] = None,
        patient_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        flt = scope(user, {})
        if patient_id:
            flt["patient_id"] = patient_id
        _apply_list_filters(
            flt,
            from_date=from_date,
            to_date=to_date,
            status=status,
            treatment_id=treatment_id,
            staff_id=staff_id,
            source=source,
            q=q,
        )
        items = await db.waiting_list_entries.find(flt, {"_id": 0}).sort("created_at", -1).to_list(1000)
        items = await enrich_waiting_list_entries(db, user["clinic_id"], items)
        if q:
            needle = q.strip().lower()
            items = [
                e for e in items
                if needle in (e.get("display_name") or "").lower()
                or needle in (e.get("display_phone") or "").lower()
                or needle in (e.get("patient_email") or "").lower()
                or needle in (e.get("new_patient_email") or "").lower()
            ]
        return items

    @api.get("/waiting-list/summary")
    async def waiting_list_summary(
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        status: Optional[str] = None,
        treatment_id: Optional[str] = None,
        staff_id: Optional[str] = None,
        source: Optional[str] = None,
        q: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if not user_has_permission(user, "waiting_list.report"):
            raise HTTPException(status_code=403, detail="Insufficient permissions for reports")
        items = await list_waiting_list(
            from_date=from_date,
            to_date=to_date,
            status=status,
            treatment_id=treatment_id,
            staff_id=staff_id,
            source=source,
            q=q,
            patient_id=None,
            user=user,
        )
        return build_summary(items)

    @api.get("/waiting-list/check-duplicate")
    async def check_duplicate(
        desired_date: str,
        treatment_name_snapshot: str = "",
        treatment_id: Optional[str] = None,
        patient_id: Optional[str] = None,
        new_patient_phone: Optional[str] = None,
        exclude_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        dup = await find_active_duplicate(
            db,
            user["clinic_id"],
            desired_date=desired_date,
            treatment_name_snapshot=treatment_name_snapshot,
            treatment_id=treatment_id,
            patient_id=patient_id,
            new_patient_phone=new_patient_phone,
            exclude_id=exclude_id,
        )
        if not dup:
            return {"duplicate": False}
        dup = (await enrich_waiting_list_entries(db, user["clinic_id"], [dup]))[0]
        return {"duplicate": True, "entry": dup}

    @api.post("/waiting-list")
    async def create_waiting_list(payload: WaitingListCreateIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        try:
            validate_create_payload(payload)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if payload.patient_id and not payload.is_new_patient:
            p = await db.patients.find_one(
                scope(user, {"id": payload.patient_id}),
                {"_id": 0, "id": 1},
            )
            if not p:
                raise HTTPException(status_code=404, detail="Patient not found")
        dup = await find_active_duplicate(
            db,
            user["clinic_id"],
            desired_date=payload.desired_date,
            treatment_name_snapshot=payload.treatment_name_snapshot,
            treatment_id=payload.treatment_id,
            patient_id=payload.patient_id if not payload.is_new_patient else None,
            new_patient_phone=payload.new_patient_phone if payload.is_new_patient else None,
        )
        if dup and not payload.duplicate_override:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "duplicate_waiting_list",
                    "message": "This patient already has an active waiting list entry for this date/treatment.",
                    "entry_id": dup.get("id"),
                },
            )
        doc = await build_entry_doc(db, user["clinic_id"], user, payload)
        doc["status_changed_by"] = user.get("id")
        doc["status_changed_at"] = _now_iso()
        await db.waiting_list_entries.insert_one(doc)
        doc.pop("_id", None)
        await log_waiting_list(
            db,
            user,
            "created",
            doc,
            meta={"duplicate_override": payload.duplicate_override} if dup and payload.duplicate_override else None,
        )
        enriched = (await enrich_waiting_list_entries(db, user["clinic_id"], [doc]))[0]
        return enriched

    @api.get("/waiting-list/{entry_id}")
    async def get_waiting_list(entry_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        entry = await _get_entry(user, entry_id)
        return (await enrich_waiting_list_entries(db, user["clinic_id"], [entry]))[0]

    @api.put("/waiting-list/{entry_id}")
    async def update_waiting_list(
        entry_id: str,
        payload: WaitingListUpdateIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_update(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        existing = await _get_entry(user, entry_id)
        old_snapshot = dict(existing)
        upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        if "status" in upd and upd["status"] not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if payload.treatment_id and not payload.treatment_name_snapshot:
            t = await db.treatments_catalog.find_one(
                {"clinic_id": user["clinic_id"], "id": payload.treatment_id},
                {"_id": 0, "name": 1},
            )
            if t:
                upd["treatment_name_snapshot"] = t.get("name")
        if payload.preferred_staff_id:
            u = await db.users.find_one({"id": payload.preferred_staff_id}, {"_id": 0, "name": 1})
            upd["preferred_staff_name_snapshot"] = u.get("name") if u else None
        if upd:
            dup = None
            if not payload.duplicate_override and (
                "desired_date" in upd or "treatment_id" in upd or "treatment_name_snapshot" in upd
            ):
                dup = await find_active_duplicate(
                    db,
                    user["clinic_id"],
                    desired_date=upd.get("desired_date", existing.get("desired_date")),
                    treatment_name_snapshot=upd.get("treatment_name_snapshot", existing.get("treatment_name_snapshot")),
                    treatment_id=upd.get("treatment_id", existing.get("treatment_id")),
                    patient_id=existing.get("patient_id"),
                    new_patient_phone=existing.get("new_patient_phone"),
                    exclude_id=entry_id,
                )
            if dup:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "duplicate_waiting_list",
                        "message": "This patient already has an active waiting list entry for this date/treatment.",
                    },
                )
            upd["updated_at"] = _now_iso()
            if "status" in upd:
                upd["status_changed_by"] = user.get("id")
                upd["status_changed_at"] = _now_iso()
                if upd["status"] == "booked":
                    upd["booked_at"] = _now_iso()
            await db.waiting_list_entries.update_one(scope(user, {"id": entry_id}), {"$set": upd})
        entry = await _get_entry(user, entry_id)
        await log_waiting_list(db, user, "updated", entry, old_value=old_snapshot)
        return (await enrich_waiting_list_entries(db, user["clinic_id"], [entry]))[0]

    @api.post("/waiting-list/{entry_id}/status")
    async def update_waiting_list_status(
        entry_id: str,
        payload: WaitingListStatusIn,
        user: dict = Depends(get_current_user),
    ):
        if payload.status == "cancelled":
            if not _can_cancel(user):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        elif not _can_update(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        if payload.status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if payload.cancelled_reason and payload.cancelled_reason not in CANCEL_REASONS:
            raise HTTPException(status_code=400, detail="Invalid cancel reason")
        existing = await _get_entry(user, entry_id)
        old_snapshot = dict(existing)
        upd = {
            "status": payload.status,
            "status_changed_by": user.get("id"),
            "status_changed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        if payload.cancelled_reason:
            upd["cancelled_reason"] = payload.cancelled_reason
        if payload.note:
            upd["status_note"] = payload.note
        if payload.status == "booked":
            upd["booked_at"] = _now_iso()
        await db.waiting_list_entries.update_one(scope(user, {"id": entry_id}), {"$set": upd})
        entry = await _get_entry(user, entry_id)
        action = "status_changed"
        if payload.status == "contacted":
            action = "marked_contacted"
        elif payload.status == "slot_offered":
            action = "slot_offered"
        elif payload.status == "cancelled":
            action = "cancelled"
        elif payload.status == "booked":
            action = "marked_booked"
        await log_waiting_list(
            db,
            user,
            action,
            entry,
            old_value=old_snapshot,
            reason=payload.note or payload.cancelled_reason,
        )
        return (await enrich_waiting_list_entries(db, user["clinic_id"], [entry]))[0]

    @api.post("/waiting-list/{entry_id}/convert")
    async def convert_waiting_list(
        entry_id: str,
        payload: WaitingListConvertIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_convert(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        existing = await _get_entry(user, entry_id)
        old_snapshot = dict(existing)
        booking = await db.bookings.find_one(
            scope(user, {"id": payload.appointment_id}),
            {"_id": 0},
        )
        if not booking:
            raise HTTPException(status_code=404, detail="Appointment not found")
        now = _now_iso()
        upd = {
            "status": "booked",
            "linked_appointment_id": payload.appointment_id,
            "booked_at": now,
            "status_changed_by": user.get("id"),
            "status_changed_at": now,
            "updated_at": now,
        }
        await db.waiting_list_entries.update_one(scope(user, {"id": entry_id}), {"$set": upd})
        await db.bookings.update_one(
            scope(user, {"id": payload.appointment_id}),
            {"$set": {"waiting_list_id": entry_id}},
        )
        entry = await _get_entry(user, entry_id)
        await log_waiting_list(
            db,
            user,
            "converted_to_appointment",
            entry,
            old_value=old_snapshot,
            reason=payload.note,
            meta={"appointment_id": payload.appointment_id},
        )
        return (await enrich_waiting_list_entries(db, user["clinic_id"], [entry]))[0]
