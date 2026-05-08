"""Body Lab Bali EMR - Backend integration tests."""
import io
import os
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://aesthetic-records.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "super_admin": ("admin@bodylab.id", "password123"),
    "doctor": ("doctor@bodylab.id", "password123"),
    "therapist": ("therapist@bodylab.id", "password123"),
    "fo": ("fo@bodylab.id", "password123"),
    "manager": ("manager@bodylab.id", "password123"),
}


def login(role):
    email, pw = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def tokens():
    return {role: login(role) for role in CREDS}


# ---------------- Auth ----------------
class TestAuth:
    def test_all_roles_login(self):
        for role, (email, pw) in CREDS.items():
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
            assert r.status_code == 200, f"{role}: {r.text}"
            data = r.json()
            assert "token" in data
            assert data["user"]["email"] == email
            assert data["user"]["role"] == role

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@bodylab.id", "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=H(tokens["doctor"]), timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == "doctor@bodylab.id"

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_logout(self, tokens):
        r = requests.post(f"{API}/auth/logout", headers=H(tokens["manager"]), timeout=30)
        assert r.status_code == 200


# ---------------- RBAC ----------------
class TestRBAC:
    def test_doctor_cannot_create_patient(self, tokens):
        r = requests.post(f"{API}/patients", headers=H(tokens["doctor"]),
                          json={"full_name": "TEST_should_fail"}, timeout=30)
        assert r.status_code == 403

    def test_therapist_cannot_create_patient(self, tokens):
        r = requests.post(f"{API}/patients", headers=H(tokens["therapist"]),
                          json={"full_name": "TEST_should_fail"}, timeout=30)
        assert r.status_code == 403

    def test_manager_cannot_create_patient(self, tokens):
        r = requests.post(f"{API}/patients", headers=H(tokens["manager"]),
                          json={"full_name": "TEST_should_fail"}, timeout=30)
        assert r.status_code == 403

    def test_doctor_cannot_view_audit(self, tokens):
        r = requests.get(f"{API}/audit-logs", headers=H(tokens["doctor"]), timeout=30)
        assert r.status_code == 403

    def test_manager_can_view_audit(self, tokens):
        r = requests.get(f"{API}/audit-logs", headers=H(tokens["manager"]), timeout=30)
        assert r.status_code == 200

    def test_therapist_cannot_edit_clinical(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["therapist"]),
                         json={"diagnosis": "TEST"}, timeout=30)
        assert r.status_code == 403

    def test_fo_cannot_edit_clinical(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["fo"]),
                         json={"diagnosis": "TEST"}, timeout=30)
        assert r.status_code == 403


# ---------------- Patient + Visit fixture ----------------
@pytest.fixture(scope="session")
def patient_visit(tokens):
    fo = tokens["fo"]
    r = requests.post(f"{API}/patients", headers=H(fo),
                      json={"full_name": "TEST_Pasien Coba", "gender": "Female",
                            "phone": "081234567890", "email": "test_pasien@example.com"}, timeout=30)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    r = requests.post(f"{API}/visits", headers=H(fo),
                      json={"patient_id": pid, "visit_type": "doctor", "chief_complaint": "TEST visit"}, timeout=30)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    return {"patient_id": pid, "visit_id": vid}


