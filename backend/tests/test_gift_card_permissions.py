"""Gift card permission catalog and system role defaults."""
import pytest

from permissions import (
    ALL_PERMISSION_KEYS,
    SYSTEM_ROLE_DEFINITIONS,
    normalize_gift_card_permissions,
    user_has_permission,
)

GC_KEYS = frozenset({
    "gift_cards.view",
    "gift_cards.create",
    "gift_cards.redeem",
    "gift_cards.cancel",
})


def _role(role_key: str) -> dict:
    return next(s for s in SYSTEM_ROLE_DEFINITIONS if s["role_key"] == role_key)


def test_gift_card_keys_in_catalog():
    for key in GC_KEYS:
        assert key in ALL_PERMISSION_KEYS
    assert "gift_cards.manage" not in ALL_PERMISSION_KEYS


def test_owner_has_all_gift_card_permissions():
    perms = set(_role("super_admin")["permissions"])
    assert GC_KEYS <= perms


def test_manager_gift_card_permissions():
    perms = set(_role("manager")["permissions"])
    assert GC_KEYS <= perms
    assert "gift_cards.manage" not in perms


def test_fo_gift_card_permissions():
    perms = set(_role("fo")["permissions"])
    assert {"gift_cards.view", "gift_cards.create", "gift_cards.redeem"} <= perms
    assert "gift_cards.cancel" not in perms


def test_accounting_view_only():
    perms = set(_role("accounting")["permissions"])
    assert "gift_cards.view" in perms
    assert not (GC_KEYS - {"gift_cards.view"}) & perms


@pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
def test_clinical_roles_no_gift_cards(role_key):
    perms = _role(role_key)["permissions"]
    assert not any(p.startswith("gift_cards.") for p in perms)


def test_legacy_manage_grants_cancel():
    user = {"permissions": ["gift_cards.manage"]}
    assert user_has_permission(user, "gift_cards.cancel")
    assert not user_has_permission(user, "gift_cards.create")


def test_normalize_manage_to_cancel():
    assert normalize_gift_card_permissions({"gift_cards.manage", "gift_cards.view"}) == {
        "gift_cards.cancel",
        "gift_cards.view",
    }
