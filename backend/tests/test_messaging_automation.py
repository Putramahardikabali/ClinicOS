"""Messaging automation gating — unit + integration tests."""
from __future__ import annotations

import os
import time
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


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


class TestMessagingAutomationUnit:
    def test_manual_provider_not_api_capable(self):
        from messaging import is_api_capable_provider, is_automation_active

        assert not is_api_capable_provider("none")
        assert not is_api_capable_provider("manual_fallback")
        assert is_api_capable_provider("whatsapp_cloud_api")
        settings = {"enable_messaging": True, "provider": "none", "connection_status": "connected"}
        assert not is_automation_active(settings)

    def test_automation_active_only_when_connected(self):
        from messaging import is_automation_active

        creds = {"access_token": "tok", "phone_number_id": "123"}
        settings = {
            "enable_messaging": True,
            "provider": "whatsapp_cloud_api",
            "connection_status": "connected",
        }
        assert is_automation_active(settings, creds)
        settings["connection_status"] = "not_connected"
        assert not is_automation_active(settings, creds)

    def test_compute_connection_status_disabled(self):
        from messaging import compute_connection_status

        assert compute_connection_status({"enable_messaging": False}) == "disabled"

    def test_credentials_complete_whatsapp_cloud(self):
        from messaging import credentials_complete

        ok, _ = credentials_complete("whatsapp_cloud_api", {"access_token": "a", "phone_number_id": "b"}, {})
        assert ok
        ok2, reason = credentials_complete("whatsapp_cloud_api", {}, {})
        assert not ok2
        assert reason

    def test_meta_template_required_for_reminders(self):
        from messaging import _meta_template_required

        tpl = {"template_type": "booking_reminder", "timing_rule": "24_hours_before"}
        assert _meta_template_required(tpl, "whatsapp_cloud_api")
        tpl["provider_template_name"] = "reminder_v1"
        assert not _meta_template_required(tpl, "whatsapp_cloud_api")

    def test_automation_precheck_provider_not_connected(self):
        import asyncio
        from messaging import _automation_precheck

        settings = {"enable_messaging": True, "provider": "whatsapp_cloud_api", "connection_status": "not_connected"}
        skip = asyncio.run(_automation_precheck(
            settings,
            {"access_token": "x", "phone_number_id": "y"},
            template={"active": True, "template_type": "booking_confirmation"},
            recipient="628123",
        ))
        assert skip == "provider_not_connected"


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def fo_token():
    return login(FO_EMAIL)


class TestMessagingAutomationIntegration:
    def test_settings_expose_connection_status(self, owner_token):
        r = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "connection_status" in d
        assert "automation_active" in d
        assert d["connection_status"] in ("disabled", "not_connected", "connected", "error")
        assert d["automation_active"] is (d["connection_status"] == "connected")

    def test_enable_without_api_provider_rejected(self, owner_token):
        cur = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT).json()
        try:
            r = requests.put(
                f"{API}/settings/messaging",
                headers=H(owner_token),
                json={"enable_messaging": True, "provider": "none"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 400, r.text
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

    def test_credentials_masked_in_get(self, owner_token):
        requests.put(
            f"{API}/settings/messaging",
            headers=H(owner_token),
            json={
                "enable_messaging": True,
                "provider": "whatsapp_cloud_api",
                "access_token": "SECRET_TOKEN_XYZ",
                "phone_number_id": "PHONE_ID_123",
            },
            timeout=TIMEOUT,
        )
        r = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT)
        body = r.text
        assert "SECRET_TOKEN_XYZ" not in body
        assert "PHONE_ID_123" not in body
        assert r.json().get("has_credentials") is True

    def test_doctor_cannot_configure_provider(self, owner_token):
        doc = login(DOCTOR_EMAIL)
        r = requests.put(
            f"{API}/settings/messaging",
            headers=H(doc),
            json={"enable_messaging": True, "provider": "whatsapp_cloud_api"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_manual_send_blocked_without_connection(self, owner_token, fo_token):
        r = requests.post(
            f"{API}/messaging/send",
            headers=H(fo_token),
            json={"booking_id": "nonexistent-booking-id", "template_type": "booking_confirmation"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (400, 404), r.text
        if r.status_code == 400:
            assert "provider" in r.text.lower() or "connected" in r.text.lower()

    def test_manual_opened_without_automation(self, fo_token):
        r = requests.post(
            f"{API}/messaging/manual-opened",
            headers=H(fo_token),
            json={"note": "Opened wa.me from booking"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "manual_opened"
        assert r.json().get("provider") == "manual_fallback"

    def test_templates_list_includes_automation_flag(self, owner_token):
        r = requests.get(f"{API}/messaging/templates", headers=H(owner_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "automation_active" in r.json()
        assert "connection_status" in r.json()

    def test_trigger_skipped_log_when_not_connected(self, owner_token):
        """Booking confirm should not queue sends when automation inactive."""
        cur = requests.get(f"{API}/settings/messaging", headers=H(owner_token), timeout=TIMEOUT).json()
        try:
            requests.put(
                f"{API}/settings/messaging",
                headers=H(owner_token),
                json={
                    "enable_messaging": True,
                    "provider": "whatsapp_cloud_api",
                    "clear_credentials": True,
                },
                timeout=TIMEOUT,
            )
            day = (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d")
            rb = requests.post(
                f"{API}/bookings",
                headers=H(owner_token),
                json={
                    "patient_name": f"Msg Skip {uuid.uuid4().hex[:6]}",
                    "patient_phone": "081299988877",
                    "treatment": "Consultation",
                    "duration_min": 30,
                    "scheduled_at": f"{day}T10:00:00",
                },
                timeout=TIMEOUT,
            )
            assert rb.status_code == 200, rb.text
            bid = rb.json()["id"]
            st = requests.put(
                f"{API}/bookings/{bid}/status",
                headers=H(owner_token),
                json={"status": "confirmed"},
                timeout=TIMEOUT,
            )
            assert st.status_code == 200, st.text
            time.sleep(1.0)
            logs = requests.get(
                f"{API}/messaging/logs",
                headers=H(owner_token),
                params={"booking_id": bid},
                timeout=TIMEOUT,
            )
            assert logs.status_code == 200
            items = logs.json().get("items") or []
            queued = [x for x in items if x.get("status") == "queued"]
            assert len(queued) == 0
            skipped = [x for x in items if x.get("status") == "skipped" and x.get("skip_reason") == "provider_not_connected"]
            assert len(skipped) >= 1, f"expected skipped logs, got {items}"
            requests.delete(f"{API}/bookings/{bid}", headers=H(owner_token), timeout=TIMEOUT)
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
