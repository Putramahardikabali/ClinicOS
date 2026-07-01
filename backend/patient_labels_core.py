"""Patient label catalog, assignments, and patient enrichment."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from patient_labels_models import (
    DEFAULT_BLACKLIST_LABEL,
    SYSTEM_LABEL_KEY_BLACKLIST,
    _now_iso,
    assignment_to_api,
    is_blacklist_chip,
    label_to_api,
    patient_label_chip,
)

DEFAULT_PATIENT_LABELS_SETTINGS = {
    "blacklist_booking_policy": "require_confirmation",
    "fo_can_assign_labels": True,
}


async def ensure_default_patient_labels(db, clinic_id: str, user: Optional[dict] = None) -> None:
    existing = await db.patient_labels.find_one(
        {"clinic_id": clinic_id, "system_key": SYSTEM_LABEL_KEY_BLACKLIST},
        {"_id": 1},
    )
    if existing:
        return
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        **DEFAULT_BLACKLIST_LABEL,
        "created_by": user.get("id") if user else None,
        "created_by_name_snapshot": (user or {}).get("name") or "System",
        "created_at": now,
        "updated_at": now,
    }
    await db.patient_labels.insert_one(doc)


async def list_clinic_labels(db, clinic_id: str, *, include_inactive: bool = False) -> List[dict]:
    await ensure_default_patient_labels(db, clinic_id)
    flt: Dict[str, Any] = {"clinic_id": clinic_id}
    if not include_inactive:
        flt["active"] = {"$ne": False}
    rows = await db.patient_labels.find(flt, {"_id": 0}).sort("name", 1).to_list(500)
    return [label_to_api(r) for r in rows]


async def get_label(db, clinic_id: str, label_id: str) -> Optional[dict]:
    raw = await db.patient_labels.find_one({"clinic_id": clinic_id, "id": label_id}, {"_id": 0})
    return label_to_api(raw) if raw else None


async def get_labels_map(db, clinic_id: str, label_ids: List[str]) -> Dict[str, dict]:
    if not label_ids:
        return {}
    rows = await db.patient_labels.find(
        {"clinic_id": clinic_id, "id": {"$in": label_ids}},
        {"_id": 0},
    ).to_list(len(label_ids))
    return {r["id"]: label_to_api(r) for r in rows}


async def list_patient_assignments(db, clinic_id: str, patient_id: str, *, active_only: bool = True) -> List[dict]:
    flt: Dict[str, Any] = {"clinic_id": clinic_id, "patient_id": patient_id}
    if active_only:
        flt["removed_at"] = None
    rows = await db.patient_label_assignments.find(flt, {"_id": 0}).sort("assigned_at", -1).to_list(100)
    label_ids = list({r["label_id"] for r in rows})
    labels_map = await get_labels_map(db, clinic_id, label_ids)
    return [assignment_to_api(r, labels_map.get(r.get("label_id") or "")) for r in rows]


async def enrich_patients_with_labels(db, clinic_id: str, patients: List[dict]) -> None:
    if not patients or not clinic_id:
        return
    patient_ids = [p.get("id") for p in patients if p.get("id")]
    if not patient_ids:
        return
    rows = await db.patient_label_assignments.find(
        {"clinic_id": clinic_id, "patient_id": {"$in": patient_ids}, "removed_at": None},
        {"_id": 0},
    ).to_list(5000)
    if not rows:
        for p in patients:
            p["patient_labels"] = []
            p["is_blacklisted"] = False
        return
    label_ids = list({r["label_id"] for r in rows})
    labels_map = await get_labels_map(db, clinic_id, label_ids)
    by_patient: Dict[str, List[dict]] = {pid: [] for pid in patient_ids}
    for row in rows:
        pid = row.get("patient_id")
        lbl = labels_map.get(row.get("label_id") or "")
        if pid and lbl and lbl.get("active", True):
            by_patient.setdefault(pid, []).append(patient_label_chip(row, lbl))
    for p in patients:
        chips = by_patient.get(p.get("id") or "", [])
        p["patient_labels"] = chips
        p["is_blacklisted"] = is_blacklist_chip(chips)


async def assign_label(
    db,
    user: dict,
    *,
    patient_id: str,
    label_id: str,
    notes: Optional[str] = None,
) -> dict:
    clinic_id = user["clinic_id"]
    patient = await db.patients.find_one({"clinic_id": clinic_id, "id": patient_id}, {"_id": 0, "id": 1})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    label = await db.patient_labels.find_one({"clinic_id": clinic_id, "id": label_id}, {"_id": 0})
    if not label or label.get("active") is False:
        raise HTTPException(status_code=404, detail="Label not found")
    existing = await db.patient_label_assignments.find_one(
        {"clinic_id": clinic_id, "patient_id": patient_id, "label_id": label_id, "removed_at": None},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="Label already assigned to this patient")
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "label_id": label_id,
        "notes": (notes or "").strip() or None,
        "assigned_by": user.get("id"),
        "assigned_by_name_snapshot": user.get("name") or "",
        "assigned_at": now,
        "removed_by": None,
        "removed_at": None,
    }
    await db.patient_label_assignments.insert_one(doc)
    return assignment_to_api(doc, label_to_api(label))


async def remove_label_assignment(
    db,
    user: dict,
    *,
    patient_id: str,
    assignment_id: str,
) -> dict:
    clinic_id = user["clinic_id"]
    row = await db.patient_label_assignments.find_one(
        {"clinic_id": clinic_id, "patient_id": patient_id, "id": assignment_id, "removed_at": None},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Label assignment not found")
    now = _now_iso()
    await db.patient_label_assignments.update_one(
        {"id": assignment_id},
        {"$set": {"removed_at": now, "removed_by": user.get("id"), "removed_by_name_snapshot": user.get("name") or ""}},
    )
    row["removed_at"] = now
    row["removed_by"] = user.get("id")
    label = await get_label(db, clinic_id, row.get("label_id") or "")
    return assignment_to_api(row, label)


async def get_patient_labels_settings(db, clinic_id: str) -> dict:
    s = await db.settings.find_one({"clinic_id": clinic_id, "id": "global"}, {"_id": 0, "patient_labels": 1})
    raw = (s or {}).get("patient_labels") or {}
    return {**DEFAULT_PATIENT_LABELS_SETTINGS, **raw}


async def update_patient_labels_settings(db, clinic_id: str, patch: dict) -> dict:
    current = await get_patient_labels_settings(db, clinic_id)
    merged = {**current, **{k: v for k, v in patch.items() if v is not None}}
    if merged.get("blacklist_booking_policy") not in ("warning_only", "require_confirmation", "block"):
        raise HTTPException(status_code=400, detail="Invalid blacklist_booking_policy")
    await db.settings.update_one(
        {"clinic_id": clinic_id, "id": "global"},
        {"$set": {"patient_labels": merged}},
        upsert=True,
    )
    return merged


def blacklist_info_from_labels(labels: List[dict]) -> Dict[str, Any]:
    for lb in labels or []:
        if (lb.get("system_key") or "").strip().lower() == SYSTEM_LABEL_KEY_BLACKLIST:
            return {"active": True, "label": lb.get("name") or "Blacklist", "reason": lb.get("notes") or ""}
        if (lb.get("name") or "").strip().lower() == "blacklist":
            return {"active": True, "label": lb.get("name") or "Blacklist", "reason": lb.get("notes") or ""}
    return {"active": False, "label": "", "reason": ""}
