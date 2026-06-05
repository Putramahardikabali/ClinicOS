"""Unit tests for setup checklist builder (no live API)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from commercial import build_onboarding_checklist

CHECKLIST_IDS = {
    "clinic_profile",
    "first_staff",
    "first_treatment",
    "staff_schedule",
    "first_patient",
    "first_booking",
    "first_visit",
    "first_invoice",
}


def _mock_db(counts: dict):
    db = MagicMock()
    for coll, key in [
        ("users", "users"),
        ("treatments", "treatments"),
        ("patients", "patients"),
        ("visits", "visits"),
        ("bookings", "booking"),
        ("invoices", "invoices"),
        ("weekly_staff_schedules", "schedule"),
    ]:
        mock_coll = MagicMock()
        mock_coll.count_documents = AsyncMock(return_value=counts.get(key, 0))
        setattr(db, coll, mock_coll)
    return db


@pytest.mark.parametrize("counts,profile,expected_done", [
    ({}, {"id": "c1", "name": "Clinic", "phone": "+62", "address": ""}, 0),
    (
        {"users": 2, "treatments": 1, "schedule": 1, "patients": 1, "booking": 1, "visits": 1, "invoices": 1},
        {"id": "c1", "name": "Clinic", "phone": "+62", "address": "Jl. Test"},
        8,
    ),
])
def test_build_onboarding_checklist_counts(counts, profile, expected_done):
    db = _mock_db(counts)
    result = asyncio.run(build_onboarding_checklist(db, profile))
    ids = {i["id"] for i in result["items"]}
    assert ids == CHECKLIST_IDS
    assert result["total"] == 8
    assert result["completed"] == expected_done
    assert result["complete"] is (expected_done == 8)
    if profile.get("address"):
        profile_item = next(i for i in result["items"] if i["id"] == "clinic_profile")
        assert profile_item["done"] is True
        assert profile_item["link"] == "/onboarding"
