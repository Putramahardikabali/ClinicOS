"""RBAC: booking coupon management permission tests."""
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


def _coupon_payload(code=None):
    return {
        "code": code or f"QA{uuid.uuid4().hex[:6].upper()}",
        "name": "QA Coupon",
        "discount_type": "percent",
        "discount_value": 10,
        "active": True,
    }


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


class TestCouponManagePermissions:
    def test_manager_can_create_update_delete_coupons(self, tokens):
        token = tokens["manager"]
        payload = _coupon_payload()
        created = requests.post(f"{API}/coupons", headers=H(token), json=payload, timeout=TIMEOUT)
        assert created.status_code == 200, created.text
        coupon_id = created.json()["id"]

        listed = requests.get(f"{API}/coupons", headers=H(token), timeout=TIMEOUT)
        assert listed.status_code == 200, listed.text
        assert any(c["id"] == coupon_id for c in listed.json())

        updated = requests.put(
            f"{API}/coupons/{coupon_id}",
            headers=H(token),
            json={"name": "Updated QA Coupon"},
            timeout=TIMEOUT,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json().get("name") == "Updated QA Coupon"

        deleted = requests.delete(f"{API}/coupons/{coupon_id}", headers=H(token), timeout=TIMEOUT)
        assert deleted.status_code == 200, deleted.text

    def test_fo_can_manage_coupons_by_default(self, tokens):
        token = tokens["fo"]
        payload = _coupon_payload()
        created = requests.post(f"{API}/coupons", headers=H(token), json=payload, timeout=TIMEOUT)
        assert created.status_code == 200, created.text
        coupon_id = created.json()["id"]

        assert requests.get(f"{API}/coupons", headers=H(token), timeout=TIMEOUT).status_code == 200

        deleted = requests.delete(f"{API}/coupons/{coupon_id}", headers=H(token), timeout=TIMEOUT)
        assert deleted.status_code == 200, deleted.text

    @pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
    def test_clinical_roles_blocked_from_coupon_management(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        payload = _coupon_payload()
        assert requests.post(f"{API}/coupons", headers=H(token), json=payload, timeout=TIMEOUT).status_code == 403
        assert requests.get(f"{API}/coupons", headers=H(token), timeout=TIMEOUT).status_code == 403

    def test_custom_role_with_coupons_manage_can_crud(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Coupon Manager", ["coupons.manage"])
        payload = _coupon_payload()
        try:
            created = requests.post(f"{API}/coupons", headers=H(user_token), json=payload, timeout=TIMEOUT)
            assert created.status_code == 200, created.text
            coupon_id = created.json()["id"]
            assert requests.get(f"{API}/coupons", headers=H(user_token), timeout=TIMEOUT).status_code == 200
            assert requests.put(
                f"{API}/coupons/{coupon_id}",
                headers=H(user_token),
                json={"active": False},
                timeout=TIMEOUT,
            ).status_code == 200
            assert requests.delete(f"{API}/coupons/{coupon_id}", headers=H(user_token), timeout=TIMEOUT).status_code == 200
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_without_coupons_manage_is_blocked(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "No Coupon Access", ["patients.view"])
        payload = _coupon_payload()
        try:
            assert requests.post(f"{API}/coupons", headers=H(user_token), json=payload, timeout=TIMEOUT).status_code == 403
            assert requests.get(f"{API}/coupons", headers=H(user_token), timeout=TIMEOUT).status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_booking_coupon_validation_unchanged_for_fo(self, tokens):
        """Applying coupons at booking time does not require coupons.manage."""
        owner = tokens["owner"]
        fo = tokens["fo"]
        payload = _coupon_payload()
        created = requests.post(f"{API}/coupons", headers=H(owner), json=payload, timeout=TIMEOUT)
        assert created.status_code == 200, created.text
        code = payload["code"]
        try:
            treatments = requests.get(
                f"{API}/treatments-catalog",
                headers=H(fo),
                params={"active_only": True},
                timeout=TIMEOUT,
            )
            assert treatments.status_code == 200, treatments.text
            rows = treatments.json()
            if isinstance(rows, dict):
                rows = rows.get("items") or []
            assert rows, "need at least one treatment"
            treatment = rows[0]["name"]
            vr = requests.post(
                f"{API}/bookings/validate-coupon",
                headers=H(fo),
                json={"treatment": treatment, "code": code},
                timeout=TIMEOUT,
            )
            assert vr.status_code == 200, vr.text
            assert vr.json().get("coupon_code") == code
        finally:
            requests.delete(f"{API}/coupons/{created.json()['id']}", headers=H(owner), timeout=TIMEOUT)
