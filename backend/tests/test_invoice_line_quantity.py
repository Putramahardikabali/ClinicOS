"""Regression tests for visit treatment qty → invoice line qty mapping."""
from __future__ import annotations

from invoice_quantity import (
    line_gross_idr,
    resolve_invoice_line_quantity,
    treatment_item_quantity,
)
from invoices import _finalize_item_billing_fields


class TestQuantityHelpers:
    def test_treatment_item_reads_quantity_field(self):
        assert treatment_item_quantity({"quantity": 10}) == 10.0

    def test_treatment_item_reads_alternate_keys(self):
        assert treatment_item_quantity({"qty": 2.5}) == 2.5

    def test_treatment_item_defaults_to_one(self):
        assert treatment_item_quantity({}) == 1.0

    def test_infer_qty_from_totals(self):
        raw = {"unit_price_idr": 350_000, "original_treatment_value": 3_500_000}
        assert resolve_invoice_line_quantity(raw) == 10.0

    def test_explicit_qty_over_infer(self):
        raw = {"unit_price_idr": 350_000, "quantity": 3, "original_treatment_value": 3_500_000}
        assert resolve_invoice_line_quantity(raw) == 3.0

    def test_line_gross_idr(self):
        assert line_gross_idr(350_000, 10) == 3_500_000


class TestFinalizeItemBilling:
    def test_sets_quantity_on_item(self):
        item = _finalize_item_billing_fields({
            "item_type": "treatment",
            "unit_price_idr": 350_000,
            "original_treatment_value": 3_500_000,
        })
        assert item["quantity"] == 10.0
        assert item["amount_charged"] == 3_500_000
        assert item["line_total_idr"] == 3_500_000

    def test_missing_qty_defaults_to_one(self):
        item = _finalize_item_billing_fields({
            "item_type": "custom",
            "unit_price_idr": 100_000,
        })
        assert item["quantity"] == 1.0
        assert item["amount_charged"] == 100_000


class TestEditingQuantityUpdatesTotal:
    def test_finalize_recomputes_when_qty_changes(self):
        base = {
            "item_type": "treatment",
            "unit_price_idr": 350_000,
            "quantity": 10,
        }
        first = _finalize_item_billing_fields(dict(base))
        assert first["line_total_idr"] == 3_500_000
        base["quantity"] = 4
        second = _finalize_item_billing_fields(dict(base))
        assert second["quantity"] == 4.0
        assert second["line_total_idr"] == 1_400_000
