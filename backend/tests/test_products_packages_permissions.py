"""Wave 1D: Products catalog writes + patient package use permission tests."""
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
FO_EMAIL = os.environ.get("FO_EMAIL", "fo@bodylab.id")
MANAGER_EMAIL = os.environ.get("MANAGER_EMAIL", "manager@bodylab.id")
DOCTOR_EMAIL = os.environ.get("DOCTOR_EMAIL", "doctor@bodylab.id")


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


def _list_packages(token):
    r = requests.get(
        f"{API}/packages-catalog",
        headers=H(token),
        params={"page": 1, "page_size": 100},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("items") if isinstance(data, dict) else data


def _create_patient(token):
    unique = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"full_name": f"Pkg Perm {unique}", "phone": f"081{unique}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _fresh_patient_package(token, pkg_id):
    r = requests.get(f"{API}/patient-packages/{pkg_id}", headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _use_payload_for_pkg(pkg_doc):
    components = pkg_doc.get("components") or []
    if components:
        comp = components[0]
        return {
            "used_sessions_count": 1,
            "patient_package_component_id": comp.get("id"),
            "treatment_id": comp.get("treatment_id"),
            "treatment_name": comp.get("treatment_name_snapshot"),
        }
    return {"used_sessions_count": 1}


def _purchase_package_for_patient(token, patient, catalog_pkg):
    pid = patient["id"]
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d")
    rb = requests.post(
        f"{API}/bookings",
        headers=H(token),
        json={
            "patient_id": pid,
            "patient_name": patient.get("full_name") or "Test",
            "patient_phone": patient.get("phone") or "0812000000",
            "treatment": catalog_pkg.get("name") or "Package",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T11:30:00",
        },
        timeout=TIMEOUT,
    )
    assert rb.status_code == 200, rb.text
    bid = rb.json()["id"]
    vid = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(token), timeout=TIMEOUT).json()["visit"]["id"]
    inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(token), timeout=TIMEOUT).json()
    iid = inv["id"]
    cat_id = catalog_pkg.get("id") or catalog_pkg.get("key")
    add = requests.post(
        f"{API}/invoices/{iid}/items/catalog",
        headers=H(token),
        json={"item_type": "package", "catalog_id": cat_id, "quantity": 1},
        timeout=TIMEOUT,
    )
    assert add.status_code == 200, add.text
    pay = requests.put(
        f"{API}/invoices/{iid}/payment",
        headers=H(token),
        json={"mark_paid": True, "payment_method": "cash"},
        timeout=TIMEOUT,
    )
    assert pay.status_code == 200, pay.text
    pkgs = requests.get(f"{API}/patients/{pid}/patient-packages", headers=H(token), timeout=TIMEOUT).json()
    assert pkgs, "expected patient package after paid invoice"
    pkg = pkgs[-1]
    return pid, pkg["id"], pkg, bid


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
        ("fo", FO_EMAIL),
        ("manager", MANAGER_EMAIL),
        ("doctor", DOCTOR_EMAIL),
    ]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


