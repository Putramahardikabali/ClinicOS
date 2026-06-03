"""Shared TOTP / recovery-code helpers for platform and clinic users."""
from __future__ import annotations

import base64
import hashlib
import io
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import bcrypt
import jwt
import pyotp
import qrcode
from cryptography.fernet import Fernet
from fastapi import HTTPException

JWT_ALGORITHM = "HS256"
CHALLENGE_TTL_MINUTES = 5
RECOVERY_CODE_COUNT = 10
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
TOTP_ISSUER = "ClinicOS"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "")


def _fernet(prefix: str) -> Fernet:
    raw = hashlib.sha256(f"{prefix}:{_jwt_secret()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_totp_secret(secret: str, *, prefix: str) -> str:
    return _fernet(prefix).encrypt(secret.encode()).decode()


def decrypt_totp_secret(encrypted: str, *, prefix: str) -> str:
    return _fernet(prefix).decrypt(encrypted.encode()).decode()


def is_2fa_enabled(user: dict) -> bool:
    return bool(user.get("totp_enabled")) and bool(user.get("totp_secret_encrypted"))


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str, *, issuer: str = TOTP_ISSUER) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def qr_code_data_uri(provisioning_uri: str) -> str:
    img = qrcode.make(provisioning_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def verify_totp_code(secret: str, code: str) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return bool(pyotp.TOTP(secret).verify(code, valid_window=1))


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> List[str]:
    codes: List[str] = []
    for _ in range(count):
        codes.append(f"{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}")
    return codes


def hash_recovery_code(code: str) -> str:
    normalized = (code or "").strip().upper().replace(" ", "")
    return bcrypt.hashpw(normalized.encode(), bcrypt.gensalt()).decode()


def verify_recovery_code(code: str, stored: List[dict]) -> Optional[int]:
    normalized = (code or "").strip().upper().replace(" ", "")
    if not normalized:
        return None
    for idx, row in enumerate(stored or []):
        if row.get("used_at"):
            continue
        h = row.get("hash") or ""
        if h and bcrypt.checkpw(normalized.encode(), h.encode()):
            return idx
    return None


def recovery_codes_remaining(stored: List[dict]) -> int:
    return sum(1 for row in (stored or []) if not row.get("used_at"))


def create_challenge_token(user_id: str, email: str, *, challenge_type: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": challenge_type,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=CHALLENGE_TTL_MINUTES),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_challenge_token(token: str, *, challenge_type: str) -> dict:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Two-factor challenge expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
    if payload.get("type") != challenge_type:
        raise HTTPException(status_code=401, detail="Invalid two-factor challenge")
    return payload


def _prune_failed_attempts(attempts: List[str], *, now: datetime) -> List[str]:
    cutoff = now - timedelta(minutes=LOCKOUT_MINUTES)
    kept = []
    for ts in attempts or []:
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                kept.append(ts)
        except Exception:
            continue
    return kept


async def record_failed_attempt(db, user_id: str) -> int:
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "totp_failed_attempts": 1})
    attempts = _prune_failed_attempts((user or {}).get("totp_failed_attempts") or [], now=now)
    attempts.append(now.isoformat())
    await db.users.update_one({"id": user_id}, {"$set": {"totp_failed_attempts": attempts}})
    return len(attempts)


async def clear_failed_attempts(db, user_id: str) -> None:
    await db.users.update_one({"id": user_id}, {"$set": {"totp_failed_attempts": []}})


async def assert_not_locked(db, user_id: str) -> None:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "totp_failed_attempts": 1})
    now = datetime.now(timezone.utc)
    attempts = _prune_failed_attempts((user or {}).get("totp_failed_attempts") or [], now=now)
    if len(attempts) >= MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.",
        )


async def load_totp_secret(user: dict, *, prefix: str) -> str:
    enc = user.get("totp_secret_encrypted")
    if not enc:
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    return decrypt_totp_secret(enc, prefix=prefix)
