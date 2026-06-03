"""Clinic staff account settings (profile, email, password, clinic security policy)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from clinic_user_2fa import can_use_clinic_2fa, get_clinic_security_settings
import totp_2fa as t2fa

ROLE_LABELS = {
    "super_admin": "Owner",
    "manager": "Manager",
    "fo": "Front Office",
    "doctor": "Doctor",
    "therapist": "Therapist",
    "nurse": "Nurse",
}


class AccountProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    phone: Optional[str] = None


class AccountEmailChangeIn(BaseModel):
    new_email: EmailStr
    current_password: str


class AccountPasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)
    confirm_new_password: str


class SecuritySettingsIn(BaseModel):
    require_2fa_for_owner_manager: bool = False


def register_clinic_account(
    api: APIRouter,
    db,
    *,
    get_current_user,
    audit,
    verify_password,
    hash_password,
    scope,
    user_has_permission,
    assert_writeable,
    attach_permissions_to_user,
    invalidate_user_sessions=None,
):
    def _account_user(user: dict = Depends(get_current_user)) -> dict:
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Use Super Admin account settings")
        return user

    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    async def _account_response(db_user: dict, clinic: Optional[dict]) -> dict:
        stored = db_user.get("totp_recovery_codes") or []
        sec = await get_clinic_security_settings(db, db_user.get("clinic_id"))
        role = db_user.get("role") or ""
        return {
            "id": db_user["id"],
            "full_name": db_user.get("name") or "",
            "email": db_user.get("email") or "",
            "phone": db_user.get("phone") or "",
            "job_title": db_user.get("job_title") or "",
            "role": role,
            "role_label": db_user.get("role_name") or ROLE_LABELS.get(role, role),
            "clinic_id": db_user.get("clinic_id"),
            "clinic_name": (clinic or {}).get("name") or "",
            "totp_enabled": t2fa.is_2fa_enabled(db_user),
            "recovery_codes_remaining": t2fa.recovery_codes_remaining(stored) if t2fa.is_2fa_enabled(db_user) else 0,
            "can_use_2fa": can_use_clinic_2fa(db_user),
            "require_2fa_for_owner_manager": bool(sec.get("require_2fa_for_owner_manager")),
        }

    @api.get("/account/me")
    async def get_account_me(user: dict = Depends(_account_user)):
        db_user = await db.users.find_one(scope(user, {"id": user["id"]}), {"_id": 0, "password_hash": 0})
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        clinic = None
        if db_user.get("clinic_id"):
            clinic = await db.clinics.find_one({"id": db_user["clinic_id"]}, {"_id": 0, "name": 1})
        return await _account_response(db_user, clinic)

    @api.put("/account/profile")
    async def update_account_profile(payload: AccountProfileIn, user: dict = Depends(_account_user)):
        name = payload.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Full name is required")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"name": name, "phone": (payload.phone or "").strip(), "updated_at": _now_iso()}},
        )
        await audit(
            user,
            "profile_updated",
            "user_account",
            user["id"],
            new_value={"full_name": name, "phone": (payload.phone or "").strip()},
        )
        db_user = await db.users.find_one(scope(user, {"id": user["id"]}), {"_id": 0, "password_hash": 0})
        clinic = await db.clinics.find_one({"id": db_user["clinic_id"]}, {"_id": 0, "name": 1}) if db_user.get("clinic_id") else None
        return await _account_response(db_user, clinic)

    @api.put("/account/email")
    async def update_account_email(payload: AccountEmailChangeIn, user: dict = Depends(_account_user)):
        await audit(
            user,
            "email_change_attempt",
            "user_account",
            user["id"],
            new_value={"new_email": str(payload.new_email).strip().lower()},
        )
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(payload.current_password, db_user.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        old_email = (db_user.get("email") or "").lower()
        new_email = str(payload.new_email).strip().lower()
        if new_email == old_email:
            raise HTTPException(status_code=400, detail="New email must be different")
        existing = await db.users.find_one({"email": new_email, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=400, detail="Email is already in use")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"email": new_email, "updated_at": _now_iso()}},
        )
        await audit(
            user,
            "account_email_changed",
            "user_account",
            user["id"],
            old_value={"old_email": old_email},
            new_value={"new_email": new_email},
        )
        return {"ok": True, "message": "Email updated. Use the new email next time you sign in."}

    @api.put("/account/password")
    async def update_account_password(payload: AccountPasswordChangeIn, user: dict = Depends(_account_user)):
        if payload.new_password != payload.confirm_new_password:
            raise HTTPException(status_code=400, detail="New password and confirmation do not match")
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(payload.current_password, db_user.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if len(payload.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        if verify_password(payload.new_password, db_user.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": _now_iso()}},
        )
        if invalidate_user_sessions:
            await invalidate_user_sessions(db, user["id"])
        await audit(user, "password_changed", "user_account", user["id"])
        return {"ok": True, "message": "Password updated successfully."}

    @api.post("/account/change-password")
    async def change_account_password(payload: AccountPasswordChangeIn, user: dict = Depends(_account_user)):
        return await update_account_password(payload, user)

    @api.get("/settings/security")
    async def get_security_settings(user: dict = Depends(get_current_user)):
        if user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Only clinic owner can view security settings")
        sec = await get_clinic_security_settings(db, user.get("clinic_id"))
        return {"require_2fa_for_owner_manager": bool(sec.get("require_2fa_for_owner_manager"))}

    @api.put("/admin/settings/security")
    async def update_security_settings(payload: SecuritySettingsIn, user: dict = Depends(get_current_user)):
        if user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Only clinic owner can update security settings")
        await assert_writeable(user)
        await db.settings.update_one(
            scope(user, {"id": "global"}),
            {"$set": {"security": {"require_2fa_for_owner_manager": payload.require_2fa_for_owner_manager}}},
            upsert=True,
        )
        await db.settings.update_one(scope(user, {"id": "global"}), {"$set": {"clinic_id": user.get("clinic_id")}})
        await audit(
            user,
            "clinic_security_settings_updated",
            "settings",
            "global",
            new_value={"require_2fa_for_owner_manager": payload.require_2fa_for_owner_manager},
        )
        return await get_security_settings(user)
