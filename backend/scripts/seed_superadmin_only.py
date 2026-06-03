"""Seed or rotate the platform superadmin account only.

This script is safe for production use:
- does not create demo clinics
- does not create demo users
- only upserts the platform-admin account from environment variables
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from pymongo import MongoClient


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "").strip()
DB_NAME = os.environ.get("DB_NAME", "").strip()
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "").strip().lower()
SUPER_ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    if not MONGO_URL or not DB_NAME:
        raise SystemExit("MONGO_URL and DB_NAME are required")
    if not SUPER_ADMIN_EMAIL or not SUPER_ADMIN_PASSWORD:
        raise SystemExit("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required")

    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    doc = {
        "id": "platform-admin",
        "email": SUPER_ADMIN_EMAIL,
        "name": "Platform Admin",
        "role": "platform_admin",
        "platform_admin": True,
        "password_hash": hash_password(SUPER_ADMIN_PASSWORD),
        "updated_at": now_iso(),
    }
    db.users.update_one(
        {"id": "platform-admin"},
        {"$set": doc, "$setOnInsert": {"created_at": now_iso()}},
        upsert=True,
    )
    print(f"OK: seeded platform-admin account for {SUPER_ADMIN_EMAIL}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
