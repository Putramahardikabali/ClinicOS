"""Booked vs performed treatment item helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException


TREATMENT_OUTCOME_MESSAGE = (
    "No performed treatment has been recorded. Please confirm the booked treatment, "
    "add the actual treatment, or mark as no treatment performed."
)


def is_performed_treatment_item(item: dict) -> bool:
    """Return True if item counts as a performed/confirmed treatment line."""
    if not item:
        return False
    if item.get("source") == "booking_reference":
        return False
    if item.get("confirmed_by_staff") is False:
        return False
    # Legacy items without source/confirmed fields remain performed (backward compatibility).
    return True


def filter_performed_treatment_items(items: Optional[List[dict]]) -> List[dict]:
    return [it for it in (items or []) if is_performed_treatment_item(it)]


async def load_performed_treatment_items(db, visit_id: str, clinic_id: str) -> List[dict]:
    items = await db.treatment_items.find(
        {"visit_id": visit_id, "clinic_id": clinic_id},
        {"_id": 0},
    ).to_list(200)
    return filter_performed_treatment_items(items)


async def validate_visit_treatment_outcome(db, visit: dict, clinic_id: str) -> None:
    """Raise when visit submit has neither performed treatments nor a documented waiver."""
    if visit.get("no_treatment_performed"):
        reason = (visit.get("no_treatment_reason") or "").strip()
        if not reason:
            raise HTTPException(
                status_code=400,
                detail="Reason is required when no treatment was performed.",
            )
        return

    performed = await load_performed_treatment_items(db, visit["id"], clinic_id)
    if not performed:
        raise HTTPException(status_code=400, detail=TREATMENT_OUTCOME_MESSAGE)


async def confirm_booked_treatment_item(
    db,
    *,
    clinic_id: str,
    visit: dict,
    booking: dict,
    user_id: str,
) -> dict:
    """Create a performed treatment line from the booking treatment (idempotent)."""
    import uuid

    from visit_workflow import _booking_line_price, iso, now_utc

    visit_id = visit["id"]
    existing = await db.treatment_items.find_one(
        {
            "visit_id": visit_id,
            "clinic_id": clinic_id,
            "source": "confirmed_booked",
        },
        {"_id": 0},
    )
    if existing:
        raise HTTPException(status_code=400, detail="Booked treatment already confirmed as performed")

    treatment_name = (booking.get("treatment") or visit.get("chief_complaint") or "Appointment").strip()
    dup = await db.treatment_items.find_one(
        {
            "visit_id": visit_id,
            "clinic_id": clinic_id,
            "name": treatment_name,
            "source": {"$in": ["confirmed_booked", "manual", "additional"]},
        },
        {"_id": 0},
    )
    if dup and is_performed_treatment_item(dup):
        raise HTTPException(status_code=400, detail="This treatment is already recorded as performed")

    price = await _booking_line_price(db, booking, clinic_id)
    category = "booking"
    if booking.get("booking_type") == "package":
        category = "package"
    else:
        t = await db.treatments.find_one(
            {"clinic_id": clinic_id, "name": treatment_name},
            {"_id": 0, "category": 1},
        )
        if t and t.get("category"):
            category = t["category"]

    item: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "visit_id": visit_id,
        "clinic_id": clinic_id,
        "category": category,
        "name": treatment_name,
        "quantity": 1,
        "unit_type": "session",
        "price": price,
        "notes": booking.get("notes") or "",
        "source": "confirmed_booked",
        "confirmed_by_staff": True,
        "created_by": user_id,
        "created_at": iso(now_utc()),
    }
    await db.treatment_items.insert_one(item)
    item.pop("_id", None)
    return item
