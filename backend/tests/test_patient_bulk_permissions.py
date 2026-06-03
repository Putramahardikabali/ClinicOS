"""Wave 1B: Patient import/export/delete gated by patients.* permissions."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CLINIC_PASSWORD", "password123")
TIMEOUT = 25

OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin@bodylab.id")
FO_EMAIL = os.environ.get("FO_EMAIL", "fo@bodylab.id")
MANAGER_EMAIL = os.environ.get("MANAGER_EMAIL", "manager@bodylab.id")
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


def create_patient(token, unique=None):
    unique = unique or uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"full_name": f"QA Bulk {unique}", "phone": f"081{unique}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"], unique


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
        ("fo", FO_EMAIL),
        ("manager", MANAGER_EMAIL),
        ("doctor", DOCTOR_EMAIL),
        ("therapist", THERAPIST_EMAIL),
        ("nurse", NURSE_EMAIL),
    ]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


class TestPatientExportPermissions:
    def test_user_with_patients_export_can_export(self, tokens):
        r = requests.get(f"{API}/patients/export?format=csv", headers=H(tokens["fo"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "FirstName" in r.text

    def test_user_without_patients_export_cannot_export(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(f"{API}/patients/export?format=csv", headers=H(tokens["doctor"]), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_clinical_roles_cannot_export_by_default(self, tokens):
        for role in ("doctor", "therapist", "nurse"):
            token = tokens.get(role)
            if not token:
                pytest.skip(f"{role} seed not available")
            r = requests.get(f"{API}/patients/export?format=csv", headers=H(token), timeout=TIMEOUT)
            assert r.status_code == 403, role

    def test_custom_role_with_patients_export_works(self, tokens):
        owner = tokens["owner"]
        export_token, role_id, user_id = create_custom_role(
            owner, "Patient Exporter", ["patients.view", "patients.export"]
        )
        try:
            r = requests.get(f"{API}/patients/export?format=csv", headers=H(export_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            assert "FirstName" in r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_without_patients_export_blocked(self, tokens):
        owner = tokens["owner"]
        viewer_token, role_id, user_id = create_custom_role(
            owner, "Patient Viewer Only", ["patients.view"]
        )
        try:
            r = requests.get(f"{API}/patients/export?format=csv", headers=H(viewer_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestPatientImportPermissions:
    def test_user_with_patients_create_can_access_import_template(self, tokens):
        r = requests.get(
            f"{API}/patients/import-template?format=csv",
            headers=H(tokens["fo"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert "FirstName" in r.text

    def test_user_with_patients_create_can_import(self, tokens):
        code = f"BL{uuid.uuid4().hex[:5].upper()}"
        csv_body = (
            "FirstName,LastName,Phone No,UserCode,membershipname,lastvisit,guestIconInformation\n"
            f"Perm,Import,{code[-10:]},{code},,,,\n"
        )
        r = requests.post(
            f"{API}/patients/import",
            headers=H(tokens["fo"]),
            files={"file": ("patients.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("created", 0) >= 1 or r.json().get("updated", 0) >= 1

    def test_user_without_patients_create_cannot_import(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.post(
            f"{API}/patients/import",
            headers=H(tokens["doctor"]),
            files={"file": ("x.csv", b"FirstName,LastName\nA,B\n", "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestPatientDeletePermissions:
    def test_user_with_patients_delete_can_delete_patient(self, tokens):
        owner = tokens["owner"]
        pid, _ = create_patient(owner)
        r = requests.delete(f"{API}/patients/{pid}", headers=H(owner), timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_user_without_patients_delete_cannot_delete(self, tokens):
        r = requests.delete(
            f"{API}/patients/{uuid.uuid4()}",
            headers=H(tokens["fo"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403
