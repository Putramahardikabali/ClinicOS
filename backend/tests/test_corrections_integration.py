"""
Integration tests for refund, void, and correction rules.

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

CLOSING_LOCK_SNIPPET = "closed daily closing"


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password=PASSWORD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "ClinicOS@2026"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


def _create_pos_product(token, stock=50, sale_price=100_000):
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/products-catalog",
        headers=H(token),
        json={
            "name": f"Corr Test {suffix}",
            "product_code": f"COR{suffix}",
            "category": "Retail",
            "current_stock": stock,
            "minimum_stock": 0,
            "unit": "pcs",
            "sale_price_idr": sale_price,
            "pos_enabled": True,
            "track_stock": True,
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get_product(token, product_code):
    r = requests.get(
        f"{API}/products-catalog",
        headers=H(token),
        params={"q": product_code},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    items = data if isinstance(data, list) else (data.get("items") or [])
    return next(
        (p for p in items if isinstance(p, dict) and p.get("product_code") == product_code),
        None,
    )


def _create_treatment(token, price=350_000):
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/treatments-catalog",
        headers=H(token),
        json={
            "name": f"Corr Trt {suffix}",
            "service_code": f"CORT{suffix}",
            "category": "Facial",
            "price_idr": price,
            "duration_min": 60,
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_package(token, price=1_500_000):
    tr = _create_treatment(token)
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/packages-catalog",
        headers=H(token),
        json={
            "name": f"Corr Pkg {suffix}",
            "package_code": f"CORPKG{suffix}",
            "package_type": "Series package",
            "price_idr": price,
            "sessions_total": 6,
            "validity_days": 365,
            "series_treatment_id": tr["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_patient(token):
    unique = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"full_name": f"Corr Patient {unique}", "phone": f"081{unique[:8]}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _sell_gift_card(token, value=300_000):
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


def _get_gift_card(token, gc_id):
    r = requests.get(f"{API}/gift-cards/{gc_id}", headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _create_unpaid_invoice(token, total=200_000):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
    rb = requests.post(
        f"{API}/bookings",
        headers=H(token),
        json={
            "patient_name": f"Corr Inv {uuid.uuid4().hex[:6]}",
            "patient_phone": "081299900011",
            "treatment": "Facial",
            "duration_min": 60,
            "scheduled_at": f"{tomorrow}T09:30:00",
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
            json={"date": day, "reason": "corrections test cleanup"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text


def _close_day(owner_token, fo_token, day):
    _ensure_day_open(owner_token, day)
    preview = _closing_preview(fo_token, day)
    expected = preview.get("expected_cash_idr") or preview.get("payment_methods", {}).get("cash", 0)
    r = requests.post(
        f"{API}/closing/close",
        headers=H(fo_token),
        json={"date": day, "notes": "Corrections test", "actual_cash_counted_idr": expected},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_staff_with_permissions(owner_token, permissions, label="corr-qa"):
    suffix = uuid.uuid4().hex[:8]
    role = requests.post(
        f"{API}/staff/roles",
        headers=H(owner_token),
        json={"role_name": f"{label} {suffix}", "permissions": permissions},
        timeout=TIMEOUT,
    )
    assert role.status_code == 200, role.text
    email = f"corr-qa-{suffix}@example.com"
    user = requests.post(
        f"{API}/staff/users",
        headers=H(owner_token),
        json={
            "name": f"Corr QA {suffix}",
            "email": email,
            "password": PASSWORD,
            "role_id": role.json()["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert user.status_code == 200, user.text
    return login(email)


def _cancel_sale(token, sale_id, reason="QA cancellation"):
    return requests.post(
        f"{API}/pos/sales/{sale_id}/cancel",
        headers=H(token),
        json={"cancel_reason": reason},
        timeout=TIMEOUT,
    )


@pytest.fixture(scope="module")
def owner_token():
    return login(OWNER_EMAIL)


@pytest.fixture(scope="module")
def fo_token():
    return login(FO_EMAIL)


@pytest.fixture(scope="module")
def doctor_token():
    return login(DOCTOR_EMAIL)


class TestPosSaleCancellation:
    def test_cancel_draft_pos_sale(self, owner_token):
        product = _create_pos_product(owner_token, stock=20)
        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Draft cancel",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 10_000,
                }],
                "complete": False,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale_id = r.json()["id"]
        c = _cancel_sale(owner_token, sale_id, "Draft sale no longer needed")
        assert c.status_code == 200, c.text
        assert c.json()["status"] == "cancelled"
        assert c.json().get("cancel_reason") == "Draft sale no longer needed"

    def test_cancel_paid_pos_before_closing_reverses_stock(self, owner_token):
        product = _create_pos_product(owner_token, stock=30, sale_price=80_000)
        pid = product["id"]
        pcode = product["product_code"]
        before = float(product.get("current_stock") or 0)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)

        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Paid cancel stock",
                "items": [{
                    "item_type": "product",
                    "product_id": pid,
                    "name_snapshot": product["name"],
                    "qty": 2,
                    "unit_price": 80_000,
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 160_000,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale = r.json()
        after_sale = _get_product(owner_token, pcode)
        assert float(after_sale.get("current_stock")) == before - 2

        c = _cancel_sale(owner_token, sale["id"], "Wrong qty entered")
        assert c.status_code == 200, c.text
        assert c.json()["status"] == "cancelled"

        restored = _get_product(owner_token, pcode)
        assert float(restored.get("current_stock")) == before

    def test_cancel_paid_pos_after_closing_blocked(self, owner_token, fo_token):
        product = _create_pos_product(owner_token, sale_price=45_000)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)

        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Closed day cancel",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 45_000,
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 45_000,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale = r.json()
        paid_day = (sale.get("paid_at") or today)[:10]
        _close_day(owner_token, fo_token, paid_day)

        detail = requests.get(f"{API}/pos/sales/{sale['id']}", headers=H(owner_token), timeout=TIMEOUT)
        assert detail.status_code == 200, detail.text
        assert detail.json().get("closing_locked") is True

        c = _cancel_sale(owner_token, sale["id"], "Should be blocked")
        assert c.status_code == 400, c.text
        assert CLOSING_LOCK_SNIPPET in (c.json().get("detail") or "").lower()

        _ensure_day_open(owner_token, paid_day)

    def test_gift_card_sale_cancel_cancels_unused_card(self, owner_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)
        sale = _sell_gift_card(owner_token, 250_000)
        gc_id = sale["items"][0]["gift_card_id"]
        card_before = _get_gift_card(owner_token, gc_id)
        assert card_before["status"] == "active"

        c = _cancel_sale(owner_token, sale["id"], "Customer changed mind")
        assert c.status_code == 200, c.text

        card_after = _get_gift_card(owner_token, gc_id)
        assert card_after["status"] == "cancelled"

    def test_package_sale_cancel_removes_unused_patient_package(self, owner_token):
        pkg = _create_package(owner_token)
        patient = _create_patient(owner_token)
        price = int(pkg.get("price_idr") or 1_500_000)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)

        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "patient_id": patient["id"],
                "is_walk_in": False,
                "items": [{
                    "item_type": "package",
                    "package_catalog_id": pkg["id"],
                    "name_snapshot": pkg["name"],
                    "qty": 1,
                    "unit_price": price,
                }],
                "complete": True,
                "payment_method": "card",
                "amount_paid": price,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale = r.json()

        pp = requests.get(
            f"{API}/patients/{patient['id']}/patient-packages",
            headers=H(owner_token),
            timeout=TIMEOUT,
        )
        assert pp.status_code == 200, pp.text
        packages = pp.json() if isinstance(pp.json(), list) else pp.json().get("items", pp.json())
        linked = [p for p in packages if p.get("pos_sale_id") == sale["id"]]
        assert len(linked) >= 1
        assert linked[0].get("status") != "cancelled"

        c = _cancel_sale(owner_token, sale["id"], "Wrong package sold")
        assert c.status_code == 200, c.text

        pp2 = requests.get(
            f"{API}/patients/{patient['id']}/patient-packages",
            headers=H(owner_token),
            timeout=TIMEOUT,
        )
        packages2 = pp2.json() if isinstance(pp2.json(), list) else pp2.json().get("items", pp2.json())
        linked2 = [p for p in packages2 if p.get("pos_sale_id") == sale["id"]]
        assert linked2
        assert all(p.get("status") == "cancelled" for p in linked2)


class TestInvoicePaymentVoid:
    def test_void_payment_before_closing_recalculates_balance(self, fo_token, owner_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)
        iid = _create_unpaid_invoice(fo_token, total=200_000)
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(fo_token),
            json={"payment_method": "cash", "amount_paid": 80_000},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        inv = pay.json()
        assert inv.get("payment_status") == "partial"
        assert inv.get("amount_paid") == 80_000
        payment_id = (inv.get("payments") or [])[-1]["id"]

        void = requests.post(
            f"{API}/invoices/{iid}/payments/{payment_id}/void",
            headers=H(fo_token),
            json={"reason": "Wrong amount entered"},
            timeout=TIMEOUT,
        )
        assert void.status_code == 200, void.text
        body = void.json()
        assert body.get("amount_paid") == 0
        assert body.get("payment_status") == "unpaid"
        assert body.get("remaining_balance") == 200_000

    def test_void_gift_card_payment_restores_balance(self, fo_token, owner_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)
        gc_sale = _sell_gift_card(fo_token, 400_000)
        gc_id = gc_sale["items"][0]["gift_card_id"]
        code = _get_gift_card(fo_token, gc_id)["code"]
        iid = _create_unpaid_invoice(fo_token, total=120_000)

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
        gc_payment = next(p for p in (inv.get("payments") or []) if p.get("method") == "gift_card")
        card_mid = _get_gift_card(fo_token, gc_id)
        assert card_mid["balance_value"] == 280_000

        void = requests.post(
            f"{API}/invoices/{iid}/payments/{gc_payment['id']}/void",
            headers=H(fo_token),
            json={"reason": "Redeem on wrong invoice"},
            timeout=TIMEOUT,
        )
        assert void.status_code == 200, void.text
        assert void.json().get("gift_card_payment_total_idr") == 0

        card_after = _get_gift_card(fo_token, gc_id)
        assert card_after["balance_value"] == 400_000
        assert card_after["status"] == "active"


class TestRefundsAndPermissions:
    def test_refund_appears_in_daily_closing(self, owner_token, fo_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)
        product = _create_pos_product(owner_token, sale_price=60_000)
        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Refund closing QA",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 60_000,
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 60_000,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale = r.json()
        paid_day = (sale.get("paid_at") or today)[:10]

        refund = requests.post(
            f"{API}/pos/sales/{sale['id']}/refund",
            headers=H(owner_token),
            json={"amount_idr": 20_000, "method": "cash", "reason": "Partial return"},
            timeout=TIMEOUT,
        )
        assert refund.status_code == 200, refund.text

        preview = _closing_preview(fo_token, paid_day)
        refunds_total = int(
            preview.get("refunds_idr")
            or preview.get("breakdown", {}).get("refunds_idr")
            or preview.get("refunds", {}).get("total_idr")
            or 0
        )
        assert refunds_total >= 20_000

        detail = requests.get(f"{API}/pos/sales/{sale['id']}", headers=H(owner_token), timeout=TIMEOUT)
        assert detail.status_code == 200, detail.text
        assert any(rf.get("amount_idr") == 20_000 for rf in (detail.json().get("refunds") or []))

    def test_user_without_permission_cannot_void_or_refund(self, owner_token, doctor_token):
        iid = _create_unpaid_invoice(owner_token, total=100_000)
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(owner_token),
            json={"payment_method": "cash", "amount_paid": 50_000},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        payment_id = (pay.json().get("payments") or [])[-1]["id"]

        void_denied = requests.post(
            f"{API}/invoices/{iid}/payments/{payment_id}/void",
            headers=H(doctor_token),
            json={"reason": "Should fail"},
            timeout=TIMEOUT,
        )
        assert void_denied.status_code == 403, void_denied.text

        sale = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Perm test",
                "items": [{
                    "item_type": "custom",
                    "name_snapshot": "Item",
                    "qty": 1,
                    "unit_price": 25_000,
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 25_000,
            },
            timeout=TIMEOUT,
        )
        assert sale.status_code == 200, sale.text
        refund_denied = requests.post(
            f"{API}/pos/sales/{sale.json()['id']}/refund",
            headers=H(doctor_token),
            json={"amount_idr": 5_000, "method": "cash", "reason": "Should fail"},
            timeout=TIMEOUT,
        )
        assert refund_denied.status_code == 403, refund_denied.text

        cancel_denied = _cancel_sale(doctor_token, sale.json()["id"], "Should fail")
        assert cancel_denied.status_code == 403, cancel_denied.text

    def test_closed_invoice_edit_blocked_until_reopen(self, owner_token, fo_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _ensure_day_open(owner_token, today)
        iid = _create_unpaid_invoice(fo_token, total=150_000)
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(fo_token),
            json={"mark_paid": True, "payment_method": "cash"},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        paid_day = (pay.json().get("paid_at") or today)[:10]
        _close_day(owner_token, fo_token, paid_day)

        get_inv = requests.get(f"{API}/invoices/{iid}", headers=H(fo_token), timeout=TIMEOUT)
        assert get_inv.status_code == 200, get_inv.text
        assert get_inv.json().get("closing_locked") is True

        edit_denied = requests.put(
            f"{API}/invoices/{iid}",
            headers=H(fo_token),
            json={
                "items": [{
                    "item_type": "custom",
                    "name": "Changed",
                    "unit_price_idr": 99_000,
                    "quantity": 1,
                }],
            },
            timeout=TIMEOUT,
        )
        assert edit_denied.status_code == 400, edit_denied.text
        assert CLOSING_LOCK_SNIPPET in (edit_denied.json().get("detail") or "").lower()

        _ensure_day_open(owner_token, paid_day)
        edit_ok = requests.put(
            f"{API}/invoices/{iid}",
            headers=H(fo_token),
            json={
                "items": [{
                    "item_type": "custom",
                    "name": "Changed after reopen",
                    "unit_price_idr": 99_000,
                    "quantity": 1,
                }],
            },
            timeout=TIMEOUT,
        )
        assert edit_ok.status_code == 200, edit_ok.text
