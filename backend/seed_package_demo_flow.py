"""Seed a end-to-end package demo flow for Glow Aesthetic Clinic.

Creates:
  1. Patient with a paid package purchase (6 sessions credited to balance)
  2. Treatment booking for today
  3. Checked-in visit from booking
  4. Invoice with treatment line paid by package (1 session deducted)

Run (from repo root):
  docker compose exec backend python seed_package_demo_flow.py

Or locally:
  cd backend && python seed_package_demo_flow.py

Re-run is idempotent: refreshes the demo booking/visit/invoice if the marker patient exists.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent))

from patient_packages import (
    apply_package_to_invoice_line,
    create_patient_packages_from_invoice,
)
from invoices import (
    _apply_totals_and_payment,
    next_invoice_number,
    normalize_invoice_item,
    snapshot_catalog_item,
    sync_visit_from_invoice,
)
from visit_workflow import create_visit_from_booking

CLINIC_SLUG = "glowclinic"
DEMO_PHONE = "08139999001"
DEMO_EMAIL = "demo.package@glowclinic.id"
DEMO_NAME = "Sari Package Demo"
DEMO_MARKER = "demo_package_flow_v1"
PACKAGE_NAME = "Glow Facial Package (6 Sessions)"
TREATMENT_NAME = "Signature Facial"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _ensure_package_catalog(db, cid: str, fo_id: str, treatment_id: str) -> dict:
    row = await db.packages.find_one(
        {"clinic_id": cid, "name": PACKAGE_NAME},
        {"_id": 0},
    )
    if row and row.get("components"):
        return row
    if row:
        await db.packages.delete_one({"id": row["id"]})
    pkg_id = str(uuid.uuid4())
    doc = {
        "id": pkg_id,
        "clinic_id": cid,
        "key": "glow-facial-6",
        "package_code": "GLOW-FACIAL-6",
        "name": PACKAGE_NAME,
        "category": "facial",
        "package_type": "series_package",
        "business_unit": "Default",
        "price_idr": 2_500_000,
        "sessions_total": 6,
        "validity_days": 365,
        "valid_days": 365,
        "redemption_rule": "flexible",
        "unused_component_policy": "keep_remaining",
        "is_active": True,
        "active": True,
        "performer_type": "therapist",
        "duration_min": 60,
        "components": [{
            "id": str(uuid.uuid4()),
            "treatment_id": treatment_id,
            "treatment_name_snapshot": TREATMENT_NAME,
            "quantity": 6,
            "sort_order": 0,
            "is_required": True,
            "notes": "",
        }],
        "description": "Demo series package for FO package-usage flow",
        "created_at": iso(now_utc()),
        "created_by": fo_id,
    }
    await db.packages.insert_one(doc)
    doc.pop("_id", None)
    print(f"  + catalog package: {PACKAGE_NAME}")
    return doc


async def _cleanup_demo_run(db, cid: str, patient_id: str) -> None:
    """Remove prior demo booking/visit/invoice/usage so re-run is clean."""
    bookings = await db.bookings.find(
        {"clinic_id": cid, "patient_id": patient_id, "notes": DEMO_MARKER},
        {"_id": 0, "id": 1, "visit_id": 1},
    ).to_list(50)
    visit_ids = [b.get("visit_id") for b in bookings if b.get("visit_id")]
    booking_ids = [b["id"] for b in bookings]

    if booking_ids:
        await db.bookings.delete_many({"id": {"$in": booking_ids}})
    if visit_ids:
        await db.treatment_items.delete_many({"visit_id": {"$in": visit_ids}})
        await db.visits.delete_many({"id": {"$in": visit_ids}})
    invs = await db.invoices.find(
        {"clinic_id": cid, "patient_id": patient_id, "notes": {"$regex": DEMO_MARKER}},
        {"_id": 0, "id": 1},
    ).to_list(50)
    inv_ids = [i["id"] for i in invs]
    if inv_ids:
        usages = await db.package_usage.find(
            {"clinic_id": cid, "invoice_id": {"$in": inv_ids}},
            {"_id": 0, "patient_package_id": 1, "used_sessions_count": 1},
        ).to_list(100)
        for u in usages:
            pkg = await db.patient_packages.find_one({"id": u["patient_package_id"]}, {"_id": 0})
            if pkg:
                used = max(0, int(pkg.get("used_sessions") or 0) - int(u.get("used_sessions_count") or 1))
                await db.patient_packages.update_one(
                    {"id": pkg["id"]},
                    {"$set": {
                        "used_sessions": used,
                        "remaining_sessions": max(0, int(pkg["total_sessions"]) - used),
                        "status": "active",
                        "updated_at": iso(now_utc()),
                    }},
                )
        await db.package_usage.delete_many({"invoice_id": {"$in": inv_ids}})
        await db.invoices.delete_many({"id": {"$in": inv_ids}})


async def _create_package_purchase_invoice(
    db, cid: str, patient_id: str, pkg: dict, fo_user: dict,
) -> tuple[dict, dict]:
    """Paid invoice for package purchase → credits patient_packages balance."""
    existing = await db.patient_packages.find_one(
        {"clinic_id": cid, "patient_id": patient_id, "package_id": pkg["id"], "status": {"$ne": "cancelled"}},
        {"_id": 0},
    )
    if existing and int(existing.get("used_sessions") or 0) == 0:
        inv = await db.invoices.find_one({"id": existing.get("invoice_id")}, {"_id": 0})
        if inv:
            print("  = package balance already credited (reusing purchase invoice)")
            return inv, existing

    item_id = str(uuid.uuid4())
    price = int(pkg.get("price_idr") or 0)
    line = await normalize_invoice_item(
        db,
        cid,
        {
            "id": item_id,
            "item_type": "package",
            "catalog_id": pkg["id"],
            "name": pkg["name"],
            "unit_price_idr": price,
            "quantity": 1,
        },
        line_id=item_id,
    )
    inv_id = str(uuid.uuid4())
    now = iso(now_utc())
    inv = {
        "id": inv_id,
        "clinic_id": cid,
        "invoice_number": await next_invoice_number(db, cid),
        "patient_id": patient_id,
        "visit_id": None,
        "appointment_id": None,
        "items": [line],
        "discount_type": "none",
        "discount_value": 0,
        "discount_reason": "",
        "notes": f"{DEMO_MARKER} package purchase",
        "payment_method": "cash",
        "payment_reference": "DEMO-PKG-PURCHASE",
        "amount_paid": price,
        "created_by": fo_user["id"],
        "created_at": now,
        "updated_at": now,
        "paid_at": now,
        "closed_at": None,
    }
    inv = _apply_totals_and_payment(inv)
    inv["payment_status"] = "paid"
    await db.invoices.insert_one(inv)
    inv.pop("_id", None)
    result = await create_patient_packages_from_invoice(db, inv)
    pp = await db.patient_packages.find_one(
        {"clinic_id": cid, "invoice_item_id": item_id},
        {"_id": 0},
    )
    print(f"  + package purchase invoice {inv['invoice_number']} (patient_packages created: {result['created']})")
    return inv, pp


async def _ensure_staff(db, cid: str) -> tuple[dict, dict]:
    """FO + therapist for demo actions."""
    staff_spec = [
        {"role": "fo", "email": "fo@glowclinic.id", "name": "Mira Front Office"},
        {"role": "therapist", "email": "therapist@glowclinic.id", "name": "Lisa Therapist"},
    ]
    import bcrypt

    def hp(p: str) -> str:
        return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

    out = {}
    for s in staff_spec:
        row = await db.users.find_one({"email": s["email"]}, {"_id": 0})
        if row and row.get("clinic_id") != cid:
            row = None
        if not row:
            row = {
                "id": str(uuid.uuid4()),
                "email": s["email"],
                "password_hash": hp("password123"),
                "role": s["role"],
                "name": s["name"],
                "clinic_id": cid,
                "active": True,
                "created_at": iso(now_utc()),
            }
            await db.users.insert_one(row)
            row.pop("_id", None)
            print(f"  + staff: {s['email']}")
        out[s["role"]] = row
    fo = out.get("fo")
    ther = out.get("therapist")
    if not fo or not ther:
        raise RuntimeError("Could not ensure FO and therapist users")
    return fo, ther


async def _ensure_treatment_catalog(db, cid: str, fo_id: str) -> dict:
    row = await db.treatments.find_one({"clinic_id": cid, "name": TREATMENT_NAME}, {"_id": 0})
    if row:
        return row
    from bookings import DEFAULT_TREATMENTS

    spec = next((t for t in DEFAULT_TREATMENTS if t["name"] == TREATMENT_NAME), None)
    if not spec:
        raise RuntimeError(f"Default treatment spec missing for {TREATMENT_NAME}")
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": cid,
        "key": spec["key"],
        "service_code": spec["key"],
        "name": spec["name"],
        "category": spec.get("category", "facial"),
        "performer_type": spec.get("performer_type", "therapist"),
        "duration_min": spec["duration_min"],
        "price_idr": spec["price_idr"],
        "active": True,
        "created_at": iso(now_utc()),
        "created_by": fo_id,
    }
    await db.treatments.insert_one(doc)
    doc.pop("_id", None)
    print(f"  + treatment catalog: {TREATMENT_NAME}")
    return doc


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    clinic = await db.clinics.find_one({"slug": CLINIC_SLUG}, {"_id": 0})
    if not clinic:
        print(f"Clinic '{CLINIC_SLUG}' not found. Run seed_demo_clinics.py first.")
        client.close()
        return
    cid = clinic["id"]

    fo, ther = await _ensure_staff(db, cid)

    patient = await db.patients.find_one({"clinic_id": cid, "phone": DEMO_PHONE}, {"_id": 0})
    if not patient:
        patient = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "full_name": DEMO_NAME,
            "phone": DEMO_PHONE,
            "email": DEMO_EMAIL,
            "gender": "female",
            "notes": DEMO_MARKER,
            "created_at": iso(now_utc()),
            "created_by": fo["id"],
        }
        await db.patients.insert_one(patient)
        patient.pop("_id", None)
        print(f"  + patient: {DEMO_NAME}")
    else:
        print(f"  = patient: {patient.get('full_name')}")

    pid = patient["id"]
    await _cleanup_demo_run(db, cid, pid)

    treatment = await _ensure_treatment_catalog(db, cid, fo["id"])

    pkg = await _ensure_package_catalog(db, cid, fo["id"], treatment["id"])
    purchase_inv, patient_pkg = await _create_package_purchase_invoice(db, cid, pid, pkg, fo)
    if not patient_pkg:
        print("Failed to create patient package balance.")
        client.close()
        return

    scheduled = now_utc().replace(hour=10, minute=0, second=0, microsecond=0)
    if scheduled < now_utc():
        scheduled += timedelta(days=1)
    booking_id = str(uuid.uuid4())
    booking = {
        "id": booking_id,
        "clinic_id": cid,
        "patient_id": pid,
        "patient_name": DEMO_NAME,
        "patient_phone": DEMO_PHONE,
        "patient_email": DEMO_EMAIL,
        "treatment": TREATMENT_NAME,
        "duration_min": int(treatment.get("duration_min") or 60),
        "scheduled_at": iso(scheduled),
        "performer_id": ther["id"],
        "booking_type": "treatment",
        "package_id": None,
        "subtotal_idr": int(treatment.get("price_idr") or 450_000),
        "discount_idr": 0,
        "total_idr": int(treatment.get("price_idr") or 450_000),
        "status": "booked",
        "source": "fo",
        "notes": DEMO_MARKER,
        "wa_history": [],
        "created_at": iso(now_utc()),
        "created_by": fo["id"],
    }
    await db.bookings.insert_one(booking)
    booking.pop("_id", None)
    print(f"  + booking: {TREATMENT_NAME} @ {scheduled.strftime('%Y-%m-%d %H:%M')} UTC")

    visit = await create_visit_from_booking(
        db, booking, cid, fo["id"], check_in=True, seed_emr=True,
    )
    print(f"  + visit started (checked in): {visit['id'][:8]}…")

    inv_id = str(uuid.uuid4())
    now = iso(now_utc())
    default_perf = {
        "performer_id": ther["id"],
        "performer_name_snapshot": ther.get("name") or "Therapist",
        "performer_role_snapshot": ther.get("role") or "therapist",
    }
    snap = await snapshot_catalog_item(db, cid, "treatment", treatment["id"])
    snap["quantity"] = 1
    line = await normalize_invoice_item(
        db, cid, {**snap, "performer_id": ther["id"]}, default_performer=default_perf,
    )
    checkout_inv = {
        "id": inv_id,
        "clinic_id": cid,
        "invoice_number": await next_invoice_number(db, cid),
        "patient_id": pid,
        "visit_id": visit["id"],
        "appointment_id": booking_id,
        "default_performer_id": default_perf["performer_id"],
        "default_performer_name_snapshot": default_perf["performer_name_snapshot"],
        "default_performer_role_snapshot": default_perf["performer_role_snapshot"],
        "items": [line],
        "discount_type": "none",
        "discount_value": 0,
        "discount_reason": "",
        "notes": f"{DEMO_MARKER} visit checkout",
        "payment_method": "cash",
        "payment_reference": "",
        "amount_paid": 0,
        "created_by": fo["id"],
        "created_at": now,
        "updated_at": now,
        "paid_at": None,
        "closed_at": None,
    }
    checkout_inv = _apply_totals_and_payment(checkout_inv)
    await db.invoices.insert_one(checkout_inv)
    checkout_inv.pop("_id", None)
    await sync_visit_from_invoice(db, checkout_inv)

    fo_user = {"id": fo["id"], "clinic_id": cid, "role": "fo"}
    checkout_inv = await apply_package_to_invoice_line(
        db,
        fo_user,
        checkout_inv,
        line["id"],
        patient_pkg["id"],
        used_sessions_count=1,
        notes="Demo flow — package session",
    )
    checkout_inv = _apply_totals_and_payment(checkout_inv)
    checkout_inv["updated_at"] = iso(now_utc())
    await db.invoices.update_one({"id": inv_id}, {"$set": checkout_inv})
    await sync_visit_from_invoice(db, checkout_inv)
    print(
        f"  + checkout invoice: {checkout_inv['invoice_number']} "
        f"(paid by package · cash due {checkout_inv['total_amount']:,})"
    )

    patient_pkg = await db.patient_packages.find_one({"id": patient_pkg["id"]}, {"_id": 0})
    usage = await db.package_usage.find_one(
        {"patient_package_id": patient_pkg["id"], "invoice_id": inv_id},
        {"_id": 0},
    )

    print()
    print("=" * 60)
    print("PACKAGE DEMO FLOW READY (Glow Aesthetic Clinic)")
    print("=" * 60)
    print()
    print("Login:  fo@glowclinic.id / password123")
    print()
    print("Patient profile (packages tab):")
    print(f"  http://localhost:3000/patients/{pid}")
    print()
    print("Today's booking:")
    print(f"  http://localhost:3000/bookings  →  {DEMO_NAME} / {TREATMENT_NAME}")
    print()
    print("Visit:")
    print(f"  http://localhost:3000/visits/{visit['id']}")
    print()
    print("Invoice (Paid by Package):")
    print(f"  http://localhost:3000/invoices/{inv_id}")
    print()
    print("Package balance after demo:")
    print(f"  {patient_pkg.get('package_name_snapshot')}: "
          f"{patient_pkg.get('remaining_sessions')} sessions remaining "
          f"({patient_pkg.get('used_sessions')} used of {patient_pkg.get('total_sessions')})")
    if usage:
        print(f"  Usage record: {usage['id'][:8]}… · service value Rp {usage.get('treatment_value_snapshot', 0):,}")
    print()
    print("Manual repeat (FO):")
    print("  1. Patient buys package → pay package invoice → balance credited")
    print("  2. Book treatment appointment for patient")
    print("  3. Start visit from booking")
    print("  4. Open invoice → add treatment line → Use package → Confirm")
    print("=" * 60)

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
