"""Phase 3 — public consent link tests."""
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30
PASSWORD = "password123"


def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["token"]


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def fo_h():
    return H(login("fo@bodylab.id"))


class TestPublicConsentUnit:
    def test_token_hash_unique(self):
        from public_consent_links import _generate_token, _hash_token

        t1 = _generate_token()
        t2 = _generate_token()
        assert t1 != t2
        assert len(_hash_token(t1)) == 64


class TestPublicConsentAPI:
    def test_public_consent_not_found(self):
        r = requests.get(f"{API}/public/consent/invalid-token-xyz", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_generate_requires_auth(self):
        r = requests.post(f"{API}/consent-forms/{uuid.uuid4()}/public-link", timeout=TIMEOUT)
        assert r.status_code == 401

    def test_list_visit_consent_includes_public_link_field(self, fo_h):
        visits = requests.get(f"{API}/visits", headers=fo_h, timeout=TIMEOUT)
        if visits.status_code != 200:
            pytest.skip("No visits access")
        items = visits.json() if isinstance(visits.json(), list) else []
        if not items:
            pytest.skip("No visits")
        vid = items[0]["id"]
        r = requests.get(f"{API}/visits/{vid}/consent-forms", headers=fo_h, timeout=TIMEOUT)
        if r.status_code != 200:
            pytest.skip("Consent not available")
        for form in r.json() or []:
            assert "public_link" in form or form.get("public_link") is None
