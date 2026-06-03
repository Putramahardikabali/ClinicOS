"""Clinic messaging — provider abstraction, templates, queue/log, reminders (Phase 2)."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from permissions import user_has_permission
from saas import iso, now_utc

try:
    from cryptography.fernet import Fernet
except ImportError:  # pragma: no cover
    Fernet = None  # type: ignore

logger = logging.getLogger(__name__)

MESSAGING_PROVIDERS = frozenset({"none", "whatsapp_cloud_api", "whatsjet", "twilio"})
API_CAPABLE_PROVIDERS = frozenset({"whatsapp_cloud_api", "whatsjet", "twilio"})
MESSAGING_CHANNELS = frozenset({"whatsapp", "sms"})
CONNECTION_STATUSES = frozenset({"disabled", "not_connected", "connected", "error"})
TEMPLATE_TYPES = frozenset({
    "booking_confirmation", "booking_reminder", "booking_rescheduled",
    "booking_cancelled", "payment_link", "payment_received", "consent_link",
    "gift_card_issued", "package_balance_reminder",
    "follow_up", "birthday", "custom",
})
TIMING_RULES = frozenset({"immediately", "24_hours_before", "3_hours_before", "custom"})
MESSAGE_STATUSES = frozenset({
    "skipped", "queued", "sent", "delivered", "read", "failed", "cancelled", "manual_opened",
})
SKIP_REASONS = frozenset({
    "provider_not_connected",
    "messaging_disabled",
    "no_recipient",
    "template_inactive",
    "meta_template_missing",
    "booking_inactive",
})

TAG_PATTERN = re.compile(r"\{\{([a-z_]+)\}\}|\{([a-z_]+)\}", re.I)

DEFAULT_CLINIC_MESSAGING: Dict[str, Any] = {
    "enable_messaging": False,
    "provider": "none",
    "sender_name": "",
    "sender_phone_number": "",
    "webhook_url": "",
    "provider_credentials_encrypted": None,
    "connection_status": "disabled",
    "last_connection_error": "",
    "last_connection_test_at": None,
    "whatsjet_api_base_url": "",
    "whatsjet_vendor_uid": "",
    "whatsjet_send_path": "/api/{vendor_uid}/contact/send-message",
    "whatsjet_send_template_path": "/api/{vendor_uid}/contact/send-template-message",
    "whatsjet_test_path": "/api/{vendor_uid}/contact/contacts",
    "whatsjet_payload_style": "standard",
}

DEFAULT_MESSAGING_TEMPLATES: List[Dict[str, Any]] = [
    {
        "template_name": "Booking confirmation",
        "template_type": "booking_confirmation",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}! Your appointment for {{treatment_name}} at {{clinic_name}} "
            "is confirmed for {{appointment_date}} at {{appointment_time}}. See you then!"
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Day-before reminder",
        "template_type": "booking_reminder",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, reminder: {{treatment_name}} tomorrow ({{appointment_date}}) "
            "at {{appointment_time}} at {{clinic_name}}."
        ),
        "timing_rule": "24_hours_before",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Payment link",
        "template_type": "payment_link",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, please complete payment to confirm your booking: {{payment_link}}"
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Consent link",
        "template_type": "consent_link",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, please review and sign your consent form: {{consent_link}}"
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Payment received",
        "template_type": "payment_received",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, we received your payment of {{amount_paid}} for {{clinic_name}}. Thank you!"
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Gift card issued",
        "template_type": "gift_card_issued",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, your gift card {{gift_card_code}} from {{clinic_name}} is ready. "
            "Value: {{gift_card_value}}."
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
    {
        "template_name": "Package balance reminder",
        "template_type": "package_balance_reminder",
        "channel": "whatsapp",
        "message_body": (
            "Hi {{patient_name}}, your package {{package_name}} has {{sessions_remaining}} session(s) "
            "remaining at {{clinic_name}}."
        ),
        "timing_rule": "immediately",
        "language": "id",
        "active": True,
    },
]


def _fernet(secret: str, clinic_id: str) -> "Fernet":
    if Fernet is None:
        raise HTTPException(status_code=500, detail="cryptography package required for messaging credentials")
    raw = hashlib.sha256(f"{secret}:{clinic_id}:clinic_messaging".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_credentials(secret: str, clinic_id: str, creds: dict) -> str:
    return _fernet(secret, clinic_id).encrypt(json.dumps(creds).encode()).decode()


def decrypt_credentials(secret: str, clinic_id: str, encrypted: str) -> dict:
    if not encrypted:
        return {}
    try:
        return json.loads(_fernet(secret, clinic_id).decrypt(encrypted.encode()).decode())
    except Exception as ex:
        raise HTTPException(status_code=500, detail="Could not decrypt messaging credentials") from ex


def merge_messaging_settings(raw: Optional[dict]) -> dict:
    out = dict(DEFAULT_CLINIC_MESSAGING)
    if raw:
        for k in DEFAULT_CLINIC_MESSAGING:
            if k in raw and raw[k] is not None:
                out[k] = raw[k]
    return out


def is_api_capable_provider(provider: Optional[str]) -> bool:
    return (provider or "none") in API_CAPABLE_PROVIDERS


def credentials_complete(provider: str, creds: dict, settings: dict) -> Tuple[bool, Optional[str]]:
    if provider == "whatsapp_cloud_api":
        token = creds.get("access_token") or creds.get("whatsapp_access_token") or ""
        phone_id = creds.get("phone_number_id") or settings.get("sender_phone_number") or ""
        if not token:
            return False, "Access token required"
        if not phone_id:
            return False, "Phone Number ID required"
        return True, None
    if provider == "whatsjet":
        from whatsjet_adapter import whatsjet_credentials_complete, whatsjet_settings_bundle

        ok, reason = whatsjet_credentials_complete(whatsjet_settings_bundle(settings, creds))
        return ok, reason
    if provider == "twilio":
        sid = creds.get("account_sid") or ""
        token = creds.get("auth_token") or ""
        from_num = creds.get("from_number") or settings.get("sender_phone_number") or ""
        if not sid or not token:
            return False, "Twilio Account SID and Auth Token required"
        if not from_num:
            return False, "Twilio from number required"
        return True, None
    return False, "API provider not selected"


def compute_connection_status(
    settings: dict,
    creds: Optional[dict] = None,
    *,
    test_ok: Optional[bool] = None,
    test_error: Optional[str] = None,
) -> str:
    if not settings.get("enable_messaging"):
        return "disabled"
    provider = settings.get("provider") or "none"
    if not is_api_capable_provider(provider):
        return "not_connected"
    creds = creds if creds is not None else {}
    ok, _reason = credentials_complete(provider, creds, settings)
    if not ok:
        return "not_connected"
    if test_error:
        return "error"
    if test_ok is True:
        return "connected"
    stored = (settings.get("connection_status") or "").strip()
    if stored == "connected" and not test_error:
        return "connected"
    if stored == "error":
        return "error"
    return "not_connected"


def is_automation_active(
    settings: dict,
    creds: Optional[dict] = None,
    *,
    test_ok: Optional[bool] = None,
) -> bool:
    return compute_connection_status(settings, creds, test_ok=test_ok) == "connected"


def get_provider_credentials(secret: str, clinic_id: str, settings: dict) -> dict:
    enc = settings.get("provider_credentials_encrypted")
    if not enc:
        return {}
    try:
        return decrypt_credentials(secret, clinic_id, enc)
    except HTTPException:
        return {}


def sanitize_settings_admin(
    settings: dict,
    *,
    has_credentials: bool,
    creds: Optional[dict] = None,
    test_ok: Optional[bool] = None,
    test_error: Optional[str] = None,
) -> dict:
    status = compute_connection_status(settings, creds, test_ok=test_ok, test_error=test_error)
    provider = settings.get("provider") or "none"
    return {
        "enable_messaging": bool(settings.get("enable_messaging")),
        "provider": provider,
        "sender_name": settings.get("sender_name") or "",
        "sender_phone_number": settings.get("sender_phone_number") or "",
        "webhook_url": settings.get("webhook_url") or "",
        "has_credentials": has_credentials,
        "connection_status": status,
        "automation_active": status == "connected",
        "manual_fallback_available": True,
        "provider_is_api_capable": is_api_capable_provider(provider),
        "last_connection_error": (settings.get("last_connection_error") or "")[:300] or None,
        "last_connection_test_at": settings.get("last_connection_test_at"),
        "whatsjet_api_base_url": settings.get("whatsjet_api_base_url") or "",
        "whatsjet_vendor_uid": settings.get("whatsjet_vendor_uid") or "",
        "whatsjet_send_path": settings.get("whatsjet_send_path") or "",
        "whatsjet_send_template_path": settings.get("whatsjet_send_template_path") or "",
        "whatsjet_test_path": settings.get("whatsjet_test_path") or "",
        "whatsjet_payload_style": settings.get("whatsjet_payload_style") or "standard",
        "has_whatsjet_webhook_secret": bool(
            (settings.get("whatsjet_webhook_secret") or "")
            or (creds or {}).get("webhook_secret")
        ),
    }


def _public_base_url() -> str:
    return (os.environ.get("PUBLIC_APP_URL") or os.environ.get("REACT_APP_FRONTEND_URL") or "http://localhost:3000").rstrip("/")


def render_message(body: str, context: Dict[str, str]) -> str:
    def repl(m: re.Match) -> str:
        key = (m.group(1) or m.group(2) or "").lower()
        return context.get(key, m.group(0))

    return TAG_PATTERN.sub(repl, body or "")


def _sanitize_error(data: Any) -> str:
    if isinstance(data, dict):
        msg = data.get("message") or data.get("detail") or data.get("error") or str(data)
    else:
        msg = str(data)
    return msg[:500]


def _timing_delta(rule: str, custom_minutes: int = 0) -> Optional[timedelta]:
    if rule == "immediately":
        return timedelta(0)
    if rule == "24_hours_before":
        return timedelta(hours=24)
    if rule == "3_hours_before":
        return timedelta(hours=3)
    if rule == "custom" and custom_minutes > 0:
        return timedelta(minutes=custom_minutes)
    return None


def compute_send_at(scheduled_at: datetime, timing_rule: str, custom_minutes: int = 0) -> datetime:
    delta = _timing_delta(timing_rule, custom_minutes)
    if delta is None:
        return scheduled_at
    return scheduled_at - delta


def normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    if digits and not digits.startswith("+"):
        return digits
    return digits.lstrip("+")


def build_whatsjet_template_variables(template: dict, context: Dict[str, str]) -> List[str]:
    """Ordered template parameter values from context keys configured on the template."""
    mapping = template.get("whatsjet_variable_mapping") or template.get("variable_mapping") or []
    if not isinstance(mapping, list):
        return []
    return [str(context.get(str(key), "") or "") for key in mapping]


async def build_message_context(
    db,
    clinic_id: str,
    *,
    booking: Optional[dict] = None,
    patient: Optional[dict] = None,
    payment_url: Optional[str] = None,
    consent_url: Optional[str] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
) -> Dict[str, str]:
    clinic = await db.clinics.find_one({"id": clinic_id}, {"_id": 0, "name": 1, "slug": 1, "phone": 1, "address": 1})
    ctx: Dict[str, str] = {
        "clinic_name": (clinic or {}).get("name") or "",
        "clinic_phone": (clinic or {}).get("phone") or "",
        "clinic_address": (clinic or {}).get("address") or "",
        "patient_name": "",
        "patient_phone": "",
        "appointment_date": "",
        "appointment_time": "",
        "treatment_name": "",
        "performer_name": "",
        "booking_status": "",
        "booking_link": "",
        "payment_link": payment_url or "",
        "consent_link": consent_url or "",
        "amount_paid": "",
        "payment_amount": "",
        "invoice_number": "",
        "gift_card_code": "",
        "gift_card_value": "",
        "package_name": "",
        "sessions_remaining": "",
        "package_balance": "",
        "wallet_balance": "",
    }
    slug = (clinic or {}).get("slug") or ""
    if slug:
        ctx["booking_link"] = f"{_public_base_url()}/book/{slug}"

    if booking:
        ctx["patient_name"] = booking.get("patient_name") or ""
        ctx["patient_phone"] = booking.get("patient_phone") or ""
        ctx["treatment_name"] = booking.get("treatment") or ""
        ctx["booking_status"] = booking.get("status") or ""
        try:
            sched = datetime.fromisoformat((booking.get("scheduled_at") or "").replace("Z", "+00:00"))
            if sched.tzinfo is None:
                sched = sched.replace(tzinfo=timezone.utc)
            ctx["appointment_date"] = sched.strftime("%d %b %Y")
            ctx["appointment_time"] = sched.strftime("%H:%M")
        except Exception:
            pass
        pid = booking.get("performer_id")
        if pid:
            perf = await db.users.find_one({"id": pid, "clinic_id": clinic_id}, {"_id": 0, "name": 1})
            ctx["performer_name"] = (perf or {}).get("name") or ""

        if not payment_url and booking.get("online_payment_id"):
            pay = await db.online_booking_payments.find_one(
                {"id": booking["online_payment_id"], "clinic_id": clinic_id, "status": "pending"},
                {"_id": 0, "payment_url": 1},
            )
            if pay:
                ctx["payment_link"] = pay.get("payment_url") or ""

    if patient:
        ctx["patient_name"] = ctx["patient_name"] or patient.get("full_name") or ""
        ctx["patient_phone"] = ctx["patient_phone"] or patient.get("phone") or ""

    if invoice:
        amt = int(invoice.get("amount_paid") or invoice.get("total_amount") or 0)
        formatted = f"Rp {amt:,}".replace(",", ".")
        ctx["amount_paid"] = formatted
        ctx["payment_amount"] = formatted
        ctx["invoice_number"] = str(invoice.get("invoice_number") or invoice.get("id") or "")

    if gift_card:
        ctx["gift_card_code"] = str(gift_card.get("code") or "")
        val = int(gift_card.get("original_value") or gift_card.get("balance_value") or 0)
        ctx["gift_card_value"] = f"Rp {val:,}".replace(",", ".")
        ctx["patient_name"] = ctx["patient_name"] or gift_card.get("recipient_name") or gift_card.get("purchaser_name") or ""
        ctx["patient_phone"] = ctx["patient_phone"] or gift_card.get("recipient_phone") or gift_card.get("purchaser_phone") or ""

    if package:
        ctx["package_name"] = str(package.get("package_name") or package.get("name") or "")
        ctx["sessions_remaining"] = str(package.get("remaining_sessions") or "")
        ctx["package_balance"] = ctx["sessions_remaining"]

    pid = (patient or {}).get("id") or (booking or {}).get("patient_id")
    if pid:
        try:
            wallet = await db.patient_wallets.find_one(
                {"clinic_id": clinic_id, "patient_id": pid},
                {"_id": 0, "balance_idr": 1},
            )
            if wallet:
                bal = int(wallet.get("balance_idr") or 0)
                ctx["wallet_balance"] = f"Rp {bal:,}".replace(",", ".")
        except Exception:
            pass

    return ctx


def _send_whatsapp_cloud(
    creds: dict,
    settings: dict,
    *,
    to_phone: str,
    message: str,
    template_name: Optional[str],
    template_language: str,
    template_params: Optional[List[str]],
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    token = creds.get("access_token") or creds.get("whatsapp_access_token") or ""
    phone_id = creds.get("phone_number_id") or settings.get("sender_phone_number") or ""
    if not token or not phone_id:
        return False, None, "WhatsApp Cloud API credentials incomplete", {}
    to = normalize_phone(to_phone)
    base = (settings.get("webhook_url") or creds.get("api_base_url") or "https://graph.facebook.com").rstrip("/")
    url = f"{base}/v18.0/{phone_id}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if template_name:
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": template_language or "id"},
            },
        }
        if template_params:
            body["template"]["components"] = [{
                "type": "body",
                "parameters": [{"type": "text", "text": p} for p in template_params],
            }]
    else:
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": message[:4096]},
        }
    r = requests.post(url, headers=headers, json=body, timeout=30)
    data = r.json() if r.content else {}
    if r.status_code >= 400:
        return False, None, _sanitize_error(data), data
    msg_id = None
    try:
        msg_id = data.get("messages", [{}])[0].get("id")
    except Exception:
        pass
    return True, msg_id, None, data


def _send_twilio(creds: dict, settings: dict, *, to_phone: str, message: str, channel: str) -> Tuple[bool, Optional[str], Optional[str], dict]:
    sid = creds.get("account_sid") or ""
    token = creds.get("auth_token") or ""
    from_num = creds.get("from_number") or settings.get("sender_phone_number") or ""
    if not sid or not token or not from_num:
        return False, None, "Twilio credentials incomplete", {}
    to = to_phone if to_phone.startswith("+") else f"+{normalize_phone(to_phone)}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    data = {"To": to, "From": from_num, "Body": message[:1600]}
    if channel == "whatsapp":
        data["From"] = f"whatsapp:{from_num}" if not from_num.startswith("whatsapp:") else from_num
        data["To"] = f"whatsapp:{to}" if not to.startswith("whatsapp:") else to
    r = requests.post(url, auth=(sid, token), data=data, timeout=30)
    resp = r.json() if r.content else {}
    if r.status_code >= 400:
        return False, None, _sanitize_error(resp), resp
    return True, resp.get("sid"), None, resp


def send_via_provider(
    settings: dict,
    creds: dict,
    *,
    channel: str,
    recipient: str,
    message: str,
    provider_template_name: Optional[str] = None,
    provider_template_id: Optional[str] = None,
    language: str = "id",
    template_params: Optional[List[str]] = None,
    clinic_id: Optional[str] = None,
    template_key: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    contact_name: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    provider = settings.get("provider") or "none"
    tpl_name = provider_template_name or provider_template_id
    if provider == "whatsapp_cloud_api" and channel == "whatsapp":
        return _send_whatsapp_cloud(
            creds, settings, to_phone=recipient, message=message,
            template_name=tpl_name, template_language=language, template_params=template_params,
        )
    if provider == "twilio" and channel in ("whatsapp", "sms"):
        return _send_twilio(creds, settings, to_phone=recipient, message=message, channel=channel)
    if provider == "whatsjet" and channel == "whatsapp":
        from whatsjet_adapter import send_whatsjet_message, send_whatsjet_template_message

        wj_template = (tpl_name or "").strip()
        if wj_template:
            return send_whatsjet_template_message(
                clinic_id=clinic_id or "",
                to_phone=recipient,
                template_name=wj_template,
                language=language or "id",
                variable_values=list(template_params or []),
                settings=settings,
                creds=creds,
            )
        return send_whatsjet_message(
            clinic_id=clinic_id or "",
            to_phone=recipient,
            message_body=message,
            settings=settings,
            creds=creds,
            template_key=template_key or tpl_name,
            reference_type=reference_type,
            reference_id=reference_id,
            contact_name=contact_name,
        )
    return False, None, f"Provider {provider} not configured for channel {channel}", {}


async def load_messaging_settings(db, clinic_id: str) -> dict:
    s = await db.settings.find_one({"id": "global", "clinic_id": clinic_id}, {"_id": 0})
    return merge_messaging_settings((s or {}).get("clinic_messaging"))


async def save_messaging_settings(db, clinic_id: str, settings: dict) -> None:
    await db.settings.update_one(
        {"id": "global", "clinic_id": clinic_id},
        {"$set": {"clinic_messaging": settings}},
        upsert=True,
    )


async def ensure_default_templates(db, clinic_id: str) -> None:
    n = await db.messaging_templates.count_documents({"clinic_id": clinic_id})
    if n:
        return
    now = iso(now_utc())
    for t in DEFAULT_MESSAGING_TEMPLATES:
        doc = {**t, "id": str(uuid.uuid4()), "clinic_id": clinic_id, "created_at": now, "updated_at": now}
        await db.messaging_templates.insert_one(doc)


async def cancel_booking_reminders(db, clinic_id: str, booking_id: str) -> int:
    now = iso(now_utc())
    r = await db.message_logs.update_many(
        {
            "clinic_id": clinic_id,
            "booking_id": booking_id,
            "status": "queued",
            "template_type": {"$in": ["booking_reminder"]},
        },
        {"$set": {"status": "cancelled", "updated_at": now, "error_message": "Booking changed"}},
    )
    return r.modified_count


async def create_message_log(
    db,
    *,
    clinic_id: str,
    template: dict,
    recipient: str,
    rendered: str,
    provider: str,
    channel: str,
    patient_id: Optional[str],
    booking_id: Optional[str],
    visit_id: Optional[str],
    send_at: Optional[datetime],
    status: str = "queued",
    skip_reason: Optional[str] = None,
    invoice_id: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    whatsjet_variable_values: Optional[List[str]] = None,
) -> dict:
    now = iso(now_utc())
    template_key = template.get("template_type") or template.get("template_key")
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "booking_id": booking_id,
        "visit_id": visit_id,
        "invoice_id": invoice_id,
        "template_id": template.get("id"),
        "template_type": template.get("template_type"),
        "template_key": template_key,
        "provider": provider,
        "channel": channel,
        "recipient": recipient,
        "to_phone": recipient,
        "rendered_message": rendered,
        "rendered_body_snapshot": rendered,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "whatsjet_variable_values": whatsjet_variable_values,
        "status": status,
        "skip_reason": skip_reason,
        "provider_message_id": None,
        "error_message": None,
        "send_at": iso(send_at) if send_at else now,
        "sent_at": None,
        "delivered_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.message_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def create_skipped_log(
    db,
    *,
    clinic_id: str,
    template: dict,
    recipient: str,
    rendered: str,
    provider: str,
    channel: str,
    patient_id: Optional[str],
    booking_id: Optional[str],
    visit_id: Optional[str],
    skip_reason: str,
) -> dict:
    return await create_message_log(
        db,
        clinic_id=clinic_id,
        template=template,
        recipient=recipient or "—",
        rendered=rendered,
        provider=provider,
        channel=channel,
        patient_id=patient_id,
        booking_id=booking_id,
        visit_id=visit_id,
        send_at=now_utc(),
        status="skipped",
        skip_reason=skip_reason,
    )


def _meta_template_required(template: dict, provider: str) -> bool:
    """Meta Cloud API needs approved templates for scheduled/reminder sends."""
    if provider != "whatsapp_cloud_api":
        return False
    if template.get("provider_template_name") or template.get("provider_template_id"):
        return False
    timing = template.get("timing_rule") or "immediately"
    return timing != "immediately" or template.get("template_type") == "booking_reminder"


async def _automation_precheck(
    settings: dict,
    creds: dict,
    *,
    template: dict,
    recipient: str,
) -> Optional[str]:
    """Return skip_reason if automation cannot send, else None."""
    if not settings.get("enable_messaging"):
        return "messaging_disabled"
    if not is_automation_active(settings, creds):
        return "provider_not_connected"
    if not recipient:
        return "no_recipient"
    if not template.get("active", True):
        return "template_inactive"
    provider = settings.get("provider") or "none"
    if _meta_template_required(template, provider):
        return "meta_template_missing"
    return None


async def dispatch_message(db, log: dict, settings: dict, creds: dict, template: dict) -> None:
    """Attempt send; update log. Never raises to caller."""
    now = iso(now_utc())
    channel = log.get("channel") or "whatsapp"
    body = log.get("rendered_message") or log.get("rendered_body_snapshot") or ""
    provider = settings.get("provider") or "none"
    wj_template_name = (template.get("provider_template_name") or "").strip()
    params: Optional[List[str]] = log.get("whatsjet_variable_values")
    if provider == "whatsjet" and wj_template_name and params is None:
        params = build_whatsjet_template_variables(template, {})
        if not params and body:
            params = [body]

    try:
        ok, msg_id, err, _raw = await asyncio.to_thread(
            send_via_provider,
            settings,
            creds,
            channel=channel,
            recipient=log.get("recipient") or log.get("to_phone") or "",
            message=body,
            provider_template_name=wj_template_name or None,
            provider_template_id=template.get("provider_template_id"),
            language=template.get("language") or "id",
            template_params=params,
            clinic_id=log.get("clinic_id"),
            template_key=log.get("template_key") or template.get("template_type"),
            reference_type=log.get("reference_type"),
            reference_id=log.get("reference_id") or log.get("booking_id") or log.get("visit_id") or log.get("invoice_id"),
        )
    except Exception as ex:
        ok, msg_id, err = False, None, str(ex)[:500]

    upd: Dict[str, Any] = {"updated_at": now}
    if ok:
        upd["status"] = "sent"
        upd["sent_at"] = now
        upd["provider_message_id"] = msg_id
        upd["error_message"] = None
    else:
        upd["status"] = "failed"
        upd["error_message"] = err or "Send failed"
    await db.message_logs.update_one({"id": log["id"]}, {"$set": upd})


async def process_due_messages(db, jwt_secret: str, limit: int = 50) -> int:
    """Send queued messages whose send_at has passed."""
    now_dt = now_utc()
    now = iso(now_dt)
    n = 0
    async for log in db.message_logs.find(
        {"status": "queued", "send_at": {"$lte": now}},
        {"_id": 0},
    ).sort("send_at", 1).limit(limit):
        settings = await load_messaging_settings(db, log["clinic_id"])
        creds = get_provider_credentials(jwt_secret, log["clinic_id"], settings)
        if not settings.get("enable_messaging"):
            await db.message_logs.update_one(
                {"id": log["id"]},
                {"$set": {
                    "status": "skipped",
                    "skip_reason": "messaging_disabled",
                    "updated_at": now,
                    "error_message": "Messaging disabled",
                }},
            )
            continue
        if not is_automation_active(settings, creds):
            await db.message_logs.update_one(
                {"id": log["id"]},
                {"$set": {
                    "status": "skipped",
                    "skip_reason": "provider_not_connected",
                    "updated_at": now,
                    "error_message": "WhatsApp API provider not connected",
                }},
            )
            continue
        enc = settings.get("provider_credentials_encrypted")
        if not enc:
            await db.message_logs.update_one(
                {"id": log["id"]},
                {"$set": {
                    "status": "skipped",
                    "skip_reason": "provider_not_connected",
                    "updated_at": now,
                    "error_message": "No credentials",
                }},
            )
            continue
        template = {}
        if log.get("template_id"):
            template = await db.messaging_templates.find_one(
                {"id": log["template_id"], "clinic_id": log["clinic_id"]},
                {"_id": 0},
            ) or {}
        booking = None
        if log.get("booking_id"):
            booking = await db.bookings.find_one(
                {"id": log["booking_id"], "clinic_id": log["clinic_id"]},
                {"_id": 0, "status": 1, "scheduled_at": 1},
            )
            if booking and booking.get("status") in ("cancelled", "payment_expired", "payment_failed"):
                await db.message_logs.update_one(
                    {"id": log["id"]},
                    {"$set": {"status": "cancelled", "updated_at": now, "error_message": "Booking no longer active"}},
                )
                continue
        try:
            creds = decrypt_credentials(jwt_secret, log["clinic_id"], enc)
        except HTTPException:
            await db.message_logs.update_one(
                {"id": log["id"]},
                {"$set": {
                    "status": "skipped",
                    "skip_reason": "provider_not_connected",
                    "updated_at": now,
                    "error_message": "Credential decrypt failed",
                }},
            )
            continue
        if template:
            skip = await _automation_precheck(settings, creds, template=template, recipient=log.get("recipient") or "")
            if skip:
                await db.message_logs.update_one(
                    {"id": log["id"]},
                    {"$set": {"status": "skipped", "skip_reason": skip, "updated_at": now, "error_message": skip}},
                )
                continue
        await dispatch_message(db, log, settings, creds, template)
        n += 1
    return n


async def trigger_booking_messaging(
    db,
    jwt_secret: str,
    clinic_id: str,
    booking: dict,
    event: str,
    *,
    payment_url: Optional[str] = None,
    consent_url: Optional[str] = None,
) -> None:
    """Fire-and-forget style: schedule/send messages for a booking event. Never raises."""
    try:
        from messaging_automation import BOOKING_EVENT_TRIGGERS, legacy_should_skip, trigger_automation_rules_for_event

        event_triggers = {
            "confirmed": "booking_confirmed",
            "cancelled": "booking_cancelled",
            "consent_link": "consent_required_missing",
        }
        auto_trigger = event_triggers.get(event)
        if auto_trigger:
            await trigger_automation_rules_for_event(
                db, jwt_secret, clinic_id, auto_trigger,
                booking=booking, payment_url=payment_url, consent_url=consent_url,
            )
        if await legacy_should_skip(db, clinic_id, BOOKING_EVENT_TRIGGERS.get(event, [])):
            return

        settings = await load_messaging_settings(db, clinic_id)
        creds = get_provider_credentials(jwt_secret, clinic_id, settings)
        automation_on = is_automation_active(settings, creds)
        await ensure_default_templates(db, clinic_id)
        if not settings.get("enable_messaging"):
            return

        if event in ("cancelled", "rescheduled"):
            await cancel_booking_reminders(db, clinic_id, booking.get("id") or "")

        type_map = {
            "confirmed": "booking_confirmation",
            "cancelled": "booking_cancelled",
            "rescheduled": "booking_rescheduled",
            "payment_pending": "payment_link",
            "consent_link": "consent_link",
        }
        template_type = type_map.get(event)
        if not template_type:
            return

        flt: Dict[str, Any] = {
            "clinic_id": clinic_id,
            "template_type": template_type,
            "active": True,
        }
        if event == "payment_pending":
            flt["template_type"] = "payment_link"

        templates = await db.messaging_templates.find(flt, {"_id": 0}).to_list(20)
        if not templates:
            return

        patient = None
        if booking.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": booking["patient_id"], "clinic_id": clinic_id},
                {"_id": 0},
            )
        ctx = await build_message_context(
            db, clinic_id, booking=booking, patient=patient, payment_url=payment_url, consent_url=consent_url,
        )
        recipient = normalize_phone(ctx.get("patient_phone") or booking.get("patient_phone") or "")
        provider = settings.get("provider") or "none"

        for tpl in templates:
            if tpl.get("channel") not in MESSAGING_CHANNELS:
                continue
            rendered = render_message(tpl.get("message_body") or "", ctx)
            skip_reason = await _automation_precheck(settings, creds, template=tpl, recipient=recipient)
            if skip_reason:
                if settings.get("enable_messaging") and not automation_on:
                    await create_skipped_log(
                        db,
                        clinic_id=clinic_id,
                        template=tpl,
                        recipient=recipient,
                        rendered=rendered,
                        provider=provider,
                        channel=tpl.get("channel") or "whatsapp",
                        patient_id=booking.get("patient_id"),
                        booking_id=booking.get("id"),
                        visit_id=None,
                        skip_reason=skip_reason,
                    )
                continue
            if not recipient:
                continue
            timing = tpl.get("timing_rule") or "immediately"
            custom_min = int(tpl.get("timing_custom_minutes") or 0)
            send_at = now_utc()
            if tpl.get("template_type") == "booking_reminder" and booking.get("scheduled_at"):
                try:
                    sched = datetime.fromisoformat(booking["scheduled_at"].replace("Z", "+00:00"))
                    if sched.tzinfo is None:
                        sched = sched.replace(tzinfo=timezone.utc)
                    send_at = compute_send_at(sched, timing, custom_min)
                except Exception:
                    pass
            elif timing != "immediately":
                delta = _timing_delta(timing, custom_min)
                if delta:
                    send_at = now_utc() + timedelta(0)  # noqa — immediate for non-reminder types

            wj_vars = None
            if (tpl.get("provider_template_name") or "").strip():
                wj_vars = build_whatsjet_template_variables(tpl, ctx)
            log = await create_message_log(
                db,
                clinic_id=clinic_id,
                template=tpl,
                recipient=recipient,
                rendered=rendered,
                provider=provider,
                channel=tpl.get("channel") or "whatsapp",
                patient_id=booking.get("patient_id"),
                booking_id=booking.get("id"),
                visit_id=None,
                send_at=send_at,
                status="queued",
                reference_type="booking",
                reference_id=booking.get("id"),
                whatsjet_variable_values=wj_vars,
            )
            if send_at <= now_utc():
                await dispatch_message(db, log, settings, creds, tpl)

        if event == "confirmed":
            reminder_tpls = await db.messaging_templates.find(
                {
                    "clinic_id": clinic_id,
                    "template_type": "booking_reminder",
                    "active": True,
                },
                {"_id": 0},
            ).to_list(10)
            for tpl in reminder_tpls:
                if not booking.get("scheduled_at"):
                    continue
                try:
                    sched = datetime.fromisoformat(booking["scheduled_at"].replace("Z", "+00:00"))
                    if sched.tzinfo is None:
                        sched = sched.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                timing = tpl.get("timing_rule") or "24_hours_before"
                send_at = compute_send_at(sched, timing, int(tpl.get("timing_custom_minutes") or 0))
                if send_at <= now_utc():
                    continue
                rendered = render_message(tpl.get("message_body") or "", ctx)
                skip_reason = await _automation_precheck(settings, creds, template=tpl, recipient=recipient)
                if skip_reason:
                    if settings.get("enable_messaging") and not automation_on:
                        await create_skipped_log(
                            db,
                            clinic_id=clinic_id,
                            template=tpl,
                            recipient=recipient,
                            rendered=rendered,
                            provider=provider,
                            channel=tpl.get("channel") or "whatsapp",
                            patient_id=booking.get("patient_id"),
                            booking_id=booking.get("id"),
                            visit_id=None,
                            skip_reason=skip_reason,
                        )
                    continue
                if not recipient:
                    continue
                wj_vars = None
                if (tpl.get("provider_template_name") or "").strip():
                    wj_vars = build_whatsjet_template_variables(tpl, ctx)
                log = await create_message_log(
                    db,
                    clinic_id=clinic_id,
                    template=tpl,
                    recipient=recipient,
                    rendered=rendered,
                    provider=provider,
                    channel=tpl.get("channel") or "whatsapp",
                    patient_id=booking.get("patient_id"),
                    booking_id=booking.get("id"),
                    visit_id=None,
                    send_at=send_at,
                    reference_type="booking",
                    reference_id=booking.get("id"),
                    whatsjet_variable_values=wj_vars,
                )
    except Exception:
        logger.exception("trigger_booking_messaging failed clinic=%s booking=%s", clinic_id, booking.get("id"))


async def trigger_messaging_event(
    db,
    jwt_secret: str,
    clinic_id: str,
    template_type: str,
    *,
    patient: Optional[dict] = None,
    recipient: Optional[str] = None,
    booking: Optional[dict] = None,
    invoice: Optional[dict] = None,
    gift_card: Optional[dict] = None,
    package: Optional[dict] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    invoice_id: Optional[str] = None,
    payment_url: Optional[str] = None,
    consent_url: Optional[str] = None,
) -> None:
    """Send or skip a non-booking messaging event. Never raises."""
    try:
        from messaging_automation import MESSAGING_EVENT_TRIGGERS, legacy_should_skip, trigger_automation_rules_for_event

        auto_triggers = MESSAGING_EVENT_TRIGGERS.get(template_type, [])
        for trig in auto_triggers:
            await trigger_automation_rules_for_event(
                db, jwt_secret, clinic_id, trig,
                booking=booking, patient=patient, invoice=invoice,
                gift_card=gift_card, package=package,
                payment_url=payment_url, consent_url=consent_url,
            )
        if await legacy_should_skip(db, clinic_id, auto_triggers):
            return

        settings = await load_messaging_settings(db, clinic_id)
        creds = get_provider_credentials(jwt_secret, clinic_id, settings)
        automation_on = is_automation_active(settings, creds)
        await ensure_default_templates(db, clinic_id)
        if not settings.get("enable_messaging"):
            return

        templates = await db.messaging_templates.find(
            {"clinic_id": clinic_id, "template_type": template_type, "active": True},
            {"_id": 0},
        ).to_list(5)
        if not templates:
            return

        if patient is None and booking and booking.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": booking["patient_id"], "clinic_id": clinic_id},
                {"_id": 0},
            )
        if patient is None and invoice and invoice.get("patient_id"):
            patient = await db.patients.find_one(
                {"id": invoice["patient_id"], "clinic_id": clinic_id},
                {"_id": 0},
            )

        ctx = await build_message_context(
            db,
            clinic_id,
            booking=booking,
            patient=patient,
            payment_url=payment_url,
            consent_url=consent_url,
            invoice=invoice,
            gift_card=gift_card,
            package=package,
        )
        phone = normalize_phone(
            recipient or ctx.get("patient_phone") or (patient or {}).get("phone") or ""
        )
        provider = settings.get("provider") or "none"
        ref_type = reference_type or template_type
        ref_id = reference_id or (invoice or {}).get("id") or (gift_card or {}).get("id") or (package or {}).get("id")

        for tpl in templates:
            if tpl.get("channel") not in MESSAGING_CHANNELS:
                continue
            rendered = render_message(tpl.get("message_body") or "", ctx)
            skip_reason = await _automation_precheck(settings, creds, template=tpl, recipient=phone)
            if skip_reason:
                if settings.get("enable_messaging") and not automation_on:
                    await create_skipped_log(
                        db,
                        clinic_id=clinic_id,
                        template=tpl,
                        recipient=phone,
                        rendered=rendered,
                        provider=provider,
                        channel=tpl.get("channel") or "whatsapp",
                        patient_id=(patient or {}).get("id") or (booking or {}).get("patient_id"),
                        booking_id=(booking or {}).get("id"),
                        visit_id=None,
                        skip_reason=skip_reason,
                    )
                continue
            if not phone:
                continue
            wj_vars = None
            if (tpl.get("provider_template_name") or "").strip():
                wj_vars = build_whatsjet_template_variables(tpl, ctx)
            log = await create_message_log(
                db,
                clinic_id=clinic_id,
                template=tpl,
                recipient=phone,
                rendered=rendered,
                provider=provider,
                channel=tpl.get("channel") or "whatsapp",
                patient_id=(patient or {}).get("id") or (booking or {}).get("patient_id"),
                booking_id=(booking or {}).get("id"),
                visit_id=None,
                send_at=now_utc(),
                status="queued",
                invoice_id=invoice_id or (invoice or {}).get("id"),
                reference_type=ref_type,
                reference_id=ref_id,
                whatsjet_variable_values=wj_vars,
            )
            await dispatch_message(db, log, settings, creds, tpl)
    except Exception:
        logger.exception(
            "trigger_messaging_event failed clinic=%s type=%s",
            clinic_id,
            template_type,
        )


def safe_trigger_messaging_event(db, jwt_secret: str, clinic_id: str, template_type: str, **kwargs) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(trigger_messaging_event(db, jwt_secret, clinic_id, template_type, **kwargs))
    except RuntimeError:
        asyncio.run(trigger_messaging_event(db, jwt_secret, clinic_id, template_type, **kwargs))


def safe_trigger_booking_messaging(db, jwt_secret: str, clinic_id: str, booking: dict, event: str, **kwargs) -> None:
    """Schedule async trigger without blocking request handlers."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(trigger_booking_messaging(db, jwt_secret, clinic_id, booking, event, **kwargs))
    except RuntimeError:
        asyncio.run(trigger_booking_messaging(db, jwt_secret, clinic_id, booking, event, **kwargs))


