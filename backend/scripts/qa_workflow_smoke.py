"""Smoke QA for clinic workflow — run inside backend container."""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/") + "/api"
TIMEOUT = 30
PASSWORD = "password123"
DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def login(email: str) -> tuple[str | None, str | None]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": PASSWORD},
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        return None, f"{r.status_code} {r.text[:200]}"
    return r.json()["token"], None


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class QA:
    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str]] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append((name, ok, detail))
        print(("PASS" if ok else "FAIL"), name, detail)

    def summary(self) -> int:
        passed = sum(1 for _, ok, _ in self.results if ok)
        print("---")
        print(f"{passed}/{len(self.results)} passed")
        return 0 if passed == len(self.results) else 1


def set_weekday_schedule(token: str, staff_id: str) -> bool:
    days = []
    for dow in DAY_KEYS:
        working = dow in ("mon", "tue", "wed", "thu", "fri", "sat")
        days.append({
            "day_of_week": dow,
            "is_working": working,
            "start_time": "09:00" if working else "",
            "end_time": "18:00" if working else "",
        })
    r = requests.put(
        f"{API}/staff/users/{staff_id}/weekly-schedule",
        headers=H(token),
        json={"days": days},
        timeout=TIMEOUT,
    )
    return r.status_code == 200


def next_weekday(days_ahead: int = 7) -> str:
    d = datetime.now(timezone.utc).date() + timedelta(days=days_ahead)
    while d.weekday() >= 6:
        d += timedelta(days=1)
    return d.isoformat()


