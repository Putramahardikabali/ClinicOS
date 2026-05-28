"""
Phase 6 feature regression tests (ClinicOS):
- 6a Operating Hours / Closed Days
- 6b Staff Scheduling (per-doctor/therapist working hours + days off)
- 6c Loyalty Tiers (configure + patient stats)
- 6d Revenue Monthly Reports

Clinic under test: Glow Aesthetic (slug=glowclinic), TZ Asia/Makassar (UTC+8).
Leaves state clean: restores default loyalty_tiers and clears doctor working_hours/days_off.
"""
import os
import requests
import pytest
from datetime import datetime, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://aesthetic-records.preview.emergentagent.com").rstrip("/")
SLUG = "glowclinic"

CREDS = {
    "owner": ("owner@glowclinic.id", "password123"),
    "manager": ("manager@glowclinic.id", "password123"),
    "fo": ("fo@glowclinic.id", "password123"),
    "doctor": ("doctor@glowclinic.id", "password123"),
    "therapist": ("therapist@glowclinic.id", "password123"),
}

DEFAULT_TIERS = [
    {"name": "Silver", "min_spend_idr": 10_000_000, "benefit": "5% off services", "color": "#9CA3AF"},
    {"name": "Gold", "min_spend_idr": 15_000_000, "benefit": "10% off + priority booking", "color": "#F59E0B"},
    {"name": "Platinum", "min_spend_idr": 30_000_000, "benefit": "15% off + VIP perks", "color": "#7C3AED"},
]


def login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {role: login(*c) for role, c in CREDS.items()}


@pytest.fixture(scope="module")
def doctor_id(tokens):
    r = requests.get(f"{BASE_URL}/api/users", headers=H(tokens["owner"]), timeout=15)
    r.raise_for_status()
    docs = [u for u in r.json() if u.get("role") == "doctor"]
    assert docs, "No doctor user in clinic"
    return docs[0]["id"]


@pytest.fixture(scope="module")
def all_doctor_ids(tokens):
    r = requests.get(f"{BASE_URL}/api/users", headers=H(tokens["owner"]), timeout=15)
    r.raise_for_status()
    return [u["id"] for u in r.json() if u.get("role") == "doctor"]


@pytest.fixture(scope="module")
def therapist_id(tokens):
    r = requests.get(f"{BASE_URL}/api/users", headers=H(tokens["owner"]), timeout=15)
    r.raise_for_status()
    th = [u for u in r.json() if u.get("role") == "therapist"]
    assert th, "No therapist user in clinic"
    return th[0]["id"]


def _next_weekday(weekday: int) -> str:
    """Return YYYY-MM-DD for next occurrence of given weekday (0=Mon)."""
    today = datetime.utcnow().date()
    delta = (weekday - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return (today + timedelta(days=delta)).isoformat()


# ============== 6a OPERATING HOURS / CLOSED DAYS =================
class TestOperatingHoursAndClosedDays:
    def test_fo_can_update_operating_hours_and_closed_dates(self, tokens):
        closed_date = (datetime.utcnow().date() + timedelta(days=21)).isoformat()
        payload = {
            "operating_hours": {
                "mon": {"open": "09:00", "close": "20:00"},
                "tue": {"open": "09:00", "close": "20:00"},
                "wed": {"open": "09:00", "close": "20:00"},
                "thu": {"open": "09:00", "close": "20:00"},
                "fri": {"open": "09:00", "close": "20:00"},
                "sat": {"open": "10:00", "close": "18:00"},
                "sun": {"open": "", "close": ""},
            },
            "closed_dates": [{"date": closed_date, "reason": "TEST_holiday"}],
        }
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["fo"]), json=payload, timeout=15)
        assert r.status_code == 200, f"FO PUT failed: {r.status_code} {r.text}"
        data = r.json()
        assert any(cd.get("date") == closed_date for cd in (data.get("closed_dates") or []))

    def test_fo_blocked_from_name_and_logo(self, tokens):
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["fo"]),
                         json={"name": "Hacked Name"}, timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        r2 = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["fo"]),
                          json={"logo_path": "/x.png"}, timeout=15)
        assert r2.status_code == 403

    def test_manager_blocked_from_name_but_can_edit_loyalty(self, tokens):
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["manager"]),
                         json={"name": "Hacked"}, timeout=15)
        assert r.status_code == 403
        # Manager can update loyalty_tiers
        r2 = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["manager"]),
                          json={"loyalty_tiers": DEFAULT_TIERS}, timeout=15)
        assert r2.status_code == 200, r2.text

    def test_public_availability_closed_date(self, tokens):
        closed_date = (datetime.utcnow().date() + timedelta(days=22)).isoformat()
        # Owner sets a closed date
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                         json={"closed_dates": [{"date": closed_date, "reason": "TEST_publichol"}]}, timeout=15)
        assert r.status_code == 200
        # Public availability for that date
        av = requests.get(f"{BASE_URL}/api/public/clinics/{SLUG}/availability",
                          params={"date": closed_date, "duration": 30}, timeout=15)
        assert av.status_code == 200
        body = av.json()
        assert body.get("closed") is True, f"Expected closed=true, got {body}"
        assert body.get("closed_reason"), "closed_reason missing"

    def test_booking_on_closed_date_returns_409(self, tokens):
        closed_date = (datetime.utcnow().date() + timedelta(days=22)).isoformat()
        # Ensure closed
        requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                     json={"closed_dates": [{"date": closed_date, "reason": "TEST_publichol"}]}, timeout=15)
        # Pick a treatment
        tr = requests.get(f"{BASE_URL}/api/treatments-catalog", headers=H(tokens["fo"]), timeout=15).json()
        assert tr and isinstance(tr, list), f"no treatments: {tr}"
        t = tr[0]
        # Try to create a booking on that date
        starts_at = f"{closed_date}T03:00:00+00:00"  # 11 AM Makassar
        # Get a patient
        pts = requests.get(f"{BASE_URL}/api/patients", headers=H(tokens["fo"]), timeout=15).json()
        if not pts:
            pytest.skip("No patients available")
        payload = {
            "patient_id": pts[0]["id"],
            "patient_name": pts[0].get("name") or "TEST_patient",
            "patient_phone": pts[0].get("phone") or "0800000000",
            "treatment": t["name"],
            "scheduled_at": starts_at,
            "duration_min": t.get("duration_min", 30),
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=H(tokens["fo"]), json=payload, timeout=15)
        assert r.status_code == 409, f"Expected 409, got {r.status_code} {r.text}"
        # Cleanup closed_dates
        requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                     json={"closed_dates": []}, timeout=15)


