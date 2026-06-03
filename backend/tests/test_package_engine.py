"""Unified package engine tests."""
from package_engine import (
    apply_patient_package_status,
    build_patient_components,
    compute_patient_package_status,
    deduct_component,
    find_eligible_component,
    normalize_package_type,
    treatment_matches,
)


def test_normalize_package_type_legacy():
    assert normalize_package_type("Series package") == "series_package"
    assert normalize_package_type("day_package") == "day_package"
    assert normalize_package_type("bundle_package") == "bundle_package"


def test_build_patient_components():
    catalog = {
        "components": [
            {"id": "c1", "treatment_id": "t1", "treatment_name_snapshot": "Facial", "quantity": 3},
            {"id": "c2", "treatment_id": "t2", "treatment_name_snapshot": "Peel", "quantity": 1},
        ],
    }
    comps = build_patient_components(catalog, 1)
    assert len(comps) == 2
    assert comps[0]["total_quantity"] == 3
    assert comps[0]["remaining_quantity"] == 3


def test_partially_used_status():
    doc = apply_patient_package_status({
        "components": [{
            "id": "pc1",
            "total_quantity": 6,
            "used_quantity": 2,
            "remaining_quantity": 4,
            "status": "partially_used",
        }],
        "expiry_date": "2099-01-01",
    })
    assert doc["status"] == "partially_used"
    assert doc["remaining_sessions"] == 4


def test_find_eligible_component_by_treatment():
    pkg = {
        "id": "pp1",
        "status": "active",
        "package_type": "bundle_package",
        "redemption_rule": "flexible",
        "components": [
            {"id": "c1", "treatment_id": "t-facial", "treatment_name_snapshot": "Facial", "remaining_quantity": 2, "status": "active"},
            {"id": "c2", "treatment_id": "t-peel", "treatment_name_snapshot": "Peel", "remaining_quantity": 1, "status": "active"},
        ],
    }
    comp = find_eligible_component(pkg, "t-peel", "Peel", visit_date="2026-05-30")
    assert comp["id"] == "c2"


def test_deduct_component_updates_balance():
    pkg = {
        "package_type": "series_package",
        "components": [{
            "id": "c1",
            "total_quantity": 6,
            "used_quantity": 0,
            "remaining_quantity": 6,
            "status": "active",
        }],
    }
    updated = deduct_component(pkg, pkg["components"][0], 1, visit_date="2026-05-30")
    assert updated["components"][0]["remaining_quantity"] == 5
    assert updated["status"] == "partially_used"


def test_treatment_matches_by_name():
    assert treatment_matches({"treatment_name_snapshot": "Signature Facial"}, None, "Signature Facial")
