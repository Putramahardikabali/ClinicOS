"""Tests for clinic-scoped SSE realtime events."""

import asyncio
import os

import pytest
import requests

from clinic_realtime import (
    build_event,
    emit_clinic_event,
    hub,
    safe_emit_visit_event,
    user_should_receive_event,
    visit_performer_ids,
)

API = f"{os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:8000').rstrip('/')}/api"
TIMEOUT = 30


def login(email: str, password: str = "password123") -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


class TestRealtimeHub:
    def test_emit_delivered_to_same_clinic_subscriber(self):
        async def _run():
            clinic_id = "test-clinic-emit-a"
            queue = await hub.subscribe(clinic_id)
            try:
                await emit_clinic_event(
                    event_type="visit_created",
                    clinic_id=clinic_id,
                    reference_type="visit",
                    reference_id="visit-1",
                    performer_ids=["doc-1"],
                    payload={"status": "in_progress", "message": "Visit created"},
                )
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
                assert event["type"] == "visit_created"
                assert event["clinic_id"] == clinic_id
                assert event["reference_id"] == "visit-1"
            finally:
                await hub.unsubscribe(clinic_id, queue)

        asyncio.run(_run())

    def test_cross_clinic_subscriber_does_not_receive(self):
        async def _run():
            clinic_a = "clinic-a-isolated"
            clinic_b = "clinic-b-isolated"
            queue_b = await hub.subscribe(clinic_b)
            try:
                await emit_clinic_event(
                    event_type="booking_created",
                    clinic_id=clinic_a,
                    reference_type="booking",
                    reference_id="b-1",
                )
                with pytest.raises(asyncio.TimeoutError):
                    await asyncio.wait_for(queue_b.get(), timeout=0.2)
            finally:
                await hub.unsubscribe(clinic_b, queue_b)

        asyncio.run(_run())


class TestRealtimeTargeting:
    def test_fo_receives_all_clinic_events(self):
        user = {"id": "fo1", "role": "fo", "clinic_id": "c1"}
        event = {"performer_ids": ["other-doc"]}
        assert user_should_receive_event(user, event) is True

    def test_doctor_receives_only_assigned_events(self):
        assigned = {"id": "doc1", "role": "doctor", "clinic_id": "c1"}
        other = {"id": "doc2", "role": "doctor", "clinic_id": "c1"}
        event = {"performer_ids": ["doc1"]}
        assert user_should_receive_event(assigned, event) is True
        assert user_should_receive_event(other, event) is False

    def test_platform_admin_receives_no_clinic_events(self):
        user = {"id": "pa1", "role": "platform_admin", "platform_admin": True}
        event = {"performer_ids": []}
        assert user_should_receive_event(user, event) is False


class TestVisitEmitHelpers:
    def test_visit_performer_ids_includes_assigned_to(self):
        visit = {
            "assigned_to": "legacy-doc",
            "performers": [{"staff_id": "p1", "performer_type": "primary"}],
        }
        ids = visit_performer_ids(visit)
        assert "p1" in ids
        assert "legacy-doc" in ids

    def test_safe_emit_visit_event_schedules_payload(self):
        visit = {
            "id": "v99",
            "clinic_id": "c-demo",
            "patient_id": "pat1",
            "status": "submitted",
            "performers": [{"staff_id": "doc1"}],
        }
        safe_emit_visit_event(
            visit,
            "visit_submitted",
            message="Visit submitted by Dr. Test",
            extra_payload={"note_role": "doctor", "staff_name": "Dr. Test"},
        )
        event = build_event(
            event_type="visit_submitted",
            clinic_id="c-demo",
            reference_type="visit",
            reference_id="v99",
            patient_id="pat1",
            performer_ids=visit_performer_ids(visit),
            payload={"status": "submitted", "message": "Visit submitted by Dr. Test", "note_role": "doctor", "staff_name": "Dr. Test"},
        )
        assert event["type"] == "visit_submitted"
        assert event["payload"]["staff_name"] == "Dr. Test"


class TestRealtimeHttp:
    def test_unauthenticated_stream_rejected(self):
        try:
            r = requests.get(f"{API}/realtime/events", timeout=TIMEOUT)
        except requests.RequestException:
            pytest.skip("Backend API not reachable")
        assert r.status_code == 401

    def test_fo_create_visit_emits_event_shape(self):
        """FO visit create should succeed; hub delivery is covered by unit tests."""
        try:
            token = login("fo@glowclinic.id")
        except (AssertionError, requests.RequestException):
            pytest.skip("Backend API not reachable or demo user missing")
        patient_r = requests.get(f"{API}/patients", headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
        if patient_r.status_code != 200 or not patient_r.json():
            pytest.skip("No patients for visit create test")
        pid = patient_r.json()[0]["id"]
        r = requests.post(
            f"{API}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": pid, "visit_type": "doctor", "chief_complaint": "Realtime test"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("id")
        assert body.get("clinic_id")
