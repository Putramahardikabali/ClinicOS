"""Whatsgo automation job helpers — retry, locking, error classification."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from saas import iso, now_utc

DEFAULT_MAX_ATTEMPTS = 3
RETRY_BACKOFF_MINUTES = (5, 15, 60)

PERMANENT_ERROR_PATTERNS = (
    r"invalid phone",
    r"phone.*required",
    r"template not found",
    r"template.*not approved",
    r"not approved",
    r"integration token",
    r"invalid token",
    r"unauthorized",
    r"forbidden",
    r"not connected",
    r"disconnected",
    r"workspace.*required",
    r"messaging_disabled",
    r"whatsgo_automation_disabled",
    r"provider_not_connected",
    r"missing phone",
)


def classify_send_error(error: Optional[str]) -> str:
    """Return 'permanent' or 'temporary'."""
    msg = (error or "").strip().lower()
    if not msg:
        return "temporary"
    for pattern in PERMANENT_ERROR_PATTERNS:
        if re.search(pattern, msg):
            return "permanent"
    if any(x in msg for x in ("timeout", "connection", "503", "502", "504", "429", "network", "temporarily")):
        return "temporary"
    if "400" in msg or "404" in msg or "401" in msg or "403" in msg:
        return "permanent"
    return "temporary"


def compute_next_retry_at(attempt_count: int) -> datetime:
    idx = min(max(attempt_count, 1), len(RETRY_BACKOFF_MINUTES)) - 1
    minutes = RETRY_BACKOFF_MINUTES[idx]
    return now_utc() + timedelta(minutes=minutes)


def job_max_attempts(settings: dict, rule: Optional[dict] = None) -> int:
    if rule and rule.get("max_attempts") is not None:
        return max(1, min(10, int(rule.get("max_attempts") or DEFAULT_MAX_ATTEMPTS)))
    return max(1, min(10, int(settings.get("whatsgo_retry_max_attempts") or DEFAULT_MAX_ATTEMPTS)))


def new_job_fields(
    *,
    clinic_id: str,
    rule: dict,
    reference_type: str,
    reference_id: str,
    scheduled_for: datetime,
    patient_id: Optional[str] = None,
    event_type: Optional[str] = None,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> Dict[str, Any]:
    now = iso(now_utc())
    sched_key = iso(scheduled_for.astimezone(timezone.utc))
    trigger = event_type or rule.get("event_type") or rule.get("trigger_type") or ""
    return {
        "clinic_id": clinic_id,
        "automation_rule_id": rule["id"],
        "rule_id": rule["id"],
        "event_type": trigger,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "patient_id": patient_id or "",
        "scheduled_for": sched_key,
        "status": "pending",
        "attempt_count": 0,
        "max_attempts": max_attempts,
        "next_retry_at": None,
        "message_log_id": None,
        "whatsgo_message_id": None,
        "open_conversation_url": None,
        "error_reason": None,
        "error_message": None,
        "skip_reason": None,
        "payload_snapshot": None,
        "created_at": now,
        "updated_at": now,
        "processed_at": None,
        "sent_at": None,
        "cancelled_at": None,
    }


async def claim_automation_job(db, run_id: str) -> Optional[dict]:
    """Atomically claim a pending/retrying job to prevent duplicate sends."""
    now = iso(now_utc())
    claimed = await db.automation_runs.find_one_and_update(
        {
            "id": run_id,
            "status": {"$in": ["pending", "retrying"]},
        },
        {"$set": {"status": "queued", "updated_at": now}},
        return_document=True,
    )
    if claimed:
        claimed.pop("_id", None)
    return claimed


async def release_job_claim(db, run_id: str, *, restore_status: str = "pending") -> None:
    await db.automation_runs.update_one(
        {"id": run_id, "status": "queued"},
        {"$set": {"status": restore_status, "updated_at": iso(now_utc())}},
    )


def should_schedule_reminder(send_at: datetime) -> Tuple[bool, Optional[str]]:
    if send_at <= now_utc():
        return False, "reminder_in_past"
    return True, None
