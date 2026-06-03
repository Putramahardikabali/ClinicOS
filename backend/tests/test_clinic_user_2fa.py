"""Unit tests for clinic user 2FA helpers."""
import os

import pyotp
import pytest

os.environ.setdefault("JWT_SECRET", "test-jwt-secret-clinic-2fa")

from clinic_user_2fa import CLINIC_CHALLENGE_TYPE, CLINIC_FERNET_PREFIX, can_use_clinic_2fa
import totp_2fa as t2fa


def test_can_use_clinic_2fa():
    assert can_use_clinic_2fa({"role": "super_admin"})
    assert can_use_clinic_2fa({"role": "manager"})
    assert not can_use_clinic_2fa({"role": "doctor"})
    assert not can_use_clinic_2fa({"role": "manager", "impersonating": True})
    assert not can_use_clinic_2fa({"role": "super_admin", "platform_admin": True})


def test_clinic_totp_roundtrip():
    secret = pyotp.random_base32()
    enc = t2fa.encrypt_totp_secret(secret, prefix=CLINIC_FERNET_PREFIX)
    assert t2fa.decrypt_totp_secret(enc, prefix=CLINIC_FERNET_PREFIX) == secret


def test_clinic_challenge_token():
    token = t2fa.create_challenge_token("u1", "a@b.com", challenge_type=CLINIC_CHALLENGE_TYPE)
    payload = t2fa.decode_challenge_token(token, challenge_type=CLINIC_CHALLENGE_TYPE)
    assert payload["sub"] == "u1"
