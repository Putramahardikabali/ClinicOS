"""Wave 1C: Commission records gated by commission.* permissions."""
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


def _user_id(token, email):
    me = requests.get(f"{API}/auth/me", headers=H(token), timeout=TIMEOUT)
    assert me.status_code == 200, me.text
    return me.json()["id"]


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


def _rule_payload(name=None):
    return {
        "rule_name": name or f"QA Rule {uuid.uuid4().hex[:6]}",
        "is_active": True,
        "priority": 5,
        "applies_to_item_type": "treatment",
        "commission_type": "percentage",
        "commission_value": 10,
        "calculation_basis": "paid",
        "trigger": "invoice_paid",
    }


def _ensure_clinical_role_permissions(owner_token, role_key):
    """Sync drifted clinical system roles so permission tests match catalog defaults."""
    roles = requests.get(f"{API}/staff/roles", headers=H(owner_token), timeout=TIMEOUT).json()
    role = next((r for r in roles if r.get("role_key") == role_key), None)
    if not role:
        return
    from permissions import SYSTEM_ROLE_DEFINITIONS

    spec = next(s for s in SYSTEM_ROLE_DEFINITIONS if s["role_key"] == role_key)
    current = set(role.get("permissions") or [])
    expected = set(spec["permissions"])
    if current == expected:
        return
    requests.put(
        f"{API}/staff/roles/{role['id']}",
        headers=H(owner_token),
        json={"permissions": spec["permissions"]},
        timeout=TIMEOUT,
    )


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


@pytest.fixture(scope="module", autouse=True)
def sync_clinical_commission_permissions(tokens):
    owner = tokens.get("owner")
    if not owner:
        return
    for role_key in ("nurse", "therapist", "doctor"):
        _ensure_clinical_role_permissions(owner, role_key)


@pytest.fixture(scope="module")
def staff_ids(tokens):
    return {
        "doctor": _user_id(tokens["doctor"], DOCTOR_EMAIL) if tokens.get("doctor") else None,
        "therapist": _user_id(tokens["therapist"], THERAPIST_EMAIL) if tokens.get("therapist") else None,
        "nurse": _user_id(tokens["nurse"], NURSE_EMAIL) if tokens.get("nurse") else None,
        "manager": _user_id(tokens["manager"], MANAGER_EMAIL) if tokens.get("manager") else None,
    }


