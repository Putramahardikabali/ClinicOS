"""
Patient wallet integration tests.

Requires running API: REACT_APP_BACKEND_URL (default http://localhost:8000).
"""
from __future__ import annotations

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


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


def _create_patient(token):
    unique = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"full_name": f"Wallet QA {unique}", "phone": f"081{unique[:8]}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _credit_wallet(token, patient_id, amount, reason="QA wallet credit"):
    r = requests.post(
        f"{API}/patients/{patient_id}/wallet/adjust",
        headers=H(token),
        json={"amount_idr": amount, "reason": reason},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_product_sale(token, patient_id=None, *, wallet_amount=0, walk_in=True, price=75_000):
    suffix = uuid.uuid4().hex[:8]
    pr = requests.post(
        f"{API}/products-catalog",
        headers=H(token),
        json={
            "name": f"Wallet Prod {suffix}",
            "product_code": f"WLT{suffix}",
            "category": "Retail",
            "current_stock": 20,
            "minimum_stock": 0,
            "unit": "pcs",
            "sale_price_idr": price,
            "pos_enabled": True,
            "track_stock": True,
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert pr.status_code == 200, pr.text
    product = pr.json()
    payload = {
        "is_walk_in": walk_in and not patient_id,
        "patient_id": patient_id,
        "customer_name": "Wallet walk-in" if walk_in and not patient_id else None,
        "items": [{
            "item_type": "product",
            "product_id": product["id"],
            "name_snapshot": product["name"],
            "qty": 1,
            "unit_price": price,
        }],
        "complete": True,
        "payment_method": "cash",
        "amount_paid": max(0, price - wallet_amount),
        "wallet_amount_idr": wallet_amount if wallet_amount > 0 else None,
    }
    return requests.post(f"{API}/pos/sales", headers=H(token), json=payload, timeout=TIMEOUT)


def _sell_value_gift_card(token, value=200_000):
    r = requests.post(
        f"{API}/pos/sales",
        headers=H(token),
        json={
            "is_walk_in": True,
            "customer_name": f"GC buyer {uuid.uuid4().hex[:6]}",
            "items": [{
                "item_type": "gift_card",
                "name_snapshot": "Gift card",
                "qty": 1,
                "unit_price": value,
                "metadata": {"gift_card_type": "value_credit", "value_idr": value},
            }],
            "complete": True,
            "payment_method": "cash",
            "amount_paid": value,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_unpaid_invoice(token, patient_id, total=150_000):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d")
    rb = requests.post(
        f"{API}/bookings",
        headers=H(token),
        json={
            "patient_id": patient_id,
            "patient_name": "Wallet inv",
            "patient_phone": "081200011122",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T14:00:00",
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
        json={"items": [{"item_type": "custom", "name": "Svc", "unit_price_idr": total, "quantity": 1}]},
        timeout=TIMEOUT,
    )
    assert upd.status_code == 200, upd.text
    return iid


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def fo_token():
    return login(FO_EMAIL)


@pytest.fixture(scope="module")
def doctor_token():
    return login(DOCTOR_EMAIL)


class TestWalletCreditsAndPayments:
    def test_refund_to_store_credit_increases_wallet(self, owner_token):
        patient = _create_patient(owner_token)
        sale = _create_product_sale(owner_token, patient["id"], walk_in=False, price=90_000)
        assert sale.status_code == 200, sale.text
        before = requests.get(f"{API}/patients/{patient['id']}/wallet", headers=H(owner_token), timeout=TIMEOUT)
        assert before.status_code == 200
        bal_before = int(before.json().get("wallet", {}).get("balance") or 0)
        refund = requests.post(
            f"{API}/pos/sales/{sale.json()['id']}/refund",
            headers=H(owner_token),
            json={"amount_idr": 30_000, "method": "store_credit", "reason": "Refund to wallet QA"},
            timeout=TIMEOUT,
        )
        assert refund.status_code == 200, refund.text
        after = requests.get(f"{API}/patients/{patient['id']}/wallet", headers=H(owner_token), timeout=TIMEOUT)
        assert int(after.json()["wallet"]["balance"]) == bal_before + 30_000

    def test_invoice_payment_using_store_credit(self, owner_token, fo_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 100_000)
        iid = _create_unpaid_invoice(fo_token, patient["id"], total=60_000)
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(fo_token),
            json={"mark_paid": True, "payment_method": "store_credit", "wallet_amount_idr": 60_000},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        assert pay.json()["payment_status"] == "paid"
        wallet = requests.get(f"{API}/patients/{patient['id']}/wallet", headers=H(owner_token), timeout=TIMEOUT)
        assert int(wallet.json()["wallet"]["balance"]) == 40_000

    def test_pos_payment_using_store_credit(self, owner_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 80_000)
        sale = _create_product_sale(owner_token, patient["id"], walk_in=False, wallet_amount=50_000, price=50_000)
        assert sale.status_code == 200, sale.text
        wallet = requests.get(f"{API}/patients/{patient['id']}/wallet", headers=H(owner_token), timeout=TIMEOUT)
        assert int(wallet.json()["wallet"]["balance"]) == 30_000

    def test_walk_in_cannot_use_store_credit(self, owner_token):
        _credit_wallet(owner_token, _create_patient(owner_token)["id"], 50_000)
        sale = _create_product_sale(owner_token, None, walk_in=True, wallet_amount=10_000)
        assert sale.status_code == 400, sale.text
        assert "patient" in sale.json().get("detail", "").lower()

    def test_value_gift_card_redeemed_to_wallet(self, owner_token):
        patient = _create_patient(owner_token)
        gc_sale = _sell_value_gift_card(owner_token, 120_000)
        gc_id = gc_sale["items"][0]["gift_card_id"]
        r = requests.post(
            f"{API}/gift-cards/{gc_id}/redeem-to-wallet",
            headers=H(owner_token),
            json={"patient_id": patient["id"], "amount_idr": 120_000},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        wallet = requests.get(f"{API}/patients/{patient['id']}/wallet", headers=H(owner_token), timeout=TIMEOUT)
        assert int(wallet.json()["wallet"]["balance"]) == 120_000

    def test_wallet_cannot_go_negative(self, owner_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 10_000)
        sale = _create_product_sale(owner_token, patient["id"], walk_in=False, wallet_amount=50_000, price=50_000)
        assert sale.status_code == 400, sale.text

    def test_manual_adjustment_requires_permission(self, owner_token, doctor_token):
        patient = _create_patient(owner_token)
        denied = requests.post(
            f"{API}/patients/{patient['id']}/wallet/adjust",
            headers=H(doctor_token),
            json={"amount_idr": 5_000, "reason": "Should fail"},
            timeout=TIMEOUT,
        )
        assert denied.status_code == 403, denied.text

    def test_wallet_report_shows_liability(self, owner_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 25_000)
        report = requests.get(f"{API}/wallet/report", headers=H(owner_token), timeout=TIMEOUT)
        assert report.status_code == 200, report.text
        assert report.json()["outstanding_liability_idr"] >= 25_000

    def test_daily_closing_separates_store_credit(self, owner_token, fo_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 200_000)
        sale = _create_product_sale(owner_token, patient["id"], walk_in=False, wallet_amount=45_000, price=45_000)
        assert sale.status_code == 200, sale.text
        paid_day = (sale.json().get("paid_at") or datetime.now(timezone.utc).isoformat())[:10]
        preview = requests.get(f"{API}/closing/preview", headers=H(fo_token), params={"date": paid_day}, timeout=TIMEOUT)
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert int(body.get("store_credit_payments_idr") or body.get("breakdown", {}).get("store_credit_payments_idr") or 0) >= 45_000

    def test_treatment_gift_card_cannot_redeem_to_wallet(self, owner_token):
        patient = _create_patient(owner_token)
        suffix = uuid.uuid4().hex[:8]
        tr = requests.post(
            f"{API}/treatments-catalog",
            headers=H(owner_token),
            json={
                "name": f"Wallet Trt {suffix}",
                "service_code": f"WLT{suffix}",
                "category": "Facial",
                "price_idr": 300_000,
                "duration_min": 60,
                "active": True,
            },
            timeout=TIMEOUT,
        )
        assert tr.status_code == 200, tr.text
        sale = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Entitlement GC",
                "items": [{
                    "item_type": "gift_card",
                    "name_snapshot": "Treatment GC",
                    "qty": 1,
                    "unit_price": 300_000,
                    "metadata": {
                        "gift_card_type": "treatment",
                        "value_idr": 300_000,
                        "treatment_catalog_id": tr.json()["id"],
                    },
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 300_000,
            },
            timeout=TIMEOUT,
        )
        assert sale.status_code == 200, sale.text
        gc_id = sale.json()["items"][0]["gift_card_id"]
        bad = requests.post(
            f"{API}/gift-cards/{gc_id}/redeem-to-wallet",
            headers=H(owner_token),
            json={"patient_id": patient["id"]},
            timeout=TIMEOUT,
        )
        assert bad.status_code == 400, bad.text
        assert "cannot" in bad.json().get("detail", "").lower()

    def test_fo_can_use_wallet_not_adjust(self, owner_token, fo_token):
        patient = _create_patient(owner_token)
        _credit_wallet(owner_token, patient["id"], 35_000)
        adjust_denied = requests.post(
            f"{API}/patients/{patient['id']}/wallet/adjust",
            headers=H(fo_token),
            json={"amount_idr": 1_000, "reason": "FO should not adjust"},
            timeout=TIMEOUT,
        )
        assert adjust_denied.status_code == 403, adjust_denied.text
        sale = _create_product_sale(fo_token, patient["id"], walk_in=False, wallet_amount=15_000, price=15_000)
        assert sale.status_code == 200, sale.text
