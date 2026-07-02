"""Unit tests for internal past-booking policy enforcement."""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from internal_booking_time import (
    PAST_POLICY_ALLOW,
    PAST_POLICY_BLOCK,
    PAST_POLICY_WARN_ALLOW,
    enforce_internal_past_booking_policy,
    is_internal_slot_in_past,
    resolve_past_appointment_policy,
)

CLINIC_ID = "clinic-1"
PAST_AT = "2026-06-02T09:00:00"
FUTURE_AT = "2026-06-02T15:00:00"
NOW = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
USER = {"id": "user-1", "email": "fo@clinic.test", "role": "fo"}


class TestInternalSlotInPast:
    def test_future_slot_not_past(self):
        clinic = {"timezone": "Asia/Makassar"}
        assert is_internal_slot_in_past(clinic, FUTURE_AT, now=NOW) is False

    def test_past_slot_detected(self):
        clinic = {"timezone": "Asia/Makassar"}
        assert is_internal_slot_in_past(clinic, PAST_AT, now=NOW) is True


class TestResolvePastAppointmentPolicy:
    def test_defaults_to_warn_allow(self):
        db = AsyncMock()

        async def run():
            with patch(
                "booking_conflicts.get_scheduling_settings",
                new_callable=AsyncMock,
                return_value={},
            ):
                assert await resolve_past_appointment_policy(db, CLINIC_ID) == PAST_POLICY_WARN_ALLOW

        asyncio.run(run())

    def test_invalid_policy_falls_back(self):
        db = AsyncMock()

        async def run():
            with patch(
                "booking_conflicts.get_scheduling_settings",
                new_callable=AsyncMock,
                return_value={"past_appointment_policy": "bogus"},
            ):
                assert await resolve_past_appointment_policy(db, CLINIC_ID) == PAST_POLICY_WARN_ALLOW

        asyncio.run(run())


class TestEnforceInternalPastBookingPolicy:
    def test_future_slot_no_op(self):
        db = AsyncMock()
        db.clinics.find_one = AsyncMock(return_value={"timezone": "Asia/Makassar"})

        async def run():
            with patch(
                "internal_booking_time.is_internal_slot_in_past",
                return_value=False,
            ):
                await enforce_internal_past_booking_policy(
                    db, USER, CLINIC_ID, FUTURE_AT,
                )

        asyncio.run(run())

    def test_block_policy_rejects_past(self):
        db = AsyncMock()
        db.clinics.find_one = AsyncMock(return_value={"timezone": "Asia/Makassar"})

        async def run():
            with patch(
                "internal_booking_time.is_internal_slot_in_past",
                return_value=True,
            ), patch(
                "internal_booking_time.resolve_past_appointment_policy",
                new_callable=AsyncMock,
                return_value=PAST_POLICY_BLOCK,
            ):
                with pytest.raises(HTTPException) as exc:
                    await enforce_internal_past_booking_policy(
                        db, USER, CLINIC_ID, PAST_AT,
                    )
                assert exc.value.status_code == 400
                assert "past" in str(exc.value.detail).lower()

        asyncio.run(run())

    def test_warn_allow_requires_acknowledgement(self):
        db = AsyncMock()
        db.clinics.find_one = AsyncMock(return_value={"timezone": "Asia/Makassar"})

        async def run():
            with patch(
                "internal_booking_time.is_internal_slot_in_past",
                return_value=True,
            ), patch(
                "internal_booking_time.resolve_past_appointment_policy",
                new_callable=AsyncMock,
                return_value=PAST_POLICY_WARN_ALLOW,
            ):
                with pytest.raises(HTTPException) as exc:
                    await enforce_internal_past_booking_policy(
                        db, USER, CLINIC_ID, PAST_AT,
                        past_booking_acknowledged=False,
                    )
                assert exc.value.status_code == 400
                assert exc.value.detail["code"] == "past_booking_warning"

        asyncio.run(run())

    def test_warn_allow_with_ack_logs_audit(self):
        db = AsyncMock()
        db.clinics.find_one = AsyncMock(return_value={"timezone": "Asia/Makassar"})

        async def run():
            with patch(
                "internal_booking_time.is_internal_slot_in_past",
                return_value=True,
            ), patch(
                "internal_booking_time.resolve_past_appointment_policy",
                new_callable=AsyncMock,
                return_value=PAST_POLICY_WARN_ALLOW,
            ), patch(
                "audit_log.log_internal_past_booking",
                new_callable=AsyncMock,
            ) as mock_log:
                await enforce_internal_past_booking_policy(
                    db, USER, CLINIC_ID, PAST_AT,
                    past_booking_acknowledged=True,
                    booking_id="b-1",
                    action="create",
                )
                mock_log.assert_awaited_once()

        asyncio.run(run())

    def test_allow_policy_logs_without_ack(self):
        db = AsyncMock()
        db.clinics.find_one = AsyncMock(return_value={"timezone": "Asia/Makassar"})

        async def run():
            with patch(
                "internal_booking_time.is_internal_slot_in_past",
                return_value=True,
            ), patch(
                "internal_booking_time.resolve_past_appointment_policy",
                new_callable=AsyncMock,
                return_value=PAST_POLICY_ALLOW,
            ), patch(
                "audit_log.log_internal_past_booking",
                new_callable=AsyncMock,
            ) as mock_log:
                await enforce_internal_past_booking_policy(
                    db, USER, CLINIC_ID, PAST_AT,
                    past_booking_acknowledged=False,
                )
                mock_log.assert_awaited_once()

        asyncio.run(run())
