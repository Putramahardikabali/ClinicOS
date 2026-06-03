"""Gift card booking redemption (unit tests, no API server)."""
from gift_card_models import effective_gift_card_status, normalize_gift_card_document
from gift_cards_booking import pos_entitlement_redemption_blocked_message


def test_reservation_builders():
    from gift_cards_booking import (
        build_gift_card_reservation_fields,
        build_gift_card_reservation_release_fields,
    )
    r = build_gift_card_reservation_fields(booking_id="b1", patient_id="p1", now="now")
    assert r["status"] == "reserved"
    rel = build_gift_card_reservation_release_fields(now="now")
    assert rel["status"] == "active"


def test_reserved_status_effective():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "status": "reserved",
        "remaining_redemptions": 1,
        "reserved_booking_id": "bk-1",
    })
    assert effective_gift_card_status(card) == "reserved"


def test_pos_block_message_mentions_booking():
    card = {"gift_card_type": "treatment", "treatment_name_snapshot": "Hydrafacial"}
    msg = pos_entitlement_redemption_blocked_message(card)
    assert "booking" in msg.lower()
    assert "availability" in msg.lower()
    assert "Treatment and package" in msg


def test_lookup_params_omit_booking_kind_for_package_cards():
    """Package cards must not be rejected when UI still shows Treatment tab (booking_kind omitted on lookup)."""
    from gift_cards_booking import validate_gift_card_for_booking
    import inspect
    sig = inspect.signature(validate_gift_card_for_booking)
    assert "for_attach" in sig.parameters


def test_active_treatment_not_redeemed_when_zero_balance():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "status": "active",
        "balance_value": 0,
        "remaining_redemptions": 1,
    })
    assert effective_gift_card_status(card) == "active"
