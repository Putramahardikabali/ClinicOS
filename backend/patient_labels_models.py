"""Patient label definitions and assignments."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

LABEL_TYPES = frozenset({"custom", "system"})
LABEL_SEVERITIES = frozenset({"normal", "warning", "danger"})
BLACKLIST_BOOKING_POLICIES = frozenset({"warning_only", "require_confirmation", "block"})
SYSTEM_LABEL_KEY_BLACKLIST = "blacklist"

DEFAULT_BLACKLIST_LABEL = {
    "system_key": SYSTEM_LABEL_KEY_BLACKLIST,
    "name": "Blacklist",
    "color": "#DC2626",
    "type": "system",
    "severity": "danger",
    "description": "Patient should be treated with caution. Review before booking or billing.",
    "active": True,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PatientLabelIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    color: str = Field(default="#DC2626", max_length=20)
    severity: str = Field(default="normal")
    description: Optional[str] = Field(default=None, max_length=500)
    active: bool = True


class PatientLabelUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color: Optional[str] = Field(default=None, max_length=20)
    severity: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=500)
    active: Optional[bool] = None


class PatientLabelAssignIn(BaseModel):
    label_id: str
    notes: Optional[str] = Field(default=None, max_length=1000)


class PatientLabelsSettingsIn(BaseModel):
    blacklist_booking_policy: Optional[str] = None
    fo_can_assign_labels: Optional[bool] = None


def label_to_api(doc: dict) -> dict:
    if not doc:
        return {}
    return {
        "id": doc.get("id"),
        "clinic_id": doc.get("clinic_id"),
        "name": doc.get("name"),
        "color": doc.get("color"),
        "type": doc.get("type") or "custom",
        "severity": doc.get("severity") or "normal",
        "description": doc.get("description"),
        "system_key": doc.get("system_key"),
        "active": doc.get("active", True),
        "created_by": doc.get("created_by"),
        "created_by_name_snapshot": doc.get("created_by_name_snapshot"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def assignment_to_api(doc: dict, label: Optional[dict] = None) -> dict:
    lbl = label or {}
    return {
        "id": doc.get("id"),
        "patient_id": doc.get("patient_id"),
        "label_id": doc.get("label_id"),
        "label": label_to_api(lbl) if lbl else None,
        "notes": doc.get("notes"),
        "assigned_by": doc.get("assigned_by"),
        "assigned_by_name_snapshot": doc.get("assigned_by_name_snapshot"),
        "assigned_at": doc.get("assigned_at"),
        "removed_by": doc.get("removed_by"),
        "removed_at": doc.get("removed_at"),
    }


def patient_label_chip(assignment: dict, label: dict) -> dict:
    """Compact label for patient list/search APIs."""
    return {
        "assignment_id": assignment.get("id"),
        "label_id": label.get("id"),
        "name": label.get("name"),
        "color": label.get("color"),
        "type": label.get("type") or "custom",
        "severity": label.get("severity") or "normal",
        "system_key": label.get("system_key"),
        "notes": assignment.get("notes"),
        "assigned_at": assignment.get("assigned_at"),
        "assigned_by_name_snapshot": assignment.get("assigned_by_name_snapshot"),
    }


def is_blacklist_chip(labels: List[dict]) -> bool:
    for lb in labels or []:
        if (lb.get("system_key") or "").strip().lower() == SYSTEM_LABEL_KEY_BLACKLIST:
            return True
        if (lb.get("name") or "").strip().lower() == "blacklist":
            return True
    return False
