"""Wave 3C: Patient package view permission tests."""
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


def _user_id(token):
    me = requests.get(f"{API}/auth/me", headers=H(token), timeout=TIMEOUT)
    assert me.status_code == 200, me.text
    return me.json()["id"]


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


def _create_patient(token):
    unique = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"full_name": f"Pkg View {unique}", "phone": f"081{unique}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _ensure_clinical_role_permissions(owner_token, role_key):
    roles = requests.get(f"{API}/staff/roles", headers=H(owner_token), timeout=TIMEOUT).json()
    role = next((r for r in roles if r.get("role_key") == role_key), None)
    if not role:
        return
    from permissions import SYSTEM_ROLE_DEFINITIONS

    spec = next(s for s in SYSTEM_ROLE_DEFINITIONS if s["role_key"] == role_key)
    current = set(role.get("permissions") or [])
    expected = set(spec["permissions"])
    if current == expected:
        return
    requests.put(
        f"{API}/staff/roles/{role['id']}",
        headers=H(owner_token),
        json={"permissions": spec["permissions"]},
        timeout=TIMEOUT,
    )


def _booking_for_patient(token, patient, performer_id=None, performer_role="doctor"):
    treatments = requests.get(
        f"{API}/treatments-catalog",
        headers=H(token),
        params={"active_only": True},
        timeout=TIMEOUT,
    ).json()
    if isinstance(treatments, dict):
        treatments = treatments.get("items") or []
    treatment = next(
        (
            t
            for t in treatments
            if (t.get("performer_type") or "").lower() == performer_role
            or performer_role in (t.get("allowed_performer_roles") or [])
        ),
        None,
    )
    treatment_name = (treatment or {}).get("name") or "Consultation"
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")
    payload = {
        "patient_id": patient["id"],
        "patient_name": patient.get("full_name") or "Test",
        "patient_phone": patient.get("phone") or "0812000000",
        "treatment": treatment_name,
        "duration_min": 30,
        "scheduled_at": f"{tomorrow}T10:00:00",
    }
    if performer_id:
        payload["performer_id"] = performer_id
    r = requests.post(f"{API}/bookings", headers=H(token), json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key, email in [
        ("owner", OWNER_EMAIL),
        ("fo", FO_EMAIL),
        ("doctor", DOCTOR_EMAIL),
        ("therapist", THERAPIST_EMAIL),
        ("nurse", NURSE_EMAIL),
    ]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


@pytest.fixture(scope="module", autouse=True)
def sync_clinical_package_view_permissions(tokens):
    owner = tokens.get("owner")
    if not owner:
        return
    for role_key in ("doctor", "therapist", "nurse"):
        _ensure_clinical_role_permissions(owner, role_key)


class TestPatientPackageViewPermissions:
    def test_fo_with_packages_view_can_view_patient_packages(self, tokens):
        fo = tokens["fo"]
        patient = _create_patient(fo)
        r = requests.get(f"{API}/patients/{patient['id']}/patient-packages", headers=H(fo), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_doctor_with_packages_view_can_view_assigned_patient_packages(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        doctor = tokens["doctor"]
        doctor_id = _user_id(doctor)
        patient = _create_patient(fo)
        bid = _booking_for_patient(fo, patient, performer_id=doctor_id)
        try:
            r = requests.get(
                f"{API}/patients/{patient['id']}/patient-packages",
                headers=H(doctor),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_doctor_cannot_view_unassigned_patient_packages(self, tokens):
        if not tokens.get("doctor"):
            pytest.skip("doctor seed not available")
        fo = tokens["fo"]
        patient = _create_patient(fo)
        r = requests.get(
            f"{API}/patients/{patient['id']}/patient-packages",
            headers=H(tokens["doctor"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_user_without_packages_view_cannot_view_patient_packages(self, tokens):
        owner = tokens["owner"]
        patient = _create_patient(owner)
        user_token, role_id, user_id = create_custom_role(owner, "Patient Only", ["patients.view"])
        try:
            r = requests.get(
                f"{API}/patients/{patient['id']}/patient-packages",
                headers=H(user_token),
                timeout=TIMEOUT,
            )
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    def test_custom_role_with_packages_view_can_view_when_patient_access_allows(self, tokens):
        owner = tokens["owner"]
        patient = _create_patient(owner)
        user_token, role_id, user_id = create_custom_role(
            owner, "Package Viewer", ["packages.view", "patients.view"]
        )
        try:
            r = requests.get(
                f"{API}/patients/{patient['id']}/patient-packages",
                headers=H(user_token),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            eligible = requests.post(
                f"{API}/patients/{patient['id']}/patient-packages/eligible",
                headers=H(user_token),
                json={"treatment_name": "Consultation"},
                timeout=TIMEOUT,
            )
            assert eligible.status_code == 200, eligible.text
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)

    @pytest.mark.parametrize("role_key", ["therapist", "nurse"])
    def test_clinical_roles_blocked_without_patient_access(self, tokens, role_key):
        token = tokens.get(role_key)
        if not token:
            pytest.skip(f"{role_key} seed not available")
        fo = tokens["fo"]
        patient = _create_patient(fo)
        r = requests.get(
            f"{API}/patients/{patient['id']}/patient-packages",
            headers=H(token),
            timeout=TIMEOUT,
        )
        assert r.status_code == 404


class TestPatientPackageReportVsViewPermissions:
    def test_packages_view_alone_cannot_access_global_report_summary(self, tokens):
        owner = tokens["owner"]
        user_token, role_id, user_id = create_custom_role(owner, "Package View Only", ["packages.view"])
        try:
            r = requests.get(f"{API}/patient-packages/reports/summary", headers=H(user_token), timeout=TIMEOUT)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/staff/users/{user_id}", headers=H(owner), timeout=TIMEOUT)
            requests.delete(f"{API}/staff/roles/{role_id}", headers=H(owner), timeout=TIMEOUT)
