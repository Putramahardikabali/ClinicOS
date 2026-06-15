"""Appointment → visit workflow helpers."""

from __future__ import annotations



import re

import uuid

from datetime import datetime, timezone

from typing import Any, Dict, List, Optional



from performers import (

    get_performers,

    primary_performer_id,

    resolve_visit_type_from_performers,

    sync_legacy_performer_fields,

)

from saas import iso, now_utc





def _normalize_phone(phone: str) -> str:

    return "".join(ch for ch in (phone or "") if ch.isdigit() or ch == "+").strip()





async def ensure_patient_for_booking(db, booking: dict, clinic_id: str) -> str:

    """Return patient_id for a booking, creating or matching by phone/email if needed."""

    pid = booking.get("patient_id")

    if pid:

        existing = await db.patients.find_one({"clinic_id": clinic_id, "id": pid}, {"_id": 0, "id": 1})

        if existing:

            return pid



    phone = _normalize_phone(booking.get("patient_phone") or "")

    email = (booking.get("patient_email") or "").strip().lower()

    match = None

    if phone:

        match = await db.patients.find_one({"clinic_id": clinic_id, "phone": phone}, {"_id": 0, "id": 1})

    if not match and email:

        match = await db.patients.find_one({"clinic_id": clinic_id, "email": email}, {"_id": 0, "id": 1})

    if match:

        return match["id"]



    doc = {

        "id": str(uuid.uuid4()),

        "clinic_id": clinic_id,

        "full_name": (booking.get("patient_name") or "Guest").strip(),

        "phone": phone or None,

        "email": email or None,

        "source": "booking",

        "created_at": iso(now_utc()),

    }

    await db.patients.insert_one(doc)

    return doc["id"]





async def _resolve_visit_type(db, booking: dict, clinic_id: str) -> str:

    performers = get_performers(booking)

    if performers:

        return resolve_visit_type_from_performers(performers)



    performer_id = booking.get("performer_id")

    if performer_id:

        u = await db.users.find_one({"id": performer_id, "clinic_id": clinic_id}, {"_id": 0, "role": 1})

        if u:

            role = u.get("role")

            if role in ("doctor", "therapist", "nurse"):

                return role



    treatment_name = booking.get("treatment") or ""

    t = await db.treatments.find_one(

        {"clinic_id": clinic_id, "name": treatment_name},

        {"_id": 0, "performer_type": 1, "allowed_performer_roles": 1},

    )

    if t:

        from performers import normalize_allowed_performer_roles

        roles = normalize_allowed_performer_roles(t)

        if "doctor" in roles and len(roles) == 1:

            return "doctor"

        if "nurse" in roles and len(roles) == 1:

            return "nurse"

        if "therapist" in roles and len(roles) == 1:

            return "therapist"

        pt = (t.get("performer_type") or "therapist").lower()

        if pt == "doctor":

            return "doctor"

        if pt == "nurse":

            return "nurse"

        if pt == "therapist":

            return "therapist"

    if booking.get("booking_type") == "package":

        pkg = None

        if booking.get("package_id"):

            pkg = await db.packages.find_one(

                {"clinic_id": clinic_id, "id": booking["package_id"]},

                {"_id": 0, "performer_type": 1},

            )

        if pkg:

            pt = (pkg.get("performer_type") or "therapist").lower()

            if pt == "doctor":

                return "doctor"

            if pt == "nurse":

                return "nurse"

            return "therapist"

    return "therapist"





async def _booking_line_price(db, booking: dict, clinic_id: str) -> float:

    total = booking.get("total_idr")

    if total is not None and int(total or 0) > 0:

        return float(total)

    subtotal = booking.get("subtotal_idr")

    if subtotal is not None and int(subtotal or 0) > 0:

        return float(subtotal)

    treatment_name = booking.get("treatment") or ""

    if booking.get("booking_type") == "package" and booking.get("package_id"):

        pkg = await db.packages.find_one(

            {"clinic_id": clinic_id, "id": booking["package_id"]},

            {"_id": 0, "price_idr": 1, "name": 1, "category": 1},

        )

        if pkg:

            return float(pkg.get("price_idr") or 0)

    t = await db.treatments.find_one(

        {"clinic_id": clinic_id, "name": treatment_name},

        {"_id": 0, "price_idr": 1, "category": 1},

    )

    if t:

        return float(t.get("price_idr") or 0)

    return 0.0





