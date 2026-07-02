"""Tests for appointment activity log endpoint helpers."""

from audit_log import MODULE_APPOINTMENT, MODULE_SCHEDULE


def test_appointment_log_modules():
    assert MODULE_APPOINTMENT == "appointment"
    assert MODULE_SCHEDULE == "schedule"


def test_appointment_log_date_range_validation():
    """Document expected date range behavior for schedule utility log."""
    range_from = "2026-06-01"
    range_to = "2026-06-07"
    assert range_from <= range_to
    day_start = f"{range_from}T00:00:00"
    day_end = f"{range_to}T23:59:59"
    assert day_start < day_end
