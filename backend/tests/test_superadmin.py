"""Super Admin / Platform portal endpoint tests (Phase 5)."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://aesthetic-records.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

PLATFORM_EMAIL = "platform@clinicos.id"
PLATFORM_PASSWORD = "ClinicOS@2026"
OWNER_EMAIL = "owner@cantikbeauty.id"
OWNER_PASSWORD = "password123"
OTHER_OWNER_EMAIL = "owner@renaskin.id"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def platform_token():
    r = requests.post(f"{API}/auth/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
    assert r.status_code == 200, f"Platform login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("user", {}).get("platform_admin") is True
    return data["token"]


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, f"Owner login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session", autouse=True)
def _restore_cantikbeauty(platform_token):
    """Restore cantikbeauty back to starter plan + active after payment-flow test mutations."""
    yield
    try:
        rows = requests.get(f"{API}/superadmin/clinics?q=cantik", headers=hdr(platform_token)).json()
        if rows:
            cid = rows[0]["id"]
            requests.put(f"{API}/superadmin/clinics/{cid}/subscription",
                         json={"plan": "starter", "status": "active"}, headers=hdr(platform_token))
    except Exception:
        pass


@pytest.fixture(scope="session")
def other_owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OTHER_OWNER_EMAIL, "password": OWNER_PASSWORD})
    if r.status_code != 200:
        pytest.skip("other owner not seeded")
    return r.json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Auth / Access control ----------
class TestAccessControl:
    def test_dashboard_requires_platform_admin(self, owner_token):
        r = requests.get(f"{API}/superadmin/dashboard", headers=hdr(owner_token))
        assert r.status_code == 403

    def test_dashboard_unauth(self):
        r = requests.get(f"{API}/superadmin/dashboard")
        assert r.status_code in (401, 403)

    def test_clinics_list_blocks_owner(self, owner_token):
        r = requests.get(f"{API}/superadmin/clinics", headers=hdr(owner_token))
        assert r.status_code == 403


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_shape(self, platform_token):
        r = requests.get(f"{API}/superadmin/dashboard", headers=hdr(platform_token))
        assert r.status_code == 200
        d = r.json()
        for k in ("total_clinics", "by_status", "by_plan", "mrr_idr", "pending_payments", "new_clinics_30d"):
            assert k in d, f"missing {k}"
        assert isinstance(d["total_clinics"], int)
        assert isinstance(d["by_status"], dict)
        assert isinstance(d["mrr_idr"], int)

    def test_dashboard_mrr_matches_active(self, platform_token):
        # MRR = sum of plan prices for clinics with status=active
        plans = requests.get(f"{API}/plans").json()
        cat = {p["key"]: p["price_idr"] for p in plans}
        rows = requests.get(f"{API}/superadmin/clinics?status=active", headers=hdr(platform_token)).json()
        expected = sum(cat.get((r.get("subscription") or {}).get("plan"), 0) for r in rows)
        d = requests.get(f"{API}/superadmin/dashboard", headers=hdr(platform_token)).json()
        assert d["mrr_idr"] == expected, f"MRR {d['mrr_idr']} != computed {expected}"


# ---------- Clinics list/detail ----------
class TestClinics:
    def test_list_all(self, platform_token):
        r = requests.get(f"{API}/superadmin/clinics", headers=hdr(platform_token))
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) > 0
        for row in rows:
            for k in ("id", "name", "staff_count", "patient_count", "booking_count"):
                assert k in row

    def test_list_filter_by_plan(self, platform_token):
        r = requests.get(f"{API}/superadmin/clinics?plan=clinic", headers=hdr(platform_token))
        assert r.status_code == 200
        for row in r.json():
            assert (row.get("subscription") or {}).get("plan") == "clinic"

    def test_list_search_q(self, platform_token):
        r = requests.get(f"{API}/superadmin/clinics?q=cantik", headers=hdr(platform_token))
        assert r.status_code == 200
        assert any("cantik" in (row.get("name", "") + row.get("slug", "")).lower() for row in r.json())

    def test_clinic_detail(self, platform_token):
        rows = requests.get(f"{API}/superadmin/clinics?q=cantik", headers=hdr(platform_token)).json()
        cid = rows[0]["id"]
        r = requests.get(f"{API}/superadmin/clinics/{cid}", headers=hdr(platform_token))
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == cid
        assert "users" in d and isinstance(d["users"], list)
        assert "recent_payments" in d
        assert "staff_count" in d and "patient_count" in d and "booking_count" in d

    def test_clinic_detail_404(self, platform_token):
        r = requests.get(f"{API}/superadmin/clinics/nonexistent-xyz", headers=hdr(platform_token))
        assert r.status_code == 404


# ---------- Subscription update ----------
class TestSubscription:
    @pytest.fixture(scope="class")
    def target_clinic_id(self, platform_token):
        # use rena skin (trial) so we don't disturb active clinics
        rows = requests.get(f"{API}/superadmin/clinics?q=rena", headers=hdr(platform_token)).json()
        if not rows:
            rows = requests.get(f"{API}/superadmin/clinics", headers=hdr(platform_token)).json()
        return rows[0]["id"]

    def test_change_plan(self, platform_token, target_clinic_id):
        r = requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                         json={"plan": "clinic"}, headers=hdr(platform_token))
        assert r.status_code == 200
        # Verify via GET
        d = requests.get(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token)).json()
        assert d["subscription"]["plan"] == "clinic"

    def test_invalid_plan_400(self, platform_token, target_clinic_id):
        r = requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                         json={"plan": "bogus"}, headers=hdr(platform_token))
        assert r.status_code == 400

    def test_invalid_status_400(self, platform_token, target_clinic_id):
        r = requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                         json={"status": "foo"}, headers=hdr(platform_token))
        assert r.status_code == 400

    def test_extend_days_trial(self, platform_token, target_clinic_id):
        # First set status=trial
        requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                     json={"status": "trial"}, headers=hdr(platform_token))
        before = requests.get(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token)).json()
        before_end = (before["subscription"] or {}).get("trial_end")
        r = requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                         json={"extend_days": 30}, headers=hdr(platform_token))
        assert r.status_code == 200
        after = requests.get(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token)).json()
        after_end = (after["subscription"] or {}).get("trial_end")
        assert after_end and after_end != before_end

    def test_activate_sets_expiry(self, platform_token, target_clinic_id):
        # First clear any existing expiry_date by direct extend after status switch
        r = requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                         json={"status": "active"}, headers=hdr(platform_token))
        assert r.status_code == 200
        d = requests.get(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token)).json()
        assert d["subscription"]["status"] == "active"
        assert d["subscription"].get("expiry_date")

    def test_soft_cancel(self, platform_token, target_clinic_id):
        r = requests.delete(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token))
        assert r.status_code == 200
        d = requests.get(f"{API}/superadmin/clinics/{target_clinic_id}", headers=hdr(platform_token)).json()
        assert d["subscription"]["status"] == "cancelled"
        # Restore to trial so other tests remain stable
        requests.put(f"{API}/superadmin/clinics/{target_clinic_id}/subscription",
                     json={"status": "trial"}, headers=hdr(platform_token))


# ---------- Payment Request flow (E2E) ----------
class TestPaymentFlow:
    @pytest.fixture(scope="class")
    def submitted_payment_id(self, owner_token):
        # Owner creates a payment request via multipart form
        files = {
            "file": ("proof.png", io.BytesIO(b"\x89PNG\r\n\x1a\nFAKEPROOF"), "image/png"),
        }
        data = {"plan": "clinic", "amount": 1500000, "unique_code": 123}
        r = requests.post(f"{API}/billing/payment-request",
                          data=data, files=files, headers=hdr(owner_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "submitted"
        return j["id"]

    def test_platform_admin_cannot_submit(self, platform_token):
        data = {"plan": "clinic", "amount": 100, "unique_code": 1}
        r = requests.post(f"{API}/billing/payment-request", data=data, headers=hdr(platform_token))
        assert r.status_code == 403

    def test_payment_in_queue(self, platform_token, submitted_payment_id):
        r = requests.get(f"{API}/superadmin/payments?status=submitted", headers=hdr(platform_token))
        assert r.status_code == 200
        rows = r.json()
        ids = [p["id"] for p in rows]
        assert submitted_payment_id in ids
        # ensure augmented with clinic_name + owner_email
        row = next(p for p in rows if p["id"] == submitted_payment_id)
        assert "clinic_name" in row
        assert row.get("owner_email")

    def test_unknown_plan_400(self, owner_token):
        data = {"plan": "bogus", "amount": 100, "unique_code": 1}
        r = requests.post(f"{API}/billing/payment-request", data=data, headers=hdr(owner_token))
        assert r.status_code == 400

    def test_verify_payment_activates_subscription(self, platform_token, owner_token, submitted_payment_id):
        # Verify
        r = requests.post(f"{API}/superadmin/payments/{submitted_payment_id}/verify", headers=hdr(platform_token))
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "verified"
        # Confirm subscription is now active with plan from payment
        me = requests.get(f"{API}/clinics/me", headers=hdr(owner_token)).json()
        sub = me.get("subscription") or {}
        assert sub.get("status") == "active"
        assert sub.get("plan") == "clinic"
        assert sub.get("expiry_date")

    def test_verify_idempotent(self, platform_token, submitted_payment_id):
        r = requests.post(f"{API}/superadmin/payments/{submitted_payment_id}/verify", headers=hdr(platform_token))
        assert r.status_code == 200
        assert r.json()["status"] == "verified"

    def test_reject_payment(self, platform_token, owner_token):
        # Create another payment and reject
        files = {"file": ("p.png", io.BytesIO(b"FAKE"), "image/png")}
        data = {"plan": "starter", "amount": 500000, "unique_code": 9}
        rr = requests.post(f"{API}/billing/payment-request", data=data, files=files, headers=hdr(owner_token))
        pid = rr.json()["id"]
        r = requests.post(f"{API}/superadmin/payments/{pid}/reject", headers=hdr(platform_token))
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"


# ---------- Announcements ----------
class TestAnnouncements:
    @pytest.fixture(scope="class")
    def created_id(self, platform_token):
        r = requests.post(f"{API}/superadmin/announcements",
                          json={"title": "TEST_announcement", "body": "hello world", "severity": "info"},
                          headers=hdr(platform_token))
        assert r.status_code == 200
        return r.json()["id"]

    def test_list(self, platform_token, created_id):
        r = requests.get(f"{API}/superadmin/announcements", headers=hdr(platform_token))
        assert r.status_code == 200
        assert any(a["id"] == created_id for a in r.json())

    def test_active_for_clinic_user(self, owner_token, created_id):
        r = requests.get(f"{API}/announcements/active", headers=hdr(owner_token))
        assert r.status_code == 200
        ann = r.json()
        assert ann and ann.get("active") is True

    def test_active_returns_none_for_platform_admin(self, platform_token):
        r = requests.get(f"{API}/announcements/active", headers=hdr(platform_token))
        assert r.status_code == 200
        assert r.json() is None

    def test_delete(self, platform_token, created_id):
        r = requests.delete(f"{API}/superadmin/announcements/{created_id}", headers=hdr(platform_token))
        assert r.status_code == 200
        # 404 on re-delete
        r2 = requests.delete(f"{API}/superadmin/announcements/{created_id}", headers=hdr(platform_token))
        assert r2.status_code == 404


# ---------- Multi-tenant isolation ----------
class TestMultitenant:
    def test_owner_cannot_list_others(self, owner_token):
        r = requests.get(f"{API}/superadmin/clinics", headers=hdr(owner_token))
        assert r.status_code == 403

    def test_owner_cannot_view_other_payments(self, owner_token):
        r = requests.get(f"{API}/superadmin/payments", headers=hdr(owner_token))
        assert r.status_code == 403
