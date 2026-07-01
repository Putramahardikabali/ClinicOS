"""Unit tests for patient label models and helpers (no API server)."""
from patient_labels_core import blacklist_info_from_labels
from patient_labels_models import (
    SYSTEM_LABEL_KEY_BLACKLIST,
    is_blacklist_chip,
    patient_label_chip,
)


def test_is_blacklist_chip_by_system_key():
    labels = [{"system_key": SYSTEM_LABEL_KEY_BLACKLIST, "name": "Blacklist"}]
    assert is_blacklist_chip(labels) is True


def test_is_blacklist_chip_by_name():
    labels = [{"name": "Blacklist", "system_key": None}]
    assert is_blacklist_chip(labels) is True


def test_is_blacklist_chip_false_for_other_labels():
    labels = [{"name": "VIP", "system_key": None}]
    assert is_blacklist_chip(labels) is False


def test_patient_label_chip_includes_notes():
    assignment = {
        "id": "a1",
        "notes": "Repeated no-show",
        "assigned_at": "2026-01-01T00:00:00+00:00",
        "assigned_by_name_snapshot": "Manager",
    }
    label = {
        "id": "l1",
        "name": "Blacklist",
        "color": "#DC2626",
        "type": "system",
        "severity": "danger",
        "system_key": SYSTEM_LABEL_KEY_BLACKLIST,
    }
    chip = patient_label_chip(assignment, label)
    assert chip["notes"] == "Repeated no-show"
    assert chip["name"] == "Blacklist"
    assert chip["severity"] == "danger"


def test_blacklist_info_from_labels():
    labels = [{"system_key": SYSTEM_LABEL_KEY_BLACKLIST, "name": "Blacklist", "notes": "Unpaid balance"}]
    info = blacklist_info_from_labels(labels)
    assert info["active"] is True
    assert info["label"] == "Blacklist"
    assert info["reason"] == "Unpaid balance"


def test_blacklist_info_empty():
    assert blacklist_info_from_labels([])["active"] is False