# ============== 6b STAFF SCHEDULE =================
class TestStaffSchedule:
    def test_fo_can_read_schedule(self, tokens, doctor_id):
        r = requests.get(f"{BASE_URL}/api/users/{doctor_id}/schedule", headers=H(tokens["fo"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "working_hours" in body and "days_off" in body

    def test_fo_cannot_write_schedule(self, tokens, doctor_id):
        r = requests.put(f"{BASE_URL}/api/users/{doctor_id}/schedule", headers=H(tokens["fo"]),
                         json={"working_hours": {}}, timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text}"

    def test_self_can_write_own_schedule(self, tokens, doctor_id):
        # doctor edits own schedule
        r = requests.put(f"{BASE_URL}/api/users/{doctor_id}/schedule", headers=H(tokens["doctor"]),
                         json={"working_hours": {"mon": {"open": "09:00", "close": "13:00"}}}, timeout=15)
        assert r.status_code == 200, r.text

    def test_doctor_restricted_hours_limit_availability(self, tokens, all_doctor_ids):
        # Owner sets Mon-Fri 09-13, Sat/Sun empty on ALL doctors so we can prove restriction
        wh = {
            "mon": {"open": "09:00", "close": "13:00"},
            "tue": {"open": "09:00", "close": "13:00"},
            "wed": {"open": "09:00", "close": "13:00"},
            "thu": {"open": "09:00", "close": "13:00"},
            "fri": {"open": "09:00", "close": "13:00"},
            "sat": {"open": "", "close": ""},
            "sun": {"open": "", "close": ""},
        }
        for did in all_doctor_ids:
            r = requests.put(f"{BASE_URL}/api/users/{did}/schedule", headers=H(tokens["owner"]),
                             json={"working_hours": wh, "days_off": []}, timeout=15)
            assert r.status_code == 200

        tr = requests.get(f"{BASE_URL}/api/treatments-catalog", headers=H(tokens["fo"]), timeout=15).json()
        doc_tx = next((t for t in tr if t.get("performer_type") == "doctor"), None)
        assert doc_tx, "No doctor-type treatment configured"

        mon = _next_weekday(0)
        sat = _next_weekday(5)

        av_mon = requests.get(
            f"{BASE_URL}/api/public/clinics/{SLUG}/availability",
            params={"date": mon, "duration": 30, "treatment": doc_tx["name"]}, timeout=15
        ).json()
        slots_mon = av_mon.get("slots") or []
        # Use `available` flag and `label` field (HH:MM)
        avail_times = [s["label"] for s in slots_mon if s.get("available")]
        assert avail_times, f"No available Monday doctor slots: {av_mon}"
        max_time = max(avail_times)
        assert max_time <= "12:30", f"Doctor slots leak past 13:00 close: max={max_time}, all={avail_times}"
        assert "09:00" in avail_times, f"09:00 not present in Mon doctor slots: {avail_times}"

        # Saturday must yield zero available doctor slots
        av_sat = requests.get(
            f"{BASE_URL}/api/public/clinics/{SLUG}/availability",
            params={"date": sat, "duration": 30, "treatment": doc_tx["name"]}, timeout=15
        ).json()
        sat_slots = av_sat.get("slots") or []
        sat_avail = [s for s in sat_slots if s.get("available")]
        assert len(sat_avail) == 0, f"Doctor has Sat available slots but should be off: {sat_avail[:3]}"

    def test_doctor_days_off_blocks_date(self, tokens, all_doctor_ids):
        mon = _next_weekday(0)
        # Set days_off for that Monday on all doctors (keep Mon-Fri hours)
        wh = {
            "mon": {"open": "09:00", "close": "13:00"},
            "tue": {"open": "09:00", "close": "13:00"},
            "wed": {"open": "09:00", "close": "13:00"},
            "thu": {"open": "09:00", "close": "13:00"},
            "fri": {"open": "09:00", "close": "13:00"},
        }
        for did in all_doctor_ids:
            r = requests.put(f"{BASE_URL}/api/users/{did}/schedule", headers=H(tokens["owner"]),
                             json={"working_hours": wh, "days_off": [{"date": mon, "reason": "TEST_off"}]}, timeout=15)
            assert r.status_code == 200
        # Doctor treatment availability on that Monday should be 0
        tr = requests.get(f"{BASE_URL}/api/treatments-catalog", headers=H(tokens["fo"]), timeout=15).json()
        doc_tx = next((t for t in tr if t.get("performer_type") == "doctor"), None)
        av = requests.get(
            f"{BASE_URL}/api/public/clinics/{SLUG}/availability",
            params={"date": mon, "duration": 30, "treatment": doc_tx["name"]}, timeout=15
        ).json()
        slots = [s for s in (av.get("slots") or []) if s.get("available")]
        assert len(slots) == 0, f"Expected 0 doctor slots on day-off Mon, got {len(slots)}"

    def test_therapist_unaffected_by_doctor_schedule(self, tokens):
        sat = _next_weekday(5)
        tr = requests.get(f"{BASE_URL}/api/treatments-catalog", headers=H(tokens["fo"]), timeout=15).json()
        th_tx = next((t for t in tr if t.get("performer_type") == "therapist"), None)
        if not th_tx:
            pytest.skip("No therapist treatment configured")
        av = requests.get(
            f"{BASE_URL}/api/public/clinics/{SLUG}/availability",
            params={"date": sat, "duration": 30, "treatment": th_tx["name"]}, timeout=15
        ).json()
        slots = [s for s in (av.get("slots") or []) if s.get("available")]
        assert slots, f"Therapist should have slots on Sat regardless of doctor schedule: {av}"


# ============== 6c LOYALTY =================
class TestLoyalty:
    def test_fo_blocked_from_loyalty_update(self, tokens):
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["fo"]),
                         json={"loyalty_tiers": DEFAULT_TIERS}, timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text}"

    def test_owner_can_update_loyalty(self, tokens):
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                         json={"loyalty_tiers": DEFAULT_TIERS}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        names = [t["name"] for t in (body.get("loyalty_tiers") or [])]
        assert names == ["Silver", "Gold", "Platinum"], f"Tiers not sorted/applied: {names}"

    def test_invalid_loyalty_returns_400(self, tokens):
        # Missing name
        r = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                         json={"loyalty_tiers": [{"min_spend_idr": 1000, "name": ""}]}, timeout=15)
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"
        # Negative spend
        r2 = requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                          json={"loyalty_tiers": [{"name": "X", "min_spend_idr": -10}]}, timeout=15)
        assert r2.status_code == 400

    def test_patient_stats_includes_loyalty_fields(self, tokens):
        pts = requests.get(f"{BASE_URL}/api/patients", headers=H(tokens["owner"]), timeout=15).json()
        if not pts:
            pytest.skip("No patients available")
        # Try first 5 to find one with stats
        for p in pts[:5]:
            r = requests.get(f"{BASE_URL}/api/patients/{p['id']}/stats", headers=H(tokens["owner"]), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert "loyalty_tier" in body and "next_tier" in body, f"Missing loyalty fields in stats: {body.keys()}"
            return
        pytest.skip("No patient stats available")


# ============== 6d REVENUE MONTHLY =================
class TestRevenueMonthly:
    def test_owner_can_view_revenue(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/revenue-monthly", params={"months": 12},
                         headers=H(tokens["owner"]), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "months" in body and "total_revenue" in body and "average_monthly" in body
        assert isinstance(body["months"], list) and len(body["months"]) == 12
        for m in body["months"]:
            assert "month" in m and "revenue" in m and "items" in m

    def test_manager_can_view_revenue(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/revenue-monthly", params={"months": 6},
                         headers=H(tokens["manager"]), timeout=15)
        assert r.status_code == 200
        assert len(r.json()["months"]) == 6

    def test_fo_blocked_from_revenue(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/revenue-monthly", headers=H(tokens["fo"]), timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text}"


# ============== CLEANUP =================
def test_zzz_cleanup_state(tokens, all_doctor_ids):
    """Restore default loyalty tiers and clear ALL doctor schedules."""
    requests.put(f"{BASE_URL}/api/clinics/me", headers=H(tokens["owner"]),
                 json={"loyalty_tiers": DEFAULT_TIERS, "closed_dates": []}, timeout=15)
    for did in all_doctor_ids:
        requests.put(f"{BASE_URL}/api/users/{did}/schedule", headers=H(tokens["owner"]),
                     json={"working_hours": {}, "days_off": []}, timeout=15)
