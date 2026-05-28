"""Seed demo patients + visits + treatment_items for Glow Aesthetic clinic
so the new patient-stats / transactions feature has data to show.

Run once: python seed_glow_patients.py
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")
from motor.motor_asyncio import AsyncIOMotorClient

CLINIC_SLUG = "glowclinic"

PATIENTS = [
    {"name": "Anya Pratiwi",   "phone": "081210000001", "email": "anya@example.com",  "gender": "female", "dob": "1990-04-12"},
    {"name": "Bayu Wijaya",    "phone": "081210000002", "email": "bayu@example.com",  "gender": "male",   "dob": "1985-09-21"},
    {"name": "Citra Dewi",     "phone": "081210000003", "email": "citra@example.com", "gender": "female", "dob": "1995-02-03"},
    {"name": "Dharma Putra",   "phone": "081210000004", "email": "dharma@example.com","gender": "male",   "dob": "1978-12-14"},
    {"name": "Eka Lestari",    "phone": "081210000005", "email": "eka@example.com",   "gender": "female", "dob": "1992-07-30"},
]

# Treatment menu (must match what the catalog auto-seeds)
TREATMENTS = [
    {"category": "facial",     "name": "Signature Facial",     "price": 450_000,   "duration_min": 60},
    {"category": "peel",       "name": "Chemical Peel",        "price": 600_000,   "duration_min": 45},
    {"category": "facial",     "name": "Microneedling",        "price": 850_000,   "duration_min": 60},
    {"category": "laser",      "name": "Laser Treatment",      "price": 1_200_000, "duration_min": 45},
    {"category": "injectable", "name": "Dermal Filler",        "price": 3_500_000, "duration_min": 45},
    {"category": "injectable", "name": "Anti-wrinkle (Toxin)", "price": 2_800_000, "duration_min": 30},
    {"category": "body",       "name": "Body Treatment / RF",  "price": 1_500_000, "duration_min": 75},
]


def iso(dt):
    return dt.isoformat()


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    clinic = await db.clinics.find_one({"slug": CLINIC_SLUG}, {"_id": 0})
    if not clinic:
        print(f"Clinic {CLINIC_SLUG} not found")
        return
    cid = clinic["id"]

    # Skip if already seeded
    existing = await db.patients.count_documents({"clinic_id": cid, "phone": {"$in": [p["phone"] for p in PATIENTS]}})
    if existing >= 3:
        print(f"{existing} demo patients already seeded; skipping.")
        client.close()
        return

    # Find doctor / therapist user ids for created_by
    doc_user = await db.users.find_one({"clinic_id": cid, "role": "doctor"}, {"_id": 0, "id": 1, "name": 1})
    ther_user = await db.users.find_one({"clinic_id": cid, "role": "therapist"}, {"_id": 0, "id": 1, "name": 1})
    fo_user = await db.users.find_one({"clinic_id": cid, "role": "fo"}, {"_id": 0, "id": 1, "name": 1})
    doc_id = (doc_user or {}).get("id", "system")
    ther_id = (ther_user or {}).get("id", "system")
    fo_id = (fo_user or {}).get("id", "system")
    now = datetime.now(timezone.utc)

    random.seed(42)
    for pdata in PATIENTS:
        pid = str(uuid.uuid4())
        await db.patients.insert_one({
            "id": pid,
            "clinic_id": cid,
            "full_name": pdata["name"],
            "phone": pdata["phone"],
            "email": pdata["email"],
            "gender": pdata["gender"],
            "dob": pdata["dob"],
            "allergies": "",
            "medical_history": "",
            "consent_signed": True,
            "created_by": fo_id,
            "created_at": iso(now - timedelta(days=random.randint(60, 365))),
        })
        # 2-4 visits per patient
        num_visits = random.randint(2, 4)
        for vidx in range(num_visits):
            vdate = now - timedelta(days=random.randint(7, 200))
            vid = str(uuid.uuid4())
            await db.visits.insert_one({
                "id": vid,
                "clinic_id": cid,
                "patient_id": pid,
                "patient_name": pdata["name"],
                "visit_type": random.choice(["consultation", "treatment", "follow_up"]),
                "chief_complaint": random.choice(["Acne concern", "Anti-aging consultation", "Skin brightening", "Pigmentation", "Routine check-up"]),
                "status": "completed",
                "visit_date": iso(vdate),
                "created_at": iso(vdate),
                "created_by": fo_id,
                "completed_at": iso(vdate + timedelta(hours=1)),
            })
            # 1-3 treatment items per visit
            num_items = random.randint(1, 3)
            chosen = random.sample(TREATMENTS, num_items)
            for t in chosen:
                await db.treatment_items.insert_one({
                    "id": str(uuid.uuid4()),
                    "clinic_id": cid,
                    "visit_id": vid,
                    "patient_id": pid,
                    "category": t["category"],
                    "name": t["name"],
                    "product_used": "",
                    "area_treated": random.choice(["face", "cheek", "forehead", "nose", "chin"]),
                    "quantity": 1,
                    "unit_type": "session",
                    "notes": "",
                    "price": t["price"],
                    "created_at": iso(vdate + timedelta(minutes=15)),
                    "created_by": ther_id,
                })
        print(f"  seeded: {pdata['name']} ({num_visits} visits)")

    client.close()
    print("Done.")


asyncio.run(main())
