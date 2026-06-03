"""Expired trial / subscription access gates and notifications."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

PLATFORM_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "platform@clinicos.id")
PLATFORM_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "ChangeMe123!")
OWNER_PASSWORD = "password123"


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _login(email: str, password: str = OWNER_PASSWORD) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200 and email == PLATFORM_EMAIL and password != "ClinicOS@2026":
        r = requests.post(
            f"{API}/auth/login",
            json={"email": email, "password": "ClinicOS@2026"},
            timeout=30,
        )
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _register_clinic() -> dict:
    uniq = uuid.uuid4().hex[:8]
    email = f"qa_expiry_{uniq}@example.com"
    payload = {
        "clinic_name": f"QA Expiry Clinic {uniq}",
        "owner_name": "QA Owner",
        "email": email,
        "password": OWNER_PASSWORD,
        "phone": "+62000",
        "city": "Bali",
    }
    r = requests.post(f"{API}/auth/register-clinic", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _expire_trial(platform_token: str, clinic_id: str) -> None:
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    r = requests.put(
        f"{API}/superadmin/clinics/{clinic_id}/subscription",
        json={"trial_end": past, "status": "trial"},
        headers=hdr(platform_token),
        timeout=30,
    )
    assert r.status_code == 200, r.text


def _refresh_clinic_me(owner_token: str) -> dict:
    r = requests.get(f"{API}/clinics/me", headers=hdr(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def platform_token():
    return _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)


@pytest.fixture
def expired_clinic(platform_token):
    data = _register_clinic()
    cid = data["clinic"]["id"]
    slug = data["clinic"]["slug"]
    owner_token = data["token"]
    _expire_trial(platform_token, cid)
    me = _refresh_clinic_me(owner_token)
    assert me["subscription"]["status"] == "expired", me.get("subscription")
    assert me.get("access_mode") == "billing_only"
    return {
        "clinic_id": cid,
        "slug": slug,
        "owner_token": owner_token,
        "owner_email": data["user"]["email"],
    }


class TestExpiredSubscriptionAccess:
    def test_owner_login_after_expiry(self, expired_clinic):
        tok = _login(expired_clinic["owner_email"])
        assert tok

    def test_owner_billing_quote_after_expiry(self, expired_clinic):
        r = requests.get(
            f"{API}/billing/quote",
            params={"plan": "clinic", "cycle": "monthly"},
            headers=hdr(expired_clinic["owner_token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_owner_help_and_account_after_expiry(self, expired_clinic):
        tok = expired_clinic["owner_token"]
        assert requests.get(f"{API}/platform/support", timeout=30).status_code == 200
        assert requests.get(f"{API}/clinic/support-diagnostics", headers=hdr(tok), timeout=30).status_code == 200
        assert requests.get(f"{API}/account/me", headers=hdr(tok), timeout=30).status_code == 200

    def test_owner_operational_get_blocked(self, expired_clinic):
        tok = expired_clinic["owner_token"]
        for path in ("/patients", "/bookings", "/visits"):
            r = requests.get(f"{API}{path}", headers=hdr(tok), timeout=30)
            assert r.status_code == 402, f"{path}: {r.status_code} {r.text}"

    def test_account_password_change_allowed_after_expiry(self, expired_clinic):
        tok = expired_clinic["owner_token"]
        r = requests.put(
            f"{API}/account/password",
            headers=hdr(tok),
            json={
                "current_password": OWNER_PASSWORD,
                "new_password": "password456",
                "confirm_new_password": "password456",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Restore password for other tests / cleanup
        tok2 = _login(expired_clinic["owner_email"], "password456")
        r2 = requests.put(
            f"{API}/account/password",
            headers=hdr(tok2),
            json={
                "current_password": "password456",
                "new_password": OWNER_PASSWORD,
                "confirm_new_password": OWNER_PASSWORD,
            },
            timeout=30,
        )
        assert r2.status_code == 200, r2.text


class TestExpiredPublicBooking:
    def test_public_availability_blocked(self, expired_clinic):
        slug = expired_clinic["slug"]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/public/clinics/{slug}/availability",
            params={"date": today, "duration": 30},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("booking_disabled") or data.get("closed")
        assert not any(s.get("available") for s in (data.get("slots") or []))

    def test_public_booking_post_blocked(self, expired_clinic):
        slug = expired_clinic["slug"]
        r = requests.post(
            f"{API}/public/clinics/{slug}/bookings",
            json={
                "patient_name": "Test",
                "patient_phone": "+621234",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                "treatment": "Consultation",
            },
            timeout=30,
        )
        assert r.status_code == 402, r.text


class TestTrialExpiredPlatformNotification:
    def test_trial_expired_notification_created_once(self, platform_token, expired_clinic):
        sa = hdr(platform_token)
        r = requests.get(f"{API}/superadmin/notifications", headers=sa, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("items") if isinstance(body, dict) else body
        matches = [
            n for n in rows
            if n.get("type") == "trial_expired" and n.get("clinic_id") == expired_clinic["clinic_id"]
        ]
        assert len(matches) >= 1, "expected at least one trial_expired platform notification"
        assert matches[0].get("meta", {}).get("owner_email") or matches[0].get("body")

        # Second refresh must not create duplicate
        _refresh_clinic_me(expired_clinic["owner_token"])
        r2 = requests.get(f"{API}/superadmin/notifications", headers=sa, timeout=30)
        body2 = r2.json()
        rows2 = body2.get("items") if isinstance(body2, dict) else body2
        matches2 = [
            n for n in rows2
            if n.get("type") == "trial_expired" and n.get("clinic_id") == expired_clinic["clinic_id"]
        ]
        assert len(matches2) == len(matches)