async def _seed_treatment_item_from_booking(db, visit_id: str, clinic_id: str, booking: dict) -> None:

    existing = await db.treatment_items.count_documents({"visit_id": visit_id})

    if existing:

        return

    price = await _booking_line_price(db, booking, clinic_id)

    category = "booking"

    treatment_name = booking.get("treatment") or "Appointment"

    if booking.get("booking_type") == "package":

        category = "package"

    else:

        t = await db.treatments.find_one(

            {"clinic_id": clinic_id, "name": treatment_name},

            {"_id": 0, "category": 1},

        )

        if t and t.get("category"):

            category = t["category"]

    item = {

        "id": str(uuid.uuid4()),

        "visit_id": visit_id,

        "clinic_id": clinic_id,

        "category": category,

        "name": treatment_name,

        "quantity": 1,

        "unit_type": "session",

        "price": price,

        "notes": booking.get("coupon_code") and f"Booking coupon: {booking['coupon_code']}" or "",

        "created_at": iso(now_utc()),

    }

    await db.treatment_items.insert_one(item)





async def create_visit_from_booking(

    db,

    booking: dict,

    clinic_id: str,

    user_id: str,

    *,

    check_in: bool = True,

    seed_emr: bool = True,

) -> Dict[str, Any]:

    """Create or return visit linked to booking. Optionally marks booking checked_in."""

    if booking.get("visit_id"):

        visit = await db.visits.find_one(

            {"clinic_id": clinic_id, "id": booking["visit_id"]},

            {"_id": 0},

        )

        if visit:

            return visit



    if booking.get("status") in ("cancelled", "no_show", "completed"):

        raise ValueError(f"Cannot start visit for booking with status {booking.get('status')}")



    patient_id = await ensure_patient_for_booking(db, booking, clinic_id)

    performers = get_performers(booking)

    visit_type = await _resolve_visit_type(db, booking, clinic_id)

    assigned_to = primary_performer_id(booking)



    visit = {

        "id": str(uuid.uuid4()),

        "clinic_id": clinic_id,

        "patient_id": patient_id,

        "booking_id": booking["id"],

        "visit_type": visit_type,

        "assigned_to": assigned_to,

        "performers": performers,

        "chief_complaint": booking.get("treatment") or "",

        "visit_date": iso(now_utc()),

        "status": "in_progress",

        "payment_status": "unpaid",

        "created_at": iso(now_utc()),

        "created_by": user_id,

    }

    sync_legacy_performer_fields(visit)

    await db.visits.insert_one(visit)

    visit.pop("_id", None)



    if seed_emr:

        await _seed_treatment_item_from_booking(db, visit["id"], clinic_id, booking)

    try:
        from consent_forms import ensure_consent_forms_for_visit
        await ensure_consent_forms_for_visit(db, clinic_id, visit, booking, created_by=user_id)
    except Exception:
        pass



    booking_upd: Dict[str, Any] = {

        "visit_id": visit["id"],

        "patient_id": patient_id,

    }

    if check_in and booking.get("status") in ("booked", "confirmed"):

        booking_upd["status"] = "checked_in"

        booking_upd["status_updated_at"] = iso(now_utc())

    await db.bookings.update_one(

        {"clinic_id": clinic_id, "id": booking["id"]},

        {"$set": booking_upd},

    )



    p = await db.patients.find_one({"id": patient_id}, {"_id": 0, "full_name": 1})

    visit["patient_name"] = (p or {}).get("full_name") or booking.get("patient_name")

    from clinic_realtime import safe_emit_visit_event, safe_emit_booking_event
    safe_emit_visit_event(visit, "visit_started", message="Visit started from booking")
    updated_booking = {**booking, **booking_upd}
    safe_emit_booking_event(updated_booking, "booking_updated", message="Booking checked in")

    return visit





