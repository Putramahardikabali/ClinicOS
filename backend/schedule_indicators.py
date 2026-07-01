"""Schedule view enrichment: display status, patient flags, and card indicators."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional

from visit_workflow import clinic_loyalty_tiers, resolve_patient_loyalty
from patient_labels_core import blacklist_info_from_labels, enrich_patients_with_labels


def resolve_schedule_display_status(booking: dict, visit: Optional[dict] = None) -> str:
    """Map booking (+ optional visit) to a schedule card color key."""
    if booking.get("status") == "blocked" or booking.get("booking_type") == "block":
        return "block_out"
    b_status = (booking.get("status") or "booked").strip().lower()
    if b_status == "cancelled":
        return "cancelled"
    if b_status == "no_show":
        return "no_show"
    if b_status in ("payment_expired", "payment_failed"):
        return "unavailable"
    if b_status == "pending_payment":
        return "unavailable"
    if b_status == "completed":
        return "completed"
    if visit:
        v_status = (visit.get("status") or "").strip().lower()
        if v_status == "in_progress":
            return "treatment_started"
        if v_status in ("submitted", "completed") and b_status != "completed":
            return "closed"
        if v_status == "completed":
            return "completed"
    if b_status == "checked_in":
        return "checked_in"
    if b_status == "confirmed":
        return "confirmed"
    return "booked"


def _profile_alert_from_patient(patient: Optional[dict]) -> Dict[str, Any]:
    if not patient:
        return {"active": False, "label": ""}
    if patient.get("profile_alert"):
        label = (patient.get("profile_alert_label") or "Profile alert").strip()
        return {"active": True, "label": label}
    guest_icon = (patient.get("guest_icon_information") or "").strip()
    if guest_icon:
        return {"active": True, "label": guest_icon[:120]}
    return {"active": False, "label": ""}


def _labels_profile_alert(patient: Optional[dict]) -> Dict[str, Any]:
    labels = (patient or {}).get("patient_labels") or []
    bl = blacklist_info_from_labels(labels)
    if bl.get("active"):
        reason = (bl.get("reason") or "").strip()
        label = bl.get("label") or "Blacklist"
        return {"active": True, "label": f"{label}: {reason}" if reason else label}
    return {"active": False, "label": ""}


def _merge_profile_alerts(primary: Dict[str, Any], secondary: Dict[str, Any]) -> Dict[str, Any]:
    if not secondary.get("active"):
        return primary
    if not primary.get("active"):
        return secondary
    return {
        "active": True,
        "label": f"{primary.get('label') or 'Alert'}; {secondary.get('label') or 'Alert'}",
    }


def _profile_alert_from_history(
    patient: Optional[dict],
    history: Dict[str, int],
) -> Dict[str, Any]:
    direct = _profile_alert_from_patient(patient)
    if direct["active"]:
        return direct
    reasons: List[str] = []
    if history.get("no_show", 0) >= 2:
        reasons.append("Repeated no-show")
    if history.get("cancelled", 0) >= 3:
        reasons.append("Repeated cancellation")
    if history.get("late", 0) >= 3:
        reasons.append("Repeated lateness")
    if reasons:
        return {"active": True, "label": "; ".join(reasons)}
    return {"active": False, "label": ""}


def _has_specific_staff_request(booking: dict) -> bool:
    """True only when FO explicitly marked a patient-requested provider (not normal assignment)."""
    return bool(booking.get("specific_staff_requested"))


def _requested_staff_label(booking: dict, staff_names: Dict[str, str]) -> str:
    snapshot = (booking.get("requested_staff_name_snapshot") or "").strip()
    if snapshot:
        return snapshot
    requested = (booking.get("requested_performer_id") or "").strip()
    if requested and staff_names.get(requested):
        return staff_names[requested]
    return "Requested staff"


def _uses_package(booking: dict) -> bool:
    if booking.get("booking_type") == "package":
        return True
    if booking.get("package_id"):
        return True
    if booking.get("patient_package_id"):
        return True
    return False


def _package_label(booking: dict) -> str:
    name = (booking.get("treatment") or "").strip()
    return name or "Package session"


def build_schedule_indicators(
    booking: dict,
    *,
    patient: Optional[dict],
    completed_visits: int,
    loyalty_tier: Optional[dict],
    booking_history: Dict[str, int],
    visit: Optional[dict],
    staff_names: Dict[str, str],
) -> Dict[str, Any]:
    """Build schedule_meta.indicators for one appointment card."""
    profile_alert = _merge_profile_alerts(
        _profile_alert_from_history(patient, booking_history),
        _labels_profile_alert(patient),
    )
    patient_labels = (patient or {}).get("patient_labels") or []
    blacklist = blacklist_info_from_labels(patient_labels)
    specific_staff = _has_specific_staff_request(booking)
    package_use = _uses_package(booking)
    has_loyalty = bool(loyalty_tier and loyalty_tier.get("name"))
    is_new = completed_visits <= 0
    is_recurring = completed_visits > 0

    display_status = resolve_schedule_display_status(booking, visit)
    checked_in_at = None
    if (booking.get("status") or "") == "checked_in":
        checked_in_at = booking.get("checked_in_at") or booking.get("status_updated_at")

    performers = booking.get("performers") or []
    staff_assigned = []
    for p in performers:
        name = p.get("staff_name_snapshot") or staff_names.get(p.get("staff_id") or "", "")
        if name:
            staff_assigned.append(name)
    if not staff_assigned and booking.get("performer_id"):
        name = staff_names.get(booking["performer_id"], "")
        if name:
            staff_assigned.append(name)

    return {
        "display_status": display_status,
        "profile_alert": profile_alert,
        "patient_labels": patient_labels,
        "blacklist": blacklist,
        "specific_staff_request": {
            "active": specific_staff,
            "label": _requested_staff_label(booking, staff_names) if specific_staff else "",
        },
        "package_use": {
            "active": package_use,
            "label": _package_label(booking) if package_use else "",
        },
        "loyalty": {
            "active": has_loyalty,
            "tier_name": (loyalty_tier or {}).get("name") or "",
            "tier_color": (loyalty_tier or {}).get("color") or "",
        },
        "new_patient": is_new,
        "recurring_patient": is_recurring,
        "completed_visits": completed_visits,
        "checked_in_at": checked_in_at,
        "staff_assigned": staff_assigned,
        "note_preview": (booking.get("notes") or "").strip()[:160],
        "payment_status": (visit or {}).get("payment_status"),
    }


async def enrich_bookings_schedule_meta(db, clinic_id: str, bookings: List[dict]) -> List[dict]:
    """Attach schedule_meta to booking dicts for FO schedule cards."""
    if not bookings or not clinic_id:
        return bookings

    patient_ids = list({b["patient_id"] for b in bookings if b.get("patient_id")})
    visit_ids = list({b["visit_id"] for b in bookings if b.get("visit_id")})

    patients_by_id: Dict[str, dict] = {}
    if patient_ids:
        async for p in db.patients.find(
            {"clinic_id": clinic_id, "id": {"$in": patient_ids}},
            {
                "_id": 0,
                "id": 1,
                "profile_alert": 1,
                "profile_alert_label": 1,
                "guest_icon_information": 1,
            },
        ):
            patients_by_id[p["id"]] = p
        await enrich_patients_with_labels(db, clinic_id, list(patients_by_id.values()))

    visits_by_id: Dict[str, dict] = {}
    if visit_ids:
        async for v in db.visits.find(
            {"clinic_id": clinic_id, "id": {"$in": visit_ids}},
            {"_id": 0, "id": 1, "status": 1},
        ):
            visits_by_id[v["id"]] = v

    completed_visits_by_patient: Dict[str, int] = {}
    if patient_ids:
        pipeline = [
            {"$match": {"clinic_id": clinic_id, "patient_id": {"$in": patient_ids}, "status": "completed"}},
            {"$group": {"_id": "$patient_id", "n": {"$sum": 1}}},
        ]
        async for row in db.visits.aggregate(pipeline):
            completed_visits_by_patient[row["_id"]] = int(row.get("n") or 0)

    history_by_patient: Dict[str, Dict[str, int]] = defaultdict(lambda: {"no_show": 0, "cancelled": 0, "late": 0})
    if patient_ids:
        async for b in db.bookings.find(
            {
                "clinic_id": clinic_id,
                "patient_id": {"$in": patient_ids},
                "status": {"$in": ["no_show", "cancelled"]},
            },
            {"_id": 0, "patient_id": 1, "status": 1},
        ):
            pid = b.get("patient_id")
            if not pid:
                continue
            st = (b.get("status") or "").lower()
            if st in history_by_patient[pid]:
                history_by_patient[pid][st] += 1

    spend_by_patient: Dict[str, float] = {pid: 0.0 for pid in patient_ids}
    if patient_ids:
        visit_rows = [
            v
            async for v in db.visits.find(
                {"clinic_id": clinic_id, "patient_id": {"$in": patient_ids}},
                {"_id": 0, "id": 1, "patient_id": 1},
            )
        ]
        vid_to_pid = {v["id"]: v.get("patient_id") for v in visit_rows}
        visit_ids_all = list(vid_to_pid.keys())
        if visit_ids_all:
            pipeline = [
                {"$match": {"clinic_id": clinic_id, "visit_id": {"$in": visit_ids_all}}},
                {
                    "$group": {
                        "_id": "$visit_id",
                        "total": {"$sum": {"$multiply": [{"$ifNull": ["$price", 0]}, {"$ifNull": ["$quantity", 1]}]}},
                    }
                },
            ]
            async for row in db.treatment_items.aggregate(pipeline):
                pid = vid_to_pid.get(row["_id"])
                if pid:
                    spend_by_patient[pid] = spend_by_patient.get(pid, 0.0) + float(row.get("total") or 0)

    tiers = await clinic_loyalty_tiers(db, clinic_id)
    loyalty_by_patient: Dict[str, Optional[dict]] = {}
    for pid in patient_ids:
        resolved = resolve_patient_loyalty(spend_by_patient.get(pid, 0.0), tiers)
        loyalty_by_patient[pid] = resolved.get("loyalty_tier")

    staff_ids = set()
    for b in bookings:
        if b.get("performer_id"):
            staff_ids.add(b["performer_id"])
        if b.get("requested_performer_id"):
            staff_ids.add(b["requested_performer_id"])
        for p in b.get("performers") or []:
            if p.get("staff_id"):
                staff_ids.add(p["staff_id"])
    staff_names: Dict[str, str] = {}
    if staff_ids:
        async for u in db.users.find(
            {"clinic_id": clinic_id, "id": {"$in": list(staff_ids)}},
            {"_id": 0, "id": 1, "name": 1},
        ):
            staff_names[u["id"]] = u.get("name") or ""

    for b in bookings:
        pid = b.get("patient_id")
        patient = patients_by_id.get(pid or "")
        visit = visits_by_id.get(b.get("visit_id") or "")
        b["schedule_meta"] = build_schedule_indicators(
            b,
            patient=patient,
            completed_visits=completed_visits_by_patient.get(pid or "", 0),
            loyalty_tier=loyalty_by_patient.get(pid or ""),
            booking_history=dict(history_by_patient.get(pid or "", {})),
            visit=visit,
            staff_names=staff_names,
        )
    return bookings
