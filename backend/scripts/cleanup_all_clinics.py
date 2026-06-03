"""One-time development/staging cleanup: delete all clinics and clinic-scoped data.

Safety:
- Dry-run counts first
- Requires exact confirmation phrase: DELETE ALL CLINICS
- Refuses to run in production-like environments
- Keeps platform-level collections/data untouched
- Preserves Super Admin / platform-admin users
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
CONFIRM_TEXT = "DELETE ALL CLINICS"

if not MONGO_URL or not DB_NAME:
    raise RuntimeError("MONGO_URL and DB_NAME are required")


# Never touch these platform-level collections.
PROTECTED_COLLECTIONS = {
    "bank_accounts",
    "platform_settings",
    "support_tickets",
    "plan_pricing",
    "plan_catalog",
    "pricing_catalog",
}

# Extra collections that are linked by visit_id and may not have clinic_id.
VISIT_LINKED_COLLECTIONS = (
    "clinical_records",
    "therapist_records",
    "performer_visit_notes",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_production_like() -> bool:
    env = (
        os.environ.get("APP_ENV")
        or os.environ.get("ENVIRONMENT")
        or os.environ.get("ENV")
        or os.environ.get("NODE_ENV")
        or ""
    ).strip().lower()
    return env in {"prod", "production", "live"}


async def _safe_count(coll, query: dict) -> int:
    try:
        return int(await coll.count_documents(query))
    except Exception:
        return 0


async def collect_dry_run(db, clinic_ids: List[str], visit_ids: List[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}

    # Users: keep super_admin/platform_admin accounts.
    user_delete_query = {
        "clinic_id": {"$in": clinic_ids},
        "role": {"$ne": "super_admin"},
        "platform_admin": {"$ne": True},
    }
    counts["users"] = await _safe_count(db.users, user_delete_query)
    counts["clinics"] = await _safe_count(db.clinics, {"id": {"$in": clinic_ids}})
    counts["audit_logs_clinic_scoped"] = await _safe_count(db.audit_logs, {"clinic_id": {"$in": clinic_ids}})

    for coll_name in VISIT_LINKED_COLLECTIONS:
        if coll_name in await db.list_collection_names():
            counts[coll_name] = await _safe_count(db[coll_name], {"visit_id": {"$in": visit_ids}})

    # Generic clinic_id scoped delete across all collections, with exclusions.
    exclusions = {"users", "clinics", "audit_logs", *VISIT_LINKED_COLLECTIONS, *PROTECTED_COLLECTIONS}
    for coll_name in await db.list_collection_names():
        if coll_name in exclusions:
            continue
        cnt = await _safe_count(db[coll_name], {"clinic_id": {"$in": clinic_ids}})
        if cnt > 0:
            counts[coll_name] = cnt

    counts["__total_to_delete"] = sum(v for k, v in counts.items() if not k.startswith("__"))
    return counts


async def execute_cleanup(db, clinic_ids: List[str], visit_ids: List[str]) -> Dict[str, int]:
    deleted: Dict[str, int] = {}

    for coll_name in VISIT_LINKED_COLLECTIONS:
        if coll_name not in await db.list_collection_names():
            continue
        try:
            res = await db[coll_name].delete_many({"visit_id": {"$in": visit_ids}})
            if res.deleted_count:
                deleted[coll_name] = int(res.deleted_count)
        except Exception:
            pass

    exclusions = {"users", "clinics", "audit_logs", *VISIT_LINKED_COLLECTIONS, *PROTECTED_COLLECTIONS}
    for coll_name in await db.list_collection_names():
        if coll_name in exclusions:
            continue
        try:
            res = await db[coll_name].delete_many({"clinic_id": {"$in": clinic_ids}})
            if res.deleted_count:
                deleted[coll_name] = int(res.deleted_count)
        except Exception:
            pass

    # Remove clinic-scoped logs only (keep platform/global logs).
    log_res = await db.audit_logs.delete_many({"clinic_id": {"$in": clinic_ids}})
    if log_res.deleted_count:
        deleted["audit_logs_clinic_scoped"] = int(log_res.deleted_count)

    user_res = await db.users.delete_many(
        {
            "clinic_id": {"$in": clinic_ids},
            "role": {"$ne": "super_admin"},
            "platform_admin": {"$ne": True},
        }
    )
    if user_res.deleted_count:
        deleted["users"] = int(user_res.deleted_count)

    clinic_res = await db.clinics.delete_many({"id": {"$in": clinic_ids}})
    deleted["clinics"] = int(clinic_res.deleted_count)

    deleted["__total_deleted"] = sum(v for k, v in deleted.items() if not k.startswith("__"))
    return deleted


async def main() -> int:
    if _is_production_like():
        print("Refusing to run: production-like environment detected.")
        return 1

    if os.environ.get("ALLOW_DEV_CLINIC_CLEANUP", "").strip() != "1":
        print("Refusing to run without ALLOW_DEV_CLINIC_CLEANUP=1")
        return 1

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        clinics = await db.clinics.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(10000)
        clinic_ids = [c["id"] for c in clinics if c.get("id")]
        visit_ids = [v["id"] async for v in db.visits.find({"clinic_id": {"$in": clinic_ids}}, {"_id": 0, "id": 1})]

        print("=" * 72)
        print("DRY RUN: CLEANUP ALL CLINICS")
        print("=" * 72)
        print(f"Database: {DB_NAME}")
        print(f"Clinics found: {len(clinic_ids)}")
        if clinics:
            for c in clinics[:20]:
                print(f" - {c.get('name') or 'Unnamed'} ({c.get('slug') or '-'})")
            if len(clinics) > 20:
                print(f" ... and {len(clinics) - 20} more")

        dry = await collect_dry_run(db, clinic_ids, visit_ids)
        print("\nCollections to delete (counts):")
        for key in sorted(k for k in dry.keys() if not k.startswith("__")):
            print(f" - {key}: {dry[key]}")
        print(f"\nTOTAL documents planned for delete: {dry['__total_to_delete']}")

        if not clinic_ids:
            print("\nNo clinics found. Nothing to clean.")
            return 0

        print("\nSafety notes:")
        print(" - Super Admin / platform-admin users are preserved.")
        print(" - Platform-level settings, plan pricing, and bank accounts are not touched.")
        print(" - Only clinic-scoped audit logs are removed.")
        print(f"\nType exactly '{CONFIRM_TEXT}' to continue.")
        typed = input("> ").strip()
        if typed != CONFIRM_TEXT:
            print("Aborted. Confirmation text did not match.")
            return 1

        deleted = await execute_cleanup(db, clinic_ids, visit_ids)
        audit_doc = {
            "id": f"cleanup-{_now_iso()}",
            "clinic_id": None,
            "user_id": "script.cleanup_all_clinics",
            "user_email": "script.cleanup_all_clinics",
            "action": "cleanup_all_clinics",
            "module": "platform_maintenance",
            "record_id": "",
            "reason": "Fresh start cleanup",
            "performed_by": "script.cleanup_all_clinics",
            "deleted_counts": deleted,
            "created_at": _now_iso(),
        }
        await db.audit_logs.insert_one(audit_doc)

        print("\n" + "=" * 72)
        print("CLEANUP COMPLETED")
        print("=" * 72)
        for key in sorted(k for k in deleted.keys() if not k.startswith("__")):
            print(f" - {key}: {deleted[key]}")
        print(f"\nTOTAL deleted: {deleted['__total_deleted']}")
        print(f"Remaining clinics: {await db.clinics.count_documents({})}")
        print(f"Remaining non-platform users: {await db.users.count_documents({'clinic_id': {'$exists': True}, 'role': {'$ne': 'super_admin'}})}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
