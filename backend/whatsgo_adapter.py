"""Whatsgo integration adapter — ClinicOS talks to Whatsgo, not raw Meta/WhatsApp APIs."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

SENSITIVE_LOG_KEYS = frozenset({
    "token", "access_token", "api_key", "integration_token", "authorization", "password", "secret",
})


def _env_path(key: str, default: str) -> str:
    return (os.environ.get(key) or default).strip()


def default_whatsgo_paths() -> Dict[str, str]:
    return {
        "health": _env_path("WHATSGO_HEALTH_PATH", "/api/integrations/clinicos/health"),
        "contacts": _env_path("WHATSGO_CONTACTS_PATH", "/api/integrations/clinicos/contacts/upsert"),
        "templates": _env_path("WHATSGO_TEMPLATES_PATH", "/api/integrations/clinicos/templates"),
        "send_template": _env_path("WHATSGO_SEND_TEMPLATE_PATH", "/api/integrations/clinicos/messages/send-template"),
        "message_logs": _env_path("WHATSGO_MESSAGE_LOGS_PATH", "/api/integrations/clinicos/messages/logs"),
    }


def default_whatsgo_base_url() -> str:
    return (os.environ.get("WHATSGO_DEFAULT_BASE_URL") or os.environ.get("WHATSGO_API_BASE_URL") or "").strip().rstrip("/")


def whatsgo_settings_bundle(settings: dict, creds: dict) -> dict:
    base = (
        (settings.get("whatsgo_base_url") or "").strip()
        or (creds.get("api_base_url") or "").strip()
        or default_whatsgo_base_url()
    )
    workspace_id = (settings.get("whatsgo_workspace_id") or creds.get("workspace_id") or "").strip()
    token = (creds.get("integration_token") or creds.get("api_key") or creds.get("api_access_token") or "").strip()
    paths = default_whatsgo_paths()
    for key in paths:
        override = (settings.get(f"whatsgo_path_{key}") or creds.get(f"path_{key}") or "").strip()
        if override:
            paths[key] = override
    return {
        "api_base_url": base.rstrip("/"),
        "workspace_id": workspace_id,
        "workspace_name": (settings.get("whatsgo_workspace_name") or "").strip(),
        "integration_token": token,
        "paths": paths,
        "webhook_secret": (settings.get("whatsgo_webhook_secret") or creds.get("webhook_secret") or "").strip(),
        "inbox_url": (settings.get("whatsgo_inbox_url") or "").strip().rstrip("/"),
    }


def whatsgo_credentials_complete(bundle: dict) -> Tuple[bool, Optional[str]]:
    if not bundle.get("api_base_url"):
        return False, "Whatsgo API base URL required"
    if not bundle.get("workspace_id"):
        return False, "Whatsgo Workspace ID required"
    if not bundle.get("integration_token"):
        return False, "Whatsgo integration token required"
    return True, None


def _format_path(path_template: str, workspace_id: str) -> str:
    path = (path_template or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    if "{workspace_id}" in path:
        path = path.replace("{workspace_id}", workspace_id)
    return path


def build_whatsgo_url(bundle: dict, *, path_key: str) -> str:
    base = bundle["api_base_url"].rstrip("/")
    path_tpl = bundle["paths"].get(path_key) or ""
    return f"{base}{_format_path(path_tpl, bundle['workspace_id'])}"


def _auth_headers(bundle: dict) -> Dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if bundle.get("integration_token"):
        headers["Authorization"] = f"Bearer {bundle['integration_token']}"
    return headers


def _redact_for_log(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: "***" if str(k).lower() in SENSITIVE_LOG_KEYS else _redact_for_log(v)
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact_for_log(x) for x in data[:20]]
    return data


def _sanitize_error(data: Any) -> str:
    if isinstance(data, dict):
        msg = data.get("message") or data.get("detail") or data.get("error") or data.get("msg")
        if not msg:
            msg = str(data)
    else:
        msg = str(data)
    return str(msg)[:500]


def _extract_message_id(data: dict) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    for key in ("whatsgo_message_id", "provider_message_id", "message_id", "wamid", "id", "msg_id"):
        val = data.get(key)
        if val:
            return str(val)
    nested = data.get("data")
    if isinstance(nested, dict):
        return _extract_message_id(nested)
    return None


def _extract_open_conversation_url(data: dict) -> str:
    if not isinstance(data, dict):
        return ""
    for key in ("open_conversation_url", "conversation_url", "inbox_url"):
        val = data.get(key)
        if val:
            return str(val).strip()
    nested = data.get("data")
    if isinstance(nested, dict):
        return _extract_open_conversation_url(nested)
    return ""


def _parse_upsert_response(data: dict) -> dict:
    if not isinstance(data, dict):
        return {}
    nested = data.get("data") if isinstance(data.get("data"), dict) else data
    return {
        "contact_id": str(nested.get("contact_id") or nested.get("id") or ""),
        "conversation_id": str(nested.get("conversation_id") or ""),
        "open_conversation_url": _extract_open_conversation_url(nested),
    }


def normalize_whatsgo_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    return digits


def _request(
    bundle: dict,
    method: str,
    url: str,
    *,
    clinic_id: str,
    action: str,
    json_body: Optional[dict] = None,
    params: Optional[dict] = None,
) -> Tuple[bool, Any, Optional[str]]:
    headers = _auth_headers(bundle)
    try:
        r = requests.request(method, url, headers=headers, json=json_body, params=params, timeout=30)
    except requests.RequestException as ex:
        logger.warning("Whatsgo %s failed clinic=%s error=%s", action, clinic_id, str(ex)[:200])
        return False, {}, str(ex)[:500]
    try:
        data = r.json() if r.content else {}
    except Exception:
        data = {"raw": (r.text or "")[:500]}
    if r.status_code >= 400:
        return False, _redact_for_log(data), _sanitize_error(data)
    return True, data, None


def test_whatsgo_connection(settings: dict, creds: dict) -> dict:
    bundle = whatsgo_settings_bundle(settings, creds)
    ok, err = whatsgo_credentials_complete(bundle)
    if not ok:
        raise ValueError(err)
    url = build_whatsgo_url(bundle, path_key="health")
    success, data, api_err = _request(bundle, "GET", url, clinic_id="", action="health")
    if not success:
        raise ValueError(api_err or "Connection test failed")
    if isinstance(data, dict) and data.get("ok") is False:
        raise ValueError(_sanitize_error(data) or "Connection test failed")
    workspace_id = ""
    workspace_name = ""
    phone = ""
    if isinstance(data, dict):
        workspace_id = str(data.get("workspace_id") or bundle.get("workspace_id") or "")
        workspace_name = str(data.get("workspace_name") or data.get("name") or bundle.get("workspace_name") or "")
        phone = str(
            data.get("connected_phone_number")
            or data.get("phone_number")
            or data.get("whatsapp_number")
            or ""
        )
    return {
        "ok": True,
        "provider": "whatsgo",
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "connected_phone_number": phone,
        "raw": _redact_for_log(data),
    }


def upsert_whatsgo_contact(
    *,
    clinic_id: str,
    settings: dict,
    creds: dict,
    contact: dict,
) -> Tuple[bool, dict, Optional[str]]:
    bundle = whatsgo_settings_bundle(settings, creds)
    ok, err = whatsgo_credentials_complete(bundle)
    if not ok:
        return False, {}, err
    url = build_whatsgo_url(bundle, path_key="contacts")
    success, data, api_err = _request(
        bundle, "POST", url, clinic_id=clinic_id, action="upsert-contact", json_body=contact,
    )
    if not success:
        return False, {}, api_err
    parsed = _parse_upsert_response(data if isinstance(data, dict) else {})
    return True, parsed, None


def list_whatsgo_templates(settings: dict, creds: dict) -> Tuple[bool, List[dict], Optional[str]]:
    bundle = whatsgo_settings_bundle(settings, creds)
    ok, err = whatsgo_credentials_complete(bundle)
    if not ok:
        return False, [], err
    url = build_whatsgo_url(bundle, path_key="templates")
    success, data, api_err = _request(bundle, "GET", url, clinic_id="", action="list-templates")
    if not success:
        return False, [], api_err
    items = []
    if isinstance(data, dict):
        raw = data.get("items") or data.get("templates") or data.get("data") or []
        if isinstance(raw, list):
            items = raw
    elif isinstance(data, list):
        items = data
    return True, items, None


def get_whatsgo_message_logs(
    settings: dict,
    creds: dict,
    *,
    limit: int = 100,
    patient_id: Optional[str] = None,
) -> Tuple[bool, List[dict], Optional[str]]:
    bundle = whatsgo_settings_bundle(settings, creds)
    ok, err = whatsgo_credentials_complete(bundle)
    if not ok:
        return False, [], err
    url = build_whatsgo_url(bundle, path_key="message_logs")
    params: Dict[str, Any] = {"limit": min(max(1, limit), 300)}
    if patient_id:
        params["external_patient_id"] = patient_id
    success, data, api_err = _request(
        bundle, "GET", url, clinic_id="", action="message-logs", params=params,
    )
    if not success:
        return False, [], api_err
    items = []
    if isinstance(data, dict):
        raw = data.get("items") or data.get("logs") or data.get("data") or []
        if isinstance(raw, list):
            items = raw
    elif isinstance(data, list):
        items = data
    return True, items, None


def send_whatsgo_template_message(
    *,
    clinic_id: str,
    to_phone: str,
    template_name: str,
    language: str,
    variable_values: List[str],
    settings: dict,
    creds: dict,
    patient_id: Optional[str] = None,
    external_reference_type: Optional[str] = None,
    external_reference_id: Optional[str] = None,
    variable_mapping: Optional[List[str]] = None,
) -> Tuple[bool, Optional[str], Optional[str], dict]:
    bundle = whatsgo_settings_bundle(settings, creds)
    ok, err = whatsgo_credentials_complete(bundle)
    if not ok:
        return False, None, err, {}
    phone = normalize_whatsgo_phone(to_phone)
    if not phone:
        return False, None, "Invalid phone number", {}
    url = build_whatsgo_url(bundle, path_key="send_template")
    body: Dict[str, Any] = {
        "phone_number": phone,
        "template_name": template_name,
        "language": (language or "id").strip() or "id",
        "variables": list(variable_values or []),
    }
    if patient_id:
        body["external_patient_id"] = patient_id
    if external_reference_type:
        body["external_reference_type"] = external_reference_type
    if external_reference_id:
        body["external_reference_id"] = external_reference_id
    if variable_mapping:
        body["variable_mapping"] = list(variable_mapping)
    success, data, api_err = _request(
        bundle, "POST", url, clinic_id=clinic_id, action="send-template", json_body=body,
    )
    if not success:
        return False, None, api_err, _redact_for_log(data) if isinstance(data, dict) else {}
    payload = data if isinstance(data, dict) else {}
    msg_id = _extract_message_id(payload)
    open_url = _extract_open_conversation_url(payload)
    return True, msg_id, None, {
        **(_redact_for_log(payload) if isinstance(payload, dict) else {}),
        "open_conversation_url": open_url,
    }


def build_whatsgo_inbox_link(
    settings: dict,
    creds: dict,
    *,
    patient_id: Optional[str] = None,
    message_id: Optional[str] = None,
    open_conversation_url: Optional[str] = None,
) -> str:
    if open_conversation_url:
        return open_conversation_url.strip()
    bundle = whatsgo_settings_bundle(settings, creds)
    base = bundle.get("inbox_url") or ""
    if not base and bundle.get("api_base_url"):
        base = f"{bundle['api_base_url']}/inbox"
    if not base:
        return ""
    if message_id:
        return f"{base}/messages/{message_id}"
    if patient_id:
        return f"{base}/contacts?external_patient_id={patient_id}"
    return base


def verify_whatsgo_webhook_secret(settings: dict, creds: dict, provided: str) -> bool:
    expected = whatsgo_settings_bundle(settings, creds).get("webhook_secret") or ""
    if not expected:
        return True
    return bool(provided) and provided.strip() == expected.strip()
