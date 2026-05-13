"""Phase 3 & 4 — Public booking + FO booking mgmt + WA + Owner dashboard tests."""
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


# --------------- Public endpoints (no auth) ---------------
class TestPublicTreatments:
    def test_get_treatments_returns_clinic_and_treatments(self):
        r = requests.get(f"{API}/public/clinics/cantikbeauty/treatments", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "clinic" in data and "treatments" in data
        assert data["clinic"]["slug"] == "cantikbeauty"
        assert isinstance(data["treatments"], list) and len(data["treatments"]) >= 8
        keys = {t["key"] for t in data["treatments"]}
        assert "consult" in keys

    def test_unknown_slug_404(self):
        r = requests.get(f"{API}/public/clinics/unknown-xyz/treatments", timeout=TIMEOUT)
        assert r.status_code == 404


class TestPublicAvailability:
    def test_availability_30min_grid(self):
        date_str = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/public/clinics/cantikbeauty/availability",
                         params={"date": date_str, "duration": 30}, timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["date"] == date_str
        assert "slots" in data
        if not data.get("closed"):
            assert len(data["slots"]) > 0
            slot0 = data["slots"][0]
            assert "time" in slot0 and "label" in slot0 and "available" in slot0

    def test_availability_invalid_date_400(self):
        r = requests.get(f"{API}/public/clinics/cantikbeauty/availability",
                         params={"date": "not-a-date", "duration": 30}, timeout=TIMEOUT)
        assert r.status_code == 400


class TestPublicCreateBooking:
    def test_create_booking_in_past_400(self):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        r = requests.post(f"{API}/public/clinics/cantikbeauty/bookings", json={
            "patient_name": "TEST Past",
            "patient_phone": "+628111000111",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": past,
        }, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_create_booking_and_conflict_409(self):
        # pick a far-future weekday slot at 11:00
        sched = future_iso(days_ahead=14, hour=14, minute=0)
        payload = {
            "patient_name": f"TEST_Public_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628111222333",
            "patient_email": "test@example.com",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
        }
        r1 = requests.post(f"{API}/public/clinics/cantikbeauty/bookings", json=payload, timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        b = r1.json()
        assert b["status"] == "booked"
        assert b["source"] == "public"
        assert b["scheduled_at"] == sched
        assert "id" in b
        # Conflict on same slot
        payload2 = {**payload, "patient_name": "TEST Conflict"}
        r2 = requests.post(f"{API}/public/clinics/cantikbeauty/bookings", json=payload2, timeout=TIMEOUT)
        assert r2.status_code == 409


# --------------- Authentication required ---------------
class TestAuthRequired:
    @pytest.mark.parametrize("path", [
        "/bookings",
        "/wa-templates",
        "/treatments-catalog",
        "/dashboard/owner",
    ])
    def test_unauth_401(self, path):
        r = requests.get(f"{API}{path}", timeout=TIMEOUT)
        assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


# --------------- FO Booking management ---------------
class TestFOBookings:
    def test_list_bookings_scoped(self):
        t_cantik = login("owner@cantikbeauty.id")
        r = requests.get(f"{API}/bookings", headers=H(t_cantik), timeout=TIMEOUT)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # All items belong to cantikbeauty clinic_id
        if items:
            cids = {i["clinic_id"] for i in items}
            assert len(cids) == 1

    def test_create_manual_fo_booking_and_status_flow(self):
        token = login("owner@cantikbeauty.id")
        sched = future_iso(days_ahead=21, hour=15, minute=30)
        # Create
        r = requests.post(f"{API}/bookings", headers=H(token), json={
            "patient_name": f"TEST_FO_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628999000111",
            "treatment": "Signature Facial",
            "duration_min": 60,
            "scheduled_at": sched,
            "notes": "fo created",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["source"] == "fo"
        assert b["status"] == "booked"
        bid = b["id"]

        # Invalid status -> 400
        r_bad = requests.put(f"{API}/bookings/{bid}/status", headers=H(token),
                             json={"status": "bogus"}, timeout=TIMEOUT)
        assert r_bad.status_code == 400

        # Status flow booked -> confirmed -> checked_in -> completed
        for s in ["confirmed", "checked_in", "completed"]:
            r_s = requests.put(f"{API}/bookings/{bid}/status", headers=H(token),
                               json={"status": s}, timeout=TIMEOUT)
            assert r_s.status_code == 200, r_s.text
            # GET to verify persistence
            r_g = requests.get(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)
            assert r_g.status_code == 200
            assert r_g.json()["status"] == s

    def test_wa_sent_persists_history(self):
        token = login("owner@cantikbeauty.id")
        sched = future_iso(days_ahead=25, hour=10, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(token), json={
            "patient_name": f"TEST_WA_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628999111222",
            "treatment": "Consultation",
            "duration_min": 30,
            "scheduled_at": sched,
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # Mark WA sent
        r_wa = requests.post(f"{API}/bookings/{bid}/wa-sent", headers=H(token),
                             json={"template_key": "confirmation"}, timeout=TIMEOUT)
        assert r_wa.status_code == 200
        body = r_wa.json()
        assert isinstance(body.get("wa_history"), list) and len(body["wa_history"]) >= 1
        assert body["wa_history"][-1]["template_key"] == "confirmation"
        # Verify GET shows history
        r_g = requests.get(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)
        assert r_g.json()["wa_history"][-1]["template_key"] == "confirmation"

    def test_cancel_booking(self):
        token = login("owner@cantikbeauty.id")
        sched = future_iso(days_ahead=30, hour=12, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(token), json={
            "patient_name": f"TEST_Cancel_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628999333444",
            "treatment": "Consultation",
            "scheduled_at": sched,
        }, timeout=TIMEOUT)
        bid = r.json()["id"]
        r_d = requests.delete(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)
        assert r_d.status_code == 200
        # Verify cancelled
        r_g = requests.get(f"{API}/bookings/{bid}", headers=H(token), timeout=TIMEOUT)
        assert r_g.json()["status"] == "cancelled"


# --------------- Multi-tenant isolation for bookings ---------------
class TestBookingTenantIsolation:
    def test_cantik_booking_not_visible_to_glow(self):
        t_cantik = login("owner@cantikbeauty.id")
        sched = future_iso(days_ahead=40, hour=11, minute=0)
        r = requests.post(f"{API}/bookings", headers=H(t_cantik), json={
            "patient_name": f"TEST_Iso_{uuid.uuid4().hex[:6]}",
            "patient_phone": "+628999555666",
            "treatment": "Consultation",
            "scheduled_at": sched,
        }, timeout=TIMEOUT)
        assert r.status_code == 200
        cantik_bid = r.json()["id"]
        # Glow owner should NOT see it
        t_glow = login("owner@glowclinic.id")
        r_g = requests.get(f"{API}/bookings/{cantik_bid}", headers=H(t_glow), timeout=TIMEOUT)
        assert r_g.status_code == 404
        # Also list should not contain it
        r_list = requests.get(f"{API}/bookings", headers=H(t_glow), timeout=TIMEOUT)
        ids = {b["id"] for b in r_list.json()}
        assert cantik_bid not in ids


# --------------- WA templates ---------------
class TestWaTemplates:
    def test_default_three_templates(self):
        token = login("owner@cantikbeauty.id")
        r = requests.get(f"{API}/wa-templates", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        keys = {t["key"] for t in data}
        assert {"confirmation", "reminder", "follow_up"}.issubset(keys)


# --------------- Treatments catalog (auth) ---------------
class TestTreatmentsCatalog:
    def test_auth_returns_catalog(self):
        token = login("owner@cantikbeauty.id")
        r = requests.get(f"{API}/treatments-catalog", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 8


# --------------- Owner dashboard ---------------
class TestOwnerDashboard:
    def test_owner_dashboard_keys(self):
        token = login("owner@cantikbeauty.id")
        r = requests.get(f"{API}/dashboard/owner", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        for k in ["bookings_today", "upcoming_bookings", "pending_confirm",
                  "revenue_mtd", "revenue_prev_month", "revenue_delta_pct",
                  "top_treatments", "total_patients", "visits_today",
                  "total_visits", "in_progress"]:
            assert k in d, f"missing dashboard key {k}"
        assert isinstance(d["top_treatments"], list)
        assert isinstance(d["bookings_today"], int)