async def sync_booking_when_visit_completed(db, visit: dict) -> None:

    """Mark linked booking completed when visit is closed."""

    bid = visit.get("booking_id")

    if not bid:

        return

    await db.bookings.update_one(

        {"clinic_id": visit.get("clinic_id"), "id": bid, "status": {"$nin": ["cancelled", "no_show"]}},

        {"$set": {"status": "completed", "status_updated_at": iso(now_utc())}},

    )





def compute_visit_charges(treatment_items: list) -> Dict[str, int]:

    subtotal = 0

    for it in treatment_items or []:

        subtotal += int(float(it.get("price") or 0) * float(it.get("quantity") or 1))

    return {"subtotal_idr": subtotal, "total_idr": subtotal}





async def visit_emr_submitted(db, visit_id: str) -> bool:
    cr = await db.clinical_records.find_one({"visit_id": visit_id}, {"_id": 0, "submitted": 1})
    tr = await db.therapist_records.find_one({"visit_id": visit_id}, {"_id": 0, "submitted": 1})
    return bool((cr and cr.get("submitted")) or (tr and tr.get("submitted")))


async def mark_visit_submitted(
    db,
    clinic_id: str,
    visit_id: str,
    *,
    created_by: str,
    note_role: str = "",
    staff_name: str = "",
) -> None:
    """Set visit status to submitted and ensure FO invoice has treatment lines."""
    await db.visits.update_one(
        {"id": visit_id, "clinic_id": clinic_id, "status": {"$nin": ["completed", "cancelled"]}},
        {"$set": {"status": "submitted", "submitted_at": iso(now_utc())}},
    )
    visit = await db.visits.find_one({"id": visit_id, "clinic_id": clinic_id}, {"_id": 0})
    if not visit:
        return
    from invoices import ensure_invoice_for_visit
    await ensure_invoice_for_visit(db, clinic_id, visit, created_by=created_by)
    visit = await db.visits.find_one({"id": visit_id, "clinic_id": clinic_id}, {"_id": 0}) or visit
    from clinic_realtime import safe_emit_visit_event
    who = (staff_name or "Staff").strip()
    role = note_role or "staff"
    safe_emit_visit_event(
        visit,
        "visit_submitted",
        message=f"Visit submitted by {who}",
        extra_payload={"note_role": role, "staff_name": who},
    )


def format_loyalty_idr(amount: float) -> str:
    val = int(max(0, round(amount)))
    return "Rp " + f"{val:,}".replace(",", ".")


def loyalty_tier_public_view(tier: Optional[dict]) -> Optional[dict]:
    if not tier:
        return None
    return {
        "name": tier.get("name"),
        "color": tier.get("color") or "#9CA3AF",
        "benefit": (tier.get("benefit") or "").strip(),
        "min_spend_idr": int(tier.get("min_spend_idr") or 0),
    }


def resolve_patient_loyalty(total_spent: float, tiers: Optional[List[dict]]) -> Dict[str, Any]:
    """Highest qualifying tier from clinic loyalty_tiers (or defaults)."""
    from saas import DEFAULT_LOYALTY_TIERS

    tier_list = list(tiers) if tiers else list(DEFAULT_LOYALTY_TIERS)
    if not tier_list:
        return {
            "loyalty_tier": None,
            "next_tier": None,
            "next_tier_label": None,
            "next_tier_progress": None,
        }
    sorted_asc = sorted(tier_list, key=lambda t: float(t.get("min_spend_idr") or 0))
    loyalty_raw = None
    next_raw = None
    for t in sorted_asc:
        if total_spent >= float(t.get("min_spend_idr") or 0):
            loyalty_raw = t
        elif next_raw is None:
            next_raw = t
    next_label = None
    progress = None
    if next_raw:
        needed = max(0.0, float(next_raw.get("min_spend_idr") or 0) - total_spent)
        next_label = f"{format_loyalty_idr(needed)} until {next_raw.get('name', 'next tier')}"
        progress = {
            "current": total_spent,
            "needed": needed,
            "next_tier_name": next_raw.get("name"),
        }
    elif loyalty_raw:
        next_label = "Highest tier reached"
    return {
        "loyalty_tier": loyalty_tier_public_view(loyalty_raw),
        "next_tier": loyalty_tier_public_view(next_raw),
        "next_tier_label": next_label,
        "next_tier_progress": progress,
    }


