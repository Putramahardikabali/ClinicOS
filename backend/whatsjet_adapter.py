"""WhatsJet Account Access API adapter for ClinicOS messaging."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

DEFAULT_WHATSJET_SEND_PATH = "/api/{vendor_uid}/contact/send-message"
DEFAULT_WHATSJET_TEMPLATE_PATH = "/api/{vendor_uid}/contact/send-template-message"
DEFAULT_WHATSJET_TEST_PATH = "/api/{vendor_uid}/contact/contacts"

SENSITIVE_LOG_KEYS = frozenset({
    "token", "access_token", "api_key", "api_access_token", "authorization", "password", "secret",
})

PAYLOAD_STYLES = frozenset({"standard", "language_code", "components"})


def _redact_for_log(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: "***" if str(k).lower() in SENSITIVE_LOG_KEYS else _redact_for_log(v)
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact_for_log(x) for x in data[:20]]
    return data


def whatsjet_settings_bundle(settings: dict, creds: dict) -> dict:
    """Merge non-secret settings with decrypted credentials (in-memory only)."""
    base = (settings.get("whatsjet_api_base_url") or creds.get("api_base_url") or settings.get("webhook_url") or "").strip()
    vendor_uid = (settings.get("whatsjet_vendor_uid") or creds.get("vendor_uid") or "").strip()
    token = (creds.get("api_access_token") or creds.get("access_token") or creds.get("api_key") or "").strip()
    send_path = (settings.get("whatsjet_send_path") or creds.get("send_message_path") or DEFAULT_WHATSJET_SEND_PATH).strip()
    template_path = (
        settings.get("whatsjet_send_template_path")
        or creds.get("send_template_path")
        or DEFAULT_WHATSJET_TEMPLATE_PATH
    ).strip()
    test_path = (settings.get("whatsjet_test_path") or creds.get("test_connection_path") or DEFAULT_WHATSJET_TEST_PATH).strip()
    webhook_secret = (settings.get("whatsjet_webhook_secret") or creds.get("webhook_secret") or "").strip()
    use_query_token = bool(settings.get("whatsjet_use_query_token") or creds.get("use_query_token"))
    payload_style = (settings.get("whatsjet_payload_style") or creds.get("payload_style") or "standard").strip().lower()
    if payload_style not in PAYLOAD_STYLES:
        payload_style = "standard"
    return {
        "api_base_url": base.rstrip("/"),
        "vendor_uid": vendor_uid,
        "api_access_token": token,
        "send_path": send_path,
        "template_path": template_path,
        "test_path": test_path,
        "webhook_secret": webhook_secret,
        "use_query_token": use_query_token,
        "payload_style": payload_style,
    }


def whatsjet_credentials_complete(bundle: dict) -> Tuple[bool, Optional[str]]:
    if not bundle.get("api_base_url"):
        return False, "API Base URL required"
    if not bundle.get("vendor_uid"):
        return False, "Vendor UID required"
    if not bundle.get("api_access_token"):
        return False, "API Access Token required"
    if not bundle.get("send_path"):
        return False, "Send message endpoint path required"
    return True, None


def _format_path(path_template: str, vendor_uid: str) -> str:
    path = (path_template or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    return path.replace("{vendor_uid}", vendor_uid).replace("{vendorUid}", vendor_uid)


def build_whatsjet_url(bundle: dict, *, path_template: str) -> str:
    base = bundle["api_base_url"].rstrip("/")
    path = _format_path(path_template, bundle["vendor_uid"])
    return f"{base}{path}"


def _auth_headers(bundle: dict) -> Dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if bundle.get("api_access_token") and not bundle.get("use_query_token"):
        headers["Authorization"] = f"Bearer {bundle['api_access_token']}"
    return headers


def _auth_query(bundle: dict, extra: Optional[dict] = None) -> dict:
    q = dict(extra or {})
    if bundle.get("use_query_token") and bundle.get("api_access_token"):
        q["token"] = bundle["api_access_token"]
    return q


def _sanitize_error(data: Any) -> str:
    if isinstance(data, dict):
        msg = data.get("message") or data.get("detail") or data.get("error") or data.get("msg")
        if isinstance(msg, dict):
            msg = msg.get("message") or str(msg)
        if not msg and data.get("errors"):
            errs = data.get("errors")
            if isinstance(errs, list) and errs:
                parts = []
                for e in errs[:3]:
                    if isinstance(e, dict):
                        parts.append(str(e.get("title") or e.get("message") or e.get("code") or e))
                    else:
                        parts.append(str(e))
                msg = "; ".join(parts)
            else:
                msg = str(errs)[:300]
        if not msg:
            msg = str(data)
    else:
        msg = str(data)
    return str(msg)[:500]


def _extract_message_id(data: dict) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    for key in ("provider_message_id", "message_id", "wamid", "id", "msg_id"):
        val = data.get(key)
        if val:
            return str(val)
    nested = data.get("data")
    if isinstance(nested, dict):
        mid = nested.get("message_id") or nested.get("id") or nested.get("wamid")
        if mid:
            return str(mid)
        messages = nested.get("messages")
        if isinstance(messages, list) and messages and isinstance(messages[0], dict):
            mid = messages[0].get("id")
            if mid:
                return str(mid)
        return _extract_message_id(nested)
    if isinstance(nested, list) and nested and isinstance(nested[0], dict):
        return _extract_message_id(nested[0])
    result = data.get("result")
    if isinstance(result, dict):
        return _extract_message_id(result)
    messages = data.get("messages")
    if isinstance(messages, list) and messages and isinstance(messages[0], dict):
        mid = messages[0].get("id")
        if mid:
            return str(mid)
    return None


def normalize_whatsjet_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    return digits


def validate_whatsjet_phone(digits: str) -> Tuple[bool, Optional[str]]:
    if not digits or len(digits) < 10:
        return False, "Invalid phone number"
    if digits.startswith("0"):
        return False, "Invalid phone number"
    return True, None


def _parse_api_response(
    r: requests.Response,
    data: Any,
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    summary = _redact_for_log(data) if isinstance(data, dict) else {}
    if isinstance(data, dict):
        result = str(data.get("result") or "").strip().lower()
        if result == "failed":
            return False, None, _sanitize_error(data), summary
        if result == "success" or data.get("success") is True:
            return True, _extract_message_id(data), None, summary
    if r.status_code >= 400:
        return False, None, _sanitize_error(data), summary
    if r.status_code < 400:
        msg_id = _extract_message_id(data if isinstance(data, dict) else {})
        if isinstance(data, dict) and str(data.get("result") or "").strip().lower() == "failed":
            return False, None, _sanitize_error(data), summary
        return True, msg_id, None, summary
    return False, None, _sanitize_error(data), summary


def _post_whatsjet(bundle: dict, url: str, body: dict, *, clinic_id: str, action: str) -> Tuple[bool, Optional[str], Optional[str], dict]:
    headers = _auth_headers(bundle)
    params = _auth_query(bundle)
    try:
        r = requests.post(url, headers=headers, params=params, json=body, timeout=30)
    except requests.RequestException as ex:
        logger.warning("WhatsJet %s failed clinic=%s error=%s", action, clinic_id, str(ex)[:200])
        return False, None, str(ex)[:500], {}

    try:
        data = r.json() if r.content else {}
    except Exception:
        data = {"raw": (r.text or "")[:500]}

    ok, msg_id, err, summary = _parse_api_response(r, data)
    if not ok:
        logger.warning(
            "WhatsJet %s failed clinic=%s http=%s response=%s",
            action,
            clinic_id,
            r.status_code,
            summary,
        )
        return False, None, err, summary
    logger.info("WhatsJet %s ok clinic=%s message_id=%s", action, clinic_id, msg_id or "—")
    return True, msg_id, None, summary


def send_whatsjet_message(
    *,
    clinic_id: str,
    to_phone: str,
    message_body: str,
    settings: dict,
    creds: dict,
    template_key: Optional[str] = None,
    variables: Optional[Dict[str, str]] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    contact_name: Optional[str] = None,
    to: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    """Send WhatsApp text via WhatsJet send-message endpoint."""
    _ = template_key, variables, reference_type, reference_id, contact_name
    bundle = whatsjet_settings_bundle(settings, creds)
    ok, err = whatsjet_credentials_complete(bundle)
    if not ok:
        return False, None, err, {}

    phone = normalize_whatsjet_phone(to_phone or to or "")
    valid, verr = validate_whatsjet_phone(phone)
    if not valid:
        return False, None, verr, {}

    url = build_whatsjet_url(bundle, path_template=bundle["send_path"])
    body = {
        "phone_number": phone,
        "message_body": (message_body or "")[:4096],
    }
    return _post_whatsjet(bundle, url, body, clinic_id=clinic_id, action="send-message")


def build_whatsjet_template_body(
    bundle: dict,
    *,
    phone: str,
    template_name: str,
    language: str,
    variable_values: List[str],
) -> Dict[str, Any]:
    style = bundle.get("payload_style") or "standard"
    lang = (language or "id").strip() or "id"
    if style == "language_code":
        body: Dict[str, Any] = {
            "phone_number": phone,
            "template_name": template_name,
            "language_code": lang,
            "variables": variable_values,
        }
    elif style == "components":
        body = {
            "phone_number": phone,
            "template_name": template_name,
            "language": lang,
            "components": [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": v} for v in variable_values],
                }
            ],
        }
    else:
        body = {
            "phone_number": phone,
            "template_name": template_name,
            "template_language": lang,
            "variables": variable_values,
        }
    return body


def send_whatsjet_template_message(
    *,
    clinic_id: str,
    to_phone: str,
    template_name: str,
    language: str,
    variable_values: List[str],
    settings: dict,
    creds: dict,
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    """Send approved WhatsApp template via WhatsJet send-template-message endpoint."""
    bundle = whatsjet_settings_bundle(settings, creds)
    ok, err = whatsjet_credentials_complete(bundle)
    if not ok:
        return False, None, err, {}

    phone = normalize_whatsjet_phone(to_phone)
    valid, verr = validate_whatsjet_phone(phone)
    if not valid:
        return False, None, verr, {}

    if not (template_name or "").strip():
        return False, None, "WhatsJet template name required", {}

    url = build_whatsjet_url(bundle, path_template=bundle["template_path"])
    body = build_whatsjet_template_body(
        bundle,
        phone=phone,
        template_name=template_name.strip(),
        language=language,
        variable_values=variable_values,
    )
    return _post_whatsjet(bundle, url, body, clinic_id=clinic_id, action="send-template")


def test_whatsjet_connection(settings: dict, creds: dict) -> dict:
    """Validate config; optionally probe test path (404 on some installs is OK)."""
    bundle = whatsjet_settings_bundle(settings, creds)
    ok, err = whatsjet_credentials_complete(bundle)
    if not ok:
        raise ValueError(err or "WhatsJet credentials incomplete")

    test_path = (bundle.get("test_path") or "").strip()
    if not test_path:
        return {"ok": True, "provider": "whatsjet", "mode": "credentials_only"}

    url = build_whatsjet_url(bundle, path_template=test_path)
    headers = _auth_headers(bundle)
    params = _auth_query(bundle, {"page": 1, "per_page": 1, "limit": 1})

    r = requests.get(url, headers=headers, params=params, timeout=15)
    if r.status_code == 401:
        raise ValueError("WhatsJet API access token rejected")
    if r.status_code == 404:
        return {"ok": True, "provider": "whatsjet", "http_status": 404, "mode": "credentials_only"}
    if r.status_code >= 400:
        try:
            data = r.json()
        except Exception:
            data = {"detail": r.text[:300]}
        raise ValueError(_sanitize_error(data))
    return {"ok": True, "provider": "whatsjet", "http_status": r.status_code, "mode": "http_probe"}


def sanitize_webhook_payload(payload: dict) -> dict:
    """Store a small summary only — no tokens, minimal message content."""
    if not isinstance(payload, dict):
        return {"summary": str(payload)[:200]}
    out: Dict[str, Any] = {}
    for key in (
        "event", "type", "status", "message_status", "delivery_status",
        "message_id", "wamid", "id", "from", "to", "timestamp", "error",
    ):
        if key in payload and payload[key] is not None:
            val = payload[key]
            if isinstance(val, (str, int, float, bool)):
                out[key] = val if not isinstance(val, str) else val[:200]
    if payload.get("data") and isinstance(payload["data"], dict):
        out["data"] = sanitize_webhook_payload(payload["data"])
    return out


def _sanitize_status_error(errors: Any) -> Optional[str]:
    if not errors:
        return None
    if isinstance(errors, list) and errors:
        e0 = errors[0]
        if isinstance(e0, dict):
            code = e0.get("code")
            title = e0.get("title") or e0.get("message")
            if code and title:
                return f"{code}: {title}"[:500]
            return str(title or code or e0)[:500]
    return str(errors)[:500]


def extract_meta_webhook_status_updates(payload: dict) -> List[Dict[str, Any]]:
    """Parse Meta Cloud API forwarded payloads (entry[].changes[].value.statuses[])."""
    updates: List[Dict[str, Any]] = []
    if not isinstance(payload, dict):
        return updates
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                continue
            value = change.get("value") or {}
            if not isinstance(value, dict):
                continue
            for st in value.get("statuses") or []:
                if not isinstance(st, dict):
                    continue
                updates.append({
                    "message_id": st.get("id"),
                    "status": st.get("status"),
                    "error_message": _sanitize_status_error(st.get("errors")),
                })
    return updates


def extract_meta_webhook_inbound_messages(payload: dict) -> List[Dict[str, Any]]:
    """Optional inbound message summaries — no patient conversation yet."""
    inbound: List[Dict[str, Any]] = []
    if not isinstance(payload, dict):
        return inbound
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            value = (change or {}).get("value") or {}
            for msg in value.get("messages") or []:
                if not isinstance(msg, dict):
                    continue
                inbound.append({
                    "message_id": msg.get("id"),
                    "from": msg.get("from"),
                    "type": msg.get("type"),
                    "timestamp": msg.get("timestamp"),
                })
    return inbound


def map_whatsjet_webhook_status(payload: dict) -> Optional[str]:
    """Map webhook payload to message_logs status (flat or Meta nested)."""
    if not isinstance(payload, dict):
        return None
    meta_updates = extract_meta_webhook_status_updates(payload)
    if meta_updates:
        return map_whatsjet_webhook_status({"status": meta_updates[0].get("status")})

    nested_status = None
    data = payload.get("data")
    if isinstance(data, dict):
        nested_status = data.get("status") or data.get("message_status")
    raw = (
        payload.get("status")
        or payload.get("message_status")
        or payload.get("delivery_status")
        or payload.get("event")
        or nested_status
    )
    if not raw:
        return None
    s = str(raw).strip().lower().replace("-", "_")
    mapping = {
        "sent": "sent",
        "delivered": "delivered",
        "read": "read",
        "failed": "failed",
        "undelivered": "failed",
        "error": "failed",
        "incoming": "delivered",
        "received": "delivered",
        "message_received": "delivered",
    }
    return mapping.get(s)


def extract_webhook_message_id(payload: dict) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    meta_updates = extract_meta_webhook_status_updates(payload)
    if meta_updates and meta_updates[0].get("message_id"):
        return str(meta_updates[0]["message_id"])
    for key in ("provider_message_id", "message_id", "wamid", "id", "msg_id"):
        if payload.get(key):
            return str(payload[key])
    if isinstance(payload.get("data"), dict):
        return extract_webhook_message_id(payload["data"])
    return None


def extract_webhook_error_message(payload: dict) -> Optional[str]:
    meta_updates = extract_meta_webhook_status_updates(payload)
    if meta_updates and meta_updates[0].get("error_message"):
        return meta_updates[0]["error_message"]
    if isinstance(payload, dict):
        return _sanitize_status_error(payload.get("errors"))
    return None


def verify_whatsjet_webhook_secret(provided: Optional[str], expected: Optional[str]) -> bool:
    if not expected:
        return True
    if not provided:
        return False
    return provided.strip() == expected.strip()
