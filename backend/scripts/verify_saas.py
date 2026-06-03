"""Quick SaaS tenant + plan restriction checks against running API."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE}/api"
PASSWORD = "password123"


def login(email: str) -> str:
    body = json.dumps({"email": email, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        f"{API}/auth/login", data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["token"]


def get(path: str, token: str):
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    failures = []
    print(f"API: {API}\n")

    # --- Tenant isolation ---
    t_cantik = login("owner@cantikbeauty.id")
    t_glow = login("owner@glowclinic.id")
    t_lumina = login("owner@luminabali.id")

    _, cantik_patients = get("/patients", t_cantik)
    _, lumina_patients = get("/patients", t_lumina)
    cantik_ids = {p["id"] for p in cantik_patients}
    lumina_ids = {p["id"] for p in lumina_patients}
    if cantik_ids & lumina_ids:
        failures.append("PATIENT LEAK: Cantik and Lumina share patient IDs")
    else:
        print("OK  Patient lists are disjoint (Cantik vs Lumina)")

    _, glow_tx = get("/treatments-catalog", t_glow)
    glow_tid = glow_tx[0]["id"] if glow_tx else None
    if glow_tid:
        code, _ = get(f"/treatments-catalog/{glow_tid}", t_cantik)
        # PUT via raw request
        req = urllib.request.Request(
            f"{API}/treatments-catalog/{glow_tid}",
            data=json.dumps({"price_idr": 1}).encode(),
            headers={"Authorization": f"Bearer {t_cantik}", "Content-Type": "application/json"},
            method="PUT",
        )
        try:
            urllib.request.urlopen(req, timeout=15)
            failures.append("TREATMENT LEAK: Cantik could update Glow treatment")
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                print(f"OK  Cantik cannot update Glow treatment ({e.code})")
            else:
                failures.append(f"TREATMENT: unexpected status {e.code}")

        if glow_tid:
            req2 = urllib.request.Request(
                f"{API}/treatments-catalog/{glow_tid}",
                data=json.dumps({"price_idr": 1}).encode(),
                headers={"Authorization": f"Bearer {t_lumina}", "Content-Type": "application/json"},
                method="PUT",
            )
            try:
                urllib.request.urlopen(req2, timeout=15)
                failures.append("TREATMENT LEAK: Lumina updated Glow treatment")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    print("OK  Lumina cannot update Glow treatment (404 tenant scope)")
                else:
                    failures.append(f"TREATMENT tenant: Lumina->Glow PUT returned {e.code}")

    if lumina_patients:
        other_pid = lumina_patients[0]["id"]
        code, _ = get(f"/patients/{other_pid}", t_cantik)
        if code == 200:
            failures.append("PATIENT LEAK: Cantik can read Lumina patient by ID")
        elif code == 404:
            print("OK  Cantik cannot read Lumina patient by ID (404)")
        else:
            failures.append(f"PATIENT: unexpected status {code}")

    # --- Plan features on /clinics/me ---
    plans_expected = {
        "owner@cantikbeauty.id": {
            "plan": "starter",
            "has": ["treatments", "online_booking", "patients"],
            "not": ["emr", "audit_log", "reports", "photos", "billing"],
        },
        "owner@glowclinic.id": {
            "plan": "clinic",
            "has": ["emr", "treatments", "mapping"],
            "not": ["audit_log", "products"],
        },
        "owner@luminabali.id": {
            "plan": "complete",
            "has": ["emr", "audit_log", "reports", "products"],
            "not": [],
        },
    }
    for email, spec in plans_expected.items():
        tok = login(email)
        _, clinic = get("/clinics/me", tok)
        feats = set(clinic.get("features") or [])
        sub = clinic.get("subscription", {})
        if sub.get("plan") != spec["plan"]:
            failures.append(f"{email}: plan={sub.get('plan')} expected {spec['plan']}")
        else:
            print(f"OK  {email} plan={spec['plan']}")
        for f in spec["has"]:
            if f not in feats:
                failures.append(f"{email}: missing feature '{f}' in /clinics/me")
        for f in spec["not"]:
            if f in feats:
                failures.append(f"{email}: should NOT have feature '{f}' in /clinics/me")

    # --- API should block EMR for starter ---
    if cantik_patients:
        # find a visit for cantik
        _, visits = get("/visits", t_cantik)
        if visits:
            vid = visits[0]["id"]
            req = urllib.request.Request(
                f"{API}/visits/{vid}/clinical",
                data=json.dumps({"anamnesis": "x", "submit": False}).encode(),
                headers={"Authorization": f"Bearer {t_cantik}", "Content-Type": "application/json"},
                method="PUT",
            )
            try:
                urllib.request.urlopen(req, timeout=15)
                failures.append("PLAN: Starter can write clinical record (emr should be blocked)")
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    print("OK  Starter blocked from EMR clinical write (403)")
                else:
                    failures.append(f"PLAN: clinical write returned {e.code}")

    # --- Audit log API for starter manager would need manager user - skip if no user
    code, _ = get("/audit-logs", t_cantik)
    if code == 403:
        print("OK  Starter /audit-logs blocked (403)")
    elif code == 200:
        failures.append("PLAN: Starter owner can access /audit-logs")
    else:
        failures.append(f"PLAN: Starter /audit-logs unexpected {code}")

    code, _ = get("/reports/revenue-monthly", t_cantik)
    if code == 403:
        print("OK  Starter /reports blocked (403)")
    elif code == 200:
        failures.append("PLAN: Starter can access revenue reports")
    else:
        failures.append(f"PLAN: Starter reports unexpected {code}")

    # Starter may read catalog for online booking; mutations must be blocked
    req = urllib.request.Request(
        f"{API}/treatments-catalog",
        data=json.dumps({
            "name": "TEST Blocked",
            "category": "general",
            "duration_min": 30,
            "price_idr": 1000,
            "performer_type": "therapist",
        }).encode(),
        headers={"Authorization": f"Bearer {t_cantik}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=15)
        failures.append("PLAN: Starter can create treatments-catalog entry")
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print("OK  Starter blocked from treatments-catalog POST (403)")
        else:
            failures.append(f"PLAN: treatments POST returned {e.code}")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    main()
