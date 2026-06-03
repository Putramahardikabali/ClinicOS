"""Front desk / FO today operations dashboard."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException

from permissions import user_has_permission

CLINICAL_ROLES = frozenset({"doctor", "therapist", "nurse"})
DISPLAY_STATUSES = frozenset({
    "booked", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "no_show",
})


def clinic_day_bounds(clinic: dict) -> Tuple[str, str, str, str]:
    tz_name = (clinic.get("timezone") or "Asia/Makassar").strip() or "Asia/Makassar"
    tz = None
    for candidate in (tz_name, "Asia/Makassar", "UTC"):
        try:
            tz = ZoneInfo(candidate)
            tz_name = candidate
            break
        except Exception:
            continue
    if tz is None:
        tz = timezone.utc
        tz_name = "UTC"
    local_today = datetime.now(tz).date().isoformat()
    return local_today, f"{local_today}T00:00:00", f"{local_today}T23:59:59", tz_name


def _map_display_status(booking: dict, visit: Optional[dict]) -> str:
    b_status = (booking.get("status") or "booked").strip().lower()
    if b_status in ("cancelled", "no_show", "blocked"):
        return "cancelled" if b_status == "cancelled" else ("no_show" if b_status == "no_show" else b_status)
    if visit:
        v_status = (visit.get("status") or "").strip().lower()
        if v_status == "in_progress":
            return "in_progress"
        if v_status in ("submitted", "completed"):
            return "completed" if b_status == "completed" or v_status == "completed" else "in_progress"
    if b_status == "checked_in":
        return "checked_in"
    if b_status == "confirmed":
        return "confirmed"
    if b_status == "completed":
        return "completed"
    if b_status in ("pending_payment", "payment_expired", "payment_failed"):
        return "booked"
    return "booked" if b_status not in DISPLAY_STATUSES else b_status


async def _load_treatment_consent_map(db, clinic_id: str, bookings: List[dict]) -> Dict[str, bool]:
    names = list({(b.get("treatment") or "").strip() for b in bookings if (b.get("treatment") or "").strip()})
    if not names:
        return {}
    consent_map: Dict[str, bool] = {}
    async for t in db.treatments.find(
        {"clinic_id": clinic_id, "name": {"$in": names}, "active": {"$ne": False}},
        {"_id": 0, "name": 1, "consent_required": 1},
    ):
        consent_map[t["name"]] = bool(t.get("consent_required"))
    return consent_map


def _booking_needs_consent(booking: dict, treatment_consent: Dict[str, bool]) -> bool:
    if booking.get("consent_required"):
        return True
    name = (booking.get("treatment") or "").strip()
    return bool(name and treatment_consent.get(name))


def _performer_label(booking: dict) -> str:
    performers = booking.get("performers") or []
    if performers:
        names = [p.get("staff_name_snapshot") or p.get("staff_id") for p in performers if p]
        return ", ".join(n for n in names if n) or "—"
    if booking.get("performer_name"):
        return booking["performer_name"]
    return "—"


def _quick_actions(
    booking: dict,
    visit: Optional[dict],
    invoice: Optional[dict],
    *,
    treatment_consent: Dict[str, bool],
    read_only: bool,
) -> List[dict]:
    if read_only:
        return []
    actions: List[dict] = []
    status = _map_display_status(booking, visit)
    bid = booking.get("id")
    vid = (visit or {}).get("id") or booking.get("visit_id")
    pid = booking.get("patient_id")

    if status in ("booked", "confirmed") and not vid:
        if status == "booked":
            actions.append({"key": "confirm", "label": "Confirm", "link": f"/bookings?open={bid}"})
        actions.append({"key": "check_in", "label": "Check in", "link": f"/bookings?open={bid}"})
    if vid:
        actions.append({"key": "open_visit", "label": "Open visit", "link": f"/visits/{vid}"})
    elif status == "checked_in" and not vid:
        actions.append({"key": "start_visit", "label": "Start visit", "link": f"/bookings?open={bid}"})

    if pid and _booking_needs_consent(booking, treatment_consent):
        actions.append({"key": "consent", "label": "Prepare consent", "link": f"/patients/{pid}?tab=consents"})

    if vid and not invoice:
        actions.append({"key": "create_invoice", "label": "Create invoice", "link": f"/invoices/visit/{vid}"})
    if invoice and invoice.get("payment_status") not in ("paid", "cancelled"):
        actions.append({"key": "take_payment", "label": "Take payment", "link": f"/invoices/{invoice['id']}"})

    if status in ("booked", "confirmed", "checked_in"):
        actions.append({"key": "no_show", "label": "Mark no-show", "link": f"/bookings?open={bid}&action=no_show"})
        actions.append({"key": "cancel", "label": "Cancel booking", "link": f"/bookings?open={bid}&action=cancel"})
    return actions


async def build_front_desk_today(db, user: dict, clinic: dict, *, read_only: bool = False) -> dict:
    cid = clinic["id"]
    today, day_start, day_end, tz_name = clinic_day_bounds(clinic)

    bookings = await db.bookings.find(
        {
            "clinic_id": cid,
            "scheduled_at": {"$gte": day_start, "$lte": day_end},
            "booking_type": {"$ne": "block"},
            "status": {"$ne": "blocked"},
        },
        {"_id": 0},
    ).sort("scheduled_at", 1).to_list(500)

    visit_ids = [b["visit_id"] for b in bookings if b.get("visit_id")]
    visits_by_id: Dict[str, dict] = {}
    if visit_ids:
        async for v in db.visits.find({"clinic_id": cid, "id": {"$in": visit_ids}}, {"_id": 0}):
            visits_by_id[v["id"]] = v

    invoices_by_visit: Dict[str, dict] = {}
    if visit_ids:
        async for inv in db.invoices.find(
            {"clinic_id": cid, "visit_id": {"$in": visit_ids}, "payment_status": {"$ne": "cancelled"}},
            {"_id": 0, "id": 1, "visit_id": 1, "payment_status": 1, "remaining_balance": 1},
        ):
            invoices_by_visit[inv["visit_id"]] = inv

    treatment_consent = await _load_treatment_consent_map(db, cid, bookings)

    patient_ids = list({b["patient_id"] for b in bookings if b.get("patient_id")})
    patients_by_id: Dict[str, dict] = {}
    if patient_ids:
        async for p in db.patients.find(
            {"clinic_id": cid, "id": {"$in": patient_ids}},
            {"_id": 0, "id": 1, "phone": 1, "consent_status": 1, "full_name": 1},
        ):
            patients_by_id[p["id"]] = p

    status_counts: Dict[str, int] = defaultdict(int)
    appointments: List[dict] = []
    for b in bookings:
        visit = visits_by_id.get(b.get("visit_id") or "")
        inv = invoices_by_visit.get(b.get("visit_id") or "")
        patient = patients_by_id.get(b.get("patient_id") or "")
        display_status = _map_display_status(b, visit)
        status_counts[display_status] += 1

        pay_status = "—"
        if inv:
            pay_status = inv.get("payment_status") or "unpaid"
        elif visit:
            pay_status = visit.get("payment_status") or "unpaid"

        consent_status = "—"
        if patient:
            consent_status = patient.get("consent_status") or "unsigned"
        elif _booking_needs_consent(b, treatment_consent):
            consent_status = "required"

        scheduled = b.get("scheduled_at") or ""
        appointments.append({
            "id": b.get("id"),
            "time": scheduled[11:16] if len(scheduled) >= 16 else scheduled,
            "scheduled_at": scheduled,
            "patient_id": b.get("patient_id"),
            "patient_name": b.get("patient_name") or (patient or {}).get("full_name") or "—",
            "patient_phone": (patient or {}).get("phone") or b.get("patient_phone") or "",
            "treatment": b.get("treatment") or b.get("package_name") or "—",
            "performer": _performer_label(b),
            "status": display_status,
            "booking_status": b.get("status"),
            "payment_status": pay_status,
            "consent_status": consent_status,
            "visit_id": b.get("visit_id"),
            "invoice_id": inv.get("id") if inv else None,
            "quick_actions": _quick_actions(b, visit, inv, treatment_consent=treatment_consent, read_only=read_only),
        })

    visits_in_progress = await db.visits.count_documents({"clinic_id": cid, "status": "in_progress"})
    status_counts["in_progress"] = max(status_counts.get("in_progress", 0), visits_in_progress)

    pending_payment = await db.invoices.count_documents({
        "clinic_id": cid,
        "payment_status": {"$in": ["unpaid", "partial"]},
        "created_at": {"$gte": day_start, "$lte": day_end},
    })
    pending_payment += sum(
        1 for a in appointments
        if a.get("visit_id") and a.get("payment_status") in ("unpaid", "partial")
    )

    from daily_closing import aggregate_daily_closing, get_closing_for_date

    closing_full = await aggregate_daily_closing(db, cid, today)
    closing_record = await get_closing_for_date(db, cid, today)
    is_closed = bool(closing_full.get("is_closed"))
    money_collected = int(closing_full.get("money_collected_idr") or closing_full.get("total_collected_idr") or 0)
    bd = closing_full.get("breakdown") or {}
    pm = closing_full.get("payment_methods") or bd.get("payment_methods") or {}
    wallet_summary = closing_full.get("wallet") or {}

    summary = {
        "total_appointments": len(bookings),
        "checked_in": status_counts.get("checked_in", 0),
        "in_progress": status_counts.get("in_progress", 0),
        "completed": status_counts.get("completed", 0),
        "cancelled": status_counts.get("cancelled", 0) + status_counts.get("no_show", 0),
        "cancelled_only": status_counts.get("cancelled", 0),
        "no_show": status_counts.get("no_show", 0),
        "confirmed": status_counts.get("confirmed", 0),
        "booked": status_counts.get("booked", 0),
        "pending_payment": pending_payment,
        "today_collected_idr": money_collected,
        "closing_status": "closed" if is_closed else "open",
    }

    action_queue: List[dict] = []
    if not read_only:
        for b in bookings:
            if b.get("status") in ("cancelled", "no_show", "blocked", "completed"):
                continue
            pid = b.get("patient_id")
            patient = patients_by_id.get(pid or "")
            phone = (patient or {}).get("phone") or b.get("patient_phone") or ""
            if not phone or len(phone.strip()) < 6:
                action_queue.append({
                    "kind": "missing_phone",
                    "severity": "warning",
                    "label": f"Missing phone: {b.get('patient_name')}",
                    "sub": b.get("treatment") or "Appointment",
                    "link": f"/bookings?open={b['id']}",
                    "booking_id": b["id"],
                })
            if _booking_needs_consent(b, treatment_consent):
                cst = (patient or {}).get("consent_status") or "unsigned"
                if cst not in ("signed",):
                    action_queue.append({
                        "kind": "consent_missing",
                        "severity": "warning",
                        "label": f"Consent needed: {b.get('patient_name')}",
                        "sub": "Prepare consent before treatment",
                        "link": f"/patients/{pid}?tab=consents" if pid else f"/bookings?open={b['id']}",
                        "booking_id": b["id"],
                    })
            if b.get("status") == "booked":
                action_queue.append({
                    "kind": "pending_confirmation",
                    "severity": "info",
                    "label": f"Confirm booking: {b.get('patient_name')}",
                    "sub": f"{(b.get('scheduled_at') or '')[11:16]} · {b.get('treatment')}",
                    "link": f"/bookings?open={b['id']}",
                    "booking_id": b["id"],
                })

        async for inv in db.invoices.find(
            {
                "clinic_id": cid,
                "payment_status": {"$in": ["unpaid", "partial"]},
                "created_at": {"$gte": day_start, "$lte": day_end},
            },
            {"_id": 0, "id": 1, "invoice_number": 1, "remaining_balance": 1, "visit_id": 1},
        ).limit(30):
            action_queue.append({
                "kind": "invoice_unpaid",
                "severity": "high",
                "label": f"Unpaid invoice {inv.get('invoice_number') or inv['id'][:8]}",
                "sub": f"Balance {int(inv.get('remaining_balance') or 0):,} IDR",
                "link": f"/invoices/{inv['id']}",
                "invoice_id": inv["id"],
            })

        async for v in db.visits.find(
            {
                "clinic_id": cid,
                "status": "completed",
                "payment_status": {"$nin": ["paid"]},
                "$or": [
                    {"completed_at": {"$gte": day_start, "$lte": day_end}},
                    {"visit_date": {"$regex": f"^{today}"}},
                ],
            },
            {"_id": 0, "id": 1, "patient_id": 1},
        ).limit(20):
            inv = await db.invoices.find_one(
                {"clinic_id": cid, "visit_id": v["id"], "payment_status": {"$nin": ["paid", "cancelled"]}},
                {"_id": 0, "id": 1},
            )
            if inv:
                action_queue.append({
                    "kind": "visit_unpaid",
                    "severity": "high",
                    "label": "Visit completed — payment pending",
                    "sub": f"Visit {v['id'][:8]}",
                    "link": f"/invoices/{inv['id']}",
                    "visit_id": v["id"],
                })

        draft_pos = await db.pos_sales.count_documents({"clinic_id": cid, "status": "draft", "created_at": {"$gte": day_start, "$lte": day_end}})
        if draft_pos:
            action_queue.append({
                "kind": "pos_draft",
                "severity": "info",
                "label": f"{draft_pos} draft POS sale(s)",
                "sub": "Complete or cancel drafts",
                "link": "/pos",
            })

        async for gc in db.gift_cards.find(
            {"clinic_id": cid, "reserved_booking_id": {"$exists": True, "$ne": None}, "status": "reserved"},
            {"_id": 0, "id": 1, "code": 1, "reserved_booking_id": 1},
        ).limit(20):
            bk = await db.bookings.find_one({"id": gc["reserved_booking_id"]}, {"_id": 0, "status": 1})
            if bk and bk.get("status") in ("cancelled", "no_show"):
                action_queue.append({
                    "kind": "gift_card_stale_reservation",
                    "severity": "warning",
                    "label": f"Gift card reserved on cancelled booking ({gc.get('code')})",
                    "sub": "Release or reassign gift card",
                    "link": f"/gift-cards/{gc['id']}",
                    "gift_card_id": gc["id"],
                })

        async for gc in db.gift_cards.find(
            {
                "clinic_id": cid,
                "gift_card_type": "package",
                "status": {"$in": ["active", "partially_redeemed"]},
                "$or": [{"recipient_patient_id": None}, {"recipient_patient_id": ""}],
            },
            {"_id": 0, "id": 1, "code": 1},
        ).limit(10):
            action_queue.append({
                "kind": "package_gc_no_patient",
                "severity": "info",
                "label": f"Package gift card needs patient ({gc.get('code')})",
                "sub": "Assign patient before booking",
                "link": f"/gift-cards/{gc['id']}",
                "gift_card_id": gc["id"],
            })

    sales_snapshot = {
        "pos_collected_idr": int((closing_full.get("pos") or {}).get("money_collected_idr") or 0),
        "invoice_collected_idr": int((closing_full.get("invoices") or {}).get("money_collected_idr") or 0),
        "gift_card_sales_idr": int(bd.get("gift_card_sales_idr") or closing_full.get("gift_card_sales_idr") or 0),
        "package_sales_idr": int(bd.get("package_sales_idr") or 0),
        "product_sales_idr": int(bd.get("product_sales_idr") or 0),
        "refunds_idr": int(bd.get("refunds_idr") or (closing_full.get("refunds") or {}).get("total_idr") or 0),
        "store_credit_used_idr": int(bd.get("store_credit_payments_idr") or closing_full.get("store_credit_payments_idr") or 0),
        "total_collected_idr": money_collected,
        "cash_idr": int(pm.get("cash") or 0),
        "card_idr": int(pm.get("card") or 0),
        "bank_transfer_idr": int(pm.get("bank_transfer") or 0),
        "qris_idr": int(pm.get("qris") or 0),
        "other_idr": int(pm.get("other") or 0),
        "gift_card_redemptions_idr": int(bd.get("gift_card_redemptions_idr") or closing_full.get("gift_card_redemptions_idr") or 0),
        "wallet_credits_issued_idr": int(bd.get("wallet_credits_issued_idr") or wallet_summary.get("wallet_credits_issued_idr") or 0),
    }

    closing_widget = {
        "status": "closed" if is_closed else "open",
        "is_closed": is_closed,
        "closing_id": closing_full.get("closing_id"),
        "expected_cash_idr": int(closing_full.get("expected_cash_idr") or 0),
        "actual_cash_counted_idr": closing_record.get("actual_cash_counted_idr") if closing_record else None,
        "cash_difference_idr": closing_record.get("cash_difference_idr") if closing_record else None,
        "closed_at": closing_record.get("closed_at") if closing_record else None,
        "closed_by_name": (closing_record or {}).get("closed_by_name_snapshot") or (closing_record or {}).get("closed_by"),
        "notes": (closing_record or {}).get("notes") or "",
    }

    can_close = user_has_permission(user, "closing.create") and not read_only
    can_reopen = user_has_permission(user, "closing.reopen") and not read_only

    return {
        "date": today,
        "timezone": tz_name,
        "read_only": read_only,
        "summary": summary,
        "appointments": appointments,
        "action_queue": action_queue[:40],
        "sales_snapshot": sales_snapshot,
        "closing": closing_widget,
        "capabilities": {
            "can_manage_appointments": not read_only and user_has_permission(user, "appointments.edit"),
            "can_billing": not read_only and user_has_permission(user, "billing.edit"),
            "can_pos": not read_only and user_has_permission(user, "pos.create"),
            "can_close_day": can_close,
            "can_reopen_day": can_reopen,
            "can_view_closing": user_has_permission(user, "closing.view") or user_has_permission(user, "accounting.view"),
        },
    }


def can_access_front_desk(user: dict) -> Tuple[bool, bool]:
    """Returns (allowed, read_only)."""
    role = (user.get("role") or "").strip().lower()
    if role in CLINICAL_ROLES:
        return False, False
    if role in ("fo", "super_admin", "manager"):
        if user_has_permission(user, "dashboard.view") or role in ("super_admin", "manager", "fo"):
            return True, False
    if user_has_permission(user, "accounting.view") and (
        user_has_permission(user, "closing.view") or user_has_permission(user, "billing.view")
    ):
        return True, True
    if user_has_permission(user, "appointments.view") and user_has_permission(user, "dashboard.view"):
        return True, False
    return False, False


def register_front_desk_dashboard(api, db, get_current_user, get_active_clinic):
    @api.get("/dashboard/front-desk/today")
    async def front_desk_today(user: dict = Depends(get_current_user)):
        allowed, read_only = can_access_front_desk(user)
        if not allowed:
            raise HTTPException(status_code=403, detail="Front desk dashboard is not available for this role")
        clinic = await get_active_clinic(user)
        return await build_front_desk_today(db, user, clinic, read_only=read_only)

    return api
