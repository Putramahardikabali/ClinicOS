"""Unit tests for booking detail helpers."""
from booking_detail import (
    APPOINTMENT_STATUS_LABELS,
    resolve_effective_appointment_status,
    REASON_REQUIRED_STATUSES,
)


def test_resolve_effective_treatment_started():
    booking = {"status": "checked_in", "visit_id": "v1"}
    visit = {"status": "in_progress"}
    assert resolve_effective_appointment_status(booking, visit) == "treatment_started"


def test_resolve_effective_closed():
    booking = {"status": "checked_in", "visit_id": "v1"}
    visit = {"status": "submitted"}
    assert resolve_effective_appointment_status(booking, visit) == "closed"


def test_reason_required_statuses():
    assert "cancelled" in REASON_REQUIRED_STATUSES
    assert "no_show" in REASON_REQUIRED_STATUSES


def test_status_labels():
    assert APPOINTMENT_STATUS_LABELS["booked"] == "Booked"
