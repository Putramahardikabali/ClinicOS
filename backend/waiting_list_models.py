"""Pydantic models for waiting list entries."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

ACTIVE_STATUSES = frozenset({"waiting", "contacted", "slot_offered"})
VALID_STATUSES = frozenset({"waiting", "contacted", "slot_offered", "booked", "cancelled", "expired"})
VALID_PRIORITIES = frozenset({"normal", "high", "vip"})
VALID_TIME_TYPES = frozenset({"anytime", "morning", "afternoon", "evening", "specific"})
VALID_SOURCES = frozenset({"walk_in", "whatsapp", "phone", "instagram", "other", ""})
CANCEL_REASONS = frozenset({
    "patient_no_longer_interested",
    "no_response",
    "duplicate",
    "other",
    "",
})


class WaitingListCreateIn(BaseModel):
    patient_id: Optional[str] = None
    is_new_patient: bool = False
    new_patient_name: Optional[str] = None
    new_patient_phone: Optional[str] = None
    new_patient_email: Optional[str] = None
    treatment_id: Optional[str] = None
    treatment_name_snapshot: str = ""
    desired_date: str
    preferred_time_type: str = "anytime"
    preferred_time: Optional[str] = None
    preferred_staff_id: Optional[str] = None
    priority: str = "normal"
    source: Optional[str] = None
    notes: Optional[str] = None
    duplicate_override: bool = False


class WaitingListUpdateIn(BaseModel):
    treatment_id: Optional[str] = None
    treatment_name_snapshot: Optional[str] = None
    desired_date: Optional[str] = None
    preferred_time_type: Optional[str] = None
    preferred_time: Optional[str] = None
    preferred_staff_id: Optional[str] = None
    priority: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    cancelled_reason: Optional[str] = None
    duplicate_override: bool = False


class WaitingListStatusIn(BaseModel):
    status: str
    cancelled_reason: Optional[str] = None
    note: Optional[str] = None


class WaitingListConvertIn(BaseModel):
    appointment_id: str
    note: Optional[str] = None
