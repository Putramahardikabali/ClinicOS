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
            assert it["kind"] in ("visit_clinical", "booking")
            if it["kind"] == "visit_clinical":
                assert "visit_id" in it
            if it["kind"] == "booking":
                assert "booking_id" in it
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

    def test_doctor_can_read_catalog_with_facets(self):
        t = login("doctor@glowclinic.id")
        r = requests.get(
            f"{API}/treatments-catalog",
            headers=H(t),
            params={"active_only": True, "include_facets": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("items"), list)
        assert isinstance(body.get("facets"), list)

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

    def test_import_export_csv(self):
        t = login("owner@glowclinic.id")
        code = f"TESTIMP_{uuid.uuid4().hex[:6]}"
        csv_body = (
            "ServiceCode,ServiceName,Category,Sub Category,BusinessUnitName,ServiceType,ServicePrice,"
            "OnlineBooking,TaxIncluded,TaxGroup,ServiceLength\n"
            f"{code},Import Test Facial,Face Treatments,Cleansing,Default,None,1.250.000,True,True,VAT,45\n"
        )
        r = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] >= 1 or data["updated"] >= 1
        assert data["total"] == 1

        r2 = requests.get(f"{API}/treatments-catalog/export?format=csv", headers=H(t), timeout=TIMEOUT)
        assert r2.status_code == 200
        assert "ServiceCode" in r2.text
        assert code in r2.text
        assert "Import Test Facial" in r2.text

        # Re-import updates same service code, preserves performer if set
        rows = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        row = next((x for x in rows if x.get("service_code") == code or x.get("name") == "Import Test Facial"), None)
        assert row is not None
        assert row["price_idr"] == 1_250_000
        tid = row["id"]
        requests.put(
            f"{API}/treatments-catalog/{tid}",
            headers=H(t),
            json={"performer_type": "doctor"},
            timeout=TIMEOUT,
        )
        csv_update = csv_body.replace("Import Test Facial", "Import Test Facial Updated").replace("1.250.000", "2.500.000").replace(",45", ",50")
        r3 = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_update.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r3.status_code == 200
        assert r3.json()["updated"] >= 1
        row2 = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        updated = next((x for x in row2 if x["id"] == tid), None)
        assert updated["name"] == "Import Test Facial Updated"
        assert updated["performer_type"] == "doctor"
        assert updated["duration_min"] == 50
        assert updated["price_idr"] == 2_500_000
        requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t), timeout=TIMEOUT)

    def test_reimport_updates_not_duplicates(self):
        t = login("owner@glowclinic.id")
        code = f"REDUP_{uuid.uuid4().hex[:6]}"
        csv_body = (
            "ServiceCode,ServiceName,Category,Sub Category,BusinessUnitName,ServiceType,ServicePrice,"
            "OnlineBooking,TaxIncluded,TaxGroup,ServiceLength\n"
            f"{code},Reimport Dup Test,Face Treatments,Cleansing,Default,None,900.000,True,True,VAT,30\n"
        )
        imp = lambda: requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        r1 = imp()
        assert r1.status_code == 200, r1.text
        assert r1.json()["created"] >= 1

        rows = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        matches = [x for x in rows if x.get("service_code") == code or x.get("name") == "Reimport Dup Test"]
        assert len(matches) == 1
        tid = matches[0]["id"]

        csv_body2 = csv_body.replace("900.000", "1.100.000")
        r2 = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_body2.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["created"] == 0, body2
        assert body2["updated"] >= 1

        rows2 = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        matches2 = [x for x in rows2 if x.get("service_code") == code or x.get("name") == "Reimport Dup Test"]
        assert len(matches2) == 1
        assert matches2[0]["id"] == tid
        assert matches2[0]["price_idr"] == 1_100_000

        requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t), timeout=TIMEOUT)

    def test_reimport_without_code_matches_by_name(self):
        t = login("owner@glowclinic.id")
        name = f"Reimport By Name {uuid.uuid4().hex[:8]}"
        csv_no_code = (
            "ServiceName,Category,ServiceType,ServicePrice,ServiceLength\n"
            f"{name},Face Treatments,None,750.000,25\n"
        )
        r1 = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_no_code.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        rows = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        row = next(x for x in rows if x.get("name") == name)
        tid = row["id"]
        original_code = row["service_code"]

        csv_update = csv_no_code.replace("750.000", "800.000")
        r2 = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_update.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["created"] == 0
        assert r2.json()["updated"] >= 1

        rows_after = requests.get(f"{API}/treatments-catalog", headers=H(t), timeout=TIMEOUT).json()
        row2 = next(x for x in rows_after if x["id"] == tid)
        assert row2["price_idr"] == 800_000
        assert row2["service_code"] == original_code

        requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(t), timeout=TIMEOUT)

    def test_doctor_cannot_import(self):
        t = login("doctor@glowclinic.id")
        r = requests.post(
            f"{API}/treatments-catalog/import",
            headers=H(t),
            files={"file": ("x.csv", b"ServiceName\nX\n", "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

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


class TestPackagesCatalog:
    def test_import_export_and_fo_booking(self):
        t = login("owner@glowclinic.id")
        code = f"PKIMP_{uuid.uuid4().hex[:6]}"
        csv_body = (
            "PackageName,PackageCode,Status,PackageType,PackagePrice,PackageCategory,BusinessUnit,OnlineBooking\n"
            f"Import Test Package,{code},Active,Series package,1.890.000,Default,Default,No\n"
        )
        r = requests.post(
            f"{API}/packages-catalog/import",
            headers=H(t),
            files={"file": ("import.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 1
        assert data["created"] >= 1 or data["updated"] >= 1

        r2 = requests.get(f"{API}/packages-catalog/export?format=csv", headers=H(t), timeout=TIMEOUT)
        assert r2.status_code == 200
        assert "PackageName" in r2.text
        assert code in r2.text

        rows = requests.get(f"{API}/packages-catalog", headers=H(t), timeout=TIMEOUT).json()
        pkg = next((x for x in rows if x.get("package_code") == code), None)
        assert pkg is not None
        pid = pkg["id"]

        t_fo = login("fo@glowclinic.id")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
        rb = requests.post(f"{API}/bookings", headers=H(t_fo), json={
            "patient_name": "Package Test Patient",
            "patient_phone": "08123456789",
            "treatment": pkg["name"],
            "package_id": pid,
            "booking_type": "package",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T10:00:00",
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        booking = rb.json()
        assert booking["booking_type"] == "package"
        assert booking["package_id"] == pid
        assert booking["treatment"] == pkg["name"]

        requests.delete(f"{API}/bookings/{booking['id']}", headers=H(t_fo), timeout=TIMEOUT)
        requests.delete(f"{API}/packages-catalog/{pid}", headers=H(t), timeout=TIMEOUT)


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


class TestPatientImportExport:
    def test_import_csv_and_export(self):
        t = login("fo@glowclinic.id")
        code = f"BL{uuid.uuid4().hex[:5].upper()}"
        csv_body = (
            "FirstName,LastName,Phone No,UserCode,membershipname,lastvisit,guestIconInformation\n"
            f"Excel,Import,{code[-10:]},{code},Gold,21/01/2026,note\n"
        )
        r = requests.post(
            f"{API}/patients/import",
            headers=H(t),
            files={"file": ("patients.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] >= 1 or data["updated"] >= 1

        r2 = requests.get(f"{API}/patients/export?format=csv", headers=H(t), timeout=TIMEOUT)
        assert r2.status_code == 200
        assert "FirstName" in r2.text
        assert code in r2.text
        assert "Excel" in r2.text

    def test_doctor_cannot_import(self):
        t = login("doctor@glowclinic.id")
        r = requests.post(
            f"{API}/patients/import",
            headers=H(t),
            files={"file": ("x.csv", b"FirstName,LastName\nA,B\n", "text/csv")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


class TestPatientPagination:
    def test_paginated_list_and_search_across_pages(self):
        t = login("fo@glowclinic.id")
        unique = uuid.uuid4().hex[:8]
        created_ids = []
        for i in range(3):
            r = requests.post(
                f"{API}/patients",
                headers=H(t),
                json={"full_name": f"TEST Paginate {unique} {i:02d}", "phone": f"081{unique}{i}"},
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            created_ids.append(r.json()["id"])

        r1 = requests.get(f"{API}/patients", headers=H(t), params={"page": 1, "page_size": 2}, timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert isinstance(body, dict)
        assert "items" in body and "total" in body and "pages" in body
        assert len(body["items"]) == 2
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total"] >= 3

        r_search = requests.get(
            f"{API}/patients",
            headers=H(t),
            params={"q": f"TEST Paginate {unique}", "page": 1, "page_size": 20},
            timeout=TIMEOUT,
        )
        assert r_search.status_code == 200, r_search.text
        found = r_search.json()
        assert found["total"] == 3
        assert len(found["items"]) == 3
        assert {p["id"] for p in found["items"]} == set(created_ids)

        # Legacy non-paginated response still works for booking picker
        r_legacy = requests.get(f"{API}/patients", headers=H(t), timeout=TIMEOUT)
        assert r_legacy.status_code == 200
        assert isinstance(r_legacy.json(), list)


class TestCatalogPagination:
    def test_treatments_and_packages_paginated(self):
        t = login("owner@glowclinic.id")
        unique = uuid.uuid4().hex[:8]
        for i in range(3):
            r = requests.post(
                f"{API}/treatments-catalog",
                headers=H(t),
                json={
                    "name": f"TEST PageTreat {unique} {i:02d}",
                    "category": f"PageCat_{unique}",
                    "duration_min": 30,
                    "price_idr": 100000,
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        tr = requests.get(
            f"{API}/treatments-catalog",
            headers=H(t),
            params={"q": f"TEST PageTreat {unique}", "page": 1, "page_size": 2},
            timeout=TIMEOUT,
        )
        assert tr.status_code == 200, tr.text
        tbody = tr.json()
        assert isinstance(tbody, dict)
        assert len(tbody["items"]) == 2
        assert tbody["total"] == 3
        assert tbody["pages"] == 2
        assert unique in str(tbody.get("facets", []))

        code = f"PKPG_{uuid.uuid4().hex[:6]}"
        for i in range(2):
            r = requests.post(
                f"{API}/packages-catalog",
                headers=H(t),
                json={
                    "name": f"TEST PagePkg {unique} {i}",
                    "package_code": f"{code}{i}",
                    "package_type": "Series package",
                    "price_idr": 500000,
                },
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
        pr = requests.get(
            f"{API}/packages-catalog",
            headers=H(t),
            params={"q": f"TEST PagePkg {unique}", "page": 1, "page_size": 20},
            timeout=TIMEOUT,
        )
        assert pr.status_code == 200, pr.text
        pbody = pr.json()
        assert pbody["total"] == 2
        assert len(pbody["items"]) == 2

        # Booking picker still gets unpaginated array
        legacy = requests.get(f"{API}/treatments-catalog?active_only=true", headers=H(t), timeout=TIMEOUT)
        assert legacy.status_code == 200
        assert isinstance(legacy.json(), list)


class TestPatientDelete:
    def test_super_admin_can_delete_patient_without_visits(self):
        t_owner = login("owner@glowclinic.id")
        unique = uuid.uuid4().hex[:8]
        r = requests.post(
            f"{API}/patients",
            headers=H(t_owner),
            json={"full_name": f"TEST DeleteMe {unique}", "phone": f"081{unique}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        r_del = requests.delete(f"{API}/patients/{pid}", headers=H(t_owner), timeout=TIMEOUT)
        assert r_del.status_code == 200, r_del.text

        r_get = requests.get(f"{API}/patients/{pid}", headers=H(t_owner), timeout=TIMEOUT)
        assert r_get.status_code == 404

    def test_fo_cannot_delete_patient(self):
        t_fo = login("fo@glowclinic.id")
        r = requests.delete(f"{API}/patients/nonexistent-id", headers=H(t_fo), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_cannot_delete_patient_with_visits(self):
        t_owner = login("owner@glowclinic.id")
        t_fo = login("fo@glowclinic.id")
        unique = uuid.uuid4().hex[:8]
        r = requests.post(
            f"{API}/patients",
            headers=H(t_fo),
            json={"full_name": f"TEST HasVisit {unique}", "phone": f"082{unique}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        users = requests.get(f"{API}/users", headers=H(t_owner), timeout=TIMEOUT).json()
        doctor = next(u for u in users if u.get("role") == "doctor")
        rv = requests.post(
            f"{API}/visits",
            headers=H(t_fo),
            json={"patient_id": pid, "visit_type": "doctor", "assigned_to": doctor["id"], "chief_complaint": "test"},
            timeout=TIMEOUT,
        )
        assert rv.status_code == 200, rv.text
        r_del = requests.delete(f"{API}/patients/{pid}", headers=H(t_owner), timeout=TIMEOUT)
        assert r_del.status_code == 409
        assert "visit" in r_del.json().get("detail", "").lower()


class TestStaffAssigneeIsolation:
    """Doctors/therapists only see bookings and visits assigned to them."""

    def test_bookings_and_visits_scoped_to_performer(self):
        owner = login("owner@glowclinic.id")
        fo = login("fo@glowclinic.id")
        users = requests.get(f"{API}/users", headers=H(owner), timeout=TIMEOUT).json()
        doctor = next(u for u in users if u.get("role") == "doctor")
        therapist = next(u for u in users if u.get("role") == "therapist")
        day = (datetime.now(timezone.utc) + timedelta(days=45)).strftime("%Y-%m-%d")
        payload_doc = {
            "patient_name": f"TEST Doc {uuid.uuid4().hex[:6]}",
            "patient_phone": "+62811110001",
            "treatment": "Consultation",
            "scheduled_at": f"{day}T14:00:00",
            "duration_min": 30,
            "performer_id": doctor["id"],
        }
        payload_thr = {
            **payload_doc,
            "patient_name": f"TEST Thr {uuid.uuid4().hex[:6]}",
            "patient_phone": "+62811110002",
            "scheduled_at": f"{day}T15:00:00",
            "treatment": "Facial",
            "performer_id": therapist["id"],
        }
        b_doc = requests.post(f"{API}/bookings", json=payload_doc, headers=H(fo), timeout=TIMEOUT)
        b_thr = requests.post(f"{API}/bookings", json=payload_thr, headers=H(fo), timeout=TIMEOUT)
        assert b_doc.status_code == 200, b_doc.text
        assert b_thr.status_code == 200, b_thr.text
        bid_doc = b_doc.json()["id"]
        bid_thr = b_thr.json()["id"]

        t_doc = login(doctor["email"])
        t_thr = login(therapist["email"])
        doc_bookings = requests.get(f"{API}/bookings", params={"scope": "upcoming"}, headers=H(t_doc), timeout=TIMEOUT).json()
        thr_bookings = requests.get(f"{API}/bookings", params={"scope": "upcoming"}, headers=H(t_thr), timeout=TIMEOUT).json()
        doc_ids = {b["id"] for b in doc_bookings}
        thr_ids = {b["id"] for b in thr_bookings}
        assert bid_doc in doc_ids
        assert bid_doc not in thr_ids
        assert bid_thr in thr_ids
        assert bid_thr not in doc_ids

        # Cross-access by booking id
        assert requests.get(f"{API}/bookings/{bid_thr}", headers=H(t_doc), timeout=TIMEOUT).status_code == 404

        # Visits: FO creates two visits assigned to different staff
        patients = requests.get(f"{API}/patients", headers=H(fo), timeout=TIMEOUT).json()
        pid = patients[0]["id"]
        v_doc = requests.post(f"{API}/visits", json={"patient_id": pid, "visit_type": "doctor", "assigned_to": doctor["id"], "chief_complaint": "TEST doc visit"}, headers=H(fo), timeout=TIMEOUT)
        v_thr = requests.post(f"{API}/visits", json={"patient_id": pid, "visit_type": "therapist", "assigned_to": therapist["id"], "chief_complaint": "TEST thr visit"}, headers=H(fo), timeout=TIMEOUT)
        assert v_doc.status_code == 200, v_doc.text
        assert v_thr.status_code == 200, v_thr.text
        vid_doc = v_doc.json()["id"]
        vid_thr = v_thr.json()["id"]
        doc_visits = requests.get(f"{API}/visits", headers=H(t_doc), timeout=TIMEOUT).json()
        doc_vids = {v["id"] for v in doc_visits}
        assert vid_doc in doc_vids
        assert vid_thr not in doc_vids
        assert requests.get(f"{API}/visits/{vid_thr}", headers=H(t_doc), timeout=TIMEOUT).status_code == 404


class TestProductsCatalog:
    def test_manager_and_fo_can_manage_products(self):
        owner = login("owner@luminabali.id")
        mgr = login("manager@luminabali.id")
        fo = login("fo@luminabali.id")
        code = f"PRD_{uuid.uuid4().hex[:6]}"

        r = requests.post(f"{API}/products-catalog", headers=H(mgr), json={
            "name": "Test Product Alpha",
            "product_code": code,
            "brand": "NeoStrata",
            "category": "INVENTORY",
            "product_type": "Consumable",
            "current_stock": 12,
            "minimum_stock": 5,
            "unit": "bottle",
            "notes": "Shelf A",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        r_fo_list = requests.get(f"{API}/products-catalog", headers=H(fo), params={"page": 1, "page_size": 20}, timeout=TIMEOUT)
        assert r_fo_list.status_code == 200
        assert any(x["id"] == pid for x in r_fo_list.json()["items"])

        fo_code = f"PRD_{uuid.uuid4().hex[:6]}"
        r_fo_post = requests.post(f"{API}/products-catalog", headers=H(fo), json={
            "name": "FO Product",
            "product_code": fo_code,
            "category": "INVENTORY",
            "product_type": "Consumable",
        }, timeout=TIMEOUT)
        assert r_fo_post.status_code == 200, r_fo_post.text
        fo_pid = r_fo_post.json()["id"]

        r_fo_put = requests.put(f"{API}/products-catalog/{fo_pid}", headers=H(fo), json={"notes": "FO updated"}, timeout=TIMEOUT)
        assert r_fo_put.status_code == 200, r_fo_put.text

        r_fo_del = requests.delete(f"{API}/products-catalog/{fo_pid}", headers=H(fo), timeout=TIMEOUT)
        assert r_fo_del.status_code == 200

        csv_body = (
            "Product Code,Product Name,Brand,Product Type,Category,Current Stock,Unit,Minimum Stock,Active,Notes\n"
            f"{code},Test Product Alpha Updated,NeoStrata,Consumable,INVENTORY,8,bottle,10,Active,Updated note\n"
        )
        r_imp = requests.post(
            f"{API}/products-catalog/import",
            headers=H(owner),
            files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
            timeout=TIMEOUT,
        )
        assert r_imp.status_code == 200, r_imp.text
        assert r_imp.json()["updated"] >= 1
        assert r_imp.json()["created"] == 0

        rows = requests.get(f"{API}/products-catalog", headers=H(mgr), timeout=TIMEOUT).json()
        if isinstance(rows, dict):
            rows = rows.get("items", [])
        updated = next(x for x in rows if x["id"] == pid)
        assert updated["name"] == "Test Product Alpha Updated"
        assert updated["current_stock"] == 8
        assert updated["minimum_stock"] == 10
        assert updated["notes"] == "Updated note"

        requests.delete(f"{API}/products-catalog/{pid}", headers=H(owner), timeout=TIMEOUT)


class TestBookingVisitWorkflow:
    def test_start_visit_from_booking(self):
        fo = login("fo@glowclinic.id")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=4)).strftime("%Y-%m-%d")
        rb = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Flow Patient {uuid.uuid4().hex[:6]}",
            "patient_phone": "081277766655",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T14:00:00",
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        assert rb.json()["status"] == "booked"

        rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo), timeout=TIMEOUT)
        assert rs.status_code == 200, rs.text
        body = rs.json()
        assert body["booking"]["status"] == "checked_in"
        assert body["booking"]["visit_id"]
        vid = body["visit"]["id"]
        assert body["visit"]["booking_id"] == bid
        assert body["visit"]["payment_status"] == "unpaid"

        v = requests.get(f"{API}/visits/{vid}", headers=H(fo), timeout=TIMEOUT)
        assert v.status_code == 200
        assert len(v.json().get("treatment_items") or []) == 0

        rp = requests.put(f"{API}/visits/{vid}/payment", headers=H(fo), json={
            "payment_status": "paid",
            "payment_method": "Cash",
            "amount_idr": 450000,
        }, timeout=TIMEOUT)
        assert rp.status_code == 200
        assert rp.json()["payment_status"] == "paid"

        requests.put(f"{API}/visits/{vid}/status", headers=H(fo), json={"status": "completed"}, timeout=TIMEOUT)
        b2 = requests.get(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT).json()
        assert b2["status"] == "completed"

        requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_starter_start_visit_no_emr_seed(self):
        """Starter plan: visit from booking is created but no treatment line items (EMR)."""
        fo = login("fo@cantikbeauty.id")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")
        rb = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Starter Flow {uuid.uuid4().hex[:6]}",
            "patient_phone": "081299988877",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T11:00:00",
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]

        rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo), timeout=TIMEOUT)
        assert rs.status_code == 200, rs.text
        vid = rs.json()["visit"]["id"]

        v = requests.get(f"{API}/visits/{vid}", headers=H(fo), timeout=TIMEOUT)
        assert v.status_code == 200
        assert len(v.json().get("treatment_items") or []) == 0

        requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestInvoiceWorkflow:
    def test_invoice_create_pay_and_idempotent(self):
        fo = login("fo@glowclinic.id")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=6)).strftime("%Y-%m-%d")
        rb = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Invoice Patient {uuid.uuid4().hex[:6]}",
            "patient_phone": "081288877766",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T15:00:00",
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo), timeout=TIMEOUT)
        assert rs.status_code == 200, rs.text
        vid = rs.json()["visit"]["id"]

        r1 = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        inv = r1.json()
        assert inv["invoice_number"].startswith("INV-")
        assert inv["visit_id"] == vid
        iid = inv["id"]

        r2 = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT)
        assert r2.status_code == 200
        assert r2.json()["id"] == iid

        r3 = requests.put(f"{API}/invoices/{iid}", headers=H(fo), json={
            "items": [{"item_type": "custom", "name": "Consult fee", "unit_price_idr": 200000, "quantity": 1}],
            "discount_type": "percentage",
            "discount_value": 10,
            "discount_reason": "Staff discount test",
        }, timeout=TIMEOUT)
        assert r3.status_code == 200, r3.text
        assert r3.json()["subtotal"] == 200000
        assert r3.json()["discount_amount"] == 20000
        assert r3.json()["total_amount"] == 180000
        assert r3.json()["payment_status"] == "unpaid"

        r4 = requests.put(f"{API}/invoices/{iid}/payment", headers=H(fo), json={
            "mark_paid": True,
            "payment_method": "cash",
        }, timeout=TIMEOUT)
        assert r4.status_code == 200, r4.text
        assert r4.json()["payment_status"] == "paid"
        assert r4.json()["amount_paid"] == 180000

        v = requests.get(f"{API}/visits/{vid}", headers=H(fo), timeout=TIMEOUT).json()
        assert v.get("payment_status") == "paid"

        requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_invoice_item_performer_fields(self):
        fo = login("fo@glowclinic.id")
        owner = login("owner@glowclinic.id")
        users = requests.get(f"{API}/users", headers=H(owner), timeout=TIMEOUT).json()
        doctor = next(u for u in users if u.get("role") == "doctor")
        therapist = next(u for u in users if u.get("role") == "therapist")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")

        rb = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Performer Inv {uuid.uuid4().hex[:6]}",
            "patient_phone": "081299988877",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T16:00:00",
            "performer_id": doctor["id"],
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        vid = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo), timeout=TIMEOUT).json()["visit"]["id"]

        inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT).json()
        assert inv["default_performer"]["performer_id"] == doctor["id"]
        assert inv["default_performer"]["performer_name_snapshot"] == doctor["name"]
        iid = inv["id"]

        treatments = requests.get(f"{API}/treatments-catalog", headers=H(fo), timeout=TIMEOUT).json()
        trow = next((x for x in treatments if int(x.get("price_idr") or 0) > 0), None)
        assert trow is not None

        added = requests.post(f"{API}/invoices/{iid}/items/catalog", headers=H(fo), json={
            "item_type": "treatment",
            "catalog_id": trow["id"] or trow.get("key"),
            "quantity": 1,
        }, timeout=TIMEOUT)
        assert added.status_code == 200, added.text
        line = added.json()["items"][0]
        assert line["performer_id"] == doctor["id"]
        assert line["performer_name_snapshot"] == doctor["name"]
        assert line["performer_role_snapshot"] == "doctor"

        override = requests.post(f"{API}/invoices/{iid}/items/catalog", headers=H(fo), json={
            "item_type": "treatment",
            "catalog_id": trow["id"] or trow.get("key"),
            "quantity": 1,
            "performer_id": therapist["id"],
        }, timeout=TIMEOUT)
        assert override.status_code == 200, override.text
        therapist_line = next(it for it in override.json()["items"] if it.get("performer_id") == therapist["id"])
        assert therapist_line["performer_name_snapshot"] == therapist["name"]
        assert therapist_line["performer_role_snapshot"] == "therapist"

        fail = requests.put(f"{API}/invoices/{iid}", headers=H(fo), json={
            "items": [{
                "item_type": "treatment",
                "name": "Manual treatment",
                "unit_price_idr": 100000,
                "quantity": 1,
            }],
        }, timeout=TIMEOUT)
        assert fail.status_code == 400
        assert "performer" in fail.json().get("detail", "").lower()

        ok = requests.put(f"{API}/invoices/{iid}", headers=H(fo), json={
            "items": [{
                "item_type": "custom",
                "name": "Retail product",
                "unit_price_idr": 50000,
                "quantity": 1,
            }],
        }, timeout=TIMEOUT)
        assert ok.status_code == 200, ok.text
        custom = ok.json()["items"][0]
        assert custom.get("performer_id") in (None, "")
        assert not custom.get("performer_name_snapshot")

        requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)


class TestCommissionWorkflow:
    def test_commission_rule_match_approve_payout(self):
        manager = login("manager@glowclinic.id")
        fo = login("fo@glowclinic.id")
        owner = login("owner@glowclinic.id")
        users = requests.get(f"{API}/users", headers=H(owner), timeout=TIMEOUT).json()
        doctor = next(u for u in users if u.get("role") == "doctor")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=8)).strftime("%Y-%m-%d")

        rule = requests.post(f"{API}/commission-rules", headers=H(manager), json={
            "rule_name": f"Test 10% {uuid.uuid4().hex[:6]}",
            "is_active": True,
            "priority": 10,
            "applies_to_item_type": "treatment",
            "commission_type": "percentage",
            "commission_value": 10,
            "calculation_basis": "paid",
            "trigger": "invoice_paid",
        }, timeout=TIMEOUT)
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]

        rb = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Comm Patient {uuid.uuid4().hex[:6]}",
            "patient_phone": "081277766655",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T11:00:00",
            "performer_id": doctor["id"],
        }, timeout=TIMEOUT)
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        vid = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo), timeout=TIMEOUT).json()["visit"]["id"]
        inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT).json()
        iid = inv["id"]

        treatments = requests.get(f"{API}/treatments-catalog", headers=H(fo), timeout=TIMEOUT).json()
        trow = next((x for x in treatments if int(x.get("price_idr") or 0) > 0), None)
        assert trow is not None

        added = requests.post(f"{API}/invoices/{iid}/items/catalog", headers=H(fo), json={
            "item_type": "treatment",
            "catalog_id": trow["id"] or trow.get("key"),
            "quantity": 1,
        }, timeout=TIMEOUT)
        assert added.status_code == 200, added.text
        line_total = added.json()["items"][0]["line_total_idr"]

        pending = requests.get(f"{API}/commission-records", headers=H(manager), timeout=TIMEOUT).json()
        rec = next((r for r in pending if r.get("invoice_id") == iid), None)
        assert rec is not None, "commission record should exist after item added"
        assert rec["status"] == "pending"
        assert rec["staff_id"] == doctor["id"]
        rec_id = rec["id"]

        paid = requests.put(f"{API}/invoices/{iid}/payment", headers=H(fo), json={
            "mark_paid": True,
            "payment_method": "cash",
        }, timeout=TIMEOUT)
        assert paid.status_code == 200, paid.text

        earned_rows = requests.get(
            f"{API}/commission-records",
            headers=H(manager),
            params={"status": "earned"},
            timeout=TIMEOUT,
        ).json()
        earned = next((r for r in earned_rows if r["id"] == rec_id), None)
        assert earned is not None
        assert earned["commission_amount"] == int(round(line_total * 0.10))

        appr = requests.post(f"{API}/commission-records/approve", headers=H(manager), json={
            "record_ids": [rec_id],
        }, timeout=TIMEOUT)
        assert appr.status_code == 200, appr.text
        assert appr.json()["approved"] == 1

        payout = requests.post(f"{API}/commission-records/paid-out", headers=H(manager), json={
            "record_ids": [rec_id],
        }, timeout=TIMEOUT)
        assert payout.status_code == 200, payout.text
        assert payout.json()["paid_out"] == 1

        final = requests.get(f"{API}/commission-records", headers=H(manager), params={"status": "paid_out"}, timeout=TIMEOUT).json()
        assert any(r["id"] == rec_id for r in final)

        requests.delete(f"{API}/commission-rules/{rule_id}", headers=H(manager), timeout=TIMEOUT)
        requests.delete(f"{API}/bookings/{bid}", headers=H(fo), timeout=TIMEOUT)

    def test_fo_cannot_access_commission_rules(self):
        fo = login("fo@glowclinic.id")
        r = requests.get(f"{API}/commission-rules", headers=H(fo), timeout=TIMEOUT)
        assert r.status_code == 403

    def test_default_treatment_commission_therapist_on_paid_invoice(self):
        """Default seeded rule: therapist + treatment, 10% net, invoice_paid."""
        manager = login("owner@glowclinic.id")
        fo = login("fo@glowclinic.id")
        owner = login("owner@glowclinic.id")

        rules = requests.get(f"{API}/commission-rules", headers=H(manager), timeout=TIMEOUT).json()
        default_rule = next((r for r in rules if r.get("rule_name") == "Default Treatment Commission"), None)
        assert default_rule is not None, "Default Treatment Commission rule should be seeded"
        assert default_rule["applies_to_item_type"] == "treatment"
        assert default_rule["applies_to_role"] == "therapist"
        assert default_rule["commission_type"] == "percentage"
        assert float(default_rule["commission_value"]) == 10
        assert default_rule["calculation_basis"] == "net"
        assert default_rule["trigger"] == "invoice_paid"
        assert default_rule["is_active"] is True
        assert int(default_rule.get("priority") or 0) == 999

        users = requests.get(f"{API}/users", headers=H(owner), timeout=TIMEOUT).json()
        therapist = next(u for u in users if u.get("role") == "therapist")

        tag = uuid.uuid4().hex[:6]
        patient = requests.post(f"{API}/patients", headers=H(fo), json={
            "full_name": f"Default Comm {tag}",
            "phone": f"0812{tag}",
        }, timeout=TIMEOUT)
        assert patient.status_code == 200, patient.text
        pid = patient.json()["id"]

        visit = requests.post(f"{API}/visits", headers=H(fo), json={
            "patient_id": pid,
            "visit_type": "therapist",
            "assigned_to": therapist["id"],
            "chief_complaint": "Default commission test",
        }, timeout=TIMEOUT)
        assert visit.status_code == 200, visit.text
        vid = visit.json()["id"]
        inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT).json()
        iid = inv["id"]

        treatments = requests.get(f"{API}/treatments-catalog", headers=H(fo), timeout=TIMEOUT).json()
        trow = next((x for x in treatments if int(x.get("price_idr") or 0) > 0), None)
        assert trow is not None

        added = requests.post(f"{API}/invoices/{iid}/items/catalog", headers=H(fo), json={
            "item_type": "treatment",
            "catalog_id": trow["id"] or trow.get("key"),
            "quantity": 1,
            "performer_id": therapist["id"],
        }, timeout=TIMEOUT)
        assert added.status_code == 200, added.text
        line = added.json()["items"][-1]
        assert line.get("performer_id") == therapist["id"]
        net_amount = int(line.get("line_total_idr") or 0)

        pending = requests.get(
            f"{API}/commission-records",
            headers=H(manager),
            params={"staff_id": therapist["id"], "status": "pending"},
            timeout=TIMEOUT,
        ).json()
        rec = next((r for r in pending if r.get("invoice_id") == iid), None)
        assert rec is not None, "commission record should exist after treatment item with performer"
        assert rec["staff_id"] == therapist["id"]
        assert rec["commission_rule_name_snapshot"] == "Default Treatment Commission"
        rec_id = rec["id"]

        paid = requests.put(f"{API}/invoices/{iid}/payment", headers=H(fo), json={
            "mark_paid": True,
            "payment_method": "cash",
        }, timeout=TIMEOUT)
        assert paid.status_code == 200, paid.text

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        month_start = today[:8] + "01"
        profile_rows = requests.get(
            f"{API}/commission-records",
            headers=H(manager),
            params={
                "staff_id": therapist["id"],
                "from": month_start,
                "to": today,
                "date_basis": "earned_at",
                "status": "earned",
            },
            timeout=TIMEOUT,
        ).json()
        earned = next((r for r in profile_rows if r["id"] == rec_id), None)
        assert earned is not None, "earned commission should appear on therapist staff profile query"
        expected = int(round(net_amount * 0.10))
        assert earned["commission_amount"] == expected
        assert earned["status"] == "earned"

        requests.delete(f"{API}/patients/{pid}", headers=H(owner), timeout=TIMEOUT)