async def patient_lifetime_spend(db, clinic_id: str, patient_id: str) -> float:
    visit_ids = [
        v["id"]
        async for v in db.visits.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0, "id": 1},
        )
    ]
    if not visit_ids:
        return 0.0
    pipeline = [
        {"$match": {"clinic_id": clinic_id, "visit_id": {"$in": visit_ids}}},
        {
            "$group": {
                "_id": None,
                "total": {
                    "$sum": {
                        "$multiply": [
                            {"$ifNull": ["$price", 0]},
                            {"$ifNull": ["$quantity", 1]},
                        ]
                    }
                },
            }
        },
    ]
    async for row in db.treatment_items.aggregate(pipeline):
        return float(row.get("total") or 0)
    return 0.0


async def batch_patient_lifetime_spend(
    db, clinic_id: str, patient_ids: List[str],
) -> Dict[str, float]:
    if not patient_ids:
        return {}
    pipeline = [
        {"$match": {"clinic_id": clinic_id}},
        {
            "$lookup": {
                "from": "visits",
                "localField": "visit_id",
                "foreignField": "id",
                "as": "visit",
            }
        },
        {"$unwind": "$visit"},
        {"$match": {"visit.patient_id": {"$in": patient_ids}}},
        {
            "$group": {
                "_id": "$visit.patient_id",
                "total": {
                    "$sum": {
                        "$multiply": [
                            {"$ifNull": ["$price", 0]},
                            {"$ifNull": ["$quantity", 1]},
                        ]
                    }
                },
            }
        },
    ]
    out: Dict[str, float] = {pid: 0.0 for pid in patient_ids}
    async for row in db.treatment_items.aggregate(pipeline):
        pid = row.get("_id")
        if pid in out:
            out[pid] = float(row.get("total") or 0)
    return out


async def clinic_loyalty_tiers(db, clinic_id: str) -> List[dict]:
    from saas import DEFAULT_LOYALTY_TIERS

    clinic = await db.clinics.find_one({"id": clinic_id}, {"_id": 0, "loyalty_tiers": 1})
    raw = (clinic or {}).get("loyalty_tiers")
    return list(raw) if raw else list(DEFAULT_LOYALTY_TIERS)


async def enrich_patients_loyalty(db, clinic_id: str, patients: List[dict]) -> None:
    """Attach loyalty_tier summary to patient list items (display only)."""
    if not patients:
        return
    tiers = await clinic_loyalty_tiers(db, clinic_id)
    ids = [p["id"] for p in patients if p.get("id")]
    spends = await batch_patient_lifetime_spend(db, clinic_id, ids)
    for p in patients:
        total = spends.get(p.get("id"), 0.0)
        resolved = resolve_patient_loyalty(total, tiers)
        p["lifetime_spend_idr"] = total
        p["loyalty_tier"] = resolved["loyalty_tier"]


async def patient_loyalty_discount_percent(db, clinic_id: str, patient_id: str) -> int:
    """Return loyalty tier discount percent for patient based on lifetime spend."""
    total = await patient_lifetime_spend(db, clinic_id, patient_id)
    tiers = sorted(
        await clinic_loyalty_tiers(db, clinic_id),
        key=lambda t: float(t.get("min_spend_idr") or 0),
        reverse=True,
    )
    for t in tiers:
        if total >= float(t.get("min_spend_idr") or 0):
            pct = t.get("discount_percent")
            if pct is None:
                benefit = (t.get("benefit") or "").lower()
                m = re.search(r"(\d+)\s*%", benefit)
                pct = int(m.group(1)) if m else 0
            return min(100, max(0, int(pct or 0)))
    return 0

