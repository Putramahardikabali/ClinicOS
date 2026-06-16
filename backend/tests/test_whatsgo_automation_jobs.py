"""Whatsgo automation jobs — retry, dedup, cancel helpers."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

JWT_SECRET = "test-jwt-secret-change-me"


def _rule(**overrides):
    base = {
        "id": "rule-1",
        "clinic_id": "c1",
        "name": "Reminder H-1",
        "trigger_type": "appointment_reminder",
        "event_type": "appointment_reminder",
        "timing_type": "before_event",
        "offset_value": 1,
        "offset_unit": "days",
        "whatsjet_template_name": "appointment_reminder",
        "language_code": "id",
        "variable_mapping": ["patient_name", "appointment_date"],
        "enabled": True,
        "conditions": {"send_once_per_booking": True, "require_phone": True},
    }
    base.update(overrides)
    return base


class TestWhatsgoAutomationJobs:
    def test_classify_send_error_permanent_vs_temporary(self):
        from whatsgo_automation_jobs import classify_send_error

        assert classify_send_error("Invalid phone number") == "permanent"
        assert classify_send_error("Template not found") == "permanent"
        assert classify_send_error("Integration disconnected") == "permanent"
        assert classify_send_error("503 Service Unavailable") == "temporary"
        assert classify_send_error("Connection timeout") == "temporary"

    def test_compute_next_retry_at_backoff(self):
        from whatsgo_automation_jobs import RETRY_BACKOFF_MINUTES, compute_next_retry_at

        before = datetime.now(timezone.utc)
        t1 = compute_next_retry_at(1)
        t2 = compute_next_retry_at(2)
        t3 = compute_next_retry_at(3)
        assert (t1 - before).total_seconds() >= RETRY_BACKOFF_MINUTES[0] * 60 - 2
        assert (t2 - before).total_seconds() >= RETRY_BACKOFF_MINUTES[1] * 60 - 2
        assert (t3 - before).total_seconds() >= RETRY_BACKOFF_MINUTES[2] * 60 - 2

    def test_should_schedule_reminder_past(self):
        from whatsgo_automation_jobs import should_schedule_reminder

        ok, reason = should_schedule_reminder(datetime.now(timezone.utc) - timedelta(hours=1))
        assert ok is False
        assert reason == "reminder_in_past"

        ok2, reason2 = should_schedule_reminder(datetime.now(timezone.utc) + timedelta(days=1))
        assert ok2 is True
        assert reason2 is None

    def test_get_or_create_automation_run_dedup(self):
        from messaging_automation import get_or_create_automation_run

        async def run():
            db = MagicMock()
            when = datetime(2026, 6, 10, 10, 0, tzinfo=timezone.utc)
            existing = {"id": "run-existing", "status": "pending"}
            db.automation_runs = MagicMock()
            db.automation_runs.find_one = AsyncMock(return_value=existing)
            db.automation_runs.insert_one = AsyncMock()

            doc, created = await get_or_create_automation_run(
                db,
                clinic_id="c1",
                rule=_rule(trigger_type="booking_created", event_type="appointment_created", timing_type="immediately"),
                reference_type="booking",
                reference_id="b1",
                scheduled_for=when,
                patient_id="p1",
            )
            assert created is False
            assert doc["id"] == "run-existing"
            db.automation_runs.insert_one.assert_not_called()

        asyncio.run(run())

    def test_get_or_create_skips_past_reminder(self):
        from messaging_automation import get_or_create_automation_run

        async def run():
            db = MagicMock()
            db.automation_runs = MagicMock()
            db.automation_runs.find_one = AsyncMock(return_value=None)
            db.automation_runs.insert_one = AsyncMock()

            when = datetime.now(timezone.utc) - timedelta(hours=2)
            doc, created = await get_or_create_automation_run(
                db,
                clinic_id="c1",
                rule=_rule(),
                reference_type="booking",
                reference_id="b1",
                scheduled_for=when,
            )
            assert created is False
            assert doc["status"] == "skipped"
            assert doc["skip_reason"] == "reminder_in_past"

        asyncio.run(run())

    def test_cancel_pending_booking_automation_runs(self):
        from messaging_automation import cancel_pending_booking_automation_runs

        async def run():
            db = MagicMock()
            result = MagicMock()
            result.modified_count = 2
            db.automation_runs = MagicMock()
            db.automation_runs.update_many = AsyncMock(return_value=result)
            db.audit_logs = MagicMock()
            db.audit_logs.insert_one = AsyncMock()

            n = await cancel_pending_booking_automation_runs(db, "c1", "b1")
            assert n == 2
            flt = db.automation_runs.update_many.call_args[0][0]
            assert flt["reference_id"] == "b1"
            assert flt["status"]["$in"] == ["pending", "retrying", "queued"]

        asyncio.run(run())

    def test_temporary_failure_schedules_retry(self):
        from messaging_automation import process_automation_run

        async def run():
            db = MagicMock()
            db.automation_runs = MagicMock()
            db.automation_runs.update_one = AsyncMock()
            db.messaging_automation_rules = MagicMock()
            db.messaging_automation_rules.update_one = AsyncMock()
            db.messaging_templates = MagicMock()
            db.messaging_templates.find_one = AsyncMock(return_value=None)
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()
            db.audit_logs = MagicMock()
            db.audit_logs.insert_one = AsyncMock()

            run_doc = {
                "id": "run-1",
                "clinic_id": "c1",
                "rule_id": "rule-1",
                "reference_type": "booking",
                "reference_id": "b1",
                "scheduled_for": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
                "attempt_count": 0,
                "max_attempts": 3,
            }

            settings = {
                "enable_messaging": True,
                "provider": "whatsgo",
                "connection_status": "connected",
                "whatsgo_automation_sending_enabled": True,
                "whatsgo_workspace_id": "ws-1",
                "whatsgo_base_url": "https://whatsgo.test",
            }

            with patch("messaging.load_messaging_settings", new_callable=AsyncMock, return_value=settings), \
                 patch("messaging.get_provider_credentials", return_value={"integration_token": "tok", "workspace_id": "ws-1"}), \
                 patch("messaging.create_message_log", new_callable=AsyncMock, return_value={"id": "log-1"}), \
                 patch("messaging.build_message_context", new_callable=AsyncMock, return_value={
                     "patient_phone": "628123456789",
                     "patient_name": "Jane",
                     "appointment_date": "10 Jun",
                 }), \
                 patch("messaging_automation.evaluate_rule_conditions", new_callable=AsyncMock, return_value=None), \
                 patch("messaging_automation._already_sent_for_rule", new_callable=AsyncMock, return_value=False), \
                 patch("whatsgo_automation_jobs.claim_automation_job", new_callable=AsyncMock, return_value=run_doc), \
                 patch("whatsgo_adapter.send_whatsgo_template_message", return_value=(False, None, "503 Service Unavailable", {})):
                await process_automation_run(
                    db, JWT_SECRET, run_doc, _rule(),
                    booking={"id": "b1", "patient_phone": "628123", "patient_id": "p1"},
                    patient={"id": "p1", "phone": "628123", "full_name": "Jane"},
                )

            final_upd = db.automation_runs.update_one.call_args_list[-1][0][1]["$set"]
            assert final_upd["status"] == "retrying"
            assert final_upd["attempt_count"] == 1
            assert final_upd.get("next_retry_at")

        asyncio.run(run())

    def test_permanent_failure_no_retry(self):
        from messaging_automation import process_automation_run

        async def run():
            db = MagicMock()
            db.automation_runs = MagicMock()
            db.automation_runs.update_one = AsyncMock()
            db.messaging_automation_rules = MagicMock()
            db.messaging_automation_rules.update_one = AsyncMock()
            db.messaging_templates = MagicMock()
            db.messaging_templates.find_one = AsyncMock(return_value=None)
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()
            db.audit_logs = MagicMock()
            db.audit_logs.insert_one = AsyncMock()

            run_doc = {
                "id": "run-1",
                "clinic_id": "c1",
                "rule_id": "rule-1",
                "reference_type": "booking",
                "reference_id": "b1",
                "scheduled_for": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
                "attempt_count": 0,
                "max_attempts": 3,
            }

            settings = {
                "enable_messaging": True,
                "provider": "whatsgo",
                "connection_status": "connected",
                "whatsgo_automation_sending_enabled": True,
                "whatsgo_workspace_id": "ws-1",
                "whatsgo_base_url": "https://whatsgo.test",
            }

            with patch("messaging.load_messaging_settings", new_callable=AsyncMock, return_value=settings), \
                 patch("messaging.get_provider_credentials", return_value={"integration_token": "tok", "workspace_id": "ws-1"}), \
                 patch("messaging.create_message_log", new_callable=AsyncMock, return_value={"id": "log-1"}), \
                 patch("messaging.build_message_context", new_callable=AsyncMock, return_value={
                     "patient_phone": "628123456789",
                     "patient_name": "Jane",
                 }), \
                 patch("messaging_automation.evaluate_rule_conditions", new_callable=AsyncMock, return_value=None), \
                 patch("messaging_automation._already_sent_for_rule", new_callable=AsyncMock, return_value=False), \
                 patch("whatsgo_automation_jobs.claim_automation_job", new_callable=AsyncMock, return_value=run_doc), \
                 patch("whatsgo_service.upsert_contact", new_callable=AsyncMock), \
                 patch("whatsgo_adapter.send_whatsgo_template_message", return_value=(False, None, "Template not found", {})):
                await process_automation_run(
                    db, JWT_SECRET, run_doc, _rule(),
                    booking={"id": "b1", "patient_phone": "628123", "patient_id": "p1"},
                    patient={"id": "p1", "phone": "628123", "full_name": "Jane"},
                )

            final_upd = db.automation_runs.update_one.call_args_list[-1][0][1]["$set"]
            assert final_upd["status"] == "failed"
            assert final_upd.get("next_retry_at") is None

        asyncio.run(run())

    def test_canonical_event_type_aliases(self):
        from messaging_automation import canonical_event_type, normalize_trigger_type

        assert normalize_trigger_type("appointment_created") == "booking_created"
        assert canonical_event_type("booking_created") == "appointment_created"
        assert normalize_trigger_type("appointment_reminder") == "before_appointment"
