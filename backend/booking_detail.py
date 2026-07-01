"""Booking detail enrichment and status transitions for FO appointment modal."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException

from schedule_indicators import resolve_schedule_display_status
from saas import iso, now_utc

# UI-facing appointment statuses (includes visit-derived labels)
APPOINTMENT_STATUS_LABELS = {
    "booked": "Booked",
    "confirmed": "Confirmed",
    "checked_in": "Checked In",
    "treatment_started": "Treatment Started",
    "completed": "Completed",
    "closed": "Closed",
    "cancelled": "Cancelled",
    "no_show": "No Show",
    "pending_payment": "Pending payment",
    "payment_expired": "Payment expired",
    "payment_failed": "Payment failed",
}

BOOKING_STATUS_VALUES = frozenset({
    "booked", "confirmed", "checked_in", "completed", "cancelled", "no_show",
    "blocked", "pending_payment", "payment_expired", "payment_failed",
    "treatment_started", "closed",
})

SENSITIVE_STATUS_CHANGES = frozenset({"cancelled", "no_show", "closed"})
REASON_REQUIRED_STATUSES = frozenset({"cancelled", "no_show"})


def resolve_effective_appointment_status(booking: dict, visit: Optional[dict] = None) -> str:
    """Status shown in FO appointment modal (may differ from raw booking.status)."""
    display = resolve_schedule_display_status(booking, visit)
    if display == "block_out":
        return "blocked"
    if display in APPOINTMENT_STATUS_LABELS:
        return display
    raw = (booking.get("status") or "booked").strip().lower()
    return raw if raw in APPOINTMENT_STATUS_LABELS else "booked"


async def enrich_booking_detail(db, clinic_id: str, booking: dict) -> dict:
    """Attach patient labels, visit, invoice summary, and display status."""
    out = dict(booking)
    visit = None
    if booking.get("visit_id"):
        visit = await db.visits.find_one(
            {"clinic_id": clinic_id, "id": booking["visit_id"]},
            {"_id": 0},
        )
    out["visit"] = visit
    out["display_status"] = resolve_effective_appointment_status(booking, visit)
    out["display_status_label"] = APPOINTMENT_STATUS_LABELS.get(out["display_status"], out["display_status"])

    patient = None
    if booking.get("patient_id"):
        patient = await db.patients.find_one(
            {"clinic_id": clinic_id, "id": booking["patient_id"]},
            {"_id": 0},
        )
        if patient:
            from patient_labels_core import enrich_patients_with_labels
            await enrich_patients_with_labels(db, clinic_id, [patient])
        out["patient"] = patient
        out["patient_labels"] = (patient or {}).get("patient_labels") or []
        out["is_blacklisted"] = bool((patient or {}).get("is_blacklisted"))
    else:
        out["patient"] = None
        out["patient_labels"] = []
        out["is_blacklisted"] = False

    invoice = None
    if booking.get("visit_id"):
        invoice = await db.invoices.find_one(
            {
                "clinic_id": clinic_id,
                "visit_id": booking["visit_id"],
                "payment_status": {"$nin": ["cancelled"]},
            },
            {"_id": 0},
        )
    if not invoice and booking.get("id"):
        invoice = await db.invoices.find_one(
            {
                "clinic_id": clinic_id,
                "appointment_id": booking["id"],
                "payment_status": {"$nin": ["cancelled"]},
            },
            {"_id": 0},
        )
    if invoice:
        out["invoice"] = {
            "id": invoice.get("id"),
            "invoice_number": invoice.get("invoice_number"),
            "payment_status": invoice.get("payment_status"),
            "total_amount": invoice.get("total_amount"),
            "amount_paid": invoice.get("amount_paid"),
            "remaining_balance": invoice.get("remaining_balance"),
        }
    else:
        out["invoice"] = None

    if visit:
        out["payment_status"] = visit.get("payment_status") or "unpaid"
    elif out.get("invoice"):
        out["payment_status"] = out["invoice"].get("payment_status") or "unpaid"
    else:
        out["payment_status"] = None

    return out


async def apply_booking_status_change(
    db,
    user: dict,
    existing: dict,
    new_status: str,
    *,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Apply status transition with visit side-effects. Returns update fields for booking."""
    if new_status not in BOOKING_STATUS_VALUES:
        raise HTTPException(status_code=400, detail="Invalid status")
    old_status = (existing.get("status") or "booked").strip().lower()
    clinic_id = user["clinic_id"]
    bid = existing["id"]
    now = iso(now_utc())
    upd: Dict[str, Any] = {"status_updated_at": now}

    if new_status in REASON_REQUIRED_STATUSES and not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required for this status")

    if new_status == "treatment_started":
        visit_id = existing.get("visit_id")
        if not visit_id:
            raise HTTPException(
                status_code=400,
                detail="Start a treatment session first before marking treatment started",
            )
        await db.visits.update_one(
            {"clinic_id": clinic_id, "id": visit_id},
            {"$set": {"status": "in_progress", "updated_at": now}},
        )
        upd["status"] = "checked_in" if old_status in ("booked", "confirmed") else old_status
        if upd["status"] == "checked_in" and not existing.get("checked_in_at"):
            upd["checked_in_at"] = now
        effective_new = "treatment_started"
    elif new_status == "closed":
        visit_id = existing.get("visit_id")
        if visit_id:
            await db.visits.update_one(
                {"clinic_id": clinic_id, "id": visit_id},
                {"$set": {"status": "submitted", "updated_at": now}},
            )
        upd["status"] = "completed"
        effective_new = "closed"
    else:
        upd["status"] = new_status
        effective_new = new_status
        if new_status == "checked_in" and not existing.get("checked_in_at"):
            upd["checked_in_at"] = now
        if new_status == "cancelled":
            if reason:
                upd["cancellation_reason"] = reason.strip()
        if new_status == "no_show":
            if reason:
                upd["no_show_reason"] = reason.strip()

    await db.bookings.update_one({"clinic_id": clinic_id, "id": bid}, {"$set": upd})
    updated = await db.bookings.find_one({"clinic_id": clinic_id, "id": bid}, {"_id": 0})

    from audit_log import log_appointment_status_changed
    await log_appointment_status_changed(
        db,
        user,
        bid,
        old_status=old_status,
        new_status=effective_new,
        reason=(reason or "").strip() or None,
    )

    return updated or {**existing, **upd}
