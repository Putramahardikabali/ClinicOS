"""Tests for booking conflict detection and override policy."""
from booking_conflicts import (
    _ranges_overlap,
    conflict_http_detail,
    user_can_override_conflict,
)


def test_ranges_overlap():
    assert _ranges_overlap(60, 90, 75, 105) is True
    assert _ranges_overlap(60, 90, 90, 120) is False
    assert _ranges_overlap(60, 120, 75, 105) is True


def test_conflict_http_detail_shape():
    detail = conflict_http_detail([{"id": "b1", "patient_name": "Jane"}])
    assert detail["code"] == "schedule_conflict"
    assert detail["conflicts"][0]["id"] == "b1"


def test_manager_can_override():
    user = {"role": "manager", "permissions": []}
    settings = {"fo_can_override_conflict": False}
    assert user_can_override_conflict(user, settings) is True


def test_fo_override_when_setting_allows():
    user = {"role": "fo", "permissions": ["appointments.create"]}
    settings = {"fo_can_override_conflict": True}
    assert user_can_override_conflict(user, settings) is True


def test_fo_blocked_when_setting_disabled():
    user = {"role": "fo", "permissions": ["appointments.create"]}
    settings = {"fo_can_override_conflict": False}
    assert user_can_override_conflict(user, settings) is False
