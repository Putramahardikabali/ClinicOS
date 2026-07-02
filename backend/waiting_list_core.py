"""Waiting list business logic."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from waiting_list_models import ACTIVE_STATUSES, VALID_PRIORITIES, VALID_STATUSES, VALID_TIME_TYPES


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_phone(phone: Optional[str]) -> str:
    return re.sub(r"\D", "", (phone or "").strip())


def _norm_treatment(name: Optional[str]) -> str:
    return (name or "").strip().lower()


def patient_display_name(entry: dict) -> str:
    if entry.get("patient_id"):
        return entry.get("patient_name") or "Unknown patient"
    return (entry.get("new_patient_name") or "").strip() or "New patient"


def patient_contact(entry: dict) -> str:
    if entry.get("patient_id"):
        return entry.get("patient_phone") or ""
    return entry.get("new_patient_phone") or ""


async def enrich_waiting_list_entries(db, clinic_id: str, items: List[dict]) -> List[dict]:
    if not items:
        return items
    patient_ids = list({e["patient_id"] for e in items if e.get("patient_id")})
    patients = {}
    if patient_ids:
        async for p in db.patients.find(
            {"id": {"$in": patient_ids}, "clinic_id": clinic_id},
            {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "email": 1},
        ):
            patients[p["id"]] = p
    staff_ids = list({e["preferred_staff_id"] for e in items if e.get("preferred_staff_id")})
    staff_map = {}
    if staff_ids:
        async for u in db.users.find({"id": {"$in": staff_ids}}, {"_id": 0, "id": 1, "name": 1}):
            staff_map[u["id"]] = u
    for e in items:
        if e.get("patient_id"):
            p = patients.get(e["patient_id"])
            if p:
                e["patient_name"] = p.get("full_name")
                e["patient_phone"] = p.get("phone")
                e["patient_email"] = p.get("email")
        if e.get("preferred_staff_id") and not e.get("preferred_staff_name_snapshot"):
            u = staff_map.get(e["preferred_staff_id"])
            if u:
                e["preferred_staff_name_snapshot"] = u.get("name")
        e["display_name"] = patient_display_name(e)
        e["display_phone"] = patient_contact(e)
    return items


async def find_active_duplicate(
    db,
    clinic_id: str,
    *,
    desired_date: str,
    treatment_name_snapshot: str,
    treatment_id: Optional[str],
    patient_id: Optional[str],
    new_patient_phone: Optional[str],
    exclude_id: Optional[str] = None,
) -> Optional[dict]:
    flt: Dict[str, Any] = {
        "clinic_id": clinic_id,
        "desired_date": desired_date,
        "status": {"$in": sorted(ACTIVE_STATUSES)},
    }
    if exclude_id:
        flt["id"] = {"$ne": exclude_id}
    treatment_key = _norm_treatment(treatment_name_snapshot)
    candidates = await db.waiting_list_entries.find(flt, {"_id": 0}).to_list(200)
    phone_key = _norm_phone(new_patient_phone)
    for row in candidates:
        row_treatment = _norm_treatment(row.get("treatment_name_snapshot"))
        same_treatment = (
            (treatment_id and row.get("treatment_id") == treatment_id)
            or (treatment_key and row_treatment == treatment_key)
        )
        if not same_treatment:
            continue
        if patient_id and row.get("patient_id") == patient_id:
            return row
        if phone_key:
            row_phone = _norm_phone(row.get("new_patient_phone") or row.get("patient_phone"))
            if row_phone and row_phone == phone_key:
                return row
        if patient_id and row.get("patient_id") == patient_id:
            return row
    return None


def validate_create_payload(payload) -> None:
    if payload.is_new_patient:
        if not (payload.new_patient_name or "").strip():
            raise ValueError("Name is required for new patient")
        if not (payload.new_patient_phone or "").strip():
            raise ValueError("Contact number is required for new patient")
    elif not payload.patient_id:
        raise ValueError("Patient is required")
    if not (payload.desired_date or "").strip():
        raise ValueError("Desired date is required")
    if payload.preferred_time_type not in VALID_TIME_TYPES:
        raise ValueError("Invalid preferred time type")
    if payload.priority not in VALID_PRIORITIES:
        raise ValueError("Invalid priority")


async def build_entry_doc(db, clinic_id: str, user: dict, payload, *, existing: Optional[dict] = None) -> dict:
    now = _now_iso()
    treatment_name = (payload.treatment_name_snapshot or "").strip()
    if payload.treatment_id and not treatment_name:
        t = await db.treatments_catalog.find_one(
            {"clinic_id": clinic_id, "id": payload.treatment_id},
            {"_id": 0, "name": 1},
        )
        if t:
            treatment_name = t.get("name") or ""
    staff_name = None
    if payload.preferred_staff_id:
        u = await db.users.find_one({"id": payload.preferred_staff_id}, {"_id": 0, "name": 1})
        staff_name = u.get("name") if u else None
    doc = {
        "clinic_id": clinic_id,
        "patient_id": payload.patient_id if not payload.is_new_patient else None,
        "is_new_patient": bool(payload.is_new_patient),
        "new_patient_name": (payload.new_patient_name or "").strip() if payload.is_new_patient else None,
        "new_patient_phone": (payload.new_patient_phone or "").strip() if payload.is_new_patient else None,
        "new_patient_email": (payload.new_patient_email or "").strip() or None if payload.is_new_patient else None,
        "treatment_id": payload.treatment_id,
        "treatment_name_snapshot": treatment_name,
        "desired_date": payload.desired_date,
        "preferred_time_type": payload.preferred_time_type or "anytime",
        "preferred_time": (payload.preferred_time or "").strip() or None,
        "preferred_staff_id": payload.preferred_staff_id,
        "preferred_staff_name_snapshot": staff_name,
        "priority": payload.priority or "normal",
        "source": (payload.source or "").strip() or None,
        "notes": (payload.notes or "").strip() or None,
        "status": "waiting",
        "linked_appointment_id": None,
        "updated_at": now,
    }
    if existing:
        doc["id"] = existing["id"]
        doc["created_at"] = existing.get("created_at") or now
        doc["created_by"] = existing.get("created_by")
        doc["status"] = existing.get("status", "waiting")
        doc["linked_appointment_id"] = existing.get("linked_appointment_id")
        doc["booked_at"] = existing.get("booked_at")
    else:
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now
        doc["created_by"] = user.get("id")
    return doc


def build_summary(entries: List[dict]) -> dict:
    total = len(entries)
    booked = sum(1 for e in entries if e.get("status") == "booked")
    cancelled = sum(1 for e in entries if e.get("status") == "cancelled")
    expired = sum(1 for e in entries if e.get("status") == "expired")
    active = sum(1 for e in entries if e.get("status") in ACTIVE_STATUSES)
    not_got_slot = cancelled + expired + sum(
        1 for e in entries
        if e.get("status") in ACTIVE_STATUSES
    )
    conversion_rate = round((booked / total) * 100, 1) if total else 0.0
    return {
        "total": total,
        "active": active,
        "booked": booked,
        "cancelled": cancelled,
        "expired": expired,
        "not_got_slot": not_got_slot,
        "conversion_rate": conversion_rate,
    }
