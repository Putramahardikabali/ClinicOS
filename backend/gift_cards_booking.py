"""Treatment/package gift card redemption via booking (not POS)."""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException

from gift_card_models import (
    REDEEM_REFERENCE_TYPES,
    GiftCardRedemption,
    effective_gift_card_status,
    gift_card_to_api,
    is_entitlement_gift_card,
    is_gift_card_expired,
    normalize_gift_card_document,
    redemption_to_api,
    status_after_entitlement_redemption,
)
from gift_cards_core import find_gift_card, find_gift_card_by_code, _now_iso


BOOKING_ENTITLEMENT_TYPES = frozenset({"treatment", "package"})


def build_gift_card_reservation_fields(
    *,
    booking_id: str,
    patient_id: Optional[str],
    now: str,
) -> Dict[str, Any]:
    """Mongo $set fields when reserving an entitlement gift card for a booking."""
    return {
        "status": "reserved",
        "reserved_booking_id": booking_id,
        "reserved_patient_id": (patient_id or "").strip() or None,
        "reserved_at": now,
        "updated_at": now,
    }


def build_gift_card_reservation_release_fields(*, now: str) -> Dict[str, Any]:
    """Mongo $set fields when releasing a reservation back to active."""
    return {
        "status": "active",
        "reserved_booking_id": None,
        "reserved_patient_id": None,
        "reserved_at": None,
        "reserved_patient_package_id": None,
        "updated_at": now,
    }


async def _log_gift_card_reservation_event(
    db,
    *,
    card: dict,
    action: str,
    reason: str,
    before: dict,
    after: dict,
    user_id: Optional[str],
) -> None:
    await db.gift_card_repair_log.insert_one({
        "id": str(uuid.uuid4()),
        "gift_card_id": card["id"],
        "clinic_id": card.get("clinic_id"),
        "code": card.get("code"),
        "repair_type": action,
        "before": before,
        "after": after,
        "reason": reason,
        "created_at": _now_iso(),
        "user_id": user_id,
    })


def _assert_booking_redeem_permission(user: dict) -> None:
    from permissions import user_has_permission
    if not user_has_permission(user, "gift_cards.redeem"):
        raise HTTPException(status_code=403, detail="gift_cards.redeem permission is required")


