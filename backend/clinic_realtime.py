"""Clinic-scoped realtime events (SSE) for visits, bookings, and invoices."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

OPERATIONAL_ROLES = frozenset({"super_admin", "fo", "manager", "accounting"})
CLINICAL_STAFF_ROLES = frozenset({"doctor", "therapist", "nurse"})


class ClinicRealtimeHub:
    """In-process pub/sub per clinic. Suitable for single-process deployments."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, clinic_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=128)
        async with self._lock:
            self._subscribers.setdefault(clinic_id, set()).add(queue)
        return queue

    async def unsubscribe(self, clinic_id: str, queue: asyncio.Queue) -> None:
        async with self._lock:
            subs = self._subscribers.get(clinic_id)
            if not subs:
                return
            subs.discard(queue)
            if not subs:
                del self._subscribers[clinic_id]

    async def publish(self, clinic_id: str, event: dict) -> None:
        async with self._lock:
            subs = list(self._subscribers.get(clinic_id, set()))
        for queue in subs:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass


hub = ClinicRealtimeHub()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def visit_performer_ids(visit: dict) -> List[str]:
    from performers import staff_ids_from_performers

    ids = list(staff_ids_from_performers(visit))
    assigned = visit.get("assigned_to")
    if assigned and assigned not in ids:
        ids.append(assigned)
    return ids


def booking_performer_ids(booking: dict) -> List[str]:
    from performers import staff_ids_from_performers

    return list(staff_ids_from_performers(booking))


def user_should_receive_event(user: dict, event: dict) -> bool:
    if user.get("platform_admin"):
        return False
    role = user.get("role")
    if role in OPERATIONAL_ROLES:
        return True
    if role in CLINICAL_STAFF_ROLES:
        performer_ids = event.get("performer_ids") or []
        uid = user.get("id")
        return bool(uid and uid in performer_ids)
    return True


def build_event(
    *,
    event_type: str,
    clinic_id: str,
    reference_type: str,
    reference_id: str,
    patient_id: Optional[str] = None,
    performer_ids: Optional[List[str]] = None,
    payload: Optional[dict] = None,
) -> dict:
    return {
        "type": event_type,
        "clinic_id": clinic_id,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "patient_id": patient_id,
        "performer_ids": performer_ids or [],
        "timestamp": _iso_now(),
        "payload": payload or {},
    }


async def emit_clinic_event(**kwargs: Any) -> None:
    clinic_id = kwargs.get("clinic_id")
    if not clinic_id:
        return
    event = build_event(**kwargs)
    await hub.publish(clinic_id, event)


def schedule_emit_clinic_event(**kwargs: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(emit_clinic_event(**kwargs))
    except RuntimeError:
        pass


def safe_emit_visit_event(
    visit: dict,
    event_type: str,
    *,
    message: str = "",
    extra_payload: Optional[dict] = None,
) -> None:
    clinic_id = visit.get("clinic_id")
    if not clinic_id:
        return
    payload = {"status": visit.get("status") or "", "message": message}
    if extra_payload:
        payload.update(extra_payload)
    schedule_emit_clinic_event(
        event_type=event_type,
        clinic_id=clinic_id,
        reference_type="visit",
        reference_id=visit.get("id") or "",
        patient_id=visit.get("patient_id"),
        performer_ids=visit_performer_ids(visit),
        payload=payload,
    )


def safe_emit_booking_event(
    booking: dict,
    event_type: str,
    *,
    message: str = "",
    extra_payload: Optional[dict] = None,
) -> None:
    clinic_id = booking.get("clinic_id")
    if not clinic_id:
        return
    payload = {"status": booking.get("status") or "", "message": message}
    if extra_payload:
        payload.update(extra_payload)
    schedule_emit_clinic_event(
        event_type=event_type,
        clinic_id=clinic_id,
        reference_type="booking",
        reference_id=booking.get("id") or "",
        patient_id=booking.get("patient_id"),
        performer_ids=booking_performer_ids(booking),
        payload=payload,
    )


def safe_emit_invoice_event(
    invoice: dict,
    event_type: str = "invoice_updated",
    *,
    message: str = "",
    visit: Optional[dict] = None,
    extra_payload: Optional[dict] = None,
) -> None:
    clinic_id = invoice.get("clinic_id")
    if not clinic_id:
        return
    performer_ids: List[str] = []
    if visit:
        performer_ids = visit_performer_ids(visit)
    payload = {
        "status": invoice.get("payment_status") or "",
        "message": message,
        "visit_id": invoice.get("visit_id"),
    }
    if extra_payload:
        payload.update(extra_payload)
    schedule_emit_clinic_event(
        event_type=event_type,
        clinic_id=clinic_id,
        reference_type="invoice",
        reference_id=invoice.get("id") or "",
        patient_id=invoice.get("patient_id"),
        performer_ids=performer_ids,
        payload=payload,
    )


def register_realtime(api: APIRouter, get_current_user) -> None:
    @api.get("/realtime/events")
    async def stream_clinic_events(request: Request, user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Platform admin cannot subscribe to clinic events")
        clinic_id = user.get("clinic_id")
        if not clinic_id:
            raise HTTPException(status_code=403, detail="Clinic context required")

        async def event_stream():
            queue = await hub.subscribe(clinic_id)
            try:
                yield ": connected\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    if not user_should_receive_event(user, event):
                        continue
                    yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
            finally:
                await hub.unsubscribe(clinic_id, queue)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