def main() -> int:
    qa = QA()
    tokens: dict[str, str] = {}

    role_checks = {
        "admin@bodylab.id": {"role": "super_admin", "min_perms": 30},
        "manager@bodylab.id": {"role": "manager", "needs": ["commission.manage", "staff.manage"]},
        "fo@bodylab.id": {"role": "fo", "lacks": ["commission.manage", "commission.view", "staff.manage"]},
        "doctor@bodylab.id": {"role": "doctor", "lacks": ["settings.view", "commission.manage", "appointments.view", "billing.view", "commission.view", "commission.view_own"]},
        "therapist@bodylab.id": {"role": "therapist", "needs": ["commission.view_own", "schedule.view_own", "visits.view_own"], "lacks": ["settings.view", "staff.manage", "billing.view", "commission.view"]},
        "nurse@bodylab.id": {"role": "nurse", "needs": ["commission.view_own", "schedule.view_own", "visits.view_own"], "lacks": ["staff.manage", "settings.view", "billing.view", "commission.view"]},
    }

    for email, spec in role_checks.items():
        tok, err = login(email)
        if err:
            qa.check(f"login {email}", False, err)
            continue
        tokens[email] = tok
        me = requests.get(f"{API}/auth/me", headers=H(tok), timeout=TIMEOUT).json()
        perms = me.get("permissions") or []
        ok = me.get("role") == spec["role"]
        qa.check(f"login {email}", ok, f"role={me.get('role')} perms={len(perms)}")
        for p in spec.get("needs", []):
            qa.check(f"{email} has {p}", p in perms)
        for p in spec.get("lacks", []):
            qa.check(f"{email} lacks {p}", p not in perms)
        if "min_perms" in spec:
            qa.check(f"{email} permissions count", len(perms) >= spec["min_perms"])

    fo = tokens.get("fo@bodylab.id")
    mgr = tokens.get("manager@bodylab.id")
    doc = tokens.get("doctor@bodylab.id")

    if fo:
        r = requests.get(f"{API}/commission-rules", headers=H(fo), timeout=TIMEOUT)
        qa.check("FO blocked commission-rules API", r.status_code == 403, str(r.status_code))
    if mgr:
        r = requests.get(f"{API}/commission-rules", headers=H(mgr), timeout=TIMEOUT)
        qa.check("Manager can commission-rules API", r.status_code == 200, str(r.status_code))
    if doc and mgr:
        r = requests.get(f"{API}/commission-rules", headers=H(doc), timeout=TIMEOUT)
        qa.check("Doctor blocked commission-rules API", r.status_code == 403, str(r.status_code))
        users = requests.get(f"{API}/users", headers=H(mgr), timeout=TIMEOUT).json()
        any_staff = next((u for u in users if u.get("role") in ("therapist", "nurse")), None)
        if any_staff:
            r = requests.get(
                f"{API}/staff/users/{any_staff['id']}/weekly-schedule",
                headers=H(doc),
                timeout=TIMEOUT,
            )
            qa.check("Doctor blocked staff schedule API", r.status_code == 403, str(r.status_code))

    test_date = next_weekday(10)
    staff_by_role: dict[str, dict] = {}

    if mgr and fo:
        users = requests.get(f"{API}/users", headers=H(mgr), timeout=TIMEOUT).json()
        for role in ("doctor", "therapist", "nurse"):
            u = next((x for x in users if x.get("role") == role and x.get("active") is not False), None)
            if u:
                staff_by_role[role] = u
                seeded = set_weekday_schedule(mgr, u["id"])
                qa.check(f"seed schedule {role}", seeded, u["id"][:8])

        therapist = staff_by_role.get("therapist")
        nurse = staff_by_role.get("nurse")
        doctor = staff_by_role.get("doctor")

        if therapist:
            eff = requests.get(
                f"{API}/staff/users/{therapist['id']}/availability-day",
                headers=H(mgr),
                params={"date": test_date},
                timeout=TIMEOUT,
            ).json()
            qa.check("weekly schedule active", eff.get("is_working") is True, eff.get("source", ""))

            off_date = test_date
            requests.put(
                f"{API}/staff/users/{therapist['id']}/date-overrides",
                headers=H(mgr),
                json={"date": off_date, "status": "off", "reason": "QA day off"},
                timeout=TIMEOUT,
            )
            eff_off = requests.get(
                f"{API}/staff/users/{therapist['id']}/availability-day",
                headers=H(mgr),
                params={"date": off_date},
                timeout=TIMEOUT,
            ).json()
            qa.check("override off wins", eff_off.get("is_working") is False, eff_off.get("source", ""))

            requests.delete(
                f"{API}/staff/users/{therapist['id']}/date-overrides/{off_date}",
                headers=H(mgr),
                timeout=TIMEOUT,
            )

            override_work_date = (datetime.strptime(test_date, "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
            while datetime.strptime(override_work_date, "%Y-%m-%d").weekday() >= 5:
                override_work_date = (
                    datetime.strptime(override_work_date, "%Y-%m-%d").date() + timedelta(days=1)
                ).isoformat()
            requests.put(
                f"{API}/staff/users/{therapist['id']}/date-overrides",
                headers=H(mgr),
                json={
                    "date": override_work_date,
                    "status": "working",
                    "start_time": "10:00",
                    "end_time": "14:00",
                    "reason": "QA extra shift",
                },
                timeout=TIMEOUT,
            )
            eff_work = requests.get(
                f"{API}/staff/users/{therapist['id']}/availability-day",
                headers=H(mgr),
                params={"date": override_work_date},
                timeout=TIMEOUT,
            ).json()
            qa.check(
                "override working wins",
                eff_work.get("is_working") is True and eff_work.get("source") == "override",
                str(eff_work.get("work_windows")),
            )
            requests.delete(
                f"{API}/staff/users/{therapist['id']}/date-overrides/{override_work_date}",
                headers=H(mgr),
                timeout=TIMEOUT,
            )

        cats = requests.get(f"{API}/treatments-catalog", headers=H(fo), timeout=TIMEOUT).json()
        treatment = (cats[0]["name"] if cats else "Signature Facial")
        multi = next((t for t in cats if t.get("allow_multiple_performers")), None)
        qa_treatment_ids: list[str] = []

        def create_qa_treatment(name: str, **fields) -> dict | None:
            r = requests.post(
                f"{API}/treatments-catalog",
                headers=H(mgr),
                json={"name": name, "category": "general", "duration_min": 30, "price_idr": 100000, **fields},
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                return None
            doc = r.json()
            qa_treatment_ids.append(doc["id"])
            return doc

        if not multi:
            multi = create_qa_treatment(
                f"QA Multi {uuid.uuid4().hex[:6]}",
                performer_type="therapist",
                allowed_performer_roles=["therapist", "nurse"],
                allow_multiple_performers=True,
            )
        nurse_only = next((t for t in cats if t.get("performer_type") == "nurse"), None)
        if not nurse_only:
            nurse_only = create_qa_treatment(
                f"QA Nurse {uuid.uuid4().hex[:6]}",
                performer_type="nurse",
                allowed_performer_roles=["nurse"],
            )

        for role in ("doctor", "therapist", "nurse"):
            r = requests.get(
                f"{API}/bookings/available-performers",
                headers=H(fo),
                params={"date": test_date, "time": "10:00", "duration": 30, "treatment": treatment, "role": role},
                timeout=TIMEOUT,
            )
            n = len(r.json().get("performers", [])) if r.status_code == 200 else -1
            qa.check(f"available-performers role={role}", r.status_code == 200 and n > 0, f"count={n}")

        if multi and therapist and nurse:
            sched = f"{test_date}T10:00:00"
            body = {
                "patient_name": f"QA_{uuid.uuid4().hex[:6]}",
                "patient_phone": "+6289900112233",
                "treatment": multi["name"],
                "duration_min": multi.get("duration_min") or 30,
                "scheduled_at": sched,
                "performer_id": therapist["id"],
                "performers": [
                    {"staff_id": therapist["id"], "performer_type": "primary"},
                    {"staff_id": nurse["id"], "performer_type": "assistant"},
                ],
            }
            r = requests.post(f"{API}/bookings", headers=H(fo), json=body, timeout=TIMEOUT)
            qa.check("booking therapist+nurse", r.status_code == 200, r.text[:120] if r.status_code != 200 else r.json().get("id", "")[:8])
            booking_id = r.json().get("id") if r.status_code == 200 else None
            if booking_id:
                b = r.json()
                pids = {p.get("staff_id") for p in b.get("performers") or []}
                qa.check("booking performers snapshots", nurse["id"] in pids and b["performers"][0].get("staff_name_snapshot"))

                dup = requests.post(
                    f"{API}/bookings",
                    headers=H(fo),
                    json={
                        **body,
                        "patient_name": f"QA_dup_{uuid.uuid4().hex[:4]}",
                        "performers": [
                            {"staff_id": therapist["id"], "performer_type": "primary"},
                            {"staff_id": therapist["id"], "performer_type": "assistant"},
                        ],
                    },
                    timeout=TIMEOUT,
                )
                qa.check("duplicate performer rejected", dup.status_code == 400, dup.text[:80])

                conflict = requests.post(
                    f"{API}/bookings",
                    headers=H(fo),
                    json={
                        **body,
                        "patient_name": f"QA_conflict_{uuid.uuid4().hex[:4]}",
                        "scheduled_at": sched,
                        "performer_id": therapist["id"],
                        "performers": [{"staff_id": therapist["id"], "performer_type": "primary"}],
                    },
                    timeout=TIMEOUT,
                )
                qa.check("double booking blocked", conflict.status_code == 409, str(conflict.status_code))

                requests.delete(f"{API}/bookings/{booking_id}", headers=H(fo), timeout=TIMEOUT)

        if doctor and nurse:
            if nurse_only:
                sched = f"{test_date}T11:00:00"
                r = requests.post(
                    f"{API}/bookings",
                    headers=H(fo),
                    json={
                        "patient_name": f"QA_nurse_{uuid.uuid4().hex[:6]}",
                        "patient_phone": "+6289900112233",
                        "treatment": nurse_only["name"],
                        "duration_min": nurse_only.get("duration_min") or 30,
                        "scheduled_at": sched,
                        "performer_id": nurse["id"],
                        "performers": [{"staff_id": nurse["id"], "performer_type": "primary"}],
                    },
                    timeout=TIMEOUT,
                )
                qa.check("nurse-only booking", r.status_code == 200, r.text[:80] if r.status_code != 200 else "")
                if r.status_code == 200:
                    requests.delete(f"{API}/bookings/{r.json()['id']}", headers=H(fo), timeout=TIMEOUT)

            if doctor and nurse and multi:
                doc_multi = multi if multi.get("allowed_performer_roles") and "doctor" in multi["allowed_performer_roles"] else create_qa_treatment(
                    f"QA DocNurse {uuid.uuid4().hex[:6]}",
                    performer_type="doctor",
                    allowed_performer_roles=["doctor", "nurse"],
                    allow_multiple_performers=True,
                )
                if doc_multi:
                    sched = f"{test_date}T11:30:00"
                    r = requests.post(
                        f"{API}/bookings",
                        headers=H(fo),
                        json={
                            "patient_name": f"QA_docnurse_{uuid.uuid4().hex[:6]}",
                            "patient_phone": "+6289900112233",
                            "treatment": doc_multi["name"],
                            "duration_min": doc_multi.get("duration_min") or 30,
                            "scheduled_at": sched,
                            "performer_id": doctor["id"],
                            "performers": [
                                {"staff_id": doctor["id"], "performer_type": "primary"},
                                {"staff_id": nurse["id"], "performer_type": "assistant"},
                            ],
                        },
                        timeout=TIMEOUT,
                    )
                    qa.check("booking doctor+nurse", r.status_code == 200, r.text[:80] if r.status_code != 200 else "")
                    if r.status_code == 200:
                        requests.delete(f"{API}/bookings/{r.json()['id']}", headers=H(fo), timeout=TIMEOUT)

        for tid in qa_treatment_ids:
            requests.delete(f"{API}/treatments-catalog/{tid}", headers=H(mgr), timeout=TIMEOUT)

    if fo:
        visits = requests.get(f"{API}/visits", headers=H(fo), timeout=TIMEOUT).json()
        if visits:
            vid = visits[0]["id"]
            r1 = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT)
            r2 = requests.post(f"{API}/invoices/visit/{vid}", headers=H(fo), timeout=TIMEOUT)
            qa.check(
                "invoice idempotent",
                r1.status_code == 200 and r2.status_code == 200 and r1.json().get("id") == r2.json().get("id"),
            )
        else:
            qa.check("invoice idempotent", False, "no visits")

    if mgr:
        recs = requests.get(f"{API}/commission-records", headers=H(mgr), timeout=TIMEOUT)
        qa.check("commission records API", recs.status_code == 200, str(len(recs.json()) if recs.status_code == 200 else recs.status_code))

    return qa.summary()


if __name__ == "__main__":
    sys.exit(main())
