"""Unit tests for campaign validation."""
from campaign_io import (
    apply_campaign_to_invoice_subtotal,
    campaign_applies_to_summary,
    campaign_status,
    eligible_subtotal_for_campaign,
    validate_campaign_for_invoice,
    validate_campaign_scope,
)

CLINIC = {"timezone": "Asia/Makassar"}


def test_campaign_status_active_in_range():
    c = {"active": True, "start_date": "2026-01-01", "end_date": "2026-12-31"}
    assert campaign_status(c, CLINIC, "2026-06-15") == "active"


def test_campaign_status_expired():
    c = {"active": True, "start_date": "2020-01-01", "end_date": "2020-12-31"}
    assert campaign_status(c, CLINIC, "2026-06-15") == "expired"


def test_eligible_subtotal_all_items():
    campaign = {"applies_to": "all"}
    items = [{"item_type": "treatment", "unit_price_idr": 100000, "quantity": 1}]
    assert eligible_subtotal_for_campaign(campaign, items) == 100000


def test_apply_percent_discount():
    campaign = {"discount_type": "percent", "discount_value": 30}
    pricing = apply_campaign_to_invoice_subtotal(campaign, 1000000)
    assert pricing["discount_amount_applied"] == 300000


def test_eligible_subtotal_selected_treatments_only():
    campaign = {
        "applies_to": "selected_treatments",
        "eligible_treatment_ids": ["t1"],
    }
    items = [
        {"item_type": "treatment", "catalog_id": "t1", "unit_price_idr": 1000000, "quantity": 1},
        {"item_type": "product", "catalog_id": "p1", "unit_price_idr": 500000, "quantity": 1},
    ]
    assert eligible_subtotal_for_campaign(campaign, items) == 1000000


def test_validate_scope_requires_treatments():
    err = validate_campaign_scope({"applies_to": "selected_treatments", "eligible_treatment_ids": []})
    assert err is not None


def test_campaign_applies_to_summary():
    c = {"applies_to": "selected_treatments", "eligible_treatment_ids": ["a", "b"]}
    assert "2 selected treatment" in campaign_applies_to_summary(c)


def test_apply_percent_on_eligible_only():
    campaign = {"discount_type": "percent", "discount_value": 10, "applies_to": "all"}
    pricing = apply_campaign_to_invoice_subtotal(campaign, 1000000)
    assert pricing["discount_amount_applied"] == 100000


def test_validate_blocks_below_minimum():
    campaign = {
        "active": True,
        "start_date": "2020-01-01",
        "end_date": "2099-12-31",
        "min_invoice_amount_idr": 500000,
        "applies_to": "all",
        "uses_count": 0,
    }
    err = validate_campaign_for_invoice(
        campaign,
        clinic=CLINIC,
        invoice_date="2026-06-15",
        subtotal_idr=100000,
        eligible_subtotal_idr=100000,
        items=[],
    )
    assert err is not None
