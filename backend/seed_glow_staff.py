"""Seed staff users (doctor/therapist/FO/manager) for Glow Aesthetic demo clinic
and clean up stale test clinics.
Run once: `python seed_glow_staff.py` from /app/backend.
"""
import asyncio
import os
import uuid
import bcrypt
from datetime import datetime, timezone
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

CLINIC_SLUG = "glowclinic"
PASSWORD = "password123"

STAFF = [
    {"role": "doctor",    "email": "doctor@glowclinic.id",    "name": "dr. Rina Putri"},
    {"role": "therapist", "email": "therapist@glowclinic.id", "name": "Lisa Therapist"},
    {"role": "fo",        "email": "fo@glowclinic.id",        "name": "Mira Front Office"},
    {"role": "manager",   "email": "manager@glowclinic.id",   "name": "Adi Manager"},
]


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    clinic = await db.clinics.find_one({"slug": CLINIC_SLUG}, {"_id": 0})
    if not clinic:
        print(f"Clinic '{CLINIC_SLUG}' not found.")
        return
    cid = clinic["id"]
    print(f"Seeding staff into: {clinic['name']} ({cid})")

    for s in STAFF:
        existing = await db.users.find_one({"email": s["email"]})
        if existing:
            print(f"  skip (exists): {s['email']}")
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "email": s["email"],
            "password_hash": hash_pw(PASSWORD),
            "role": s["role"],
            "name": s["name"],
            "clinic_id": cid,
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(doc)
        print(f"  created: {s['role']:<10} {s['email']}")

    # Clean up obviously-test clinics (test_*, e2e_*)
    stale = await db.clinics.find(
        {"slug": {"$regex": "^(test-clinic-|e2e-test-clinic-|trial-test-clinic)"}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1}
    ).to_list(50)
    if stale:
        ids = [c["id"] for c in stale]
        print(f"\nCleaning up {len(stale)} stale test clinics:")
        for c in stale:
            print(f"  - {c['slug']}")
        await db.clinics.delete_many({"id": {"$in": ids}})
        await db.users.delete_many({"clinic_id": {"$in": ids}})
        await db.settings.delete_many({"clinic_id": {"$in": ids}})
        await db.bookings.delete_many({"clinic_id": {"$in": ids}})
        await db.patients.delete_many({"clinic_id": {"$in": ids}})
        await db.visits.delete_many({"clinic_id": {"$in": ids}})
        print("Cleanup done.")

    client.close()


asyncio.run(main())
