"""Wave 1A: Invoice endpoints gated by billing.* permissions (not legacy roles)."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
TIMEOUT = 25

OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")
FO_EMAIL = os.environ.get("FO_EMAIL", "fo@bodylab.id")
MANAGER_EMAIL = os.environ.get("MANAGER_EMAIL", "manager@bodylab.id")
DOCTOR_EMAIL = os.environ.get("DOCTOR_EMAIL", "doctor@bodylab.id")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


def create_checkout_visit(token):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=9)).strftime("%Y-%m-%d")
    rb = requests.post(
        f"{API}/bookings",
        headers=H(token),
        json={
            "patient_name": f"Inv Perm {uuid.uuid4().hex[:6]}",
            "patient_phone": "081299900011",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T14:00:00",
        },
        timeout=TIMEOUT,
    )
    assert rb.status_code == 200, rb.text
    bid = rb.json()["id"]
    rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(token), timeout=TIMEOUT)
    assert rs.status_code == 200, rs.text
    return rs.json()["visit"]["id"], bid


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
    return {
        "owner": login(OWNER_EMAIL),
        "fo": login(FO_EMAIL),
        "manager": login(MANAGER_EMAIL),
        "doctor": login(DOCTOR_EMAIL),
    }


class TestInvoicePermissionHardening:
    def test_fo_can_list_create_and_update_invoices(self, tokens):
        fo = tokens["fo"]
        r_list = requests.get(f"{API}/invoices", headers=H(fo), timeout=TIMEOUT)
        assert r_list.status_code == 200, r_list.text

        vid, bid = create_checkout_visit(fo)
        try:
            r_create = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT)
            assert r_create.status_code == 200, r_create.text
            iid = r_create.json()["id"]

            r_update = requests.put(
                f"{API}/invoices/{iid}",
                headers=H(fo),
                json={
                    "items": [
                        {"item_type": "custom", "name": "Consult", "unit_price_idr": 150000, "quantity": 1}
                    ],
                },
                timeout=TIMEOUT,
            )
            assert r_update.status_code == 200, r_update.text
            assert r_update.json()["subtotal"] == 150000
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_manager_can_create_and_update_invoices(self, tokens):
        manager = tokens["manager"]
        fo = tokens["fo"]
        vid, bid = create_checkout_visit(fo)
        try:
            r_create = requests.post(f"{API}/invoices/visit/{vid}", headers=H(manager), timeout=TIMEOUT)
            assert r_create.status_code == 200, r_create.text
            iid = r_create.json()["id"]

            r_update = requests.put(
                f"{API}/invoices/{iid}/payment",
                headers=H(manager),
                json={"amount_paid": 0, "payment_method": "cash"},
                timeout=TIMEOUT,
            )
            assert r_update.status_code == 200, r_update.text
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_doctor_without_billing_view_cannot_list_invoices(self, tokens):
        r = requests.get(f"{API}/invoices", headers=H(tokens["doctor"]), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_custom_role_with_billing_view_can_list_invoices(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(owner, "Billing Viewer", ["billing.view"])
        try:
            r = requests.get(f"{API}/invoices", headers=H(viewer_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_without_billing_view_cannot_list_invoices(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(owner, "No Billing", ["patients.view"])
        try:
            r = requests.get(f"{API}/invoices", headers=H(viewer_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_pay_with_package_requires_packages_use(self, tokens):
        owner = tokens["owner"]
        fo = tokens["fo"]
        edit_only_token, role_id, user_id = create_custom_role(
            owner,
            "Billing Edit Only",
            ["billing.view", "billing.create", "billing.edit"],
        )
        vid, bid = create_checkout_visit(fo)
        try:
            inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT).json()
            iid = inv["id"]
            item_id = (inv.get("items") or [{}])[0].get("id") or "missing-line"

            r = requests.post(
                f"{API}/invoices/{iid}/items/{item_id}/pay-with-package",
                headers=H(edit_only_token),
                json={"patient_package_id": "fake-pkg", "used_sessions_count": 1},
                timeout=TIMEOUT,
            )
            assert r.status_code == 403, r.text
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestInvoiceReportPermissions:
    def test_fo_with_billing_view_can_access_dashboard_summary(self, tokens):
        r = requests.get(f"{API}/invoices/dashboard/summary", headers=H(tokens["fo"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "revenue_today_idr" in r.json()

    def test_manager_with_reports_view_can_access_report_summary(self, tokens):
        r = requests.get(
            f"{API}/invoices/reports/summary",
            headers=H(tokens["manager"]),
            params={"from": "2026-01-01", "to": "2026-12-31"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert "total_revenue_idr" in r.json()

    def test_custom_role_with_billing_view_can_access_dashboard_summary(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(owner, "Billing Dashboard", ["billing.view"])
        try:
            r = requests.get(f"{API}/invoices/dashboard/summary", headers=H(viewer_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_reports_view_can_access_report_summary(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(owner, "Reports Viewer", ["reports.view"])
        try:
            r = requests.get(
                f"{API}/invoices/reports/summary",
                headers=H(viewer_token),
                params={"from": "2026-01-01", "to": "2026-12-31"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_doctor_without_billing_or_reports_view_is_blocked(self, tokens):
        r_dash = requests.get(f"{API}/invoices/dashboard/summary", headers=H(tokens["doctor"]), timeout=TIMEOUT)
        assert r_dash.status_code == 403
        r_report = requests.get(
            f"{API}/invoices/reports/summary",
            headers=H(tokens["doctor"]),
            params={"from": "2026-01-01", "to": "2026-12-31"},
            timeout=TIMEOUT,
        )
        assert r_report.status_code == 403

    def test_user_without_permission_receives_403(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(owner, "No Billing Reports", ["patients.view"])
        try:
            r_dash = requests.get(f"{API}/invoices/dashboard/summary", headers=H(viewer_token), timeout=TIMEOUT)
            assert r_dash.status_code == 403
            r_report = requests.get(
                f"{API}/invoices/reports/summary",
                headers=H(viewer_token),
                params={"from": "2026-01-01", "to": "2026-12-31"},
                timeout=TIMEOUT,
            )
            assert r_report.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)
