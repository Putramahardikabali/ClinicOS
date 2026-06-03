"""Backend tests for Iteration-2 admin/settings/users/branding features."""
import os
import io
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ROLES = {
    "super_admin": "admin@bodylab.id",
    "doctor":      "doctor@bodylab.id",
    "therapist":   "therapist@bodylab.id",
    "fo":          "fo@bodylab.id",
    "manager":     "manager@bodylab.id",
}
PASSWORD = "password123"


def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def tokens():
    return {role: login(email) for role, email in ROLES.items()}


@pytest.fixture(scope="module")
def admin_h(tokens):
    return {"Authorization": f"Bearer {tokens['super_admin']}"}


# ---------- Public branding ----------
class TestPublicBranding:
    def test_branding_no_auth(self):
        r = requests.get(f"{API}/branding", timeout=15)
        assert r.status_code == 200
        b = r.json()
        for key in ("clinic_name", "primary_color", "primary_hover",
                    "accent_color", "background", "surface", "text_primary"):
            assert key in b, f"missing {key}"
        assert isinstance(b["clinic_name"], str) and b["clinic_name"]


# ---------- /api/settings ----------
class TestSettingsGet:
    def test_settings_requires_auth(self):
        r = requests.get(f"{API}/settings", timeout=15)
        assert r.status_code == 401

    def test_settings_returns_full_doc(self, admin_h):
        r = requests.get(f"{API}/settings", headers=admin_h, timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert "branding" in s
        assert "form_config" in s
        for k in ("face_sections", "contraindications", "devices",
                  "treatment_categories", "treatment_units", "payment_methods"):
            assert k in s["form_config"], f"form_config missing {k}"
        assert "mapping_templates" in s
        for k in ("face", "body_front", "body_back"):
            assert k in s["mapping_templates"]


# ---------- PUT /api/admin/settings RBAC ----------
class TestSettingsRBAC:
    @pytest.mark.parametrize("role", ["doctor", "therapist", "fo", "manager"])
    def test_non_admin_forbidden(self, tokens, role):
        h = {"Authorization": f"Bearer {tokens[role]}"}
        r = requests.put(f"{API}/admin/settings", headers=h,
                         json={"branding": {"clinic_name": "Hack"}}, timeout=15)
        assert r.status_code == 403, f"role={role} got {r.status_code}"


# ---------- PUT /api/admin/settings persistence ----------
class TestSettingsPersist:
    def test_persist_branding(self, admin_h):
        # Snapshot current
        cur = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        original_branding = cur["branding"].copy()
        new_branding = {**original_branding,
                        "clinic_name": "TEST_Clinic",
                        "primary_color": "#123456"}
        r = requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"branding": new_branding}, timeout=15)
        assert r.status_code == 200
        # Verify GET reflects change
        s = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        assert s["branding"]["clinic_name"] == "TEST_Clinic"
        assert s["branding"]["primary_color"] == "#123456"
        # Verify public /branding too
        pb = requests.get(f"{API}/branding", timeout=15).json()
        assert pb["clinic_name"] == "TEST_Clinic"
        # Restore
        requests.put(f"{API}/admin/settings", headers=admin_h,
                     json={"branding": original_branding}, timeout=15)

    def test_branding_on_public_booking_page(self, admin_h):
        me = requests.get(f"{API}/clinics/me", headers=admin_h, timeout=15).json()
        slug = me["slug"]
        cur = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        original = cur["branding"].copy()
        unique = f"TEST_Public_{uuid.uuid4().hex[:6]}"
        new_branding = {**original, "clinic_name": unique, "tagline": "Test Tagline"}
        try:
            r = requests.put(f"{API}/admin/settings", headers=admin_h,
                             json={"branding": new_branding}, timeout=15)
            assert r.status_code == 200
            pub = requests.get(f"{API}/public/clinics/{slug}/treatments", timeout=15).json()
            assert pub["clinic"]["name"] == unique
            assert pub["clinic"]["tagline"] == "Test Tagline"
            me2 = requests.get(f"{API}/clinics/me", headers=admin_h, timeout=15).json()
            assert me2["name"] == unique
        finally:
            requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"branding": original}, timeout=15)

    def test_booking_slug_update(self, admin_h):
        me = requests.get(f"{API}/clinics/me", headers=admin_h, timeout=15).json()
        original_slug = me["slug"]
        new_slug = f"test-{uuid.uuid4().hex[:8]}"
        try:
            r = requests.put(f"{API}/admin/settings", headers=admin_h,
                             json={"booking_slug": new_slug}, timeout=15)
            assert r.status_code == 200, r.text
            me2 = requests.get(f"{API}/clinics/me", headers=admin_h, timeout=15).json()
            assert me2["slug"] == new_slug
            assert requests.get(f"{API}/public/clinics/{new_slug}/treatments", timeout=15).status_code == 200
            assert requests.get(f"{API}/public/clinics/{original_slug}/treatments", timeout=15).status_code == 404
        finally:
            requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"booking_slug": original_slug}, timeout=15)

    def test_booking_slug_reserved(self, admin_h):
        r = requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"booking_slug": "login"}, timeout=15)
        assert r.status_code == 400

    def test_persist_form_config(self, admin_h):
        cur = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        original_fc = cur["form_config"].copy()
        new_fc = {**original_fc,
                  "contraindications": original_fc["contraindications"] + ["TEST_Contra"]}
        r = requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"form_config": new_fc}, timeout=15)
        assert r.status_code == 200
        s = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        assert "TEST_Contra" in s["form_config"]["contraindications"]
        # Restore
        requests.put(f"{API}/admin/settings", headers=admin_h,
                     json={"form_config": original_fc}, timeout=15)

    def test_persist_mapping_templates(self, admin_h):
        cur = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        original_mt = cur["mapping_templates"].copy()
        new_mt = {**original_mt,
                  "face": {"label": "TEST_Face",
                           "svg": "<svg xmlns='http://www.w3.org/2000/svg'/>"}}
        r = requests.put(f"{API}/admin/settings", headers=admin_h,
                         json={"mapping_templates": new_mt}, timeout=15)
        assert r.status_code == 200
        s = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        assert s["mapping_templates"]["face"]["label"] == "TEST_Face"
        # Restore
        requests.put(f"{API}/admin/settings", headers=admin_h,
                     json={"mapping_templates": original_mt}, timeout=15)


