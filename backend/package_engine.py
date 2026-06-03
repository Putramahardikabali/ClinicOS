"""Unified package catalog + patient balance + usage engine."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

PACKAGE_TYPES = frozenset({"series_package", "bundle_package", "day_package"})
REDEMPTION_RULES = frozenset({"flexible", "same_day_only"})
UNUSED_POLICIES = frozenset({"keep_remaining", "expire_after_first_use"})
PATIENT_PACKAGE_STATUSES = frozenset({
    "active", "partially_used", "used_up", "expired", "cancelled",
})
COMPONENT_STATUSES = frozenset({"active", "partially_used", "used_up", "expired"})

PACKAGE_TYPE_LABELS = {
    "series_package": "Series Package",
    "bundle_package": "Bundle Package",
    "day_package": "Day Package",
}

LEGACY_TYPE_MAP = {
    "series package": "series_package",
    "day package": "day_package",
    "bundle package": "bundle_package",
    "session": "series_package",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def normalize_package_type(raw: Optional[str]) -> str:
    val = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if val in PACKAGE_TYPES:
        return val
    legacy = LEGACY_TYPE_MAP.get((raw or "").strip().lower())
    if legacy:
        return legacy
    if "day" in val:
        return "day_package"
    if "bundle" in val:
        return "bundle_package"
    return "series_package"


def package_type_label(package_type: str) -> str:
    return PACKAGE_TYPE_LABELS.get(normalize_package_type(package_type), package_type)


def default_redemption_rule(package_type: str) -> str:
    return "same_day_only" if normalize_package_type(package_type) == "day_package" else "flexible"


def default_unused_policy(package_type: str) -> str:
    return "expire_after_first_use" if normalize_package_type(package_type) == "day_package" else "keep_remaining"


def normalize_component(raw: dict, sort_order: int = 0) -> dict:
    qty = max(1, int(raw.get("quantity") or 1))
    return {
        "id": raw.get("id") or str(uuid.uuid4()),
        "treatment_id": (raw.get("treatment_id") or "").strip() or None,
        "treatment_name_snapshot": (raw.get("treatment_name_snapshot") or raw.get("treatment_name") or "").strip(),
        "quantity": qty,
        "sort_order": int(raw.get("sort_order") if raw.get("sort_order") is not None else sort_order),
        "is_required": bool(raw.get("is_required", True)),
        "notes": (raw.get("notes") or "").strip(),
    }


async def resolve_treatment_name(db, clinic_id: str, treatment_id: str) -> str:
    if not treatment_id:
        return ""
    row = await db.treatments.find_one(
        {"clinic_id": clinic_id, "$or": [{"id": treatment_id}, {"key": treatment_id}]},
        {"_id": 0, "name": 1},
    )
    return (row or {}).get("name") or ""


async def normalize_catalog_components(
    db,
    clinic_id: str,
    package_type: str,
    components: Optional[List[dict]],
    *,
    sessions_total: int = 0,
    series_treatment_id: Optional[str] = None,
) -> List[dict]:
    ptype = normalize_package_type(package_type)
    out: List[dict] = []

    if components:
        for idx, raw in enumerate(components):
            comp = normalize_component(raw, idx)
            if not comp["treatment_id"]:
                raise HTTPException(status_code=400, detail="Each package component needs a treatment")
            if not comp["treatment_name_snapshot"]:
                comp["treatment_name_snapshot"] = await resolve_treatment_name(
                    db, clinic_id, comp["treatment_id"],
                )
            out.append(comp)
    elif ptype == "series_package":
        tid = (series_treatment_id or "").strip()
        if not tid:
            raise HTTPException(status_code=400, detail="Series package requires a treatment")
        qty = max(1, int(sessions_total or 1))
        name = await resolve_treatment_name(db, clinic_id, tid)
        out.append(normalize_component({
            "treatment_id": tid,
            "treatment_name_snapshot": name,
            "quantity": qty,
            "sort_order": 0,
        }))
    else:
        raise HTTPException(status_code=400, detail="Bundle/day packages require at least one component")

    if ptype == "series_package" and len(out) != 1:
        raise HTTPException(status_code=400, detail="Series package must have exactly one treatment component")
    if ptype in ("bundle_package", "day_package") and len(out) < 1:
        raise HTTPException(status_code=400, detail="Add at least one treatment component")

    out.sort(key=lambda c: c.get("sort_order", 0))
    return out


def catalog_sessions_total(components: List[dict]) -> int:
    return sum(int(c.get("quantity") or 0) for c in components)


def build_patient_components(
    catalog: dict,
    invoice_quantity: int = 1,
) -> List[dict]:
    mult = max(1, int(invoice_quantity or 1))
    out = []
    for comp in catalog.get("components") or []:
        total = int(comp.get("quantity") or 0) * mult
        out.append({
            "id": str(uuid.uuid4()),
            "catalog_component_id": comp.get("id"),
            "treatment_id": comp.get("treatment_id"),
            "treatment_name_snapshot": comp.get("treatment_name_snapshot") or "",
            "total_quantity": total,
            "used_quantity": 0,
            "remaining_quantity": total,
            "status": "active",
        })
    return out


def sync_legacy_session_fields(doc: dict) -> dict:
    components = doc.get("components") or []
    if components:
        total = sum(int(c.get("total_quantity") or 0) for c in components)
        used = sum(int(c.get("used_quantity") or 0) for c in components)
        doc["total_sessions"] = total
        doc["used_sessions"] = used
        doc["remaining_sessions"] = max(0, total - used)
    else:
        total = int(doc.get("total_sessions") or 0)
        used = int(doc.get("used_sessions") or 0)
        doc["remaining_sessions"] = max(0, total - used)
    return doc


def compute_patient_package_status(doc: dict, today: Optional[str] = None) -> str:
    if doc.get("status") == "cancelled":
        return "cancelled"
    today = today or _today_str()
    expiry = doc.get("expiry_date") or ""
    if expiry and expiry < today:
        return "expired"

    components = doc.get("components") or []
    if components:
        remaining = sum(int(c.get("remaining_quantity") or 0) for c in components if c.get("status") != "expired")
        total = sum(int(c.get("total_quantity") or 0) for c in components)
        used = sum(int(c.get("used_quantity") or 0) for c in components)
        if remaining <= 0:
            return "used_up"
        if used > 0:
            return "partially_used"
        return "active"

    remaining = int(doc.get("remaining_sessions") or 0)
    used = int(doc.get("used_sessions") or 0)
    if remaining <= 0:
        return "used_up"
    if used > 0:
        return "partially_used"
    return "active"


def _expire_stale_day_components(doc: dict, today: str) -> dict:
    if doc.get("unused_component_policy") != "expire_after_first_use":
        return doc
    if normalize_package_type(doc.get("package_type", "")) != "day_package":
        return doc
    first_day = doc.get("first_redemption_date")
    if not first_day or today <= first_day:
        return doc
    components = list(doc.get("components") or [])
    changed = False
    for i, comp in enumerate(components):
        if int(comp.get("remaining_quantity") or 0) > 0 and comp.get("status") != "expired":
            comp = dict(comp)
            comp["remaining_quantity"] = 0
            comp["status"] = "expired"
            components[i] = comp
            changed = True
    if changed:
        doc = {**doc, "components": components}
    return doc


def apply_patient_package_status(doc: dict, today: Optional[str] = None, visit_day: Optional[str] = None) -> dict:
    today = today or _today_str()
    doc = _expire_stale_day_components(doc, today)
    doc = sync_legacy_session_fields(doc)
    doc["status"] = compute_patient_package_status(doc, today)
    return doc


def treatment_matches(component: dict, treatment_id: Optional[str], treatment_name: Optional[str]) -> bool:
    if treatment_id and component.get("treatment_id"):
        if component["treatment_id"] == treatment_id:
            return True
    name = (treatment_name or "").strip().lower()
    comp_name = (component.get("treatment_name_snapshot") or "").strip().lower()
    return bool(name and comp_name and name == comp_name)


def _usage_dates_for_package(db_usages: List[dict], patient_package_id: str) -> set:
    dates = set()
    for u in db_usages:
        if u.get("patient_package_id") != patient_package_id or u.get("status") != "active":
            continue
        d = (u.get("usage_date") or u.get("created_at") or "")[:10]
        if d:
            dates.add(d)
    return dates


def find_eligible_component(
    patient_pkg: dict,
    treatment_id: Optional[str],
    treatment_name: Optional[str],
    *,
    visit_date: Optional[str] = None,
    active_usages: Optional[List[dict]] = None,
    component_id: Optional[str] = None,
) -> dict:
    if patient_pkg.get("status") in ("cancelled", "expired", "used_up"):
        raise HTTPException(status_code=400, detail=f"Package is {patient_pkg.get('status')}")

    components = patient_pkg.get("components") or []
    if not components:
        if int(patient_pkg.get("remaining_sessions") or 0) <= 0:
            raise HTTPException(status_code=400, detail="No remaining package balance")
        return {}

    redemption = patient_pkg.get("redemption_rule") or default_redemption_rule(patient_pkg.get("package_type", ""))
    visit_day = (visit_date or _today_str())[:10]
    pkg_id = patient_pkg.get("id")

    if redemption == "same_day_only" and active_usages:
        used_days = _usage_dates_for_package(active_usages, pkg_id)
        if used_days and visit_day not in used_days:
            raise HTTPException(
                status_code=400,
                detail="Day package components must be redeemed on the same visit date as the first use",
            )

    candidates = []
    for comp in components:
        if comp.get("status") == "expired":
            continue
        if int(comp.get("remaining_quantity") or 0) <= 0:
            continue
        if component_id and comp.get("id") != component_id:
            continue
        if not component_id and not treatment_matches(comp, treatment_id, treatment_name):
            continue
        candidates.append(comp)

    if not candidates:
        raise HTTPException(status_code=400, detail="No matching package component for this treatment")

    candidates.sort(key=lambda c: c.get("sort_order", 0) if "sort_order" in c else 0)
    return candidates[0]


def deduct_component(
    patient_pkg: dict,
    component: dict,
    count: int,
    *,
    active_usages: Optional[List[dict]] = None,
    visit_date: Optional[str] = None,
) -> dict:
    count = max(1, int(count or 1))
    components = list(patient_pkg.get("components") or [])
    comp_id = component.get("id")
    idx = next((i for i, c in enumerate(components) if c.get("id") == comp_id), None)
    if idx is None:
        raise HTTPException(status_code=400, detail="Package component not found")

    comp = dict(components[idx])
    if int(comp.get("remaining_quantity") or 0) < count:
        raise HTTPException(status_code=400, detail="Not enough remaining quantity on this component")

    comp["used_quantity"] = int(comp.get("used_quantity") or 0) + count
    comp["remaining_quantity"] = max(0, int(comp.get("total_quantity") or 0) - comp["used_quantity"])
    if comp["remaining_quantity"] <= 0:
        comp["status"] = "used_up"
    elif comp["used_quantity"] > 0:
        comp["status"] = "partially_used"
    components[idx] = comp

    policy = patient_pkg.get("unused_component_policy") or default_unused_policy(patient_pkg.get("package_type", ""))
    visit_day = (visit_date or _today_str())[:10]

    patient_pkg = {**patient_pkg, "components": components, "updated_at": _now_iso()}
    if normalize_package_type(patient_pkg.get("package_type", "")) == "day_package":
        if not patient_pkg.get("first_redemption_date"):
            patient_pkg["first_redemption_date"] = visit_day
    return apply_patient_package_status(patient_pkg, visit_day=visit_day)


def reverse_component_deduction(patient_pkg: dict, usage: dict) -> dict:
    count = max(1, int(usage.get("used_quantity") or usage.get("used_sessions_count") or 1))
    comp_id = usage.get("patient_package_component_id")
    components = list(patient_pkg.get("components") or [])

    if comp_id and components:
        for i, comp in enumerate(components):
            if comp.get("id") != comp_id:
                continue
            comp = dict(comp)
            comp["used_quantity"] = max(0, int(comp.get("used_quantity") or 0) - count)
            comp["remaining_quantity"] = max(0, int(comp.get("total_quantity") or 0) - comp["used_quantity"])
            if comp["remaining_quantity"] <= 0:
                comp["status"] = "used_up"
            elif comp["used_quantity"] > 0:
                comp["status"] = "partially_used"
            else:
                comp["status"] = "active"
            components[i] = comp
            break
        patient_pkg = {**patient_pkg, "components": components}
    else:
        used = max(0, int(patient_pkg.get("used_sessions") or 0) - count)
        patient_pkg = {
            **patient_pkg,
            "used_sessions": used,
            "remaining_sessions": max(0, int(patient_pkg.get("total_sessions") or 0) - used),
        }

    if patient_pkg.get("status") != "cancelled":
        patient_pkg = apply_patient_package_status(patient_pkg)
    patient_pkg["updated_at"] = _now_iso()
    return patient_pkg


def list_eligible_packages_for_treatment(
    packages: List[dict],
    treatment_id: Optional[str],
    treatment_name: Optional[str],
    *,
    visit_date: Optional[str] = None,
    active_usages: Optional[List[dict]] = None,
) -> List[dict]:
    out = []
    for pkg in packages:
        st = pkg.get("status")
        if st not in ("active", "partially_used"):
            continue
        try:
            comp = find_eligible_component(
                pkg, treatment_id, treatment_name,
                visit_date=visit_date, active_usages=active_usages,
            )
            row = {**pkg, "eligible_component": comp}
            out.append(row)
        except HTTPException:
            continue
    return out


async def catalog_validity(db, clinic_id: str, catalog_id: str, quantity: int = 1) -> Tuple[int, str, str, dict]:
    pkg = await db.packages.find_one({"clinic_id": clinic_id, "id": catalog_id}, {"_id": 0})
    if not pkg:
        pkg = await db.packages.find_one({"clinic_id": clinic_id, "key": catalog_id}, {"_id": 0})
    if not pkg:
        return 0, _today_str(), _today_str(), {}

    components = pkg.get("components") or []
    if not components and int(pkg.get("sessions_total") or 0) > 0:
        components = [{
            "id": str(uuid.uuid4()),
            "treatment_id": None,
            "treatment_name_snapshot": "",
            "quantity": int(pkg.get("sessions_total") or 6),
        }]
        pkg = {**pkg, "components": components}

    total = catalog_sessions_total(components) * max(1, int(quantity or 1))
    valid_days = int(pkg.get("validity_days") or pkg.get("valid_days") or 365)
    start = _today_str()
    expiry = (datetime.now(timezone.utc).date() + timedelta(days=valid_days)).strftime("%Y-%m-%d")
    return total, start, expiry, pkg


def normalize_catalog_doc(raw: dict) -> dict:
    ptype = normalize_package_type(raw.get("package_type"))
    raw["package_type"] = ptype
    raw["validity_days"] = int(raw.get("validity_days") or raw.get("valid_days") or 365)
    raw["valid_days"] = raw["validity_days"]
    raw["is_active"] = bool(raw.get("is_active", raw.get("active", True)))
    raw["active"] = raw["is_active"]
    raw["redemption_rule"] = raw.get("redemption_rule") or default_redemption_rule(ptype)
    if raw["redemption_rule"] not in REDEMPTION_RULES:
        raw["redemption_rule"] = default_redemption_rule(ptype)
    raw["unused_component_policy"] = raw.get("unused_component_policy") or default_unused_policy(ptype)
    if raw["unused_component_policy"] not in UNUSED_POLICIES:
        raw["unused_component_policy"] = default_unused_policy(ptype)
    comps = raw.get("components") or []
    raw["sessions_total"] = catalog_sessions_total(comps) if comps else int(raw.get("sessions_total") or 0)
    return raw
