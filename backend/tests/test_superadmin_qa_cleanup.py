"""Super Admin bulk QA test clinic cleanup."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

PLATFORM_EMAIL = os.environ.get("PLATFORM_EMAIL", "platform@clinicos.id")
PLATFORM_PASSWORD = os.environ.get("CLINIC_PASSWORD", "ClinicOS@2026")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")
OWNER_PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
TIMEOUT = 25


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def platform_token():
    try:
        return login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    except AssertionError:
        pytest.skip("platform admin not available")


@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError:
        pytest.skip("owner not available")


def _create_test_clinic(platform_token):
    suffix = uuid.uuid4().hex[:8]
    email = f"qa-owner-{suffix}@example.com"
    r = requests.post(
        f"{API}/superadmin/clinics",
        headers=hdr(platform_token),
        json={
            "clinic_name": f"QA Bulk {suffix}",
            "slug": f"qa-bulk-{suffix}",
            "owner_name": "QA Owner",
            "owner_email": email,
            "password": "password123",
            "plan": "trial",
            "trial_days": 7,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    clinic = r.json()
    cid = clinic["id"]
    flag = requests.put(
        f"{API}/superadmin/clinics/{cid}/test-flag",
        headers=hdr(platform_token),
        json={"is_test_clinic": True, "reason": "QA bulk cleanup test"},
        timeout=TIMEOUT,
    )
    assert flag.status_code == 200, flag.text
    return cid, clinic.get("slug") or clinic["slug"]


class TestBulkDeleteTestClinics:
    def test_owner_cannot_bulk_delete(self, owner_token, platform_token):
        cid, _ = _create_test_clinic(platform_token)
        r = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(owner_token),
            json={"clinic_ids": [cid], "dry_run": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_blocks_non_test_clinic(self, platform_token):
        rows = requests.get(f"{API}/superadmin/clinics", headers=hdr(platform_token), timeout=TIMEOUT).json()
        prod = next((c for c in rows if not c.get("is_test_clinic")), None)
        if not prod:
            pytest.skip("no production clinic to test block")
        r = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(platform_token),
            json={"clinic_ids": [prod["id"]], "dry_run": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403
        detail = r.json().get("detail")
        if isinstance(detail, dict):
            assert detail.get("blocked_clinics")

    def test_dry_run_preview_shape(self, platform_token):
        cid, slug = _create_test_clinic(platform_token)
        r = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(platform_token),
            json={"clinic_ids": [cid], "dry_run": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("dry_run") is True
        assert body.get("selected_count") == 1
        assert len(body.get("clinics") or []) == 1
        row = body["clinics"][0]
        assert row["slug"] == slug
        assert row.get("is_test_clinic") is True
        for key in ("users_count", "patients_count", "bookings_count", "visits_count", "invoices_count", "files_count"):
            assert key in row
        assert "users_count" in (body.get("totals") or {})

    def test_delete_requires_confirmation_and_reason(self, platform_token):
        cid, _ = _create_test_clinic(platform_token)
        r = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(platform_token),
            json={"clinic_ids": [cid], "dry_run": False, "reason": "QA test"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400
        r2 = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(platform_token),
            json={
                "clinic_ids": [cid],
                "dry_run": False,
                "reason": "",
                "confirmation_text": "DELETE QA CLINICS",
            },
            timeout=TIMEOUT,
        )
        assert r2.status_code == 400

    def test_bulk_delete_test_clinic_success(self, platform_token):
        cid, slug = _create_test_clinic(platform_token)
        r = requests.post(
            f"{API}/superadmin/clinics/bulk-delete-test",
            headers=hdr(platform_token),
            json={
                "clinic_ids": [cid],
                "dry_run": False,
                "reason": "QA bulk cleanup integration test",
                "confirmation_text": "DELETE QA CLINICS",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("dry_run") is False
        assert body.get("deleted_count") == 1
        assert requests.get(f"{API}/superadmin/clinics", headers=hdr(platform_token), timeout=TIMEOUT).json()
        gone = requests.get(f"{API}/superadmin/clinics/{cid}", headers=hdr(platform_token), timeout=TIMEOUT)
        assert gone.status_code == 404

    def test_list_test_only_filter(self, platform_token):
        r = requests.get(
            f"{API}/superadmin/clinics",
            headers=hdr(platform_token),
            params={"test_only": True, "list_filter": "all"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        for row in r.json():
            assert row.get("is_test_clinic") is True
