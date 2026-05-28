"""Iteration 9 — Treatments CRUD, Role-aware queue, Patient stats/transactions.

Covers:
 - GET /api/dashboard/me-queue (doctor / therapist / fo / manager / super_admin)
 - Treatments catalog CRUD (POST/GET/PUT/DELETE) + RBAC + tenant isolation
 - Public treatments now read from db.treatments (auto-seed)
 - Public availability slots_per_session capacity behavior
 - Patient stats + transactions (Glow seeded data)
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


# ---------- /dashboard/me-queue role-aware ----------
class TestMeQueueRoles:
    def test_doctor_queue_structure(self):
        t = login("doctor@glowclinic.id")
        r = requests.get(f"{API}/dashboard/me-queue", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "doctor"
        assert isinstance(body["items"], list)
        for it in body["items"]:
            assert it["kind"] == "visit_clinical"
            assert "visit_id" in it
            assert "label" in it

    def test_therapist_queue_structure(self):
        t = login("therapist@glowclinic.id")
        r = requests.get(f"{API}/dashboard/me-queue", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "therapist"
        kinds = {it["kind"] for it in body["items"]}
        assert kinds.issubset({"visit_therapist", "booking"})

    def test_fo_queue_structure(self):
        t = login("fo@glowclinic.id")
        r = requests.get(f"{API}/dashboard/me-queue", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "fo"
        kinds = {it["kind"] for it in body["items"]}
        assert kinds.issubset({"booking", "visit_fo"})

    def test_manager_queue_summary_cards(self):
        t = login("manager@glowclinic.id")
        r = requests.get(f"{API}/dashboard/me-queue", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "manager"
        # Manager gets exactly 3 summary items
        assert len(body["items"]) == 3
        for it in body["items"]:
            assert it["kind"] == "summary"
            assert "label" in it and "link" in it

    def test_owner_queue_summary_cards(self):
        t = login("owner@glowclinic.id")
        r = requests.get(f"{API}/dashboard/me-queue", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        # Owner is super_admin role
        assert body["role"] == "super_admin"
        assert len(body["items"]) == 3
        assert all(i["kind"] == "summary" for i in body["items"])


# ---------- Treatments catalog CRUD + RBAC ----------
class TestTreatmentsCatalogCRUD:
    def test_get_returns_seeded_min_eight(self):
        t = login("owner@glowclinic.id")
        r = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 8
        # Sorted by name
        names = [x["name"] for x in rows]
        assert names == sorted(names, key=str.lower) or names == sorted(names)
        # Each row has required fields
        for x in rows:
            for k in ["id", "clinic_id", "key", "name", "category", "duration_min", "price_idr", "active"]:
                assert k in x, f"missing {k}"

    def test_get_active_only_filter(self):
        t = login("owner@glowclinic.id")
        r_all = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT)
        r_active = requests.get(f"{API}/treatments-catalog?active_only=true", headers=H(t), timeout=TIMEOUT)
        assert r_active.status_code == 200
        for x in r_active.json():
            assert x["active"] is True
        # active subset should be <= all
        assert len(r_active.json()) <= len(r_all.json())

    def test_doctor_cannot_create(self):
        t = login("doctor@glowclinic.id")
        r = requests.post(f"{API}/treatments-catalog", headers=H(t), json={
            "name": "TEST_DocAttempt", "category": "general", "duration_min": 30, "price_idr": 100000
        }, timeout=TIMEOUT)
        assert r.status_code == 403

    def test_therapist_cannot_create(self):
        t = login("therapist@glowclinic.id")
        r = requests.post(f"{API}/treatments-catalog", headers=H(t), json={
            "name": "TEST_TherAttempt", "category": "general", "duration_min": 30, "price_idr": 100000
        }, timeout=TIMEOUT)
        assert r.status_code == 403

    def test_owner_fo_manager_full_crud(self):
        t = login("owner@glowclinic.id")
        unique_name = f"TEST_TreatX_{uuid.uuid4().hex[:6]}"
        # Create
        r = requests.post(f"{API}/treatments-catalog", headers=H(t), json={
            "name": unique_name, "category": "facial",
            "duration_min": 45, "price_idr": 250000, "slots_per_session": 1,
            "active": True, "description": "trial"
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == unique_name
        assert created["category"] == "facial"
        assert created["key"] == unique_name.lower().replace(" ", "_")[:32]
        assert created["clinic_id"]
        tid = created["id"]

        # Update name -> key changes
        new_name = f"TEST_TreatX_R_{uuid.uuid4().hex[:6]}"
        r2 = requests.put(f"{API}/treatments-catalog/{tid}", headers=H(t),
                          json={"name": new_name, "price_idr": 300000}, timeout=TIMEOUT)
        assert r2.status_code == 200, r2.text
        upd = r2.json()
        assert upd["name"] == new_name
        assert upd["price_idr"] == 300000
        assert upd["key"] == new_name.lower().replace(" ", "_")[:32]

        # FO can also update
        t_fo = login("fo@glowclinic.id")
        r3 = requests.put(f"{API}/treatments-catalog/{tid}", headers=H(t_fo),
                          json={"active": False}, timeout=TIMEOUT)
        assert r3.status_code == 200
        assert r3.json()["active"] is False

        # Manager can also update
        t_mg = login("manager@glowclinic.id")
        r4 = requests.put(f"{API}/treatments-catalog/{tid}", headers=H(t_mg),
                          json={"active": True}, timeout=TIMEOUT)
        assert r4.status_code == 200

        # Delete
        rd = requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t), timeout=TIMEOUT)
        assert rd.status_code == 200
        # Verify gone -> 404 on update
        r5 = requests.put(f"{API}/treatments-catalog/{tid}", headers=H(t),
                          json={"name": "should-fail"}, timeout=TIMEOUT)
        assert r5.status_code == 404
        # Delete again -> 404
        rd2 = requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t), timeout=TIMEOUT)
        assert rd2.status_code == 404

    def test_tenant_isolation_treatments(self):
        # Glow owner sees Glow rows only
        t_glow = login("owner@glowclinic.id")
        r_g = requests.get(f"{API}/treatments-catalog", headers=H(t_glow), timeout=TIMEOUT)
        assert r_g.status_code == 200
        glow_cids = {x["clinic_id"] for x in r_g.json()}
        assert len(glow_cids) == 1

        # Cantik owner sees Cantik rows only
        t_cantik = login("owner@cantikbeauty.id")
        r_c = requests.get(f"{API}/treatments-catalog", headers=H(t_cantik), timeout=TIMEOUT)
        assert r_c.status_code == 200
        cantik_cids = {x["clinic_id"] for x in r_c.json()}
        assert len(cantik_cids) == 1
        assert glow_cids.isdisjoint(cantik_cids)

        # Cantik cannot update a Glow treatment
        glow_tid = r_g.json()[0]["id"]
        rx = requests.put(f"{API}/treatments-catalog/{glow_tid}", headers=H(t_cantik),
                          json={"price_idr": 1}, timeout=TIMEOUT)
        assert rx.status_code == 404


# ---------- Public treatments now read from db.treatments ----------
class TestPublicTreatmentsFromDb:
    def test_public_glow_treatments_has_8_with_categories(self):
        r = requests.get(f"{API}/public/clinics/glowclinic/treatments", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "treatments" in data and "clinic" in data
        treatments = data["treatments"]
        assert len(treatments) >= 8
        for t in treatments:
            for k in ["key", "name", "category", "duration_min", "price_idr"]:
                assert k in t, f"missing {k}"
            assert t.get("active", True) is True


# ---------- Availability slots_per_session capacity ----------
class TestAvailabilityCapacity:
    def test_slots_per_session_capacity(self):
        """When slots_per_session=2, 1 same-treatment booking still leaves slot available;
        2 bookings make it unavailable; different-treatment overlap always blocks."""
        t_owner = login("owner@glowclinic.id")

        # Pick a unique treatment & day far in future
        unique_name = f"TEST_Cap_{uuid.uuid4().hex[:6]}"
        rt = requests.post(f"{API}/treatments-catalog", headers=H(t_owner), json={
            "name": unique_name, "category": "facial", "duration_min": 30,
            "price_idr": 100000, "slots_per_session": 2, "active": True
        }, timeout=TIMEOUT)
        assert rt.status_code == 200
        tid = rt.json()["id"]

        try:
            # 21 days ahead, weekday — pick Wed if today's day-of-week shifts; use 21d
            future = (datetime.now(timezone.utc) + timedelta(days=21))
            # nudge to Wednesday to dodge weekend close
            shift = (2 - future.weekday()) % 7
            day = future + timedelta(days=shift)
            date_str = day.strftime("%Y-%m-%d")
            slot_iso = f"{date_str}T13:00:00"

            def find_slot(slots, hhmm):
                return next((x for x in slots if x["time"].endswith(f"T{hhmm}:00") or x["time"] == hhmm), None)

            # Step 1 — slot available initially
            r1 = requests.get(f"{API}/public/clinics/glowclinic/availability",
                              params={"date": date_str, "duration": 30, "treatment": unique_name},
                              timeout=TIMEOUT)
            assert r1.status_code == 200, r1.text
            assert r1.json().get("closed") is not True
            s1 = find_slot(r1.json()["slots"], "13:00")
            assert s1 is not None and s1["available"] is True, f"Initial slot not available: {s1}"

            # Step 2 — create first booking same-treatment same-time
            b1 = requests.post(f"{API}/bookings", headers=H(t_owner), json={
                "patient_name": f"TEST_Cap1_{uuid.uuid4().hex[:6]}",
                "patient_phone": "+628100100001",
                "treatment": unique_name,
                "duration_min": 30,
                "scheduled_at": slot_iso,
            }, timeout=TIMEOUT)
            assert b1.status_code == 200, b1.text
            b1id = b1.json()["id"]

            try:
                r2 = requests.get(f"{API}/public/clinics/glowclinic/availability",
                                  params={"date": date_str, "duration": 30, "treatment": unique_name},
                                  timeout=TIMEOUT)
                s2 = find_slot(r2.json()["slots"], "13:00")
                assert s2 is not None
                assert s2["available"] is True, "Capacity=2, 1 booking → should still be available"

                # Step 3 — second same-treatment booking
                b2 = requests.post(f"{API}/bookings", headers=H(t_owner), json={
                    "patient_name": f"TEST_Cap2_{uuid.uuid4().hex[:6]}",
                    "patient_phone": "+628100100002",
                    "treatment": unique_name,
                    "duration_min": 30,
                    "scheduled_at": slot_iso,
                }, timeout=TIMEOUT)
                assert b2.status_code == 200, b2.text
                b2id = b2.json()["id"]

                try:
                    r3 = requests.get(f"{API}/public/clinics/glowclinic/availability",
                                      params={"date": date_str, "duration": 30, "treatment": unique_name},
                                      timeout=TIMEOUT)
                    s3 = find_slot(r3.json()["slots"], "13:00")
                    assert s3 is not None
                    assert s3["available"] is False, "Capacity=2, 2 bookings → should be unavailable"

                    # Step 4 — different-treatment query → always blocks if any other booking overlaps
                    r4 = requests.get(f"{API}/public/clinics/glowclinic/availability",
                                      params={"date": date_str, "duration": 30, "treatment": "Consultation"},
                                      timeout=TIMEOUT)
                    s4 = find_slot(r4.json()["slots"], "13:00")
                    assert s4 is not None
                    assert s4["available"] is False, "Different treatment overlap should always block"
                finally:
                    requests.delete(f"{API}/bookings/{b2id}", headers=H(t_owner), timeout=TIMEOUT)
            finally:
                requests.delete(f"{API}/bookings/{b1id}", headers=H(t_owner), timeout=TIMEOUT)
        finally:
            requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t_owner), timeout=TIMEOUT)


# ---------- Patient stats + transactions ----------
class TestPatientStatsAndTx:
    @pytest.fixture(scope="class")
    def glow_owner_token(self):
        return login("owner@glowclinic.id")

    @pytest.fixture(scope="class")
    def first_glow_patient(self, glow_owner_token):
        r = requests.get(f"{API}/patients", headers=H(glow_owner_token), timeout=TIMEOUT)
        assert r.status_code == 200
        patients = r.json()
        assert isinstance(patients, list) and len(patients) > 0, "Glow should have seeded patients"
        # Prefer one whose name suggests visits (Anya / Dharma)
        for p in patients:
            if "Anya" in (p.get("name") or "") or "Dharma" in (p.get("name") or ""):
                return p
        return patients[0]

    def test_patient_stats_structure(self, glow_owner_token, first_glow_patient):
        pid = first_glow_patient["id"]
        r = requests.get(f"{API}/patients/{pid}/stats", headers=H(glow_owner_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        s = r.json()
        for k in ["total_spent_idr", "visits_total", "treatment_items_total", "last_visit_at", "avg_per_visit_idr"]:
            assert k in s, f"missing {k}"
        assert isinstance(s["total_spent_idr"], (int, float))
        assert isinstance(s["visits_total"], int)
        # At least one patient (Anya / Dharma) should have spend > 0
        # so check at least one of the seed patients does

    def test_patient_transactions_subtotal_math(self, glow_owner_token, first_glow_patient):
        pid = first_glow_patient["id"]
        r = requests.get(f"{API}/patients/{pid}/transactions", headers=H(glow_owner_token), timeout=TIMEOUT)
        assert r.status_code == 200
        tx = r.json()
        assert isinstance(tx, list)
        # If any visit, validate subtotal math + DESC order
        if tx:
            dates = [t.get("visit_date") for t in tx if t.get("visit_date")]
            assert dates == sorted(dates, reverse=True), "transactions must be DESC by date"
        for t in tx:
            for k in ["visit_id", "visit_date", "visit_type", "status", "items", "subtotal_idr"]:
                assert k in t
            recomputed = sum(float(i.get("price", 0) or 0) * float(i.get("quantity", 1) or 1) for i in t["items"])
            assert abs(recomputed - float(t["subtotal_idr"])) < 0.01, f"subtotal mismatch: {recomputed} vs {t['subtotal_idr']}"

    def test_at_least_one_patient_with_spend(self, glow_owner_token):
        r = requests.get(f"{API}/patients", headers=H(glow_owner_token), timeout=TIMEOUT)
        patients = r.json()
        seen_spend = False
        for p in patients[:10]:
            rs = requests.get(f"{API}/patients/{p['id']}/stats", headers=H(glow_owner_token), timeout=TIMEOUT)
            if rs.status_code == 200 and rs.json().get("total_spent_idr", 0) > 0:
                seen_spend = True
                break
        assert seen_spend, "Expected at least one Glow patient with non-zero spend (seeded data)"

    def test_cross_tenant_patient_404(self, glow_owner_token):
        # Cantik owner cannot read Glow patient
        t_cantik = login("owner@cantikbeauty.id")
        r = requests.get(f"{API}/patients", headers=H(glow_owner_token), timeout=TIMEOUT)
        glow_pid = r.json()[0]["id"]
        rs = requests.get(f"{API}/patients/{glow_pid}/stats", headers=H(t_cantik), timeout=TIMEOUT)
        assert rs.status_code == 404
        rt = requests.get(f"{API}/patients/{glow_pid}/transactions", headers=H(t_cantik), timeout=TIMEOUT)
        assert rt.status_code == 404