# ---------- API models ----------

class MessagingSettingsIn(BaseModel):
    enable_messaging: bool = False
    provider: str = "none"
    sender_name: Optional[str] = ""
    sender_phone_number: Optional[str] = ""
    webhook_url: Optional[str] = ""
    access_token: Optional[str] = None
    phone_number_id: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    account_sid: Optional[str] = None
    auth_token: Optional[str] = None
    from_number: Optional[str] = None
    vendor_uid: Optional[str] = None
    send_message_path: Optional[str] = None
    whatsjet_test_path: Optional[str] = None
    send_template_path: Optional[str] = None
    whatsjet_payload_style: Optional[str] = None
    webhook_secret: Optional[str] = None
    whatsjet_use_query_token: Optional[bool] = None
    clear_credentials: bool = False
    clear_webhook_secret: bool = False


class MessagingTestSendIn(BaseModel):
    phone: str
    message: str = "ClinicOS WhatsApp test message"


class MessagingTemplateIn(BaseModel):
    template_name: str
    template_type: str
    channel: str = "whatsapp"
    message_body: str
    provider_template_name: Optional[str] = None
    provider_template_id: Optional[str] = None
    language: str = "id"
    active: bool = True
    timing_rule: str = "immediately"
    timing_custom_minutes: int = Field(0, ge=0, le=10080)
    whatsjet_variable_mapping: Optional[List[str]] = None


