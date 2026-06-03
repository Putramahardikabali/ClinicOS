"""Multi-performer helpers."""
from performers import (
    build_performer_entry,
    commission_eligible_performers,
    get_performers,
    invoice_item_performers,
    primary_performer_id,
    sync_invoice_item_legacy,
    sync_legacy_performer_fields,
)


def test_legacy_performer_migration():
    doc = {"performer_id": "u1", "performer_name_snapshot": "Dr A", "performer_role_snapshot": "doctor"}
    sync_legacy_performer_fields(doc)
    assert doc["performer_id"] == "u1"
    assert len(doc["performers"]) == 1
    assert doc["performers"][0]["performer_type"] == "primary"


def test_schedule_performer_preserved_when_treatment_changes():
    """Mirrors BookingsPage keepSchedulePerformer() — slot performer kept until manually changed."""
    preferred = "doc-from-schedule"
    performer_manually_changed = False

    def keep_schedule_performer():
        return preferred if preferred and not performer_manually_changed else ""

    form = {"performer_id": preferred, "treatment": ""}
    # User selects treatment after clicking schedule slot
    form["treatment"] = "Consultation"
    form["performer_id"] = keep_schedule_performer() or form["performer_id"]
    assert form["performer_id"] == preferred

    # Manual override clears auto-keep
    performer_manually_changed = True
    form["performer_id"] = "other-doc"
    form["treatment"] = "Dermal Filler"
    form["performer_id"] = keep_schedule_performer() or form["performer_id"]
    assert form["performer_id"] == "other-doc"


def test_invoice_item_multiple_performers():
    item = {
        "performers": [
            {"staff_id": "d1", "staff_name_snapshot": "Dr", "staff_role_snapshot": "doctor", "performer_type": "primary"},
            {"staff_id": "n1", "staff_name_snapshot": "Nurse", "staff_role_snapshot": "nurse", "performer_type": "assistant"},
        ],
    }
    sync_invoice_item_legacy(item)
    assert item["performer_id"] == "d1"
    assert len(commission_eligible_performers(item)) == 2
