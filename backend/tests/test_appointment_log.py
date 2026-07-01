"""Tests for appointment activity log endpoint helpers."""

from audit_log import MODULE_APPOINTMENT, MODULE_SCHEDULE


def test_appointment_log_modules():
    assert MODULE_APPOINTMENT == "appointment"
    assert MODULE_SCHEDULE == "schedule"
