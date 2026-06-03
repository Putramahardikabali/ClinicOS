"""Phase 5: Customer lifecycle & growth ops QA."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("API_BASE", "http://localhost:8000")
API = f"{BASE_URL}/api"
PLATFORM_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "platform@clinicos.id")
PLATFORM_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "ChangeMe123!")
OWNER_TRIAL = os.environ.get("OWNER_TRIAL", "owner@renaskin.id")


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _login(email, password="password123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sa():
    tok = _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    return hdr(tok)


@pytest.fixture(scope="module")
def trial_owner():
    return hdr(_login(OWNER_TRIAL))


class TestPipeline:
    def test_pipeline_list(self, sa):
        r = requests.get(f"{API}/superadmin/pipeline", headers=sa, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        if data["items"]:
            row = data["items"][0]
            for key in (
                "clinic_id", "clinic_name", "owner_email", "plan", "pipeline_status",
                "health_score", "health_label", "setup_progress",
            ):
                assert key in row

    def test_pipeline_filter_status(self, sa):
        r = requests.get(f"{API}/superadmin/pipeline", headers=sa, params={"status": "trial_active"}, timeout=30)
        assert r.status_code == 200
        for row in r.json()["items"]:
            assert row["pipeline_status"] == "trial_active"

    def test_pipeline_detail(self, sa):
        lst = requests.get(f"{API}/superadmin/pipeline", headers=sa, timeout=30).json()["items"]
        assert lst
        cid = lst[0]["clinic_id"]
        r = requests.get(f"{API}/superadmin/pipeline/{cid}", headers=sa, timeout=20)
        assert r.status_code == 200
        assert "pipeline" in r.json()
        assert "follow_up_notes" in r.json()


class TestFollowUps:
    def test_add_and_list_follow_up(self, sa):
        lst = requests.get(f"{API}/superadmin/pipeline", headers=sa, timeout=30).json()["items"]
        cid = lst[0]["clinic_id"]
        r = requests.post(
            f"{API}/superadmin/clinics/{cid}/follow-ups",
            headers=sa,
            json={"type": "internal", "content": "QA follow-up note", "next_follow_up_date": "2026-06-15"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["type"] == "internal"
        rows = requests.get(f"{API}/superadmin/clinics/{cid}/follow-ups", headers=sa, timeout=20).json()
        assert any(n.get("content") == "QA follow-up note" for n in rows)


class TestMessageTemplates:
    def test_create_list_render_template(self, sa):
        r = requests.post(
            f"{API}/superadmin/message-templates",
            headers=sa,
            json={
                "name": f"QA tpl {uuid.uuid4().hex[:6]}",
                "channel": "whatsapp",
                "body": "Hi {{owner_name}}, trial for {{clinic_name}} ends {{trial_end_date}}.",
            },
            timeout=20,
        )
        assert r.status_code == 200
        tid = r.json()["id"]
        lst = requests.get(f"{API}/superadmin/message-templates", headers=sa, timeout=20).json()
        assert any(t["id"] == tid for t in lst["items"])
        cid = requests.get(f"{API}/superadmin/pipeline", headers=sa, timeout=30).json()["items"][0]["clinic_id"]
        rendered = requests.post(
            f"{API}/superadmin/message-templates/{tid}/render",
            headers=sa,
            json={"clinic_id": cid},
            timeout=20,
        )
        assert rendered.status_code == 200
        assert rendered.json().get("copy_only") is True
        assert "body" in rendered.json()


class TestCommercialDashboard:
    def test_commercial_dashboard(self, sa):
        r = requests.get(f"{API}/superadmin/commercial/dashboard", headers=sa, timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert "kpis" in data
        assert "funnel" in data
        for k in ("new_trials_7d", "active_trials", "paid_clinics", "estimated_mrr_idr"):
            assert k in data["kpis"]
        for k in ("signup", "setup_complete", "first_booking", "payment_submitted", "paid"):
            assert k in data["funnel"]


class TestTrialHealthScore:
    def test_health_on_pipeline(self, sa):
        r = requests.get(f"{API}/superadmin/pipeline", headers=sa, timeout=30).json()["items"]
        assert r
        for row in r[:5]:
            assert 0 <= row["health_score"] <= 100
            assert row["health_label"] in ("Cold", "Needs help", "Active", "Ready to convert")


class TestPlanChangeRequests:
    def test_clinic_cannot_access_sa_pipeline(self, trial_owner):
        r = requests.get(f"{API}/superadmin/pipeline", headers=trial_owner, timeout=20)
        assert r.status_code == 403

    def test_plan_change_request_flow(self, sa):
        u = uuid.uuid4().hex[:8]
        reg = requests.post(
            f"{API}/auth/register-clinic",
            json={
                "clinic_name": f"Plan QA {u}",
                "owner_name": "Plan QA",
                "email": f"planchange_{u}@example.com",
                "password": "password123",
            },
            timeout=30,
        )
        assert reg.status_code == 200, reg.text
        owner_hdr = hdr(reg.json()["token"])
        r = requests.post(
            f"{API}/billing/plan-change-request",
            headers=owner_hdr,
            json={"requested_plan": "starter", "billing_cycle": "monthly", "note": "QA downgrade test"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        req = r.json()
        rid = req["id"]
        approve = requests.post(f"{API}/superadmin/plan-change-requests/{rid}/approve", headers=sa, json={}, timeout=20)
        assert approve.status_code == 200
        apply = requests.post(f"{API}/superadmin/plan-change-requests/{rid}/apply", headers=sa, timeout=20)
        assert apply.status_code == 200
        assert apply.json()["status"] == "applied"


class TestChurnReport:
    def test_churn_report(self, sa):
        r = requests.get(f"{API}/superadmin/churn-report", headers=sa, timeout=20)
        assert r.status_code == 200
        assert "items" in r.json()
        assert "by_reason" in r.json()


class TestRegressions:
    def test_commercial_still_works(self, sa):
        r = requests.get(f"{API}/superadmin/pipeline", headers=sa, params={"q": "lumina"}, timeout=30)
        assert r.status_code == 200

    def test_sa_dashboard_still_works(self, sa):
        r = requests.get(f"{API}/superadmin/dashboard", headers=sa, timeout=20)
        assert r.status_code == 200

    def test_clinic_billing_still_works(self, trial_owner):
        r = requests.get(f"{API}/billing/payment-requests", headers=trial_owner, timeout=20)
        assert r.status_code == 200
