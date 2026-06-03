"""Gift card business rules (unit tests, no API server)."""
import pytest
from fastapi import HTTPException

from gift_card_models import (
    effective_gift_card_status,
    gift_card_remaining_display,
    gift_card_to_api,
    normalize_gift_card_document,
    status_after_entitlement_redemption,
)
from gift_cards_core import _assert_redeemable_entitlement_card, _assert_redeemable_value_card
from pos_sales_helpers import pos_sale_category_totals


def test_cancelled_card_cannot_be_redeemed():
    card = {
        "status": "cancelled",
        "gift_card_type": "value_credit",
        "balance_value": 50_000,
        "original_value": 100_000,
    }
    with pytest.raises(HTTPException) as exc:
        _assert_redeemable_value_card(card)
    assert exc.value.status_code == 400
    assert "cancelled" in exc.value.detail.lower()


def test_active_card_is_redeemable_api_flag():
    card = {
        "status": "active",
        "gift_card_type": "value_credit",
        "balance_value": 50_000,
        "original_value": 100_000,
        "expiry_date": "2099-12-31",
    }
    api = gift_card_to_api(card)
    assert api["redeemable"] is True
    _assert_redeemable_value_card(card)


def test_pos_redemption_sale_not_counted_as_custom_revenue():
    sale = {
        "total": 30_000,
        "amount_paid": 0,
        "gift_card_payment_total_idr": 30_000,
        "items": [{
            "item_type": "custom",
            "total": 30_000,
        }],
    }
    cats = pos_sale_category_totals(sale)
    assert cats["custom_sales_idr"] == 0
    assert cats["gift_card_redemption_settled_idr"] == 30_000


def test_pos_entitlement_blocked_message():
    from gift_cards_booking import pos_entitlement_redemption_blocked_message
    msg = pos_entitlement_redemption_blocked_message({
        "gift_card_type": "package",
        "package_name_snapshot": "Premium",
    })
    assert "Treatment and package" in msg
    assert "availability" in msg.lower()


def test_entitlement_redemption_uses_line_value_not_one():
    from gift_card_redemption import find_entitlement_match_line, line_payable_amount

    card = {
        "gift_card_type": "treatment",
        "treatment_catalog_id": "t-99",
        "original_value": 400_000,
    }
    items = [{"item_type": "service", "treatment_catalog_id": "t-99", "total": 400_000}]
    match = find_entitlement_match_line(card, items)
    assert line_payable_amount(match) == 400_000
    assert line_payable_amount(match) != 1


def test_pos_gift_card_issuance_counts_as_gift_card_sales():
    sale = {
        "total": 100_000,
        "amount_paid": 100_000,
        "gift_card_payment_total_idr": 0,
        "items": [{
            "item_type": "gift_card",
            "total": 100_000,
        }],
    }
    cats = pos_sale_category_totals(sale)
    assert cats["gift_card_sales_idr"] == 100_000
    assert cats["gift_card_redemption_settled_idr"] == 0


def test_package_gift_card_active_with_zero_balance():
    card = normalize_gift_card_document({
        "gift_card_type": "package",
        "status": "active",
        "balance_value": 0,
        "original_value": 6_000_000,
        "remaining_redemptions": 1,
        "redemption_count": 0,
        "expiry_date": "2099-12-31",
    })
    assert effective_gift_card_status(card) == "active"
    api = gift_card_to_api(card)
    assert api["status"] == "active"
    assert api["redeemable"] is True
    assert api["remaining_display"]["text"] == "1 package"


def test_treatment_gift_card_redeemed_only_when_no_remaining():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "status": "redeemed",
        "balance_value": 0,
        "remaining_redemptions": 0,
        "redemption_count": 1,
    })
    assert effective_gift_card_status(card) == "redeemed"
    display = gift_card_remaining_display(card)
    assert display["label"] == "Redeemed"


def test_value_credit_redeemed_when_balance_zero():
    card = normalize_gift_card_document({
        "gift_card_type": "value_credit",
        "status": "active",
        "balance_value": 0,
        "original_value": 100_000,
    })
    assert effective_gift_card_status(card) == "redeemed"


def test_entitlement_status_after_redemption():
    assert status_after_entitlement_redemption(0) == "redeemed"
    assert status_after_entitlement_redemption(1) == "active"


def test_entitlement_card_assert_redeemable():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "status": "active",
        "remaining_redemptions": 1,
        "balance_value": 0,
    })
    _assert_redeemable_entitlement_card(card)


def test_cancelled_card_not_redeemable_api_flag():
    card = {
        "status": "cancelled",
        "gift_card_type": "value_credit",
        "balance_value": 0,
        "original_value": 100_000,
    }
    api = gift_card_to_api(card)
    assert api["redeemable"] is False
    assert api["status"] == "cancelled"
