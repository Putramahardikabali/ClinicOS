"""Wave 2B: Treatments and packages catalog write permission tests."""
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


def _treatment_payload(name=None):
    return {
        "name": name or f"QA Treat {uuid.uuid4().hex[:6]}",
        "category": "facial",
        "duration_min": 45,
        "price_idr": 250000,
        "active": True,
    }


def _package_payload(token, name=None):
    treatments = requests.get(
        f"{API}/treatments-catalog",
        headers=H(token),
        params={"active_only": True},
        timeout=TIMEOUT,
    )
    assert treatments.status_code == 200, treatments.text
    rows = treatments.json()
    if isinstance(rows, dict):
        rows = rows.get("items") or []
    assert rows, "need at least one treatment for series package"
    treatment_id = rows[0]["id"]
    code = f"PK_{uuid.uuid4().hex[:6]}"
    return {
        "name": name or f"QA Package {code}",
        "package_code": code,
        "package_type": "series_package",
        "series_treatment_id": treatment_id,
        "price_idr": 1500000,
        "sessions_total": 6,
        "duration_min": 60,
    }


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
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


class TestTreatmentsCatalogPermissions:
    def test_manager_with_treatments_manage_can_create_and_update(self, tokens):
        manager = tokens["manager"]
        create = requests.post(
            f"{API}/treatments-catalog",
            headers=H(manager),
            json=_treatment_payload(),
            timeout=TIMEOUT,
        )
        assert create.status_code == 200, create.text
        tid = create.json()["id"]
        update = requests.put(
            f"{API}/treatments-catalog/{tid}",
            headers=H(manager),
            json={"price_idr": 275000},
            timeout=TIMEOUT,
        )
        assert update.status_code == 200, update.text
        requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(manager), timeout=TIMEOUT)

    def test_custom_role_with_treatments_manage_can_create_and_update(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Treatment Manager", ["treatments.manage"])
        try:
            create = requests.post(
                f"{API}/treatments-catalog",
                headers=H(user_token),
                json=_treatment_payload(),
                timeout=TIMEOUT,
            )
            assert create.status_code == 200, create.text
            tid = create.json()["id"]
            update = requests.put(
                f"{API}/treatments-catalog/{tid}",
                headers=H(user_token),
                json={"description": "custom role update"},
                timeout=TIMEOUT,
            )
            assert update.status_code == 200, update.text
            requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(owner), timeout=TIMEOUT)
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_user_without_treatments_manage_cannot_write_treatment_catalog(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.post(
            f"{API}/treatments-catalog",
            headers=H(tokens["doctor"]),
            json=_treatment_payload(),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestPackagesCatalogPermissions:
    def test_manager_with_packages_catalog_manage_can_create_and_update(self, tokens):
        manager = tokens["manager"]
        create = requests.post(
            f"{API}/packages-catalog",
            headers=H(manager),
            json=_package_payload(tokens["owner"]),
            timeout=TIMEOUT,
        )
        assert create.status_code == 200, create.text
        pid = create.json()["id"]
        update = requests.put(
            f"{API}/packages-catalog/{pid}",
            headers=H(manager),
            json={"price_idr": 1600000},
            timeout=TIMEOUT,
        )
        assert update.status_code == 200, update.text
        requests.delete(f"{API}/packages-catalog/{pid}", headers=H(manager), timeout=TIMEOUT)

    def test_custom_role_with_packages_catalog_manage_can_create_and_update(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(
            owner, "Package Catalog Manager", ["packages_catalog.manage"]
        )
        try:
            create = requests.post(
                f"{API}/packages-catalog",
                headers=H(user_token),
                json=_package_payload(user_token),
                timeout=TIMEOUT,
            )
            assert create.status_code == 200, create.text
            pid = create.json()["id"]
            update = requests.put(
                f"{API}/packages-catalog/{pid}",
                headers=H(user_token),
                json={"validity_days": 180},
                timeout=TIMEOUT,
            )
            assert update.status_code == 200, update.text
            requests.delete(f"{API}/packages-catalog/{pid}", headers=H(owner), timeout=TIMEOUT)
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_user_without_packages_catalog_manage_cannot_write_package_catalog(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.post(
            f"{API}/packages-catalog",
            headers=H(tokens["doctor"]),
            json=_package_payload(tokens["owner"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestClinicalRolesBlockedFromCatalogWrites:
    @pytest.mark.parametrize("role_key", ["doctor", "therapist", "nurse"])
    def test_clinical_roles_blocked_from_treatment_and_package_writes(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        r_treat = requests.post(
            f"{API}/treatments-catalog",
            headers=H(token),
            json=_treatment_payload(),
            timeout=TIMEOUT,
        )
        assert r_treat.status_code == 403
        r_pkg = requests.post(
            f"{API}/packages-catalog",
            headers=H(token),
            json=_package_payload(tokens["owner"]),
            timeout=TIMEOUT,
        )
        assert r_pkg.status_code == 403


class TestCatalogImportExportPermissions:
    def test_treatment_import_export_requires_treatments_manage(self, tokens):
        manager = tokens["manager"]
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r_export = requests.get(
            f"{API}/treatments-catalog/export?format=csv",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert r_export.status_code == 200, r_export.text
        r_template = requests.get(
            f"{API}/treatments-catalog/import-template?format=csv",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert r_template.status_code == 200, r_template.text
        r_blocked = requests.get(
            f"{API}/treatments-catalog/export?format=csv",
            headers=H(tokens["doctor"]),
            timeout=TIMEOUT,
        )
        assert r_blocked.status_code == 403

    def test_package_import_export_requires_packages_catalog_manage(self, tokens):
        manager = tokens["manager"]
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r_export = requests.get(
            f"{API}/packages-catalog/export?format=csv",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert r_export.status_code == 200, r_export.text
        r_template = requests.get(
            f"{API}/packages-catalog/import-template?format=csv",
            headers=H(manager),
            timeout=TIMEOUT,
        )
        assert r_template.status_code == 200, r_template.text
        r_blocked = requests.get(
            f"{API}/packages-catalog/export?format=csv",
            headers=H(tokens["doctor"]),
            timeout=TIMEOUT,
        )
        assert r_blocked.status_code == 403
