"""Platform-wide settings for ClinicOS (single document in `platform_settings` collection).

Read by both clinic-side endpoints (public-config, plans, support) and the Super Admin
portal (full settings management).
"""
from __future__ import annotations
import uuid
from typing import Optional, List, Dict, Any

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException


# ---------------- Models ----------------
class BankAccountIn(BaseModel):
    bank: str
    account_number: str
    account_holder: str
    active: bool = True
    note: Optional[str] = ""


class PlanOverrideIn(BaseModel):
    price_idr: Optional[int] = None
    max_staff: Optional[int] = None
    storage_gb: Optional[int] = None


class PlatformSettingsIn(BaseModel):
    platform_name: Optional[str] = None
    support_whatsapp: Optional[str] = None
    support_hours: Optional[str] = None
    support_email: Optional[str] = None
    banks: Optional[List[Dict[str, Any]]] = None  # list of bank account objects (incl id)
    plan_overrides: Optional[Dict[str, Any]] = None  # {plan_key: {price_idr?, max_staff?, storage_gb?}}


def default_settings(SUPPORT_WHATSAPP: str, SUPPORT_HOURS: str) -> dict:
    return {
        "id": "platform",
        "platform_name": "ClinicOS",
        "support_whatsapp": SUPPORT_WHATSAPP,
        "support_hours": SUPPORT_HOURS,
        "support_email": "support@clinicos.id",
        "banks": [
            {"id": str(uuid.uuid4()), "bank": "BCA", "account_number": "1234567890", "account_holder": "PT ClinicOS Indonesia", "active": True, "note": ""},
            {"id": str(uuid.uuid4()), "bank": "Mandiri", "account_number": "0987654321", "account_holder": "PT ClinicOS Indonesia", "active": True, "note": ""},
        ],
        "plan_overrides": {},
    }


async def get_platform_settings(db, SUPPORT_WHATSAPP: str, SUPPORT_HOURS: str) -> dict:
    s = await db.platform_settings.find_one({"id": "platform"}, {"_id": 0})
    if not s:
        s = default_settings(SUPPORT_WHATSAPP, SUPPORT_HOURS)
        await db.platform_settings.insert_one(s)
    return s


def merged_plans(PLAN_CATALOG: dict, plan_overrides: dict) -> list:
    """Return the public plan list with platform overrides merged in."""
    out = []
    for key, p in PLAN_CATALOG.items():
        merged = dict(p)
        ov = (plan_overrides or {}).get(key) or {}
        for f in ("price_idr", "max_staff", "storage_gb"):
            if f in ov and ov[f] is not None:
                merged[f] = ov[f]
        out.append(merged)
    return out


def register_platform_settings(api: APIRouter, db, get_current_user, audit, PLAN_CATALOG, SUPPORT_WHATSAPP: str, SUPPORT_HOURS: str):
    """Wire platform settings + public-config endpoints onto the /api router."""

    async def admin_dep(user: dict = Depends(get_current_user)):
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")
        return user

    # ---------- Public config (no auth) ----------
    @api.get("/platform/public-config")
    async def public_config():
        s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        active_banks = [b for b in (s.get("banks") or []) if b.get("active")]
        return {
            "platform_name": s.get("platform_name", "ClinicOS"),
            "support": {
                "whatsapp": s.get("support_whatsapp", ""),
                "hours": s.get("support_hours", ""),
                "email": s.get("support_email", ""),
            },
            "banks": active_banks,
        }

    # ---------- Super Admin: read full settings ----------
    @api.get("/superadmin/platform-settings")
    async def sa_get_settings(_user: dict = Depends(admin_dep)):
        s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        return s

    # ---------- Super Admin: update settings ----------
    @api.put("/superadmin/platform-settings")
    async def sa_update_settings(payload: PlatformSettingsIn, user: dict = Depends(admin_dep)):
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        # Banks: ensure id, and refuse zero active banks (always keep at least one)
        if "banks" in upd:
            for b in upd["banks"]:
                if not b.get("id"):
                    b["id"] = str(uuid.uuid4())
            if upd["banks"] and not any(b.get("active") for b in upd["banks"]):
                raise HTTPException(status_code=400, detail="At least one bank account must remain active")
        # Plan overrides: only accept known plan keys
        if "plan_overrides" in upd:
            valid_keys = set(PLAN_CATALOG.keys())
            for k in list(upd["plan_overrides"].keys()):
                if k not in valid_keys:
                    raise HTTPException(status_code=400, detail=f"Unknown plan key '{k}'")
        await db.platform_settings.update_one(
            {"id": "platform"},
            {"$set": upd},
            upsert=True,
        )
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "update", "platform_settings", "platform",
            {"fields": list(upd.keys())},
        )
        return await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
