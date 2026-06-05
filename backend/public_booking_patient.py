"""Match or create patients from public online booking (optional marketing fields)."""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException

from patient_profile import validate_patient_marketing_fields
from saas import iso, now_utc

_PATIENT_LOOKUP_FIELDS = {
    "_id": 0,
    "id": 1,
    "full_name": 1,
    "phone": 1,
    "email": 1,
    "nationality": 1,
    "nationality_code": 1,
    "patient_source": 1,
    "source_detail": 1,
}


def normalize_public_phone(phone: Optional[str]) -> str:
    return "".join(ch for ch in (phone or "") if ch.isdigit() or ch == "+").strip()


def normalize_public_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def normalize_public_marketing_fields(
    nationality: Optional[str] = None,
    nationality_code: Optional[str] = None,
    patient_source: Optional[str] = None,
    source_detail: Optional[str] = None,
) -> Dict[str, str]:
    """Validate and normalize optional marketing fields; empty if none submitted."""
    raw: Dict[str, Any] = {}
    if nationality not in (None, ""):
        raw["nationality"] = nationality
    if nationality_code not in (None, ""):
        raw["nationality_code"] = nationality_code
    if patient_source not in (None, ""):
        raw["patient_source"] = patient_source
    if source_detail not in (None, ""):
        raw["source_detail"] = source_detail
    if not raw:
        return {}
    try:
        doc = validate_patient_marketing_fields(dict(raw))
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=400, detail="Invalid patient marketing fields") from ex
    return {k: v for k, v in doc.items() if v not in (None, "")}


def marketing_backfill_for_existing(existing: dict, marketing: Dict[str, str]) -> Dict[str, Any]:
    """Only fill marketing fields that are empty on the existing patient."""
    if not marketing:
        return {}
    backfill: Dict[str, Any] = {}
    if marketing.get("nationality") and not (existing.get("nationality") or "").strip():
        backfill["nationality"] = marketing["nationality"]
    if marketing.get("nationality_code") and not (existing.get("nationality_code") or "").strip():
        backfill["nationality_code"] = marketing["nationality_code"]
    if marketing.get("patient_source") and not (existing.get("patient_source") or "").strip():
        backfill["patient_source"] = marketing["patient_source"]
    if marketing.get("source_detail") and not (existing.get("source_detail") or "").strip():
        backfill["source_detail"] = marketing["source_detail"]
    return backfill


async def resolve_public_booking_patient(
    db,
    clinic_id: str,
    *,
    patient_name: str,
    patient_phone: str,
    patient_email: str = "",
    nationality: Optional[str] = None,
    nationality_code: Optional[str] = None,
    patient_source: Optional[str] = None,
    source_detail: Optional[str] = None,
) -> Tuple[str, bool]:
    """
    Match by phone then email; create if missing.
    Backfill empty contact + marketing fields only — never overwrite populated values.
    """
    normalized_phone = normalize_public_phone(patient_phone)
    normalized_email = normalize_public_email(patient_email)
    marketing = normalize_public_marketing_fields(
        nationality=nationality,
        nationality_code=nationality_code,
        patient_source=patient_source,
        source_detail=source_detail,
    )

    existing_patient = None
    if normalized_phone:
        existing_patient = await db.patients.find_one(
            {"clinic_id": clinic_id, "phone": normalized_phone},
            _PATIENT_LOOKUP_FIELDS,
        )
    if not existing_patient and normalized_email:
        existing_patient = await db.patients.find_one(
            {"clinic_id": clinic_id, "email": normalized_email},
            _PATIENT_LOOKUP_FIELDS,
        )

    if existing_patient:
        patient_id = existing_patient["id"]
        backfill: Dict[str, Any] = {}
        if normalized_email and not (existing_patient.get("email") or "").strip():
            backfill["email"] = normalized_email
        if normalized_phone and not (existing_patient.get("phone") or "").strip():
            backfill["phone"] = normalized_phone
        backfill.update(marketing_backfill_for_existing(existing_patient, marketing))
        if backfill:
            await db.patients.update_one(
                {"id": patient_id, "clinic_id": clinic_id},
                {"$set": backfill},
            )
        return patient_id, True

    new_patient: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "full_name": patient_name.strip(),
        "phone": normalized_phone or None,
        "email": normalized_email or None,
        "source": "public_booking",
        "created_at": iso(now_utc()),
        **marketing,
    }
    await db.patients.insert_one(new_patient)
    return new_patient["id"], False
