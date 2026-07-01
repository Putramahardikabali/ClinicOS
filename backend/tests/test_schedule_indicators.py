"""Tests for schedule card indicator enrichment."""
from schedule_indicators import (
    build_schedule_indicators,
    resolve_schedule_display_status,
)


def test_resolve_display_status_block():
    assert resolve_schedule_display_status({"status": "blocked", "booking_type": "block"}) == "block_out"


def test_resolve_display_status_treatment_started():
    booking = {"status": "checked_in", "visit_id": "v1"}
    visit = {"status": "in_progress"}
    assert resolve_schedule_display_status(booking, visit) == "treatment_started"


def test_resolve_display_status_closed_visit_submitted():
    booking = {"status": "checked_in", "visit_id": "v1"}
    visit = {"status": "submitted"}
    assert resolve_schedule_display_status(booking, visit) == "closed"


def test_profile_alert_from_guest_icon():
    meta = build_schedule_indicators(
        {"id": "b1", "status": "booked", "patient_name": "A"},
        patient={"guest_icon_information": "VIP — late history"},
        completed_visits=0,
        loyalty_tier=None,
        booking_history={},
        visit=None,
        staff_names={},
    )
    assert meta["profile_alert"]["active"] is True
    assert "VIP" in meta["profile_alert"]["label"]


def test_new_vs_recurring_patient():
    new_meta = build_schedule_indicators(
        {"id": "b1", "status": "booked"},
        patient={},
        completed_visits=0,
        loyalty_tier=None,
        booking_history={},
        visit=None,
        staff_names={},
    )
    assert new_meta["new_patient"] is True
    assert new_meta["recurring_patient"] is False

    recur_meta = build_schedule_indicators(
        {"id": "b2", "status": "booked"},
        patient={},
        completed_visits=2,
        loyalty_tier=None,
        booking_history={},
        visit=None,
        staff_names={},
    )
    assert recur_meta["new_patient"] is False
    assert recur_meta["recurring_patient"] is True


def test_specific_staff_request_flag():
    meta = build_schedule_indicators(
        {
            "id": "b1",
            "status": "booked",
            "specific_staff_requested": True,
            "requested_performer_id": "s1",
            "performer_id": "s1",
        },
        patient={},
        completed_visits=1,
        loyalty_tier=None,
        booking_history={},
        visit=None,
        staff_names={"s1": "Dr. Smith"},
    )
    assert meta["specific_staff_request"]["active"] is True
    assert meta["specific_staff_request"]["label"] == "Dr. Smith"


def test_package_use_indicator():
    meta = build_schedule_indicators(
        {"id": "b1", "status": "booked", "booking_type": "package", "treatment": "Facial Package"},
        patient={},
        completed_visits=1,
        loyalty_tier=None,
        booking_history={},
        visit=None,
        staff_names={},
    )
    assert meta["package_use"]["active"] is True
    assert meta["package_use"]["label"] == "Facial Package"


def test_loyalty_indicator():
    meta = build_schedule_indicators(
        {"id": "b1", "status": "booked"},
        patient={},
        completed_visits=3,
        loyalty_tier={"name": "Gold", "color": "#C4A574"},
        booking_history={},
        visit=None,
        staff_names={},
    )
    assert meta["loyalty"]["active"] is True
    assert meta["loyalty"]["tier_name"] == "Gold"
