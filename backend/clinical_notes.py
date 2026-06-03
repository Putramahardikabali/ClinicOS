"""Clinical visit note status, locking, per-performer notes, and templates."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from performers import get_performers, primary_performer_id, staff_ids_from_performers

NOTE_STATUSES = frozenset({"draft", "completed", "locked"})
CLINICAL_EDITOR_ROLES = frozenset({"doctor", "therapist", "nurse"})
LOCK_OVERRIDE_ROLES = frozenset({"super_admin"})

DEFAULT_NOTE_TEMPLATES: List[dict] = [
    {
        "id": "doctor-botox",
        "name": "Botox / Toxin",
        "roles": ["doctor"],
        "visit_types": ["doctor"],
        "fields": {
            "anamnesis": "Patient presents for botulinum toxin treatment. No new medical concerns.",
            "diagnosis": "Dynamic rhytids, indication for neuromodulator.",
            "treatment_plan": "Botulinum toxin injection per mapped areas. Post-care: avoid rubbing 4h, no gym 24h.",
            "therapy_notes": "",
            "doctor_notes": "Units and sites documented below.",
        },
    },
    {
        "id": "doctor-filler",
        "name": "Dermal Filler",
        "roles": ["doctor"],
        "visit_types": ["doctor"],
        "fields": {
            "anamnesis": "Patient for dermal filler augmentation. Consent obtained.",
            "diagnosis": "Volume loss / contour deficiency.",
            "treatment_plan": "HA filler per agreed plan. Arnica advised if bruising.",
            "therapy_notes": "",
            "doctor_notes": "Product, volume, and layer documented.",
        },
    },
    {
        "id": "doctor-consult",
        "name": "Aesthetic Consultation",
        "roles": ["doctor"],
        "visit_types": ["doctor"],
        "fields": {
            "anamnesis": "Initial aesthetic consultation.",
            "diagnosis": "Assessment pending / as per facial analysis.",
            "treatment_plan": "Discussed options, timeline, and expectations.",
            "therapy_notes": "",
            "doctor_notes": "",
        },
    },
    {
        "id": "therapist-hifu",
        "name": "HIFU / Lifting",
        "roles": ["therapist", "nurse"],
        "visit_types": ["therapist", "nurse"],
        "fields": {
            "concern_notes": "Patient for HIFU lifting session.",
            "body_concern": "Skin laxity / contour.",
            "treatment_area": "Face and neck",
            "therapist_notes": "Parameters and passes recorded. Post-care: hydration, SPF.",
        },
    },
    {
        "id": "therapist-body",
        "name": "Body Contouring",
        "roles": ["therapist", "nurse"],
        "visit_types": ["therapist", "nurse"],
        "fields": {
            "concern_notes": "Body contouring session.",
            "body_concern": "Localized adiposity / skin texture.",
            "treatment_area": "",
            "therapist_notes": "Device settings and duration documented.",
        },
    },
    {
        "id": "therapist-facial",
        "name": "Facial Treatment",
        "roles": ["therapist", "nurse"],
        "visit_types": ["therapist", "nurse"],
        "fields": {
            "concern_notes": "Facial treatment session.",
            "body_concern": "Skin quality / hydration.",
            "treatment_area": "Full face",
            "therapist_notes": "Products and steps documented.",
        },
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def effective_note_status(record: Optional[dict], visit: dict) -> str:
    """Resolve draft / completed / locked from record + visit workflow."""
    if visit.get("status") == "completed":
        return "locked"
    if not record:
        return "draft"
    explicit = record.get("note_status")
    if explicit == "locked":
        return "locked"
    if record.get("submitted") or explicit == "completed":
        return "completed"
    return explicit or "draft"


def enrich_record_status(record: Optional[dict], visit: dict) -> Optional[dict]:
    if not record:
        return None
    out = dict(record)
    out["note_status"] = effective_note_status(record, visit)
    return out


def user_assigned_to_visit(user: dict, visit: dict) -> bool:
    uid = user.get("id")
    if not uid:
        return False
    if uid in staff_ids_from_performers(visit) or visit.get("assigned_to") == uid:
        return True
    return False


def user_is_assistant_on_visit(user: dict, visit: dict) -> bool:
    uid = user.get("id")
    if not uid:
        return False
    primary = primary_performer_id(visit)
    for p in get_performers(visit):
        if p.get("staff_id") != uid:
            continue
        ptype = (p.get("performer_type") or "primary").lower()
        if ptype in ("assistant", "secondary", "nurse") or (uid != primary and ptype != "primary"):
            return True
    return False


def assert_not_fo_clinical(user: dict) -> None:
    if user.get("role") == "fo":
        raise HTTPException(status_code=403, detail="Front office cannot edit clinical notes")


def assert_clinical_edit_permission(user: dict) -> None:
    from permissions import user_has_permission

    assert_not_fo_clinical(user)
    if user.get("role") in LOCK_OVERRIDE_ROLES or user.get("platform_admin"):
        return
    if not user_has_permission(user, "clinical_records.edit"):
        raise HTTPException(status_code=403, detail="Not allowed to edit clinical notes")


def check_primary_record_edit(
    user: dict,
    visit: dict,
    record: Optional[dict],
    author_id_field: str,
    allowed_roles: frozenset,
    edit_reason: Optional[str] = None,
) -> Tuple[bool, bool]:
    """
    Returns (can_edit, requires_reason).
    Raises HTTPException when edit forbidden.
    """
    assert_clinical_edit_permission(user)
    if user.get("role") not in allowed_roles and user.get("role") not in LOCK_OVERRIDE_ROLES:
        if not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Role not allowed to edit this record")

    if not user_assigned_to_visit(user, visit):
        if user.get("role") not in LOCK_OVERRIDE_ROLES and not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="You can only edit notes for visits assigned to you")

    status = effective_note_status(record, visit)
    if status == "draft":
        return True, False

    if user.get("role") in LOCK_OVERRIDE_ROLES or user.get("platform_admin"):
        if not (edit_reason or "").strip():
            raise HTTPException(status_code=400, detail="Edit reason required for locked or submitted notes")
        return True, True

    if status == "completed" and not record:
        return True, False

    raise HTTPException(status_code=403, detail="Clinical record is locked")


def check_performer_note_edit(
    user: dict,
    visit: dict,
    note: Optional[dict],
    staff_id: str,
    edit_reason: Optional[str] = None,
) -> Tuple[bool, bool]:
    assert_clinical_edit_permission(user)
    uid = user.get("id")
    is_own = uid == staff_id
    is_assistant = user_is_assistant_on_visit(user, visit) and is_own

    if not is_own and user.get("role") not in LOCK_OVERRIDE_ROLES and not user.get("platform_admin"):
        raise HTTPException(status_code=403, detail="You can only edit your own performer note")

    if not user_assigned_to_visit(user, visit) and not is_assistant:
        if user.get("role") not in LOCK_OVERRIDE_ROLES and not user.get("platform_admin"):
            raise HTTPException(status_code=403, detail="Not assigned to this visit")

    status = effective_note_status(note, visit)
    if status == "draft":
        return True, False

    if user.get("role") in LOCK_OVERRIDE_ROLES or user.get("platform_admin"):
        if not (edit_reason or "").strip():
            raise HTTPException(status_code=400, detail="Edit reason required for locked or submitted notes")
        return True, True

    raise HTTPException(status_code=403, detail="Performer note is locked")


async def lock_all_visit_notes(db, visit_id: str, clinic_id: str) -> None:
    """Lock all clinical documentation when visit is marked completed."""
    ts = _now_iso()
    for coll in ("clinical_records", "therapist_records"):
        await db[coll].update_many(
            {"visit_id": visit_id, "clinic_id": clinic_id},
            {"$set": {"note_status": "locked", "locked_at": ts}},
        )
    await db.performer_visit_notes.update_many(
        {"visit_id": visit_id, "clinic_id": clinic_id},
        {"$set": {"note_status": "locked", "locked_at": ts}},
    )


def apply_note_template(templates: List[dict], template_id: str, role: str) -> dict:
    for t in templates:
        if t.get("id") == template_id:
            roles = t.get("roles") or []
            if roles and role not in roles:
                continue
            return dict(t.get("fields") or {})
    return {}


def visit_performer_slots(visit: dict) -> List[dict]:
    """Performers needing separate notes (non-primary or all for multi-performer)."""
    performers = get_performers(visit)
    if not performers:
        return []
    primary = primary_performer_id(visit)
    slots = []
    for p in performers:
        sid = p.get("staff_id")
        if not sid:
            continue
        ptype = (p.get("performer_type") or "primary").lower()
        if sid == primary and ptype == "primary":
            continue
        slots.append({
            "staff_id": sid,
            "staff_name": p.get("staff_name_snapshot") or "",
            "staff_role": p.get("staff_role_snapshot") or "",
            "performer_type": ptype,
            "note_type": "assistant" if ptype in ("assistant", "secondary") else ptype,
        })
    return slots
