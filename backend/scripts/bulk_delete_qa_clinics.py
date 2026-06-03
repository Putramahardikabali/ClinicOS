"""One-off: flag and bulk-delete clinics whose name contains 'QA'."""
import sys

import requests

API = "http://localhost:8000/api"
EMAIL = "platform@clinicos.id"
PASSWORD = "ChangeMe123!"


def main():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    tok = r.json()["token"]
    H = {"Authorization": f"Bearer {tok}"}

    all_rows = requests.get(
        f"{API}/superadmin/clinics", headers=H, params={"list_filter": "all"}, timeout=60
    ).json()
    qa = [c for c in all_rows if "qa" in (c.get("name") or "").lower()]
    print(f"Found {len(qa)} clinics with QA in name")
    if not qa:
        return 0

    for c in qa:
        if not c.get("is_test_clinic"):
            fr = requests.put(
                f"{API}/superadmin/clinics/{c['id']}/test-flag",
                headers=H,
                json={"is_test_clinic": True, "reason": "Bulk QA cleanup - name contains QA"},
                timeout=15,
            )
            if fr.status_code != 200:
                print(f"FLAG FAIL {c['name']}: {fr.status_code} {fr.text[:120]}")
                return 1

    ids = [c["id"] for c in qa]
    dr = requests.post(
        f"{API}/superadmin/clinics/bulk-delete-test",
        headers=H,
        json={"clinic_ids": ids, "dry_run": True},
        timeout=120,
    )
    if dr.status_code != 200:
        print(f"Dry run failed: {dr.status_code} {dr.text[:300]}")
        return 1
    print(f"Dry run OK: {dr.json().get('selected_count')} clinics")

    delr = requests.post(
        f"{API}/superadmin/clinics/bulk-delete-test",
        headers=H,
        json={
            "clinic_ids": ids,
            "dry_run": False,
            "reason": "User-requested cleanup: delete all clinics with QA in name",
            "confirmation_text": "DELETE QA CLINICS",
        },
        timeout=300,
    )
    if delr.status_code != 200:
        print(f"Delete failed: {delr.status_code} {delr.text[:500]}")
        return 1
    print(f"Deleted: {delr.json().get('deleted_count')} clinics")

    remaining = requests.get(
        f"{API}/superadmin/clinics", headers=H, params={"list_filter": "all"}, timeout=60
    ).json()
    left = [c for c in remaining if "qa" in (c.get("name") or "").lower()]
    print(f"Remaining QA-named clinics: {len(left)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