class TestCouponBooking:
    def test_validate_and_book_with_percent_coupon(self):
        owner = login("owner@glowclinic.id")
        fo = login("fo@glowclinic.id")
        code = f"TST{uuid.uuid4().hex[:8].upper()}"

        cr = requests.post(f"{API}/coupons", headers=H(owner), json={
            "code": code,
            "name": "Test 20% off",
            "discount_type": "percent",
            "discount_value": 20,
            "min_subtotal_idr": 0,
            "active": True,
        }, timeout=TIMEOUT)
        assert cr.status_code == 200, cr.text
        coupon_id = cr.json()["id"]

        treatments = requests.get(f"{API}/treatments-catalog", headers=H(fo), timeout=TIMEOUT).json()
        trow = next((x for x in treatments if int(x.get("price_idr") or 0) > 0), None)
        assert trow is not None, "need a priced treatment in catalog"
        subtotal = int(trow["price_idr"])
        expected_discount = int(subtotal * 20 / 100)

        vr = requests.post(f"{API}/bookings/validate-coupon", headers=H(fo), json={
            "code": code,
            "subtotal_idr": subtotal,
            "booking_type": "treatment",
            "treatment": trow["name"],
        }, timeout=TIMEOUT)
        assert vr.status_code == 200, vr.text
        vbody = vr.json()
        assert vbody["coupon_code"] == code
        assert vbody["discount_idr"] == expected_discount
        assert vbody["total_idr"] == subtotal - expected_discount

        tomorrow = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
        br = requests.post(f"{API}/bookings", headers=H(fo), json={
            "patient_name": f"Coupon Patient {uuid.uuid4().hex[:6]}",
            "patient_phone": "081299988877",
            "treatment": trow["name"],
            "duration_min": trow.get("duration_min") or 30,
            "scheduled_at": f"{tomorrow}T11:30:00",
            "coupon_code": code,
        }, timeout=TIMEOUT)
        assert br.status_code == 200, br.text
        booking = br.json()
        assert booking["coupon_code"] == code
        assert booking["subtotal_idr"] == subtotal
        assert booking["discount_idr"] == expected_discount
        assert booking["total_idr"] == subtotal - expected_discount

        coupons = requests.get(f"{API}/coupons", headers=H(owner), timeout=TIMEOUT).json()
        saved = next(c for c in coupons if c["id"] == coupon_id)
        assert saved["uses_count"] >= 1

        requests.delete(f"{API}/bookings/{booking['id']}", headers=H(fo), timeout=TIMEOUT)
        requests.delete(f"{API}/coupons/{coupon_id}", headers=H(owner), timeout=TIMEOUT)
