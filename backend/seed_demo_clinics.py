"""One-shot script to seed 3 demo clinics for the SaaS demo.
Run via: python /app/backend/seed_demo_clinics.py
Idempotent: skips clinics whose slug already exists."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent))
load_dotenv(Path(__file__).parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt

from saas import iso, now_utc, TRIAL_DAYS

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

def hp(p): return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

CLINICS = [
    {
        "name": "Cantik Beauty Clinic", "slug": "cantikbeauty", "city": "Denpasar",
        "owner_name": "Ni Made Ayu", "owner_email": "owner@cantikbeauty.id",
        "plan": "starter", "status": "active",
        "patients": [
            {"full_name": "Putri Sari", "gender": "female", "phone": "0812000001"},
            {"full_name": "Dewi Lestari", "gender": "female", "phone": "0812000002"},
            {"full_name": "Made Wira", "gender": "male", "phone": "0812000003"},
        ],
    },
    {
        "name": "Glow Aesthetic Clinic", "slug": "glowclinic", "city": "South Jakarta",
        "owner_name": "dr. Sarah Wijaya", "owner_email": "owner@glowclinic.id",
        "plan": "clinic", "status": "active",
        "patients": [
            {"full_name": "Adelia Putri", "gender": "female", "phone": "0813000001"},
            {"full_name": "Maya Kusuma", "gender": "female", "phone": "0813000002"},
            {"full_name": "Brian Tan", "gender": "male", "phone": "0813000003"},
            {"full_name": "Sinta Halim", "gender": "female", "phone": "0813000004"},
        ],
    },
    {
        "name": "Lumina Aesthetic & Wellness", "slug": "luminabali", "city": "Seminyak",
        "owner_name": "dr. Amanda Hartono", "owner_email": "owner@luminabali.id",
        "plan": "complete", "status": "active",
        "patients": [
            {"full_name": "Cinta Pradana", "gender": "female", "phone": "0814000001"},
            {"full_name": "Bayu Adi", "gender": "male", "phone": "0814000002"},
            {"full_name": "Lia Anggraini", "gender": "female", "phone": "0814000003"},
            {"full_name": "Rendy Wijaya", "gender": "male", "phone": "0814000004"},
            {"full_name": "Putu Mahar", "gender": "female", "phone": "0814000005"},
        ],
    },
    {
        "name": "Rena Skin Clinic", "slug": "renaskin", "city": "Surabaya",
        "owner_name": "Rena Kusuma", "owner_email": "owner@renaskin.id",
        "plan": "trial", "status": "trial",
        "trial_days_remaining": 3,
        "patients": [
            {"full_name": "Trial Test One", "gender": "female", "phone": "0815000001"},
            {"full_name": "Trial Test Two", "gender": "male", "phone": "0815000002"},
        ],
    },
]


async def seed():
    for spec in CLINICS:
        existing = await db.clinics.find_one({"slug": spec["slug"]})
        if existing:
            print(f"skip (exists): {spec['slug']}")
            continue
        cid = str(uuid.uuid4())
        trial_end = None
        expiry = None
        if spec["status"] == "trial":
            days = spec.get("trial_days_remaining", TRIAL_DAYS)
            trial_end = iso(now_utc() + timedelta(days=days))
        else:
            expiry = iso(now_utc() + timedelta(days=30))
        clinic = {
            "id": cid, "name": spec["name"], "slug": spec["slug"], "logo_path": "",
            "address": "", "city": spec["city"], "phone": "", "email": spec["owner_email"],
            "owner_name": spec["owner_name"], "owner_email": spec["owner_email"],
            "timezone": "Asia/Makassar", "currency": "IDR",
            "operating_hours": {"mon":{"open":"09:00","close":"20:00"}},
            "subscription": {
                "plan": spec["plan"], "status": spec["status"],
                "trial_end": trial_end, "expiry_date": expiry,
                "started_at": iso(now_utc()),
            },
            "onboarded": True, "created_at": iso(now_utc()),
        }
        await db.clinics.insert_one(clinic)
        # Owner user
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": spec["owner_email"],
            "password_hash": hp("password123"), "name": spec["owner_name"],
            "role": "super_admin", "clinic_id": cid, "created_at": iso(now_utc()),
        })
        # Patients + a visit each
        for p in spec["patients"]:
            pid = str(uuid.uuid4())
            await db.patients.insert_one({
                "id": pid, "clinic_id": cid, **p, "created_at": iso(now_utc()),
            })
            vid = str(uuid.uuid4())
            await db.visits.insert_one({
                "id": vid, "clinic_id": cid, "patient_id": pid,
                "visit_type": "doctor", "status": "in_progress",
                "visit_date": iso(now_utc()), "created_at": iso(now_utc()),
                "chief_complaint": "Routine consultation",
            })
        print(f"seeded: {spec['name']} ({spec['plan']}/{spec['status']})")
    client.close()


asyncio.run(seed())
