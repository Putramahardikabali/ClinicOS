"""Unit tests for public booking patient match/create marketing fields."""
import pytest
from fastapi import HTTPException

from public_booking_patient import (
    marketing_backfill_for_existing,
    normalize_public_marketing_fields,
)


class TestNormalizePublicMarketingFields:
    def test_empty_when_nothing_submitted(self):
        assert normalize_public_marketing_fields() == {}

    def test_normalizes_valid_marketing_fields(self):
        out = normalize_public_marketing_fields(
            nationality="Indonesia",
            nationality_code="ID",
            patient_source="instagram",
            source_detail="  Summer campaign  ",
        )
        assert out["nationality"] == "Indonesia"
        assert out["nationality_code"] == "ID"
        assert out["patient_source"] == "instagram"
        assert out["source_detail"] == "Summer campaign"

    def test_rejects_invalid_source(self):
        with pytest.raises(HTTPException) as exc:
            normalize_public_marketing_fields(patient_source="not_a_real_source")
        assert exc.value.status_code == 400


class TestMarketingBackfillForExisting:
    def test_fills_only_empty_fields(self):
        existing = {
            "nationality": "Singapore",
            "nationality_code": "SG",
            "patient_source": "google",
            "source_detail": "Existing detail",
        }
        marketing = {
            "nationality": "Indonesia",
            "nationality_code": "ID",
            "patient_source": "instagram",
            "source_detail": "New detail",
        }
        assert marketing_backfill_for_existing(existing, marketing) == {}

    def test_backfills_missing_marketing_fields(self):
        existing = {"nationality": "", "patient_source": "google"}
        marketing = {
            "nationality": "Indonesia",
            "nationality_code": "ID",
            "patient_source": "instagram",
            "source_detail": "Hotel XYZ",
        }
        backfill = marketing_backfill_for_existing(existing, marketing)
        assert backfill == {
            "nationality": "Indonesia",
            "nationality_code": "ID",
            "source_detail": "Hotel XYZ",
        }

    def test_backfills_when_fields_missing(self):
        existing = {}
        marketing = {"patient_source": "referral", "source_detail": "Dr. Lee"}
        assert marketing_backfill_for_existing(existing, marketing) == marketing