class TestCommissionManagePermissions:
    def test_manager_can_approve_commission(self, tokens):
        manager = tokens["manager"]
        r = requests.post(
            f"{API}/commission-records/approve",
            headers=H(manager),
            json={"record_ids": [str(uuid.uuid4())]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_user_without_manage_cannot_approve(self, tokens):
        fo = tokens["fo"]
        r = requests.post(
            f"{API}/commission-records/approve",
            headers=H(fo),
            json={"record_ids": [str(uuid.uuid4())]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_manager_can_mark_paid_out(self, tokens):
        manager = tokens["manager"]
        r = requests.post(
            f"{API}/commission-records/paid-out",
            headers=H(manager),
            json={"record_ids": [str(uuid.uuid4())]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_user_without_manage_cannot_mark_paid_out(self, tokens):
        fo = tokens["fo"]
        r = requests.post(
            f"{API}/commission-records/paid-out",
            headers=H(fo),
            json={"record_ids": [str(uuid.uuid4())]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestCommissionRulesPermissions:
    def test_manager_with_commission_manage_can_manage_commission_rules(self, tokens):
        manager = tokens["manager"]
        create = requests.post(
            f"{API}/commission-rules",
            headers=H(manager),
            json=_rule_payload(),
            timeout=TIMEOUT,
        )
        assert create.status_code == 200, create.text
        rule_id = create.json()["id"]
        update = requests.put(
            f"{API}/commission-rules/{rule_id}",
            headers=H(manager),
            json={**_rule_payload(), "commission_value": 12},
            timeout=TIMEOUT,
        )
        assert update.status_code == 200, update.text
        assert update.json()["commission_value"] == 12
        deactivate = requests.post(
            f"{API}/commission-rules/{rule_id}/deactivate",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert deactivate.status_code == 200, deactivate.text
        deleted = requests.delete(f"{API}/commission-rules/{rule_id}", headers=H(manager), timeout=TIMEOUT)
        assert deleted.status_code == 200, deleted.text

    def test_user_without_commission_manage_cannot_manage_commission_rules(self, tokens):
        fo = tokens["fo"]
        assert requests.get(f"{API}/commission-rules", headers=H(fo), timeout=TIMEOUT).status_code == 403
        assert requests.post(
            f"{API}/commission-rules",
            headers=H(fo),
            json=_rule_payload(),
            timeout=TIMEOUT,
        ).status_code == 403

    def test_custom_role_with_commission_manage_can_manage_commission_rules(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(
            owner, "Commission Manager", ["commission.manage"]
        )
        try:
            create = requests.post(
                f"{API}/commission-rules",
                headers=H(user_token),
                json=_rule_payload(),
                timeout=TIMEOUT,
            )
            assert create.status_code == 200, create.text
            rule_id = create.json()["id"]
            update = requests.put(
                f"{API}/commission-rules/{rule_id}",
                headers=H(user_token),
                json={**_rule_payload(), "notes": "custom role"},
                timeout=TIMEOUT,
            )
            assert update.status_code == 200, update.text
            requests.delete(f"{API}/commission-rules/{rule_id}", headers=H(owner), timeout=TIMEOUT)
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    @pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
    def test_clinical_roles_blocked_from_commission_rules(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        assert requests.get(f"{API}/commission-rules", headers=H(token), timeout=TIMEOUT).status_code == 403
        assert requests.post(
            f"{API}/commission-rules",
            headers=H(token),
            json=_rule_payload(),
            timeout=TIMEOUT,
        ).status_code == 403


class TestCommissionSyncInvoicePermissions:
    def test_manager_with_commission_manage_can_sync_invoice_commission(self, tokens):
        manager = tokens["manager"]
        r = requests.post(
            f"{API}/commission-records/sync-invoice/{uuid.uuid4()}",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert r.status_code == 404, r.text

    def test_user_without_commission_manage_cannot_sync_invoice_commission(self, tokens):
        fo = tokens["fo"]
        r = requests.post(
            f"{API}/commission-records/sync-invoice/{uuid.uuid4()}",
            headers=H(fo),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestCommissionExportPermissions:
    def test_manager_can_export_staff_commission(self, tokens, staff_ids):
        if not staff_ids.get("doctor"):
            pytest.skip("doctor seed not available")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/commission-records/export",
            headers=H(tokens["manager"]),
            params={
                "from": month_ago,
                "to": today,
                "staff_id": staff_ids["doctor"],
                "status": "approved",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert "spreadsheetml" in (r.headers.get("content-type") or "")

    def test_fo_cannot_export_all_staff_commission(self, tokens, staff_ids):
        if not staff_ids.get("doctor"):
            pytest.skip("doctor seed not available")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/commission-records/export",
            headers=H(tokens["fo"]),
            params={
                "from": month_ago,
                "to": today,
                "staff_id": staff_ids["doctor"],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestCommissionViewOwnPermissions:
    def test_doctor_can_view_own_summary(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/commission-records/my-summary", headers=H(tokens["doctor"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "totals_idr" in r.json()

    def test_therapist_can_view_own_summary(self, tokens):
        if not tokens.get("therapist"):
            pytest.skip("therapist seed not available")
        r = requests.get(f"{API}/commission-records/my-summary", headers=H(tokens["therapist"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_nurse_can_view_own_summary(self, tokens):
        if not tokens.get("nurse"):
            pytest.skip("nurse seed not available")
        r = requests.get(f"{API}/commission-records/my-summary", headers=H(tokens["nurse"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_view_own_cannot_list_other_staff_records(self, tokens, staff_ids):
        if not tokens.get("doctor") or not staff_ids.get("therapist"):
            pytest.skip("clinical staff seeds not available")
        r = requests.get(
            f"{API}/commission-records",
            headers=H(tokens["doctor"]),
            params={"staff_id": staff_ids["therapist"]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_doctor_can_export_own_commission(self, tokens, staff_ids):
        if not tokens.get("doctor") or not staff_ids.get("doctor"):
            pytest.skip("doctor seed not available")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/commission-records/export",
            headers=H(tokens["doctor"]),
            params={
                "from": month_ago,
                "to": today,
                "staff_id": staff_ids["doctor"],
                "status": "approved",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_doctor_cannot_export_other_staff_commission(self, tokens, staff_ids):
        if not tokens.get("doctor") or not staff_ids.get("therapist"):
            pytest.skip("clinical staff seeds not available")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/commission-records/export",
            headers=H(tokens["doctor"]),
            params={
                "from": month_ago,
                "to": today,
                "staff_id": staff_ids["therapist"],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 403