class TestProductsCatalogPermissions:
    def test_fo_with_products_manage_can_create_and_update(self, tokens):
        fo = tokens["fo"]
        code = f"PRD_{uuid.uuid4().hex[:6]}"
        create = requests.post(
            f"{API}/products-catalog",
            headers=H(fo),
            json={
                "name": "FO Product Perm",
                "product_code": code,
                "category": "INVENTORY",
                "product_type": "Consumable",
            },
            timeout=TIMEOUT,
        )
        assert create.status_code == 200, create.text
        pid = create.json()["id"]
        update = requests.put(
            f"{API}/products-catalog/{pid}",
            headers=H(fo),
            json={"notes": "FO updated"},
            timeout=TIMEOUT,
        )
        assert update.status_code == 200, update.text
        requests.delete(f"{API}/products-catalog/{pid}", headers=H(fo), timeout=TIMEOUT)

    def test_custom_role_with_products_manage_can_create_and_update(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(
            owner, "Product Manager", ["products.manage", "dashboard.view"]
        )
        code = f"PRD_{uuid.uuid4().hex[:6]}"
        try:
            create = requests.post(
                f"{API}/products-catalog",
                headers=H(user_token),
                json={
                    "name": "Custom Product",
                    "product_code": code,
                    "category": "INVENTORY",
                    "product_type": "Retail",
                },
                timeout=TIMEOUT,
            )
            assert create.status_code == 200, create.text
            pid = create.json()["id"]
            update = requests.put(
                f"{API}/products-catalog/{pid}",
                headers=H(user_token),
                json={"notes": "custom role update"},
                timeout=TIMEOUT,
            )
            assert update.status_code == 200, update.text
            requests.delete(f"{API}/products-catalog/{pid}", headers=H(owner), timeout=TIMEOUT)
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_user_without_products_manage_cannot_write_products(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.post(
            f"{API}/products-catalog",
            headers=H(tokens["doctor"]),
            json={"name": "Blocked", "product_code": f"X{uuid.uuid4().hex[:4]}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestPatientPackageUsePermissions:
    def test_fo_with_packages_use_can_use_patient_package(self, tokens):
        fo = tokens["fo"]
        packages = _list_packages(fo)
        series = next(
            (p for p in packages if int(p.get("sessions_total") or 0) >= 2 and p.get("package_type") != "bundle_package"),
            None,
        )
        if not series:
            pytest.skip("no series package in catalog")
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series)
        pkg_doc = _fresh_patient_package(fo, pkg_id)
        before = int(pkg_doc.get("remaining_sessions") or 0)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/use",
                headers=H(fo),
                json={**_use_payload_for_pkg(pkg_doc), "notes": "perm test"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            assert int(r.json()["package"]["remaining_sessions"]) == before - 1
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_manager_with_packages_use_can_use_patient_package(self, tokens):
        manager = tokens["manager"]
        fo = tokens["fo"]
        packages = _list_packages(fo)
        series = next(
            (p for p in packages if int(p.get("sessions_total") or 0) >= 2 and p.get("package_type") != "bundle_package"),
            None,
        )
        if not series:
            pytest.skip("no series package in catalog")
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series)
        pkg_doc = _fresh_patient_package(fo, pkg_id)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/use",
                headers=H(manager),
                json=_use_payload_for_pkg(pkg_doc),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_user_without_packages_use_cannot_use_patient_package(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        packages = _list_packages(fo)
        series = next((p for p in packages if int(p.get("sessions_total") or 0) >= 2), None)
        if not series:
            pytest.skip("no series package in catalog")
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/use",
                headers=H(tokens["doctor"]),
                json={"used_sessions_count": 1},
                timeout=TIMEOUT,
            )
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_package_usage_deducts_session_balance(self, tokens):
        fo = tokens["fo"]
        packages = _list_packages(fo)
        series = next(
            (p for p in packages if int(p.get("sessions_total") or 0) >= 3 and p.get("package_type") != "bundle_package"),
            None,
        )
        if not series:
            pytest.skip("no series package in catalog")
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series)
        pkg_doc = _fresh_patient_package(fo, pkg_id)
        before = int(pkg_doc.get("remaining_sessions") or 0)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/use",
                headers=H(fo),
                json=_use_payload_for_pkg(pkg_doc),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            after = int(r.json()["package"]["remaining_sessions"])
            assert after == before - 1
            assert int(r.json()["package"]["used_sessions"]) == int(pkg_doc.get("used_sessions") or 0) + 1
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_bundle_component_usage_deducts_component_balance(self, tokens):
        fo = tokens["fo"]
        packages = _list_packages(fo)
        bundle = next(
            (p for p in packages if p.get("package_type") == "bundle_package" and (p.get("components") or [])),
            None,
        )
        if not bundle:
            pytest.skip("no bundle package in catalog")
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, bundle)
        pkg_doc = _fresh_patient_package(fo, pkg_id)
        components = pkg_doc.get("components") or []
        if not components:
            pytest.skip("purchased bundle has no components")
        comp = components[0]
        before = int(comp.get("remaining_quantity") or 0)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/use",
                headers=H(fo),
                json={
                    "treatment_id": comp.get("treatment_id"),
                    "treatment_name": comp.get("treatment_name_snapshot"),
                    "patient_package_component_id": comp.get("id"),
                    "used_sessions_count": 1,
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            updated = r.json()["package"]
            after_comp = next(c for c in updated.get("components") or [] if c.get("id") == comp.get("id"))
            assert int(after_comp.get("remaining_quantity") or 0) == before - 1
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)
