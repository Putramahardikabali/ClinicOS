"""POS — clinic cashier (products, packages, gift cards, services, custom)."""

import os
from datetime import datetime, timezone

import uuid



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





def _create_pos_product(token, stock=50, sale_price=125_000):

    suffix = uuid.uuid4().hex[:8]

    r = requests.post(

        f"{API}/products-catalog",

        headers=H(token),

        json={

            "name": f"POS Test {suffix}",

            "product_code": f"POS{suffix}",

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





def _create_package(token, price=1_500_000):

    suffix = uuid.uuid4().hex[:8]

    r = requests.post(

        f"{API}/packages-catalog",

        headers=H(token),

        json={

            "name": f"POS Pkg {suffix}",

            "package_code": f"POSPKG{suffix}",

            "package_type": "Series package",

            "price_idr": price,

            "sessions_total": 6,

            "validity_days": 365,

            "active": True,

        },

        timeout=TIMEOUT,

    )

    assert r.status_code == 200, r.text

    return r.json()





def _create_treatment(token, price=350_000):

    suffix = uuid.uuid4().hex[:8]

    r = requests.post(

        f"{API}/treatments-catalog",

        headers=H(token),

        json={

            "name": f"POS Svc {suffix}",

            "service_code": f"POSSVC{suffix}",

            "category": "Facial",

            "price_idr": price,

            "duration_min": 60,

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

        json={"full_name": f"POS Patient {unique}", "phone": f"081{unique[:8]}"},

        timeout=TIMEOUT,

    )

    assert r.status_code == 200, r.text

    return r.json()





def _get_product(token, pid):

    r = requests.get(f"{API}/products-catalog", headers=H(token), params={"q": pid, "page": 1, "page_size": 5}, timeout=TIMEOUT)

    assert r.status_code == 200, r.text

    data = r.json()

    items = data.get("items") if isinstance(data, dict) else data

    return next((p for p in items if p.get("id") == pid), None)





@pytest.fixture(scope="module")

def owner_token():

    return login(OWNER_EMAIL)





@pytest.fixture(scope="module")

def fo_token():

    return login(FO_EMAIL)





@pytest.fixture(scope="module")

def doctor_token():

    return login(DOCTOR_EMAIL)





class TestPosPermissions:

    def test_doctor_cannot_create_sale(self, doctor_token, owner_token):

        product = _create_pos_product(owner_token)

        r = requests.post(

            f"{API}/pos/sales",

            headers=H(doctor_token),

            json={

                "is_walk_in": True,

                "customer_name": "Walk-in QA",

                "items": [{

                    "item_type": "product",

                    "product_id": product["id"],

                    "name_snapshot": product["name"],

                    "qty": 1,

                    "unit_price": 100_000,

                }],

                "complete": True,

                "payment_method": "cash",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 403, r.text



    def test_fo_can_list_sales(self, fo_token, owner_token):

        _create_pos_product(owner_token)

        r = requests.get(f"{API}/pos/sales", headers=H(fo_token), timeout=TIMEOUT)

        assert r.status_code == 200, r.text

        assert "items" in r.json()





class TestPosSalesFlow:

    def test_walk_in_paid_sale_deducts_stock(self, owner_token):

        product = _create_pos_product(owner_token, stock=20, sale_price=50_000)

        pid = product["id"]

        before = float(product.get("current_stock") or 0)



        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "Walk-in Customer",

                "customer_phone": "08123456789",

                "items": [{

                    "item_type": "product",

                    "product_id": pid,

                    "name_snapshot": product["name"],

                    "qty": 2,

                    "unit_price": 50_000,

                }],

                "complete": True,

                "payment_method": "cash",

                "amount_paid": 100_000,

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale = r.json()

        assert sale["status"] == "paid"

        assert sale.get("visit_id") is None

        assert sale.get("booking_id") is None

        assert sale["payment_status"] == "paid"



        updated = _get_product(owner_token, pid)

        assert updated is not None

        assert float(updated.get("current_stock")) == before - 2



        mov = requests.get(

            f"{API}/products-catalog/{pid}/stock-movements",

            headers=H(owner_token),

            timeout=TIMEOUT,

        )

        assert mov.status_code == 200, mov.text

        types = [m.get("movement_type") for m in mov.json()]

        assert "retail_sale" in types



    def test_draft_sale_does_not_deduct_stock(self, owner_token):

        product = _create_pos_product(owner_token, stock=15)

        pid = product["id"]

        before = float(product.get("current_stock") or 0)



        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "Draft Only",

                "items": [{

                    "item_type": "product",

                    "product_id": pid,

                    "name_snapshot": product["name"],

                    "qty": 3,

                    "unit_price": 10_000,

                }],

                "complete": False,

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        assert r.json()["status"] == "draft"



        updated = _get_product(owner_token, pid)

        assert float(updated.get("current_stock")) == before



    def test_cancelled_unpaid_sale_no_stock_deduction(self, owner_token):

        product = _create_pos_product(owner_token, stock=12)

        pid = product["id"]

        before = float(product.get("current_stock") or 0)



        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "To Cancel",

                "items": [{

                    "item_type": "product",

                    "product_id": pid,

                    "name_snapshot": product["name"],

                    "qty": 1,

                    "unit_price": 5_000,

                }],

                "complete": False,

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale_id = r.json()["id"]



        c = requests.post(
            f"{API}/pos/sales/{sale_id}/cancel",
            headers=H(owner_token),
            json={"cancel_reason": "QA draft cancel"},
            timeout=TIMEOUT,
        )

        assert c.status_code == 200, c.text

        assert c.json()["status"] == "cancelled"



        updated = _get_product(owner_token, pid)

        assert float(updated.get("current_stock")) == before



    def test_patient_sale_without_visit(self, owner_token):

        product = _create_pos_product(owner_token)

        patient = _create_patient(owner_token)



        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "patient_id": patient["id"],

                "is_walk_in": False,

                "items": [{

                    "item_type": "product",

                    "product_id": product["id"],

                    "name_snapshot": product["name"],

                    "qty": 1,

                    "unit_price": 25_000,

                }],

                "complete": True,

                "payment_method": "qris",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale = r.json()

        assert sale["patient_id"] == patient["id"]

        assert sale.get("visit_id") is None



    def test_custom_line_on_sale(self, owner_token):

        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "Custom line",

                "items": [{

                    "item_type": "custom",

                    "name_snapshot": "Consultation fee",

                    "qty": 1,

                    "unit_price": 150_000,

                    "metadata": {"notes": "Walk-in consult"},

                }],

                "complete": True,

                "payment_method": "cash",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        assert r.json()["items"][0]["item_type"] == "custom"

        assert r.json()["items"][0]["name_snapshot"] == "Consultation fee"



    def test_package_requires_patient(self, owner_token):

        pkg = _create_package(owner_token)

        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "No patient",

                "items": [{

                    "item_type": "package",

                    "package_catalog_id": pkg["id"],

                    "name_snapshot": pkg["name"],

                    "qty": 1,

                    "unit_price": pkg.get("price_idr", 1_500_000),

                }],

                "complete": True,

                "payment_method": "cash",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 400, r.text

        assert "patient" in r.json().get("detail", "").lower()



    def test_paid_package_creates_patient_package(self, owner_token):

        pkg = _create_package(owner_token)

        patient = _create_patient(owner_token)

        price = int(pkg.get("price_idr") or 1_500_000)



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

        assert sale["status"] == "paid"

        assert sale.get("visit_id") is None

        assert sale.get("booking_id") is None



        pp = requests.get(

            f"{API}/patients/{patient['id']}/patient-packages",

            headers=H(owner_token),

            timeout=TIMEOUT,

        )

        assert pp.status_code == 200, pp.text

        packages = pp.json() if isinstance(pp.json(), list) else pp.json().get("items", pp.json())

        linked = [p for p in packages if p.get("pos_sale_id") == sale["id"]]

        assert len(linked) >= 1



    def test_draft_package_does_not_create_patient_package(self, owner_token):

        pkg = _create_package(owner_token)

        patient = _create_patient(owner_token)

        price = int(pkg.get("price_idr") or 1_500_000)



        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "patient_id": patient["id"],

                "items": [{

                    "item_type": "package",

                    "package_catalog_id": pkg["id"],

                    "name_snapshot": pkg["name"],

                    "qty": 1,

                    "unit_price": price,

                }],

                "complete": False,

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale_id = r.json()["id"]



        pp = requests.get(

            f"{API}/patients/{patient['id']}/patient-packages",

            headers=H(owner_token),

            timeout=TIMEOUT,

        )

        assert pp.status_code == 200

        packages = pp.json() if isinstance(pp.json(), list) else pp.json().get("items", [])

        assert not any(p.get("pos_sale_id") == sale_id for p in packages)



    def test_gift_card_item_issued_after_paid(self, owner_token):

        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "Gift buyer",

                "items": [{

                    "item_type": "gift_card",

                    "name_snapshot": "Gift card",

                    "qty": 1,

                    "unit_price": 500_000,

                    "metadata": {

                        "gift_card_type": "value_credit",

                        "value_idr": 500_000,

                        "recipient_name": "Jane",

                    },

                }],

                "complete": True,

                "payment_method": "cash",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale = r.json()

        assert sale["status"] == "paid"

        item = sale["items"][0]

        assert item.get("gift_card_id")

        assert sale.get("gift_card_ids")



    def test_service_without_booking(self, owner_token):

        tr = _create_treatment(owner_token)

        price = int(tr.get("price_idr") or 350_000)

        r = requests.post(

            f"{API}/pos/sales",

            headers=H(owner_token),

            json={

                "is_walk_in": True,

                "customer_name": "Service walk-in",

                "items": [{

                    "item_type": "service",

                    "treatment_catalog_id": tr["id"],

                    "name_snapshot": tr["name"],

                    "qty": 1,

                    "unit_price": price,

                }],

                "complete": True,

                "payment_method": "cash",

            },

            timeout=TIMEOUT,

        )

        assert r.status_code == 200, r.text

        sale = r.json()

        assert sale["items"][0]["item_type"] == "service"

        assert sale.get("visit_id") is None

        assert sale.get("booking_id") is None


    def test_percentage_discount_on_sale(self, owner_token):
        product = _create_pos_product(owner_token, sale_price=100_000)
        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Discount test",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 100_000,
                }],
                "discount_type": "percentage",
                "discount_value": 10,
                "complete": True,
                "payment_method": "cash",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["discount_total"] == 10_000
        assert sale["total"] == 90_000

    def test_daily_closing_includes_paid_pos(self, owner_token):
        product = _create_pos_product(owner_token, sale_price=75_000)
        r = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Closing QA",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 75_000,
                }],
                "complete": True,
                "payment_method": "cash",
                "amount_paid": 75_000,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        today = r.json().get("paid_at", "")[:10]
        closing = requests.get(
            f"{API}/pos/daily-closing",
            headers=H(owner_token),
            params={"date": today},
            timeout=TIMEOUT,
        )
        assert closing.status_code == 200, closing.text
        body = closing.json()
        assert body["pos"]["total_collected_idr"] >= 75_000
        assert body["payment_methods"].get("cash", 0) >= 75_000
        assert body["pos"]["product_sales_idr"] >= 75_000


MANAGER_EMAIL = os.environ.get("MANAGER_EMAIL", "manager@bodylab.id")


def _complete_product_sale(token, price=55_000, payment_method="cash", complete=True, customer="POS QA"):
    product = _create_pos_product(token, sale_price=price)
    r = requests.post(
        f"{API}/pos/sales",
        headers=H(token),
        json={
            "is_walk_in": True,
            "customer_name": customer,
            "items": [{
                "item_type": "product",
                "product_id": product["id"],
                "name_snapshot": product["name"],
                "qty": 1,
                "unit_price": price,
            }],
            "complete": complete,
            "payment_method": payment_method,
            "amount_paid": price if complete else None,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _today_summary(token):
    r = requests.get(f"{API}/pos/sales/today", headers=H(token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _closing_preview(token, day=None):
    params = {"date": day} if day else {}
    r = requests.get(f"{API}/closing/preview", headers=H(token), params=params, timeout=TIMEOUT)
    return r


def _create_staff_with_permissions(owner_token, permissions, label="closing-only"):
    suffix = uuid.uuid4().hex[:8]
    role = requests.post(
        f"{API}/staff/roles",
        headers=H(owner_token),
        json={"role_name": f"{label} {suffix}", "permissions": permissions},
        timeout=TIMEOUT,
    )
    assert role.status_code == 200, role.text
    email = f"pos-qa-{suffix}@example.com"
    user = requests.post(
        f"{API}/staff/users",
        headers=H(owner_token),
        json={
            "name": f"POS QA {suffix}",
            "email": email,
            "password": PASSWORD,
            "role_id": role.json()["id"],
            "active": True,
        },
        timeout=TIMEOUT,
    )
    assert user.status_code == 200, user.text
    return login(email)


@pytest.fixture(scope="module")
def manager_token():
    return login(MANAGER_EMAIL)


class TestPosSalesHistoryAndClosing:
    def test_doctor_cannot_view_today_sales(self, doctor_token):
        r = requests.get(f"{API}/pos/sales/today", headers=H(doctor_token), timeout=TIMEOUT)
        assert r.status_code == 403, r.text

    def test_doctor_cannot_list_sales_history(self, doctor_token):
        r = requests.get(f"{API}/pos/sales", headers=H(doctor_token), timeout=TIMEOUT)
        assert r.status_code == 403, r.text

    def test_fo_can_view_today_sales(self, fo_token, owner_token):
        sale = _complete_product_sale(owner_token, price=42_000, customer="FO today QA")
        r = requests.get(f"{API}/pos/sales/today", headers=H(fo_token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        ids = {row["id"] for row in body.get("items") or []}
        assert sale["id"] in ids

    def test_paid_sale_in_today_and_history(self, owner_token):
        sale = _complete_product_sale(owner_token, price=88_000, customer="History QA")
        today = _today_summary(owner_token)
        assert any(row["id"] == sale["id"] for row in today.get("items") or [])
        hist = requests.get(
            f"{API}/pos/sales",
            headers=H(owner_token),
            params={"q": sale["sale_number"], "status": "paid"},
            timeout=TIMEOUT,
        )
        assert hist.status_code == 200, hist.text
        assert any(row["id"] == sale["id"] for row in hist.json().get("items") or [])

    def test_draft_not_in_today_totals(self, owner_token):
        before = _today_summary(owner_token)["summary"]
        count_before = before["transaction_count"]
        total_before = before["total_collected_idr"]
        _complete_product_sale(owner_token, price=33_000, complete=False, customer="Draft today QA")
        after = _today_summary(owner_token)["summary"]
        assert after["transaction_count"] == count_before
        assert after["total_collected_idr"] == total_before

    def test_cancelled_not_in_today_totals(self, owner_token):
        before = _today_summary(owner_token)["summary"]
        count_before = before["transaction_count"]
        total_before = before["total_collected_idr"]
        sale = _complete_product_sale(owner_token, price=44_000, customer="Cancel today QA")
        mid = _today_summary(owner_token)["summary"]
        assert mid["transaction_count"] == count_before + 1
        assert mid["total_collected_idr"] == total_before + 44_000
        c = requests.post(
            f"{API}/pos/sales/{sale['id']}/cancel",
            headers=H(owner_token),
            json={"cancel_reason": "QA paid cancel before closing"},
            timeout=TIMEOUT,
        )
        assert c.status_code == 200, c.text
        after = _today_summary(owner_token)["summary"]
        assert after["transaction_count"] == count_before
        assert after["total_collected_idr"] == total_before

    def test_today_breakdown_by_item_type(self, owner_token):
        product = _create_pos_product(owner_token, sale_price=20_000)
        r1 = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Breakdown product",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 20_000,
                }],
                "complete": True,
                "payment_method": "card",
            },
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        r2 = requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Breakdown custom",
                "items": [{
                    "item_type": "custom",
                    "name_snapshot": "Custom line",
                    "qty": 1,
                    "unit_price": 15_000,
                }],
                "complete": True,
                "payment_method": "qris",
            },
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        summary = _today_summary(owner_token)["summary"]
        assert summary["product_sales_idr"] >= 20_000
        assert summary["service_custom_sales_idr"] >= 15_000
        assert summary["by_payment_method"]["card"] >= 20_000
        assert summary["by_payment_method"]["qris"] >= 15_000

    def test_closing_preview_paid_pos_and_excludes_draft(self, owner_token):
        before = _closing_preview(owner_token).json()
        pos_before = before["pos"]["total_collected_idr"]
        draft = _complete_product_sale(owner_token, price=99_000, complete=False, customer="Closing draft QA")
        mid = _closing_preview(owner_token).json()
        assert mid["pos"]["total_collected_idr"] == pos_before
        paid = _complete_product_sale(owner_token, price=66_000, customer="Closing paid QA")
        after = _closing_preview(owner_token, (paid.get("paid_at") or "")[:10]).json()
        assert after["pos"]["total_collected_idr"] >= pos_before + 66_000
        assert after["pos"]["product_sales_idr"] >= 66_000
        assert draft["status"] == "draft"

    def test_closing_preview_includes_paid_invoice(self, owner_token, fo_token):
        from datetime import datetime, timedelta, timezone

        tomorrow = (datetime.now(timezone.utc) + timedelta(days=11)).strftime("%Y-%m-%d")
        rb = requests.post(
            f"{API}/bookings",
            headers=H(fo_token),
            json={
                "patient_name": f"Closing Inv {uuid.uuid4().hex[:6]}",
                "patient_phone": "081288800099",
                "treatment": "Facial",
                "duration_min": 60,
                "scheduled_at": f"{tomorrow}T11:00:00",
            },
            timeout=TIMEOUT,
        )
        assert rb.status_code == 200, rb.text
        bid = rb.json()["id"]
        rs = requests.post(f"{API}/bookings/{bid}/start-visit", headers=H(fo_token), timeout=TIMEOUT)
        assert rs.status_code == 200, rs.text
        vid = rs.json()["visit"]["id"]
        inv = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo_token), timeout=TIMEOUT)
        assert inv.status_code == 200, inv.text
        iid = inv.json()["id"]
        updated = requests.put(
            f"{API}/invoices/{iid}",
            headers=H(fo_token),
            json={
                "items": [{
                    "item_type": "custom",
                    "name": "Visit fee",
                    "unit_price_idr": 150_000,
                    "quantity": 1,
                }],
            },
            timeout=TIMEOUT,
        )
        assert updated.status_code == 200, updated.text
        pay = requests.put(
            f"{API}/invoices/{iid}/payment",
            headers=H(fo_token),
            json={"mark_paid": True, "payment_method": "cash"},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200, pay.text
        assert pay.json()["payment_status"] == "paid"
        paid_at = (pay.json().get("paid_at") or "")[:10]
        preview = _closing_preview(owner_token, paid_at).json()
        assert preview["invoices"]["transaction_count"] >= 1
        assert preview["invoices"]["total_collected_idr"] >= pay.json().get("amount_paid", 0)

    def test_manager_can_view_closing_history(self, manager_token):
        hist = requests.get(f"{API}/closing/history", headers=H(manager_token), timeout=TIMEOUT)
        assert hist.status_code == 200, hist.text
        assert "items" in hist.json()

    def test_close_day_stores_cash_reconciliation(self, owner_token, fo_token):
        product = _create_pos_product(owner_token, sale_price=50_000)
        requests.post(
            f"{API}/pos/sales",
            headers=H(owner_token),
            json={
                "is_walk_in": True,
                "customer_name": "Cash close QA",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 50_000,
                }],
                "complete": True,
                "payment_method": "cash",
            },
            timeout=TIMEOUT,
        )
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        preview = _closing_preview(fo_token, today).json()
        if preview.get("is_closed"):
            requests.post(f"{API}/closing/reopen", headers=H(owner_token), json={"date": today, "reason": "test"}, timeout=TIMEOUT)
        expected = preview.get("expected_cash_idr") or preview["payment_methods"].get("cash", 0)
        close = requests.post(
            f"{API}/closing/close",
            headers=H(fo_token),
            json={"date": today, "notes": "Counted", "actual_cash_counted_idr": expected + 5_000},
            timeout=TIMEOUT,
        )
        assert close.status_code == 200, close.text
        body = close.json()
        assert body["expected_cash_idr"] == expected
        assert body["actual_cash_counted_idr"] == expected + 5_000
        assert body["cash_difference_idr"] == 5_000
        requests.post(f"{API}/closing/reopen", headers=H(owner_token), json={"date": today, "reason": "test"}, timeout=TIMEOUT)

    def test_closing_only_role_can_view_history_not_create_sale(self, owner_token):
        acct_token = _create_staff_with_permissions(
            owner_token,
            ["closing.view", "accounting.view", "billing.view"],
            label="Accounting closing",
        )
        hist = requests.get(f"{API}/closing/history", headers=H(acct_token), timeout=TIMEOUT)
        assert hist.status_code == 200, hist.text
        product = _create_pos_product(owner_token)
        denied = requests.post(
            f"{API}/pos/sales",
            headers=H(acct_token),
            json={
                "is_walk_in": True,
                "customer_name": "Acct POS",
                "items": [{
                    "item_type": "product",
                    "product_id": product["id"],
                    "name_snapshot": product["name"],
                    "qty": 1,
                    "unit_price": 10_000,
                }],
                "complete": True,
                "payment_method": "cash",
            },
            timeout=TIMEOUT,
        )
        assert denied.status_code == 403, denied.text


