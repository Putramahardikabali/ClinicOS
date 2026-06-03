"""Wave 2E: Clinic reports permission tests."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
TIMEOUT = 25

OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")
MANAGER_EMAIL = os.environ.get("MANAGER_EMAIL", "manager@bodylab.id")
FO_EMAIL = os.environ.get("FO_EMAIL", "fo@bodylab.id")
DOCTOR_EMAIL = os.environ.get("DOCTOR_EMAIL", "doctor@bodylab.id")
THERAPIST_EMAIL = os.environ.get("THERAPIST_EMAIL", "therapist@bodylab.id")
NURSE_EMAIL = os.environ.get("NURSE_EMAIL", "nurse@bodylab.id")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


def create_custom_role(owner_token, role_name, permissions):
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/staff/roles",
        headers=H(owner_token),
        json={"role_name": f"{role_name} {suffix}", "permissions": permissions},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    role = r.json()
    email = f"qa-{suffix}@example.com"
    u = requests.post(
        f"{API}/staff/users",
        headers=H(owner_token),
        json={
            "name": f"QA {suffix}",
            "email": email,
            "password": PASSWORD,
            "role_id": role["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert u.status_code == 200, u.text
    return login(email), role["id"], u.json()["id"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
        ("manager", MANAGER_EMAIL),
        ("fo", FO_EMAIL),
        ("doctor", DOCTOR_EMAIL),
        ("therapist", THERAPIST_EMAIL),
        ("nurse", NURSE_EMAIL),
    ]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


class TestReportsViewPermissions:
    def test_manager_with_reports_view_can_access_overview(self, tokens):
        r = requests.get(f"{API}/reports/overview", headers=H(tokens["manager"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_custom_role_with_reports_view_can_access_overview(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Report Viewer", ["reports.view"])
        try:
            r = requests.get(f"{API}/reports/overview", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_user_without_reports_view_receives_403(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "No Reports", ["patients.view"])
        try:
            r = requests.get(f"{API}/reports/overview", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestFoBillingReportAccess:
    def test_fo_with_billing_view_can_access_billing_report_only(self, tokens):
        fo = tokens["fo"]
        billing = requests.get(f"{API}/reports/billing", headers=H(fo), timeout=TIMEOUT)
        assert billing.status_code == 200, billing.text

    def test_fo_without_reports_view_cannot_access_non_billing_reports(self, tokens):
        fo = tokens["fo"]
        overview = requests.get(f"{API}/reports/overview", headers=H(fo), timeout=TIMEOUT)
        assert overview.status_code == 403
        revenue = requests.get(f"{API}/reports/revenue", headers=H(fo), timeout=TIMEOUT)
        assert revenue.status_code == 403
        staff = requests.get(f"{API}/reports/staff", headers=H(fo), timeout=TIMEOUT)
        assert staff.status_code == 403


class TestClinicalRolesBlockedFromReports:
    @pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
    def test_clinical_roles_blocked_from_global_reports(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        r = requests.get(f"{API}/reports/overview", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 403


class TestAuditReportPermissions:
    def test_custom_role_with_audit_view_can_access_audit_report(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Audit Viewer", ["audit.view"])
        try:
            r = requests.get(f"{API}/reports/audit-log", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_reports_view_but_not_audit_view_cannot_access_audit(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Reports Only", ["reports.view"])
        try:
            r = requests.get(f"{API}/reports/audit-log", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestReportExportPermissions:
    def test_manager_can_export_overview(self, tokens):
        r = requests.get(f"{API}/reports/overview/export", headers=H(tokens["manager"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_fo_can_export_billing_but_not_overview(self, tokens):
        fo = tokens["fo"]
        assert requests.get(f"{API}/reports/billing/export", headers=H(fo), timeout=TIMEOUT).status_code == 200
        assert requests.get(f"{API}/reports/overview/export", headers=H(fo), timeout=TIMEOUT).status_code == 403

    def test_custom_role_with_audit_view_can_export_audit_log(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Audit Exporter", ["audit.view"])
        try:
            r = requests.get(f"{API}/reports/audit-log/export", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_reports_view_without_audit_view_cannot_export_audit_log(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Overview Exporter", ["reports.view"])
        try:
            r = requests.get(f"{API}/reports/audit-log/export", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)
