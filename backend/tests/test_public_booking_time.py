"""Unit tests for public booking clinic-timezone validation."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from public_booking_time import (
    PAST_DATE_MSG,
    PAST_SLOT_MSG,
    assert_public_scheduled_at_valid,
    clinic_today_str,
    is_public_date_in_past,
    is_public_slot_in_past,
    parse_public_scheduled_at,
)


CLINIC = {"timezone": "Asia/Makassar"}


class TestPublicBookingTime:
    def test_past_date_detected(self):
        now = datetime(2026, 6, 2, 10, 0, tzinfo=timezone.utc)
        assert is_public_date_in_past(CLINIC, "2026-06-01", now=now) is True
        assert is_public_date_in_past(CLINIC, "2026-06-02", now=now) is False

    def test_past_slot_today_in_clinic_tz(self):
        # 14:30 in Makassar (UTC+8) => 06:30 UTC
        now = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
        assert clinic_today_str(CLINIC, now) == "2026-06-02"
        assert is_public_slot_in_past(CLINIC, "2026-06-02T09:00:00", now=now) is True
        assert is_public_slot_in_past(CLINIC, "2026-06-02T15:00:00", now=now) is False

    def test_future_date_slot_not_past(self):
        now = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
        assert is_public_slot_in_past(CLINIC, "2026-06-10T09:00:00", now=now) is False

    def test_assert_public_scheduled_at_valid_rejects_past(self):
        now = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
        with pytest.raises(HTTPException) as exc:
            assert_public_scheduled_at_valid(CLINIC, "2026-06-02T09:00:00", now=now)
        assert exc.value.status_code == 400
        assert exc.value.detail == PAST_SLOT_MSG

    def test_assert_public_scheduled_at_valid_accepts_future(self):
        now = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
        dt = assert_public_scheduled_at_valid(CLINIC, "2026-06-02T15:00:00", now=now)
        assert parse_public_scheduled_at(CLINIC, "2026-06-02T15:00:00").hour == 15
        assert dt.hour == 15

    def test_past_date_message_constant(self):
        assert "future date" in PAST_DATE_MSG.lower()
