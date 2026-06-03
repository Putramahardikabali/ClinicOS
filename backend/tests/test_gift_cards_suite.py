"""
Gift card integration suite (20 scenarios).

Requires running API: REACT_APP_BACKEND_URL (default http://localhost:8000).
"""
from __future__ import annotations

import os
import re
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

GC_CODE_RE = re.compile(r"^GC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$")


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
    email = f"qa-gc-{suffix}@example.com"
    u = requests.post(
        f"{API}/staff/users",
        headers=H(owner_token),
        json={
            "name": f"QA GC {suffix}",
            "email": email,
            "password": PASSWORD,
            "role_id": role["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert u.status_code == 200, u.text
    return login(email), role["id"]


def _gift_card_item(value, **meta_extra):
    meta = {"gift_card_type": "value_credit", "value_idr": value, **meta_extra}
    return {
        "item_type": "gift_card",
        "name_snapshot": "Gift card",
        "qty": 1,
        "unit_price": value,
        "metadata": meta,
    }


def _sell_gift_card(token, value=300_000, *, complete=True, metadata=None):
    item = _gift_card_item(value, **(metadata or {}))
    r = requests.post(
        f"{API}/pos/sales",
        headers=H(token),
        json={
            "is_walk_in": True,
            "customer_name": f"GC buyer {uuid.uuid4().hex[:6]}",
            "items": [item],
            "complete": complete,
            "payment_method": "cash",
            "amount_paid": value if complete else None,
        },
        timeout=TIMEOUT,
    )
    return r


def _get_card(token, gc_id):
    r = requests.get(f"{API}/gift-cards/{gc_id}", headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _closing_preview(token, day=None):
    params = {"date": day} if day else {}
    r = requests.get(f"{API}/closing/preview", headers=H(token), params=params, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _redeem_pos(token, code, amount, *, item_price=100_000):
    return requests.post(
        f"{API}/pos/sales",
        headers=H(token),
        json={
            "is_walk_in": True,
            "customer_name": "Redeem QA",
            "items": [{
                "item_type": "custom",
                "name_snapshot": "Item",
                "qty": 1,
                "unit_price": item_price,
            }],
            "complete": True,
            "payment_method": "cash",
            "gift_card_code": code,
            "gift_card_amount_idr": amount,
            "amount_paid": max(0, item_price - amount),
        },
        timeout=TIMEOUT,
    )


def _create_paid_invoice(token, total=200_000):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d")
    rb = requests.post(
        f"{API}/bookings",
        headers=H(token),
        json={
            "patient_name": f"GC Inv {uuid.uuid4().hex[:6]}",
            "patient_phone": "081277700088",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T10:00:00",
        },
        timeout=TIMEOUT,
    )
    assert rb.status_code == 200, rb.text
    bid = rb.json()["id"]
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
                "unit_price_idr": total,
                "quantity": 1,
            }],
        },
        timeout=TIMEOUT,
    )
    assert upd.status_code == 200, upd.text
    return iid


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def fo_token():
    try:
        return login(FO_EMAIL)
    except AssertionError:
        pytest.skip("FO user not available")


@pytest.fixture(scope="module")
def clinical_tokens(owner_token):
    out = {}
    for key, email in [("doctor", DOCTOR_EMAIL), ("therapist", THERAPIST_EMAIL), ("nurse", NURSE_EMAIL)]:
        try:
            out[key] = login(email)
        except AssertionError:
            out[key] = None
    return out


class TestGiftCardPosSale:
    """POS gift card issuance (tests 1–5)."""

    def test_01_draft_pos_does_not_activate_gift_card(self, owner_token):
        r = _sell_gift_card(owner_token, 100_000, complete=False)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["status"] == "draft"
        assert not sale["items"][0].get("gift_card_id")

    def test_02_paid_pos_creates_active_gift_card(self, owner_token):
        r = _sell_gift_card(owner_token, 250_000)
        assert r.status_code == 200, r.text
        sale = r.json()
        gc_id = sale["items"][0]["gift_card_id"]
        card = _get_card(owner_token, gc_id)
        assert card["status"] == "active"
        assert card["balance_value"] == 250_000

    def test_03_gift_card_codes_are_unique(self, owner_token):
        r1 = _sell_gift_card(owner_token, 50_000)
        r2 = _sell_gift_card(owner_token, 60_000)
        assert r1.status_code == 200 and r2.status_code == 200
        c1 = r1.json()["items"][0]["gift_card_code"]
        c2 = r2.json()["items"][0]["gift_card_code"]
        assert GC_CODE_RE.match(c1)
        assert GC_CODE_RE.match(c2)
        assert c1 != c2

    def test_04_paid_sale_includes_receipt_fields_for_gift_card(self, owner_token):
        """API fields used by POS receipt gift-card section."""
        r = _sell_gift_card(
            owner_token,
            175_000,
            metadata={
                "recipient_name": "Receipt Recipient",
                "expiry_date": "2099-12-31",
            },
        )
        assert r.status_code == 200, r.text
        item = r.json()["items"][0]
        assert item.get("gift_card_code")
        meta = item.get("metadata") or {}
        assert meta.get("gift_card_type") == "value_credit"
        assert meta.get("value_idr") == 175_000
        assert meta.get("recipient_name") == "Receipt Recipient"
        assert meta.get("expiry_date") == "2099-12-31"

    def test_05_gift_card_sale_in_daily_closing(self, owner_token):
        value = 125_000
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        before = _closing_preview(owner_token, day)
        gc_sales_before = int(
            before.get("gift_card_sales_idr")
            or before.get("breakdown", {}).get("gift_card_sales_idr")
            or 0
        )
        r = _sell_gift_card(owner_token, value)
        assert r.status_code == 200, r.text
        day = (r.json().get("paid_at") or day)[:10]
        after = _closing_preview(owner_token, day)
        gc_sales = int(
            after.get("gift_card_sales_idr")
            or after.get("breakdown", {}).get("gift_card_sales_idr")
            or 0
        )
        assert gc_sales >= gc_sales_before + value


class TestGiftCardRedemption:
    """Redemption rules (tests 6–13)."""

    def test_06_redeem_active_card_on_invoice(self, fo_token):
        sale = _sell_gift_card(fo_token, 400_000).json()
        code = _get_card(fo_token, sale["items"][0]["gift_card_id"])["code"]
        iid = _create_paid_invoice(fo_token, total=120_000)
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(fo_token),
            json={
                "mark_paid": True,
                "payment_method": "cash",
                "gift_card_code": code,
                "gift_card_amount_idr": 120_000,
                "amount_paid": 0,
            },
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        inv = pay.json()
        assert inv.get("gift_card_payment_total_idr") == 120_000

    def test_07_redeem_active_card_on_pos(self, owner_token):
        sale = _sell_gift_card(owner_token, 500_000).json()
        code = _get_card(owner_token, sale["items"][0]["gift_card_id"])["code"]
        r = _redeem_pos(owner_token, code, 80_000, item_price=80_000)
        assert r.status_code == 200, r.text
        assert r.json().get("gift_card_payment_total_idr") == 80_000

    def test_08_partial_redemption_sets_partially_redeemed(self, owner_token):
        sale = _sell_gift_card(owner_token, 200_000).json()
        gc_id = sale["items"][0]["gift_card_id"]
        code = _get_card(owner_token, gc_id)["code"]
        r = _redeem_pos(owner_token, code, 75_000)
        assert r.status_code == 200, r.text
        card = _get_card(owner_token, gc_id)
        assert card["balance_value"] == 125_000
        assert card["status"] == "partially_redeemed"

    def test_09_full_redemption_sets_redeemed(self, owner_token):
        sale = _sell_gift_card(owner_token, 40_000).json()
        gc_id = sale["items"][0]["gift_card_id"]
        code = _get_card(owner_token, gc_id)["code"]
        r = _redeem_pos(owner_token, code, 40_000, item_price=40_000)
        assert r.status_code == 200, r.text
        card = _get_card(owner_token, gc_id)
        assert card["balance_value"] == 0
        assert card["status"] == "redeemed"

    def test_10_cannot_redeem_expired_card(self, owner_token):
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        r = _sell_gift_card(owner_token, 75_000, metadata={"expiry_date": yesterday})
        assert r.status_code == 200, r.text
        code = _get_card(owner_token, r.json()["items"][0]["gift_card_id"])["code"]
        bad = _redeem_pos(owner_token, code, 10_000, item_price=10_000)
        assert bad.status_code == 400, bad.text

    def test_11_cannot_redeem_cancelled_card(self, owner_token):
        sale = _sell_gift_card(owner_token, 90_000).json()
        gc_id = sale["items"][0]["gift_card_id"]
        code = _get_card(owner_token, gc_id)["code"]
        cancel = requests.post(
            f"{API}/gift-cards/{gc_id}/cancel",
            headers=H(owner_token),
            json={"reason": "QA test cancellation"},
            timeout=TIMEOUT,
        )
        assert cancel.status_code == 200, cancel.text
        bad = _redeem_pos(owner_token, code, 10_000, item_price=10_000)
        assert bad.status_code == 400, bad.text

    def test_12_cannot_redeem_more_than_balance(self, owner_token):
        sale = _sell_gift_card(owner_token, 10_000).json()
        code = _get_card(owner_token, sale["items"][0]["gift_card_id"])["code"]
        bad = _redeem_pos(owner_token, code, 150_000, item_price=200_000)
        assert bad.status_code == 400, bad.text

    def test_13_cannot_redeem_more_than_amount_due(self, owner_token):
        sale = _sell_gift_card(owner_token, 100_000).json()
        code = _get_card(owner_token, sale["items"][0]["gift_card_id"])["code"]
        bad = _redeem_pos(owner_token, code, 60_000, item_price=50_000)
        assert bad.status_code == 400, bad.text


class TestGiftCardPermissions:
    """Role permissions (tests 14–17)."""

    def test_14_fo_can_create_and_redeem(self, fo_token):
        r = _sell_gift_card(fo_token, 80_000)
        assert r.status_code == 200, r.text
        code = r.json()["items"][0]["gift_card_code"]
        redeem = _redeem_pos(fo_token, code, 20_000, item_price=20_000)
        assert redeem.status_code == 200, redeem.text

    def test_15_accounting_view_only_no_redeem_or_cancel(self, owner_token):
        token, _ = create_custom_role(
            owner_token,
            "Accounting GC QA",
            ["accounting.view", "gift_cards.view", "closing.view", "profile.view_own"],
        )
        view = requests.get(f"{API}/gift-cards", headers=H(token), timeout=TIMEOUT)
        assert view.status_code == 200, view.text
        sale = _sell_gift_card(owner_token, 50_000).json()
        gc_id = sale["items"][0]["gift_card_id"]
        code = _get_card(owner_token, gc_id)["code"]
        redeem = _redeem_pos(token, code, 5_000, item_price=5_000)
        assert redeem.status_code == 403, redeem.text
        cancel = requests.post(
            f"{API}/gift-cards/{gc_id}/cancel",
            headers=H(token),
            json={"reason": "Should not allow"},
            timeout=TIMEOUT,
        )
        assert cancel.status_code == 403, cancel.text

    def test_16_clinical_roles_cannot_access_gift_cards_module(self, clinical_tokens):
        for key in ("doctor", "therapist", "nurse"):
            tok = clinical_tokens.get(key)
            if not tok:
                continue
            r = requests.get(f"{API}/gift-cards", headers=H(tok), timeout=TIMEOUT)
            assert r.status_code == 403, f"{key} should not list gift cards: {r.text}"

    def test_17_without_redeem_permission_cannot_pay_with_gift_card(self, owner_token):
        token, _ = create_custom_role(
            owner_token,
            "Billing no redeem",
            ["billing.view", "billing.create", "billing.edit", "pos.view", "pos.create", "gift_cards.create"],
        )
        sale = _sell_gift_card(owner_token, 100_000).json()
        code = _get_card(owner_token, sale["items"][0]["gift_card_id"])["code"]
        bad = _redeem_pos(token, code, 25_000, item_price=25_000)
        assert bad.status_code == 403, bad.text


class TestGiftCardReports:
    """Reporting (tests 18–20)."""

    def test_18_outstanding_balance_report_correct(self, owner_token):
        value = 320_000
        sale = _sell_gift_card(owner_token, value).json()
        gc_id = sale["items"][0]["gift_card_id"]
        summary_before = requests.get(f"{API}/gift-cards/summary", headers=H(owner_token), timeout=TIMEOUT).json()
        out_before = int(summary_before.get("outstanding_balance_idr") or 0)
        _redeem_pos(owner_token, _get_card(owner_token, gc_id)["code"], 120_000)
        summary_after = requests.get(f"{API}/gift-cards/summary", headers=H(owner_token), timeout=TIMEOUT).json()
        out_after = int(summary_after.get("outstanding_balance_idr") or 0)
        assert out_after == out_before - 120_000
        card = _get_card(owner_token, gc_id)
        assert card["balance_value"] == value - 120_000

    def test_19_redemption_separate_from_cash_in_closing(self, owner_token):
        gc_value = 100_000
        sale = _sell_gift_card(owner_token, gc_value).json()
        code = _get_card(owner_token, sale["items"][0]["gift_card_id"])["code"]
        redeem_amt = 30_000
        _redeem_pos(owner_token, code, redeem_amt, item_price=redeem_amt)
        day = (sale.get("paid_at") or "")[:10]
        preview = _closing_preview(owner_token, day)
        gc_redemptions = int(preview.get("gift_card_redemptions_idr") or 0)
        rpm = preview.get("redemption_payment_methods") or {}
        pm_gc = int(rpm.get("gift_card") or preview.get("payment_methods", {}).get("gift_card") or 0)
        assert gc_redemptions >= redeem_amt
        assert pm_gc >= redeem_amt
        cash = int(preview.get("payment_methods", {}).get("cash") or 0)
        assert cash >= gc_value
        bd = preview.get("breakdown") or {}
        assert int(bd.get("custom_sales_idr") or preview.get("pos", {}).get("custom_sales_idr") or 0) == 0
        settled = int(
            bd.get("gift_card_redemption_settled_idr")
            or preview.get("gift_card_redemption_settled_idr")
            or 0
        )
        assert settled >= redeem_amt
        assert int(preview.get("money_collected_idr") or 0) >= gc_value

    def test_20_export_gift_card_report(self, owner_token):
        r = requests.get(
            f"{API}/reports/gift-cards/export",
            headers=H(owner_token),
            params={"preset": "this_month"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert "spreadsheet" in (r.headers.get("content-type") or "").lower() or len(r.content) > 100
