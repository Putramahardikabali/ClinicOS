"""Messaging automation rules — unit tests (direct WhatsJet template config)."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

JWT_SECRET = "test-jwt-secret-change-me"


def _booking(hours_ahead: float = 25, phone: str = "08123456789"):
    return {
        "id": str(uuid.uuid4()),
        "clinic_id": "c1",
        "patient_id": "p1",
        "patient_name": "Jane",
        "patient_phone": phone,
        "treatment": "Facial",
        "status": "confirmed",
        "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=hours_ahead)).isoformat(),
    }


def _rule(**overrides):
    base = {
        "id": "rule-1",
        "clinic_id": "c1",
        "name": "Reminder H-1",
        "trigger_type": "before_appointment",
        "timing_type": "before_event",
        "timing_value": 1,
        "timing_unit": "days",
        "whatsjet_template_name": "appointment_reminder",
        "language_code": "id",
        "variable_mapping": ["patient_name", "appointment_date", "clinic_name"],
        "preview_text": "Hi {{patient_name}}, see you {{appointment_date}}",
        "enabled": True,
        "conditions": {"send_once_per_booking": True},
    }
    base.update(overrides)
    return base


class TestAutomationRuleUnit:
    def test_compute_send_at_before_appointment(self):
        from messaging_automation import compute_rule_send_at

        appt = datetime(2026, 6, 10, 10, 0, tzinfo=timezone.utc)
        rule = _rule(timing_value=1, timing_unit="days")
        send_at = compute_rule_send_at(rule, event_at=appt, trigger_type="before_appointment")
        assert send_at == appt - timedelta(days=1)

    def test_compute_send_at_three_hours_before(self):
        from messaging_automation import compute_rule_send_at

        appt = datetime(2026, 6, 10, 15, 0, tzinfo=timezone.utc)
        rule = _rule(timing_value=3, timing_unit="hours")
        send_at = compute_rule_send_at(rule, event_at=appt, trigger_type="before_appointment")
        assert send_at == appt - timedelta(hours=3)

    def test_variable_mapping_renders_values(self):
        from messaging_automation import build_rule_variable_values

        ctx = {
            "patient_name": "Jane",
            "appointment_date": "10 Jun 2026",
            "clinic_name": "Body Lab",
        }
        values = build_rule_variable_values(_rule(), ctx)
        assert values == ["Jane", "10 Jun 2026", "Body Lab"]

    def test_missing_template_name_skipped(self):
        from messaging_automation import process_automation_run

        async def run():
            db = MagicMock()
            db.automation_runs = MagicMock()
            db.automation_runs.update_one = AsyncMock()
            db.messaging_templates = MagicMock()
            db.messaging_templates.find_one = AsyncMock(return_value=None)

            when = datetime.now(timezone.utc)
            run_doc = {
                "id": "run-1",
                "clinic_id": "c1",
                "rule_id": "rule-1",
                "reference_type": "booking",
                "reference_id": "b1",
                "scheduled_for": when.isoformat(),
                "status": "pending",
            }
            rule = _rule(whatsjet_template_name="")

            with patch("messaging.load_messaging_settings", new_callable=AsyncMock) as mock_settings:
                mock_settings.return_value = {"enable_messaging": True, "provider": "whatsjet", "connection_status": "connected"}
                with patch("messaging.get_provider_credentials", return_value={"api_access_token": "tok"}):
                    with patch("messaging.build_message_context", new_callable=AsyncMock, return_value={"patient_phone": "628123456789", "patient_name": "Jane"}):
                        with patch("messaging_automation.evaluate_rule_conditions", new_callable=AsyncMock, return_value=None):
                            with patch("messaging_automation._already_sent_for_rule", new_callable=AsyncMock, return_value=False):
                                await process_automation_run(db, JWT_SECRET, run_doc, rule, booking=_booking())
            upd = db.automation_runs.update_one.call_args[0][1]["$set"]
            assert upd["status"] == "skipped"
            assert upd["skip_reason"] == "template_not_configured"

        asyncio.run(run())

    def test_provider_not_connected_skipped_run(self):
        from messaging_automation import process_automation_run

        async def run():
            db = MagicMock()
            db.automation_runs = MagicMock()
            db.automation_runs.update_one = AsyncMock()
            db.messaging_templates = MagicMock()
            db.messaging_templates.find_one = AsyncMock(return_value=None)

            run_doc = {
                "id": "run-1",
                "clinic_id": "c1",
                "rule_id": "rule-1",
                "reference_type": "booking",
                "reference_id": "b1",
                "scheduled_for": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
            }

            with patch("messaging.load_messaging_settings", new_callable=AsyncMock) as mock_settings:
                mock_settings.return_value = {"enable_messaging": True, "provider": "whatsjet", "connection_status": "not_connected"}
                with patch("messaging.get_provider_credentials", return_value={}):
                    with patch("messaging.create_skipped_log", new_callable=AsyncMock) as mock_skipped:
                        with patch("messaging.build_message_context", new_callable=AsyncMock, return_value={"patient_phone": "628123"}):
                            with patch("messaging_automation.evaluate_rule_conditions", new_callable=AsyncMock, return_value=None):
                                with patch("messaging_automation._already_sent_for_rule", new_callable=AsyncMock, return_value=False):
                                    await process_automation_run(
                                        db, JWT_SECRET, run_doc,
                                        _rule(trigger_type="booking_confirmed", timing_type="immediately"),
                                        booking=_booking(),
                                    )
            upd = db.automation_runs.update_one.call_args[0][1]["$set"]
            assert upd["status"] == "skipped"
            assert upd["skip_reason"] == "provider_not_connected"
            mock_skipped.assert_called_once()

        asyncio.run(run())

    def test_whatsjet_sends_via_template_endpoint(self):
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

            run_doc = {
                "id": "run-1",
                "clinic_id": "c1",
                "rule_id": "rule-1",
                "reference_type": "booking",
                "reference_id": "b1",
                "scheduled_for": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
            }

            with patch("messaging.load_messaging_settings", new_callable=AsyncMock) as mock_settings:
                mock_settings.return_value = {
                    "enable_messaging": True,
                    "provider": "whatsjet",
                    "connection_status": "connected",
                    "whatsjet_api_base_url": "https://wa.example.test",
                    "whatsjet_vendor_uid": "v1",
                    "whatsjet_send_template_path": "/api/{vendor_uid}/contact/send-template-message",
                }
                with patch("messaging.get_provider_credentials", return_value={"api_access_token": "tok"}):
                    with patch("messaging.create_message_log", new_callable=AsyncMock, return_value={"id": "log-1"}):
                        with patch("messaging.build_message_context", new_callable=AsyncMock, return_value={
                            "patient_phone": "628123456789",
                            "patient_name": "Jane",
                            "appointment_date": "10 Jun",
                            "clinic_name": "Clinic",
                        }):
                            with patch("messaging_automation.evaluate_rule_conditions", new_callable=AsyncMock, return_value=None):
                                with patch("messaging_automation._already_sent_for_rule", new_callable=AsyncMock, return_value=False):
                                    with patch("whatsjet_adapter.send_whatsjet_template_message", return_value=(True, "wj-tpl-1", None, {})) as mock_send:
                                        await process_automation_run(
                                            db, JWT_SECRET, run_doc, _rule(),
                                            booking=_booking(),
                                        )
                                        mock_send.assert_called_once()
                                        assert mock_send.call_args.kwargs["template_name"] == "appointment_reminder"
                                        assert mock_send.call_args.kwargs["variable_values"] == ["Jane", "10 Jun", "Clinic"]

        asyncio.run(run())

    def test_legacy_clinic_template_still_resolves(self):
        from messaging_automation import resolve_rule_send_config

        async def run():
            db = MagicMock()
            db.messaging_templates = MagicMock()
            db.messaging_templates.find_one = AsyncMock(return_value={
                "id": "legacy-tpl",
                "provider_template_name": "legacy_wj_name",
                "message_body": "Hi {{patient_name}}",
                "whatsjet_variable_mapping": ["patient_name"],
            })
            cfg = await resolve_rule_send_config(
                db, "c1",
                {"template_id": "legacy-tpl", "whatsjet_template_name": ""},
            )
            assert cfg["whatsjet_template_name"] == "legacy_wj_name"
            assert cfg["variable_mapping"] == ["patient_name"]
            assert "Hi" in cfg["preview_text"]

        asyncio.run(run())

    def test_rule_doc_fields_requires_whatsjet_name(self):
        from messaging_automation import AutomationRuleIn, _rule_doc_fields

        fields = _rule_doc_fields(AutomationRuleIn(
            name="Test",
            trigger_type="booking_confirmed",
            whatsjet_template_name="booking_confirm_v1",
            variable_mapping=["patient_name"],
        ))
        assert fields["whatsjet_template_name"] == "booking_confirm_v1"
        assert fields["variable_mapping"] == ["patient_name"]

    def test_missing_phone_skipped(self):
        from messaging_automation import evaluate_rule_conditions

        async def run():
            db = MagicMock()
            skip = await evaluate_rule_conditions(
                db,
                _rule(conditions={"require_phone": True}),
                clinic_id="c1",
                booking=_booking(phone=""),
                patient={"full_name": "Jane"},
            )
            assert skip == "missing_phone"

        asyncio.run(run())
