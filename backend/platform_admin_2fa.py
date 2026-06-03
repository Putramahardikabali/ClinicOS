"""Super Admin TOTP 2FA (platform admin only)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

import totp_2fa as t2fa

PLATFORM_FERNET_PREFIX = "platform-2fa"
PLATFORM_CHALLENGE_TYPE = "platform_2fa_challenge"

encrypt_totp_secret = lambda secret: t2fa.encrypt_totp_secret(secret, prefix=PLATFORM_FERNET_PREFIX)
decrypt_totp_secret = lambda encrypted: t2fa.decrypt_totp_secret(encrypted, prefix=PLATFORM_FERNET_PREFIX)
is_2fa_enabled = t2fa.is_2fa_enabled
generate_totp_secret = t2fa.generate_totp_secret
totp_provisioning_uri = t2fa.totp_provisioning_uri
qr_code_data_uri = t2fa.qr_code_data_uri
verify_totp_code = t2fa.verify_totp_code
generate_recovery_codes = t2fa.generate_recovery_codes
hash_recovery_code = t2fa.hash_recovery_code
verify_recovery_code = t2fa.verify_recovery_code
recovery_codes_remaining = t2fa.recovery_codes_remaining


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_challenge_token(user_id: str, email: str) -> str:
    return t2fa.create_challenge_token(user_id, email, challenge_type=PLATFORM_CHALLENGE_TYPE)


def decode_challenge_token(token: str) -> dict:
    return t2fa.decode_challenge_token(token, challenge_type=PLATFORM_CHALLENGE_TYPE)


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


def platform_admin_login_payload(platform_user: dict, *, create_token_fn, set_cookie_fn) -> dict:
    """Return login JSON; defer access token if 2FA enabled."""
    if is_2fa_enabled(platform_user):
        return {
            "requires_2fa": True,
            "challenge_token": create_challenge_token(platform_user["id"], platform_user["email"]),
            "user": {
                "id": platform_user["id"],
                "email": platform_user["email"],
                "name": platform_user.get("name") or "Platform Admin",
                "role": "platform_admin",
                "platform_admin": True,
            },
        }
    token = create_token_fn(
        platform_user["id"],
        platform_user["email"],
        "platform_admin",
        clinic_id=None,
        platform_admin=True,
        auth_version=int(platform_user.get("auth_version") or 0),
    )
    set_cookie_fn(token)
    return {
        "requires_2fa": False,
        "token": token,
        "user": {
            "id": platform_user["id"],
            "email": platform_user["email"],
            "name": platform_user.get("name") or "Platform Admin",
            "role": "platform_admin",
            "platform_admin": True,
        },
    }


def register_platform_admin_2fa(
    api: APIRouter,
    db,
    *,
    audit,
    verify_password,
    hash_password,
    create_token,
    ensure_platform_admin_user,
    admin_dep,
):
    def _set_access_cookie(response: Response, token: str) -> None:
        response.set_cookie(
            "access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/",
        )

    async def _complete_login(response: Response, platform_user: dict) -> dict:
        token = create_token(
            platform_user["id"],
            platform_user["email"],
            "platform_admin",
            clinic_id=None,
            platform_admin=True,
            auth_version=int(platform_user.get("auth_version") or 0),
        )
        _set_access_cookie(response, token)
        await t2fa.clear_failed_attempts(db, platform_user["id"])
        return {
            "token": token,
            "user": {
                "id": platform_user["id"],
                "email": platform_user["email"],
                "name": platform_user.get("name") or "Platform Admin",
                "role": "platform_admin",
                "platform_admin": True,
            },
        }

    @api.get("/superadmin/account/2fa")
    async def sa_2fa_status(user: dict = Depends(admin_dep)):
        db_user = await ensure_platform_admin_user(user)
        stored = db_user.get("totp_recovery_codes") or []
        return {
            "enabled": is_2fa_enabled(db_user),
            "recovery_codes_remaining": recovery_codes_remaining(stored) if is_2fa_enabled(db_user) else 0,
        }

    @api.post("/superadmin/account/2fa/setup")
    async def sa_2fa_setup(user: dict = Depends(admin_dep)):
        db_user = await ensure_platform_admin_user(user)
        if is_2fa_enabled(db_user):
            raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
        secret = generate_totp_secret()
        email = db_user.get("email") or "platform@clinicos.id"
        uri = totp_provisioning_uri(secret, email)
        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {
                "totp_pending_secret_encrypted": encrypt_totp_secret(secret),
                "updated_at": _now_iso(),
            }},
        )
        return {
            "manual_setup_key": secret,
            "provisioning_uri": uri,
            "qr_code_data_uri": qr_code_data_uri(uri),
        }

    @api.post("/superadmin/account/2fa/enable")
    async def sa_2fa_enable(payload: TotpCodeIn, user: dict = Depends(admin_dep)):
        db_user = await ensure_platform_admin_user(user)
        if is_2fa_enabled(db_user):
            raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
        pending = db_user.get("totp_pending_secret_encrypted")
        if not pending:
            raise HTTPException(status_code=400, detail="Start setup before enabling 2FA")
        secret = decrypt_totp_secret(pending)
        if not verify_totp_code(secret, payload.code):
            await audit(
                {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
                "super_admin_2fa_failed",
                "platform_admin_account",
                db_user["id"],
                reason="enable_verification_failed",
            )
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        plain_codes = generate_recovery_codes()
        stored_codes = [{"hash": hash_recovery_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]
        now = _now_iso()
        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {
                "totp_enabled": True,
                "totp_secret_encrypted": encrypt_totp_secret(secret),
                "totp_pending_secret_encrypted": None,
                "totp_recovery_codes": stored_codes,
                "totp_enabled_at": now,
                "updated_at": now,
            }},
        )
        await audit(
            {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
            "super_admin_2fa_enabled",
            "platform_admin_account",
            db_user["id"],
        )
        return {
            "ok": True,
            "recovery_codes": plain_codes,
            "message": "Two-factor authentication enabled. Save your recovery codes in a secure place.",
        }

    @api.post("/superadmin/account/2fa/disable")
    async def sa_2fa_disable(payload: TotpDisableIn, user: dict = Depends(admin_dep)):
        if not verify_password:
            raise HTTPException(status_code=500, detail="Password verification unavailable")
        db_user = await ensure_platform_admin_user(user)
        if not is_2fa_enabled(db_user):
            raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
        if not verify_password(payload.current_password, db_user.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        secret = await t2fa.load_totp_secret(db_user, prefix=PLATFORM_FERNET_PREFIX)
        if not verify_totp_code(secret, payload.code):
            await t2fa.record_failed_attempt(db, db_user["id"])
            await audit(
                {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
                "super_admin_2fa_failed",
                "platform_admin_account",
                db_user["id"],
                reason="disable_verification_failed",
            )
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {
                "totp_enabled": False,
                "totp_secret_encrypted": None,
                "totp_pending_secret_encrypted": None,
                "totp_recovery_codes": [],
                "totp_failed_attempts": [],
                "updated_at": _now_iso(),
            }},
        )
        await audit(
            {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
            "super_admin_2fa_disabled",
            "platform_admin_account",
            db_user["id"],
        )
        return {"ok": True, "message": "Two-factor authentication disabled."}

    @api.post("/superadmin/account/2fa/recovery-codes/regenerate")
    async def sa_2fa_regenerate_recovery(payload: RecoveryRegenerateIn, user: dict = Depends(admin_dep)):
        if not verify_password:
            raise HTTPException(status_code=500, detail="Password verification unavailable")
        db_user = await ensure_platform_admin_user(user)
        if not is_2fa_enabled(db_user):
            raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
        if not verify_password(payload.current_password, db_user.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        secret = await t2fa.load_totp_secret(db_user, prefix=PLATFORM_FERNET_PREFIX)
        if not verify_totp_code(secret, payload.code):
            await t2fa.record_failed_attempt(db, db_user["id"])
            await audit(
                {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
                "super_admin_2fa_failed",
                "platform_admin_account",
                db_user["id"],
                reason="recovery_regenerate_failed",
            )
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

        plain_codes = generate_recovery_codes()
        stored_codes = [{"hash": hash_recovery_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]
        await db.users.update_one(
            {"id": db_user["id"]},
            {"$set": {"totp_recovery_codes": stored_codes, "updated_at": _now_iso()}},
        )
        await audit(
            {"id": db_user["id"], "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
            "super_admin_2fa_recovery_codes_regenerated",
            "platform_admin_account",
            db_user["id"],
        )
        return {"ok": True, "recovery_codes": plain_codes}

    @api.post("/auth/platform-2fa/verify")
    async def auth_platform_2fa_verify(payload: ChallengeVerifyIn, response: Response):
        challenge = decode_challenge_token(payload.challenge_token)
        user_id = challenge["sub"]
        await t2fa.assert_not_locked(db, user_id)
        db_user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not db_user or not is_2fa_enabled(db_user):
            raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
        secret = await t2fa.load_totp_secret(db_user, prefix=PLATFORM_FERNET_PREFIX)
        if not verify_totp_code(secret, payload.code):
            count = await t2fa.record_failed_attempt(db, user_id)
            await audit(
                {"id": user_id, "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
                "super_admin_2fa_failed",
                "platform_admin_account",
                user_id,
                reason="login_verification_failed",
                meta={"attempt_count": count},
            )
            raise HTTPException(status_code=400, detail="Invalid authenticator code")
        return await _complete_login(response, db_user)

    @api.post("/auth/platform-2fa/recovery")
    async def auth_platform_2fa_recovery(payload: ChallengeRecoveryIn, response: Response):
        challenge = decode_challenge_token(payload.challenge_token)
        user_id = challenge["sub"]
        await t2fa.assert_not_locked(db, user_id)
        db_user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not db_user or not is_2fa_enabled(db_user):
            raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
        stored = list(db_user.get("totp_recovery_codes") or [])
        idx = verify_recovery_code(payload.recovery_code, stored)
        if idx is None:
            count = await t2fa.record_failed_attempt(db, user_id)
            await audit(
                {"id": user_id, "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
                "super_admin_2fa_failed",
                "platform_admin_account",
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
            {"id": user_id, "email": db_user.get("email"), "role": "platform_admin", "platform_admin": True},
            "super_admin_2fa_recovery_used",
            "platform_admin_account",
            user_id,
        )
        return await _complete_login(response, db_user)
