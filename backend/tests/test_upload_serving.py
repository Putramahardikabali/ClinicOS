"""Upload file serving — /uploads (root) and /api/files aliases."""
import io
import os
import base64

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 30

PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


class TestUploadServing:
    def test_root_uploads_url_with_auth(self):
        """GET /uploads/{path} (not /api/uploads) serves files from UPLOAD_DIR."""
        fo = _login("fo@glowclinic.id")
        vid_resp = requests.get(f"{API}/visits", headers={"Authorization": f"Bearer {fo}"}, timeout=TIMEOUT)
        if vid_resp.status_code != 200 or not vid_resp.json():
            pytest.skip("No visits available for photo upload test")
        vid = vid_resp.json()[0]["id"]

        files = {"file": ("t.png", io.BytesIO(PNG_1x1), "image/png")}
        data = {"photo_type": "before", "angle": "front", "notes": "upload-serve-test"}
        up = requests.post(
            f"{API}/visits/{vid}/photos",
            headers={"Authorization": f"Bearer {fo}"},
            files=files,
            data=data,
            timeout=TIMEOUT,
        )
        assert up.status_code == 200, up.text
        path = up.json()["storage_path"]

        root_url = f"{BASE_URL}/uploads/{path}?auth={fo}"
        r = requests.get(root_url, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert len(r.content) > 0
        assert r.headers.get("content-type", "").startswith("image/")

    def test_root_uploads_requires_auth_for_clinical_photos(self):
        fo = _login("fo@glowclinic.id")
        vid_resp = requests.get(f"{API}/visits", headers={"Authorization": f"Bearer {fo}"}, timeout=TIMEOUT)
        if vid_resp.status_code != 200 or not vid_resp.json():
            pytest.skip("No visits available")
        vid = vid_resp.json()[0]["id"]
        photos = requests.get(f"{API}/visits/{vid}", headers={"Authorization": f"Bearer {fo}"}, timeout=TIMEOUT)
        items = (photos.json().get("photos") or []) if photos.status_code == 200 else []
        if not items:
            pytest.skip("No photos on visit")
        path = items[0].get("storage_path")
        if not path:
            pytest.skip("Photo missing storage_path")

        r = requests.get(f"{BASE_URL}/uploads/{path}", timeout=TIMEOUT)
        assert r.status_code == 401

    def test_api_files_alias_still_works(self):
        fo = _login("fo@glowclinic.id")
        vid_resp = requests.get(f"{API}/visits", headers={"Authorization": f"Bearer {fo}"}, timeout=TIMEOUT)
        if vid_resp.status_code != 200 or not vid_resp.json():
            pytest.skip("No visits available")
        vid = vid_resp.json()[0]["id"]
        photos = requests.get(f"{API}/visits/{vid}", headers={"Authorization": f"Bearer {fo}"}, timeout=TIMEOUT)
        items = (photos.json().get("photos") or []) if photos.status_code == 200 else []
        if not items:
            pytest.skip("No photos on visit")
        path = items[0].get("storage_path")
        if not path:
            pytest.skip("Photo missing storage_path")

        r = requests.get(f"{API}/files/{path}?auth={fo}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert len(r.content) > 0

    def test_branding_path_public_without_auth(self):
        owner = _login("owner@glowclinic.id")
        files = {"file": ("logo.png", io.BytesIO(PNG_1x1), "image/png")}
        up = requests.post(
            f"{API}/admin/logo",
            headers={"Authorization": f"Bearer {owner}"},
            files=files,
            timeout=TIMEOUT,
        )
        if up.status_code != 200:
            pytest.skip(f"Logo upload not available: {up.status_code}")
        path = up.json().get("logo_path")
        if not path:
            pytest.skip("Logo path missing")

        r = requests.get(f"{BASE_URL}/uploads/{path}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert len(r.content) > 0

    def test_missing_file_returns_404(self):
        r = requests.get(f"{BASE_URL}/uploads/clinicos/does-not-exist/missing.png", timeout=TIMEOUT)
        assert r.status_code == 404
