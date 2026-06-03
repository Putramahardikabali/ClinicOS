"""Unit tests for gift card code format (no API server)."""
import re

import pytest

from gift_card_codes import generate_gift_card_code, validate_gift_card_code_format
from gift_card_models import GC_CODE_PATTERN, effective_gift_card_status, is_gift_card_expired

GC_CODE_RE = re.compile(GC_CODE_PATTERN)


def test_generate_code_format():
    code = generate_gift_card_code()
    assert GC_CODE_RE.match(code), code


def test_validate_manual_code():
    assert validate_gift_card_code_format("gc-8k4p-29lm") == "GC-8K4P-29LM"


def test_validate_rejects_bad_format():
    with pytest.raises(Exception):
        validate_gift_card_code_format("GC-INVALID")


def test_effective_status_expired():
    card = {"status": "active", "expiry_date": "2000-01-01", "balance_value": 100}
    assert effective_gift_card_status(card, today="2026-06-01") == "expired"
    assert is_gift_card_expired(card, today="2026-06-01")
