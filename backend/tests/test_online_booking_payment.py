"""Phase 1 — online booking payment settings, public config, and regression tests."""
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


def future_iso(days_ahead: int = 10, hour: int = 10, minute: int = 0) -> str:
    base = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return f"{base.strftime('%Y-%m-%d')}T{hour:02d}:{minute:02d}:00"


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER)


@pytest.fixture(scope="module")
def owner_h(owner_token):
    return H(owner_token)


@pytest.fixture(scope="module")
def clinic_slug(owner_h):
    me = requests.get(f"{API}/clinics/me", headers=owner_h, timeout=TIMEOUT).json()
    return me["slug"]


class TestPaymentSettingsUnit:
    def test_calculate_amount_due_full_and_deposit(self):
        from online_booking_payment import calculate_amount_due

        base = {
            "enable_online_booking_payment": True,
            "payment_requirement": "full_payment",
        }
        amt, req = calculate_amount_due(base, 500_000)
        assert amt == 500_000
        assert req == "full_payment"

        dep_fixed = {**base, "payment_requirement": "deposit", "deposit_type": "fixed", "deposit_value": 100_000}
        amt, req = calculate_amount_due(dep_fixed, 500_000)
        assert amt == 100_000
        assert req == "deposit"

        dep_pct = {**base, "payment_requirement": "deposit", "deposit_type": "percentage", "deposit_value": 20}
        amt, req = calculate_amount_due(dep_pct, 500_000)
        assert amt == 100_000

    def test_payment_disabled_returns_zero(self):
        from online_booking_payment import calculate_amount_due, payment_is_required

        settings = {"enable_online_booking_payment": False, "payment_requirement": "full_payment"}
        assert calculate_amount_due(settings, 1_000_000)[0] == 0
        assert payment_is_required(settings) is False


class TestPaymentSettingsAPI:
    def test_get_settings_default(self, owner_h):
        r = requests.get(f"{API}/settings/online-booking-payment", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "enable_online_booking_payment" in d
        assert "has_credentials" in d
        assert "provider_credentials_encrypted" not in d

    def test_update_and_restore_settings(self, owner_h):
        cur = requests.get(f"{API}/settings/online-booking-payment", headers=owner_h, timeout=TIMEOUT).json()
        try:
            r = requests.put(
                f"{API}/settings/online-booking-payment",
                headers=owner_h,
                json={
                    "enable_online_booking_payment": True,
                    "payment_requirement": "deposit",
                    "deposit_type": "fixed",
                    "deposit_value": 50_000,
                    "payment_provider": "midtrans",
                    "provider_mode": "sandbox",
                    "payment_expiry_minutes": 45,
                    "booking_confirmation_rule": "confirm_after_payment",
                    "midtrans_server_key": "SB-Mid-server-TEST",
                    "midtrans_client_key": "SB-Mid-client-TEST",
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            saved = r.json()
            assert saved["enable_online_booking_payment"] is True
            assert saved["payment_requirement"] == "deposit"
            assert saved["has_credentials"] is True
        finally:
            requests.put(
                f"{API}/settings/online-booking-payment",
                headers=owner_h,
                json={
                    "enable_online_booking_payment": cur.get("enable_online_booking_payment", False),
                    "payment_requirement": cur.get("payment_requirement", "none"),
                    "deposit_type": cur.get("deposit_type", "fixed"),
                    "deposit_value": cur.get("deposit_value", 0),
                    "payment_provider": cur.get("payment_provider", "none"),
                    "provider_mode": cur.get("provider_mode", "sandbox"),
                    "payment_expiry_minutes": cur.get("payment_expiry_minutes", 30),
                    "booking_confirmation_rule": cur.get("booking_confirmation_rule", "confirm_after_payment"),
                    "clear_credentials": not cur.get("has_credentials"),
                },
                timeout=TIMEOUT,
            )

    def test_non_owner_forbidden(self, owner_token):
        fo = login("fo@bodylab.id")
        r = requests.get(f"{API}/settings/online-booking-payment", headers=H(fo), timeout=TIMEOUT)
        assert r.status_code == 403


class TestPublicPaymentConfig:
    def test_public_config_when_disabled(self, clinic_slug, owner_h):
        requests.put(
            f"{API}/settings/online-booking-payment",
            headers=owner_h,
            json={
                "enable_online_booking_payment": False,
                "payment_requirement": "none",
                "payment_provider": "none",
            },
            timeout=TIMEOUT,
        )
        r = requests.get(f"{API}/public/clinics/{clinic_slug}/online-booking-payment", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["enable_online_booking_payment"] is False

    def test_checkout_rejected_when_disabled(self, clinic_slug, owner_h):
        requests.put(
            f"{API}/settings/online-booking-payment",
            headers=owner_h,
            json={"enable_online_booking_payment": False, "payment_requirement": "none", "payment_provider": "none"},
            timeout=TIMEOUT,
        )
        tr = requests.get(f"{API}/public/clinics/{clinic_slug}/treatments", timeout=TIMEOUT).json()
        treatment_name = (tr.get("treatments") or [{}])[0].get("name") or "Consultation"
        r = requests.post(
            f"{API}/public/clinics/{clinic_slug}/bookings/checkout",
            json={
                "patient_name": "TEST Pay",
                "patient_phone": "+6281999000111",
                "treatment": treatment_name,
                "duration_min": 30,
                "scheduled_at": future_iso(),
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


class TestPublicBookingRegression:
    def test_standard_booking_still_works_without_payment(self, clinic_slug, owner_h):
        requests.put(
            f"{API}/settings/online-booking-payment",
            headers=owner_h,
            json={"enable_online_booking_payment": False, "payment_requirement": "none", "payment_provider": "none"},
            timeout=TIMEOUT,
        )
        tr = requests.get(f"{API}/public/clinics/{clinic_slug}/treatments", timeout=TIMEOUT).json()
        treatments = tr.get("treatments") or []
        assert treatments, "Need at least one public treatment for regression test"
        treatment_name = treatments[0]["name"]
        sched = future_iso(days_ahead=12, hour=15, minute=0)
        phone = f"+62819{uuid.uuid4().int % 10**8:08d}"
        r = requests.post(
            f"{API}/public/clinics/{clinic_slug}/bookings",
            json={
                "patient_name": "TEST NoPay",
                "patient_phone": phone,
                "treatment": treatment_name,
                "duration_min": int(treatments[0].get("duration_min") or 30),
                "scheduled_at": sched,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("status") == "booked"
        assert "pending_payment" not in (b.get("status") or "")


class TestPaymentReport:
    def test_report_endpoint(self, owner_h):
        r = requests.get(f"{API}/reports/online-booking-payments", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d
        assert "summary" in d
