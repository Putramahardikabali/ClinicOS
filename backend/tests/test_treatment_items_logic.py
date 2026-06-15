"""Tests for booked vs performed treatment separation."""

import pytest

from treatment_items_logic import (
    TREATMENT_OUTCOME_MESSAGE,
    filter_performed_treatment_items,
    is_performed_treatment_item,
)


class TestPerformedTreatmentFilter:
    def test_legacy_item_without_source_is_performed(self):
        assert is_performed_treatment_item({"name": "Facial"}) is True

    def test_booking_reference_excluded(self):
        assert is_performed_treatment_item({"source": "booking_reference"}) is False

    def test_unconfirmed_excluded(self):
        assert is_performed_treatment_item({"confirmed_by_staff": False}) is False

    def test_confirmed_booked_included(self):
        assert is_performed_treatment_item({"source": "confirmed_booked", "confirmed_by_staff": True}) is True

    def test_filter_mixed_items(self):
        items = [
            {"id": "1", "source": "booking_reference"},
            {"id": "2", "name": "Legacy"},
            {"id": "3", "source": "manual", "confirmed_by_staff": True},
        ]
        filtered = filter_performed_treatment_items(items)
        assert [it["id"] for it in filtered] == ["2", "3"]

    def test_outcome_message_present(self):
        assert "No performed treatment" in TREATMENT_OUTCOME_MESSAGE
