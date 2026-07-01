"""Front desk patient update field filtering and marketing fields."""
import pytest
from fastapi import HTTPException

from patient_profile import (
    FO_PATIENT_EDIT_FIELDS,
    filter_patient_update_fields,
    normalize_patient_source,
    resolve_patient_profile_tabs,
    validate_patient_marketing_fields,
)


def test_fo_cannot_update_medical_history():
    user = {"role": "fo", "clinic_id": "c1"}
    upd = {
        "full_name": "Jane Doe",
        "medical_history": "Should not save",
        "notes": "Internal",
    }
    filtered = filter_patient_update_fields(user, upd)
    assert filtered == {"full_name": "Jane Doe"}
    assert "medical_history" not in filtered
    assert "notes" not in filtered


def test_fo_can_update_basic_and_marketing_fields():
    user = {"role": "fo", "clinic_id": "c1"}
    upd = {
        "phone": "+628123",
        "nationality": "Indonesia",
        "nationality_code": "ID",
        "patient_source": "instagram",
        "source_detail": "Influencer @glow",
        "allergies": "None",
    }
    filtered = filter_patient_update_fields(user, upd)
    assert filtered == upd


def test_manager_can_update_all_fields():
    user = {"role": "manager", "clinic_id": "c1"}
    upd = {"medical_history": "Hypertension", "notes": "VIP"}
    assert filter_patient_update_fields(user, upd) == upd


def test_fo_allowed_field_set_includes_marketing_fields():
    assert "nationality" in FO_PATIENT_EDIT_FIELDS
    assert "nationality_code" in FO_PATIENT_EDIT_FIELDS
    assert "patient_source" in FO_PATIENT_EDIT_FIELDS
    assert "source_detail" in FO_PATIENT_EDIT_FIELDS


@pytest.mark.parametrize("raw,expected", [
    ("Instagram", "instagram"),
    ("Walk-in", "walk_in"),
    ("Hotel / Villa", "hotel_villa"),
    ("TikTok", "tiktok"),
    ("", ""),
    (None, None),
])
def test_normalize_patient_source(raw, expected):
    assert normalize_patient_source(raw) == expected


def test_validate_patient_marketing_fields_normalizes_source():
    doc = validate_patient_marketing_fields({"patient_source": "Referral", "source_detail": " Dr. Lee "})
    assert doc["patient_source"] == "referral"
    assert doc["source_detail"] == "Dr. Lee"


def test_validate_patient_marketing_fields_normalizes_nationality_by_code():
    doc = validate_patient_marketing_fields({"nationality_code": "au"})
    assert doc["nationality_code"] == "AU"
    assert doc["nationality"] == "Australia"


def test_validate_patient_marketing_fields_normalizes_nationality_by_name():
    doc = validate_patient_marketing_fields({"nationality": "Australia"})
    assert doc["nationality_code"] == "AU"
    assert doc["nationality"] == "Australia"


def test_validate_patient_marketing_fields_rejects_invalid_nationality_code():
    with pytest.raises(HTTPException) as exc:
        validate_patient_marketing_fields({"nationality_code": "ZZ"})
    assert exc.value.status_code == 400


def test_validate_patient_marketing_fields_rejects_invalid_source():
    with pytest.raises(HTTPException) as exc:
        validate_patient_marketing_fields({"patient_source": "Billboard"})
    assert exc.value.status_code == 400


def test_resolve_patient_profile_tabs_includes_prepaid_without_crash():
    tabs = resolve_patient_profile_tabs({"role": "fo", "permissions": ["prepaid.view"]})
    assert tabs["prepaid"] is True
    assert tabs["overview"] is True
