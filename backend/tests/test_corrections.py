"""Unit tests for refund/void correction helpers."""
from correction_constants import CLOSING_LOCK_MESSAGE
from transaction_corrections import (
    active_gift_card_payment_total,
    active_payment_total,
)


def test_active_payment_total_excludes_voided():
    payments = [
        {"amount_idr": 100_000, "voided": False},
        {"amount_idr": 50_000, "voided": True},
        {"amount_idr": 30_000},
    ]
    assert active_payment_total(payments) == 130_000


def test_active_gift_card_payment_total():
    payments = [
        {"method": "gift_card", "amount_idr": 40_000},
        {"method": "cash", "amount_idr": 60_000},
        {"method": "gift_card", "amount_idr": 10_000, "voided": True},
    ]
    assert active_gift_card_payment_total(payments) == 40_000


def test_closing_lock_message_mentions_reopen():
    assert "closed daily closing" in CLOSING_LOCK_MESSAGE.lower()
    assert "refund" in CLOSING_LOCK_MESSAGE.lower()


def test_refund_reference_types():
    from refunds import REFUND_REFERENCE_TYPES, REFUND_METHODS

    assert "pos_sale" in REFUND_REFERENCE_TYPES
    assert "invoice" in REFUND_REFERENCE_TYPES
    assert "cash" in REFUND_METHODS