# ---------- POST /api/admin/logo ----------
# 1x1 transparent PNG
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8"
    b"\xcf\xc0\x00\x00\x00\x03\x00\x01\x9a\xfd\x9b\x99\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestLogoUpload:
    def test_logo_rbac(self, tokens):
        h = {"Authorization": f"Bearer {tokens['doctor']}"}
        files = {"file": ("logo.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/admin/logo", headers=h, files=files, timeout=60)
        assert r.status_code == 403

    def test_logo_upload_and_public_serve(self, admin_h):
        files = {"file": ("logo.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/admin/logo", headers=admin_h, files=files, timeout=60)
        assert r.status_code == 200, r.text
        path = r.json()["logo_path"]
        assert path
        # Settings reflect logo_path
        s = requests.get(f"{API}/settings", headers=admin_h, timeout=15).json()
        assert s["branding"]["logo_path"] == path
        # Public file serve - NO auth (photo_type=branding)
        fr = requests.get(f"{API}/files/{path}", timeout=30)
        assert fr.status_code == 200, f"public file fetch failed: {fr.status_code}"
        assert len(fr.content) > 0


# ---------- /api/admin/users ----------
class TestAdminUsers:
    def test_create_user_rbac(self, tokens):
        h = {"Authorization": f"Bearer {tokens['manager']}"}
        r = requests.post(f"{API}/admin/users", headers=h,
                          json={"email": f"TEST_x{uuid.uuid4().hex[:6]}@t.id",
                                "password": "p", "name": "X", "role": "doctor"},
                          timeout=15)
        assert r.status_code == 403

    def test_create_update_delete_user(self, admin_h):
        email = f"test_user_{uuid.uuid4().hex[:8]}@bodylab.id"
        # CREATE
        r = requests.post(f"{API}/admin/users", headers=admin_h,
                          json={"email": email, "password": "secret123",
                                "name": "TEST User", "role": "doctor"}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == email and u["role"] == "doctor"
        assert "password_hash" not in u and "_id" not in u
        uid = u["id"]

        # Duplicate email -> 409
        r2 = requests.post(f"{API}/admin/users", headers=admin_h,
                           json={"email": email, "password": "x",
                                 "name": "Dup", "role": "doctor"}, timeout=15)
        assert r2.status_code == 409

        # Login as new user works
        lr = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": "secret123"}, timeout=15)
        assert lr.status_code == 200

        # UPDATE — change name+role, no password
        ur = requests.put(f"{API}/admin/users/{uid}", headers=admin_h,
                          json={"email": email, "name": "TEST Renamed",
                                "role": "therapist"}, timeout=15)
        assert ur.status_code == 200
        assert ur.json()["name"] == "TEST Renamed"
        assert ur.json()["role"] == "therapist"
        # Old password still works (not changed when blank)
        lr2 = requests.post(f"{API}/auth/login",
                            json={"email": email, "password": "secret123"}, timeout=15)
        assert lr2.status_code == 200

        # UPDATE password
        ur2 = requests.put(f"{API}/admin/users/{uid}", headers=admin_h,
                           json={"email": email, "name": "TEST Renamed",
                                 "role": "therapist", "password": "newpass456"}, timeout=15)
        assert ur2.status_code == 200
        lr3 = requests.post(f"{API}/auth/login",
                            json={"email": email, "password": "newpass456"}, timeout=15)
        assert lr3.status_code == 200

        # DELETE
        dr = requests.delete(f"{API}/admin/users/{uid}", headers=admin_h, timeout=15)
        assert dr.status_code == 200
        # Login should fail now
        lr4 = requests.post(f"{API}/auth/login",
                            json={"email": email, "password": "newpass456"}, timeout=15)
        assert lr4.status_code == 401

    def test_cannot_delete_self(self, admin_h, tokens):
        me = requests.get(f"{API}/auth/me", headers=admin_h, timeout=15).json()
        r = requests.delete(f"{API}/admin/users/{me['id']}", headers=admin_h, timeout=15)
        assert r.status_code == 400
