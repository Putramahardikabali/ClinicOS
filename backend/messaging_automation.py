"""Configurable per-clinic messaging automation rules."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from permissions import user_has_permission
from saas import iso, now_utc

logger = logging.getLogger(__name__)

AUTOMATION_TRIGGER_TYPES = frozenset({
    "booking_created",
    "booking_confirmed",
    "booking_cancelled",
    "booking_rescheduled",
    "before_appointment",
    "appointment_created",
    "appointment_rescheduled",
    "appointment_cancelled",
    "appointment_reminder",
    "consent_required_missing",
    "consent_form_request",
    "invoice_paid",
    "gift_card_issued",
    "package_balance_low",
    "package_session_remaining",
    "package_expiry_reminder",
    "visit_completed",
    "visit_completed_aftercare",
})

# Spec event_type → internal trigger_type (legacy names kept for backward compatibility)
EVENT_TYPE_TO_TRIGGER = {
    "appointment_created": "booking_created",
    "appointment_rescheduled": "booking_rescheduled",
    "appointment_cancelled": "booking_cancelled",
    "appointment_reminder": "before_appointment",
    "consent_form_request": "consent_required_missing",
    "visit_completed_aftercare": "visit_completed",
    "package_session_remaining": "package_balance_low",
}

TRIGGER_TO_EVENT_TYPE = {v: k for k, v in EVENT_TYPE_TO_TRIGGER.items()}
for _legacy in (
    "booking_created", "booking_rescheduled", "booking_cancelled", "before_appointment",
    "consent_required_missing", "visit_completed", "package_balance_low", "package_expiry_reminder",
):
    TRIGGER_TO_EVENT_TYPE.setdefault(_legacy, _legacy)

APPOINTMENT_TRIGGER_TYPES = frozenset({
    "booking_created", "booking_confirmed", "booking_cancelled", "booking_rescheduled",
    "before_appointment", "appointment_created", "appointment_rescheduled",
    "appointment_cancelled", "appointment_reminder", "consent_required_missing", "consent_form_request",
})

REMINDER_TRIGGER_TYPES = frozenset({"before_appointment", "appointment_reminder"})

TIMING_TYPES = frozenset({"immediately", "before_event", "after_event"})
TIMING_UNITS = frozenset({"minutes", "hours", "days"})
RUN_STATUSES = frozenset({"pending", "queued", "sent", "skipped", "failed", "cancelled", "retrying"})

DUE_WINDOW = timedelta(minutes=2)

BOOKING_EVENT_TRIGGERS: Dict[str, List[str]] = {
    "confirmed": ["booking_confirmed"],
    "cancelled": ["booking_cancelled"],
    "rescheduled": ["booking_rescheduled"],
    "payment_pending": [],
    "consent_link": ["consent_required_missing"],
}

MESSAGING_EVENT_TRIGGERS: Dict[str, List[str]] = {
    "payment_received": ["invoice_paid"],
    "gift_card_issued": ["gift_card_issued"],
    "package_balance_reminder": ["package_balance_low"],
}

EXCLUDED_BOOKING_STATUSES = frozenset({
    "cancelled", "no_show", "blocked", "completed", "payment_expired", "payment_failed",
})

DEFAULT_RULE_SPECS: List[Dict[str, Any]] = []

AUTOMATION_DYNAMIC_TAGS = [
    "patient_name",
    "clinic_name",
    "clinic_phone",
    "patient_phone",
    "appointment_date",
    "appointment_time",
    "treatment_name",
    "staff_name",
    "performer_name",
    "consent_link",
    "consent_form_link",
    "payment_amount",
    "payment_link",
    "gift_card_code",
    "package_balance",
    "package_name",
    "remaining_sessions",
    "package_remaining_sessions",
    "package_expiry_date",
    "invoice_number",
    "wallet_balance",
    "public_booking_link",
]

EVENT_TYPE_LABELS = {
    "appointment_created": "Appointment created confirmation",
    "appointment_rescheduled": "Appointment rescheduled",
    "appointment_cancelled": "Appointment cancelled",
    "appointment_reminder": "Appointment reminder",
    "consent_form_request": "Consent form request",
    "visit_completed_aftercare": "Visit completed / aftercare",
    "package_session_remaining": "Package session remaining",
    "package_expiry_reminder": "Package expiry reminder",
    "booking_created": "Appointment created (legacy)",
    "booking_rescheduled": "Appointment rescheduled (legacy)",
    "booking_cancelled": "Appointment cancelled (legacy)",
    "before_appointment": "Appointment reminder (legacy)",
}


def normalize_trigger_type(trigger_type: str) -> str:
    t = (trigger_type or "").strip()
    return EVENT_TYPE_TO_TRIGGER.get(t, t)


def canonical_event_type(trigger_type: str) -> str:
    t = normalize_trigger_type(trigger_type)
    return TRIGGER_TO_EVENT_TYPE.get(t, trigger_type or t)


def is_reminder_trigger(trigger_type: str) -> bool:
    return normalize_trigger_type(trigger_type) in REMINDER_TRIGGER_TYPES


def _automation_audit_user(clinic_id: str) -> dict:
    return {
        "clinic_id": clinic_id,
        "id": "automation",
        "role": "system",
        "email": None,
        "name": "Messaging automation",
    }


async def _log_automation_job_audit(db, clinic_id: str, run_id: str, status: str, meta: Optional[dict] = None) -> None:
    from audit_log import write_audit

    action = {
        "sent": "automation_job_sent",
        "failed": "automation_job_failed",
        "cancelled": "automation_job_cancelled",
    }.get(status)
    if not action:
        return
    await write_audit(
        db,
        _automation_audit_user(clinic_id),
        action=action,
        module="automation_job",
        record_id=run_id,
        meta=meta or {"status": status},
    )


def build_rule_variable_values(rule: dict, context: Dict[str, str]) -> List[str]:
    """Map ordered variable_mapping tags to rendered string values."""
    mapping = rule.get("variable_mapping") or rule.get("whatsjet_variable_mapping") or []
    if not isinstance(mapping, list):
        return []
    return [str(context.get(str(key), "") or "") for key in mapping]


def resolve_rule_whatsjet_template_name(rule: dict, *, legacy_template: Optional[dict] = None) -> str:
    name = (
        (rule.get("whatsjet_template_name") or "")
        or (rule.get("whatsgo_template_name") or "")
        or (rule.get("provider_template_name") or "")
    ).strip()
    if not name and legacy_template:
        name = (legacy_template.get("provider_template_name") or "").strip()
    return name


async def resolve_rule_send_config(
    db,
    clinic_id: str,
    rule: dict,
) -> Dict[str, Any]:
    """Resolve WhatsJet template send config from rule fields, with legacy template fallback."""
    legacy = None
    if rule.get("template_id"):
        legacy = await db.messaging_templates.find_one(
            {"id": rule["template_id"], "clinic_id": clinic_id},
            {"_id": 0},
        )
    whatsjet_template_name = resolve_rule_whatsjet_template_name(rule, legacy_template=legacy)
    language_code = (
        (rule.get("language_code") or rule.get("language") or "id").strip() or "id"
    )
    variable_mapping = list(rule.get("variable_mapping") or rule.get("whatsjet_variable_mapping") or [])
    if not variable_mapping and legacy:
        variable_mapping = list(legacy.get("whatsjet_variable_mapping") or [])
    preview_text = (rule.get("preview_text") or "").strip()
    if not preview_text and legacy:
        preview_text = (legacy.get("message_body") or "").strip()
    return {
        "whatsjet_template_name": whatsjet_template_name,
        "language_code": language_code,
        "variable_mapping": variable_mapping,
        "preview_text": preview_text,
        "legacy_template": legacy,
    }


async def ensure_default_automation_rules(db, clinic_id: str, *, created_by: Optional[str] = None) -> None:
    """No auto-seeded rules — clinics configure WhatsJet template names directly."""
    return


def _timing_delta(value: int, unit: str) -> timedelta:
    v = max(0, int(value or 0))
    if unit == "minutes":
        return timedelta(minutes=v)
    if unit == "hours":
        return timedelta(hours=v)
    return timedelta(days=v)


def _clinic_tz(clinic: Optional[dict]):
    tz_name = ((clinic or {}).get("timezone") or "Asia/Makassar").strip() or "Asia/Makassar"
    for candidate in (tz_name, "Asia/Makassar", "UTC"):
        try:
            return ZoneInfo(candidate), candidate
        except Exception:
            continue
    return timezone.utc, "UTC"


def _parse_dt(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def compute_rule_send_at(
    rule: dict,
    *,
    event_at: datetime,
    trigger_type: str,
) -> datetime:
    timing_type = rule.get("timing_type") or "immediately"
    if timing_type == "immediately":
        return now_utc()
    value = int(rule.get("offset_value") if rule.get("offset_value") is not None else rule.get("timing_value") or 0)
    unit = rule.get("offset_unit") or rule.get("timing_unit") or "hours"
    delta = _timing_delta(value, unit)
    normalized = normalize_trigger_type(trigger_type)
    if timing_type == "before_event" or normalized in REMINDER_TRIGGER_TYPES:
        return event_at - delta
    if timing_type == "after_event":
        return event_at + delta
    return now_utc()


def scheduled_for_key(dt: datetime) -> str:
    return iso(dt.astimezone(timezone.utc))


async def cancel_pending_booking_automation_runs(db, clinic_id: str, booking_id: str) -> int:
    if not booking_id:
        return 0
    now = iso(now_utc())
    r = await db.automation_runs.update_many(
        {
            "clinic_id": clinic_id,
            "reference_type": "booking",
            "reference_id": booking_id,
            "status": {"$in": ["pending", "retrying", "queued"]},
        },
        {"$set": {
            "status": "cancelled",
            "processed_at": now,
            "cancelled_at": now,
            "updated_at": now,
            "skip_reason": "booking_changed",
            "error_reason": "Cancelled due to appointment change",
        }},
    )
    if r.modified_count:
        from audit_log import write_audit

        await write_audit(
            db,
            _automation_audit_user(clinic_id),
            action="automation_job_cancelled",
            module="automation_job",
            record_id=booking_id,
            meta={
                "reason": "appointment_change",
                "booking_id": booking_id,
                "cancelled_count": r.modified_count,
            },
        )
    return r.modified_count


async def clinic_has_automation_rules(db, clinic_id: str) -> bool:
    n = await db.messaging_automation_rules.count_documents({"clinic_id": clinic_id})
    return n > 0


async def legacy_should_skip(db, clinic_id: str, trigger_types: List[str]) -> bool:
    if not trigger_types or not await clinic_has_automation_rules(db, clinic_id):
        return False
    n = await db.messaging_automation_rules.count_documents({
        "clinic_id": clinic_id,
        "enabled": True,
        "trigger_type": {"$in": trigger_types},
    })
    return n > 0


def _automation_send_precheck(settings: dict, creds: dict, *, recipient: str) -> Optional[str]:
    if not settings.get("enable_messaging"):
        return "messaging_disabled"
    from messaging import is_automation_active

    if not is_automation_active(settings, creds):
        return "provider_not_connected"
    if not recipient:
        return "missing_phone"
    return None


def _booking_needs_consent(db_sync_hint: dict, booking: dict, clinic_id: str) -> bool:
    """Best-effort consent check using booking flags."""
    if booking.get("consent_required"):
        return not booking.get("consent_signed") and not booking.get("consent_completed")
    return False


async def evaluate_rule_conditions(
    db,
    rule: dict,
    *,
    clinic_id: str,
    booking: Optional[dict] = None,
    patient: Optional[dict] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
    visit: Optional[dict] = None,
) -> Optional[str]:
    cond = rule.get("conditions") or {}
    trigger = normalize_trigger_type(rule.get("trigger_type") or rule.get("event_type") or "")

    if cond.get("require_phone") and not (
        (patient or {}).get("phone") or (booking or {}).get("patient_phone")
        or (gift_card or {}).get("recipient_phone") or (gift_card or {}).get("purchaser_phone")
    ):
        return "missing_phone"

    if trigger in APPOINTMENT_TRIGGER_TYPES:
        if booking:
            status = (booking.get("status") or "").strip().lower()
            excluded = set(cond.get("exclude_statuses") or list(EXCLUDED_BOOKING_STATUSES))
            if status in excluded:
                return "booking_inactive"
            svc = (cond.get("service_type") or "any").strip().lower()
            if svc == "treatment" and booking.get("booking_type") == "package":
                return "condition_service_type"
            if svc == "package" and booking.get("booking_type") != "package":
                return "condition_service_type"
            if cond.get("treatment_category"):
                if (booking.get("treatment_category") or "").strip().lower() != cond["treatment_category"].strip().lower():
                    return "condition_treatment_category"
            if cond.get("treatment"):
                if (booking.get("treatment") or "").strip().lower() != cond["treatment"].strip().lower():
                    return "condition_treatment"
            if cond.get("booking_status") and status != cond["booking_status"].strip().lower():
                return "condition_booking_status"
            if cond.get("payment_status") and (booking.get("payment_status") or "").strip().lower() != cond["payment_status"].strip().lower():
                return "condition_payment_status"
            if cond.get("consent_required_only") or trigger in ("consent_required_missing", "consent_form_request"):
                if not _booking_needs_consent({}, booking, clinic_id):
                    return "consent_not_required"

    if trigger == "invoice_paid":
        want = (cond.get("invoice_status") or "paid").strip().lower()
        if (invoice or {}).get("payment_status", "").strip().lower() != want:
            return "condition_invoice_status"

    if trigger == "gift_card_issued":
        want = (cond.get("gift_card_status") or "active").strip().lower()
        if (gift_card or {}).get("status", "").strip().lower() != want:
            return "condition_gift_card_status"

    if trigger in ("package_balance_low", "package_session_remaining"):
        threshold = int(cond.get("remaining_sessions_lte") or 1)
        remaining = int((package or {}).get("remaining_sessions") or 999)
        if remaining > threshold:
            return "condition_package_balance"

    if is_reminder_trigger(trigger) and booking:
        sched = _parse_dt(booking.get("scheduled_at"))
        if not sched or sched <= now_utc():
            return "booking_not_upcoming"

    return None


def reference_for_context(
    trigger_type: str,
    *,
    booking: Optional[dict] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
    visit: Optional[dict] = None,
) -> Tuple[str, str]:
    normalized = normalize_trigger_type(trigger_type)
    if booking and normalized in (
        "booking_created", "booking_confirmed", "booking_cancelled", "booking_rescheduled",
        "before_appointment", "consent_required_missing",
    ):
        return "booking", booking.get("id") or ""
    if invoice or normalized == "invoice_paid":
        return "invoice", (invoice or {}).get("id") or ""
    if gift_card or normalized == "gift_card_issued":
        return "gift_card", (gift_card or {}).get("id") or ""
    if package or normalized in ("package_balance_low", "package_session_remaining"):
        return "patient_package", (package or {}).get("id") or ""
    if visit or normalized in ("visit_completed", "visit_completed_aftercare"):
        return "visit", (visit or {}).get("id") or ""
    return "automation", ""


async def get_or_create_automation_run(
    db,
    *,
    clinic_id: str,
    rule: dict,
    reference_type: str,
    reference_id: str,
    scheduled_for: datetime,
    patient_id: Optional[str] = None,
    settings: Optional[dict] = None,
) -> Tuple[dict, bool]:
    from whatsgo_automation_jobs import job_max_attempts, new_job_fields, should_schedule_reminder

    key = scheduled_for_key(scheduled_for)
    normalized_trigger = normalize_trigger_type(rule.get("trigger_type") or rule.get("event_type") or "")
    if is_reminder_trigger(normalized_trigger):
        ok, skip = should_schedule_reminder(scheduled_for)
        if not ok:
            return {"status": "skipped", "skip_reason": skip}, False

    existing = await db.automation_runs.find_one(
        {
            "clinic_id": clinic_id,
            "rule_id": rule["id"],
            "reference_type": reference_type,
            "reference_id": reference_id,
            "scheduled_for": key,
        },
        {"_id": 0},
    )
    if existing:
        return existing, False

    max_att = job_max_attempts(settings or {}, rule)
    doc = {
        "id": str(uuid.uuid4()),
        **new_job_fields(
            clinic_id=clinic_id,
            rule=rule,
            reference_type=reference_type,
            reference_id=reference_id,
            scheduled_for=scheduled_for,
            patient_id=patient_id,
            event_type=canonical_event_type(rule.get("trigger_type") or rule.get("event_type") or ""),
            max_attempts=max_att,
        ),
    }
    await db.automation_runs.insert_one(doc)
    doc.pop("_id", None)
    return doc, True


async def _already_sent_for_rule(
    db,
    *,
    clinic_id: str,
    rule: dict,
    reference_type: str,
    reference_id: str,
    conditions: dict,
) -> bool:
    if conditions.get("send_once_per_booking") and reference_type == "booking":
        n = await db.automation_runs.count_documents({
            "clinic_id": clinic_id,
            "rule_id": rule["id"],
            "reference_type": "booking",
            "reference_id": reference_id,
            "status": "sent",
        })
        return n > 0
    if conditions.get("send_once_per_invoice") and reference_type == "invoice":
        n = await db.automation_runs.count_documents({
            "clinic_id": clinic_id,
            "rule_id": rule["id"],
            "reference_type": "invoice",
            "reference_id": reference_id,
            "status": "sent",
        })
        return n > 0
    if conditions.get("send_once_per_gift_card") and reference_type == "gift_card":
        n = await db.automation_runs.count_documents({
            "clinic_id": clinic_id,
            "rule_id": rule["id"],
            "reference_type": "gift_card",
            "reference_id": reference_id,
            "status": "sent",
        })
        return n > 0
    if conditions.get("send_once_per_threshold") and reference_type == "patient_package":
        threshold = int(conditions.get("remaining_sessions_lte") or 1)
        n = await db.automation_runs.count_documents({
            "clinic_id": clinic_id,
            "rule_id": rule["id"],
            "reference_type": "patient_package",
            "reference_id": reference_id,
            "status": "sent",
            "threshold": threshold,
        })
        return n > 0
    return False


async def process_automation_run(
    db,
    jwt_secret: str,
    run: dict,
    rule: dict,
    *,
    booking: Optional[dict] = None,
    patient: Optional[dict] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
    visit: Optional[dict] = None,
    consent_url: Optional[str] = None,
    payment_url: Optional[str] = None,
    manual_test: bool = False,
) -> None:
    import asyncio

    from messaging import (
        build_message_context,
        create_message_log,
        create_skipped_log,
        get_provider_credentials,
        load_messaging_settings,
        normalize_phone,
        render_message,
    )
    from whatsgo_automation_jobs import (
        claim_automation_job,
        classify_send_error,
        compute_next_retry_at,
        job_max_attempts,
    )

    run_id = run.get("id")
    if run.get("status") in ("pending", "retrying") and run_id:
        claimed = await claim_automation_job(db, run_id)
        if not claimed:
            return
        run = claimed

    clinic_id = run["clinic_id"]
    settings = await load_messaging_settings(db, clinic_id)
    creds = get_provider_credentials(jwt_secret, clinic_id, settings)
    now = iso(now_utc())
    cond = rule.get("conditions") or {}
    provider = settings.get("provider") or "none"
    event_type = canonical_event_type(rule.get("trigger_type") or rule.get("event_type") or "")

    async def _finish_run(upd: Dict[str, Any]) -> None:
        upd["updated_at"] = now
        await db.automation_runs.update_one({"id": run["id"]}, {"$set": upd})
        rule_upd: Dict[str, Any] = {"updated_at": now, "last_run_status": upd.get("status")}
        if upd.get("status") == "sent":
            rule_upd["last_run_at"] = now
        await db.messaging_automation_rules.update_one({"id": rule["id"]}, {"$set": rule_upd})

    if not settings.get("enable_messaging"):
        await _finish_run({"status": "skipped", "skip_reason": "messaging_disabled", "processed_at": now, "error_reason": "Messaging disabled"})
        return

    if provider == "whatsgo" and not settings.get("whatsgo_automation_sending_enabled") and not manual_test:
        await _finish_run({"status": "skipped", "skip_reason": "whatsgo_automation_disabled", "processed_at": now, "error_reason": "Automatic Whatsgo sending is disabled"})
        return

    if not rule.get("enabled") and not manual_test:
        await _finish_run({"status": "skipped", "skip_reason": "rule_disabled", "processed_at": now, "error_reason": "Rule is disabled"})
        return

    skip_cond = await evaluate_rule_conditions(
        db, rule, clinic_id=clinic_id, booking=booking, patient=patient,
        invoice=invoice, gift_card=gift_card, package=package, visit=visit,
    )
    if skip_cond and not manual_test:
        await _finish_run({"status": "skipped", "skip_reason": skip_cond, "processed_at": now, "error_reason": skip_cond})
        return

    ref_type, ref_id = run.get("reference_type") or "", run.get("reference_id") or ""
    if await _already_sent_for_rule(
        db, clinic_id=clinic_id, rule=rule, reference_type=ref_type,
        reference_id=ref_id, conditions=cond,
    ) and not manual_test:
        await _finish_run({"status": "skipped", "skip_reason": "already_sent", "processed_at": now, "error_reason": "Already sent for this appointment"})
        return

    send_cfg = await resolve_rule_send_config(db, clinic_id, rule)
    whatsjet_template_name = send_cfg["whatsjet_template_name"]
    language_code = send_cfg["language_code"]
    variable_mapping = send_cfg["variable_mapping"]
    preview_text = send_cfg["preview_text"]
    legacy_tpl = send_cfg.get("legacy_template")

    ctx = await build_message_context(
        db, clinic_id, booking=booking, patient=patient, invoice=invoice,
        gift_card=gift_card, package=package, payment_url=payment_url, consent_url=consent_url,
    )
    if visit and visit.get("completed_at"):
        ctx.setdefault("visit_completed_at", visit.get("completed_at") or "")

    recipient = normalize_phone(
        ctx.get("patient_phone") or (booking or {}).get("patient_phone") or ""
    )
    rule_for_vars = {**rule, "variable_mapping": variable_mapping}
    variable_values = build_rule_variable_values(rule_for_vars, ctx)
    rendered = render_message(preview_text, ctx) if preview_text else (
        f"WhatsJet template: {whatsjet_template_name}" if whatsjet_template_name else "Automation message"
    )

    if provider in ("whatsjet", "whatsgo") and not whatsjet_template_name:
        await _finish_run({"status": "skipped", "skip_reason": "template_not_configured", "processed_at": now, "error_reason": "Template not configured"})
        return

    skip_reason = _automation_send_precheck(settings, creds, recipient=recipient)
    if skip_reason:
        pseudo_tpl = {
            "id": rule.get("id"),
            "template_type": event_type or "automation",
            "channel": "whatsapp",
            "message_body": rendered,
            "active": True,
        }
        await create_skipped_log(
            db,
            clinic_id=clinic_id,
            template=pseudo_tpl,
            recipient=recipient or "—",
            rendered=rendered,
            provider=provider,
            channel="whatsapp",
            patient_id=(patient or {}).get("id") or (booking or {}).get("patient_id"),
            booking_id=(booking or {}).get("id"),
            visit_id=(visit or {}).get("id"),
            skip_reason=skip_reason,
        )
        await _finish_run({"status": "skipped", "skip_reason": skip_reason, "processed_at": now, "error_reason": skip_reason})
        return

    patient_id = (patient or {}).get("id") or (booking or {}).get("patient_id") or run.get("patient_id")
    if provider == "whatsgo" and patient_id and patient:
        try:
            from whatsgo_service import upsert_contact
            await upsert_contact(
                db,
                clinic_id=clinic_id,
                patient=patient,
                settings=settings,
                creds=creds,
            )
        except Exception:
            logger.exception("Whatsgo pre-send contact sync failed clinic=%s patient=%s", clinic_id, patient_id)

    payload_snapshot = {
        "template_name": whatsjet_template_name,
        "language": language_code,
        "variable_mapping": variable_mapping,
        "variable_values": variable_values,
        "event_type": event_type,
        "recipient": recipient,
    }

    if provider == "whatsjet":
        from whatsjet_adapter import send_whatsjet_template_message

        send_fn = send_whatsjet_template_message
        send_kwargs = dict(
            clinic_id=clinic_id,
            to_phone=recipient,
            template_name=whatsjet_template_name,
            language=language_code,
            variable_values=variable_values,
            settings=settings,
            creds=creds,
        )
    elif provider == "whatsgo":
        from whatsgo_adapter import send_whatsgo_template_message

        send_fn = send_whatsgo_template_message
        send_kwargs = dict(
            clinic_id=clinic_id,
            to_phone=recipient,
            template_name=whatsjet_template_name,
            language=language_code,
            variable_values=variable_values,
            settings=settings,
            creds=creds,
            patient_id=patient_id,
            external_reference_type="automation",
            external_reference_id=ref_id or None,
            variable_mapping=variable_mapping,
        )
    else:
        send_fn = None
        send_kwargs = {}

    if provider in ("whatsjet", "whatsgo"):
        pseudo_tpl = {
            "id": rule.get("id"),
            "template_type": event_type or rule.get("trigger_type") or "automation",
            "template_key": event_type or rule.get("trigger_type") or "automation",
            "template_name": whatsjet_template_name,
            "channel": "whatsapp",
            "message_body": rendered,
            "provider_template_name": whatsjet_template_name,
            "language": language_code,
            "active": True,
        }
        log = await create_message_log(
            db,
            clinic_id=clinic_id,
            template=pseudo_tpl,
            recipient=recipient,
            rendered=rendered,
            provider=provider,
            channel="whatsapp",
            patient_id=patient_id,
            booking_id=(booking or {}).get("id"),
            visit_id=(visit or {}).get("id"),
            invoice_id=(invoice or {}).get("id"),
            send_at=now_utc(),
            status="queued",
            reference_type=f"automation:{event_type}",
            reference_id=ref_id,
            whatsjet_variable_values=variable_values,
            source_event=event_type,
            template_name=whatsjet_template_name,
            external_reference_type="automation",
            external_reference_id=ref_id,
        )
        try:
            ok, msg_id, err, raw = await asyncio.to_thread(send_fn, **send_kwargs)
        except Exception as ex:
            ok, msg_id, err, raw = False, None, str(ex)[:500], {}

        upd_log: Dict[str, Any] = {"updated_at": now}
        open_url = (raw or {}).get("open_conversation_url") if isinstance(raw, dict) else ""
        if ok:
            upd_log["status"] = "sent"
            upd_log["sent_at"] = now
            upd_log["provider_message_id"] = msg_id
            upd_log["whatsgo_message_id"] = msg_id
            upd_log["open_conversation_url"] = open_url or ""
            upd_log["error_message"] = None
            upd_log["error_reason"] = None
        else:
            upd_log["status"] = "failed"
            upd_log["error_message"] = err or "Send failed"
            upd_log["error_reason"] = err or "Send failed"
        await db.message_logs.update_one({"id": log["id"]}, {"$set": upd_log})
        final_status = upd_log["status"]
        err_reason = upd_log.get("error_reason")
        open_conversation_url = open_url or ""
        whatsgo_message_id = msg_id
    elif legacy_tpl and provider in ("whatsapp_cloud_api", "twilio"):
        from messaging import _automation_precheck, dispatch_message

        skip_reason = await _automation_precheck(settings, creds, template=legacy_tpl, recipient=recipient)
        if skip_reason == "no_recipient":
            skip_reason = "missing_phone"
        if skip_reason:
            await db.automation_runs.update_one(
                {"id": run["id"]},
                {"$set": {"status": "skipped", "skip_reason": skip_reason, "processed_at": now}},
            )
            return
        tpl = legacy_tpl
        if whatsjet_template_name:
            tpl = {**tpl, "provider_template_name": whatsjet_template_name}
        log = await create_message_log(
            db,
            clinic_id=clinic_id,
            template=tpl,
            recipient=recipient,
            rendered=render_message(tpl.get("message_body") or preview_text, ctx),
            provider=provider,
            channel=tpl.get("channel") or "whatsapp",
            patient_id=(patient or {}).get("id") or (booking or {}).get("patient_id"),
            booking_id=(booking or {}).get("id"),
            visit_id=(visit or {}).get("id"),
            invoice_id=(invoice or {}).get("id"),
            send_at=now_utc(),
            status="queued",
            reference_type=f"automation_rule:{rule['id']}",
            reference_id=ref_id,
        )
        await dispatch_message(db, log, settings, creds, tpl)
        updated = await db.message_logs.find_one({"id": log["id"]}, {"_id": 0, "status": 1, "error_message": 1})
        final_status = (updated or {}).get("status") or "failed"
    else:
        if not whatsjet_template_name:
            await db.automation_runs.update_one(
                {"id": run["id"]},
                {"$set": {"status": "skipped", "skip_reason": "template_not_configured", "processed_at": now}},
            )
            return
        await db.automation_runs.update_one(
            {"id": run["id"]},
            {"$set": {"status": "skipped", "skip_reason": "provider_not_connected", "processed_at": now}},
        )
        return

    run_upd: Dict[str, Any] = {
        "message_log_id": log["id"],
        "processed_at": now,
        "patient_id": patient_id or "",
        "event_type": event_type,
        "payload_snapshot": payload_snapshot,
        "threshold": int(cond.get("remaining_sessions_lte") or 0) or None,
    }
    attempt_count = int(run.get("attempt_count") or 0) + 1
    run_upd["attempt_count"] = attempt_count
    max_attempts = int(run.get("max_attempts") or job_max_attempts(settings, rule))

    if final_status in ("sent", "delivered", "read", "queued"):
        run_upd["status"] = "sent"
        run_upd["sent_at"] = now
        run_upd["whatsgo_message_id"] = locals().get("whatsgo_message_id")
        run_upd["open_conversation_url"] = locals().get("open_conversation_url") or ""
        run_upd["error_reason"] = None
        run_upd["next_retry_at"] = None
        await db.messaging_automation_rules.update_one(
            {"id": rule["id"]},
            {"$set": {"last_run_at": now, "updated_at": now, "last_run_status": "sent"}, "$inc": {"last_sent_count": 1}},
        )
    elif final_status == "skipped":
        run_upd["status"] = "skipped"
        run_upd["skip_reason"] = "skipped"
    else:
        err_reason = locals().get("err_reason") or (
            upd_log.get("error_message") if provider in ("whatsjet", "whatsgo") else (
                (await db.message_logs.find_one({"id": log["id"]}, {"_id": 0, "error_message": 1}) or {}).get("error_message")
            )
        ) or "Send failed"
        run_upd["error_reason"] = err_reason
        run_upd["error_message"] = err_reason
        failure_kind = classify_send_error(err_reason)
        if failure_kind == "temporary" and attempt_count < max_attempts:
            next_retry = compute_next_retry_at(attempt_count)
            run_upd["status"] = "retrying"
            run_upd["next_retry_at"] = iso(next_retry)
        else:
            run_upd["status"] = "failed"
            run_upd["next_retry_at"] = None
    await db.automation_runs.update_one({"id": run["id"]}, {"$set": run_upd})
    await db.messaging_automation_rules.update_one(
        {"id": rule["id"]},
        {"$set": {"last_run_status": run_upd.get("status"), "updated_at": now}},
    )
    if run_upd.get("status") in ("sent", "failed"):
        await _log_automation_job_audit(
            db,
            clinic_id,
            run["id"],
            run_upd["status"],
            meta={
                "event_type": event_type,
                "reference_type": ref_type,
                "reference_id": ref_id,
                "error_reason": run_upd.get("error_reason"),
                "attempt_count": run_upd.get("attempt_count"),
            },
        )


async def trigger_automation_rules_for_event(
    db,
    jwt_secret: str,
    clinic_id: str,
    trigger_type: str,
    *,
    booking: Optional[dict] = None,
    patient: Optional[dict] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
    visit: Optional[dict] = None,
    consent_url: Optional[str] = None,
    payment_url: Optional[str] = None,
    manual_test: bool = False,
) -> None:
    normalized = normalize_trigger_type(trigger_type)
    if normalized not in {normalize_trigger_type(t) for t in AUTOMATION_TRIGGER_TYPES} and trigger_type not in AUTOMATION_TRIGGER_TYPES:
        return
    try:
        from messaging import load_messaging_settings

        settings = await load_messaging_settings(db, clinic_id)
        if settings.get("provider") == "whatsgo" and not settings.get("whatsgo_automation_sending_enabled") and not manual_test:
            return
        await ensure_default_automation_rules(db, clinic_id)
        all_rules = await db.messaging_automation_rules.find(
            {"clinic_id": clinic_id, "enabled": True},
            {"_id": 0},
        ).to_list(100)
        rules = [
            r for r in all_rules
            if normalize_trigger_type(r.get("trigger_type") or r.get("event_type") or "") == normalized
        ]
        if not rules:
            return

        if patient is None and booking and booking.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": booking["patient_id"], "clinic_id": clinic_id},
                {"_id": 0},
            )

        for rule in rules:
            skip_cond = await evaluate_rule_conditions(
                db, rule, clinic_id=clinic_id, booking=booking, patient=patient,
                invoice=invoice, gift_card=gift_card, package=package, visit=visit,
            )
            if skip_cond and not manual_test:
                continue

            ref_type, ref_id = reference_for_context(
                normalized, booking=booking, invoice=invoice,
                gift_card=gift_card, package=package, visit=visit,
            )
            if not ref_id:
                continue

            event_at = now_utc()
            if is_reminder_trigger(normalized) and booking:
                sched = _parse_dt(booking.get("scheduled_at"))
                if not sched:
                    continue
                event_at = sched
            elif normalized == "visit_completed" and visit:
                event_at = _parse_dt(visit.get("completed_at")) or now_utc()

            send_at = compute_rule_send_at(rule, event_at=event_at, trigger_type=normalized)
            patient_id = (patient or {}).get("id") or (booking or {}).get("patient_id")
            run, _created = await get_or_create_automation_run(
                db,
                clinic_id=clinic_id,
                rule=rule,
                reference_type=ref_type,
                reference_id=ref_id,
                scheduled_for=send_at,
                patient_id=patient_id,
                settings=settings,
            )
            if run.get("status") == "skipped":
                continue
            if run.get("status") not in ("pending", "retrying"):
                continue

            timing_type = rule.get("timing_type") or "immediately"
            if timing_type == "immediately" or send_at <= now_utc() + DUE_WINDOW or manual_test:
                await process_automation_run(
                    db, jwt_secret, run, rule,
                    booking=booking, patient=patient, invoice=invoice,
                    gift_card=gift_card, package=package, visit=visit,
                    consent_url=consent_url, payment_url=payment_url,
                    manual_test=manual_test,
                )
    except Exception:
        logger.exception("trigger_automation_rules_for_event failed clinic=%s trigger=%s", clinic_id, trigger_type)


def safe_trigger_automation_rules(db, jwt_secret: str, clinic_id: str, trigger_type: str, **kwargs) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(trigger_automation_rules_for_event(db, jwt_secret, clinic_id, trigger_type, **kwargs))
    except RuntimeError:
        asyncio.run(trigger_automation_rules_for_event(db, jwt_secret, clinic_id, trigger_type, **kwargs))


async def run_due_automation(db, jwt_secret: str, limit: int = 100) -> int:
    """Process pending/retrying automation jobs and scan reminder rules."""
    from messaging import load_messaging_settings

    processed = 0
    now_dt = now_utc()
    now = iso(now_dt)

    due_filter = {
        "$or": [
            {"status": "pending", "scheduled_for": {"$lte": now}},
            {"status": "retrying", "next_retry_at": {"$lte": now}},
        ],
    }
    async for run in db.automation_runs.find(due_filter, {"_id": 0}).sort("scheduled_for", 1).limit(limit):
        rule = await db.messaging_automation_rules.find_one(
            {"id": run["rule_id"], "clinic_id": run["clinic_id"], "enabled": True},
            {"_id": 0},
        )
        if not rule:
            await db.automation_runs.update_one(
                {"id": run["id"]},
                {"$set": {"status": "skipped", "skip_reason": "rule_disabled", "processed_at": now}},
            )
            continue

        booking = invoice = gift_card = package = visit = patient = None
        ref_type = run.get("reference_type") or ""
        ref_id = run.get("reference_id") or ""
        cid = run["clinic_id"]

        if ref_type == "booking":
            booking = await db.bookings.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})
        elif ref_type == "invoice":
            invoice = await db.invoices.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})
        elif ref_type == "gift_card":
            gift_card = await db.gift_cards.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})
        elif ref_type == "patient_package":
            package = await db.patient_packages.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})
        elif ref_type == "visit":
            visit = await db.visits.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})

        if booking and booking.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": booking["patient_id"], "clinic_id": cid},
                {"_id": 0},
            )
        elif invoice and invoice.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": invoice["patient_id"], "clinic_id": cid},
                {"_id": 0},
            )
        elif package and package.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": package["patient_id"], "clinic_id": cid},
                {"_id": 0},
            )

        await process_automation_run(
            db, jwt_secret, run, rule,
            booking=booking, patient=patient, invoice=invoice,
            gift_card=gift_card, package=package, visit=visit,
        )
        processed += 1
        if processed >= limit:
            return processed

    async for rule in db.messaging_automation_rules.find({"enabled": True}, {"_id": 0}).limit(100):
        if not is_reminder_trigger(rule.get("trigger_type") or rule.get("event_type") or ""):
            continue
        cid = rule["clinic_id"]
        settings = await load_messaging_settings(db, cid)
        if not settings.get("enable_messaging"):
            continue
        clinic = await db.clinics.find_one({"id": cid}, {"_id": 0, "timezone": 1})
        tz, _ = _clinic_tz(clinic)
        value = int(rule.get("timing_value") or 1)
        unit = rule.get("timing_unit") or "days"
        lead = _timing_delta(value, unit)
        window_start = now_dt - DUE_WINDOW
        window_end = now_dt + DUE_WINDOW + timedelta(minutes=1)

        appt_start_min = window_start + lead
        appt_start_max = window_end + lead

        flt: Dict[str, Any] = {
            "clinic_id": cid,
            "scheduled_at": {
                "$gte": iso(appt_start_min),
                "$lte": iso(appt_start_max),
            },
            "status": {"$nin": list(EXCLUDED_BOOKING_STATUSES)},
            "booking_type": {"$ne": "block"},
        }
        async for booking in db.bookings.find(flt, {"_id": 0}).limit(30):
            sched = _parse_dt(booking.get("scheduled_at"))
            if not sched:
                continue
            send_at = compute_rule_send_at(rule, event_at=sched, trigger_type="before_appointment")
            if not (window_start <= send_at <= window_end):
                continue
            run, created = await get_or_create_automation_run(
                db,
                clinic_id=cid,
                rule=rule,
                reference_type="booking",
                reference_id=booking["id"],
                scheduled_for=send_at,
                patient_id=booking.get("patient_id"),
                settings=settings,
            )
            if run.get("status") == "skipped":
                continue
            if created or run.get("status") in ("pending", "retrying"):
                patient = None
                if booking.get("patient_id"):
                    patient = await db.patients.find_one(
                        {"id": booking["patient_id"], "clinic_id": cid},
                        {"_id": 0},
                    )
                await process_automation_run(
                    db, jwt_secret, run, rule, booking=booking, patient=patient,
                )
                processed += 1
                if processed >= limit:
                    return processed

    async for rule in db.messaging_automation_rules.find(
        {"enabled": True, "trigger_type": "visit_completed", "timing_type": "after_event"},
        {"_id": 0},
    ).limit(50):
        cid = rule["clinic_id"]
        value = int(rule.get("timing_value") or 0)
        unit = rule.get("timing_unit") or "days"
        delta = _timing_delta(value, unit)
        window_start = now_dt - DUE_WINDOW - delta
        window_end = now_dt + DUE_WINDOW - delta

        flt = {
            "clinic_id": cid,
            "status": "completed",
            "completed_at": {"$gte": iso(window_start), "$lte": iso(window_end)},
        }
        async for visit in db.visits.find(flt, {"_id": 0}).limit(30):
            completed = _parse_dt(visit.get("completed_at"))
            if not completed:
                continue
            send_at = compute_rule_send_at(rule, event_at=completed, trigger_type="visit_completed")
            if not (now_dt - DUE_WINDOW <= send_at <= now_dt + DUE_WINDOW):
                continue
            run, created = await get_or_create_automation_run(
                db,
                clinic_id=cid,
                rule=rule,
                reference_type="visit",
                reference_id=visit["id"],
                scheduled_for=send_at,
            )
            if created or run.get("status") == "pending":
                patient = None
                if visit.get("patient_id"):
                    patient = await db.patients.find_one(
                        {"id": visit["patient_id"], "clinic_id": cid},
                        {"_id": 0},
                    )
                booking = None
                if visit.get("booking_id"):
                    booking = await db.bookings.find_one(
                        {"id": visit["booking_id"], "clinic_id": cid},
                        {"_id": 0},
                    )
                await process_automation_run(
                    db, jwt_secret, run, rule, visit=visit, patient=patient, booking=booking,
                )
                processed += 1
                if processed >= limit:
                    return processed

    return processed


# ---------- API ----------

class AutomationRuleConditionsIn(BaseModel):
    service_type: Optional[str] = "any"
    treatment_category: Optional[str] = None
    treatment: Optional[str] = None
    booking_status: Optional[str] = None
    payment_status: Optional[str] = None
    consent_required_only: Optional[bool] = None
    require_phone: Optional[bool] = True
    exclude_statuses: Optional[List[str]] = None
    send_once_per_booking: Optional[bool] = True
    invoice_status: Optional[str] = "paid"
    send_once_per_invoice: Optional[bool] = True
    gift_card_status: Optional[str] = "active"
    send_once_per_gift_card: Optional[bool] = True
    remaining_sessions_lte: Optional[int] = 1
    send_once_per_threshold: Optional[bool] = True


class AutomationRuleIn(BaseModel):
    name: str
    display_name: Optional[str] = None
    trigger_type: str
    event_type: Optional[str] = None
    timing_type: str = "immediately"
    timing_value: int = Field(0, ge=0, le=365)
    timing_unit: str = "hours"
    offset_value: Optional[int] = Field(None, ge=0, le=365)
    offset_unit: Optional[str] = None
    whatsjet_template_name: Optional[str] = ""
    whatsgo_template_name: Optional[str] = ""
    language_code: str = "id"
    variable_mapping: Optional[List[str]] = None
    preview_text: Optional[str] = ""
    enabled: bool = False
    recipient_audience: str = "patient"
    conditions: Optional[Dict[str, Any]] = None
    template_id: Optional[str] = None
    provider_template_name: Optional[str] = ""
    max_attempts: Optional[int] = Field(None, ge=1, le=10)


def _rule_doc_fields(payload: AutomationRuleIn) -> Dict[str, Any]:
    raw_trigger = (payload.event_type or payload.trigger_type or "").strip()
    internal_trigger = normalize_trigger_type(raw_trigger)
    canonical = (payload.event_type or canonical_event_type(raw_trigger)).strip()
    wj_name = (
        (payload.whatsjet_template_name or payload.whatsgo_template_name or payload.provider_template_name or "")
        .strip()
    )
    mapping = [str(x).strip() for x in (payload.variable_mapping or []) if str(x).strip()]
    offset_value = payload.offset_value if payload.offset_value is not None else payload.timing_value
    offset_unit = (payload.offset_unit or payload.timing_unit or "hours").strip()
    display_name = (payload.display_name or payload.name or "").strip()
    return {
        "name": payload.name.strip(),
        "display_name": display_name or payload.name.strip(),
        "trigger_type": internal_trigger,
        "event_type": canonical,
        "timing_type": payload.timing_type,
        "timing_value": int(offset_value or 0),
        "timing_unit": offset_unit,
        "offset_value": int(offset_value or 0),
        "offset_unit": offset_unit,
        "whatsjet_template_name": wj_name,
        "whatsgo_template_name": wj_name,
        "language_code": (payload.language_code or "id").strip() or "id",
        "variable_mapping": mapping,
        "preview_text": (payload.preview_text or "").strip(),
        "enabled": payload.enabled,
        "recipient_audience": (payload.recipient_audience or "patient").strip() or "patient",
        "conditions": dict(payload.conditions or {}),
        "template_id": (payload.template_id or "").strip() or None,
        "provider_template_name": wj_name,
        "max_attempts": payload.max_attempts,
        "last_run_status": None,
    }


class AutomationRuleTestIn(BaseModel):
    trigger_type: str
    booking_id: Optional[str] = None
    invoice_id: Optional[str] = None
    gift_card_id: Optional[str] = None
    package_id: Optional[str] = None
    visit_id: Optional[str] = None


def register_messaging_automation(
    api: APIRouter,
    db,
    get_current_user,
    audit,
    jwt_secret: str,
    assert_feature=None,
) -> None:
    async def _view_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if assert_feature:
            await assert_feature(user, "whatsapp_automation")
        if not user_has_permission(user, "messaging.automation.view") and not user_has_permission(user, "messaging.automation.manage"):
            if user.get("role") not in ("super_admin", "manager"):
                raise HTTPException(status_code=403, detail="Automation rules access required")
        return user

    async def _manage_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if assert_feature:
            await assert_feature(user, "whatsapp_automation")
        if not user_has_permission(user, "messaging.automation.manage") and user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Automation rules manage access required")
        return user

    @api.get("/messaging/automation/tags")
    async def list_automation_tags(user: dict = Depends(_view_dep)):
        return {
            "tags": AUTOMATION_DYNAMIC_TAGS,
            "event_types": [
                {"value": k, "label": v} for k, v in EVENT_TYPE_LABELS.items()
                if k in EVENT_TYPE_TO_TRIGGER or k in (
                    "consent_form_request", "visit_completed_aftercare",
                    "package_session_remaining", "package_expiry_reminder",
                )
            ],
        }

    @api.get("/messaging/automation/rules")
    async def list_automation_rules(user: dict = Depends(_view_dep)):
        cid = user["clinic_id"]
        await ensure_default_automation_rules(db, cid, created_by=user.get("id"))
        rows = await db.messaging_automation_rules.find(
            {"clinic_id": cid},
            {"_id": 0},
        ).sort("name", 1).to_list(200)
        from messaging import load_messaging_settings

        settings = await load_messaging_settings(db, cid)
        return {
            "items": rows,
            "count": len(rows),
            "provider": settings.get("provider") or "none",
        }

    @api.post("/messaging/automation/rules")
    async def create_automation_rule(payload: AutomationRuleIn, user: dict = Depends(_manage_dep)):
        raw = (payload.event_type or payload.trigger_type or "").strip()
        if raw not in AUTOMATION_TRIGGER_TYPES and normalize_trigger_type(raw) not in {
            normalize_trigger_type(t) for t in AUTOMATION_TRIGGER_TYPES
        }:
            raise HTTPException(status_code=400, detail="Invalid event_type / trigger_type")
        if payload.timing_type not in TIMING_TYPES:
            raise HTTPException(status_code=400, detail="Invalid timing_type")
        if payload.timing_unit not in TIMING_UNITS:
            raise HTTPException(status_code=400, detail="Invalid timing_unit")
        cid = user["clinic_id"]
        fields = _rule_doc_fields(payload)
        if not fields["whatsjet_template_name"] and not fields["template_id"]:
            raise HTTPException(
                status_code=400,
                detail="WhatsJet approved template name is required (create templates in WhatsJet/Meta first)",
            )
        now = iso(now_utc())
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            **fields,
            "dedupe_key_strategy": "rule_reference_scheduled",
            "last_run_at": None,
            "last_sent_count": 0,
            "created_by": user.get("id"),
            "updated_by": user.get("id"),
            "created_at": now,
            "updated_at": now,
        }
        await db.messaging_automation_rules.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "messaging_automation_rule", doc["id"], {
            "trigger": fields.get("event_type") or fields.get("trigger_type"),
            "enabled": fields.get("enabled"),
        })
        return doc

    @api.put("/messaging/automation/rules/{rule_id}")
    async def update_automation_rule(rule_id: str, payload: AutomationRuleIn, user: dict = Depends(_manage_dep)):
        raw = (payload.event_type or payload.trigger_type or "").strip()
        if raw not in AUTOMATION_TRIGGER_TYPES and normalize_trigger_type(raw) not in {
            normalize_trigger_type(t) for t in AUTOMATION_TRIGGER_TYPES
        }:
            raise HTTPException(status_code=400, detail="Invalid event_type / trigger_type")
        cid = user["clinic_id"]
        fields = _rule_doc_fields(payload)
        if not fields["whatsjet_template_name"] and not fields["template_id"]:
            raise HTTPException(status_code=400, detail="WhatsJet approved template name is required")
        upd = {
            **fields,
            "updated_by": user.get("id"),
            "updated_at": iso(now_utc()),
        }
        r = await db.messaging_automation_rules.update_one(
            {"id": rule_id, "clinic_id": cid},
            {"$set": upd},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
        return await db.messaging_automation_rules.find_one({"id": rule_id, "clinic_id": cid}, {"_id": 0})

    @api.patch("/messaging/automation/rules/{rule_id}/enabled")
    async def toggle_automation_rule(rule_id: str, enabled: bool, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        r = await db.messaging_automation_rules.update_one(
            {"id": rule_id, "clinic_id": cid},
            {"$set": {"enabled": enabled, "updated_by": user.get("id"), "updated_at": iso(now_utc())}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
        await audit(user, "update", "messaging_automation_rule", rule_id, {"enabled": enabled})
        return {"ok": True, "enabled": enabled}

    @api.delete("/messaging/automation/rules/{rule_id}")
    async def delete_automation_rule(rule_id: str, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        r = await db.messaging_automation_rules.delete_one({"id": rule_id, "clinic_id": cid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
        await audit(user, "delete", "messaging_automation_rule", rule_id, {})
        return {"ok": True}

    @api.post("/messaging/automation/rules/{rule_id}/test")
    async def test_automation_rule(rule_id: str, payload: AutomationRuleTestIn, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        rule = await db.messaging_automation_rules.find_one({"id": rule_id, "clinic_id": cid}, {"_id": 0})
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")
        booking = invoice = gift_card = package = visit = None
        if payload.booking_id:
            booking = await db.bookings.find_one({"id": payload.booking_id, "clinic_id": cid}, {"_id": 0})
        if payload.invoice_id:
            invoice = await db.invoices.find_one({"id": payload.invoice_id, "clinic_id": cid}, {"_id": 0})
        if payload.gift_card_id:
            gift_card = await db.gift_cards.find_one({"id": payload.gift_card_id, "clinic_id": cid}, {"_id": 0})
        if payload.package_id:
            package = await db.patient_packages.find_one({"id": payload.package_id, "clinic_id": cid}, {"_id": 0})
        if payload.visit_id:
            visit = await db.visits.find_one({"id": payload.visit_id, "clinic_id": cid}, {"_id": 0})
        trigger = normalize_trigger_type(payload.trigger_type or rule.get("trigger_type") or "")
        await trigger_automation_rules_for_event(
            db, jwt_secret, cid, trigger,
            booking=booking, invoice=invoice, gift_card=gift_card, package=package, visit=visit,
            manual_test=True,
        )
        runs = await db.automation_runs.find(
            {"clinic_id": cid, "rule_id": rule_id},
            {"_id": 0},
        ).sort("created_at", -1).limit(3).to_list(3)
        return {"ok": True, "recent_runs": runs}

    @api.post("/messaging/automation/run-due")
    async def run_due_automation_endpoint(user: dict = Depends(_manage_dep)):
        n = await run_due_automation(db, jwt_secret, limit=100)
        return {"processed": n}

    @api.get("/messaging/automation/runs")
    async def list_automation_runs(
        rule_id: Optional[str] = None,
        status: Optional[str] = None,
        event_type: Optional[str] = None,
        patient_id: Optional[str] = None,
        limit: int = 50,
        user: dict = Depends(_view_dep),
    ):
        flt: Dict[str, Any] = {"clinic_id": user["clinic_id"]}
        if rule_id:
            flt["rule_id"] = rule_id
        if status:
            flt["status"] = status
        if event_type:
            flt["event_type"] = event_type
        if patient_id:
            flt["patient_id"] = patient_id
        rows = await db.automation_runs.find(flt, {"_id": 0}).sort("created_at", -1).limit(min(limit, 200)).to_list(min(limit, 200))
        return {"items": rows, "count": len(rows)}

    async def _job_manage_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if assert_feature:
            await assert_feature(user, "whatsapp_automation")
        if not user_has_permission(user, "messaging.automation.manage") and not user_has_permission(user, "messaging.send"):
            if user.get("role") not in ("super_admin", "manager"):
                raise HTTPException(status_code=403, detail="Not allowed")
        return user

    @api.post("/messaging/automation/jobs/{job_id}/retry")
    async def retry_automation_job(job_id: str, user: dict = Depends(_job_manage_dep)):
        cid = user["clinic_id"]
        job = await db.automation_runs.find_one({"id": job_id, "clinic_id": cid}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.get("status") not in ("failed", "retrying"):
            raise HTTPException(status_code=400, detail="Only failed or retrying jobs can be retried")
        rule = await db.messaging_automation_rules.find_one({"id": job["rule_id"], "clinic_id": cid}, {"_id": 0})
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")
        now = iso(now_utc())
        await db.automation_runs.update_one(
            {"id": job_id},
            {"$set": {"status": "pending", "next_retry_at": None, "updated_at": now}},
        )
        job = await db.automation_runs.find_one({"id": job_id}, {"_id": 0})
        booking = invoice = gift_card = package = visit = patient = None
        ref_type = job.get("reference_type") or ""
        ref_id = job.get("reference_id") or ""
        if ref_type == "booking":
            booking = await db.bookings.find_one({"id": ref_id, "clinic_id": cid}, {"_id": 0})
            if booking and booking.get("patient_id"):
                patient = await db.patients.find_one({"id": booking["patient_id"], "clinic_id": cid}, {"_id": 0})
        await process_automation_run(
            db, jwt_secret, job, rule,
            booking=booking, patient=patient, invoice=invoice,
            gift_card=gift_card, package=package, visit=visit,
            manual_test=True,
        )
        await audit(user, "update", "automation_job_retry", job_id, {})
        updated = await db.automation_runs.find_one({"id": job_id}, {"_id": 0})
        return updated

    @api.post("/messaging/automation/jobs/{job_id}/cancel")
    async def cancel_automation_job(job_id: str, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        now = iso(now_utc())
        r = await db.automation_runs.update_one(
            {"id": job_id, "clinic_id": cid, "status": {"$in": ["pending", "retrying", "queued"]}},
            {"$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "processed_at": now,
                "updated_at": now,
                "error_reason": "Cancelled manually",
            }},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Pending job not found")
        await audit(user, "update", "automation_job_cancel", job_id, {})
        return {"ok": True}
