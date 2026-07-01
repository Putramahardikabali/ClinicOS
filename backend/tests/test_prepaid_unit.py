"""Unit tests for prepaid models (no API server)."""
import re

from prepaid_models import PREPAID_CODE_PATTERN, effective_prepaid_status, normalize_prepaid_code

PP_CODE_RE = re.compile(PREPAID_CODE_PATTERN)


def test_normalize_prepaid_code():
    assert normalize_prepaid_code(" pp-abcd-efgh ") == "PP-ABCD-EFGH"


def test_effective_status_partially_used():
    doc = {"status": "active", "original_amount_idr": 2_000_000, "remaining_balance_idr": 500_000}
    assert effective_prepaid_status(doc) == "partially_used"


def test_effective_status_used():
    doc = {"status": "active", "original_amount_idr": 1_000_000, "remaining_balance_idr": 0}
    assert effective_prepaid_status(doc) == "used"


def test_effective_status_expired():
    doc = {"status": "active", "original_amount_idr": 1_000_000, "remaining_balance_idr": 1_000_000, "expiry_date": "2000-01-01"}
    assert effective_prepaid_status(doc) == "expired"


def test_code_pattern_example():
    assert PP_CODE_RE.match("PP-8K4P-29LM")
