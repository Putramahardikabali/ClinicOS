import json
import urllib.error
import urllib.request

CREDS = [
    ("admin@bodylab.id", "password123"),
    ("owner@glowclinic.id", "password123"),
    ("owner@cantikbeauty.id", "password123"),
]
BASES = [
    "http://localhost:8000",
    "https://aesthetic-records.preview.emergentagent.com",
]

for base in BASES:
    print(f"=== {base}")
    for email, password in CREDS:
        req = urllib.request.Request(
            f"{base}/api/auth/login",
            data=json.dumps({"email": email, "password": password}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.loads(r.read())
                role = body.get("user", {}).get("role")
                print(f"  OK  {email} -> {role}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:120]
            print(f"  HTTP {e.code} {email} {detail}")
        except Exception as e:
            print(f"  ERR {email} {type(e).__name__}: {e}")
