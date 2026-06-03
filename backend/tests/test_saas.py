"""SaaS multi-tenant tests (Phase 1 & 2)."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["token"]


def auth_h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------- Plans ----------------
class TestPlans:
    def test_get_plans_returns_three(self):
        r = requests.get(f"{API}/plans", timeout=30)
        assert r.status_code == 200
        plans = r.json()
        assert isinstance(plans, list)
        keys = [p["key"] for p in plans]
        assert set(keys) == {"starter", "clinic", "complete"}
        # Prices per request
        price_map = {p["key"]: p["price_idr"] for p in plans}
        assert price_map["starter"] == 800_000
        assert price_map["clinic"] == 1_200_000
        assert price_map["complete"] == 1_500_000
        # Features sanity
        feats = {p["key"]: set(p["features"]) for p in plans}
        assert "emr" not in feats["starter"]
        assert "photos" not in feats["starter"]
        assert "treatments" in feats["starter"]
        assert "audit_log" not in feats["clinic"]
        assert "audit_log" in feats["complete"]
        assert "products" in feats["complete"]
        assert "products" not in feats["clinic"]
        assert "commissions" not in feats["clinic"]
        assert "whatsapp_automation" not in feats["clinic"]


# ---------------- Register clinic ----------------
class TestRegisterClinic:
    def test_register_clinic_creates_owner_and_trial(self):
        uniq = uuid.uuid4().hex[:8]
        email = f"test_{uniq}@example.com"
        payload = {
            "clinic_name": f"TEST Clinic {uniq}",
            "owner_name": "Test Owner",
            "email": email,
            "password": "password123",
            "phone": "+62000",
            "city": "Bali",
        }
        r = requests.post(f"{API}/auth/register-clinic", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and len(data["token"]) > 10
        assert data["user"]["email"] == email
        assert data["user"]["role"] == "super_admin"
        clinic = data["clinic"]
        assert clinic["subscription"]["status"] == "trial"
        assert clinic["subscription"]["plan"] == "trial"
        assert clinic["onboarded"] is False
        assert clinic["readonly"] is False
        # trial features should include 'emr' (Complete features during trial)
        assert "emr" in clinic["features"]
        # GET /clinics/me using token returns same clinic
        r2 = requests.get(f"{API}/clinics/me", headers=auth_h(data["token"]), timeout=30)
        assert r2.status_code == 200
        me = r2.json()
        assert me["id"] == clinic["id"]
        assert me["subscription"]["status"] == "trial"

    def test_register_duplicate_email_409(self):
        r = requests.post(f"{API}/auth/register-clinic", json={
            "clinic_name": "Dup",
            "owner_name": "Dup",
            "email": "owner@cantikbeauty.id",
            "password": "password123",
        }, timeout=30)
        assert r.status_code == 409


# ---------------- Seeded SaaS clinics ----------------
SEEDED = {
    "owner@cantikbeauty.id": ("starter", False),
    "owner@glowclinic.id": ("clinic", False),
    "owner@luminabali.id": ("complete", False),
    "owner@renaskin.id": (None, True),  # trial
}


class TestSeededLogins:
    @pytest.mark.parametrize("email", list(SEEDED.keys()))
    def test_login_and_clinic_me(self, email):
        token = login(email)
        r = requests.get(f"{API}/clinics/me", headers=auth_h(token), timeout=30)
        assert r.status_code == 200
        c = r.json()
        plan, is_trial = SEEDED[email]
        sub = c["subscription"]
        if is_trial:
            assert sub["status"] == "trial"
            assert "emr" in c["features"]
        else:
            assert sub["plan"] == plan
            assert sub["status"] == "active"
            # plan-specific feature checks
            if plan == "starter":
                assert "emr" not in c["features"]
                assert "photos" not in c["features"]
                assert "treatments" in c["features"]
                assert "billing" in c["features"]
                assert "commissions" not in c["features"]
                assert "mapping" not in c["features"]
            elif plan == "clinic":
                assert "emr" in c["features"]
                assert "audit_log" not in c["features"]
                assert "products" not in c["features"]
            elif plan == "complete":
                assert "emr" in c["features"]
                assert "audit_log" in c["features"]
                assert "products" in c["features"]
        assert c["readonly"] is False
        assert "plan_details" in c

    def test_super_admin_can_update_clinic(self):
        token = login("owner@cantikbeauty.id")
        new_phone = f"+628000{int(time.time()) % 100000}"
        r = requests.put(f"{API}/clinics/me", headers=auth_h(token),
                          json={"phone": new_phone}, timeout=30)
        assert r.status_code == 200, r.text
        # GET to verify persistence
        r2 = requests.get(f"{API}/clinics/me", headers=auth_h(token), timeout=30)
        assert r2.json()["phone"] == new_phone


# ---------------- Multi-tenant isolation ----------------
class TestTenantIsolation:
    def test_cantik_cannot_see_lumina_patients(self):
        t_cantik = login("owner@cantikbeauty.id")
        t_lumina = login("owner@luminabali.id")
        rc = requests.get(f"{API}/patients", headers=auth_h(t_cantik), timeout=30)
        rl = requests.get(f"{API}/patients", headers=auth_h(t_lumina), timeout=30)
        assert rc.status_code == 200 and rl.status_code == 200
        # Each list should be scoped; their intersection of ids should be empty
        cantik_ids = {p["id"] for p in rc.json()}
        lumina_ids = {p["id"] for p in rl.json()}
        assert cantik_ids.isdisjoint(lumina_ids), "clinic data leak detected"


# ---------------- Trial countdown for Rena Skin ----------------
class TestRenaTrialCountdown:
    def test_rena_skin_is_trial_with_trial_end(self):
        token = login("owner@renaskin.id")
        r = requests.get(f"{API}/clinics/me", headers=auth_h(token), timeout=30)
        assert r.status_code == 200
        c = r.json()
        assert c["subscription"]["status"] == "trial"
        assert c["subscription"]["trial_end"] is not None
