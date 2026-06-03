"""Wave 3B: SaaS billing quote and cycle read permission tests."""
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


class TestBillingQuoteAndCyclePermissions:
    def test_owner_can_access_cycles_and_quote(self, tokens):
        cycles = requests.get(f"{API}/billing/cycles", headers=H(tokens["owner"]), timeout=TIMEOUT)
        assert cycles.status_code == 200, cycles.text
        assert len(cycles.json()) >= 1
        quote = requests.get(
            f"{API}/billing/quote",
            headers=H(tokens["owner"]),
            params={"plan": "clinic", "cycle": "monthly"},
            timeout=TIMEOUT,
        )
        assert quote.status_code == 200, quote.text
        body = quote.json()
        assert body.get("total_idr") is not None
        assert body.get("plan") == "clinic"

    def test_manager_can_access_cycles_and_quote(self, tokens):
        assert requests.get(f"{API}/billing/cycles", headers=H(tokens["manager"]), timeout=TIMEOUT).status_code == 200
        assert requests.get(
            f"{API}/billing/quote",
            headers=H(tokens["manager"]),
            params={"plan": "clinic", "cycle": "monthly"},
            timeout=TIMEOUT,
        ).status_code == 200

    def test_custom_role_with_billing_subscription_view_can_access(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(
            owner, "Saas Billing Viewer", ["billing.subscription_view"]
        )
        try:
            assert requests.get(f"{API}/billing/cycles", headers=H(user_token), timeout=TIMEOUT).status_code == 200
            assert requests.get(
                f"{API}/billing/quote",
                headers=H(user_token),
                params={"plan": "starter", "cycle": "monthly"},
                timeout=TIMEOUT,
            ).status_code == 200
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_billing_view_only_cannot_access_saas_quote(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Invoice Billing Viewer", ["billing.view"])
        try:
            assert requests.get(f"{API}/billing/cycles", headers=H(user_token), timeout=TIMEOUT).status_code == 403
            assert requests.get(
                f"{API}/billing/quote",
                headers=H(user_token),
                params={"plan": "starter", "cycle": "monthly"},
                timeout=TIMEOUT,
            ).status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_billing_subscribe_can_access(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Saas Billing Subscriber", ["billing.subscribe"])
        try:
            assert requests.get(f"{API}/billing/cycles", headers=H(user_token), timeout=TIMEOUT).status_code == 200
            assert requests.get(
                f"{API}/billing/quote",
                headers=H(user_token),
                params={"plan": "starter", "cycle": "monthly"},
                timeout=TIMEOUT,
            ).status_code == 200
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_user_without_subscription_view_or_subscribe_is_blocked(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "No Saas Billing", ["patients.view"])
        try:
            assert requests.get(f"{API}/billing/cycles", headers=H(user_token), timeout=TIMEOUT).status_code == 403
            assert requests.get(
                f"{API}/billing/quote",
                headers=H(user_token),
                params={"plan": "clinic", "cycle": "monthly"},
                timeout=TIMEOUT,
            ).status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_fo_without_billing_subscription_view_is_blocked(self, tokens):
        fo = tokens["fo"]
        assert requests.get(f"{API}/billing/cycles", headers=H(fo), timeout=TIMEOUT).status_code == 403
        assert requests.get(
            f"{API}/billing/quote",
            headers=H(fo),
            params={"plan": "clinic", "cycle": "monthly"},
            timeout=TIMEOUT,
        ).status_code == 403

    def test_fo_without_billing_subscribe_is_blocked_from_subscription_actions(self, tokens):
        fo = tokens["fo"]
        assert requests.post(
            f"{API}/billing/payment-request",
            headers=H(fo),
            data={"plan": "clinic", "amount": 100, "unique_code": 101, "billing_cycle": "monthly"},
            timeout=TIMEOUT,
        ).status_code == 403

    @pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
    def test_clinical_roles_blocked_by_default(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        assert requests.get(f"{API}/billing/cycles", headers=H(token), timeout=TIMEOUT).status_code == 403
        assert requests.get(
            f"{API}/billing/quote",
            headers=H(token),
            params={"plan": "clinic", "cycle": "monthly"},
            timeout=TIMEOUT,
        ).status_code == 403

    def test_quote_values_unchanged(self, tokens):
        owner = tokens["owner"]
        manager = tokens["manager"]
        owner_quote = requests.get(
            f"{API}/billing/quote",
            headers=H(owner),
            params={"plan": "clinic", "cycle": "annual"},
            timeout=TIMEOUT,
        ).json()
        manager_quote = requests.get(
            f"{API}/billing/quote",
            headers=H(manager),
            params={"plan": "clinic", "cycle": "annual"},
            timeout=TIMEOUT,
        ).json()
        for key in ("total_idr", "per_month_idr", "months", "plan", "plan_name"):
            assert owner_quote.get(key) == manager_quote.get(key), key
