"""Analytics v1 unit tests."""
import pytest
from fastapi import HTTPException

from clinic_analytics import (
    UNKNOWN_KEY,
    _nationality_key,
    _patient_matches_filters,
    compute_completeness,
)  # noqa: E402 — aggregation helpers only
from patient_profile import PATIENT_SOURCE_VALUES
from reports_common import (
    assert_analytics_access,
    marketing_bucket,
    marketing_label,
)


def test_marketing_bucket_unknown():
    assert marketing_bucket(None) == UNKNOWN_KEY
    assert marketing_bucket("") == UNKNOWN_KEY
    assert marketing_bucket("  ") == UNKNOWN_KEY
    assert marketing_bucket("instagram") == "instagram"


def test_marketing_label():
    assert "Unknown" in marketing_label(UNKNOWN_KEY)
    assert marketing_label("instagram", {"instagram": "Instagram"}) == "Instagram"


def test_nationality_key_prefers_code():
    p = {"nationality_code": "au", "nationality": "Australia"}
    assert _nationality_key(p) == "AU"


def test_nationality_key_unknown():
    assert _nationality_key({}) == UNKNOWN_KEY
    assert _nationality_key(None) == UNKNOWN_KEY


def test_completeness_calculation():
    patients = [
        {"nationality": "Australia", "patient_source": "instagram"},
        {"nationality": "Indonesia", "patient_source": ""},
        {"nationality": "", "patient_source": "referral"},
        {},
    ]
    c = compute_completeness(patients)
    assert c["total_patients"] == 4
    assert c["with_nationality"] == 2
    assert c["with_nationality_pct"] == 50.0
    assert c["with_patient_source"] == 2
    assert c["with_patient_source_pct"] == 50.0
    assert c["with_both"] == 1
    assert c["with_both_pct"] == 25.0


def test_completeness_counts_nationality_code_only():
    patients = [
        {"nationality_code": "AU", "nationality": ""},
        {"nationality_code": "", "nationality": ""},
        {"nationality_code": "ID"},
    ]
    c = compute_completeness(patients)
    assert c["with_nationality"] == 2
    assert c["with_nationality_pct"] == round(100 * 2 / 3, 1)


def test_patient_matches_nationality_filter():
    p = {"nationality_code": "AU", "nationality": "Australia", "patient_source": "instagram"}
    assert _patient_matches_filters(p, nationalities=["AU"]) is True
    assert _patient_matches_filters(p, nationalities=["ID"]) is False
    assert _patient_matches_filters(p, patient_sources=["instagram"]) is True
    assert _patient_matches_filters(p, patient_sources=["tiktok"]) is False


def test_assert_analytics_access_owner():
    assert_analytics_access({"role": "super_admin", "permissions": ["analytics.view"]})


def test_assert_analytics_access_manager():
    assert_analytics_access({"role": "manager", "permissions": ["analytics.view"]})


def test_assert_analytics_access_fo_blocked():
    with pytest.raises(HTTPException) as exc:
        assert_analytics_access({"role": "fo", "permissions": ["billing.view", "reports.view"]})
    assert exc.value.status_code == 403


def test_assert_analytics_access_no_permission():
    with pytest.raises(HTTPException) as exc:
        assert_analytics_access({"role": "manager", "permissions": ["reports.view"]})
    assert exc.value.status_code == 403


def test_patient_source_enum_complete():
    expected = {
        "instagram", "tiktok", "facebook", "google", "website",
        "referral", "walk_in", "whatsapp", "hotel_villa", "other",
    }
    assert expected == set(PATIENT_SOURCE_VALUES)