class MessagingSendIn(BaseModel):
    booking_id: str
    template_id: Optional[str] = None
    template_type: Optional[str] = None


class MessagingManualOpenedIn(BaseModel):
    booking_id: Optional[str] = None
    patient_id: Optional[str] = None
    channel: str = "whatsapp"
    note: Optional[str] = ""


def run_provider_connection_test(settings: dict, creds: dict) -> dict:
    provider = settings.get("provider") or "none"
    if provider == "whatsapp_cloud_api":
        token = creds.get("access_token") or ""
        phone_id = creds.get("phone_number_id") or settings.get("sender_phone_number") or ""
        if not token or not phone_id:
            raise HTTPException(status_code=400, detail="Access token and phone number ID required")
        base = (settings.get("webhook_url") or creds.get("api_base_url") or "https://graph.facebook.com").rstrip("/")
        r = requests.get(f"{base}/v18.0/{phone_id}", params={"access_token": token}, timeout=15)
        if r.status_code == 401:
            raise HTTPException(status_code=400, detail="WhatsApp access token rejected")
        return {"ok": True, "provider": provider, "http_status": r.status_code}
    if provider == "twilio":
        sid = creds.get("account_sid") or ""
        token = creds.get("auth_token") or ""
        if not sid or not token:
            raise HTTPException(status_code=400, detail="Twilio account SID and auth token required")
        r = requests.get(f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json", auth=(sid, token), timeout=15)
        if r.status_code == 401:
            raise HTTPException(status_code=400, detail="Twilio credentials rejected")
        return {"ok": True, "provider": provider}
    if provider == "whatsjet":
        from whatsjet_adapter import test_whatsjet_connection

        try:
            return test_whatsjet_connection(settings, creds)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex
    raise HTTPException(status_code=400, detail="Select a provider to test")


def register_messaging(api: APIRouter, db, get_current_user, audit, jwt_secret: str, assert_feature=None):
    """Wire messaging settings, templates, logs, and send APIs."""

    async def _require_automation(user: dict) -> None:
        if assert_feature:
            await assert_feature(user, "whatsapp_automation")

    async def _manage_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if not user_has_permission(user, "messaging.manage") and user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Messaging settings access required")
        await _require_automation(user)
        return user

    async def _send_dep(user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "messaging.send") and not user_has_permission(user, "messaging.manage"):
            if user.get("role") not in ("super_admin", "manager", "fo"):
                raise HTTPException(status_code=403, detail="Not allowed to send messages")
        await _require_automation(user)
        return user

    async def _view_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if not user_has_permission(user, "messaging.manage") and not user_has_permission(user, "messaging.send"):
            if user.get("role") not in ("super_admin", "manager", "fo"):
                raise HTTPException(status_code=403, detail="Not allowed")
        await _require_automation(user)
        return user

    @api.get("/settings/messaging")
    async def get_messaging_settings(user: dict = Depends(_view_dep)):
        cid = user["clinic_id"]
        sdoc = await db.settings.find_one({"id": "global", "clinic_id": cid}, {"_id": 0})
        merged = merge_messaging_settings((sdoc or {}).get("clinic_messaging"))
        enc = merged.get("provider_credentials_encrypted")
        creds = get_provider_credentials(jwt_secret, cid, merged) if enc else {}
        out = dict(merged)
        out.pop("provider_credentials_encrypted", None)
        return sanitize_settings_admin(out, has_credentials=bool(enc), creds=creds)

    @api.put("/settings/messaging")
    async def update_messaging_settings(payload: MessagingSettingsIn, user: dict = Depends(_manage_dep)):
        if payload.provider not in MESSAGING_PROVIDERS:
            raise HTTPException(status_code=400, detail="Invalid provider")
        cid = user["clinic_id"]
        sdoc = await db.settings.find_one({"id": "global", "clinic_id": cid}, {"_id": 0})
        existing = merge_messaging_settings((sdoc or {}).get("clinic_messaging"))
        enc = existing.get("provider_credentials_encrypted")
        if payload.clear_credentials:
            enc = None
        else:
            creds: Dict[str, str] = {}
            if enc:
                creds = decrypt_credentials(jwt_secret, cid, enc)
            if payload.access_token:
                if payload.provider == "whatsjet":
                    creds["api_access_token"] = payload.access_token.strip()
                else:
                    creds["access_token"] = payload.access_token.strip()
            if payload.phone_number_id:
                creds["phone_number_id"] = payload.phone_number_id.strip()
            if payload.api_key:
                creds["api_access_token"] = payload.api_key.strip()
            if payload.api_base_url:
                creds["api_base_url"] = payload.api_base_url.strip()
            if payload.vendor_uid:
                creds["vendor_uid"] = payload.vendor_uid.strip()
            if payload.send_message_path:
                creds["send_message_path"] = payload.send_message_path.strip()
            if payload.send_template_path:
                creds["send_template_path"] = payload.send_template_path.strip()
            if payload.whatsjet_payload_style:
                creds["payload_style"] = payload.whatsjet_payload_style.strip()
            if payload.whatsjet_test_path:
                creds["test_connection_path"] = payload.whatsjet_test_path.strip()
            if payload.webhook_secret:
                creds["webhook_secret"] = payload.webhook_secret.strip()
            if payload.clear_webhook_secret:
                creds.pop("webhook_secret", None)
            if payload.whatsjet_use_query_token is not None:
                creds["use_query_token"] = bool(payload.whatsjet_use_query_token)
            if payload.account_sid:
                creds["account_sid"] = payload.account_sid.strip()
            if payload.auth_token:
                creds["auth_token"] = payload.auth_token.strip()
            if payload.from_number:
                creds["from_number"] = payload.from_number.strip()
            if creds:
                enc = encrypt_credentials(jwt_secret, cid, creds)
        saved = {
            "enable_messaging": payload.enable_messaging,
            "provider": payload.provider,
            "sender_name": (payload.sender_name or "").strip(),
            "sender_phone_number": (payload.sender_phone_number or "").strip(),
            "webhook_url": (payload.webhook_url or "").strip(),
            "provider_credentials_encrypted": enc,
            "whatsjet_api_base_url": (payload.api_base_url or existing.get("whatsjet_api_base_url") or "").strip(),
            "whatsjet_vendor_uid": (payload.vendor_uid or existing.get("whatsjet_vendor_uid") or "").strip(),
            "whatsjet_send_path": (
                (payload.send_message_path or existing.get("whatsjet_send_path") or "/api/{vendor_uid}/contact/send-message").strip()
            ),
            "whatsjet_test_path": (
                (payload.whatsjet_test_path or existing.get("whatsjet_test_path") or "/api/{vendor_uid}/contact/contacts").strip()
            ),
            "whatsjet_send_template_path": (
                (
                    payload.send_template_path
                    or existing.get("whatsjet_send_template_path")
                    or "/api/{vendor_uid}/contact/send-template-message"
                ).strip()
            ),
            "whatsjet_payload_style": (
                (payload.whatsjet_payload_style or existing.get("whatsjet_payload_style") or "standard").strip()
            ),
        }
        if payload.provider == "whatsjet" and payload.api_base_url:
            saved["whatsjet_api_base_url"] = payload.api_base_url.strip()
        if saved["enable_messaging"]:
            if not is_api_capable_provider(saved["provider"]):
                raise HTTPException(
                    status_code=400,
                    detail="Automated messaging requires a WhatsApp API provider (Meta Cloud API, WhatsJet, or BSP). "
                    "Manual WhatsApp is available from booking and patient pages without enabling automation.",
                )
            creds_check = get_provider_credentials(jwt_secret, cid, {**saved, "provider_credentials_encrypted": enc})
            complete, missing = credentials_complete(saved["provider"], creds_check, saved)
            if not complete:
                saved["connection_status"] = "not_connected"
                saved["last_connection_error"] = missing or "Credentials incomplete"
            elif existing.get("connection_status") == "connected":
                saved["connection_status"] = "connected"
            else:
                saved["connection_status"] = "not_connected"
                saved["last_connection_error"] = "Run Test connection after saving credentials"
        else:
            saved["connection_status"] = "disabled"
            saved["last_connection_error"] = ""
        await save_messaging_settings(db, cid, saved)
        audit_meta: Dict[str, Any] = {"enabled": saved["enable_messaging"], "provider": saved["provider"]}
        cred_fields: List[str] = []
        if payload.access_token or payload.api_key:
            cred_fields.append("api_access_token")
        if payload.webhook_secret:
            cred_fields.append("webhook_secret")
        if payload.vendor_uid:
            cred_fields.append("vendor_uid")
        if payload.api_base_url:
            cred_fields.append("api_base_url")
        if payload.send_message_path:
            cred_fields.append("send_message_path")
        if payload.send_template_path:
            cred_fields.append("send_template_path")
        if payload.clear_credentials:
            cred_fields.append("cleared")
        if cred_fields:
            audit_meta["credential_fields"] = cred_fields
            await audit(user, "update", "messaging_credentials", cid, audit_meta)
        await audit(user, "update", "messaging_settings", cid, audit_meta)
        creds_out = get_provider_credentials(jwt_secret, cid, saved) if enc else {}
        out = dict(saved)
        out.pop("provider_credentials_encrypted", None)
        return sanitize_settings_admin(out, has_credentials=bool(enc), creds=creds_out)

    @api.post("/settings/messaging/test-connection")
    async def test_messaging_connection_endpoint(user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        settings = await load_messaging_settings(db, cid)
        enc = settings.get("provider_credentials_encrypted")
        if not enc:
            raise HTTPException(status_code=400, detail="Save credentials first")
        if not is_api_capable_provider(settings.get("provider")):
            raise HTTPException(status_code=400, detail="Select an API-capable provider to test")
        creds = decrypt_credentials(jwt_secret, cid, enc)
        now = iso(now_utc())
        try:
            result = run_provider_connection_test(settings, creds)
            settings["connection_status"] = "connected"
            settings["last_connection_error"] = ""
            settings["last_connection_test_at"] = now
            await save_messaging_settings(db, cid, settings)
            return {**result, "connection_status": "connected", "automation_active": True}
        except HTTPException as ex:
            settings["connection_status"] = "error"
            settings["last_connection_error"] = str(ex.detail)[:500]
            settings["last_connection_test_at"] = now
            await save_messaging_settings(db, cid, settings)
            raise

    @api.post("/settings/messaging/test-send")
    async def test_messaging_send(payload: MessagingTestSendIn, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        settings = await load_messaging_settings(db, cid)
        creds = get_provider_credentials(jwt_secret, cid, settings)
        if not is_automation_active(settings, creds):
            raise HTTPException(status_code=400, detail="Connect and test WhatsJet before sending a test message")
        if (settings.get("provider") or "") != "whatsjet":
            raise HTTPException(status_code=400, detail="Test send is configured for WhatsJet provider")
        phone = normalize_phone(payload.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Valid phone number required")
        tpl = {
            "id": None,
            "template_type": "custom",
            "template_key": "custom",
            "channel": "whatsapp",
        }
        log = await create_message_log(
            db,
            clinic_id=cid,
            template=tpl,
            recipient=phone,
            rendered=payload.message,
            provider="whatsjet",
            channel="whatsapp",
            patient_id=None,
            booking_id=None,
            visit_id=None,
            send_at=now_utc(),
            status="queued",
            reference_type="test_send",
            reference_id=user.get("id"),
        )
        await dispatch_message(db, log, settings, creds, tpl)
        updated = await db.message_logs.find_one({"id": log["id"]}, {"_id": 0})
        return updated

    @api.post("/messaging/webhook/whatsjet")
    async def whatsjet_webhook(
        request: Request,
        clinic_id: Optional[str] = Query(None),
    ):
        """WhatsJet delivery/status webhooks — no auth user; optional clinic_id + webhook secret."""
        from whatsjet_adapter import (
            extract_meta_webhook_inbound_messages,
            extract_meta_webhook_status_updates,
            extract_webhook_error_message,
            extract_webhook_message_id,
            map_whatsjet_webhook_status,
            sanitize_webhook_payload,
            verify_whatsjet_webhook_secret,
        )

        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {"raw": str(payload)[:500]}

        provided_secret = (
            request.headers.get("X-Webhook-Secret")
            or request.headers.get("X-Whatsjet-Webhook-Secret")
            or (request.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        )

        target_cid = clinic_id
        if target_cid:
            settings = await load_messaging_settings(db, target_cid)
            if (settings.get("provider") or "") != "whatsjet":
                raise HTTPException(status_code=404, detail="Clinic not configured for WhatsJet")
            creds = get_provider_credentials(jwt_secret, target_cid, settings)
            from whatsjet_adapter import whatsjet_settings_bundle

            bundle = whatsjet_settings_bundle(settings, creds)
            if not verify_whatsjet_webhook_secret(provided_secret, bundle.get("webhook_secret")):
                raise HTTPException(status_code=403, detail="Invalid webhook secret")
        elif provided_secret:
            target_cid = None
            async for row in db.settings.find(
                {"clinic_messaging.provider": "whatsjet"},
                {"_id": 0, "clinic_id": 1, "clinic_messaging": 1},
            ):
                cid_row = row.get("clinic_id")
                if not cid_row:
                    continue
                settings = merge_messaging_settings(row.get("clinic_messaging"))
                creds = get_provider_credentials(jwt_secret, cid_row, settings)
                from whatsjet_adapter import whatsjet_settings_bundle

                bundle = whatsjet_settings_bundle(settings, creds)
                if verify_whatsjet_webhook_secret(provided_secret, bundle.get("webhook_secret")):
                    target_cid = cid_row
                    break
            if not target_cid:
                raise HTTPException(status_code=403, detail="Invalid webhook secret")

        now = iso(now_utc())
        summary = sanitize_webhook_payload(payload)
        status_updates = extract_meta_webhook_status_updates(payload)
        if not status_updates:
            msg_id = extract_webhook_message_id(payload)
            new_status = map_whatsjet_webhook_status(payload)
            if msg_id:
                status_updates = [{
                    "message_id": msg_id,
                    "status": new_status or payload.get("status"),
                    "error_message": extract_webhook_error_message(payload),
                }]

        updated = 0
        for st in status_updates:
            msg_id = st.get("message_id")
            if not msg_id:
                continue
            new_status = map_whatsjet_webhook_status({"status": st.get("status")})
            if not new_status:
                continue
            flt: Dict[str, Any] = {"provider_message_id": str(msg_id), "provider": "whatsjet"}
            if target_cid:
                flt["clinic_id"] = target_cid
            upd: Dict[str, Any] = {"updated_at": now, "webhook_summary": summary}
            upd["status"] = new_status
            if new_status == "delivered":
                upd["delivered_at"] = now
            if new_status == "sent":
                upd["sent_at"] = now
            if new_status == "failed":
                err = st.get("error_message") or extract_webhook_error_message(payload)
                if err:
                    upd["error_message"] = err
            result = await db.message_logs.update_one(flt, {"$set": upd})
            updated += int(result.modified_count)

        inbound = extract_meta_webhook_inbound_messages(payload)
        if inbound and target_cid:
            for msg in inbound[:5]:
                await db.message_logs.insert_one({
                    "id": str(uuid.uuid4()),
                    "clinic_id": target_cid,
                    "template_type": "inbound",
                    "provider": "whatsjet",
                    "channel": "whatsapp",
                    "recipient": msg.get("from") or "—",
                    "rendered_message": f"Inbound {msg.get('type') or 'message'}",
                    "status": "delivered",
                    "provider_message_id": msg.get("message_id"),
                    "webhook_summary": sanitize_webhook_payload(msg),
                    "created_at": now,
                    "updated_at": now,
                    "send_at": now,
                })

        if updated:
            return {"ok": True, "updated": updated}
        return {"ok": True, "updated": 0, "note": "No matching message log"}

    @api.get("/messaging/templates")
    async def list_templates(user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "messaging.manage") and user.get("role") not in ("super_admin", "manager", "fo"):
            raise HTTPException(status_code=403, detail="Not allowed")
        cid = user["clinic_id"]
        await ensure_default_templates(db, cid)
        rows = await db.messaging_templates.find({"clinic_id": cid}, {"_id": 0}).sort("template_name", 1).to_list(200)
        settings = await load_messaging_settings(db, cid)
        creds = get_provider_credentials(jwt_secret, cid, settings)
        automation_active = is_automation_active(settings, creds)
        return {
            "items": rows,
            "automation_active": automation_active,
            "connection_status": compute_connection_status(settings, creds),
        }

    @api.post("/messaging/templates")
    async def create_template(payload: MessagingTemplateIn, user: dict = Depends(_manage_dep)):
        if payload.template_type not in TEMPLATE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid template_type")
        if payload.channel not in MESSAGING_CHANNELS:
            raise HTTPException(status_code=400, detail="Invalid channel")
        if payload.timing_rule not in TIMING_RULES:
            raise HTTPException(status_code=400, detail="Invalid timing_rule")
        cid = user["clinic_id"]
        now = iso(now_utc())
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            **payload.model_dump(),
            "created_at": now,
            "updated_at": now,
        }
        await db.messaging_templates.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "messaging_template", doc["id"], {"type": payload.template_type})
        return doc

    @api.put("/messaging/templates/{tid}")
    async def update_template(tid: str, payload: MessagingTemplateIn, user: dict = Depends(_manage_dep)):
        if payload.template_type not in TEMPLATE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid template_type")
        cid = user["clinic_id"]
        upd = {**payload.model_dump(), "updated_at": iso(now_utc())}
        r = await db.messaging_templates.update_one({"id": tid, "clinic_id": cid}, {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Template not found")
        return await db.messaging_templates.find_one({"id": tid, "clinic_id": cid}, {"_id": 0})

    @api.delete("/messaging/templates/{tid}")
    async def delete_template(tid: str, user: dict = Depends(_manage_dep)):
        cid = user["clinic_id"]
        r = await db.messaging_templates.delete_one({"id": tid, "clinic_id": cid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Template not found")
        await audit(user, "delete", "messaging_template", tid, {})
        return {"ok": True}

    @api.get("/messaging/logs")
    async def list_message_logs(
        status: Optional[str] = None,
        booking_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        if not user_has_permission(user, "messaging.view") and not user_has_permission(user, "messaging.send"):
            if user.get("role") not in ("super_admin", "manager", "fo"):
                raise HTTPException(status_code=403, detail="Not allowed")
        flt: Dict[str, Any] = {"clinic_id": user["clinic_id"]}
        if status:
            flt["status"] = status
        if booking_id:
            flt["booking_id"] = booking_id
        rows = await db.message_logs.find(flt, {"_id": 0}).sort("created_at", -1).to_list(300)
        summary: Dict[str, int] = {}
        for row in rows:
            summary[row.get("status") or "unknown"] = summary.get(row.get("status") or "unknown", 0) + 1
        return {"items": rows, "summary": summary, "count": len(rows)}

    @api.post("/messaging/send")
    async def send_message_manual(payload: MessagingSendIn, user: dict = Depends(_send_dep)):
        cid = user["clinic_id"]
        booking = await db.bookings.find_one({"id": payload.booking_id, "clinic_id": cid}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        settings = await load_messaging_settings(db, cid)
        creds = get_provider_credentials(jwt_secret, cid, settings)
        if not is_automation_active(settings, creds):
            raise HTTPException(
                status_code=400,
                detail="WhatsApp API provider is not connected. Use Copy / Open WhatsApp for manual send, or connect a provider in Messaging settings.",
            )
        flt: Dict[str, Any] = {"clinic_id": cid, "active": True}
        if payload.template_id:
            flt["id"] = payload.template_id
        elif payload.template_type:
            flt["template_type"] = payload.template_type
        else:
            raise HTTPException(status_code=400, detail="template_id or template_type required")
        tpl = await db.messaging_templates.find_one(flt, {"_id": 0})
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")
        ctx = await build_message_context(db, cid, booking=booking)
        recipient = normalize_phone(ctx.get("patient_phone") or "")
        if not recipient:
            raise HTTPException(status_code=400, detail="Patient phone required")
        rendered = render_message(tpl.get("message_body") or "", ctx)
        skip = await _automation_precheck(settings, creds, template=tpl, recipient=recipient)
        if skip:
            raise HTTPException(status_code=400, detail=f"Cannot send: {skip}")
        log = await create_message_log(
            db,
            clinic_id=cid,
            template=tpl,
            recipient=recipient,
            rendered=rendered,
            provider=settings.get("provider") or "none",
            channel=tpl.get("channel") or "whatsapp",
            patient_id=booking.get("patient_id"),
            booking_id=booking.get("id"),
            visit_id=None,
            send_at=now_utc(),
            status="queued",
        )
        await dispatch_message(db, log, settings, creds, tpl)
        updated = await db.message_logs.find_one({"id": log["id"]}, {"_id": 0})
        await audit(user, "send", "message_log", log["id"], {"booking_id": payload.booking_id})
        return updated

    @api.post("/messaging/process-due")
    async def process_due(user: dict = Depends(_manage_dep)):
        n = await process_due_messages(db, jwt_secret)
        return {"processed": n}

    @api.post("/messaging/manual-opened")
    async def log_manual_whatsapp_opened(payload: MessagingManualOpenedIn, user: dict = Depends(_send_dep)):
        """Record manual wa.me / copy — does not require messaging automation."""
        cid = user["clinic_id"]
        booking = None
        if payload.booking_id:
            booking = await db.bookings.find_one({"id": payload.booking_id, "clinic_id": cid}, {"_id": 0})
        patient = None
        pid = payload.patient_id or (booking or {}).get("patient_id")
        if pid:
            patient = await db.patients.find_one({"id": pid, "clinic_id": cid}, {"_id": 0})
        phone = normalize_phone((patient or {}).get("phone") or (booking or {}).get("patient_phone") or "")
        now = iso(now_utc())
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "patient_id": pid,
            "booking_id": payload.booking_id,
            "visit_id": None,
            "template_id": None,
            "template_type": "manual",
            "provider": "manual_fallback",
            "channel": payload.channel if payload.channel in MESSAGING_CHANNELS else "whatsapp",
            "recipient": phone or "—",
            "rendered_message": (payload.note or "Manual WhatsApp opened")[:500],
            "status": "manual_opened",
            "skip_reason": None,
            "provider_message_id": None,
            "error_message": None,
            "send_at": now,
            "sent_at": None,
            "delivered_at": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.message_logs.insert_one(doc)
        doc.pop("_id", None)
        return doc

    from messaging_automation import register_messaging_automation

    register_messaging_automation(api, db, get_current_user, audit, jwt_secret, assert_feature=assert_feature)

    return api
