"""Unit tests for entitlement gift card line matching and amounts."""
from gift_card_redemption import find_entitlement_match_line, line_payable_amount
from gift_card_models import normalize_gift_card_document


def test_line_payable_amount_from_total():
    assert line_payable_amount({"total": 150_000}) == 150_000


def test_find_treatment_match_pos_service_line():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "treatment_catalog_id": "tr-1",
    })
    items = [{
        "item_type": "service",
        "treatment_catalog_id": "tr-1",
        "unit_price": 500_000,
        "qty": 1,
        "discount": 0,
    }]
    match = find_entitlement_match_line(card, items)
    assert match is not None
    assert line_payable_amount(match) == 500_000


def test_treatment_no_match():
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "treatment_catalog_id": "tr-1",
        "treatment_name_snapshot": "Facial",
    })
    items = [{"item_type": "service", "treatment_catalog_id": "other", "total": 100_000}]
    assert find_entitlement_match_line(card, items) is None


def test_find_package_match_invoice_line():
    card = normalize_gift_card_document({
        "gift_card_type": "package",
        "package_catalog_id": "pkg-1",
    })
    items = [{
        "item_type": "package",
        "catalog_id": "pkg-1",
        "line_total_idr": 6_000_000,
    }]
    match = find_entitlement_match_line(card, items)
    assert match is not None
    assert line_payable_amount(match) == 6_000_000


def test_redemption_amount_not_one_for_entitlement():
    """Entitlement lines should use line value, not Rp 1."""
    card = normalize_gift_card_document({
        "gift_card_type": "treatment",
        "treatment_catalog_id": "tr-1",
        "original_value": 750_000,
    })
    items = [{
        "item_type": "service",
        "treatment_catalog_id": "tr-1",
        "total": 750_000,
    }]
    match = find_entitlement_match_line(card, items)
    amt = line_payable_amount(match)
    assert amt == 750_000
    assert amt != 1
