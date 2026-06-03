"""Wave 3A: SaaS subscription billing permission tests."""
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


def _payment_payload():
    code = uuid.uuid4().int % 900 + 100
    return {
        "plan": "clinic",
        "amount": 1890000 + code,
        "unique_code": code,
        "billing_cycle": "monthly",
    }


def _plan_change_payload():
    return {
        "requested_plan": "complete",
        "billing_cycle": "monthly",
        "note": "permission test",
    }


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
        ("manager", MANAGER_EMAIL),
        ("fo", FO_EMAIL),
        ("doctor", DOCTOR_EMAIL),
    ]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


class TestPaymentRequestPermissions:
    def test_owner_with_billing_subscribe_can_submit_payment_request(self, tokens):
        r = requests.post(
            f"{API}/billing/payment-request",
            headers=H(tokens["owner"]),
            data=_payment_payload(),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("id")

    def test_manager_with_billing_subscribe_can_submit_and_list_payment_requests(self, tokens):
        create = requests.post(
            f"{API}/billing/payment-request",
            headers=H(tokens["manager"]),
            data=_payment_payload(),
            timeout=TIMEOUT,
        )
        assert create.status_code == 200, create.text
        listing = requests.get(f"{API}/billing/payment-requests", headers=H(tokens["manager"]), timeout=TIMEOUT)
        assert listing.status_code == 200, listing.text
        assert isinstance(listing.json(), list)

    def test_fo_without_billing_subscribe_is_blocked(self, tokens):
        assert requests.post(
            f"{API}/billing/payment-request",
            headers=H(tokens["fo"]),
            data=_payment_payload(),
            timeout=TIMEOUT,
        ).status_code == 403
        assert requests.get(f"{API}/billing/payment-requests", headers=H(tokens["fo"]), timeout=TIMEOUT).status_code == 403

    def test_custom_role_with_billing_subscribe_can_submit_payment_request(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Subscription Manager", ["billing.subscribe"])
        try:
            r = requests.post(
                f"{API}/billing/payment-request",
                headers=H(user_token),
                data=_payment_payload(),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_without_billing_subscribe_is_blocked(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Billing Viewer", ["billing.view"])
        try:
            r = requests.post(
                f"{API}/billing/payment-request",
                headers=H(user_token),
                data=_payment_payload(),
                timeout=TIMEOUT,
            )
            assert r.status_code == 403
            assert requests.get(f"{API}/billing/payment-requests", headers=H(user_token), timeout=TIMEOUT).status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestPlanChangeRequestPermissions:
    def test_manager_with_billing_subscribe_can_submit_and_list_plan_change_requests(self, tokens):
        create = requests.post(
            f"{API}/billing/plan-change-request",
            headers=H(tokens["manager"]),
            json={"requested_plan": "starter", "billing_cycle": "monthly", "note": "permission test"},
            timeout=TIMEOUT,
        )
        assert create.status_code != 403, create.text
        listing = requests.get(f"{API}/billing/plan-change-requests", headers=H(tokens["manager"]), timeout=TIMEOUT)
        assert listing.status_code == 200, listing.text

    def test_fo_without_billing_subscribe_is_blocked(self, tokens):
        assert requests.post(
            f"{API}/billing/plan-change-request",
            headers=H(tokens["fo"]),
            json=_plan_change_payload(),
            timeout=TIMEOUT,
        ).status_code == 403
        assert requests.get(f"{API}/billing/plan-change-requests", headers=H(tokens["fo"]), timeout=TIMEOUT).status_code == 403

    def test_doctor_without_billing_subscribe_is_blocked(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        assert requests.post(
            f"{API}/billing/plan-change-request",
            headers=H(tokens["doctor"]),
            json=_plan_change_payload(),
            timeout=TIMEOUT,
        ).status_code == 403
