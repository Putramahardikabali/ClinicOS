"""Phase 6: Launch hardening — regression QA, permissions, data safety.

Multi-performer and overtime booking tests: tests/test_launch_booking_performers.py
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")

ACCOUNTS = {
    "owner": os.environ.get("OWNER_EMAIL", "admin@bodylab.id"),
    "manager": os.environ.get("MANAGER_EMAIL", "manager@bodylab.id"),
    "fo": os.environ.get("FO_EMAIL", "fo@bodylab.id"),
    "doctor": os.environ.get("DOCTOR_EMAIL", "doctor@bodylab.id"),
    "therapist": os.environ.get("THERAPIST_EMAIL", "therapist@bodylab.id"),
    "nurse": os.environ.get("NURSE_EMAIL", "nurse@bodylab.id"),
}

PLATFORM_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "platform@clinicos.id")
PLATFORM_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "ChangeMe123!")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=25)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=25)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for role, email in ACCOUNTS.items():
        try:
            out[role] = login(email)
        except AssertionError:
            out[role] = None
    out["platform"] = login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    return out


# ---------- Permission audit ----------
class TestPermissionAudit:
    def test_doctor_blocked_owner_dashboard(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/dashboard/owner", headers=H(tokens["doctor"]), timeout=20)
        assert r.status_code == 403

    def test_manager_can_owner_dashboard(self, tokens):
        if not tokens.get("manager"):
            pytest.skip("manager seed not available")
        r = requests.get(f"{API}/dashboard/owner", headers=H(tokens["manager"]), timeout=20)
        assert r.status_code == 200

    def test_doctor_settings_limited_subset(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/settings", headers=H(tokens["doctor"]), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "form_config" in body
        assert "operating_hours" not in body or body.get("operating_hours") is None

    def test_owner_settings_full(self, tokens):
        r = requests.get(f"{API}/settings", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200
        assert "form_config" in r.json()

    def test_doctor_cannot_create_patient(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.post(
            f"{API}/patients",
            headers=H(tokens["doctor"]),
            json={"full_name": "QA Block", "phone": "0811111111"},
            timeout=20,
        )
        assert r.status_code == 403

    def test_manager_can_create_patient(self, tokens):
        if not tokens.get("manager"):
            pytest.skip("manager seed not available")
        r = requests.post(
            f"{API}/patients",
            headers=H(tokens["manager"]),
            json={"full_name": f"QA Mgr {uuid.uuid4().hex[:6]}", "phone": "0812222222"},
            timeout=20,
        )
        assert r.status_code == 200

    def test_clinic_cannot_access_sa_pipeline(self, tokens):
        r = requests.get(f"{API}/superadmin/pipeline", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 403

    def test_doctor_audit_denied(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/audit-logs", headers=H(tokens["doctor"]), timeout=20)
        assert r.status_code == 403


# ---------- Data safety ----------
class TestDataSafety:
    def test_users_never_return_password_hash(self, tokens):
        r = requests.get(f"{API}/users", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200
        for u in r.json():
            assert "password" not in u
            assert "password_hash" not in u

    def test_auth_me_no_password(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "password" not in body
        assert "password_hash" not in body

    def test_permanent_delete_requires_test_flag(self, tokens):
        sa = H(tokens["platform"])
        clinics = requests.get(f"{API}/superadmin/clinics", headers=sa, params={"q": "body"}, timeout=20).json()
        prod = next((c for c in clinics if not c.get("is_test_clinic")), None)
        if not prod:
            pytest.skip("no prod clinic in seed")
        r = requests.post(
            f"{API}/superadmin/clinics/{prod['id']}/delete-permanent",
            headers=sa,
            json={"confirm_slug": prod.get("slug"), "reason": "test", "confirm_phrase": "DELETE PERMANENTLY", "confirmed": True},
            timeout=20,
        )
        assert r.status_code in (400, 403)


# ---------- Major flow smoke tests ----------
class TestMajorFlows:
    def test_public_trial_signup(self):
        u = uuid.uuid4().hex[:8]
        r = requests.post(
            f"{API}/auth/register-clinic",
            json={
                "clinic_name": f"Launch QA {u}",
                "owner_name": "Launch QA",
                "email": f"launch_{u}@example.com",
                "password": "password123",
            },
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json().get("token")

    def test_owner_onboarding_checklist(self, tokens):
        r = requests.get(f"{API}/clinic/onboarding-checklist", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_staff_list(self, tokens):
        r = requests.get(f"{API}/staff/users", headers=H(tokens["owner"]), timeout=20)
        if r.status_code == 404:
            r = requests.get(f"{API}/users", headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200

    def test_bookings_list(self, tokens):
        if not tokens.get("fo"):
            pytest.skip("fo seed not available")
        r = requests.get(f"{API}/bookings", headers=H(tokens["fo"]), timeout=20)
        assert r.status_code == 200

    def test_visits_list(self, tokens):
        if not tokens.get("fo"):
            pytest.skip("fo seed not available")
        r = requests.get(f"{API}/visits", headers=H(tokens["fo"]), timeout=20)
        assert r.status_code == 200

    def test_invoices_list(self, tokens):
        if not tokens.get("fo"):
            pytest.skip("fo seed not available")
        r = requests.get(f"{API}/invoices", headers=H(tokens["fo"]), timeout=20)
        assert r.status_code == 200

    def test_doctor_cannot_list_invoices(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/invoices", headers=H(tokens["doctor"]), timeout=20)
        assert r.status_code == 403

    def test_reports_gated(self, tokens):
        if not tokens.get("manager"):
            pytest.skip("manager seed not available")
        r = requests.get(f"{API}/reports/overview", headers=H(tokens["manager"]), timeout=20)
        assert r.status_code in (200, 403)

    def test_sa_payment_queue(self, tokens):
        r = requests.get(f"{API}/superadmin/payments", headers=H(tokens["platform"]), timeout=20)
        assert r.status_code == 200

    def test_customer_pipeline(self, tokens):
        r = requests.get(f"{API}/superadmin/pipeline", headers=H(tokens["platform"]), timeout=30)
        assert r.status_code == 200

    def test_public_booking_branding(self):
        r = requests.get(f"{API}/branding", timeout=15)
        assert r.status_code == 200

    def test_platform_support_public(self):
        r = requests.get(f"{API}/platform/support", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for key in body:
            assert "password" not in key.lower()
            val = body[key]
            if isinstance(val, str):
                assert "password" not in val.lower()
