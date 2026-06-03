"""Patient package balance helpers."""
from patient_packages import compute_package_status, _apply_status
from package_engine import apply_patient_package_status


def test_compute_package_status():
    assert compute_package_status({"status": "cancelled", "remaining_sessions": 5}) == "cancelled"
    assert compute_package_status({
        "expiry_date": "2020-01-01",
        "remaining_sessions": 3,
        "total_sessions": 6,
        "used_sessions": 3,
    }, "2026-05-29") == "expired"
    assert compute_package_status({
        "expiry_date": "2027-01-01",
        "remaining_sessions": 0,
        "total_sessions": 6,
        "used_sessions": 6,
    }) == "used_up"
    assert compute_package_status({
        "expiry_date": "2027-01-01",
        "remaining_sessions": 2,
        "total_sessions": 6,
        "used_sessions": 4,
    }) == "partially_used"
    assert apply_patient_package_status({
        "expiry_date": "2027-01-01",
        "components": [{
            "total_quantity": 6, "used_quantity": 2, "remaining_quantity": 4, "status": "partially_used",
        }],
    })["status"] == "partially_used"


def test_apply_status_recomputes_remaining():
    doc = _apply_status({"total_sessions": 10, "used_sessions": 3, "expiry_date": "2027-01-01"})
    assert doc["remaining_sessions"] == 7
    assert doc["status"] == "partially_used"
