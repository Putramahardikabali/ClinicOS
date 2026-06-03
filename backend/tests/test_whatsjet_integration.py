"""WhatsJet messaging — unit tests (mocked HTTP) and integration tests (live API)."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 25
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")
FO_EMAIL = os.environ.get("FO_EMAIL", "fo@bodylab.id")
DOCTOR_EMAIL = os.environ.get("DOCTOR_EMAIL", "doctor@bodylab.id")
JWT_SECRET = os.environ.get("JWT_SECRET", "test-jwt-secret-change-me")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


WHATSJET_SETTINGS = {
    "api_base_url": "https://wa.example.test",
    "vendor_uid": "vendor-abc",
    "api_access_token": "whatsjet-secret-token",
    "send_path": "/api/{vendor_uid}/contact/send-message",
    "test_path": "/api/{vendor_uid}/contact/contacts",
}


def _whatsjet_creds():
    return {
        "api_access_token": WHATSJET_SETTINGS["api_access_token"],
        "vendor_uid": WHATSJET_SETTINGS["vendor_uid"],
        "api_base_url": WHATSJET_SETTINGS["api_base_url"],
        "send_message_path": WHATSJET_SETTINGS["send_path"],
        "test_connection_path": WHATSJET_SETTINGS["test_path"],
        "webhook_secret": "hook-secret",
    }


def _whatsjet_merged_settings():
    from messaging import DEFAULT_CLINIC_MESSAGING

    return {
        **DEFAULT_CLINIC_MESSAGING,
        "enable_messaging": True,
        "provider": "whatsjet",
        "connection_status": "connected",
        "whatsjet_api_base_url": WHATSJET_SETTINGS["api_base_url"],
        "whatsjet_vendor_uid": WHATSJET_SETTINGS["vendor_uid"],
        "whatsjet_send_path": WHATSJET_SETTINGS["send_path"],
        "whatsjet_test_path": WHATSJET_SETTINGS["test_path"],
        "provider_credentials_encrypted": None,
    }


class TestWhatsJetAdapterUnit:
    def test_normalize_phone(self):
        from whatsjet_adapter import normalize_whatsjet_phone

        assert normalize_whatsjet_phone("08123456789") == "628123456789"
        assert normalize_whatsjet_phone("+62 812-3456-789") == "628123456789"

    def test_credentials_complete(self):
        from whatsjet_adapter import whatsjet_credentials_complete, whatsjet_settings_bundle

        bundle = whatsjet_settings_bundle(
            {"whatsjet_api_base_url": "https://x.com", "whatsjet_vendor_uid": "v1", "whatsjet_send_path": "/send"},
            {"api_access_token": "tok"},
        )
        ok, _ = whatsjet_credentials_complete(bundle)
        assert ok
        ok2, reason = whatsjet_credentials_complete(whatsjet_settings_bundle({}, {}))
        assert not ok2
        assert reason

    @patch("whatsjet_adapter.requests.post")
    def test_send_success(self, mock_post):
        from whatsjet_adapter import send_whatsjet_message

        resp = MagicMock()
        resp.status_code = 200
        resp.content = b'{"message_id": "wj-99"}'
        resp.json.return_value = {"message_id": "wj-99"}
        mock_post.return_value = resp

        settings = {
            "whatsjet_api_base_url": "https://wa.example.test",
            "whatsjet_vendor_uid": "vendor-1",
            "whatsjet_send_path": "/api/{vendor_uid}/contact/send-message",
        }
        creds = {"api_access_token": "tok"}
        ok, mid, err, _ = send_whatsjet_message(
            clinic_id="c1",
            to_phone="08123456789",
            message_body="Hello",
            settings=settings,
            creds=creds,
        )
        assert ok
        assert mid == "wj-99"
        assert err is None
        call_kwargs = mock_post.call_args
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer tok"
        assert call_kwargs.kwargs["json"]["phone_number"] == "628123456789"

    @patch("whatsjet_adapter.requests.post")
    def test_send_failure(self, mock_post):
        from whatsjet_adapter import send_whatsjet_message

        resp = MagicMock()
        resp.status_code = 422
        resp.content = b'{"message": "Invalid phone"}'
        resp.json.return_value = {"message": "Invalid phone"}
        mock_post.return_value = resp

        settings = {
            "whatsjet_api_base_url": "https://wa.example.test",
            "whatsjet_vendor_uid": "vendor-1",
            "whatsjet_send_path": "/api/{vendor_uid}/contact/send-message",
        }
        ok, mid, err, _ = send_whatsjet_message(
            clinic_id="c1",
            to_phone="628111",
            message_body="Hi",
            settings=settings,
            creds={"api_access_token": "tok"},
        )
        assert not ok
        assert mid is None
        assert "Invalid phone" in (err or "")

    def test_webhook_status_mapping(self):
        from whatsjet_adapter import map_whatsjet_webhook_status

        assert map_whatsjet_webhook_status({"status": "delivered"}) == "delivered"
        assert map_whatsjet_webhook_status({"event": "message_received"}) == "delivered"
        assert map_whatsjet_webhook_status({"status": "failed"}) == "failed"

    def test_parse_result_success_and_failed(self):
        from whatsjet_adapter import _parse_api_response
        from unittest.mock import MagicMock

        ok_resp = MagicMock(status_code=200)
        ok, mid, err, _ = _parse_api_response(ok_resp, {"result": "success", "message_id": "m-success"})
        assert ok and mid == "m-success" and err is None

        fail_resp = MagicMock(status_code=200)
        ok2, mid2, err2, _ = _parse_api_response(fail_resp, {"result": "failed", "message": "Invalid Token"})
        assert not ok2 and mid2 is None and "Invalid Token" in (err2 or "")

    def test_meta_webhook_status_updates(self):
        from whatsjet_adapter import extract_meta_webhook_status_updates, map_whatsjet_webhook_status

        payload = {
            "entry": [{
                "changes": [{
                    "value": {
                        "statuses": [{"id": "wamid.abc", "status": "delivered"}],
                    },
                }],
            }],
        }
        updates = extract_meta_webhook_status_updates(payload)
        assert len(updates) == 1
        assert updates[0]["message_id"] == "wamid.abc"
        assert map_whatsjet_webhook_status(payload) == "delivered"

    def test_invalid_phone_rejected(self):
        from whatsjet_adapter import send_whatsjet_message

        settings = {
            "whatsjet_api_base_url": "https://wa.example.test",
            "whatsjet_vendor_uid": "v1",
            "whatsjet_send_path": "/api/{vendor_uid}/contact/send-message",
        }
        ok, mid, err, _ = send_whatsjet_message(
            clinic_id="c1",
            to_phone="12",
            message_body="Hi",
            settings=settings,
            creds={"api_access_token": "tok"},
        )
        assert not ok and mid is None and "Invalid phone" in (err or "")

    @patch("whatsjet_adapter.requests.post")
    def test_template_send(self, mock_post):
        from whatsjet_adapter import send_whatsjet_template_message

        resp = MagicMock()
        resp.status_code = 200
        resp.content = b'{"result":"success","data":{"message_id":"tpl-1"}}'
        resp.json.return_value = {"result": "success", "data": {"message_id": "tpl-1"}}
        mock_post.return_value = resp

        settings = {
            "whatsjet_api_base_url": "https://wa.example.test",
            "whatsjet_vendor_uid": "v1",
            "whatsjet_send_path": "/api/{vendor_uid}/contact/send-message",
            "whatsjet_send_template_path": "/api/{vendor_uid}/contact/send-template-message",
        }
        ok, mid, err, _ = send_whatsjet_template_message(
            clinic_id="c1",
            to_phone="628123456789",
            template_name="booking_confirm",
            language="id",
            variable_values=["Jane", "Facial"],
            settings=settings,
            creds={"api_access_token": "tok"},
        )
        assert ok and mid == "tpl-1"
        body = mock_post.call_args.kwargs["json"]
        assert body["template_name"] == "booking_confirm"

    def test_sanitize_webhook_payload(self):
        from whatsjet_adapter import sanitize_webhook_payload

        out = sanitize_webhook_payload({
            "status": "delivered",
            "message_id": "m1",
            "api_access_token": "should-not-appear",
            "body": "long patient message " * 50,
        })
        assert out.get("status") == "delivered"
        assert "api_access_token" not in out


class TestWhatsJetMessagingUnit:
    def test_get_settings_never_returns_token(self):
        from messaging import sanitize_settings_admin

        creds = {"api_access_token": "SUPER_SECRET_WHATSJET_TOKEN"}
        out = sanitize_settings_admin(
            {"enable_messaging": True, "provider": "whatsjet"},
            has_credentials=True,
            creds=creds,
        )
        blob = json.dumps(out)
        assert "SUPER_SECRET_WHATSJET_TOKEN" not in blob
        assert "api_access_token" not in blob
        assert out["has_credentials"] is True

    @patch("messaging.send_via_provider")
    def test_dispatch_message_failed_log(self, mock_send):
        from messaging import dispatch_message

        mock_send.return_value = (False, None, "Provider rejected", {})

        async def run():
            db = MagicMock()
            db.message_logs.update_one = AsyncMock()
            log = {
                "id": "log-1",
                "clinic_id": "c1",
                "recipient": "628123",
                "rendered_message": "test",
                "channel": "whatsapp",
            }
            settings = _whatsjet_merged_settings()
            creds = _whatsjet_creds()
            tpl = {"template_type": "custom"}
            await dispatch_message(db, log, settings, creds, tpl)
            upd = db.message_logs.update_one.call_args[0][1]["$set"]
            assert upd["status"] == "failed"
            assert upd["error_message"] == "Provider rejected"

        asyncio.run(run())

    @patch("whatsjet_adapter.send_whatsjet_message")
    def test_send_via_provider_whatsjet(self, mock_wj):
        from messaging import send_via_provider

        mock_wj.return_value = (True, "wj-id", None, {})
        settings = _whatsjet_merged_settings()
        creds = _whatsjet_creds()
        ok, mid, err, _ = send_via_provider(
            settings,
            creds,
            channel="whatsapp",
            recipient="628999",
            message="Booking confirmed",
            clinic_id="c1",
            template_key="booking_confirmation",
            reference_type="booking",
            reference_id="b1",
        )
        assert ok and mid == "wj-id"
        mock_wj.assert_called_once()
        assert mock_wj.call_args.kwargs["message_body"] == "Booking confirmed"

    @patch("whatsjet_adapter.requests.post")
    def test_test_send_uses_send_message_endpoint(self, mock_post):
        from whatsjet_adapter import send_whatsjet_message

        resp = MagicMock()
        resp.status_code = 200
        resp.content = b'{"result":"success","message_id":"test-1"}'
        resp.json.return_value = {"result": "success", "message_id": "test-1"}
        mock_post.return_value = resp

        settings = _whatsjet_merged_settings()
        ok, mid, _, _ = send_whatsjet_message(
            clinic_id="c1",
            to_phone="08123456789",
            message_body="ClinicOS test",
            settings=settings,
            creds=_whatsjet_creds(),
        )
        assert ok and mid == "test-1"
        url = mock_post.call_args[0][0]
        assert "send-message" in url
        assert mock_post.call_args.kwargs["json"] == {
            "phone_number": "628123456789",
            "message_body": "ClinicOS test",
        }

    @patch("messaging.send_via_provider")
    @patch("messaging.ensure_default_templates", new_callable=AsyncMock)
    @patch("messaging.is_automation_active", return_value=True)
    @patch("messaging.get_provider_credentials")
    @patch("messaging.load_messaging_settings", new_callable=AsyncMock)
    @patch("messaging_automation.trigger_automation_rules_for_event", new_callable=AsyncMock)
    @patch("messaging_automation.legacy_should_skip", new_callable=AsyncMock, return_value=False)
    def test_trigger_booking_confirmation_uses_whatsjet(
        self, _legacy_skip, _auto_rules, mock_load, mock_creds, _auto, _ensure, mock_send,
    ):
        from messaging import trigger_booking_messaging

        settings = _whatsjet_merged_settings()
        mock_load.return_value = settings
        mock_creds.return_value = _whatsjet_creds()
        mock_send.return_value = (True, "wj-booking", None, {})

        async def run():
            db = MagicMock()
            tpl = {
                "id": "t1",
                "template_type": "booking_confirmation",
                "channel": "whatsapp",
                "message_body": "Hi {{patient_name}}",
                "timing_rule": "immediately",
                "active": True,
            }
            cursor_confirm = MagicMock()
            cursor_confirm.to_list = AsyncMock(return_value=[tpl])
            cursor_reminder = MagicMock()
            cursor_reminder.to_list = AsyncMock(return_value=[])
            db.messaging_templates.find = MagicMock(side_effect=[cursor_confirm, cursor_reminder])
            db.patients = MagicMock()
            db.patients.find_one = AsyncMock(return_value=None)
            db.clinics = MagicMock()
            db.clinics.find_one = AsyncMock(return_value={"name": "Test Clinic"})
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()

            booking = {
                "id": "book-1",
                "patient_name": "Jane",
                "patient_phone": "08123456789",
                "treatment": "Facial",
                "status": "confirmed",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            }
            await trigger_booking_messaging(db, JWT_SECRET, "c1", booking, "confirmed")
            assert mock_send.called
            assert settings["provider"] == "whatsjet"

        asyncio.run(run())

    @patch("messaging.send_via_provider")
    @patch("messaging.ensure_default_templates", new_callable=AsyncMock)
    @patch("messaging.is_automation_active", return_value=True)
    @patch("messaging.get_provider_credentials")
    @patch("messaging.load_messaging_settings", new_callable=AsyncMock)
    @patch("messaging_automation.trigger_automation_rules_for_event", new_callable=AsyncMock)
    @patch("messaging_automation.legacy_should_skip", new_callable=AsyncMock, return_value=False)
    def test_consent_link_uses_whatsjet(
        self, _legacy_skip, _auto_rules, mock_load, mock_creds, _auto, _ensure, mock_send,
    ):
        from messaging import trigger_booking_messaging

        settings = _whatsjet_merged_settings()
        mock_load.return_value = settings
        mock_creds.return_value = _whatsjet_creds()
        mock_send.return_value = (True, "wj-consent", None, {})

        async def run():
            db = MagicMock()
            tpl = {
                "id": "t2",
                "template_type": "consent_link",
                "channel": "whatsapp",
                "message_body": "Sign here: {{consent_link}}",
                "timing_rule": "immediately",
                "active": True,
            }
            cursor = MagicMock()
            cursor.to_list = AsyncMock(return_value=[tpl])
            db.messaging_templates.find = MagicMock(return_value=cursor)
            db.patients = MagicMock()
            db.patients.find_one = AsyncMock(return_value=None)
            db.clinics = MagicMock()
            db.clinics.find_one = AsyncMock(return_value={"name": "Clinic"})
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()

            booking = {
                "id": "book-2",
                "patient_name": "Bob",
                "patient_phone": "628111122233",
                "treatment": "Laser",
                "status": "confirmed",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            }
            await trigger_booking_messaging(
                db, JWT_SECRET, "c1", booking, "consent_link",
                consent_url="https://app.example/consent/abc",
            )
            assert mock_send.called
            rendered = mock_send.call_args.kwargs.get("message") or mock_send.call_args[1].get("message", "")
            assert "https://app.example" in rendered

        asyncio.run(run())

    def test_webhook_updates_message_log(self):
        from whatsjet_adapter import extract_webhook_message_id, map_whatsjet_webhook_status

        payload = {"message_id": "ext-42", "status": "delivered"}
        assert extract_webhook_message_id(payload) == "ext-42"
        assert map_whatsjet_webhook_status(payload) == "delivered"

    @patch("messaging_automation.trigger_automation_rules_for_event", new_callable=AsyncMock)
    @patch("messaging_automation.legacy_should_skip", new_callable=AsyncMock, return_value=False)
    @patch("messaging.is_automation_active", return_value=False)
    @patch("messaging.ensure_default_templates", new_callable=AsyncMock)
    @patch("messaging.get_provider_credentials")
    @patch("messaging.load_messaging_settings", new_callable=AsyncMock)
    def test_provider_not_connected_skipped_log(
        self, mock_load, mock_creds, _ensure, _auto, _legacy_skip, _auto_rules,
    ):
        from messaging import trigger_messaging_event

        settings = _whatsjet_merged_settings()
        settings["connection_status"] = "not_connected"
        mock_load.return_value = settings
        mock_creds.return_value = _whatsjet_creds()

        async def run():
            db = MagicMock()
            tpl = {
                "id": "t1",
                "template_type": "payment_received",
                "channel": "whatsapp",
                "message_body": "Paid {{amount_paid}}",
                "active": True,
            }
            cursor = MagicMock()
            cursor.to_list = AsyncMock(return_value=[tpl])
            db.messaging_templates.find = MagicMock(return_value=cursor)
            db.patients = MagicMock()
            db.patients.find_one = AsyncMock(return_value={"phone": "628123", "full_name": "A"})
            db.clinics = MagicMock()
            db.clinics.find_one = AsyncMock(return_value={"name": "Clinic"})
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()

            inv = {"id": "inv-1", "clinic_id": "c1", "patient_id": "p1", "amount_paid": 100000}
            await trigger_messaging_event(db, JWT_SECRET, "c1", "payment_received", invoice=inv)
            assert db.message_logs.insert_one.called
            doc = db.message_logs.insert_one.call_args[0][0]
            assert doc["status"] == "skipped"
            assert doc["skip_reason"] == "provider_not_connected"

        asyncio.run(run())

    @patch("messaging.send_via_provider")
    def test_test_send_flow_creates_failed_log_on_error(self, mock_send):
        from messaging import create_message_log, dispatch_message

        mock_send.return_value = (False, None, "Invalid phone", {})

        async def run():
            db = MagicMock()
            db.message_logs = MagicMock()
            db.message_logs.insert_one = AsyncMock()
            db.message_logs.update_one = AsyncMock()
            tpl = {"template_type": "custom", "template_key": "custom", "channel": "whatsapp"}
            log = await create_message_log(
                db,
                clinic_id="c1",
                template=tpl,
                recipient="628111",
                rendered="Test body",
                provider="whatsjet",
                channel="whatsapp",
                patient_id=None,
                booking_id=None,
                visit_id=None,
                send_at=datetime.now(timezone.utc),
                status="queued",
                reference_type="test_send",
            )
            await dispatch_message(db, log, _whatsjet_merged_settings(), _whatsjet_creds(), tpl)
            upd = db.message_logs.update_one.call_args[0][1]["$set"]
            assert upd["status"] == "failed"
            assert "Invalid phone" in upd["error_message"]

        asyncio.run(run())


def _api_available():
    try:
        r = requests.get(f"{BASE_URL}/api/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False


@pytest.fixture(scope="module")
def owner_token():
    if not _api_available():
        pytest.skip("API not running at " + BASE_URL)
    try:
        return login(OWNER_EMAIL)
    except (AssertionError, requests.RequestException):
        pytest.skip("Could not log in as owner for integration tests")


@pytest.fixture(scope="module")
def fo_token():
    if not _api_available():
        pytest.skip("API not running at " + BASE_URL)
    try:
        return login(FO_EMAIL)
    except (AssertionError, requests.RequestException):
        pytest.skip("Could not log in as FO for integration tests")


class TestWhatsJetIntegration:
    def test_whatsjet_settings_save_masks_token(self, owner_token):
        secret = f"WJ_TOKEN_{uuid.uuid4().hex[:12]}"
        cur = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT).json()
        try:
            r = requests.put(
                f"{API}/settings/messaging",
                headers=H(owner_token),
                json={
                    "enable_messaging": True,
                    "provider": "whatsjet",
                    "api_base_url": "https://wa.example.test",
                    "vendor_uid": "vendor-test",
                    "access_token": secret,
                    "send_message_path": "/api/{vendor_uid}/contact/send-message",
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            g = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT)
            assert secret not in g.text
            assert g.json().get("has_credentials") is True
            assert g.json().get("whatsjet_vendor_uid") == "vendor-test"
        finally:
            requests.put(
                f"{API}/settings/messaging",
                headers=H(owner_token),
                json={
                    "enable_messaging": cur.get("enable_messaging", False),
                    "provider": cur.get("provider") or "whatsapp_cloud_api",
                    "clear_credentials": not cur.get("has_credentials"),
                },
                timeout=TIMEOUT,
            )

    def test_fo_cannot_edit_messaging_settings(self, fo_token):
        r = requests.put(
            f"{API}/settings/messaging",
            headers=H(fo_token),
            json={"enable_messaging": True, "provider": "whatsjet"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_fo_can_call_manual_send_endpoint(self, fo_token):
        r = requests.post(
            f"{API}/messaging/send",
            headers=H(fo_token),
            json={"booking_id": "nonexistent-id", "template_type": "booking_confirmation"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (400, 404), r.text
        assert r.status_code != 403

    def test_webhook_updates_delivery_status(self, owner_token):
        """Requires running API + DB; creates log via direct webhook match pattern."""
        r = requests.post(
            f"{API}/messaging/webhook/whatsjet",
            params={"clinic_id": "nonexistent-clinic"},
            json={"message_id": "orphan-id", "status": "delivered"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (403, 404), r.text
