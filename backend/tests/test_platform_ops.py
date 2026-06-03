"""QA tests for Super Admin Platform Ops (Phase 3)."""
from __future__ import annotations

import io
import os
import zipfile
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

PLATFORM_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "platform@clinicos.id")
PLATFORM_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "ChangeMe123!")
OWNER_EMAIL = "owner@cantikbeauty.id"
OWNER_PASSWORD = "password123"

SENSITIVE_MARKERS = ("password", "password_hash", "Bearer ", "secret", "token=")
CLINICAL_EXPORT_SKIP = ("password_hash", "invite_token", "clinical_notes", "note_body", "notes")


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        # Fallback password used in remote E2E seed
        if email == PLATFORM_EMAIL and password != "ClinicOS@2026":
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def sa_token():
    tok = _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    me = requests.get(f"{API}/auth/me", headers=hdr(tok), timeout=15).json()
    assert me.get("platform_admin") is True
    return tok


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def sa_headers(sa_token):
    return hdr(sa_token)


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return hdr(owner_token)


@pytest.fixture(scope="module")
def sample_clinic(sa_headers):
    r = requests.get(f"{API}/superadmin/clinics?q=cantik", headers=sa_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert rows, "Need at least one clinic for QA"
    return rows[0]


# ---------- Unit: sanitization & activity labels ----------
class TestPlatformOpsUnit:
    def test_sanitize_redacts_sensitive(self):
        from platform_reliability import _sanitize_text

        assert "[redacted" in _sanitize_text("password=abc123")
        assert "[redacted" in _sanitize_text("clinical note content here")
        assert _sanitize_text("normal error") == "normal error"

    def test_activity_label_rules(self):
        from datetime import timedelta
        from platform_reliability import _activity_label
        from saas import now_utc

        now = now_utc()
        assert _activity_label(now, "active") == "Active"
        assert _activity_label(now - timedelta(days=14), "active") == "Quiet"
        assert _activity_label(now - timedelta(days=45), "active") == "At risk"
        assert _activity_label(now - timedelta(days=120), "active") == "Inactive"
        assert _activity_label(None, "active") == "At risk"
        assert _activity_label(now, "archived") == "Inactive"
        assert _activity_label(now, "suspended") == "Inactive"

    def test_export_row_strips_sensitive_fields(self):
        from platform_reliability import _export_row

        row = _export_row({
            "id": "1", "name": "Pat", "password_hash": "x", "notes": "secret note", "clinical_notes": "dx",
        })
        assert "password_hash" not in row
        assert "notes" not in row
        assert "clinical_notes" not in row
        assert row["name"] == "Pat"


# ---------- Access control ----------
class TestPlatformOpsAccess:
    def test_ops_health_requires_platform_admin(self, owner_headers):
        r = requests.get(f"{API}/superadmin/ops/health", headers=owner_headers, timeout=15)
        assert r.status_code == 403

    def test_ops_health_unauthenticated(self):
        r = requests.get(f"{API}/superadmin/ops/health", timeout=15)
        assert r.status_code in (401, 403)

    @pytest.mark.parametrize("path", [
        "/superadmin/ops/errors",
        "/superadmin/ops/backups",
        "/superadmin/ops/support",
        "/superadmin/ops/activity",
        "/superadmin/ops/analytics",
        "/superadmin/ops/security",
    ])
    def test_ops_endpoints_block_owner(self, owner_headers, path):
        r = requests.get(f"{API}{path}", headers=owner_headers, timeout=15)
        assert r.status_code == 403


# ---------- Health ----------
class TestPlatformOpsHealth:
    def test_health_shape(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/health", headers=sa_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for key in (
            "checked_at", "backend", "database", "storage", "queue_jobs", "backups",
            "failed_uploads_24h", "failed_sends_24h", "failed_logins_24h",
            "open_errors", "recent_errors",
        ):
            assert key in d, f"missing {key}"
        assert "status" in d["backend"]
        assert "status" in d["database"]
        assert "status" in d["storage"]
        assert "pending_payments" in d["queue_jobs"]
        assert "last_database" in d["backups"]
        assert isinstance(d["recent_errors"], list)

    def test_health_no_sensitive_in_recent_errors(self, sa_headers):
        d = requests.get(f"{API}/superadmin/ops/health", headers=sa_headers, timeout=30).json()
        blob = str(d.get("recent_errors", [])).lower()
        for marker in SENSITIVE_MARKERS:
            assert marker not in blob or "[redacted" in blob


# ---------- Error logs ----------
class TestPlatformOpsErrors:
    def test_errors_list(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/errors", headers=sa_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_error_status_resolved_ignored(self, sa_headers):
        # Seed an open error via failed backup record (always available without auth hook timing)
        requests.post(
            f"{API}/superadmin/ops/backups/record",
            json={"backup_type": "database", "status": "failed", "message": "QA error seed"},
            headers=sa_headers,
            timeout=15,
        )
        rows = requests.get(f"{API}/superadmin/ops/errors?status=open", headers=sa_headers, timeout=15).json()
        assert rows, "Expected open error after failed backup record"
        eid = rows[0]["id"]

        r = requests.put(f"{API}/superadmin/ops/errors/{eid}/status", json={"status": "resolved"}, headers=sa_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"

        r2 = requests.put(f"{API}/superadmin/ops/errors/{eid}/status", json={"status": "ignored"}, headers=sa_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["status"] == "ignored"


# ---------- Backups ----------
class TestPlatformOpsBackups:
    def test_backups_load(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/backups", headers=sa_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "status" in d and "history" in d and "recent_failures" in d

    def test_record_manual_backup(self, sa_headers):
        r = requests.post(
            f"{API}/superadmin/ops/backups/record",
            json={"backup_type": "database", "status": "success", "message": "QA manual backup"},
            headers=sa_headers,
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["backup_type"] == "database"
        assert body["status"] == "success"

        status = requests.get(f"{API}/superadmin/ops/backups", headers=sa_headers, timeout=15).json()
        assert status["status"].get("last_db_status") == "success"


# ---------- Support ----------
class TestPlatformOpsSupport:
    @pytest.fixture(scope="class")
    def support_id(self, sa_headers, sample_clinic):
        r = requests.post(
            f"{API}/superadmin/ops/support",
            json={
                "clinic_id": sample_clinic["id"],
                "subject": "QA support ticket",
                "priority": "high",
                "internal_note": "Created by QA",
            },
            headers=sa_headers,
            timeout=15,
        )
        assert r.status_code == 200
        return r.json()["id"]

    def test_support_list(self, sa_headers, support_id):
        r = requests.get(f"{API}/superadmin/ops/support", headers=sa_headers, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert support_id in ids

    def test_support_update_and_filter(self, sa_headers, support_id, sample_clinic):
        r = requests.put(
            f"{API}/superadmin/ops/support/{support_id}",
            json={"status": "in_progress", "assigned_to": "qa@clinicos.id", "internal_note": "Investigating"},
            headers=sa_headers,
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "in_progress"
        assert body["assigned_to"] == "qa@clinicos.id"
        assert len(body.get("internal_notes") or []) >= 2

        filtered = requests.get(
            f"{API}/superadmin/ops/support",
            params={"clinic_id": sample_clinic["id"], "status": "in_progress"},
            headers=sa_headers,
            timeout=15,
        ).json()
        assert any(x["id"] == support_id for x in filtered)


# ---------- Activity ----------
class TestPlatformOpsActivity:
    def test_activity_labels(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/activity", headers=sa_headers, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d and "clinics" in d
        assert isinstance(d["clinics"], list)
        allowed = {"Active", "Quiet", "At risk", "Inactive"}
        for row in d["clinics"]:
            assert row["activity_label"] in allowed
            for field in ("last_login", "last_booking", "last_visit", "last_invoice", "active_users_7d"):
                assert field in row

    def test_activity_filter(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/activity", params={"list_filter": "Active"}, headers=sa_headers, timeout=60)
        assert r.status_code == 200
        for row in r.json().get("clinics") or []:
            assert row["activity_label"] == "Active"


# ---------- Analytics ----------
class TestPlatformOpsAnalytics:
    def test_analytics_shape(self, sa_headers):
        r = requests.get(f"{API}/superadmin/ops/analytics", headers=sa_headers, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "alert_clinics" in d and "clinics" in d
        if d["clinics"]:
            row = d["clinics"][0]
            usage = row["usage"]
            for metric in ("staff_count", "storage_used_gb", "patient_count", "visit_count", "invoice_count", "file_count"):
                assert metric in usage
            assert "limits" in row
            assert "alerts" in row
            for al in row.get("alerts") or []:
                assert al["level"] in ("warning", "critical")
                assert al["metric"] in ("staff", "storage")


# ---------- Security ----------
class TestPlatformOpsSecurity:
    def test_security_shape_no_secrets(self, sa_headers):
        # Trigger a failed login for data
        requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "definitely-wrong-password"}, timeout=15)
        r = requests.get(f"{API}/superadmin/ops/security", headers=sa_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "failed_logins" in d and "recent_logins" in d
        blob = str(d).lower()
        assert "definitely-wrong-password" not in blob
        assert OWNER_PASSWORD not in str(d)
        for fl in d.get("failed_logins") or []:
            assert "password" not in fl.get("message", "").lower() or "failed login" in fl.get("message", "").lower()


# ---------- Export ----------
class TestPlatformOpsExport:
    def test_export_requires_slug_and_reason(self, sa_headers, sample_clinic):
        cid = sample_clinic["id"]
        r = requests.post(
            f"{API}/superadmin/clinics/{cid}/export",
            json={"confirm_slug": "wrong-slug", "reason": "QA test"},
            headers=sa_headers,
            timeout=15,
        )
        assert r.status_code == 400

        r2 = requests.post(
            f"{API}/superadmin/clinics/{cid}/export",
            json={"confirm_slug": sample_clinic["slug"], "reason": ""},
            headers=sa_headers,
            timeout=15,
        )
        assert r2.status_code == 400

    def test_export_zip(self, sa_headers, sample_clinic):
        cid = sample_clinic["id"]
        slug = sample_clinic["slug"]
        r = requests.post(
            f"{API}/superadmin/clinics/{cid}/export",
            params={"format": "zip"},
            json={"confirm_slug": slug, "reason": "QA zip export test"},
            headers=sa_headers,
            timeout=60,
        )
        assert r.status_code == 200
        assert "zip" in (r.headers.get("content-type") or "").lower() or r.content[:2] == b"PK"
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert any(n.endswith(".csv") for n in names)
        for name in names:
            data = zf.read(name).decode("utf-8-sig", errors="replace").lower()
            assert "password_hash" not in data
            if "users" in name:
                assert "invite_token" not in data

    def test_export_xlsx(self, sa_headers, sample_clinic):
        cid = sample_clinic["id"]
        slug = sample_clinic["slug"]
        r = requests.post(
            f"{API}/superadmin/clinics/{cid}/export",
            params={"format": "xlsx"},
            json={"confirm_slug": slug, "reason": "QA xlsx export test"},
            headers=sa_headers,
            timeout=60,
        )
        assert r.status_code == 200
        assert r.content[:2] == b"PK"
        ct = r.headers.get("content-type") or ""
        assert "spreadsheet" in ct or "octet" in ct or r.content[:2] == b"PK"


# ---------- Audit logs ----------
class TestPlatformOpsAudit:
    def test_audit_entries_for_ops_actions(self, sa_headers, sample_clinic):
        requests.post(
            f"{API}/superadmin/ops/backups/record",
            json={"backup_type": "files", "status": "success", "message": "QA audit test"},
            headers=sa_headers,
            timeout=15,
        )
        slug = sample_clinic["slug"]
        requests.post(
            f"{API}/superadmin/clinics/{sample_clinic['id']}/export",
            params={"format": "zip"},
            json={"confirm_slug": slug, "reason": "QA audit export check"},
            headers=sa_headers,
            timeout=60,
        )
        logs = requests.get(
            f"{API}/superadmin/audit-log",
            params={"limit": 50},
            headers=sa_headers,
            timeout=15,
        ).json()
        actions = [l.get("action") for l in logs]
        assert "backup_recorded" in actions or "clinic_support_data_exported" in actions
        blob = str(logs).lower()
        assert "password" not in blob or "password_hash" not in blob


# ---------- Clinic app unaffected ----------
class TestClinicAppRegression:
    def test_owner_clinics_me(self, owner_headers):
        r = requests.get(f"{API}/clinics/me", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("name")
        assert "subscription" in d

    def test_owner_patients_list(self, owner_headers):
        r = requests.get(f"{API}/patients", headers=owner_headers, timeout=15)
        assert r.status_code == 200

    def test_owner_cannot_access_ops(self, owner_headers):
        assert requests.get(f"{API}/superadmin/ops/health", headers=owner_headers, timeout=15).status_code == 403
