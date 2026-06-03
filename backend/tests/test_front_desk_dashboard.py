"""Front desk today dashboard — unit + integration tests."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
import requests

from front_desk_dashboard import (
    _map_display_status,
    can_access_front_desk,
    clinic_day_bounds,
)

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


# ---------- Unit tests (no API) ----------


class TestFrontDeskUnit:
    def test_map_display_status_cancelled(self):
        assert _map_display_status({"status": "cancelled"}, None) == "cancelled"

    def test_map_display_status_no_show(self):
        assert _map_display_status({"status": "no_show"}, None) == "no_show"

    def test_map_display_status_visit_in_progress(self):
        assert _map_display_status({"status": "checked_in"}, {"status": "in_progress"}) == "in_progress"

    def test_map_display_status_completed(self):
        assert _map_display_status({"status": "completed"}, {"status": "completed"}) == "completed"

    def test_can_access_fo_and_manager(self):
        assert can_access_front_desk({"role": "fo", "permissions": []}) == (True, False)
        assert can_access_front_desk({"role": "manager", "permissions": []}) == (True, False)

    def test_can_access_clinical_denied(self):
        for role in ("doctor", "therapist", "nurse"):
            assert can_access_front_desk({"role": role, "permissions": ["dashboard.view"]}) == (False, False)

    def test_can_access_accounting_read_only(self):
        user = {
            "role": "accounting",
            "permissions": ["accounting.view", "closing.view", "billing.view"],
        }
        assert can_access_front_desk(user) == (True, True)

    def test_clinic_day_bounds_uses_timezone(self):
        mock_now = MagicMock()
        mock_now.date.return_value = date(2026, 6, 1)
        with patch("front_desk_dashboard.ZoneInfo") as zone_ctor, patch("front_desk_dashboard.datetime") as dt:
            zone_ctor.return_value = MagicMock()
            dt.now.return_value = mock_now
            today, start, end, tz = clinic_day_bounds({"timezone": "Asia/Jakarta"})
        assert today == "2026-06-01"
        assert start == "2026-06-01T00:00:00"
        assert end == "2026-06-01T23:59:59"
        assert tz == "Asia/Jakarta"
        zone_ctor.assert_called_with("Asia/Jakarta")


# ---------- Integration tests (running API) ----------


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def fo_token():
    return login(FO_EMAIL)


def _dashboard(token, params=None):
    return requests.get(f"{API}/dashboard/front-desk/today", headers=H(token), params=params or {}, timeout=TIMEOUT)


def _closing_preview(token, day=None):
    params = {"date": day} if day else {}
    r = requests.get(f"{API}/closing/preview", headers=H(token), params=params, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _ensure_day_open(owner_token, day):
    preview = _closing_preview(owner_token, day)
    if preview.get("is_closed"):
        r = requests.post(
            f"{API}/closing/reopen",
            headers=H(owner_token),
            json={"date": day, "reason": "front desk dashboard test"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text


def _create_today_booking(token, day, hour, minute=0, **extra):
    payload = {
        "patient_name": f"FD QA {uuid.uuid4().hex[:6]}",
        "patient_phone": extra.pop("patient_phone", "081234567890"),
        "treatment": extra.pop("treatment", "Consultation"),
        "duration_min": 30,
        "scheduled_at": f"{day}T{hour:02d}:{minute:02d}:00",
        **extra,
    }
    r = requests.post(f"{API}/bookings", headers=H(token), json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _create_unpaid_invoice_today(token, day):
    rb = _create_today_booking(token, day, 15, 30)
    bid = rb["id"]
    rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(token), timeout=TIMEOUT)
    assert rs.status_code == 200, rs.text
    vid = rs.json()["visit"]["id"]
    inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(token), timeout=TIMEOUT)
    assert inv.status_code == 200, inv.text
    iid = inv.json()["id"]
    upd = requests.put(
        f"{API}/invoices/{iid}",
        headers=H(token),
        json={
            "items": [{
                "item_type": "custom",
                "name": "Service",
                "unit_price_idr": 150_000,
                "quantity": 1,
            }],
        },
        timeout=TIMEOUT,
    )
    assert upd.status_code == 200, upd.text
    return iid, bid


class TestFrontDeskDashboardIntegration:
    def test_fo_can_access_dashboard(self, fo_token):
        r = _dashboard(fo_token)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "summary" in body
        assert "appointments" in body
        assert "action_queue" in body
        assert "sales_snapshot" in body
        assert "closing" in body
        assert body.get("read_only") is False

    def test_manager_can_access_dashboard(self, owner_token):
        r = _dashboard(owner_token)
        assert r.status_code == 200, r.text

    def test_clinical_roles_cannot_access(self):
        for email in (DOCTOR_EMAIL, THERAPIST_EMAIL, NURSE_EMAIL):
            try:
                token = login(email)
            except AssertionError:
                pytest.skip(f"login unavailable for {email}")
            r = _dashboard(token)
            assert r.status_code == 403, f"{email} should be denied: {r.text}"

    def test_appointments_sorted_by_time(self, fo_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        b1 = _create_today_booking(fo_token, day, 17, 0)
        b2 = _create_today_booking(fo_token, day, 9, 15)
        try:
            refreshed = _dashboard(fo_token).json()
            ours = [a for a in refreshed["appointments"] if a["id"] in (b1["id"], b2["id"])]
            assert len(ours) == 2
            times = [a["scheduled_at"] for a in ours]
            assert times == sorted(times)
            all_times = [a["scheduled_at"] for a in refreshed["appointments"]]
            assert all_times == sorted(all_times)
        finally:
            for bid in (b1["id"], b2["id"]):
                requests.delete(f"{API}/bookings/{bid}", headers=H(fo_token), timeout=TIMEOUT)

    def test_pending_payment_action_appears(self, fo_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        iid, bid = _create_unpaid_invoice_today(fo_token, day)
        try:
            refreshed = _dashboard(fo_token).json()
            kinds = {a["kind"] for a in refreshed["action_queue"]}
            assert "invoice_unpaid" in kinds
            unpaid = next(a for a in refreshed["action_queue"] if a.get("invoice_id") == iid)
            assert unpaid["link"] == f"/invoices/{iid}"
        finally:
            requests.delete(f"{API}/bookings/{bid}", headers=H(fo_token), timeout=TIMEOUT)

    def test_missing_consent_action_appears(self, fo_token, owner_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        suffix = uuid.uuid4().hex[:6]
        treatment = requests.post(
            f"{API}/treatments-catalog",
            headers=H(owner_token),
            json={
                "name": f"FD Consent Tx {suffix}",
                "category": "facial",
                "duration_min": 30,
                "price_idr": 100_000,
                "consent_required": True,
                "active": True,
            },
            timeout=TIMEOUT,
        )
        assert treatment.status_code == 200, treatment.text
        tx_name = treatment.json()["name"]
        patient = requests.post(
            f"{API}/patients",
            headers=H(owner_token),
            json={"full_name": f"Consent FD {suffix}", "phone": "081111222333"},
            timeout=TIMEOUT,
        )
        assert patient.status_code == 200, patient.text
        pid = patient.json()["id"]
        booking = _create_today_booking(
            fo_token,
            day,
            11,
            0,
            patient_id=pid,
            treatment=tx_name,
        )
        try:
            refreshed = _dashboard(fo_token).json()
            consent_items = [a for a in refreshed["action_queue"] if a["kind"] == "consent_missing"]
            assert any(a.get("booking_id") == booking["id"] for a in consent_items)
        finally:
            requests.delete(f"{API}/bookings/{booking['id']}", headers=H(fo_token), timeout=TIMEOUT)
            requests.delete(f"{API}/treatments-catalog/{treatment.json()['id']}", headers=H(owner_token), timeout=TIMEOUT)

    def test_sales_snapshot_matches_closing_preview(self, fo_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        preview = _closing_preview(fo_token, day)
        snap = dash["sales_snapshot"]
        pm = preview.get("payment_methods") or (preview.get("breakdown") or {}).get("payment_methods") or {}
        assert snap["total_collected_idr"] == int(
            preview.get("money_collected_idr") or preview.get("total_collected_idr") or 0
        )
        assert snap["cash_idr"] == int(pm.get("cash") or 0)
        assert snap["card_idr"] == int(pm.get("card") or 0)

    def test_closing_widget_open_when_not_closed(self, fo_token, owner_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        _ensure_day_open(owner_token, day)
        refreshed = _dashboard(fo_token).json()
        assert refreshed["closing"]["is_closed"] is False
        assert refreshed["closing"]["status"] == "open"
        assert refreshed["summary"]["closing_status"] == "open"

    def test_closing_widget_closed_when_day_closed(self, fo_token, owner_token):
        dash = _dashboard(fo_token).json()
        day = dash["date"]
        _ensure_day_open(owner_token, day)
        preview = _closing_preview(fo_token, day)
        expected = preview.get("expected_cash_idr") or preview.get("payment_methods", {}).get("cash", 0)
        close = requests.post(
            f"{API}/closing/close",
            headers=H(fo_token),
            json={"date": day, "notes": "FD dashboard test", "actual_cash_counted_idr": expected},
            timeout=TIMEOUT,
        )
        assert close.status_code == 200, close.text
        try:
            refreshed = _dashboard(fo_token).json()
            assert refreshed["closing"]["is_closed"] is True
            assert refreshed["closing"]["status"] == "closed"
            assert refreshed["summary"]["closing_status"] == "closed"
            assert refreshed["closing"].get("closed_at")
        finally:
            requests.post(
                f"{API}/closing/reopen",
                headers=H(owner_token),
                json={"date": day, "reason": "front desk dashboard test cleanup"},
                timeout=TIMEOUT,
            )

    def test_dashboard_respects_clinic_timezone(self, fo_token):
        dash = _dashboard(fo_token).json()
        assert dash.get("timezone")
        assert len(dash.get("date") or "") == 10
        clinic = requests.get(f"{API}/clinics/me", headers=H(fo_token), timeout=TIMEOUT)
        assert clinic.status_code == 200, clinic.text
        expected_tz = (clinic.json().get("timezone") or "Asia/Makassar").strip() or "Asia/Makassar"
        assert dash["timezone"] == expected_tz

    def test_accounting_read_only_dashboard(self, owner_token):
        roles = requests.get(f"{API}/staff/roles", headers=H(owner_token), timeout=TIMEOUT).json()
        role = next((r for r in roles if r.get("role_key") == "accounting"), None)
        if not role:
            pytest.skip("accounting role missing")
        suffix = uuid.uuid4().hex[:8]
        email = f"fd-acct-{suffix}@example.com"
        u = requests.post(
            f"{API}/staff/users",
            headers=H(owner_token),
            json={
                "name": f"FD Acct {suffix}",
                "email": email,
                "password": PASSWORD,
                "role_id": role["id"],
                "active": True,
            },
            timeout=TIMEOUT,
        )
        assert u.status_code == 200, u.text
        token = login(email)
        r = _dashboard(token)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("read_only") is True
        assert body["action_queue"] == []
        if body["appointments"]:
            assert all(not a.get("quick_actions") for a in body["appointments"])
