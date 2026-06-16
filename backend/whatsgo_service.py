"""Whatsgo integration service — contact sync and template cache helpers."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from whatsgo_adapter import list_whatsgo_templates, upsert_whatsgo_contact

logger = logging.getLogger(__name__)


def patient_to_whatsgo_contact(patient: dict, *, tags: Optional[List[str]] = None) -> dict:
    """Map ClinicOS patient record to Whatsgo contact payload."""
    body: Dict[str, Any] = {
        "external_reference_id": patient.get("id") or "",
        "full_name": (patient.get("full_name") or patient.get("name") or "").strip(),
        "phone": (patient.get("phone") or "").strip(),
        "email": (patient.get("email") or "").strip(),
        "language": (patient.get("preferred_language") or patient.get("language") or "").strip(),
        "country": (patient.get("country") or patient.get("nationality") or "").strip(),
        "source": (patient.get("source") or patient.get("patient_source") or "").strip(),
    }
    if patient.get("date_of_birth"):
        body["birthday"] = patient.get("date_of_birth")
    if tags:
        body["tags"] = tags
    elif patient.get("tags"):
        body["tags"] = patient.get("tags")
    return body


async def sync_patient_to_whatsgo(
    db,
    *,
    jwt_secret: str,
    clinic_id: str,
    patient: dict,
    settings: dict,
    creds: dict,
    sync_tags: bool = False,
) -> Tuple[bool, Optional[str]]:
    from messaging import get_provider_credentials

    if not patient.get("phone"):
        return False, "Patient has no phone number"
    contact = patient_to_whatsgo_contact(patient)
    if not sync_tags:
        contact.pop("tags", None)
    ok, _contact_id, err = upsert_whatsgo_contact(
        clinic_id=clinic_id,
        settings=settings,
        creds=creds,
        contact=contact,
    )
    return ok, err


async def sync_all_patients_to_whatsgo(
    db,
    *,
    clinic_id: str,
    settings: dict,
    creds: dict,
    limit: int = 500,
) -> Dict[str, Any]:
    sync_tags = bool(settings.get("whatsgo_sync_tags"))
    patients = await db.patients.find(
        {"clinic_id": clinic_id, "phone": {"$exists": True, "$ne": ""}},
        {"_id": 0},
    ).to_list(limit)
    synced = 0
    failed = 0
    errors: List[str] = []
    for patient in patients:
        ok, err = await sync_patient_to_whatsgo(
            db,
            jwt_secret="",
            clinic_id=clinic_id,
            patient=patient,
            settings=settings,
            creds=creds,
            sync_tags=sync_tags,
        )
        if ok:
            synced += 1
        else:
            failed += 1
            if err and len(errors) < 5:
                errors.append(f"{patient.get('id')}: {err}")
    status = "ok" if failed == 0 else ("partial" if synced else "failed")
    return {
        "status": status,
        "synced": synced,
        "failed": failed,
        "total": len(patients),
        "errors": errors,
    }


async def fetch_and_cache_whatsgo_templates(db, clinic_id: str, settings: dict, creds: dict) -> Dict[str, Any]:
    ok, items, err = list_whatsgo_templates(settings, creds)
    if not ok:
        return {"ok": False, "error": err, "items": []}
    now = datetime.now(timezone.utc).isoformat()
    normalized = []
    for tpl in items:
        if not isinstance(tpl, dict):
            continue
        normalized.append({
            "name": tpl.get("name") or tpl.get("template_name") or "",
            "language": tpl.get("language") or tpl.get("language_code") or "",
            "category": tpl.get("category") or "",
            "status": tpl.get("status") or "approved",
            "components": tpl.get("components") or tpl.get("variables") or [],
            "preview": tpl.get("preview") or tpl.get("body") or "",
            "synced_at": now,
        })
    await db.settings.update_one(
        {"id": "global", "clinic_id": clinic_id},
        {"$set": {"clinic_messaging.whatsgo_templates_cache": normalized, "clinic_messaging.whatsgo_templates_synced_at": now}},
    )
    return {"ok": True, "items": normalized, "synced_at": now}


async def maybe_sync_patient_whatsgo(
    db,
    jwt_secret: str,
    clinic_id: str,
    patient: dict,
    *,
    is_update: bool = False,
) -> None:
    """Best-effort contact upsert when Whatsgo auto-sync settings are enabled."""
    try:
        from messaging import load_messaging_settings, get_provider_credentials

        settings = await load_messaging_settings(db, clinic_id)
        if settings.get("provider") != "whatsgo" or not settings.get("enable_messaging"):
            return
        if is_update and not settings.get("whatsgo_auto_update_contacts", True):
            return
        if not is_update and not settings.get("whatsgo_auto_sync_patients", True):
            return
        enc = settings.get("provider_credentials_encrypted")
        if not enc:
            return
        creds = get_provider_credentials(jwt_secret, clinic_id, settings)
        await sync_patient_to_whatsgo(
            db,
            jwt_secret=jwt_secret,
            clinic_id=clinic_id,
            patient=patient,
            settings=settings,
            creds=creds,
            sync_tags=bool(settings.get("whatsgo_sync_tags")),
        )
    except Exception:
        logger.exception("Whatsgo patient sync failed clinic=%s patient=%s", clinic_id, patient.get("id"))
