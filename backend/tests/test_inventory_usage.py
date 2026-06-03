"""Phase 4 — inventory treatment usage deduction tests."""
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30
PASSWORD = "password123"


def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["token"]


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def get_user_id(headers: dict) -> str:
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["id"]


@pytest.fixture(scope="module")
def owner_h():
    return H(login("admin@bodylab.id"))


@pytest.fixture(scope="module")
def doctor_h():
    return H(login("doctor@bodylab.id"))


@pytest.fixture(scope="module")
def doctor_id(doctor_h):
    return get_user_id(doctor_h)


@pytest.fixture(scope="module")
def fo_h():
    return H(login("fo@bodylab.id"))


class TestInventorySettings:
    def test_get_and_update_inventory_settings(self, owner_h):
        r = requests.get(f"{API}/settings/inventory", headers=owner_h, timeout=TIMEOUT)
        assert r.status_code == 200
        assert "allow_negative_stock" in r.json()

        cur = r.json()["allow_negative_stock"]
        try:
            r2 = requests.put(
                f"{API}/admin/settings/inventory",
                headers=owner_h,
                json={"allow_negative_stock": not cur},
                timeout=TIMEOUT,
            )
            assert r2.status_code == 200, r2.text
            assert r2.json()["allow_negative_stock"] is (not cur)
        finally:
            requests.put(
                f"{API}/admin/settings/inventory",
                headers=owner_h,
                json={"allow_negative_stock": cur},
                timeout=TIMEOUT,
            )


class TestTreatmentProductUsage:
    @pytest.fixture
    def doctor_treatment(self, owner_h):
        name = f"INV Tx {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/treatments-catalog",
            headers=owner_h,
            json={
                "name": name,
                "category": "Other",
                "price_idr": 0,
                "allowed_performer_roles": ["doctor"],
                "active": True,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        yield name
        requests.delete(f"{API}/treatments-catalog/{tid}", headers=owner_h, timeout=TIMEOUT)

    @pytest.fixture
    def product_with_stock(self, owner_h):
        code = f"INV_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/products-catalog",
            headers=owner_h,
            json={
                "name": f"Test Botox {code}",
                "product_code": code,
                "category": "INVENTORY",
                "product_type": "Consumable",
                "current_stock": 10,
                "minimum_stock": 3,
                "unit": "vial",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        yield r.json()
        requests.delete(f"{API}/products-catalog/{pid}", headers=owner_h, timeout=TIMEOUT)

    def _create_visit_with_treatment(self, fo_h, doctor_h, doctor_id, treatment_name, product_id=None, quantity_used=None):
        pr = requests.post(
            f"{API}/patients",
            headers=fo_h,
            json={"full_name": f"INV Patient {uuid.uuid4().hex[:6]}", "phone": "081200000001"},
            timeout=TIMEOUT,
        )
        assert pr.status_code == 200, pr.text
        pid = pr.json()["id"]
        vr = requests.post(
            f"{API}/visits",
            json={
                "patient_id": pid,
                "visit_type": "doctor",
                "performers": [{"staff_id": doctor_id, "performer_type": "primary"}],
                "chief_complaint": "INV test",
            },
            headers=fo_h,
            timeout=TIMEOUT,
        )
        assert vr.status_code == 200, vr.text
        vid = vr.json()["id"]
        body = {
            "category": "Injectable",
            "name": treatment_name,
            "quantity": 1,
            "unit_type": "session",
            "price": 0,
        }
        if product_id:
            body["product_id"] = product_id
            body["quantity_used"] = quantity_used
        tr = requests.post(f"{API}/visits/{vid}/treatments", headers=doctor_h, json=body, timeout=TIMEOUT)
        assert tr.status_code == 200, tr.text
        return vid, tr.json()["id"]

    def test_usage_deducts_stock_and_creates_movement(self, owner_h, fo_h, doctor_h, doctor_id, product_with_stock, doctor_treatment):
        tname = doctor_treatment
        pid = product_with_stock["id"]

        vid, tid = self._create_visit_with_treatment(fo_h, doctor_h, doctor_id, tname, pid, 2)

        prod = requests.get(f"{API}/products-catalog", headers=owner_h, params={"q": product_with_stock["product_code"]}, timeout=TIMEOUT).json()
        rows = prod.get("items") if isinstance(prod, dict) else prod
        updated = next(x for x in rows if x["id"] == pid)
        assert updated["current_stock"] == 8

        movements = requests.get(f"{API}/products-catalog/{pid}/stock-movements", headers=owner_h, timeout=TIMEOUT)
        assert movements.status_code == 200
        assert any(m.get("movement_type") == "treatment_usage" for m in movements.json())

        v = requests.get(f"{API}/visits/{vid}", headers=doctor_h, timeout=TIMEOUT).json()
        assert any(u.get("status") == "active" and u.get("product_id") == pid for u in v.get("product_usages") or [])

        requests.delete(f"{API}/visits/{vid}/treatments/{tid}", headers=doctor_h, timeout=TIMEOUT)

        prod2 = requests.get(f"{API}/products-catalog", headers=owner_h, params={"q": product_with_stock["product_code"]}, timeout=TIMEOUT).json()
        rows2 = prod2.get("items") if isinstance(prod2, dict) else prod2
        restored = next(x for x in rows2 if x["id"] == pid)
        assert restored["current_stock"] == 10

    def test_blocks_usage_when_insufficient_stock(self, owner_h, fo_h, doctor_h, doctor_id, product_with_stock, doctor_treatment):
        requests.put(
            f"{API}/admin/settings/inventory",
            headers=owner_h,
            json={"allow_negative_stock": False},
            timeout=TIMEOUT,
        )
        product_id = product_with_stock["id"]
        requests.put(
            f"{API}/products-catalog/{product_id}",
            headers=owner_h,
            json={"current_stock": 1},
            timeout=TIMEOUT,
        )
        tname = doctor_treatment

        pr = requests.post(
            f"{API}/patients",
            headers=fo_h,
            json={"full_name": f"INV Block {uuid.uuid4().hex[:6]}", "phone": "081200000002"},
            timeout=TIMEOUT,
        )
        pid = pr.json()["id"]
        vr = requests.post(
            f"{API}/visits",
            json={
                "patient_id": pid,
                "visit_type": "doctor",
                "performers": [{"staff_id": doctor_id, "performer_type": "primary"}],
                "chief_complaint": "INV block test",
            },
            headers=fo_h,
            timeout=TIMEOUT,
        )
        vid = vr.json()["id"]
        tr = requests.post(
            f"{API}/visits/{vid}/treatments",
            headers=doctor_h,
            json={
                "category": "Injectable",
                "name": tname,
                "quantity": 1,
                "unit_type": "session",
                "price": 0,
                "product_id": product_id,
                "quantity_used": 5,
            },
            timeout=TIMEOUT,
        )
        assert tr.status_code == 400
        assert "Insufficient stock" in tr.text

    def test_inventory_usage_report(self, owner_h):
        r = requests.get(f"{API}/reports/inventory-usage", headers=owner_h, params={"preset": "this_month"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "usage_by_date" in data
        assert "low_stock_products" in data
        assert "out_of_stock_products" in data
