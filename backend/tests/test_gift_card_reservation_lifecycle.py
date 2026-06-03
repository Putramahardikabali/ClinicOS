"""Gift card reserve / release lifecycle (unit tests, no DB)."""
from gift_card_models import effective_gift_card_status, normalize_gift_card_document
from gift_cards_booking import (
    build_gift_card_reservation_fields,
    build_gift_card_reservation_release_fields,
)


def test_reservation_fields_set_reserved_not_redeemed():
    fields = build_gift_card_reservation_fields(
        booking_id="bk-1",
        patient_id="pat-1",
        now="2026-06-01T12:00:00+00:00",
    )
    assert fields["status"] == "reserved"
    assert fields["reserved_booking_id"] == "bk-1"
    assert fields["reserved_patient_id"] == "pat-1"
    assert fields["reserved_at"]
    assert "redeemed" not in fields


def test_release_fields_restore_active():
    fields = build_gift_card_reservation_release_fields(now="2026-06-01T13:00:00+00:00")
    assert fields["status"] == "active"
    assert fields["reserved_booking_id"] is None
    assert fields["reserved_patient_id"] is None
    assert fields["reserved_at"] is None


def test_package_card_reserved_effective_status():
    card = normalize_gift_card_document({
        "gift_card_type": "package",
        "status": "reserved",
        "remaining_redemptions": 1,
        "reserved_booking_id": "bk-pkg",
        "reserved_patient_id": "pat-1",
        "reserved_at": "2026-06-01T12:00:00+00:00",
    })
    assert effective_gift_card_status(card) == "reserved"


def test_treatment_card_reserved_still_shows_remaining_entitlement():
    from gift_card_models import gift_card_remaining_display

    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "status": "reserved",
        "remaining_redemptions": 1,
    })
    disp = gift_card_remaining_display(card)
    assert "treatment" in (disp.get("label") or disp.get("text") or "").lower()
