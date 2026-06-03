"""Platform-wide settings for ClinicOS (single document in `platform_settings` collection)."""
from __future__ import annotations
import os
import struct
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Body


class PlatformSettingsIn(BaseModel):
    platform_name: Optional[str] = None
    support_whatsapp: Optional[str] = None
    support_hours: Optional[str] = None
    support_email: Optional[str] = None
    banks: Optional[List[Dict[str, Any]]] = None
    plan_overrides: Optional[Dict[str, Any]] = None
    platform_branding: Optional[Dict[str, Any]] = None


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
        "platform_branding": {
            "app_name": "ClinicOS",
            "short_name": "ClinicOS",
            "description": "Clinic management system",
            "favicon_url": "",
            "app_icon_192_url": "",
            "app_icon_512_url": "",
            "maskable_icon_url": "",
            "login_logo_url": "",
            "sidebar_logo_url": "",
            "theme_color": "#3F5A52",
            "background_color": "#FDFBF7",
            "updated_by": "",
            "updated_at": None,
        },
    }


def merged_platform_branding(s: dict) -> dict:
    defaults = default_settings("", "")["platform_branding"]
    return {**defaults, **((s or {}).get("platform_branding") or {})}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_hex_color(value: Optional[str], fallback: str) -> str:
    v = str(value or "").strip()
    if not v:
        return fallback
    if len(v) == 4 and v.startswith("#"):
        return "#" + "".join(ch * 2 for ch in v[1:])
    if len(v) == 7 and v.startswith("#"):
        return v
    raise HTTPException(status_code=400, detail="Color must be #RRGGBB or #RGB")


def _png_dimensions(data: bytes) -> Optional[tuple[int, int]]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">I", data[16:20])[0], struct.unpack(">I", data[20:24])[0]


