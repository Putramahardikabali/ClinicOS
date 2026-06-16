"""Whatsgo integration — unit tests with mocked HTTP."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

JWT_SECRET = "test-jwt-secret-change-me"


def _whatsgo_settings():
    from messaging import DEFAULT_CLINIC_MESSAGING

    return {
        **DEFAULT_CLINIC_MESSAGING,
        "enable_messaging": True,
        "provider": "whatsgo",
        "whatsgo_workspace_id": "ws-123",
        "whatsgo_base_url": "https://whatsgo.test",
        "connection_status": "connected",
        "whatsgo_connection_status": "connected",
    }


def _whatsgo_creds():
    return {
        "integration_token": "test-integration-token",
        "workspace_id": "ws-123",
        "api_base_url": "https://whatsgo.test",
    }


def test_default_paths_use_clinicos_integration_api():
    from whatsgo_adapter import default_whatsgo_paths

    paths = default_whatsgo_paths()
    assert paths["health"] == "/api/integrations/clinicos/health"
    assert paths["contacts"] == "/api/integrations/clinicos/contacts/upsert"
    assert paths["templates"] == "/api/integrations/clinicos/templates"
    assert paths["send_template"] == "/api/integrations/clinicos/messages/send-template"
    assert paths["message_logs"] == "/api/integrations/clinicos/messages/logs"


def test_patient_to_whatsgo_contact_mapping():
    from whatsgo_service import patient_to_whatsgo_contact

    patient = {
        "id": "p1",
        "full_name": "Jane Doe",
        "phone": "08123456789",
        "email": "jane@example.com",
        "preferred_language": "id",
        "nationality": "Indonesia",
        "patient_source": "instagram",
    }
    contact = patient_to_whatsgo_contact(patient, clinic_id="c1")
    assert contact["external_patient_id"] == "p1"
    assert contact["name"] == "Jane Doe"
    assert contact["metadata"]["source"] == "clinicos"
    assert contact["metadata"]["clinic_id"] == "c1"
    assert contact["patient_source"] == "instagram"


@patch("whatsgo_adapter.requests.request")
def test_test_whatsgo_connection_success(mock_request):
    from whatsgo_adapter import test_whatsgo_connection

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = json.dumps({
        "ok": True,
        "workspace_id": "ws-123",
        "workspace_name": "Demo Clinic",
        "connected_phone_number": "+628123456789",
    }).encode()
    mock_response.json.return_value = {
        "ok": True,
        "workspace_id": "ws-123",
        "workspace_name": "Demo Clinic",
        "connected_phone_number": "+628123456789",
    }
    mock_request.return_value = mock_response

    result = test_whatsgo_connection(_whatsgo_settings(), _whatsgo_creds())
    assert result["ok"] is True
    assert result["workspace_name"] == "Demo Clinic"
    assert result["connected_phone_number"] == "+628123456789"
    called_url = mock_request.call_args[0][1]
    assert called_url.endswith("/api/integrations/clinicos/health")
    headers = mock_request.call_args[1]["headers"]
    assert headers["Authorization"] == "Bearer test-integration-token"


@patch("whatsgo_adapter.requests.request")
def test_test_whatsgo_connection_invalid_token(mock_request):
    from whatsgo_adapter import test_whatsgo_connection

    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.content = b'{"detail":"Invalid token"}'
    mock_response.json.return_value = {"detail": "Invalid token"}
    mock_request.return_value = mock_response

    with pytest.raises(ValueError, match="Invalid token"):
        test_whatsgo_connection(_whatsgo_settings(), _whatsgo_creds())


@patch("whatsgo_adapter.requests.request")
def test_upsert_whatsgo_contact_parses_conversation_url(mock_request):
    from whatsgo_adapter import upsert_whatsgo_contact

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"{}"
    mock_response.json.return_value = {
        "contact_id": "ct-1",
        "conversation_id": "conv-1",
        "open_conversation_url": "https://whatsgo.test/inbox/conv-1",
    }
    mock_request.return_value = mock_response

    ok, parsed, err = upsert_whatsgo_contact(
        clinic_id="c1",
        settings=_whatsgo_settings(),
        creds=_whatsgo_creds(),
        contact={"external_patient_id": "p1", "name": "Jane", "phone": "628123"},
    )
    assert ok is True
    assert err is None
    assert parsed["contact_id"] == "ct-1"
    assert parsed["open_conversation_url"] == "https://whatsgo.test/inbox/conv-1"


@patch("whatsgo_adapter.requests.request")
def test_send_whatsgo_template_message(mock_request):
    from whatsgo_adapter import send_whatsgo_template_message

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"{}"
    mock_response.json.return_value = {
        "whatsgo_message_id": "msg-99",
        "open_conversation_url": "https://whatsgo.test/inbox/conv-1",
    }
    mock_request.return_value = mock_response

    ok, msg_id, err, raw = send_whatsgo_template_message(
        clinic_id="c1",
        to_phone="08123456789",
        template_name="booking_confirmation",
        language="id",
        variable_values=["Jane", "Clinic"],
        settings=_whatsgo_settings(),
        creds=_whatsgo_creds(),
        patient_id="p1",
    )
    assert ok is True
    assert err is None
    assert msg_id == "msg-99"
    assert raw["open_conversation_url"] == "https://whatsgo.test/inbox/conv-1"
    body = mock_request.call_args[1]["json"]
    assert body["template_name"] == "booking_confirmation"
    assert body["external_patient_id"] == "p1"


def test_should_skip_duplicate_sync():
    from whatsgo_service import patient_to_whatsgo_contact, should_skip_duplicate_sync, _contact_fingerprint

    patient = {
        "id": "p1",
        "full_name": "Jane",
        "phone": "628123",
        "whatsgo_sync_status": "ok",
    }
    contact = patient_to_whatsgo_contact(patient, clinic_id="c1")
    assert should_skip_duplicate_sync(patient, contact) is False

    patient["whatsgo_sync_fingerprint"] = _contact_fingerprint(contact)
    assert should_skip_duplicate_sync(patient, contact) is True


def test_automation_skipped_when_whatsgo_sending_disabled():
    import asyncio
    from unittest.mock import AsyncMock
    from messaging_automation import process_automation_run

    db = MagicMock()
    db.automation_runs = MagicMock()
    db.automation_runs.update_one = AsyncMock(return_value=None)
    db.messaging_automation_rules = MagicMock()
    db.messaging_automation_rules.update_one = AsyncMock(return_value=None)

    run = {"id": "run-1", "clinic_id": "c1", "reference_type": "booking", "reference_id": "b1"}
    rule = {
        "id": "rule-1",
        "trigger_type": "booking_created",
        "timing_type": "immediately",
        "whatsjet_template_name": "confirm",
        "language_code": "id",
        "variable_mapping": ["patient_name"],
        "enabled": True,
        "conditions": {},
    }

    settings = {
        "enable_messaging": True,
        "provider": "whatsgo",
        "whatsgo_automation_sending_enabled": False,
        "provider_credentials_encrypted": "enc",
    }

    with patch("messaging.load_messaging_settings", new=AsyncMock(return_value=settings)), \
         patch("messaging.get_provider_credentials", return_value=_whatsgo_creds()):
        asyncio.run(process_automation_run(
            db, JWT_SECRET, run, rule,
            booking={"id": "b1", "patient_phone": "628123", "patient_name": "Jane"},
            patient={"id": "p1", "phone": "628123", "full_name": "Jane"},
        ))

    db.automation_runs.update_one.assert_called()
    call_args = db.automation_runs.update_one.call_args[0][1]["$set"]
    assert call_args["skip_reason"] == "whatsgo_automation_disabled"
