"""Unit tests for Super Admin TOTP 2FA helpers."""
import os
import time

import jwt
import pyotp
import pytest

os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-2fa")

from totp_2fa import (
    CHALLENGE_TTL_MINUTES,
    create_challenge_token,
    decode_challenge_token,
    encrypt_totp_secret,
    decrypt_totp_secret,
    generate_recovery_codes,
    hash_recovery_code,
    is_2fa_enabled,
    recovery_codes_remaining,
    verify_recovery_code,
    verify_totp_code,
)

PLATFORM_CHALLENGE = "platform_2fa_challenge"
PLATFORM_PREFIX = "platform-2fa"


def test_encrypt_decrypt_roundtrip():
    secret = pyotp.random_base32()
    enc = encrypt_totp_secret(secret, prefix=PLATFORM_PREFIX)
    assert enc != secret
    assert decrypt_totp_secret(enc, prefix=PLATFORM_PREFIX) == secret


def test_is_2fa_enabled():
    assert not is_2fa_enabled({})
    assert not is_2fa_enabled({"totp_enabled": True})
    assert is_2fa_enabled({"totp_enabled": True, "totp_secret_encrypted": "x"})


def test_verify_totp_code():
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret).now()
    assert verify_totp_code(secret, code)
    assert not verify_totp_code(secret, "000000")


def test_recovery_codes_hashed_and_single_use():
    plain = generate_recovery_codes(3)
    stored = [{"hash": hash_recovery_code(c), "used_at": None} for c in plain]
    assert recovery_codes_remaining(stored) == 3
    idx = verify_recovery_code(plain[0], stored)
    assert idx == 0
    assert verify_recovery_code(plain[0].lower(), stored) == 0
    stored[0]["used_at"] = "2026-01-01T00:00:00+00:00"
    assert verify_recovery_code(plain[0], stored) is None
    assert recovery_codes_remaining(stored) == 2


def test_challenge_token_type_and_expiry():
    token = create_challenge_token("platform-admin", "admin@test.com", challenge_type=PLATFORM_CHALLENGE)
    payload = decode_challenge_token(token, challenge_type=PLATFORM_CHALLENGE)
    assert payload["sub"] == "platform-admin"
    assert payload["type"] == "platform_2fa_challenge"

    expired = jwt.encode(
        {
            "sub": "platform-admin",
            "email": "admin@test.com",
            "type": "platform_2fa_challenge",
            "exp": int(time.time()) - 60,
        },
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    with pytest.raises(Exception) as exc:
        decode_challenge_token(expired, challenge_type=PLATFORM_CHALLENGE)
    assert "expired" in str(exc.value.detail).lower()

    wrong_type = jwt.encode(
        {
            "sub": "platform-admin",
            "email": "admin@test.com",
            "type": "access",
            "exp": int(time.time()) + CHALLENGE_TTL_MINUTES * 60,
        },
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    with pytest.raises(Exception) as exc2:
        decode_challenge_token(wrong_type, challenge_type=PLATFORM_CHALLENGE)
    assert "invalid" in str(exc2.value.detail).lower()
