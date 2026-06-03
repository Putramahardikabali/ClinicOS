"""Permission defaults for refund/void/correction flows."""
import pytest

from permissions import SYSTEM_ROLE_DEFINITIONS

CORRECTION_KEYS = frozenset({
    "pos.cancel",
    "payments.void",
    "refunds.view",
    "refunds.create",
})


def _role(role_key: str) -> dict:
    return next(s for s in SYSTEM_ROLE_DEFINITIONS if s["role_key"] == role_key)


def test_owner_has_all_correction_permissions():
    perms = set(_role("super_admin")["permissions"])
    assert CORRECTION_KEYS <= perms


def test_manager_has_all_correction_permissions():
    perms = set(_role("manager")["permissions"])
    assert CORRECTION_KEYS <= perms


def test_fo_can_cancel_and_void_before_closing():
    perms = set(_role("fo")["permissions"])
    assert "pos.cancel" in perms
    assert "payments.void" in perms
    assert "refunds.create" in perms
    assert "refunds.view" not in perms


def test_accounting_refunds_view_only():
    perms = set(_role("accounting")["permissions"])
    assert "refunds.view" in perms
    assert "refunds.create" not in perms
    assert "pos.cancel" not in perms
    assert "payments.void" not in perms


@pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
def test_clinical_roles_no_correction_permissions(role_key):
    perms = set(_role(role_key)["permissions"])
    assert not (CORRECTION_KEYS & perms)