def _validate_uploaded_asset(asset_type: str, filename: str, content_type: str, data: bytes, max_upload_bytes: int):
    if len(data) > max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum {max_upload_bytes // (1024 * 1024)} MB.")
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    ct = (content_type or "").lower()
    if "javascript" in ct or "html" in ct:
        raise HTTPException(status_code=400, detail="Invalid file type")
    if asset_type == "favicon":
        if ext not in {"ico", "png", "svg"}:
            raise HTTPException(status_code=400, detail="Favicon must be .ico, .png, or .svg")
        return
    if asset_type in {"app_icon_192", "app_icon_512", "maskable_icon", "login_logo", "sidebar_logo"}:
        if ext != "png":
            raise HTTPException(status_code=400, detail="Icon/logo upload must be PNG")
        dims = _png_dimensions(data)
        if not dims:
            raise HTTPException(status_code=400, detail="PNG file is invalid")
        w, h = dims
        if asset_type == "app_icon_192" and (w != 192 or h != 192):
            raise HTTPException(status_code=400, detail="App Icon 192 must be exactly 192x192")
        if asset_type == "app_icon_512" and (w != 512 or h != 512):
            raise HTTPException(status_code=400, detail="App Icon 512 must be exactly 512x512")
        if asset_type == "maskable_icon" and w != h:
            raise HTTPException(status_code=400, detail="Maskable icon must be square")
        return
    raise HTTPException(status_code=400, detail="Unknown branding asset type")


async def get_platform_settings(db, SUPPORT_WHATSAPP: str, SUPPORT_HOURS: str) -> dict:
    s = await db.platform_settings.find_one({"id": "platform"}, {"_id": 0})
    if not s:
        s = default_settings(SUPPORT_WHATSAPP, SUPPORT_HOURS)
        await db.platform_settings.insert_one(s)
    if "platform_branding" not in s:
        s["platform_branding"] = default_settings("", "")["platform_branding"]
    return s


def merged_plans(PLAN_CATALOG: dict, plan_overrides: dict) -> list:
    out = []
    for key, p in PLAN_CATALOG.items():
        merged = dict(p)
        ov = (plan_overrides or {}).get(key) or {}
        for f in ("price_idr", "max_staff", "storage_gb"):
            if f in ov and ov[f] is not None:
                merged[f] = ov[f]
        out.append(merged)
    return out


def register_platform_settings(api: APIRouter, db, get_current_user, audit, PLAN_CATALOG, SUPPORT_WHATSAPP: str, SUPPORT_HOURS: str, APP_NAME: str, put_object):
    async def admin_dep(user: dict = Depends(get_current_user)):
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin only")
        return user

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
            "platform_branding": merged_platform_branding(s),
        }

    @api.get("/platform/branding")
    async def public_platform_branding():
        s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        return merged_platform_branding(s)

    @api.get("/superadmin/platform/branding")
    async def sa_get_platform_branding(_user: dict = Depends(admin_dep)):
        s = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        return merged_platform_branding(s)

    @api.put("/superadmin/platform/branding")
    async def sa_update_platform_branding(payload: Dict[str, Any] = Body(...), user: dict = Depends(admin_dep)):
        current = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        merged = merged_platform_branding(current)
        allowed = {
            "app_name", "short_name", "description",
            "favicon_url", "app_icon_192_url", "app_icon_512_url", "maskable_icon_url",
            "login_logo_url", "sidebar_logo_url", "theme_color", "background_color",
        }
        for key, value in (payload or {}).items():
            if key not in allowed:
                continue
            if key in {"theme_color", "background_color"}:
                merged[key] = _normalize_hex_color(value, merged[key])
            elif key in {"app_name", "short_name", "description"}:
                merged[key] = str(value or "").strip()[:120]
            else:
                merged[key] = str(value or "").strip()
        merged["updated_by"] = user.get("email") or "platform-admin"
        merged["updated_at"] = _iso_now()
        await db.platform_settings.update_one({"id": "platform"}, {"$set": {"platform_branding": merged}}, upsert=True)
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "platform_branding_updated",
            "platform_settings",
            "platform",
            {"fields": sorted([k for k in payload.keys() if k in allowed])},
        )
        return merged

    @api.post("/superadmin/platform/branding/upload")
    async def sa_upload_platform_branding_asset(asset_type: str = Form(...), file: UploadFile = File(...), user: dict = Depends(admin_dep)):
        max_upload_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
        data = await file.read()
        _validate_uploaded_asset(asset_type, file.filename or "", file.content_type or "", data, max_upload_bytes)
        ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
        object_path = f"{APP_NAME}/platform/branding/{asset_type}-{uuid.uuid4()}.{ext}"
        try:
            result = put_object(object_path, data, file.content_type or ("image/x-icon" if ext == "ico" else f"image/{ext}"))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail="Branding asset upload failed")
        field_by_asset = {
            "favicon": "favicon_url",
            "app_icon_192": "app_icon_192_url",
            "app_icon_512": "app_icon_512_url",
            "maskable_icon": "maskable_icon_url",
            "login_logo": "login_logo_url",
            "sidebar_logo": "sidebar_logo_url",
        }
        field = field_by_asset.get(asset_type)
        if not field:
            raise HTTPException(status_code=400, detail="Unknown branding asset type")

        current = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
        branding = merged_platform_branding(current)
        branding[field] = result.get("file_url") or ""
        branding["updated_by"] = user.get("email") or "platform-admin"
        branding["updated_at"] = _iso_now()
        await db.platform_settings.update_one({"id": "platform"}, {"$set": {"platform_branding": branding}}, upsert=True)
        await db.photos.insert_one({
            "id": str(uuid.uuid4()),
            "visit_id": "",
            "patient_id": "",
            "clinic_id": None,
            "storage_path": result.get("path"),
            "photo_type": "platform_branding",
            "angle": asset_type,
            "content_type": file.content_type or "",
            "size_bytes": len(data),
            "uploaded_by": user.get("id", "platform-admin"),
            "created_at": _iso_now(),
        })
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "platform_branding_asset_uploaded",
            "platform_settings",
            "platform",
            {"asset_type": asset_type},
        )
        return {"asset_type": asset_type, "field": field, "url": branding[field], "updated_at": branding["updated_at"]}

    @api.get("/superadmin/platform-settings")
    async def sa_get_settings(_user: dict = Depends(admin_dep)):
        return await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)

    @api.put("/superadmin/platform-settings")
    async def sa_update_settings(payload: PlatformSettingsIn, user: dict = Depends(admin_dep)):
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "banks" in upd:
            for b in upd["banks"]:
                if not b.get("id"):
                    b["id"] = str(uuid.uuid4())
            if upd["banks"] and not any(b.get("active") for b in upd["banks"]):
                raise HTTPException(status_code=400, detail="At least one bank account must remain active")
        if "plan_overrides" in upd:
            valid_keys = set(PLAN_CATALOG.keys())
            for k in list(upd["plan_overrides"].keys()):
                if k not in valid_keys:
                    raise HTTPException(status_code=400, detail=f"Unknown plan key '{k}'")
        if "platform_branding" in upd:
            current = await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
            branding = merged_platform_branding(current)
            branding.update({k: v for k, v in (upd.get("platform_branding") or {}).items() if v is not None})
            branding["theme_color"] = _normalize_hex_color(branding.get("theme_color"), "#3F5A52")
            branding["background_color"] = _normalize_hex_color(branding.get("background_color"), "#FDFBF7")
            branding["updated_by"] = user.get("email") or "platform-admin"
            branding["updated_at"] = _iso_now()
            upd["platform_branding"] = branding
        await db.platform_settings.update_one({"id": "platform"}, {"$set": upd}, upsert=True)
        await audit(
            {"id": "platform-admin", "email": user["email"], "role": "platform_admin", "clinic_id": None},
            "bank_account_changed" if "banks" in upd else ("platform_branding_updated" if "platform_branding" in upd else "update_platform_settings"),
            "platform_settings",
            "platform",
            {"fields": list(upd.keys())},
        )
        return await get_platform_settings(db, SUPPORT_WHATSAPP, SUPPORT_HOURS)
