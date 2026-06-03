"""Permission defaults for patient wallet."""
import pytest

from permissions import SYSTEM_ROLE_DEFINITIONS

WALLET_KEYS = frozenset({"wallet.view", "wallet.adjust", "wallet.use", "wallet.export"})


def _role(key):
    return next(s for s in SYSTEM_ROLE_DEFINITIONS if s["role_key"] == key)


def test_owner_has_all_wallet_permissions():
    assert WALLET_KEYS <= set(_role("super_admin")["permissions"])


def test_manager_has_all_wallet_permissions():
    assert WALLET_KEYS <= set(_role("manager")["permissions"])


def test_fo_can_view_and_use_not_adjust():
    perms = set(_role("fo")["permissions"])
    assert "wallet.view" in perms
    assert "wallet.use" in perms
    assert "wallet.adjust" not in perms
    assert "wallet.export" not in perms


def test_accounting_view_and_export_only():
    perms = set(_role("accounting")["permissions"])
    assert "wallet.view" in perms
    assert "wallet.export" in perms
    assert "wallet.adjust" not in perms
    assert "wallet.use" not in perms


@pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
def test_clinical_no_wallet(role_key):
    assert not (WALLET_KEYS & set(_role(role_key)["permissions"]))
