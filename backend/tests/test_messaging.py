"""Phase 2 — messaging provider layer tests."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30
OWNER = "admin@bodylab.id"
PASSWORD = "password123"


def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["token"]


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner_h():
    return H(login(OWNER))


class TestMessagingUnit:
    def test_render_message_tags(self):
        from messaging import render_message

        body = "Hi {{patient_name}}, see you {{appointment_date}} at {{clinic_name}}."
        out = render_message(body, {"patient_name": "Jane", "appointment_date": "1 Jun", "clinic_name": "Demo"})
        assert "Jane" in out and "Demo" in out
        assert "{{" not in out

    def test_compute_send_at_reminder(self):
        from messaging import compute_send_at

        sched = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        send = compute_send_at(sched, "24_hours_before")
        assert send == sched - timedelta(hours=24)


class TestMessagingSettingsAPI:
    def test_get_settings_default(self, owner_h):
        r = requests.get(f"{API}/settings/messaging", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "enable_messaging" in d
        assert "has_credentials" in d

    def test_update_and_restore(self, owner_h):
        cur = requests.get(f"{API}/settings/messaging", headers=owner_h, timeout=TIMEOUT).json()
        try:
            r = requests.put(
                f"{API}/settings/messaging",
                headers=owner_h,
                json={
                    "enable_messaging": True,
                    "provider": "whatsapp_cloud_api",
                    "sender_name": "Body Lab",
                    "sender_phone_number": "123456789",
                    "access_token": "TEST_TOKEN",
                    "phone_number_id": "TEST_PHONE_ID",
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            assert r.json()["has_credentials"] is True
        finally:
            requests.put(
                f"{API}/settings/messaging",
                headers=owner_h,
                json={
                    "enable_messaging": cur.get("enable_messaging", False),
                    "provider": cur.get("provider", "none"),
                    "clear_credentials": not cur.get("has_credentials"),
                },
                timeout=TIMEOUT,
            )

    def test_doctor_cannot_configure(self, owner_h):
        doc = login("doctor@bodylab.id")
        r = requests.put(
            f"{API}/settings/messaging",
            headers=H(doc),
            json={"enable_messaging": True, "provider": "twilio"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestMessagingTemplates:
    def test_list_and_create_template(self, owner_h):
        r = requests.get(f"{API}/messaging/templates", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        items = r.json().get("items") or []
        assert len(items) >= 1

        tid = None
        try:
            cr = requests.post(
                f"{API}/messaging/templates",
                headers=owner_h,
                json={
                    "template_name": f"TEST {uuid.uuid4().hex[:6]}",
                    "template_type": "custom",
                    "channel": "whatsapp",
                    "message_body": "Hello {{patient_name}}",
                    "timing_rule": "immediately",
                    "active": True,
                },
                timeout=TIMEOUT,
            )
            assert cr.status_code == 200, cr.text
            tid = cr.json()["id"]
        finally:
            if tid:
                requests.delete(f"{API}/messaging/templates/{tid}", headers=owner_h, timeout=TIMEOUT)

    def test_message_logs_endpoint(self, owner_h):
        r = requests.get(f"{API}/messaging/logs", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        assert "items" in r.json()