# ---------------- Patients ----------------
class TestPatients:
    def test_list_patients(self, tokens):
        r = requests.get(f"{API}/patients", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_search_patients(self, tokens, patient_visit):
        r = requests.get(f"{API}/patients?q=TEST_Pasien", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 200
        assert any("TEST_Pasien" in p["full_name"] for p in r.json())

    def test_get_patient(self, tokens, patient_visit):
        r = requests.get(f"{API}/patients/{patient_visit['patient_id']}", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == patient_visit["patient_id"]

    def test_update_patient(self, tokens, patient_visit):
        r = requests.put(f"{API}/patients/{patient_visit['patient_id']}", headers=H(tokens["fo"]),
                         json={"full_name": "TEST_Pasien Coba", "notes": "updated"}, timeout=30)
        assert r.status_code == 200
        # verify
        r2 = requests.get(f"{API}/patients/{patient_visit['patient_id']}", headers=H(tokens["fo"]), timeout=30)
        assert r2.json()["notes"] == "updated"

    def test_get_patient_404(self, tokens):
        r = requests.get(f"{API}/patients/nonexistent", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 404


# ---------------- Visits ----------------
class TestVisits:
    def test_list_visits(self, tokens):
        r = requests.get(f"{API}/visits", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_visit_enriched(self, tokens, patient_visit):
        r = requests.get(f"{API}/visits/{patient_visit['visit_id']}", headers=H(tokens["doctor"]), timeout=30)
        assert r.status_code == 200
        v = r.json()
        for k in ("patient", "clinical_record", "therapist_record", "treatment_items", "photos", "mappings", "billing"):
            assert k in v


# ---------------- Clinical record ----------------
class TestClinical:
    def test_save_then_submit_doctor(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        # save (no submit)
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["doctor"]),
                         json={"diagnosis": "TEST diag",
                               "assessment": {"skin_quality": {"thickness": "Thin", "hydration": "Dry"}}},
                         timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["diagnosis"] == "TEST diag"
        assert body["assessment"]["skin_quality"]["thickness"] == "Thin"
        # submit
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["doctor"]),
                         json={"diagnosis": "TEST final", "assessment": {}, "submit": True}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("submitted") is True
        # visit status submitted
        v = requests.get(f"{API}/visits/{vid}", headers=H(tokens["doctor"]), timeout=30).json()
        assert v["status"] == "submitted"

    def test_doctor_cannot_edit_after_submit(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["doctor"]),
                         json={"diagnosis": "TEST again"}, timeout=30)
        assert r.status_code == 403

    def test_super_admin_can_edit_after_submit(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["super_admin"]),
                         json={"diagnosis": "TEST admin edit"}, timeout=30)
        assert r.status_code == 200


# ---------------- Therapist (separate visit) ----------------
@pytest.fixture(scope="session")
def therapist_visit(tokens):
    fo = tokens["fo"]
    r = requests.post(f"{API}/patients", headers=H(fo),
                      json={"full_name": "TEST_Therapy Patient"}, timeout=30)
    pid = r.json()["id"]
    r = requests.post(f"{API}/visits", headers=H(fo),
                      json={"patient_id": pid, "visit_type": "therapist"}, timeout=30)
    return {"patient_id": pid, "visit_id": r.json()["id"]}


class TestTherapist:
    def test_save_and_submit(self, tokens, therapist_visit):
        vid = therapist_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/therapist", headers=H(tokens["therapist"]),
                         json={"contraindication": ["pregnancy"], "device_used": "RF",
                               "treatment_parameter": "10W", "intensity": "med",
                               "duration": "30min", "submit": True}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("submitted") is True

    def test_therapist_cannot_edit_after_submit(self, tokens, therapist_visit):
        vid = therapist_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/therapist", headers=H(tokens["therapist"]),
                         json={"device_used": "X"}, timeout=30)
        assert r.status_code == 403


# ---------------- Treatments ----------------
class TestTreatments:
    def test_add_and_delete(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        r = requests.post(f"{API}/visits/{vid}/treatments", headers=H(tokens["doctor"]),
                          json={"category": "facial", "name": "TEST_Hydra", "quantity": 1, "price": 500000}, timeout=30)
        assert r.status_code == 200
        iid = r.json()["id"]
        # verify in visit
        v = requests.get(f"{API}/visits/{vid}", headers=H(tokens["fo"]), timeout=30).json()
        assert any(t["id"] == iid for t in v["treatment_items"])
        # delete
        r = requests.delete(f"{API}/visits/{vid}/treatments/{iid}", headers=H(tokens["doctor"]), timeout=30)
        assert r.status_code == 200


# ---------------- Photos ----------------
PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


class TestPhotos:
    def test_upload_and_serve(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        files = {"file": ("t.png", io.BytesIO(PNG_1x1), "image/png")}
        data = {"photo_type": "before", "angle": "front", "notes": "TEST"}
        r = requests.post(f"{API}/visits/{vid}/photos", headers=H(tokens["fo"]),
                          files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        rec = r.json()
        path = rec["storage_path"]
        # serve via query auth
        r2 = requests.get(f"{API}/files/{path}?auth={tokens['fo']}", timeout=30)
        assert r2.status_code == 200
        assert len(r2.content) > 0
        # auth required
        r3 = requests.get(f"{API}/files/{path}", timeout=30)
        assert r3.status_code == 401


# ---------------- Mappings ----------------
class TestMapping:
    def test_save(self, tokens, patient_visit):
        vid = patient_visit["visit_id"]
        b64 = "data:image/png;base64," + base64.b64encode(PNG_1x1).decode()
        r = requests.post(f"{API}/visits/{vid}/mappings", headers=H(tokens["doctor"]),
                          json={"map_type": "face", "image_data": b64, "raw_json": {"strokes": []}}, timeout=30)
        assert r.status_code == 200
        assert r.json()["map_type"] == "face"


# ---------------- Billing ----------------
@pytest.fixture(scope="session")
def billing_visit(tokens):
    fo = tokens["fo"]
    r = requests.post(f"{API}/patients", headers=H(fo), json={"full_name": "TEST_Billing P"}, timeout=30)
    pid = r.json()["id"]
    r = requests.post(f"{API}/visits", headers=H(fo), json={"patient_id": pid, "visit_type": "doctor"}, timeout=30)
    vid = r.json()["id"]
    # submit clinical to move status to submitted
    requests.put(f"{API}/visits/{vid}/clinical", headers=H(tokens["doctor"]),
                 json={"diagnosis": "TEST", "submit": True}, timeout=30)
    return {"patient_id": pid, "visit_id": vid}


class TestBilling:
    def test_pending_billing_includes_visit(self, tokens, billing_visit):
        r = requests.get(f"{API}/visits/pending-billing", headers=H(tokens["fo"]), timeout=30)
        assert r.status_code == 200
        ids = [v["id"] for v in r.json()]
        assert billing_visit["visit_id"] in ids

    def test_billing_calculation_and_paid_status(self, tokens, billing_visit):
        vid = billing_visit["visit_id"]
        r = requests.put(f"{API}/visits/{vid}/billing", headers=H(tokens["fo"]),
                         json={"items": [{"name": "Facial", "qty": 2, "price": 500000, "discount": 0}],
                               "discount": 100000, "payment_method": "cash", "payment_status": "paid"},
                         timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["subtotal"] == 1000000
        assert b["total"] == 900000
        # visit status should be billed
        v = requests.get(f"{API}/visits/{vid}", headers=H(tokens["fo"]), timeout=30).json()
        assert v["status"] == "billed"

    def test_doctor_cannot_bill(self, tokens, billing_visit):
        r = requests.put(f"{API}/visits/{billing_visit['visit_id']}/billing", headers=H(tokens["doctor"]),
                         json={"items": [], "discount": 0, "payment_status": "unpaid"}, timeout=30)
        assert r.status_code == 403


# ---------------- Timeline / Stats ----------------
class TestMisc:
    def test_timeline(self, tokens, patient_visit):
        r = requests.get(f"{API}/patients/{patient_visit['patient_id']}/timeline",
                         headers=H(tokens["doctor"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_stats(self, tokens):
        r = requests.get(f"{API}/stats", headers=H(tokens["manager"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_patients", "total_visits", "pending_billing", "in_progress", "billed", "visits_today"):
            assert k in d
