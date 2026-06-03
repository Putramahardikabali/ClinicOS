#!/usr/bin/env python3
"""Verify default treatment commission rule and end-to-end earned record flow."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import requests

API = os.environ.get("VERIFY_API", "http://127.0.0.1:8000/api").rstrip("/")
MANAGER_EMAIL = os.environ.get("VERIFY_MANAGER", "manager@bodylab.id")
FO_EMAIL = os.environ.get("VERIFY_FO", "fo@bodylab.id")
OWNER_EMAIL = os.environ.get("VERIFY_OWNER", "admin@bodylab.id")
PASSWORD = os.environ.get("VERIFY_PASSWORD", "password123")
TIMEOUT = 30


def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["token"]


def main() -> int:
    manager_t = login(MANAGER_EMAIL)
    fo_t = login(FO_EMAIL)
    owner_t = login(OWNER_EMAIL)
    mh = {"Authorization": f"Bearer {manager_t}"}
    fh = {"Authorization": f"Bearer {fo_t}"}
    oh = {"Authorization": f"Bearer {owner_t}"}

    rules = requests.get(f"{API}/commission-rules", headers=mh, timeout=TIMEOUT).json()
    default_rule = next((r for r in rules if r.get("rule_name") == "Default Treatment Commission"), None)
    if not default_rule:
        print("FAIL: Default Treatment Commission rule not found")
        return 1
    print("OK: Default rule present", {
        "role": default_rule.get("applies_to_role"),
        "item_type": default_rule.get("applies_to_item_type"),
        "value": default_rule.get("commission_value"),
        "basis": default_rule.get("calculation_basis"),
        "priority": default_rule.get("priority"),
    })

    users = requests.get(f"{API}/users", headers=oh, timeout=TIMEOUT).json()
    therapist = next((u for u in users if u.get("role") == "therapist"), None)
    if not therapist:
        print("FAIL: no therapist user")
        return 1

    tag = uuid.uuid4().hex[:6]
    patient = requests.post(f"{API}/patients", headers=fh, json={
        "full_name": f"Comm Verify {tag}",
        "phone": f"0812{tag}",
    }, timeout=TIMEOUT)
    patient.raise_for_status()
    pid = patient.json()["id"]

    visit = requests.post(f"{API}/visits", headers=fh, json={
        "patient_id": pid,
        "visit_type": "therapist",
        "assigned_to": therapist["id"],
        "chief_complaint": "Commission verify",
    }, timeout=TIMEOUT)
    visit.raise_for_status()
    vid = visit.json()["id"]

    inv = requests.post(f"{API}/invoices/visit/{vid}", headers=fh, timeout=TIMEOUT).json()
    iid = inv["id"]

    treatments = requests.get(f"{API}/treatments-catalog", headers=fh, timeout=TIMEOUT).json()
    trow = next((x for x in treatments if int(x.get("price_idr") or 0) > 0), None)
    if not trow:
        print("FAIL: no priced treatment in catalog")
        return 1

    added = requests.post(f"{API}/invoices/{iid}/items/catalog", headers=fh, json={
        "item_type": "treatment",
        "catalog_id": trow["id"] or trow.get("key"),
        "quantity": 1,
        "performer_id": therapist["id"],
    }, timeout=TIMEOUT)
    added.raise_for_status()
    line = added.json()["items"][-1]
    net_amount = int(line.get("line_total_idr") or 0)

    pending = requests.get(
        f"{API}/commission-records",
        headers=mh,
        params={"staff_id": therapist["id"], "status": "pending"},
        timeout=TIMEOUT,
    ).json()
    rec = next((r for r in pending if r.get("invoice_id") == iid), None)
    if not rec:
        print("FAIL: no pending commission record after adding treatment item")
        return 1
    print("OK: pending commission record", rec["id"], rec.get("commission_rule_name_snapshot"))

    paid = requests.put(f"{API}/invoices/{iid}/payment", headers=fh, json={
        "mark_paid": True,
        "payment_method": "cash",
    }, timeout=TIMEOUT)
    paid.raise_for_status()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    month_start = today[:8] + "01"
    earned_rows = requests.get(
        f"{API}/commission-records",
        headers=mh,
        params={
            "staff_id": therapist["id"],
            "from": month_start,
            "to": today,
            "date_basis": "earned_at",
            "status": "earned",
        },
        timeout=TIMEOUT,
    ).json()
    earned = next((r for r in earned_rows if r["id"] == rec["id"]), None)
    if not earned:
        print("FAIL: earned record not visible on staff profile query")
        return 1

    expected = int(round(net_amount * 0.10))
    if earned["commission_amount"] != expected:
        print("FAIL: commission amount", earned["commission_amount"], "expected", expected)
        return 1

    print("OK: earned commission on therapist profile", {
        "staff_id": therapist["id"],
        "amount": earned["commission_amount"],
        "status": earned["status"],
        "rule": earned.get("commission_rule_name_snapshot"),
    })
    print(f"Staff profile: /staff/members/{therapist['id']} (Commission tab)")
    print("PASS: default commission flow verified")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except requests.HTTPError as exc:
        print("HTTP error:", exc.response.status_code, exc.response.text[:500])
        raise SystemExit(1)
