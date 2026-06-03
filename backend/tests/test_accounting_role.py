"""Accounting system role — finance read-only access."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
TIMEOUT = 25
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


def _ensure_accounting_role(owner_token):
    requests.get(f"{API}/staff/roles", headers=H(owner_token), timeout=TIMEOUT)
    roles = requests.get(f"{API}/staff/roles", headers=H(owner_token), timeout=TIMEOUT).json()
    role = next((r for r in roles if r.get("role_key") == "accounting"), None)
    assert role, "accounting system role missing — run ensure_clinic_roles"
    return role


def _create_accounting_user(owner_token):
    role = _ensure_accounting_role(owner_token)
    suffix = uuid.uuid4().hex[:8]
    email = f"acct-{suffix}@example.com"
    u = requests.post(
        f"{API}/staff/users",
        headers=H(owner_token),
        json={
            "name": f"Accounting QA {suffix}",
            "email": email,
            "password": PASSWORD,
            "role_id": role["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert u.status_code == 200, u.text
    return login(email), role


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def accounting_user(owner_token):
    token, role = _create_accounting_user(owner_token)
    return {"token": token, "role": role}


class TestAccountingRole:
    def test_accounting_role_permissions(self, accounting_user):
        me = requests.get(f"{API}/auth/me", headers=H(accounting_user["token"]), timeout=TIMEOUT)
        assert me.status_code == 200, me.text
        perms = set(me.json().get("permissions") or [])
        assert "accounting.view" in perms
        assert "closing.view" in perms
        assert "reports.view" in perms
        assert "billing.view" in perms
        assert "invoices.view" in perms
        assert "pos.view" in perms
        assert "clinical_records.view" not in perms
        assert "visits.view" not in perms
        assert "appointments.view" not in perms
        assert "closing.create" not in perms
        assert "pos.create" not in perms

    def test_accounting_can_view_finance_endpoints(self, accounting_user):
        t = accounting_user["token"]
        for path in (
            "/invoices",
            "/pos/sales",
            "/pos/sales/today",
            "/closing/preview",
            "/closing/history",
            "/reports/overview",
        ):
            r = requests.get(f"{API}{path}", headers=H(t), timeout=TIMEOUT, params={"date": "2026-01-01"} if "closing/preview" in path else None)
            assert r.status_code == 200, f"{path}: {r.text}"

    def test_accounting_cannot_access_clinical(self, accounting_user):
        t = accounting_user["token"]
        patients = requests.get(f"{API}/patients", headers=H(t), timeout=TIMEOUT)
        assert patients.status_code == 403, patients.text
        visits = requests.get(f"{API}/visits", headers=H(t), timeout=TIMEOUT)
        assert visits.status_code == 403, visits.text

    def test_accounting_cannot_close_day_or_create_pos(self, accounting_user, owner_token):
        t = accounting_user["token"]
        close = requests.post(
            f"{API}/closing/close",
            headers=H(t),
            json={"date": "2020-01-01", "notes": "test"},
            timeout=TIMEOUT,
        )
        assert close.status_code == 403, close.text
        product = requests.get(
            f"{API}/products-catalog",
            headers=H(owner_token),
            params={"page": 1, "page_size": 1},
            timeout=TIMEOUT,
        )
        assert product.status_code == 200
        items = product.json().get("items") or []
        if not items:
            pytest.skip("no products")
        pid = items[0]["id"]
        sale = requests.post(
            f"{API}/pos/sales",
            headers=H(t),
            json={
                "is_walk_in": True,
                "customer_name": "Blocked",
                "items": [{
                    "item_type": "product",
                    "product_id": pid,
                    "name_snapshot": "X",
                    "qty": 1,
                    "unit_price": 1000,
                }],
                "complete": True,
                "payment_method": "cash",
            },
            timeout=TIMEOUT,
        )
        assert sale.status_code == 403, sale.text

    def test_accounting_reports_block_clinical_section(self, accounting_user):
        t = accounting_user["token"]
        ok = requests.get(
            f"{API}/reports/overview",
            headers=H(t),
            params={"preset": "this_month"},
            timeout=TIMEOUT,
        )
        assert ok.status_code == 200, ok.text
        blocked = requests.get(
            f"{API}/reports/consent",
            headers=H(t),
            params={"preset": "this_month"},
            timeout=TIMEOUT,
        )
        assert blocked.status_code == 403, blocked.text
