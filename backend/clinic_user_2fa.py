"""Clinic user TOTP 2FA (optional for all clinic users)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

import totp_2fa as t2fa

CLINIC_FERNET_PREFIX = "clinic-2fa"
CLINIC_CHALLENGE_TYPE = "clinic_2fa_challenge"
CLINIC_2FA_ROLES = frozenset({"super_admin", "manager", "fo", "doctor", "therapist", "nurse", "accounting"})


def can_use_clinic_2fa(user: dict) -> bool:
    if not user or user.get("platform_admin"):
        return False
    if user.get("impersonating"):
        return False
    return user.get("role") in CLINIC_2FA_ROLES


def _encrypt(secret: str) -> str:
    return t2fa.encrypt_totp_secret(secret, prefix=CLINIC_FERNET_PREFIX)


def _decrypt(encrypted: str) -> str:
    return t2fa.decrypt_totp_secret(encrypted, prefix=CLINIC_FERNET_PREFIX)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_clinic_security_settings(db, clinic_id: str) -> dict:
    if not clinic_id:
        return {}
    doc = await db.settings.find_one({"clinic_id": clinic_id, "id": "global"}, {"_id": 0, "security": 1})
    return (doc or {}).get("security") or {}


async def assert_clinic_role_2fa_policy(db, user: dict) -> None:
    """Block login when clinic requires 2FA for Owner/Manager but user has not enabled it."""
    if user.get("role") not in CLINIC_2FA_ROLES:
        return
    sec = await get_clinic_security_settings(db, user.get("clinic_id"))
    if not sec.get("require_2fa_for_owner_manager"):
        return
    if t2fa.is_2fa_enabled(user):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            "This clinic requires two-factor authentication for Owner and Manager accounts. "
            "Ask your clinic owner to enable 2FA in Account Settings → Security, or sign in with an account that has it enabled."
        ),
    )


class TotpCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)


class TotpDisableIn(BaseModel):
    current_password: str
    code: str = Field(min_length=6, max_length=12)


class RecoveryRegenerateIn(BaseModel):
    current_password: str
    code: str = Field(min_length=6, max_length=12)


class ChallengeVerifyIn(BaseModel):
    challenge_token: str
    code: str = Field(min_length=6, max_length=12)


class ChallengeRecoveryIn(BaseModel):
    challenge_token: str
    recovery_code: str


def register_clinic_user_2fa(
    api: APIRouter,
    db,
    *,
    audit,
    verify_password,
    create_token,
    get_current_user,
    attach_permissions_to_user,
    ensure_clinic_roles,
    iso,
    now_utc,
    user_has_permission,
):
    def _require_2fa_user(user: dict = Depends(get_current_user)) -> dict:
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Not available for platform admin")
        if not can_use_clinic_2fa(user):
            raise HTTPException(status_code=403, detail="Two-factor authentication is not available for this account")
        return user

    def _set_access_cookie(response: Response, token: str) -> None:
        response.set_cookie(
            "access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/",
        )

    async def _build_login_user(db_user: dict) -> dict:
        if db_user.get("clinic_id"):
            await ensure_clinic_roles(db, db_user["clinic_id"])
        me_user = await attach_permissions_to_user(db, db_user)
        is_platform_admin = bool(me_user.get("platform_admin")) or me_user.get("role") == "platform_admin"
        return {
            "id": me_user["id"],
            "email": me_user["email"],
            "name": me_user.get("name") or me_user.get("full_name") or "",
            "role": me_user["role"],
            "clinic_id": me_user.get("clinic_id"),
            "platform_admin": is_platform_admin,
            "role_id": me_user.get("role_id"),
            "role_name": me_user.get("role_name"),
            "role_key": me_user.get("role_key"),
            "permissions": me_user.get("permissions", []),
        }

    async def _complete_login(response: Response, db_user: dict) -> dict:
        token = create_token(
            db_user["id"],
            db_user["email"],
            db_user["role"],
            clinic_id=db_user.get("clinic_id"),
            auth_version=int(db_user.get("auth_version") or 0),
            platform_admin=False,
        )
        _set_access_cookie(response, token)
        await t2fa.clear_failed_attempts(db, db_user["id"])
        await db.users.update_one({"id": db_user["id"]}, {"$set": {"last_login_at": iso(now_utc())}})
        await audit(db_user, "login", "auth")
        user_out = await _build_login_user(db_user)
        return {"token": token, "user": user_out}

    @api.get("/account/2fa")
    async def clinic_2fa_status(user: dict = Depends(_require_2fa_user)):
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        stored = (db_user or {}).get("totp_recovery_codes") or []
        return {
            "enabled": t2fa.is_2fa_enabled(db_user or {}),
            "recovery_codes_remaining": t2fa.recovery_codes_remaining(stored) if t2fa.is_2fa_enabled(db_user or {}) else 0,
            "can_enable": can_use_clinic_2fa(user),
        }

    @api.post("/account/2fa/setup")
    async def clinic_2fa_setup(user: dict = Depends(_require_2fa_user)):
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if t2fa.is_2fa_enabled(db_user or {}):
            raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
        secret = t2fa.generate_totp_secret()
        email = db_user.get("email") or "user@clinicos.id"
        uri = t2fa.totp_provisioning_uri(secret, email)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"totp_pending_secret_encrypted": _encrypt(secret), "updated_at": _now_iso()}},
        )
        return {
            "manual_setup_key": secret,
            "provisioning_uri": uri,
            "qr_code_data_uri": t2fa.qr_code_data_uri(uri),
        }

    @api.post("/account/2fa/enable")
    async def clinic_2fa_enable(payload: TotpCodeIn, user: dict = Depends(_require_2fa_user)):
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if t2fa.is_2fa_enabled(db_user or {}):
            raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
        pending = (db_user or {}).get("totp_pending_secret_encrypted")
        if not pending:
            raise HTTPException(status_code=400, detail="Start setup before enabling 2FA")
        secret = _decrypt(pending)
        if not t2fa.verify_totp_code(secret, payload.code):
            await audit(user, "clinic_2fa_failed", "user_account", user["id"], reason="enable_verification_failed")
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        plain_codes = t2fa.generate_recovery_codes()
        stored_codes = [{"hash": t2fa.hash_recovery_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]
        now = _now_iso()
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "totp_enabled": True,
                "totp_secret_encrypted": _encrypt(secret),
                "totp_pending_secret_encrypted": None,
                "totp_recovery_codes": stored_codes,
                "totp_enabled_at": now,
                "updated_at": now,
            }},
        )
        await audit(user, "clinic_2fa_enabled", "user_account", user["id"])
        return {
            "ok": True,
            "recovery_codes": plain_codes,
            "message": "Two-factor authentication enabled. Save your recovery codes in a secure place.",
        }

    @api.post("/account/2fa/disable")
    async def clinic_2fa_disable(payload: TotpDisableIn, user: dict = Depends(_require_2fa_user)):
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if not t2fa.is_2fa_enabled(db_user or {}):
            raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
        sec = await get_clinic_security_settings(db, user.get("clinic_id"))
        if sec.get("require_2fa_for_owner_manager"):
            raise HTTPException(
                status_code=400,
                detail="Your clinic requires two-factor authentication for Owner and Manager. It cannot be disabled.",
            )
        if not verify_password(payload.current_password, (db_user or {}).get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        secret = await t2fa.load_totp_secret(db_user, prefix=CLINIC_FERNET_PREFIX)
        if not t2fa.verify_totp_code(secret, payload.code):
            await t2fa.record_failed_attempt(db, user["id"])
            await audit(user, "clinic_2fa_failed", "user_account", user["id"], reason="disable_verification_failed")
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "totp_enabled": False,
                "totp_secret_encrypted": None,
                "totp_pending_secret_encrypted": None,
                "totp_recovery_codes": [],
                "totp_failed_attempts": [],
                "updated_at": _now_iso(),
            }},
        )
        await audit(user, "clinic_2fa_disabled", "user_account", user["id"])
        return {"ok": True, "message": "Two-factor authentication disabled."}

    @api.post("/account/2fa/recovery-codes/regenerate")
    async def clinic_2fa_regenerate(payload: RecoveryRegenerateIn, user: dict = Depends(_require_2fa_user)):
        db_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        if not t2fa.is_2fa_enabled(db_user or {}):
            raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
        if not verify_password(payload.current_password, (db_user or {}).get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        secret = await t2fa.load_totp_secret(db_user, prefix=CLINIC_FERNET_PREFIX)
        if not t2fa.verify_totp_code(secret, payload.code):
            await t2fa.record_failed_attempt(db, user["id"])
            await audit(user, "clinic_2fa_failed", "user_account", user["id"], reason="recovery_regenerate_failed")
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        plain_codes = t2fa.generate_recovery_codes()
        stored_codes = [{"hash": t2fa.hash_recovery_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"totp_recovery_codes": stored_codes, "updated_at": _now_iso()}},
        )
        await audit(user, "clinic_2fa_recovery_codes_regenerated", "user_account", user["id"])
        return {"ok": True, "recovery_codes": plain_codes}

    @api.post("/auth/clinic-2fa/verify")
    async def auth_clinic_2fa_verify(payload: ChallengeVerifyIn, response: Response):
        challenge = t2fa.decode_challenge_token(payload.challenge_token, challenge_type=CLINIC_CHALLENGE_TYPE)
        user_id = challenge["sub"]
        await t2fa.assert_not_locked(db, user_id)
        db_user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not db_user or not t2fa.is_2fa_enabled(db_user):
            raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
        secret = await t2fa.load_totp_secret(db_user, prefix=CLINIC_FERNET_PREFIX)
        if not t2fa.verify_totp_code(secret, payload.code):
            count = await t2fa.record_failed_attempt(db, user_id)
            await audit(
                {"id": user_id, "email": db_user.get("email"), "role": db_user.get("role"), "clinic_id": db_user.get("clinic_id")},
                "clinic_2fa_failed",
                "user_account",
                user_id,
                reason="login_verification_failed",
                meta={"attempt_count": count},
            )
            raise HTTPException(status_code=400, detail="Invalid authenticator code")
        return await _complete_login(response, db_user)

    @api.post("/auth/clinic-2fa/recovery")
    async def auth_clinic_2fa_recovery(payload: ChallengeRecoveryIn, response: Response):
        challenge = t2fa.decode_challenge_token(payload.challenge_token, challenge_type=CLINIC_CHALLENGE_TYPE)
        user_id = challenge["sub"]
        await t2fa.assert_not_locked(db, user_id)
        db_user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not db_user or not t2fa.is_2fa_enabled(db_user):
            raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
        stored = list(db_user.get("totp_recovery_codes") or [])
        idx = t2fa.verify_recovery_code(payload.recovery_code, stored)
        if idx is None:
            count = await t2fa.record_failed_attempt(db, user_id)
            await audit(
                {"id": user_id, "email": db_user.get("email"), "role": db_user.get("role"), "clinic_id": db_user.get("clinic_id")},
                "clinic_2fa_failed",
                "user_account",
                user_id,
                reason="recovery_login_failed",
                meta={"attempt_count": count},
            )
            raise HTTPException(status_code=400, detail="Invalid recovery code")
        stored[idx]["used_at"] = _now_iso()
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"totp_recovery_codes": stored, "updated_at": _now_iso()}},
        )
        await audit(
            {"id": user_id, "email": db_user.get("email"), "role": db_user.get("role"), "clinic_id": db_user.get("clinic_id")},
            "clinic_2fa_recovery_used",
            "user_account",
            user_id,
        )
        return await _complete_login(response, db_user)
