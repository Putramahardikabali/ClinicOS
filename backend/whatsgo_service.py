"""Whatsgo integration service — connection, contact sync, templates, and messaging."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from whatsgo_adapter import (
    build_whatsgo_inbox_link,
    get_whatsgo_message_logs,
    list_whatsgo_templates,
    send_whatsgo_template_message,
    test_whatsgo_connection,
    upsert_whatsgo_contact,
)

logger = logging.getLogger(__name__)

WHATSGO_NOT_CONNECTED = "Connect Whatsgo Integration first."


def is_whatsgo_connected(settings: dict, creds: dict) -> bool:
    if (settings.get("provider") or "") != "whatsgo":
        return False
    if not settings.get("enable_messaging"):
        return False
    status = (
        settings.get("whatsgo_connection_status")
        or settings.get("connection_status")
        or ""
    )
    return status == "connected" and bool(creds.get("integration_token"))


def patient_to_whatsgo_contact(
    patient: dict,
    *,
    clinic_id: str,
    tags: Optional[List[str]] = None,
    sync_source: bool = True,
    sync_country: bool = True,
) -> dict:
    """Map ClinicOS patient record to Whatsgo contact upsert payload."""
    patient_id = patient.get("id") or ""
    body: Dict[str, Any] = {
        "external_patient_id": patient_id,
        "name": (patient.get("full_name") or patient.get("name") or "").strip(),
        "phone": (patient.get("phone") or "").strip(),
        "email": (patient.get("email") or "").strip(),
        "language": (patient.get("preferred_language") or patient.get("language") or "").strip(),
        "metadata": {
            "clinic_id": clinic_id,
            "patient_id": patient_id,
            "source": "clinicos",
        },
    }
    if sync_country:
        country = (patient.get("nationality") or patient.get("country") or "").strip()
        if patient.get("nationality_code"):
            body["country_code"] = patient.get("nationality_code")
        if country:
            body["country"] = country
            body["nationality"] = country
    if sync_source:
        source = (patient.get("patient_source") or patient.get("source") or "").strip()
        if source:
            body["patient_source"] = source
    if patient.get("date_of_birth"):
        body["birthday"] = patient.get("date_of_birth")
    tag_list = tags if tags is not None else patient.get("tags")
    if tag_list:
        body["tags"] = tag_list
    return body


def _contact_fingerprint(contact: dict) -> str:
    payload = {k: contact.get(k) for k in sorted(contact.keys()) if k != "metadata"}
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def should_skip_duplicate_sync(patient: dict, contact: dict) -> bool:
    if (patient.get("whatsgo_sync_status") or "") != "ok":
        return False
    stored = (patient.get("whatsgo_sync_fingerprint") or "").strip()
    if not stored:
        return False
    return stored == _contact_fingerprint(contact)


async def apply_patient_whatsgo_sync_result(
    db,
    *,
    clinic_id: str,
    patient_id: str,
    result: dict,
    sync_status: str,
    sync_error: Optional[str] = None,
    fingerprint: Optional[str] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    upd: Dict[str, Any] = {
        "whatsgo_contact_id": result.get("contact_id") or "",
        "whatsgo_conversation_id": result.get("conversation_id") or "",
        "whatsgo_open_conversation_url": result.get("open_conversation_url") or "",
        "whatsgo_last_synced_at": now,
        "whatsgo_sync_status": sync_status,
        "whatsgo_sync_error": (sync_error or "")[:500],
        "updated_at": now,
    }
    if fingerprint:
        upd["whatsgo_sync_fingerprint"] = fingerprint
    await db.patients.update_one(
        {"id": patient_id, "clinic_id": clinic_id},
        {"$set": upd},
    )


def test_connection(settings: dict, creds: dict) -> dict:
    return test_whatsgo_connection(settings, creds)


async def upsert_contact(
    db,
    *,
    clinic_id: str,
    patient: dict,
    settings: dict,
    creds: dict,
    force: bool = False,
) -> Tuple[bool, dict, Optional[str]]:
    if not patient.get("phone"):
        return False, {}, "Patient has no phone number"
    sync_tags = bool(settings.get("whatsgo_sync_tags"))
    sync_source = settings.get("whatsgo_sync_patient_source", True) is not False
    sync_country = settings.get("whatsgo_sync_country", True) is not False
    contact = patient_to_whatsgo_contact(
        patient,
        clinic_id=clinic_id,
        sync_tags=sync_tags,
        sync_source=sync_source,
        sync_country=sync_country,
    )
    if not sync_tags:
        contact.pop("tags", None)
    fingerprint = _contact_fingerprint(contact)
    if not force and should_skip_duplicate_sync(patient, contact):
        return True, {
            "contact_id": patient.get("whatsgo_contact_id"),
            "conversation_id": patient.get("whatsgo_conversation_id"),
            "open_conversation_url": patient.get("whatsgo_open_conversation_url"),
            "skipped": True,
        }, None
    ok, parsed, err = upsert_whatsgo_contact(
        clinic_id=clinic_id,
        settings=settings,
        creds=creds,
        contact=contact,
    )
    if not ok:
        await apply_patient_whatsgo_sync_result(
            db,
            clinic_id=clinic_id,
            patient_id=patient.get("id") or "",
            result={},
            sync_status="failed",
            sync_error=err,
            fingerprint=fingerprint,
        )
        return False, {}, err
    await apply_patient_whatsgo_sync_result(
        db,
        clinic_id=clinic_id,
        patient_id=patient.get("id") or "",
        result=parsed,
        sync_status="ok",
        sync_error=None,
        fingerprint=fingerprint,
    )
    return True, parsed, None


def list_templates(settings: dict, creds: dict) -> Tuple[bool, List[dict], Optional[str]]:
    return list_whatsgo_templates(settings, creds)


def get_message_logs(
    settings: dict,
    creds: dict,
    *,
    limit: int = 100,
    patient_id: Optional[str] = None,
) -> Tuple[bool, List[dict], Optional[str]]:
    return get_whatsgo_message_logs(settings, creds, limit=limit, patient_id=patient_id)


def get_open_conversation_url(
    settings: dict,
    creds: dict,
    patient: dict,
) -> str:
    url = (patient.get("whatsgo_open_conversation_url") or "").strip()
    if url:
        return url
    return build_whatsgo_inbox_link(
        settings,
        creds,
        patient_id=patient.get("id"),
        open_conversation_url=url or None,
    )


async def open_chat_for_patient(
    db,
    *,
    clinic_id: str,
    patient: dict,
    settings: dict,
    creds: dict,
    force_sync: bool = False,
) -> Tuple[bool, str, Optional[str]]:
    if not is_whatsgo_connected(settings, creds):
        return False, "", WHATSGO_NOT_CONNECTED
    if force_sync or not (patient.get("whatsgo_open_conversation_url") or patient.get("whatsgo_contact_id")):
        ok, parsed, err = await upsert_contact(
            db,
            clinic_id=clinic_id,
            patient=patient,
            settings=settings,
            creds=creds,
            force=force_sync,
        )
        if not ok:
            return False, "", err or "Could not sync patient to Whatsgo"
        patient = {
            **patient,
            "whatsgo_open_conversation_url": parsed.get("open_conversation_url") or patient.get("whatsgo_open_conversation_url"),
            "whatsgo_contact_id": parsed.get("contact_id") or patient.get("whatsgo_contact_id"),
        }
    url = get_open_conversation_url(settings, creds, patient)
    if not url:
        return False, "", "Whatsgo conversation URL not available"
    return True, url, None


async def sync_patient_to_whatsgo(
    db,
    *,
    jwt_secret: str,
    clinic_id: str,
    patient: dict,
    settings: dict,
    creds: dict,
    sync_tags: bool = False,
    force: bool = False,
) -> Tuple[bool, Optional[str]]:
    if sync_tags:
        settings = {**settings, "whatsgo_sync_tags": True}
    ok, _parsed, err = await upsert_contact(
        db,
        clinic_id=clinic_id,
        patient=patient,
        settings=settings,
        creds=creds,
        force=force,
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
    ok, items, err = list_templates(settings, creds)
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
            "preview": tpl.get("preview") or tpl.get("body") or tpl.get("example") or "",
            "synced_at": now,
        })
    await db.settings.update_one(
        {"id": "global", "clinic_id": clinic_id},
        {"$set": {"clinic_messaging.whatsgo_templates_cache": normalized, "clinic_messaging.whatsgo_templates_synced_at": now}},
    )
    return {"ok": True, "items": normalized, "synced_at": now}


WHATSGO_TEST_VARIABLES = [
    "patient_name",
    "clinic_name",
    "appointment_date",
    "appointment_time",
    "treatment_name",
    "consent_form_link",
    "package_remaining_sessions",
    "package_expiry_date",
]


async def send_test_template(
    db,
    *,
    jwt_secret: str,
    clinic_id: str,
    patient_id: str,
    template_name: str,
    language: str,
    variable_mapping: List[str],
    settings: dict,
    creds: dict,
    booking_id: Optional[str] = None,
) -> Tuple[dict, Optional[str]]:
    from messaging import build_message_context, create_message_log, normalize_phone

    patient = await db.patients.find_one({"id": patient_id, "clinic_id": clinic_id}, {"_id": 0})
    if not patient:
        return {}, "Patient not found"
    if not is_whatsgo_connected(settings, creds):
        return {}, WHATSGO_NOT_CONNECTED

    booking = None
    if booking_id:
        booking = await db.bookings.find_one({"id": booking_id, "clinic_id": clinic_id}, {"_id": 0})

    await upsert_contact(
        db,
        clinic_id=clinic_id,
        patient=patient,
        settings=settings,
        creds=creds,
    )
    patient = await db.patients.find_one({"id": patient_id, "clinic_id": clinic_id}, {"_id": 0}) or patient

    ctx = await build_message_context(db, clinic_id, booking=booking, patient=patient)
    variable_values = [str(ctx.get(key, "") or "") for key in variable_mapping]
    recipient = normalize_phone(patient.get("phone") or "")
    if not recipient:
        return {}, "Patient has no phone number"

    tpl = {
        "id": None,
        "template_type": "whatsgo_test",
        "template_name": template_name,
        "channel": "whatsapp",
    }
    log = await create_message_log(
        db,
        clinic_id=clinic_id,
        template=tpl,
        recipient=recipient,
        rendered=f"Whatsgo template: {template_name}",
        provider="whatsgo",
        channel="whatsapp",
        patient_id=patient_id,
        booking_id=booking_id,
        visit_id=None,
        send_at=datetime.now(timezone.utc),
        status="queued",
        reference_type="manual_test",
        reference_id=patient_id,
        whatsjet_variable_values=variable_values,
        source_event="manual_test",
        template_name=template_name,
        external_reference_type="manual_test",
        external_reference_id=patient_id,
    )

    ok, msg_id, err, raw = send_whatsgo_template_message(
        clinic_id=clinic_id,
        to_phone=recipient,
        template_name=template_name,
        language=language,
        variable_values=variable_values,
        settings=settings,
        creds=creds,
        patient_id=patient_id,
        external_reference_type="manual_test",
        external_reference_id=patient_id,
        variable_mapping=variable_mapping,
    )
    now = datetime.now(timezone.utc).isoformat()
    upd: Dict[str, Any] = {"updated_at": now}
    if ok:
        upd["status"] = "sent"
        upd["sent_at"] = now
        upd["provider_message_id"] = msg_id
        upd["whatsgo_message_id"] = msg_id
        upd["open_conversation_url"] = raw.get("open_conversation_url") or ""
        upd["error_message"] = None
        upd["error_reason"] = None
    else:
        upd["status"] = "failed"
        upd["error_message"] = err or "Send failed"
        upd["error_reason"] = err or "Send failed"
    await db.message_logs.update_one({"id": log["id"]}, {"$set": upd})
    updated = await db.message_logs.find_one({"id": log["id"]}, {"_id": 0})
    if not ok:
        return updated or log, err
    return updated or log, None


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
        from messaging import get_provider_credentials, load_messaging_settings

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
