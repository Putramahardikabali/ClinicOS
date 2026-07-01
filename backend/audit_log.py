"""Structured audit logging for sensitive clinic actions."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Canonical module names
MODULE_APPOINTMENT = "appointment"
MODULE_INVOICE = "invoice"
MODULE_PACKAGE = "package"
MODULE_COMMISSION = "commission"
MODULE_STAFF = "staff"
MODULE_SCHEDULE = "schedule"
MODULE_CLINICAL_NOTE = "clinical_note"
MODULE_CONSENT = "consent"

_SENSITIVE_KEYS = frozenset({
    "password", "password_hash", "signature", "image_data", "raw_json",
})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_value(val: Any, *, max_str: int = 2000) -> Any:
    if val is None:
        return None
    if isinstance(val, dict):
        out = {}
        for k, v in val.items():
            if k in _SENSITIVE_KEYS:
                out[k] = "[redacted]"
            else:
                out[k] = _sanitize_value(v, max_str=max_str)
        return out
    if isinstance(val, list):
        return [_sanitize_value(x, max_str=max_str) for x in val[:50]]
    if isinstance(val, str) and len(val) > max_str:
        return val[:max_str] + "…"
    return val


def _pick(d: dict, *keys: str) -> dict:
    return {k: d.get(k) for k in keys if k in d}


async def write_audit(
    db,
    user: dict,
    *,
    action: str,
    module: str,
    record_id: str = "",
    old_value: Any = None,
    new_value: Any = None,
    reason: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    """Persist one audit row. ``entity`` kept as alias of ``module`` for legacy UI."""
    import uuid

    merged_meta = dict(meta or {})
    if reason and "reason" not in merged_meta:
        merged_meta["reason"] = reason

    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": user.get("clinic_id"),
        "user_id": user.get("id"),
        "user_email": user.get("email"),
        "user_role": user.get("role"),
        "user_name": user.get("name"),
        "action": action,
        "module": module,
        "entity": module,
        "record_id": record_id,
        "entity_id": record_id,
        "old_value": _sanitize_value(old_value),
        "new_value": _sanitize_value(new_value),
        "reason": (reason or "").strip() or None,
        "meta": _sanitize_value(merged_meta) if merged_meta else {},
        "created_at": _now_iso(),
    }
    await db.audit_logs.insert_one(doc)


def _performer_summary(performers: Optional[List[dict]]) -> List[dict]:
    if not isinstance(performers, list):
        return []
    return [
        {
            "staff_id": p.get("staff_id"),
            "name": p.get("staff_name_snapshot"),
            "role": p.get("staff_role_snapshot"),
            "type": p.get("performer_type"),
        }
        for p in performers if p.get("staff_id")
    ]


def _performer_ids(performers: Optional[List[dict]]) -> set:
    return {p.get("staff_id") for p in (performers or []) if p.get("staff_id")}


async def log_appointment_created(db, user: dict, booking: dict) -> None:
    await write_audit(
        db, user,
        action="created",
        module=MODULE_APPOINTMENT,
        record_id=booking.get("id", ""),
        new_value=_pick(
            booking,
            "id", "patient_id", "patient_name", "scheduled_at", "treatment",
            "status", "booking_type", "performer_id",
        ) | {"performers": _performer_summary(booking.get("performers"))},
    )


async def log_appointment_rescheduled(db, user: dict, booking_id: str, old: dict, new: dict) -> None:
    await write_audit(
        db, user,
        action="rescheduled",
        module=MODULE_APPOINTMENT,
        record_id=booking_id,
        old_value=_pick(old, "scheduled_at", "duration_min", "performer_id") | {
            "performers": _performer_summary(old.get("performers")),
        },
        new_value=_pick(new, "scheduled_at", "duration_min", "performer_id") | {
            "performers": _performer_summary(new.get("performers")),
        },
    )


async def log_appointment_schedule_changed(
    db,
    user: dict,
    booking_id: str,
    old: dict,
    new: dict,
    *,
    change_source: str = "",
) -> None:
    action = "schedule_changed"
    if change_source == "schedule_resize":
        action = "duration_changed"
    elif change_source == "schedule_drag":
        if old.get("performer_id") != new.get("performer_id"):
            action = "reassigned"
        elif old.get("scheduled_at") != new.get("scheduled_at"):
            action = "moved"
    await write_audit(
        db,
        user,
        action=action,
        module=MODULE_APPOINTMENT,
        record_id=booking_id,
        old_value=_pick(old, "scheduled_at", "duration_min", "performer_id") | {
            "performers": _performer_summary(old.get("performers")),
        },
        new_value=_pick(new, "scheduled_at", "duration_min", "performer_id") | {
            "performers": _performer_summary(new.get("performers")),
            "schedule_change_source": change_source,
        },
    )


async def log_appointment_overlap_override(
    db,
    user: dict,
    booking_id: str,
    conflicts: list,
    reason: str = "",
) -> None:
    await write_audit(
        db,
        user,
        action="overlap_override",
        module=MODULE_APPOINTMENT,
        record_id=booking_id,
        new_value={
            "overlap_override": True,
            "conflict_ids": [c.get("id") for c in (conflicts or []) if c.get("id")],
            "conflict_count": len(conflicts or []),
        },
        reason=reason,
    )


async def log_appointment_cancelled(db, user: dict, booking_id: str, booking: dict, reason: str = "") -> None:
    await write_audit(
        db, user,
        action="cancelled",
        module=MODULE_APPOINTMENT,
        record_id=booking_id,
        old_value=_pick(booking, "status", "scheduled_at", "treatment", "patient_name"),
        reason=reason,
    )


async def log_performer_changes(
    db, user: dict, booking_id: str, old_performers: list, new_performers: list,
) -> None:
    old_ids = _performer_ids(old_performers)
    new_ids = _performer_ids(new_performers)
    added = new_ids - old_ids
    removed = old_ids - new_ids
    if not added and not removed:
        return
    for sid in added:
        p = next((x for x in new_performers if x.get("staff_id") == sid), {})
        await write_audit(
            db, user,
            action="performer_added",
            module=MODULE_APPOINTMENT,
            record_id=booking_id,
            new_value=_performer_summary([p])[0] if p else {"staff_id": sid},
        )
    for sid in removed:
        p = next((x for x in old_performers if x.get("staff_id") == sid), {})
        await write_audit(
            db, user,
            action="performer_removed",
            module=MODULE_APPOINTMENT,
            record_id=booking_id,
            old_value=_performer_summary([p])[0] if p else {"staff_id": sid},
        )


async def log_invoice_event(
    db, user: dict, action: str, invoice: dict,
    old_value: Optional[dict] = None, reason: str = "",
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_INVOICE,
        record_id=invoice.get("id", ""),
        old_value=old_value,
        new_value=_pick(
            invoice,
            "id", "invoice_number", "payment_status", "amount_paid",
            "remaining_balance", "total_idr", "patient_id", "visit_id",
        ),
        reason=reason,
    )


async def log_package_balance(
    db, user: dict, action: str, package_id: str,
    old_value: Optional[dict] = None, new_value: Optional[dict] = None,
    reason: str = "", record_id: str = "",
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_PACKAGE,
        record_id=record_id or package_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
    )


async def log_commission_event(
    db, user: dict, action: str, record_ids: List[str],
    count: int = 0, meta: Optional[dict] = None,
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_COMMISSION,
        record_id=record_ids[0] if record_ids else "",
        new_value={"record_ids": record_ids[:20], "count": count, **(meta or {})},
    )


async def log_staff_user_role_change(
    db, user: dict, staff_id: str, old_user: dict, new_role_key: str, new_role_id: Optional[str],
) -> None:
    if old_user.get("role") == new_role_key and old_user.get("role_id") == new_role_id:
        return
    await write_audit(
        db, user,
        action="role_changed",
        module=MODULE_STAFF,
        record_id=staff_id,
        old_value={"role": old_user.get("role"), "role_id": old_user.get("role_id"), "email": old_user.get("email")},
        new_value={"role": new_role_key, "role_id": new_role_id, "email": old_user.get("email")},
    )


async def log_staff_role_change(
    db, user: dict, role_id: str, old_role: dict, new_data: dict,
) -> None:
    old_perms = sorted(old_role.get("permissions") or [])
    new_perms = sorted(new_data.get("permissions") or old_perms)
    await write_audit(
        db, user,
        action="permission_changed" if old_perms != new_perms else "role_updated",
        module=MODULE_STAFF,
        record_id=role_id,
        old_value={
            "role_name": old_role.get("role_name"),
            "role_key": old_role.get("role_key"),
            "permissions": old_perms,
        },
        new_value={
            "role_name": new_data.get("role_name", old_role.get("role_name")),
            "role_key": old_role.get("role_key"),
            "permissions": new_perms,
        },
    )


async def log_schedule_change(
    db, user: dict, staff_id: str, action: str,
    old_value: Optional[dict] = None, new_value: Optional[dict] = None,
    reason: str = "",
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_SCHEDULE,
        record_id=staff_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
    )


async def log_clinical_note(
    db, user: dict, action: str, visit_id: str, note_type: str,
    old_value: Optional[dict] = None, new_value: Optional[dict] = None,
    reason: str = "",
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_CLINICAL_NOTE,
        record_id=visit_id,
        old_value=old_value,
        new_value={"note_type": note_type, **(new_value or {})},
        reason=reason,
    )


async def log_consent(
    db, user: dict, action: str, patient_id: str,
    old_value: Optional[dict] = None, new_value: Optional[dict] = None,
    reason: str = "",
) -> None:
    await write_audit(
        db, user,
        action=action,
        module=MODULE_CONSENT,
        record_id=patient_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
    )
