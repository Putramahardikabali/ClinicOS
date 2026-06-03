"""Staff module: roles seeding, permissions on /auth/me, owner guards."""
import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE}/api"
TIMEOUT = 20


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


class TestStaffPermissions:
    def test_owner_me_includes_permissions(self):
        token = login("admin@bodylab.id", "password123")
        r = requests.get(f"{API}/auth/me", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "permissions" in body
        assert "staff.manage" in body["permissions"]
        assert "roles.manage" in body["permissions"]

    def test_manager_can_list_staff_roles(self):
        token = login("manager@bodylab.id", "password123")
        r = requests.get(f"{API}/staff/roles", headers=H(token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        roles = r.json()
        assert any(x.get("role_key") == "manager" for x in roles)

    def test_fo_cannot_manage_roles(self):
        token = login("fo@bodylab.id", "password123")
        r = requests.post(
            f"{API}/staff/roles",
            headers=H(token),
            json={"role_name": "Nurse Test", "permissions": ["patients.view"]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_owner_role_cannot_drop_staff_manage(self):
        token = login("admin@bodylab.id", "password123")
        roles = requests.get(f"{API}/staff/roles", headers=H(token), timeout=TIMEOUT).json()
        owner = next(r for r in roles if r.get("role_key") == "super_admin")
        perms = [p for p in owner["permissions"] if p not in ("staff.manage", "roles.manage", "settings.manage")]
        r = requests.put(
            f"{API}/staff/roles/{owner['id']}",
            headers=H(token),
            json={"permissions": perms},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400
