"""Tests for platform_settings module (iteration 8)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://aesthetic-records.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PLATFORM_EMAIL = "platform@clinicos.id"
PLATFORM_PASSWORD = "ClinicOS@2026"
OWNER_EMAIL = "owner@cantikbeauty.id"
OWNER_PASSWORD = "password123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def sa_token():
    return _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def sa_headers(sa_token):
    return {"Authorization": f"Bearer {sa_token}"}


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module", autouse=True)
def _restore_defaults(sa_headers):
    """After all tests, restore platform_settings to defaults so downstream E2E tests pass."""
    yield
    # restore: clear plan_overrides, keep both default banks active, restore support fields
    restore = {
        "platform_name": "ClinicOS",
        "support_whatsapp": "6281234567890",
        "support_hours": "Mon-Fri 9am-6pm WITA",
        "support_email": "support@clinicos.id",
        "plan_overrides": {},
        "banks": [
            {"bank": "BCA", "account_number": "1234567890", "account_holder": "PT ClinicOS Indonesia", "active": True, "note": ""},
            {"bank": "Mandiri", "account_number": "0987654321", "account_holder": "PT ClinicOS Indonesia", "active": True, "note": ""},
        ],
    }
    requests.put(f"{API}/superadmin/platform-settings", json=restore, headers=sa_headers, timeout=15)


# ---------------- Public config ----------------
class TestPublicConfig:
    def test_public_no_auth(self):
        r = requests.get(f"{API}/platform/public-config", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "platform_name" in d
        assert "support" in d and {"whatsapp", "hours", "email"} <= set(d["support"].keys())
        assert "banks" in d and isinstance(d["banks"], list)
        # default banks should both be active
        for b in d["banks"]:
            assert b.get("active") is True

    def test_inactive_bank_hidden_from_public(self, sa_headers):
        # Get current settings
        r = requests.get(f"{API}/superadmin/platform-settings", headers=sa_headers, timeout=10)
        assert r.status_code == 200
        banks = list(r.json().get("banks") or [])
        assert len(banks) >= 2
        # mark first bank inactive
        banks_copy = [dict(b) for b in banks]
        banks_copy[0]["active"] = False
        target_bank_name = banks_copy[0]["bank"]
        upd = requests.put(f"{API}/superadmin/platform-settings", json={"banks": banks_copy}, headers=sa_headers, timeout=15)
        assert upd.status_code == 200

        pub = requests.get(f"{API}/platform/public-config", timeout=10).json()
        pub_banks = pub["banks"]
        names = [b["bank"] for b in pub_banks]
        assert target_bank_name not in names, f"Inactive bank {target_bank_name} still appears in public-config: {names}"

        # SA endpoint still sees all banks (including inactive)
        sa_view = requests.get(f"{API}/superadmin/platform-settings", headers=sa_headers, timeout=10).json()
        sa_names = [b["bank"] for b in sa_view["banks"]]
        assert target_bank_name in sa_names

        # restore: re-activate
        banks_copy[0]["active"] = True
        requests.put(f"{API}/superadmin/platform-settings", json={"banks": banks_copy}, headers=sa_headers, timeout=15)


# ---------------- Access control ----------------
class TestAccessControl:
    def test_sa_settings_requires_platform_admin(self, owner_headers):
        r = requests.get(f"{API}/superadmin/platform-settings", headers=owner_headers, timeout=10)
        assert r.status_code == 403

    def test_sa_settings_put_requires_platform_admin(self, owner_headers):
        r = requests.put(f"{API}/superadmin/platform-settings", json={"platform_name": "Hacked"}, headers=owner_headers, timeout=10)
        assert r.status_code == 403

    def test_public_config_no_auth(self):
        r = requests.get(f"{API}/platform/public-config", timeout=10)
        assert r.status_code == 200


# ---------------- SA settings CRUD ----------------
class TestSettingsCrud:
    def test_get_returns_full_doc(self, sa_headers):
        r = requests.get(f"{API}/superadmin/platform-settings", headers=sa_headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("platform_name", "support_whatsapp", "support_hours", "support_email", "banks", "plan_overrides"):
            assert k in d, f"missing key {k}"
        assert "platform_branding" in d, "missing platform_branding"

    def test_partial_update_platform_name(self, sa_headers):
        new_name = f"ClinicOS-TEST-{uuid.uuid4().hex[:6]}"
        r = requests.put(f"{API}/superadmin/platform-settings", json={"platform_name": new_name}, headers=sa_headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["platform_name"] == new_name
        pub = requests.get(f"{API}/platform/public-config", timeout=10).json()
        assert pub["platform_name"] == new_name
        # restore
        requests.put(f"{API}/superadmin/platform-settings", json={"platform_name": "ClinicOS"}, headers=sa_headers, timeout=10)

    def test_partial_update_support_whatsapp_reflects_in_platform_support(self, sa_headers):
        new_wa = "6289999777111"
        r = requests.put(f"{API}/superadmin/platform-settings", json={"support_whatsapp": new_wa}, headers=sa_headers, timeout=10)
        assert r.status_code == 200
        # /api/platform/support now reads from settings
        s = requests.get(f"{API}/platform/support", timeout=10).json()
        assert s["whatsapp"] == new_wa
        # restore
        requests.put(f"{API}/superadmin/platform-settings", json={"support_whatsapp": "6281234567890"}, headers=sa_headers, timeout=10)

    def test_banks_id_normalization(self, sa_headers):
        # add a bank without id
        existing = requests.get(f"{API}/superadmin/platform-settings", headers=sa_headers, timeout=10).json()
        banks = list(existing.get("banks") or [])
        new_bank = {"bank": "BNI-TEST", "account_number": "5555000022", "account_holder": "PT ClinicOS Indonesia", "active": True, "note": "test"}
        banks_with_new = banks + [new_bank]
        r = requests.put(f"{API}/superadmin/platform-settings", json={"banks": banks_with_new}, headers=sa_headers, timeout=10)
        assert r.status_code == 200
        out = r.json()
        # all banks should have id
        for b in out["banks"]:
            assert b.get("id"), f"bank missing id: {b}"
        # find the test bank
        match = [b for b in out["banks"] if b["bank"] == "BNI-TEST"]
        assert match and match[0].get("id")

        # cleanup: remove BNI-TEST
        cleaned = [b for b in out["banks"] if b["bank"] != "BNI-TEST"]
        requests.put(f"{API}/superadmin/platform-settings", json={"banks": cleaned}, headers=sa_headers, timeout=10)


# ---------------- Plan overrides ----------------
class TestPlanOverrides:
    def test_plan_override_merges_into_plans_endpoint(self, sa_headers):
        # set clinic plan price to 1500000
        override = {"clinic": {"price_idr": 1500000}}
        r = requests.put(f"{API}/superadmin/platform-settings", json={"plan_overrides": override}, headers=sa_headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["plan_overrides"].get("clinic", {}).get("price_idr") == 1500000

        plans = requests.get(f"{API}/plans", timeout=10).json()
        clinic_plan = next((p for p in plans if p.get("id") == "clinic" or p.get("key") == "clinic"), None)
        assert clinic_plan is not None, f"clinic plan not found in /plans: {plans}"
        assert clinic_plan["price_idr"] == 1500000

        # Clear override and verify default returns
        r2 = requests.put(f"{API}/superadmin/platform-settings", json={"plan_overrides": {}}, headers=sa_headers, timeout=10)
        assert r2.status_code == 200
        plans2 = requests.get(f"{API}/plans", timeout=10).json()
        clinic_plan2 = next((p for p in plans2 if p.get("id") == "clinic" or p.get("key") == "clinic"), None)
        assert clinic_plan2["price_idr"] == 1200000, f"clinic plan didn't return to default: {clinic_plan2}"

    def test_plan_override_max_staff_storage(self, sa_headers):
        override = {"starter": {"max_staff": 7, "storage_gb": 99}}
        r = requests.put(f"{API}/superadmin/platform-settings", json={"plan_overrides": override}, headers=sa_headers, timeout=10)
        assert r.status_code == 200
        plans = requests.get(f"{API}/plans", timeout=10).json()
        starter = next((p for p in plans if p.get("id") == "starter" or p.get("key") == "starter"), None)
        assert starter is not None
        assert starter["max_staff"] == 7
        assert starter["storage_gb"] == 99
        # cleanup
        requests.put(f"{API}/superadmin/platform-settings", json={"plan_overrides": {}}, headers=sa_headers, timeout=10)


# ---------------- Platform branding ----------------
class TestPlatformBranding:
    def test_sa_can_get_platform_branding(self, sa_headers):
        r = requests.get(f"{API}/superadmin/platform/branding", headers=sa_headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("app_name", "short_name", "theme_color", "background_color"):
            assert k in d

    def test_non_sa_cannot_update_platform_branding(self, owner_headers):
        r = requests.put(f"{API}/superadmin/platform/branding", headers=owner_headers, json={"app_name": "Nope"}, timeout=10)
        assert r.status_code == 403

    def test_manifest_returns_dynamic_name(self, sa_headers):
        app_name = f"ClinicOS Manifest {uuid.uuid4().hex[:5]}"
        up = requests.put(f"{API}/superadmin/platform/branding", headers=sa_headers, json={"app_name": app_name}, timeout=10)
        assert up.status_code == 200
        m = requests.get(f"{BASE_URL}/manifest.webmanifest", timeout=10)
        assert m.status_code == 200
        body = m.json()
        assert body.get("name") == app_name


# ---------------- Payments proof_content_type ----------------
class TestPaymentsProof:
    def test_payments_include_proof_content_type(self, sa_headers):
        r = requests.get(f"{API}/superadmin/payments", headers=sa_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # find any row with proof_path
        with_proof = [r for r in rows if r.get("proof_path")]
        for r0 in with_proof:
            assert "proof_content_type" in r0, f"proof_content_type missing: {r0}"
