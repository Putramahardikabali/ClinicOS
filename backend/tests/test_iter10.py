"""Iteration 10 — performer_type, capacity-aware bookings, manager role create.
Tests target the 3 new changes in /app/backend/bookings.py.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30


def login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


def future_iso(days_ahead: int = 7, hour: int = 11, minute: int = 0) -> str:
    base = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return f"{base.strftime('%Y-%m-%d')}T{hour:02d}:{minute:02d}:00"


# ---- Treatments performer_type ----
class TestTreatmentPerformerType:
    def test_default_treatments_have_performer_type(self):
        token = login("owner@glowclinic.id")
        r = requests.get(f"{API}/treatments-catalog", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200
        items = r.json()
        by_name = {t["name"]: t for t in items}
        # Doctor treatments
        for n in ["Consultation", "Dermal Filler", "Anti-wrinkle (Toxin)"]:
            assert n in by_name, f"missing {n}"
            assert by_name[n].get("performer_type") == "doctor", f"{n} should be doctor"
        # Therapist treatments
        for n in ["Signature Facial", "Chemical Peel", "Microneedling", "Laser Treatment", "Body Treatment / RF"]:
            assert n in by_name, f"missing {n}"
            assert by_name[n].get("performer_type") == "therapist", f"{n} should be therapist"

    def test_create_treatment_with_performer_type(self):
        token = login("owner@glowclinic.id")
        payload = {
            "name": f"TEST_Iter10_{uuid.uuid4().hex[:6]}",
            "category": "facial",
            "performer_type": "either",
            "duration_min": 30,
            "price_idr": 100000,
            "slots_per_session": 1,
        }
        r = requests.post(f"{API}/treatments-catalog", headers=H(token), json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["performer_type"] == "either"
        tid = t["id"]
        # PUT updates performer_type
        r2 = requests.put(f"{API}/treatments-catalog/{tid}", headers=H(token),
                          json={"performer_type": "doctor"}, timeout=TIMEOUT)
        assert r2.status_code == 200
        assert r2.json()["performer_type"] == "doctor"
        # Cleanup
        requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(token), timeout=TIMEOUT)

    def test_create_treatment_default_performer_type(self):
        token = login("owner@glowclinic.id")
        # Omit performer_type -> default should be therapist
        payload = {
            "name": f"TEST_Default_{uuid.uuid4().hex[:6]}",
            "category": "facial",
            "duration_min": 30,
            "price_idr": 100000,
        }
        r = requests.post(f"{API}/treatments-catalog", headers=H(token), json=payload, timeout=TIMEOUT)
        assert r.status_code == 200
        t = r.json()
        assert t.get("performer_type") == "therapist"
        requests.delete(f"{API}/treatments-catalog/{t['id']}", headers=H(token), timeout=TIMEOUT)


# ---- Capacity-aware booking ----
class TestBookingCapacity:
    def _make_booking(self, token, treatment, sched, dur=30, performer_id=None):
        payload = {
            "patient_name": f"TEST_Cap_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628111000000",
            "treatment": treatment,
            "duration_min": dur,
            "scheduled_at": sched,
        }
        if performer_id:
            payload["performer_id"] = performer_id
        return requests.post(f"{API}/bookings", headers=H(token), json=payload, timeout=TIMEOUT)

    def test_capacity_1_blocks_second_same_treatment(self):
        token = login("fo@glowclinic.id")
        sched = future_iso(days_ahead=45, hour=9, minute=0)
        # 1st should succeed
        r1 = self._make_booking(token, "Consultation", sched)
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        # 2nd same slot same treatment -> 409
        r2 = self._make_booking(token, "Consultation", sched)
        assert r2.status_code == 409, r2.text
        assert "capacity" in r2.json().get("detail", "").lower() or "overlap" in r2.json().get("detail", "").lower()
        # Cleanup: cancel b1
        requests.delete(f"{API}/bookings/{b1['id']}", headers=H(token), timeout=TIMEOUT)

    def test_capacity_2_allows_two_blocks_third(self):
        token = login("fo@glowclinic.id")
        # Create a custom treatment with slots_per_session=2
        tname = f"TEST_Cap2_{uuid.uuid4().hex[:6]}"
        rt = requests.post(f"{API}/treatments-catalog", headers=H(token), json={
            "name": tname, "category": "facial", "performer_type": "therapist",
            "duration_min": 30, "price_idr": 50000, "slots_per_session": 2
        }, timeout=TIMEOUT)
        assert rt.status_code == 200, rt.text
        tid = rt.json()["id"]
        sched = future_iso(days_ahead=46, hour=10, minute=0)
        created = []
        try:
            r1 = self._make_booking(token, tname, sched)
            assert r1.status_code == 200, r1.text
            created.append(r1.json()["id"])
            r2 = self._make_booking(token, tname, sched)
            assert r2.status_code == 200, r2.text
            created.append(r2.json()["id"])
            r3 = self._make_booking(token, tname, sched)
            assert r3.status_code == 409, r3.text
        finally:
            for bid in created:
                requests.delete(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)
            requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(token), timeout=TIMEOUT)

    def test_different_treatment_overlap_409(self):
        token = login("fo@glowclinic.id")
        sched = future_iso(days_ahead=47, hour=14, minute=0)
        r1 = self._make_booking(token, "Consultation", sched)
        assert r1.status_code == 200, r1.text
        bid = r1.json()["id"]
        try:
            # Different treatment overlap -> always 409 (single resource)
            r2 = self._make_booking(token, "Signature Facial", sched, dur=60)
            assert r2.status_code == 409
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)

    def test_public_booking_capacity_409(self):
        # Use Glow public slug 'glowclinic'
        sched = future_iso(days_ahead=48, hour=11, minute=0)
        payload = {
            "patient_name": f"TEST_Pub_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628111999000",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
        }
        r1 = requests.post(f"{API}/public/clinics/glowclinic/bookings", json=payload, timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        # 2nd same slot -> 409
        payload["patient_name"] = "TEST_Pub_Dup"
        r2 = requests.post(f"{API}/public/clinics/glowclinic/bookings", json=payload, timeout=TIMEOUT)
        assert r2.status_code == 409
        assert "slot" in r2.json().get("detail", "").lower() or "taken" in r2.json().get("detail", "").lower()
        # Cleanup as FO
        token = login("fo@glowclinic.id")
        requests.delete(f"{API}/bookings/{b1['id']}", headers=H(token), timeout=TIMEOUT)


# ---- performer_id validation ----
class TestPerformerIdValidation:
    def test_performer_from_different_clinic_400(self):
        # Get a Cantik user, try to use as performer for a Glow booking
        t_cantik = login("owner@cantikbeauty.id")
        r_me = requests.get(f"{API}/auth/me", headers=H(t_cantik), timeout=TIMEOUT)
        assert r_me.status_code == 200
        cantik_doc_id = r_me.json()["id"]

        t_glow = login("fo@glowclinic.id")
        sched = future_iso(days_ahead=49, hour=15, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(t_glow), json={
            "patient_name": "TEST_BadPerformer",
            "patient_phone": "+628111000111",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
            "performer_id": cantik_doc_id,
        }, timeout=TIMEOUT)
        assert r.status_code == 400, r.text
        assert "performer" in r.json().get("detail", "").lower()

    def test_performer_same_clinic_ok(self):
        t_glow = login("fo@glowclinic.id")
        # Get Glow doctor's id
        t_doc = login("doctor@glowclinic.id")
        r_me = requests.get(f"{API}/auth/me", headers=H(t_doc), timeout=TIMEOUT)
        assert r_me.status_code == 200
        glow_doc_id = r_me.json()["id"]
        sched = future_iso(days_ahead=50, hour=9, minute=30)
        r = requests.post(f"{API}/bookings", headers=H(t_glow), json={
            "patient_name": "TEST_GoodPerformer",
            "patient_phone": "+628111000222",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
            "performer_id": glow_doc_id,
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("performer_id") == glow_doc_id
        requests.delete(f"{API}/bookings/{b['id']}", headers=H(t_glow), timeout=TIMEOUT)


# ---- Manager role can create ----
class TestManagerCreateBooking:
    def test_manager_can_create_booking(self):
        token = login("manager@glowclinic.id")
        sched = future_iso(days_ahead=51, hour=10, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(token), json={
            "patient_name": "TEST_Manager",
            "patient_phone": "+628111000333",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        b = r.json()
        # Cleanup with same manager — DELETE limited to super_admin/fo. Use FO.
        fo = login("fo@glowclinic.id")
        requests.delete(f"{API}/bookings/{b['id']}", headers=H(fo), timeout=TIMEOUT)

    def test_doctor_cannot_create_booking(self):
        token = login("doctor@glowclinic.id")
        sched = future_iso(days_ahead=52, hour=11, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(token), json={
            "patient_name": "TEST_DoctorNo",
            "patient_phone": "+628111000444",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
        }, timeout=TIMEOUT)
        assert r.status_code == 403
