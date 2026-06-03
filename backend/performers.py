"""Shared performer helpers — multi-performer support with legacy single-performer compat."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

CLINICAL_PERFORMER_ROLES = frozenset({"doctor", "therapist", "nurse"})
PERFORMER_SLOT_ROLES = frozenset({"doctor", "therapist", "nurse"})
PERFORMER_TYPE_VALUES = frozenset({
    "primary", "assistant", "secondary", "nurse", "doctor", "therapist", "other",
})


def roles_from_legacy_performer_type(performer_type: str) -> List[str]:
    pt = (performer_type or "therapist").lower()
    if pt == "either":
        return ["doctor", "therapist", "nurse"]
    if pt == "nurse":
        return ["nurse"]
    if pt == "doctor":
        return ["doctor"]
    if pt == "therapist":
        return ["therapist"]
    return [pt] if pt in CLINICAL_PERFORMER_ROLES else ["therapist"]


def normalize_allowed_performer_roles(
    treatment: Optional[dict],
    *,
    fallback_performer_type: str = "therapist",
) -> List[str]:
    if treatment:
        allowed = treatment.get("allowed_performer_roles")
        if isinstance(allowed, list) and allowed:
            out = [r for r in allowed if r in CLINICAL_PERFORMER_ROLES]
            if out:
                return out
        pt = treatment.get("performer_type") or fallback_performer_type
        return roles_from_legacy_performer_type(pt)
    return roles_from_legacy_performer_type(fallback_performer_type)


def treatment_allows_multiple(treatment: Optional[dict]) -> bool:
    if not treatment:
        return False
    return bool(treatment.get("allow_multiple_performers"))


def normalize_performer_type(value: Optional[str], *, default: str = "primary") -> str:
    v = (value or default).strip().lower()
    return v if v in PERFORMER_TYPE_VALUES else default


def build_performer_entry(
    user: dict,
    *,
    performer_type: str = "primary",
    commission_eligible: bool = True,
    notes: str = "",
) -> dict:
    role = user.get("role") or ""
    return {
        "staff_id": user["id"],
        "staff_name_snapshot": (user.get("name") or "").strip() or "Staff",
        "staff_role_snapshot": role,
        "performer_type": normalize_performer_type(performer_type),
        "commission_eligible": commission_eligible,
        "notes": (notes or "").strip(),
    }


def performers_from_legacy(performer_id: Optional[str], snapshots: Optional[dict] = None) -> List[dict]:
    pid = (performer_id or "").strip()
    if not pid:
        return []
    snap = snapshots or {}
    return [{
        "staff_id": pid,
        "staff_name_snapshot": snap.get("performer_name_snapshot") or snap.get("staff_name_snapshot") or "",
        "staff_role_snapshot": snap.get("performer_role_snapshot") or snap.get("staff_role_snapshot") or "",
        "performer_type": "primary",
        "commission_eligible": True,
        "notes": "",
    }]


def get_performers(doc: dict) -> List[dict]:
    performers = doc.get("performers")
    if isinstance(performers, list) and performers:
        return [p for p in performers if p.get("staff_id")]
    legacy = performers_from_legacy(
        doc.get("performer_id"),
        {
            "performer_name_snapshot": doc.get("performer_name_snapshot"),
            "performer_role_snapshot": doc.get("performer_role_snapshot"),
        },
    )
    return legacy


def primary_performer_id(doc: dict) -> Optional[str]:
    for p in get_performers(doc):
        if (p.get("performer_type") or "primary") == "primary":
            return p.get("staff_id")
    performers = get_performers(doc)
    return performers[0]["staff_id"] if performers else (doc.get("performer_id") or None)


def sync_legacy_performer_fields(doc: dict) -> dict:
    """Ensure performers[] and legacy performer_id stay in sync."""
    performers = get_performers(doc)
    pid = primary_performer_id({"performers": performers, "performer_id": doc.get("performer_id")})
    doc["performers"] = performers
    doc["performer_id"] = pid
    primary = next((p for p in performers if p.get("staff_id") == pid), performers[0] if performers else None)
    if primary:
        doc["performer_name_snapshot"] = primary.get("staff_name_snapshot") or ""
        doc["performer_role_snapshot"] = primary.get("staff_role_snapshot") or ""
    return doc


def staff_ids_from_performers(doc: dict) -> List[str]:
    return [p["staff_id"] for p in get_performers(doc) if p.get("staff_id")]


def booking_staff_filter(user_id: str) -> dict:
    return {
        "$or": [
            {"performer_id": user_id},
            {"performers.staff_id": user_id},
        ],
    }


def visit_staff_filter(user_id: str, role: str = "") -> dict:
    """Visits where staff is primary assignee or listed in performers[]."""
    return {
        "$or": [
            {"assigned_to": user_id},
            {"performers.staff_id": user_id},
        ],
    }


def invoice_item_performers(item: dict) -> List[dict]:
    performers = item.get("performers")
    if isinstance(performers, list) and performers:
        return [p for p in performers if p.get("staff_id")]
    pid = (item.get("performer_id") or "").strip()
    if not pid:
        return []
    return [{
        "staff_id": pid,
        "staff_name_snapshot": item.get("performer_name_snapshot") or "",
        "staff_role_snapshot": item.get("performer_role_snapshot") or "",
        "performer_type": "primary",
        "commission_eligible": True,
        "notes": "",
    }]


def sync_invoice_item_legacy(item: dict) -> dict:
    performers = invoice_item_performers(item)
    item["performers"] = performers
    pid = primary_performer_id({"performers": performers, "performer_id": item.get("performer_id")})
    item["performer_id"] = pid
    primary = next((p for p in performers if p.get("staff_id") == pid), performers[0] if performers else None)
    if primary:
        item["performer_name_snapshot"] = primary.get("staff_name_snapshot") or ""
        item["performer_role_snapshot"] = primary.get("staff_role_snapshot") or ""
    return item


def commission_eligible_performers(item: dict) -> List[dict]:
    return [p for p in invoice_item_performers(item) if p.get("commission_eligible", True)]


async def lookup_staff_performer(db, clinic_id: str, staff_id: str) -> dict:
    from fastapi import HTTPException

    pid = (staff_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Performer is required")
    user = await db.users.find_one(
        {"id": pid, "clinic_id": clinic_id, "role": {"$in": list(CLINICAL_PERFORMER_ROLES)}},
        {"_id": 0, "id": 1, "name": 1, "role": 1},
    )
    if not user:
        raise HTTPException(status_code=400, detail="Performer not found or not eligible")
    return user


async def normalize_performers_input(
    db,
    clinic_id: str,
    raw_performers: Optional[List[dict]],
    *,
    legacy_performer_id: Optional[str] = None,
    allowed_roles: Optional[List[str]] = None,
    allow_multiple: bool = False,
    require_at_least_one: bool = True,
    primary_allowed_roles: Optional[List[str]] = None,
) -> List[dict]:
    from fastapi import HTTPException

    allowed: Optional[Set[str]] = set(allowed_roles) if allowed_roles else None
    primary_allowed: Optional[Set[str]] = (
        set(primary_allowed_roles) if primary_allowed_roles is not None else allowed
    )
    entries: List[dict] = []

    if raw_performers:
        for raw in raw_performers:
            sid = (raw.get("staff_id") or raw.get("performer_id") or "").strip()
            if not sid:
                if raw.get("staff_role") or raw.get("staff_role_snapshot"):
                    raise HTTPException(
                        status_code=400,
                        detail="Each additional performer must have staff selected",
                    )
                continue
            user = await lookup_staff_performer(db, clinic_id, sid)
            role = user.get("role") or ""
            ptype = normalize_performer_type(raw.get("performer_type") or "primary")
            role_check = primary_allowed if ptype == "primary" else None
            if role_check and role not in role_check:
                raise HTTPException(
                    status_code=400,
                    detail=f"{user.get('name') or 'Staff'} is not an allowed performer for this treatment",
                )
            entries.append(build_performer_entry(
                user,
                performer_type=ptype,
                commission_eligible=raw.get("commission_eligible", True),
                notes=raw.get("notes") or "",
            ))

    if not entries and legacy_performer_id:
        user = await lookup_staff_performer(db, clinic_id, legacy_performer_id)
        role = user.get("role") or ""
        if primary_allowed and role not in primary_allowed:
            raise HTTPException(status_code=400, detail="Performer role not allowed for this treatment")
        entries = [build_performer_entry(user, performer_type="primary")]

    if require_at_least_one and not entries:
        raise HTTPException(status_code=400, detail="At least one performer is required")

    if not allow_multiple and len(entries) > 1:
        raise HTTPException(status_code=400, detail="This treatment allows only one performer")

    seen: Set[str] = set()
    deduped: List[dict] = []
    for e in entries:
        sid = e["staff_id"]
        if sid in seen:
            raise HTTPException(status_code=400, detail="Duplicate performer selected")
        seen.add(sid)
        deduped.append(e)

    if deduped and not any((p.get("performer_type") or "primary") == "primary" for p in deduped):
        deduped[0]["performer_type"] = "primary"

    return deduped


def resolve_visit_type_from_performers(performers: List[dict], fallback: str = "therapist") -> str:
    primary = next((p for p in performers if (p.get("performer_type") or "primary") == "primary"), None)
    role = (primary or {}).get("staff_role_snapshot") or fallback
    if role in ("doctor", "therapist", "nurse"):
        return role
    return fallback


def visit_performer_roles(visit: dict, *, assigned_user_role: str = "") -> Set[str]:
    """Clinical roles assigned to this visit (from performers[] or legacy assignee)."""
    roles: Set[str] = set()
    for p in get_performers(visit):
        role = (p.get("staff_role_snapshot") or "").strip().lower()
        if role in CLINICAL_PERFORMER_ROLES:
            roles.add(role)
    if roles:
        return roles
    fallback = (assigned_user_role or visit.get("visit_type") or "").strip().lower()
    if fallback in CLINICAL_PERFORMER_ROLES:
        roles.add(fallback)
    return roles


def treatment_allowed_for_roles(treatment: Optional[dict], visit_roles: Set[str]) -> bool:
    if not treatment or not visit_roles:
        return False
    allowed = set(normalize_allowed_performer_roles(treatment))
    return bool(allowed & visit_roles)


async def validate_visit_treatment_item(
    db,
    clinic_id: str,
    visit: dict,
    *,
    treatment_name: str,
    performer_id: Optional[str] = None,
) -> Tuple[dict, dict]:
    """Ensure catalog treatment is allowed for visit performers; resolve item performer."""
    from fastapi import HTTPException

    name = (treatment_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Treatment name is required")

    assigned_role = ""
    if visit.get("assigned_to"):
        u = await db.users.find_one({"id": visit["assigned_to"]}, {"_id": 0, "role": 1})
        assigned_role = (u or {}).get("role") or ""

    visit_roles = visit_performer_roles(visit, assigned_user_role=assigned_role)
    if not visit_roles:
        raise HTTPException(status_code=400, detail="Visit has no clinical performer roles assigned")

    treatment = await db.treatments.find_one(
        {"clinic_id": clinic_id, "name": name, "active": True},
        {"_id": 0},
    )
    if treatment and not treatment_allowed_for_roles(treatment, visit_roles):
        raise HTTPException(
            status_code=400,
            detail="This treatment is not allowed for the performer role(s) on this visit",
        )

    allowed_treatment_roles = (
        set(normalize_allowed_performer_roles(treatment)) if treatment else visit_roles
    )
    performers = get_performers(visit)
    if not performers and visit.get("assigned_to"):
        performers = performers_from_legacy(
            visit.get("assigned_to"),
            {
                "performer_name_snapshot": visit.get("performer_name_snapshot"),
                "performer_role_snapshot": visit.get("performer_role_snapshot") or assigned_role,
            },
        )

    visit_performer_ids = {p["staff_id"] for p in performers if p.get("staff_id")}
    if not visit_performer_ids:
        raise HTTPException(status_code=400, detail="Visit has no assigned performers")

    pid = (performer_id or "").strip()
    if len(visit_performer_ids) > 1 and not pid:
        raise HTTPException(
            status_code=400,
            detail="Select which assigned performer performed this treatment",
        )
    if not pid:
        pid = primary_performer_id(visit) or next(iter(visit_performer_ids))

    performer = next((p for p in performers if p.get("staff_id") == pid), None)
    if not performer:
        raise HTTPException(status_code=400, detail="Performer must be assigned to this visit")

    role = (performer.get("staff_role_snapshot") or "").strip().lower()
    if role not in CLINICAL_PERFORMER_ROLES:
        raise HTTPException(status_code=400, detail="Performer role is not clinical")
    if treatment and role not in allowed_treatment_roles:
        raise HTTPException(
            status_code=400,
            detail="Selected performer is not allowed for this treatment",
        )

    return treatment or {}, {
        "performer_id": pid,
        "performer_name_snapshot": performer.get("staff_name_snapshot") or "",
        "performer_role_snapshot": role,
    }