async def _treatment_doc_for_catalog(db, clinic_id: str, catalog_id: str) -> Optional[dict]:
    if not catalog_id:
        return None
    return await db.treatments.find_one(
        {"clinic_id": clinic_id, "id": catalog_id, "active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "price_idr": 1, "duration_min": 1},
    )


async def _package_doc_for_catalog(db, clinic_id: str, catalog_id: str) -> Optional[dict]:
    if not catalog_id:
        return None
    return await db.packages.find_one(
        {"clinic_id": clinic_id, "id": catalog_id, "active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "price_idr": 1, "duration_min": 1},
    )


def pos_entitlement_redemption_blocked_message(card: dict) -> str:
    return (
        "Treatment and package gift cards must be redeemed when creating a booking "
        "so availability can be checked."
    )


async def validate_gift_card_for_booking(
    db,
    clinic_id: str,
    code: str,
    *,
    booking_kind: Optional[str] = None,
    patient_id: Optional[str] = None,
    for_attach: bool = False,
) -> Dict[str, Any]:
    """Lookup + validate entitlement gift card for staff booking flow.

    Lookup (for_attach=False) does not compare booking_kind to card type — the UI
    switches service type from the card. Attach (for_attach=True) enforces patient,
    booking type, and catalog match when creating the booking.
    """
    card = await find_gift_card_by_code(db, clinic_id, code)
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    norm = normalize_gift_card_document(card)
    gc_type = (norm.get("gift_card_type") or "").strip().lower()
    eff = effective_gift_card_status(norm)

    if gc_type == "value_credit":
        return {
            "valid": False,
            "informational": True,
            "gift_card_type": "value_credit",
            "error": (
                "This is a value/credit gift card. Please select a treatment or package first. "
                "The credit can be applied later at invoice/payment."
            ),
            "card": gift_card_to_api(norm),
            "face_value_idr": int(norm.get("original_value") or 0),
            "balance_value": int(norm.get("balance_value") or 0),
        }
    if gc_type not in BOOKING_ENTITLEMENT_TYPES:
        return {"valid": False, "error": "Unsupported gift card type", "card": gift_card_to_api(norm)}

    if eff == "cancelled":
        return {"valid": False, "error": "Gift card is cancelled", "card": gift_card_to_api(norm)}
    if eff == "expired":
        return {"valid": False, "error": "Gift card has expired", "card": gift_card_to_api(norm)}
    if eff == "redeemed":
        return {"valid": False, "error": "Gift card has already been redeemed", "card": gift_card_to_api(norm)}
    if eff == "reserved":
        return {
            "valid": False,
            "error": "Gift card is already reserved for another booking",
            "card": gift_card_to_api(norm),
            "reserved_booking_id": norm.get("reserved_booking_id"),
        }
    if eff != "active":
        return {"valid": False, "error": "Gift card cannot be used for booking", "card": gift_card_to_api(norm)}

    if int(norm.get("remaining_redemptions") or 0) <= 0:
        return {"valid": False, "error": "Gift card has no remaining redemptions", "card": gift_card_to_api(norm)}

    treatment_doc = None
    package_doc = None
    if gc_type == "treatment":
        treatment_doc = await _treatment_doc_for_catalog(db, clinic_id, norm.get("treatment_catalog_id"))
        if not treatment_doc:
            return {
                "valid": False,
                "error": "Treatment on this gift card is no longer available in the catalog",
                "card": gift_card_to_api(norm),
            }
        if for_attach and booking_kind and booking_kind != "treatment":
            return {
                "valid": False,
                "error": "Treatment gift card requires a treatment booking",
                "card": gift_card_to_api(norm),
            }
    else:
        package_doc = await _package_doc_for_catalog(db, clinic_id, norm.get("package_catalog_id"))
        if not package_doc:
            return {
                "valid": False,
                "error": "Package on this gift card is no longer available in the catalog",
                "card": gift_card_to_api(norm),
            }
        if for_attach:
            if booking_kind and booking_kind != "package":
                return {
                    "valid": False,
                    "error": "Package gift card requires a package booking",
                    "card": gift_card_to_api(norm),
                }
            if not (patient_id or "").strip():
                return {
                    "valid": False,
                    "error": "Select or create a patient before redeeming this package gift card.",
                    "card": gift_card_to_api(norm),
                }

    api_card = gift_card_to_api(norm)
    requires_patient = gc_type == "package" and not (patient_id or "").strip()
    return {
        "valid": True,
        "card": api_card,
        "gift_card_type": gc_type,
        "treatment_catalog_id": norm.get("treatment_catalog_id"),
        "treatment_name": (treatment_doc or {}).get("name") or norm.get("treatment_name_snapshot"),
        "package_catalog_id": norm.get("package_catalog_id"),
        "package_name": (package_doc or {}).get("name") or norm.get("package_name_snapshot"),
        "suggested_booking_kind": gc_type,
        "face_value_idr": int(norm.get("original_value") or 0),
        "requires_patient": requires_patient,
    }


async def attach_gift_card_to_new_booking(
    db,
    user: dict,
    *,
    booking: dict,
    gift_card_id: str,
    patient_id: Optional[str],
) -> dict:
    """Reserve treatment or package gift card when a booking is created (not redeemed yet)."""
    _assert_booking_redeem_permission(user)
    clinic_id = user["clinic_id"]
    card = await find_gift_card(db, clinic_id, gift_card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    if not is_entitlement_gift_card(card):
        raise HTTPException(
            status_code=400,
            detail="Only treatment or package gift cards can be applied in booking",
        )
    validation = await validate_gift_card_for_booking(
        db,
        clinic_id,
        card["code"],
        booking_kind=booking.get("booking_type"),
        patient_id=patient_id or booking.get("patient_id"),
        for_attach=True,
    )
    if not validation.get("valid"):
        raise HTTPException(status_code=400, detail=validation.get("error") or "Gift card cannot be used")

    gc_type = card.get("gift_card_type")
    now = _now_iso()
    booking_id = booking["id"]
    pid = (patient_id or booking.get("patient_id") or "").strip()
    face = int(booking.get("total_idr") or card.get("original_value") or 0)

    await db.gift_cards.update_one(
        {"id": gift_card_id},
        {"$set": build_gift_card_reservation_fields(
            booking_id=booking_id,
            patient_id=pid,
            now=now,
        )},
    )

    booking["gift_card_id"] = gift_card_id
    booking["gift_card_code"] = card.get("code")
    booking["gift_card_type"] = gc_type
    booking["gift_card_covered_idr"] = face
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {
            "gift_card_id": gift_card_id,
            "gift_card_code": card.get("code"),
            "gift_card_type": gc_type,
            "gift_card_covered_idr": face,
        }},
    )
    return booking


async def release_gift_card_reservation(
    db,
    user: dict,
    *,
    gift_card_id: Optional[str] = None,
    booking_id: Optional[str] = None,
    reason: str = "booking_cancelled",
) -> bool:
    """Release a reserved entitlement gift card back to active (booking cancelled or manual release)."""
    flt: Dict[str, Any] = {"status": "reserved"}
    if gift_card_id:
        flt["id"] = gift_card_id
    elif booking_id:
        flt["reserved_booking_id"] = booking_id
    else:
        return False

    card = await db.gift_cards.find_one(flt, {"_id": 0})
    if not card:
        return False
    if not is_entitlement_gift_card(card):
        return False

    clinic_id = card.get("clinic_id") or user.get("clinic_id")
    from patient_packages import cancel_unused_patient_packages_for_gift_card

    await cancel_unused_patient_packages_for_gift_card(
        db,
        clinic_id,
        card["id"],
        reason=reason,
    )

    now = _now_iso()
    before = {
        "status": card.get("status"),
        "reserved_booking_id": card.get("reserved_booking_id"),
        "reserved_patient_id": card.get("reserved_patient_id"),
        "reserved_at": card.get("reserved_at"),
    }
    release_fields = build_gift_card_reservation_release_fields(now=now)
    await db.gift_cards.update_one({"id": card["id"]}, {"$set": release_fields})
    await _log_gift_card_reservation_event(
        db,
        card=card,
        action="gift_card_reservation_released",
        reason=reason,
        before=before,
        after={
            "status": "active",
            "reserved_booking_id": None,
            "reserved_patient_id": None,
            "reserved_at": None,
        },
        user_id=user.get("id"),
    )
    return True


async def release_gift_card_for_cancelled_booking(
    db,
    user: dict,
    booking_id: str,
    *,
    reason: str = "booking_cancelled",
) -> bool:
    """Release reserved gift card when booking is cancelled (treatment or package)."""
    return await release_gift_card_reservation(
        db,
        user,
        booking_id=booking_id,
        reason=reason,
    )


async def _booking_with_reserved_gift_card_for_invoice(
    db,
    user: dict,
    invoice: dict,
    *,
    expected_type: str,
) -> Optional[Tuple[dict, dict]]:
    visit_id = invoice.get("visit_id")
    if not visit_id:
        return None
    visit = await db.visits.find_one(
        {"id": visit_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "booking_id": 1},
    )
    if not visit or not visit.get("booking_id"):
        return None
    booking = await db.bookings.find_one(
        {"id": visit["booking_id"], "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not booking or not booking.get("gift_card_id"):
        return None
    if (booking.get("gift_card_type") or "") != expected_type:
        return None
    card = await find_gift_card(db, user["clinic_id"], booking["gift_card_id"])
    if not card:
        return None
    if (card.get("status") or "") != "reserved":
        return None
    if card.get("reserved_booking_id") != booking["id"]:
        return None
    return booking, card


async def finalize_treatment_gift_card_for_invoice(
    db,
    user: dict,
    invoice: dict,
) -> Optional[Tuple[int, dict]]:
    """
    When an invoice for a visit with a reserved treatment gift card is paid,
    create redemption and return (amount_idr, redemption_api).
    """
    pair = await _booking_with_reserved_gift_card_for_invoice(
        db, user, invoice, expected_type="treatment",
    )
    if not pair:
        return None
    booking, card = pair

    amount = int(
        booking.get("gift_card_covered_idr")
        or booking.get("total_idr")
        or card.get("original_value")
        or 0
    )
    if amount <= 0:
        amount = int(card.get("original_value") or 0)

    now = _now_iso()
    redemption_id = str(uuid.uuid4())
    redemption = GiftCardRedemption(
        id=redemption_id,
        clinic_id=user["clinic_id"],
        gift_card_id=card["id"],
        gift_card_code=card["code"],
        redeemed_by_user_id=user.get("id"),
        redeemed_by_name_snapshot=user.get("name") or "",
        patient_id=invoice.get("patient_id") or booking.get("patient_id"),
        reference_type="invoice",
        reference_id=invoice["id"],
        amount_redeemed=amount,
        balance_before=1,
        balance_after=0,
        notes=f"Treatment gift card via booking {booking['id']}",
        created_at=now,
    )
    await db.gift_card_redemptions.insert_one(redemption.to_mongo())
    await db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {
            "status": "redeemed",
            "remaining_redemptions": 0,
            "redemption_count": int(card.get("redemption_count") or 0) + 1,
            "redeemed_at": now,
            "reserved_booking_id": None,
            "reserved_patient_id": None,
            "reserved_at": None,
            "redeemed_booking_id": booking["id"],
            "redeemed_invoice_id": invoice["id"],
            "updated_at": now,
        }},
    )
    await db.bookings.update_one(
        {"id": booking["id"]},
        {"$set": {"gift_card_redeemed_at": now}},
    )
    return amount, redemption_to_api({**redemption.to_mongo(), "gift_card_type": "treatment"})


async def finalize_package_gift_card_for_invoice(
    db,
    user: dict,
    invoice: dict,
) -> Optional[Tuple[int, dict]]:
    """
    When an invoice for a visit with a reserved package gift card is paid,
    create patient package, redemption record, and mark gift card redeemed.
    """
    pair = await _booking_with_reserved_gift_card_for_invoice(
        db, user, invoice, expected_type="package",
    )
    if not pair:
        return None
    booking, card = pair

    clinic_id = user["clinic_id"]
    pid = (invoice.get("patient_id") or booking.get("patient_id") or card.get("reserved_patient_id") or "").strip()
    if not pid:
        return None

    from patient_packages import create_patient_package_from_gift_card_redemption

    amount = int(
        booking.get("gift_card_covered_idr")
        or booking.get("total_idr")
        or card.get("original_value")
        or 0
    )
    if amount <= 0:
        amount = int(card.get("original_value") or 0)

    now = _now_iso()
    redemption_id = str(uuid.uuid4())
    patient_package_id = await create_patient_package_from_gift_card_redemption(
        db,
        clinic_id=clinic_id,
        patient_id=pid,
        gift_card=card,
        redemption_id=redemption_id,
    )
    if not patient_package_id:
        return None

    redemption = GiftCardRedemption(
        id=redemption_id,
        clinic_id=clinic_id,
        gift_card_id=card["id"],
        gift_card_code=card["code"],
        redeemed_by_user_id=user.get("id"),
        redeemed_by_name_snapshot=user.get("name") or "",
        patient_id=pid,
        reference_type="patient_package",
        reference_id=patient_package_id,
        amount_redeemed=amount,
        balance_before=1,
        balance_after=0,
        notes=f"Package gift card via booking {booking['id']} · invoice {invoice['id']}",
        created_at=now,
    )
    await db.gift_card_redemptions.insert_one(redemption.to_mongo())
    await db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {
            "status": "redeemed",
            "remaining_redemptions": 0,
            "redemption_count": int(card.get("redemption_count") or 0) + 1,
            "redeemed_at": now,
            "reserved_booking_id": None,
            "reserved_patient_id": None,
            "reserved_at": None,
            "redeemed_booking_id": booking["id"],
            "redeemed_invoice_id": invoice["id"],
            "redeemed_patient_package_id": patient_package_id,
            "updated_at": now,
        }},
    )
    await db.bookings.update_one(
        {"id": booking["id"]},
        {"$set": {
            "gift_card_redeemed_at": now,
            "gift_card_patient_package_id": patient_package_id,
        }},
    )
    return amount, redemption_to_api({**redemption.to_mongo(), "gift_card_type": "package"})


async def finalize_booking_entitlement_gift_card_for_invoice(
    db,
    user: dict,
    invoice: dict,
) -> Optional[Tuple[int, dict]]:
    """Finalize reserved treatment or package gift card when visit invoice is paid."""
    fin = await finalize_treatment_gift_card_for_invoice(db, user, invoice)
    if fin:
        return fin
    return await finalize_package_gift_card_for_invoice(db, user, invoice)
