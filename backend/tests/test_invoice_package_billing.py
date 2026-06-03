"""Invoice package billing helpers."""
from invoices import (
    _finalize_item_billing_fields,
    _item_cash_due,
    _item_gross_value,
    compute_invoice_totals,
)


def test_package_paid_line_has_zero_cash_due():
    item = {
        "item_type": "treatment",
        "unit_price_idr": 500_000,
        "quantity": 1,
        "paid_by": "package",
        "original_treatment_value": 500_000,
        "amount_charged": 0,
        "line_total_idr": 0,
        "patient_package_id": "pkg-1",
        "package_usage_id": "usage-1",
    }
    assert _item_cash_due(item) == 0
    assert _item_gross_value(item) == 500_000


def test_finalize_treatment_line_defaults():
    item = _finalize_item_billing_fields({
        "item_type": "treatment",
        "unit_price_idr": 300_000,
        "quantity": 2,
    })
    assert item["original_treatment_value"] == 600_000
    assert item["amount_charged"] == 600_000
    assert item["line_total_idr"] == 600_000


def test_finalize_package_coverage():
    item = _finalize_item_billing_fields({
        "item_type": "treatment",
        "unit_price_idr": 400_000,
        "quantity": 1,
        "paid_by": "package",
        "patient_package_id": "pp-1",
        "package_usage_id": "u-1",
    })
    assert item["original_treatment_value"] == 400_000
    assert item["amount_charged"] == 0
    assert item["line_total_idr"] == 0
    assert item["paid_by"] == "package"


def test_compute_totals_separates_cash_and_service_value():
    items = [
        {
            "item_type": "treatment",
            "unit_price_idr": 500_000,
            "quantity": 1,
            "paid_by": "package",
            "original_treatment_value": 500_000,
            "amount_charged": 0,
            "line_total_idr": 0,
        },
        {
            "item_type": "product",
            "unit_price_idr": 100_000,
            "quantity": 1,
            "amount_charged": 100_000,
            "line_total_idr": 100_000,
        },
    ]
    totals = compute_invoice_totals(items, "none", 0)
    assert totals["subtotal"] == 100_000
    assert totals["total_amount"] == 100_000
    assert totals["service_value_subtotal"] == 600_000
    assert totals["package_covered_value"] == 500_000
