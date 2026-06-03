"""Owner / Manager operations dashboard — clinic-wide metrics (not assigned-to-me)."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from clinic_reports import (
    _aggregate_revenue,
    _load_invoices,
    _load_paid_invoices_by_paid_at,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _today_bounds() -> tuple[str, str, str]:
    today = _utc_now().strftime("%Y-%m-%d")
    return today, f"{today}T00:00:00", f"{today}T23:59:59"


def _yesterday_bounds() -> tuple[str, str, str]:
    y = (_utc_now().date() - timedelta(days=1)).isoformat()
    return y, f"{y}T00:00:00", f"{y}T23:59:59"



async def _sum_paid_revenue(db, cid: str, start_iso: str, end_iso: str) -> int:
    paid_in_range = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
    return sum(
        int(i.get("amount_paid") or 0)
        for i in paid_in_range
        if i.get("payment_status") == "paid"
    )


async def _outstanding_balance(db, cid: str) -> int:
    total = 0
    async for inv in db.invoices.find(
        {"clinic_id": cid, "payment_status": {"$in": ["unpaid", "partial"]}},
        {"_id": 0, "remaining_balance": 1},
    ):
        total += int(inv.get("remaining_balance") or 0)
    return total


def _trend_pct(today_val: float, yesterday_val: float) -> Optional[float]:
    if yesterday_val <= 0:
        return None if today_val <= 0 else 100.0
    return round((today_val - yesterday_val) / yesterday_val * 100, 1)


def register_dashboard_operations(
    api: APIRouter,
    db,
    get_current_user,
    get_active_clinic,
):
    @api.get("/dashboard/operations")
    async def operations_dashboard(user: dict = Depends(get_current_user)):
        if user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Operations dashboard is for owner and manager only")
        c = await get_active_clinic(user)
        cid = c["id"]
        today, today_start, today_end = _today_bounds()
        yday, yday_start, yday_end = _yesterday_bounds()

        # --- KPIs with yesterday comparison ---
        revenue_today = await _sum_paid_revenue(db, cid, today_start, today_end)
        revenue_yesterday = await _sum_paid_revenue(db, cid, yday_start, yday_end)

        bookings_today = await db.bookings.count_documents({
            "clinic_id": cid,
            "scheduled_at": {"$gte": today_start, "$lte": today_end},
            "booking_type": {"$ne": "block"},
        })
        bookings_yesterday = await db.bookings.count_documents({
            "clinic_id": cid,
            "scheduled_at": {"$gte": yday_start, "$lte": yday_end},
            "booking_type": {"$ne": "block"},
        })

        visits_completed_today = await db.visits.count_documents({
            "clinic_id": cid,
            "status": "completed",
            "$or": [
                {"completed_at": {"$gte": today_start, "$lte": today_end}},
                {"visit_date": {"$regex": f"^{today}"}},
            ],
        })
        visits_completed_yesterday = await db.visits.count_documents({
            "clinic_id": cid,
            "status": "completed",
            "$or": [
                {"completed_at": {"$gte": yday_start, "$lte": yday_end}},
                {"visit_date": {"$regex": f"^{yday}"}},
            ],
        })

        outstanding = await _outstanding_balance(db, cid)

        pending_notes = 0
        completed_visits = await db.visits.find(
            {"clinic_id": cid, "status": "completed", "completed_at": {"$gte": today_start, "$lte": today_end}},
            {"_id": 0, "id": 1, "visit_type": 1},
        ).to_list(500)
        for v in completed_visits:
            coll = "clinical_records" if v.get("visit_type") == "doctor" else "therapist_records"
            rec = await db[coll].find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1, "note_status": 1})
            if not rec or (not rec.get("submitted") and rec.get("note_status") not in ("completed", "locked")):
                pending_notes += 1
        # clinic-wide pending notes (all completed visits missing notes)
        pending_notes_all = 0
        completed_all = await db.visits.find(
            {"clinic_id": cid, "status": "completed"},
            {"_id": 0, "id": 1, "visit_type": 1},
        ).to_list(300)
        for v in completed_all:
            coll = "clinical_records" if v.get("visit_type") == "doctor" else "therapist_records"
            rec = await db[coll].find_one({"visit_id": v["id"]}, {"_id": 0, "submitted": 1, "note_status": 1})
            if not rec or (not rec.get("submitted") and rec.get("note_status") not in ("completed", "locked")):
                pending_notes_all += 1

        pending_consent = await db.consent_forms.count_documents({
            "clinic_id": cid,
            "status": {"$in": ["not_sent", "pending"]},
        })

        active_packages = await db.patient_packages.count_documents({
            "clinic_id": cid,
            "status": {"$in": ["active", "partially_used"]},
        })

        commission_approved_unpaid = 0
        async for r in db.commission_records.find(
            {"clinic_id": cid, "status": "approved"},
            {"_id": 0, "commission_amount": 1},
        ):
            commission_approved_unpaid += int(r.get("commission_amount") or 0)

        kpis = {
            "revenue_today_idr": revenue_today,
            "revenue_today_trend_pct": _trend_pct(revenue_today, revenue_yesterday),
            "bookings_today": bookings_today,
            "bookings_today_trend_pct": _trend_pct(bookings_today, bookings_yesterday),
            "visits_completed_today": visits_completed_today,
            "visits_completed_today_trend_pct": _trend_pct(visits_completed_today, visits_completed_yesterday),
            "outstanding_payment_idr": outstanding,
            "pending_clinical_notes": pending_notes_all,
            "pending_consent": pending_consent,
            "active_packages": active_packages,
            "commission_approved_unpaid_idr": commission_approved_unpaid,
        }

        # --- Today's clinic overview (bookings by status) ---
        today_bookings = await db.bookings.find(
            {"clinic_id": cid, "scheduled_at": {"$gte": today_start, "$lte": today_end}, "booking_type": {"$ne": "block"}},
            {"_id": 0, "status": 1},
        ).to_list(5000)
        status_counts: Dict[str, int] = defaultdict(int)
        for b in today_bookings:
            status_counts[b.get("status") or "booked"] += 1

        visits_in_progress = await db.visits.count_documents({
            "clinic_id": cid,
            "status": "in_progress",
        })

        clinic_overview = {
            "total_bookings": len(today_bookings),
            "confirmed": status_counts.get("confirmed", 0),
            "arrived": status_counts.get("checked_in", 0),
            "in_treatment": visits_in_progress,
            "completed": status_counts.get("completed", 0),
            "cancelled": status_counts.get("cancelled", 0),
            "no_show": status_counts.get("no_show", 0),
            "booked_pending": status_counts.get("booked", 0),
        }

        # --- Staff / performer overview ---
        bookings_by_performer: Dict[str, int] = defaultdict(int)
        visits_by_performer: Dict[str, int] = defaultdict(int)
        workload_by_role: Dict[str, int] = defaultdict(int)

        full_today_bks = await db.bookings.find(
            {"clinic_id": cid, "scheduled_at": {"$gte": today_start, "$lte": today_end}, "booking_type": {"$ne": "block"}},
            {"_id": 0, "performers": 1, "performer_id": 1, "performer_name": 1},
        ).to_list(5000)
        for b in full_today_bks:
            performers = b.get("performers") or []
            if not performers and b.get("performer_id"):
                performers = [{"staff_name_snapshot": b.get("performer_name"), "staff_role_snapshot": ""}]
            for p in performers:
                name = p.get("staff_name_snapshot") or p.get("staff_id") or "—"
                bookings_by_performer[name] += 1
                role = p.get("staff_role_snapshot") or p.get("performer_type") or ""
                if role in ("doctor", "therapist", "nurse"):
                    workload_by_role[role] += 1

        today_visits = await db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": today_start, "$lte": today_end}},
            {"_id": 0, "performers": 1},
        ).to_list(5000)
        for v in today_visits:
            for p in (v.get("performers") or []):
                name = p.get("staff_name_snapshot") or p.get("staff_id") or "—"
                visits_by_performer[name] += 1

        staff_performance = {
            "bookings_by_performer": [
                {"performer": k, "count": v}
                for k, v in sorted(bookings_by_performer.items(), key=lambda x: -x[1])[:15]
            ],
            "visits_by_performer": [
                {"performer": k, "count": v}
                for k, v in sorted(visits_by_performer.items(), key=lambda x: -x[1])[:15]
            ],
            "workload_by_role": [
                {"role": k, "bookings": v} for k, v in sorted(workload_by_role.items(), key=lambda x: -x[1])
            ],
        }

        # --- Action required alerts ---
        alerts: List[Dict[str, Any]] = []

        if pending_notes_all > 0:
            alerts.append({
                "id": "missing_notes",
                "severity": "warning",
                "label": f"{pending_notes_all} visit(s) missing clinical notes",
                "link": "/visits?status=completed",
            })

        if pending_consent > 0:
            alerts.append({
                "id": "pending_consent",
                "severity": "warning",
                "label": f"{pending_consent} consent form(s) pending",
                "link": "/patients",
            })

        unpaid_inv = await db.invoices.count_documents({
            "clinic_id": cid,
            "payment_status": "unpaid",
        })
        partial_inv = await db.invoices.count_documents({
            "clinic_id": cid,
            "payment_status": "partial",
        })
        if unpaid_inv or partial_inv:
            alerts.append({
                "id": "outstanding_invoices",
                "severity": "high",
                "label": f"{unpaid_inv} unpaid + {partial_inv} partial invoice(s)",
                "link": "/invoices?payment_status=unpaid",
            })

        exp_cutoff = (_utc_now().date() + timedelta(days=30)).strftime("%Y-%m-%d")
        expiring = await db.patient_packages.count_documents({
            "clinic_id": cid,
            "status": {"$in": ["active", "partially_used"]},
            "expiry_date": {"$lte": exp_cutoff, "$exists": True},
        })
        if expiring > 0:
            alerts.append({
                "id": "packages_expiring",
                "severity": "info",
                "label": f"{expiring} package(s) expiring within 30 days",
                "link": "/packages",
            })

        clinical_staff = await db.users.find(
            {"clinic_id": cid, "role": {"$in": ["doctor", "therapist", "nurse"]}, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "role": 1},
        ).to_list(100)
        no_schedule = []
        for s in clinical_staff:
            sched = await db.weekly_staff_schedules.find_one(
                {"clinic_id": cid, "staff_id": s["id"]},
                {"_id": 0, "days": 1},
            )
            if not sched or not (sched.get("days") or []):
                no_schedule.append(s.get("name") or s["id"])
        if no_schedule:
            alerts.append({
                "id": "staff_no_schedule",
                "severity": "info",
                "label": f"{len(no_schedule)} staff without weekly schedule",
                "link": "/staff/schedule",
            })

        comm_pending = await db.commission_records.count_documents({
            "clinic_id": cid,
            "status": "pending",
        })
        if comm_pending > 0:
            alerts.append({
                "id": "commission_pending",
                "severity": "warning",
                "label": f"{comm_pending} commission record(s) awaiting approval",
                "link": "/staff/commissions",
            })

        # --- Charts (last 7 days) ---
        end_d = _utc_now().date()
        start_d = end_d - timedelta(days=6)
        start_7_iso = f"{start_d.isoformat()}T00:00:00"
        end_7_iso = f"{end_d.isoformat()}T23:59:59"

        invoices_7 = await _load_invoices(db, cid, start_7_iso, end_7_iso)
        paid_7 = await _load_paid_invoices_by_paid_at(db, cid, start_7_iso, end_7_iso)
        rev_7 = _aggregate_revenue(invoices_7, paid_7)

        treatment_count: Dict[str, int] = defaultdict(int)
        revenue_invs = [i for i in paid_7 if i.get("payment_status") == "paid"]
        for inv in revenue_invs:
            for it in inv.get("items") or []:
                if it.get("item_type") == "treatment":
                    treatment_count[it.get("name") or "—"] += int(it.get("quantity") or 1)

        booking_status_7: Dict[str, int] = defaultdict(int)
        bks_7 = await db.bookings.find(
            {
                "clinic_id": cid,
                "scheduled_at": {"$gte": start_7_iso, "$lte": end_7_iso},
                "booking_type": {"$ne": "block"},
            },
            {"_id": 0, "status": 1},
        ).to_list(10000)
        for b in bks_7:
            booking_status_7[b.get("status") or "booked"] += 1

        visit_status_7: Dict[str, int] = defaultdict(int)
        vis_7 = await db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": start_7_iso, "$lte": end_7_iso}},
            {"_id": 0, "status": 1},
        ).to_list(10000)
        for v in vis_7:
            visit_status_7[v.get("status") or "—"] += 1

        charts = {
            "revenue_last_7_days": rev_7["by_date"],
            "booking_status_breakdown": [
                {"status": k, "count": v} for k, v in sorted(booking_status_7.items(), key=lambda x: -x[1])
            ],
            "visit_status_breakdown": [
                {"status": k, "count": v} for k, v in sorted(visit_status_7.items(), key=lambda x: -x[1])
            ],
            "top_treatments_by_count": [
                {"name": k, "count": v}
                for k, v in sorted(treatment_count.items(), key=lambda x: -x[1])[:8]
            ],
            "revenue_by_payment_method": rev_7["by_payment_method"],
        }

        # Recent audit highlights
        recent_audit = await db.audit_logs.find(
            {"clinic_id": cid},
            {"_id": 0, "patient_signature": 0},
        ).sort("created_at", -1).to_list(8)
        audit_highlights = [
            {
                "time": (a.get("created_at") or "")[:19],
                "user": a.get("user_email") or "—",
                "action": a.get("action") or "—",
                "module": a.get("module") or "—",
            }
            for a in recent_audit
        ]

        return {
            "date": today,
            "kpis": kpis,
            "clinic_overview": clinic_overview,
            "staff_performance": staff_performance,
            "alerts": alerts,
            "charts": charts,
            "audit_highlights": audit_highlights,
        }

    return api
