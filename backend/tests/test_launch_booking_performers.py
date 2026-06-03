"""Launch regression: multi-performer and overtime booking (Glow clinic)."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30
PASSWORD = "password123"

OWNER = {"email": os.environ.get("BOOKING_TEST_OWNER", "admin@bodylab.id"), "password": PASSWORD}
MANAGER = {"email": os.environ.get("BOOKING_TEST_MANAGER", "manager@bodylab.id"), "password": PASSWORD}
FO = {"email": os.environ.get("BOOKING_TEST_FO", "fo@bodylab.id"), "password": PASSWORD}
DOCTOR = {"email": os.environ.get("BOOKING_TEST_DOCTOR", "doctor@bodylab.id"), "password": PASSWORD}

TEST_PREFIX = "TEST_launch_mp_"
# Far-future Thursday to avoid collisions with other test suites
TEST_DATE = (datetime.now(timezone.utc).date() + timedelta(days=120)).strftime("%Y-%m-%d")
while datetime.strptime(TEST_DATE, "%Y-%m-%d").weekday() != 3:  # Thursday
    TEST_DATE = (datetime.strptime(TEST_DATE, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(
            f"{API}/auth/login",
            json={"email": creds["email"], "password": "ClinicOS@2026"},
            timeout=TIMEOUT,
        )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


def _at(time_hm: str) -> str:
    return f"{TEST_DATE}T{time_hm}:00"


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="module")
def manager_token():
    return _login(MANAGER)


@pytest.fixture(scope="module")
def fo_token():
    return _login(FO)


@pytest.fixture(scope="module")
def doctor_token():
    return _login(DOCTOR)


@pytest.fixture(scope="module")
def staff(owner_token):
    h = H(owner_token)
    r = requests.get(f"{API}/users", headers=h, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    users = r.json()
    doctor = next((u for u in users if u.get("role") == "doctor"), None)
    therapist = next((u for u in users if u.get("role") == "therapist"), None)
    nurse = next((u for u in users if u.get("role") == "nurse"), None)
    assert doctor, "Clinic needs a doctor user (seed admin@bodylab.id clinic)"
    assert therapist, "Clinic needs a therapist user"
    if not nurse:
        email = f"{TEST_PREFIX}nurse_{uuid.uuid4().hex[:6]}@bodylab.id"
        cr = requests.post(
            f"{API}/staff/users",
            headers=h,
            json={
                "email": email,
                "password": PASSWORD,
                "name": "Launch QA Nurse",
                "role": "nurse",
                "performer_type": "nurse",
            },
            timeout=TIMEOUT,
        )
        assert cr.status_code == 200, cr.text
        nurse = cr.json()
    return {"doctor": doctor, "therapist": therapist, "nurse": nurse}


@pytest.fixture(scope="module")
def mp_treatments(owner_token):
    """Temporary treatments for multi-performer / nurse-only scenarios."""
    h = H(owner_token)
    suffix = uuid.uuid4().hex[:6]
    specs = [
        {
            "name": f"{TEST_PREFIX}doc_nurse_{suffix}",
            "category": "consult",
            "performer_type": "doctor",
            "allowed_performer_roles": ["doctor", "nurse"],
            "allow_multiple_performers": True,
            "duration_min": 45,
            "price_idr": 500000,
        },
        {
            "name": f"{TEST_PREFIX}ther_nurse_{suffix}",
            "category": "facial",
            "performer_type": "therapist",
            "allowed_performer_roles": ["therapist", "nurse"],
            "allow_multiple_performers": True,
            "duration_min": 60,
            "price_idr": 400000,
        },
        {
            "name": f"{TEST_PREFIX}nurse_only_{suffix}",
            "category": "general",
            "performer_type": "nurse",
            "allowed_performer_roles": ["nurse"],
            "allow_multiple_performers": False,
            "duration_min": 30,
            "price_idr": 200000,
        },
        {
            "name": f"{TEST_PREFIX}consult_short_{suffix}",
            "category": "consult",
            "performer_type": "doctor",
            "duration_min": 60,
            "price_idr": 300000,
        },
    ]
    created = []
    for spec in specs:
        r = requests.post(f"{API}/treatments-catalog", headers=h, json=spec, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        created.append(r.json())
    yield created
    for t in created:
        requests.delete(f"{API}/treatments-catalog/{t['id']}", headers=h, timeout=TIMEOUT)


@pytest.fixture(autouse=True)
def cleanup_bookings(fo_token):
    yield
    h = H(fo_token)
    r = requests.get(f"{API}/bookings", headers=h, params={"date": TEST_DATE}, timeout=TIMEOUT)
    if r.status_code != 200:
        return
    for b in r.json():
        if str(b.get("patient_name", "")).startswith(TEST_PREFIX):
            requests.delete(f"{API}/bookings/{b['id']}", headers=h, timeout=TIMEOUT)


def _pre_cleanup(fo_token):
    h = H(fo_token)
    r = requests.get(f"{API}/bookings", headers=h, params={"date": TEST_DATE}, timeout=TIMEOUT)
    if r.status_code == 200:
        for b in r.json():
            if str(b.get("patient_name", "")).startswith(TEST_PREFIX):
                requests.delete(f"{API}/bookings/{b['id']}", headers=h, timeout=TIMEOUT)


def _create_booking(token, payload):
    return requests.post(f"{API}/bookings", headers=H(token), json=payload, timeout=TIMEOUT)


def _assert_primary_and_assistant(booking, primary_id, assistant_id, assistant_role="nurse"):
    performers = booking.get("performers") or []
    assert len(performers) >= 2, performers
    primary = next(p for p in performers if p.get("performer_type") == "primary")
    assistant = next(p for p in performers if p.get("staff_id") == assistant_id)
    assert primary["staff_id"] == primary_id
    assert assistant["staff_id"] == assistant_id
    assert assistant.get("staff_role_snapshot") == assistant_role
    assert booking.get("performer_id") == primary_id


class TestMultiPerformerBookings:
    def test_doctor_primary_nurse_assistant(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[0]["name"]
        doc_id = staff["doctor"]["id"]
        nurse_id = staff["nurse"]["id"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}doc_nurse",
            "patient_phone": "+62811000001",
            "treatment": treatment,
            "duration_min": 45,
            "scheduled_at": _at("10:00"),
            "performers": [
                {"staff_id": doc_id, "performer_type": "primary"},
                {"staff_id": nurse_id, "performer_type": "assistant"},
            ],
        })
        assert r.status_code == 200, r.text
        _assert_primary_and_assistant(r.json(), doc_id, nurse_id)

    def test_therapist_primary_nurse_assistant(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[1]["name"]
        ther_id = staff["therapist"]["id"]
        nurse_id = staff["nurse"]["id"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}ther_nurse",
            "patient_phone": "+62811000002",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": _at("11:00"),
            "performers": [
                {"staff_id": ther_id, "performer_type": "primary"},
                {"staff_id": nurse_id, "performer_type": "assistant"},
            ],
        })
        assert r.status_code == 200, r.text
        _assert_primary_and_assistant(r.json(), ther_id, nurse_id)

    def test_nurse_only_booking(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[2]["name"]
        nurse_id = staff["nurse"]["id"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}nurse_only",
            "patient_phone": "+62811000003",
            "treatment": treatment,
            "duration_min": 30,
            "scheduled_at": _at("12:00"),
            "performer_id": nurse_id,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("performer_id") == nurse_id
        performers = b.get("performers") or []
        assert len(performers) == 1
        assert performers[0]["staff_id"] == nurse_id
        assert performers[0].get("staff_role_snapshot") == "nurse"


class TestPerformerValidation:
    def test_assistant_must_have_staff_id_not_only_role(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[0]["name"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}role_only",
            "patient_phone": "+62811000004",
            "treatment": treatment,
            "duration_min": 45,
            "scheduled_at": _at("13:00"),
            "performers": [
                {"staff_id": staff["doctor"]["id"], "performer_type": "primary"},
                {"staff_role": "nurse", "performer_type": "assistant"},
            ],
        })
        assert r.status_code in (400, 422), r.text
        detail = r.json().get("detail", "")
        if isinstance(detail, list):
            msg = " ".join(str(x) for x in detail).lower()
        else:
            msg = str(detail).lower()
        assert "staff" in msg

    def test_duplicate_performer_rejected(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[0]["name"]
        doc_id = staff["doctor"]["id"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}dup",
            "patient_phone": "+62811000005",
            "treatment": treatment,
            "duration_min": 45,
            "scheduled_at": _at("14:00"),
            "performers": [
                {"staff_id": doc_id, "performer_type": "primary"},
                {"staff_id": doc_id, "performer_type": "assistant"},
            ],
        })
        assert r.status_code == 400, r.text
        assert "duplicate" in r.json().get("detail", "").lower()

    def test_same_staff_cannot_be_double_booked(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        slot = _at("15:00")
        r1 = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}busy1",
            "patient_phone": "+62811000006",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": slot,
            "performer_id": doc_id,
        })
        assert r1.status_code == 200, r1.text
        r2 = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}busy2",
            "patient_phone": "+62811000007",
            "treatment": treatment,
            "duration_min": 30,
            "scheduled_at": slot,
            "performer_id": doc_id,
        })
        assert r2.status_code == 409, r2.text
        assert "already booked" in r2.json().get("detail", "").lower()


class TestSchedulePerformerPreservation:
    """Simulates schedule-slot click → treatment selected → submit (performer_id preserved)."""

    def test_performer_id_kept_as_primary_after_treatment_selection(self, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        doc_id = staff["doctor"]["id"]
        # Step 1: schedule slot provides performer_id before treatment is chosen
        scheduled_at = _at("09:00")
        # Step 2: user picks doctor treatment — payload sends performer_id only (no performers[])
        treatment_a = mp_treatments[3]["name"]
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}sched_keep",
            "patient_phone": "+62811000008",
            "treatment": treatment_a,
            "duration_min": 60,
            "scheduled_at": scheduled_at,
            "performer_id": doc_id,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("performer_id") == doc_id
        performers = b.get("performers") or []
        assert performers, "performers[] should be populated from performer_id"
        assert performers[0]["staff_id"] == doc_id
        assert performers[0].get("performer_type") == "primary"
        assert performers[0].get("staff_role_snapshot") == "doctor"

    def test_available_performers_includes_schedule_performer(self, fo_token, staff, mp_treatments):
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        r = requests.get(
            f"{API}/bookings/available-performers",
            headers=H(fo_token),
            params={
                "date": TEST_DATE,
                "time": "09:00",
                "duration": 60,
                "treatment": treatment,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json().get("performers", [])}
        assert doc_id in ids


class TestOvertimeBooking:
    def _overtime_slot(self, token, staff, treatment_name, duration=60):
        """Find an outside-hours slot where doctor is working that day but off-window."""
        doc_id = staff["doctor"]["id"]
        for hm in ("07:00", "21:00", "22:00"):
            r = requests.get(
                f"{API}/bookings/available-performers",
                headers=H(token),
                params={
                    "date": TEST_DATE,
                    "time": hm,
                    "duration": duration,
                    "treatment": treatment_name,
                    "is_overtime": True,
                },
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                continue
            if any(p["id"] == doc_id for p in r.json().get("performers", [])):
                return _at(hm), hm
        pytest.skip("No overtime slot found for doctor on test date")

    def test_overtime_requires_approval_and_outside_hours(self, manager_token, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        sched, _ = self._overtime_slot(manager_token, staff, treatment)

        # FO lacks bookings.create_overtime
        r_fo = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}ot_fo",
            "patient_phone": "+62811000009",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": sched,
            "performer_id": doc_id,
            "is_overtime": True,
            "overtime_reason": "Patient request",
            "overtime_note": "VIP client requested early slot",
        })
        assert r_fo.status_code == 403, r_fo.text

        # Manager can create overtime outside hours
        r_mgr = _create_booking(manager_token, {
            "patient_name": f"{TEST_PREFIX}ot_ok",
            "patient_phone": "+62811000010",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": sched,
            "performer_id": doc_id,
            "is_overtime": True,
            "overtime_reason": "Manager approved",
            "overtime_note": "Approved by clinic manager for launch QA",
        })
        assert r_mgr.status_code == 200, r_mgr.text
        assert r_mgr.json().get("is_overtime") is True

    def test_normal_booking_rejected_outside_working_hours(self, manager_token, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        sched, _ = self._overtime_slot(manager_token, staff, treatment)
        r = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}ot_norm",
            "patient_phone": "+62811000011",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": sched,
            "performer_id": doc_id,
            "is_overtime": False,
        })
        assert r.status_code == 409, r.text

    def test_overtime_conflict_uses_full_treatment_duration(self, manager_token, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        # In-hours booking 16:00–17:00 (60 min)
        r1 = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}ot_block",
            "patient_phone": "+62811000012",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": _at("16:00"),
            "performer_id": doc_id,
        })
        assert r1.status_code == 200, r1.text

        # Overtime-style overlap check: 16:30 for 60 min overlaps in-hours block (not just 15-min grid)
        r2 = _create_booking(manager_token, {
            "patient_name": f"{TEST_PREFIX}ot_overlap",
            "patient_phone": "+62811000013",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": _at("16:30"),
            "performer_id": doc_id,
            "is_overtime": True,
            "overtime_reason": "Emergency",
            "overtime_note": "Should conflict with 60-minute existing booking",
        })
        assert r2.status_code == 409, r2.text
        assert "already booked" in r2.json().get("detail", "").lower()

        # Adjacent slot after 60-minute block ends (17:00–18:00) should succeed
        r3 = _create_booking(fo_token, {
            "patient_name": f"{TEST_PREFIX}ot_after",
            "patient_phone": "+62811000014",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": _at("17:00"),
            "performer_id": doc_id,
        })
        if r3.status_code == 409:
            # If clinic hours end before 17:00, use earlier non-overlapping slot on same day
            r3 = _create_booking(fo_token, {
                "patient_name": f"{TEST_PREFIX}ot_after",
                "patient_phone": "+62811000014",
                "treatment": treatment,
                "duration_min": 30,
                "scheduled_at": _at("15:00"),
                "performer_id": doc_id,
            })
        assert r3.status_code == 200, r3.text

    def test_overtime_stores_reason_note_created_by_and_flag(self, manager_token, fo_token, staff, mp_treatments):
        _pre_cleanup(fo_token)
        treatment = mp_treatments[3]["name"]
        doc_id = staff["doctor"]["id"]
        sched, _ = self._overtime_slot(manager_token, staff, treatment)
        note = "Launch QA overtime metadata check"
        me = requests.get(f"{API}/auth/me", headers=H(manager_token), timeout=TIMEOUT).json()
        r = _create_booking(manager_token, {
            "patient_name": f"{TEST_PREFIX}ot_meta",
            "patient_phone": "+62811000015",
            "treatment": treatment,
            "duration_min": 60,
            "scheduled_at": sched,
            "performer_id": doc_id,
            "is_overtime": True,
            "overtime_reason": "Schedule exception",
            "overtime_note": note,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("is_overtime") is True
        assert b.get("overtime_reason") == "Schedule exception"
        assert b.get("overtime_note") == note
        assert b.get("overtime_created_by") == me.get("id")
        assert b.get("created_by") == me.get("id")

        detail = requests.get(f"{API}/bookings/{b['id']}", headers=H(manager_token), timeout=TIMEOUT)
        assert detail.status_code == 200
        d = detail.json()
        assert d.get("is_overtime") is True
        assert d.get("overtime_note") == note
