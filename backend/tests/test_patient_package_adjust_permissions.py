"""Wave 2C: Patient package adjust, reverse, and cancel permission tests."""
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


def _list_catalog_packages(token):
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
        json={"full_name": f"Pkg Adj {unique}", "phone": f"081{unique}"},
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


def _use_package(token, pkg_id, pkg_doc):
    r = requests.post(
        f"{API}/patient-packages/{pkg_id}/use",
        headers=H(token),
        json={**_use_payload_for_pkg(pkg_doc), "notes": "perm test use"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


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


@pytest.fixture(scope="module")
def series_catalog_pkg(tokens):
    fo = tokens["fo"]
    packages = _list_catalog_packages(fo)
    series = next(
        (
            p
            for p in packages
            if int(p.get("sessions_total") or 0) >= 3 and p.get("package_type") != "bundle_package"
        ),
        None,
    )
    if not series:
        pytest.skip("no series package in catalog")
    return series


@pytest.fixture(scope="module")
def bundle_catalog_pkg(tokens):
    fo = tokens["fo"]
    packages = _list_catalog_packages(fo)
    bundle = next(
        (p for p in packages if p.get("package_type") == "bundle_package" and (p.get("components") or [])),
        None,
    )
    if not bundle:
        pytest.skip("no bundle package in catalog")
    return bundle


class TestPackageUsageReversePermissions:
    def test_manager_with_packages_adjust_can_reverse_usage(self, tokens, series_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, pkg_doc, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        before = int(_fresh_patient_package(fo, pkg_id).get("remaining_sessions") or 0)
        used = _use_package(fo, pkg_id, pkg_doc)
        usage_id = used["usage"]["id"]
        after_use = int(used["package"]["remaining_sessions"])
        assert after_use == before - 1
        try:
            r = requests.post(f"{API}/package-usage/{usage_id}/reverse", headers=H(manager), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            restored = int(r.json().get("remaining_sessions") or 0)
            assert restored == before
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_user_without_packages_adjust_cannot_reverse_usage(self, tokens, series_catalog_pkg):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        doctor = tokens["doctor"]
        patient = _create_patient(fo)
        _, pkg_id, pkg_doc, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        used = _use_package(fo, pkg_id, pkg_doc)
        usage_id = used["usage"]["id"]
        try:
            r = requests.post(f"{API}/package-usage/{usage_id}/reverse", headers=H(doctor), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestPatientPackageAdjustPermissions:
    def test_manager_with_packages_adjust_can_update_balance_and_expiry(self, tokens, series_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        new_expiry = (datetime.now(timezone.utc) + timedelta(days=400)).strftime("%Y-%m-%d")
        try:
            r = requests.put(
                f"{API}/patient-packages/{pkg_id}",
                headers=H(manager),
                json={"total_sessions": 8, "expiry_date": new_expiry, "notes": "manager adjust"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["total_sessions"] == 8
            assert body["expiry_date"] == new_expiry
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_user_without_packages_adjust_cannot_update_patient_package(self, tokens, series_catalog_pkg):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        try:
            r = requests.put(
                f"{API}/patient-packages/{pkg_id}",
                headers=H(tokens["doctor"]),
                json={"notes": "blocked"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_custom_role_with_packages_adjust_can_adjust_package(self, tokens, series_catalog_pkg):
        owner = tokens["owner"]
        fo = tokens["fo"]
        user_token, role_id, user_id = create_custom_role(owner, "Package Adjuster", ["packages.adjust"])
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        try:
            r = requests.put(
                f"{API}/patient-packages/{pkg_id}",
                headers=H(user_token),
                json={"notes": "custom adjust"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            assert r.json().get("notes") == "custom adjust"
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)


class TestPatientPackageCancelPermissions:
    def test_manager_with_packages_adjust_can_cancel_patient_package(self, tokens, series_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        try:
            r = requests.post(f"{API}/patient-packages/{pkg_id}/cancel", headers=H(manager), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            assert r.json().get("status") == "cancelled"
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_user_without_packages_adjust_cannot_cancel_patient_package(self, tokens, series_catalog_pkg):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        patient = _create_patient(fo)
        _, pkg_id, _, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        try:
            r = requests.post(
                f"{API}/patient-packages/{pkg_id}/cancel",
                headers=H(tokens["doctor"]),
                timeout=TIMEOUT,
            )
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestFoPackageUseWithoutAdjust:
    def test_fo_can_use_but_cannot_reverse_adjust_or_cancel(self, tokens, series_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, pkg_doc, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        used = _use_package(fo, pkg_id, pkg_doc)
        usage_id = used["usage"]["id"]
        try:
            assert used["package"]["remaining_sessions"] == int(pkg_doc.get("remaining_sessions") or 0) - 1
            assert requests.post(
                f"{API}/package-usage/{usage_id}/reverse", headers=H(fo), timeout=TIMEOUT
            ).status_code == 403
            assert requests.put(
                f"{API}/patient-packages/{pkg_id}",
                headers=H(fo),
                json={"notes": "fo blocked"},
                timeout=TIMEOUT,
            ).status_code == 403
            _, pkg_id2, _, bid2 = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
            try:
                assert requests.post(
                    f"{API}/patient-packages/{pkg_id2}/cancel", headers=H(fo), timeout=TIMEOUT
                ).status_code == 403
            finally:
                requests.post(f"{API}/patient-packages/{pkg_id2}/cancel", headers=H(manager), timeout=TIMEOUT)
                requests.delete(f"{API}/bookings/{bid2}", headers=H(fo), timeout=TIMEOUT)
        finally:
            requests.post(f"{API}/package-usage/{usage_id}/reverse", headers=H(manager), timeout=TIMEOUT)
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestPackageUsageReverseBalance:
    def test_reversing_usage_restores_session_balance(self, tokens, series_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, pkg_doc, bid = _purchase_package_for_patient(fo, patient, series_catalog_pkg)
        before = int(_fresh_patient_package(fo, pkg_id).get("remaining_sessions") or 0)
        used = _use_package(fo, pkg_id, pkg_doc)
        usage_id = used["usage"]["id"]
        assert int(used["package"]["remaining_sessions"]) == before - 1
        try:
            r = requests.post(f"{API}/package-usage/{usage_id}/reverse", headers=H(manager), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            assert int(r.json().get("remaining_sessions") or 0) == before
            assert int(r.json().get("used_sessions") or 0) == int(pkg_doc.get("used_sessions") or 0)
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_reversing_bundle_component_usage_restores_component_balance(self, tokens, bundle_catalog_pkg):
        fo = tokens["fo"]
        manager = tokens["manager"]
        patient = _create_patient(fo)
        _, pkg_id, pkg_doc, bid = _purchase_package_for_patient(fo, patient, bundle_catalog_pkg)
        pkg_doc = _fresh_patient_package(fo, pkg_id)
        components = pkg_doc.get("components") or []
        if not components:
            pytest.skip("purchased bundle has no components")
        comp = components[0]
        before = int(comp.get("remaining_quantity") or 0)
        used = _use_package(fo, pkg_id, pkg_doc)
        usage_id = used["usage"]["id"]
        after_comp = next(c for c in used["package"].get("components") or [] if c.get("id") == comp.get("id"))
        assert int(after_comp.get("remaining_quantity") or 0) == before - 1
        try:
            r = requests.post(f"{API}/package-usage/{usage_id}/reverse", headers=H(manager), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            restored_comp = next(
                c for c in r.json().get("components") or [] if c.get("id") == comp.get("id")
            )
            assert int(restored_comp.get("remaining_quantity") or 0) == before
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestPatientPackageReportSummaryPermissions:
    _SUMMARY = f"{API}/patient-packages/reports/summary"

    def test_manager_with_reports_view_can_access_summary(self, tokens):
        r = requests.get(self._SUMMARY, headers=H(tokens["manager"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "active_count" in r.json()

    def test_fo_with_packages_report_can_access_summary(self, tokens):
        r = requests.get(self._SUMMARY, headers=H(tokens["fo"]), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert "remaining_sessions_total" in r.json()

    def test_doctor_with_packages_view_cannot_access_summary(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        r = requests.get(self._SUMMARY, headers=H(tokens["doctor"]), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_custom_role_with_packages_report_can_access_summary(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Package Reporter", ["packages.report"])
        try:
            r = requests.get(self._SUMMARY, headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_only_packages_view_cannot_access_summary(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Package Viewer", ["packages.view"])
        try:
            r = requests.get(self._SUMMARY, headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)
