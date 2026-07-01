"""Unit tests for patient spending history helpers."""
from patient_spending_history import (
    _build_summary,
    _invoice_line_total,
    _matches_filters,
    _row,
    _slug_name,
)


def test_invoice_line_total_prefers_line_total():
    assert _invoice_line_total({"line_total_idr": 150000, "unit_price_idr": 100000, "quantity": 1}) == 150000


def test_matches_filters_source():
    row = _row(row_id="1", at="2026-01-01", source="invoice", item_type="treatment")
    assert _matches_filters(row, source="invoice", item_type=None, payment_status=None, search=None)
    assert not _matches_filters(row, source="pos", item_type=None, payment_status=None, search=None)


def test_matches_filters_search():
    row = _row(row_id="1", at="2026-01-01", source="invoice", item_name="Botox treatment", reference_number="INV-001")
    assert _matches_filters(row, source=None, item_type=None, payment_status=None, search="botox")
    assert not _matches_filters(row, source=None, item_type=None, payment_status=None, search="facial")


def test_build_summary_totals():
    rows = [
        _row(row_id="p1", at="2026-01-01", source="prepaid", item_type="prepaid", line_total_idr=500000, row_kind="prepaid_redemption"),
        _row(row_id="p2", at="2026-01-01", source="package", item_type="package", line_total_idr=2000000, row_kind="purchase"),
        _row(row_id="p3", at="2026-01-01", source="pos", item_type="product", line_total_idr=150000, row_kind="purchase"),
    ]
    invoices = [{"amount_paid": 1000000, "remaining_balance": 200000, "payment_status": "partial", "paid_at": "2026-02-01"}]
    pos_sales = [{"amount_paid": 300000, "status": "paid", "paid_at": "2026-02-02"}]
    prepaid = [{"original_amount_idr": 500000, "remaining_balance_idr": 200000, "status": "active"}]
    summary = _build_summary(rows, invoices, pos_sales, prepaid)
    assert summary["total_cash_paid_idr"] == 1300000
    assert summary["outstanding_balance_idr"] == 200000
    assert summary["total_prepaid_purchased_idr"] == 500000
    assert summary["total_prepaid_redeemed_idr"] == 500000
    assert summary["total_package_purchases_idr"] == 2000000
    assert summary["total_product_purchases_idr"] == 150000


def test_slug_name():
    assert _slug_name("Jane Doe") == "jane-doe"
