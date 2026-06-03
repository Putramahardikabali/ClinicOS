"""Patient package balance and session usage tracking."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from package_engine import (
    PATIENT_PACKAGE_STATUSES,
    apply_patient_package_status,
    build_patient_components,
    catalog_validity,
    deduct_component,
    default_redemption_rule,
    default_unused_policy,
    find_eligible_component,
    list_eligible_packages_for_treatment,
    normalize_package_type,
    package_type_label,
    reverse_component_deduction,
    sync_legacy_session_fields,
)

USAGE_STATUSES = frozenset({"active", "reversed", "cancelled"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def compute_package_status(doc: dict, today: Optional[str] = None) -> str:
    return apply_patient_package_status(dict(doc), today).get("status", "active")


def _apply_status(doc: dict) -> dict:
    return apply_patient_package_status(doc)


async def catalog_sessions_and_validity(db, clinic_id: str, package_id: str, quantity: int = 1) -> tuple[int, str, str]:
    total, start, expiry, _ = await catalog_validity(db, clinic_id, package_id, quantity)
    return total, start, expiry


async def create_patient_packages_from_invoice(db, invoice: dict) -> Dict[str, int]:
    if (invoice.get("payment_status") or "") != "paid":
        return {"created": 0, "skipped": 0}
    clinic_id = invoice.get("clinic_id")
    patient_id = invoice.get("patient_id")
    if not clinic_id or not patient_id:
        return {"created": 0, "skipped": 0}

    created = 0
    skipped = 0
    now = _now_iso()
    for item in invoice.get("items") or []:
        if item.get("item_type") != "package":
            continue
        item_id = item.get("id")
        if not item_id:
            continue
        existing = await db.patient_packages.find_one(
            {"clinic_id": clinic_id, "invoice_item_id": item_id},
            {"_id": 0, "id": 1},
        )
        if existing:
            skipped += 1
            continue
        catalog_id = item.get("catalog_id")
        if not catalog_id:
            skipped += 1
            continue

        qty = max(1, int(item.get("quantity") or 1))
        _, start_date, expiry_date, catalog = await catalog_validity(db, clinic_id, catalog_id, qty)
        if not catalog:
            skipped += 1
            continue

        ptype = normalize_package_type(catalog.get("package_type"))
        components = build_patient_components(catalog, qty)
        total_sessions = sum(int(c.get("total_quantity") or 0) for c in components)

        doc = _apply_status({
            "id": str(uuid.uuid4()),
            "clinic_id": clinic_id,
            "patient_id": patient_id,
            "package_id": catalog_id,
            "invoice_id": invoice.get("id"),
            "invoice_item_id": item_id,
            "package_name_snapshot": item.get("name") or catalog.get("name") or "Package",
            "package_type": ptype,
            "package_type_label": package_type_label(ptype),
            "redemption_rule": catalog.get("redemption_rule") or default_redemption_rule(ptype),
            "unused_component_policy": catalog.get("unused_component_policy") or default_unused_policy(ptype),
            "components": components,
            "total_sessions": total_sessions,
            "used_sessions": 0,
            "remaining_sessions": total_sessions,
            "start_date": start_date,
            "expiry_date": expiry_date,
            "first_redemption_date": None,
            "status": "active",
            "purchase_price_snapshot": int(item.get("line_total_idr") or item.get("unit_price_idr") or 0),
            "notes": "",
            "created_at": now,
            "updated_at": now,
        })
        await db.patient_packages.insert_one(doc)
        created += 1
    return {"created": created, "skipped": skipped}


async def create_patient_packages_from_pos_sale(db, sale: dict) -> Dict[str, int]:
    """Create patient package balances after a paid POS package line (no visit/booking)."""
    if (sale.get("status") or "") != "paid":
        return {"created": 0, "skipped": 0}
    clinic_id = sale.get("clinic_id")
    patient_id = sale.get("patient_id")
    if not clinic_id or not patient_id:
        return {"created": 0, "skipped": 0}

    created = 0
    skipped = 0
    now = _now_iso()
    for item in sale.get("items") or []:
        if item.get("item_type") != "package":
            continue
        item_id = item.get("id")
        if not item_id:
            continue
        existing = await db.patient_packages.find_one(
            {"clinic_id": clinic_id, "pos_sale_item_id": item_id},
            {"_id": 0, "id": 1},
        )
        if existing:
            skipped += 1
            continue
        catalog_id = item.get("package_catalog_id")
        if not catalog_id:
            skipped += 1
            continue

        qty = max(1, int(float(item.get("qty") or 1)))
        _, start_date, expiry_date, catalog = await catalog_validity(db, clinic_id, catalog_id, qty)
        if not catalog:
            skipped += 1
            continue

        ptype = normalize_package_type(catalog.get("package_type"))
        components = build_patient_components(catalog, qty)
        total_sessions = sum(int(c.get("total_quantity") or 0) for c in components)
        line_total = int(item.get("total") or 0)
        unit_price = int(item.get("unit_price") or 0)

        doc = _apply_status({
            "id": str(uuid.uuid4()),
            "clinic_id": clinic_id,
            "patient_id": patient_id,
            "package_id": catalog_id,
            "invoice_id": None,
            "invoice_item_id": None,
            "pos_sale_id": sale.get("id"),
            "pos_sale_item_id": item_id,
            "package_name_snapshot": item.get("name_snapshot") or catalog.get("name") or "Package",
            "package_type": ptype,
            "package_type_label": package_type_label(ptype),
            "redemption_rule": catalog.get("redemption_rule") or default_redemption_rule(ptype),
            "unused_component_policy": catalog.get("unused_component_policy") or default_unused_policy(ptype),
            "components": components,
            "total_sessions": total_sessions,
            "used_sessions": 0,
            "remaining_sessions": total_sessions,
            "start_date": start_date,
            "expiry_date": expiry_date,
            "first_redemption_date": None,
            "status": "active",
            "purchase_price_snapshot": line_total or unit_price,
            "notes": "",
            "created_at": now,
            "updated_at": now,
        })
        await db.patient_packages.insert_one(doc)
        created += 1
    return {"created": created, "skipped": skipped}


async def create_patient_package_from_gift_card_redemption(
    db,
    *,
    clinic_id: str,
    patient_id: str,
    gift_card: dict,
    redemption_id: str,
) -> Optional[str]:
    """Assign package catalog from a redeemed package gift card to a patient."""
    if (gift_card.get("gift_card_type") or "") != "package":
        return None
    catalog_id = gift_card.get("package_catalog_id")
    if not catalog_id:
        return None
    existing = await db.patient_packages.find_one(
        {
            "clinic_id": clinic_id,
            "gift_card_id": gift_card.get("id"),
            "status": {"$nin": ["cancelled"]},
        },
        {"_id": 0, "id": 1, "status": 1, "used_sessions": 1},
    )
    if existing:
        return existing.get("id")

    qty = 1
    _, start_date, expiry_date, catalog = await catalog_validity(db, clinic_id, catalog_id, qty)
    if not catalog:
        return None

    now = _now_iso()
    ptype = normalize_package_type(catalog.get("package_type"))
    components = build_patient_components(catalog, qty)
    total_sessions = sum(int(c.get("total_quantity") or 0) for c in components)
    face_value = int(gift_card.get("original_value") or 0)

    doc = _apply_status({
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "package_id": catalog_id,
        "invoice_id": None,
        "invoice_item_id": None,
        "pos_sale_id": gift_card.get("issued_sale_id"),
        "pos_sale_item_id": gift_card.get("issued_sale_item_id"),
        "gift_card_id": gift_card.get("id"),
        "gift_card_redemption_id": redemption_id,
        "package_name_snapshot": gift_card.get("package_name_snapshot") or catalog.get("name") or "Package",
        "package_type": ptype,
        "package_type_label": package_type_label(ptype),
        "redemption_rule": catalog.get("redemption_rule") or default_redemption_rule(ptype),
        "unused_component_policy": catalog.get("unused_component_policy") or default_unused_policy(ptype),
        "components": components,
        "total_sessions": total_sessions,
        "used_sessions": 0,
        "remaining_sessions": total_sessions,
        "start_date": start_date,
        "expiry_date": expiry_date,
        "first_redemption_date": None,
        "status": "active",
        "purchase_price_snapshot": face_value,
        "notes": "Created from package gift card redemption",
        "created_at": now,
        "updated_at": now,
    })
    await db.patient_packages.insert_one(doc)
    return doc["id"]


async def cancel_unused_patient_packages_for_gift_card(
    db,
    clinic_id: str,
    gift_card_id: str,
    *,
    reason: str = "gift_card_reservation_released",
) -> int:
    """Cancel patient packages issued for a gift card that were never used (booking cancelled)."""
    now = _now_iso()
    cancelled = 0
    cursor = db.patient_packages.find(
        {
            "clinic_id": clinic_id,
            "gift_card_id": gift_card_id,
            "status": {"$in": ["active", "partially_used"]},
        },
        {"_id": 0},
    )
    async for pkg in cursor:
        used = int(pkg.get("used_sessions") or 0)
        if used > 0:
            continue
        usages = await db.package_usage.count_documents(
            {
                "clinic_id": clinic_id,
                "patient_package_id": pkg["id"],
                "status": "active",
            },
        )
        if usages > 0:
            continue
        note = (pkg.get("notes") or "").strip()
        suffix = f" [{reason}]"
        await db.patient_packages.update_one(
            {"id": pkg["id"]},
            {"$set": {
                "status": "cancelled",
                "updated_at": now,
                "notes": (note + suffix).strip() if note else reason,
            }},
        )
        cancelled += 1
    return cancelled


async def _load_active_usages(db, clinic_id: str, patient_package_id: str) -> List[dict]:
    return await db.package_usage.find(
        {"clinic_id": clinic_id, "patient_package_id": patient_package_id, "status": "active"},
        {"_id": 0},
    ).to_list(200)


async def apply_package_to_invoice_line(
    db,
    user: dict,
    invoice: dict,
    item_id: str,
    patient_package_id: str,
    used_sessions_count: int = 1,
    notes: str = "",
    patient_package_component_id: Optional[str] = None,
    audit=None,
) -> dict:
    clinic_id = user.get("clinic_id")
    pkg = await db.patient_packages.find_one(
        {"clinic_id": clinic_id, "id": patient_package_id},
        {"_id": 0},
    )
    if not pkg:
        raise HTTPException(status_code=404, detail="Patient package not found")
    if pkg.get("patient_id") != invoice.get("patient_id"):
        raise HTTPException(status_code=400, detail="Package belongs to a different patient")

    pkg = _apply_status(pkg)
    if pkg.get("status") not in ("active", "partially_used"):
        raise HTTPException(status_code=400, detail=f"Package is {pkg.get('status')} and cannot be used")

    items = list(invoice.get("items") or [])
    item = next((it for it in items if it.get("id") == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Invoice line not found")
    if item.get("paid_by") == "package":
        raise HTTPException(status_code=400, detail="Line is already paid by package")

    count = max(1, int(used_sessions_count or 1))
    treatment_id = item.get("catalog_id") if item.get("item_type") == "treatment" else None
    treatment_name = item.get("name") or ""
    visit_date = None
    if invoice.get("visit_id"):
        visit = await db.visits.find_one({"id": invoice.get("visit_id")}, {"_id": 0, "visit_date": 1})
        visit_date = (visit or {}).get("visit_date") or _now_iso()

    active_usages = await _load_active_usages(db, clinic_id, patient_package_id)
    component = find_eligible_component(
        pkg,
        treatment_id,
        treatment_name,
        visit_date=visit_date,
        active_usages=active_usages,
        component_id=patient_package_component_id,
    )

    if not component and int(pkg.get("remaining_sessions") or 0) < count:
        raise HTTPException(status_code=400, detail="Not enough remaining package balance")

    qty = int(item.get("quantity") or 1)
    unit = int(item.get("unit_price_idr") or 0)
    treatment_value = int(item.get("original_treatment_value") or unit * qty)

    now = _now_iso()
    if component:
        pkg = deduct_component(pkg, component, count, active_usages=active_usages, visit_date=visit_date)
    else:
        used = int(pkg.get("used_sessions") or 0) + count
        pkg = _apply_status({
            **pkg,
            "used_sessions": used,
            "remaining_sessions": max(0, int(pkg.get("total_sessions") or 0) - used),
            "updated_at": now,
        })

    usage = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "patient_package_id": patient_package_id,
        "patient_package_component_id": component.get("id") if component else None,
        "patient_id": pkg["patient_id"],
        "visit_id": invoice.get("visit_id"),
        "appointment_id": invoice.get("appointment_id"),
        "invoice_id": invoice.get("id"),
        "invoice_item_id": item_id,
        "package_type": pkg.get("package_type"),
        "treatment_id": treatment_id,
        "treatment_name_snapshot": treatment_name,
        "treatment_value_snapshot": treatment_value,
        "used_quantity": count,
        "used_sessions_count": count,
        "usage_date": now,
        "used_by_staff_id": user["id"],
        "notes": (notes or "").strip(),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await db.package_usage.insert_one(usage)
    await db.patient_packages.update_one(
        {"id": patient_package_id},
        {"$set": {
            "components": pkg.get("components"),
            "used_sessions": pkg.get("used_sessions"),
            "remaining_sessions": pkg.get("remaining_sessions"),
            "status": pkg.get("status"),
            "first_redemption_date": pkg.get("first_redemption_date"),
            "updated_at": now,
        }},
    )

    for idx, it in enumerate(items):
        if it.get("id") == item_id:
            items[idx] = {
                **it,
                "original_treatment_value": treatment_value,
                "amount_charged": 0,
                "line_total_idr": 0,
                "paid_by": "package",
                "patient_package_id": patient_package_id,
                "patient_package_component_id": component.get("id") if component else None,
                "package_usage_id": usage["id"],
            }
            break
    invoice["items"] = items

    if audit:
        await audit(
            user, "pay_with_package", "invoice", invoice.get("id"),
            {"item_id": item_id, "usage_id": usage["id"], "package_id": patient_package_id,
             "component_id": component.get("id") if component else None},
        )
    return invoice


async def cancel_patient_packages_for_pos_sale(db, sale: dict) -> int:
    """Cancel patient packages created from a paid POS package line if unused."""
    if (sale.get("status") or "") != "cancelled":
        return 0
    clinic_id = sale.get("clinic_id")
    sale_id = sale.get("id")
    if not clinic_id or not sale_id:
        return 0
    n = 0
    async for row in db.patient_packages.find(
        {
            "clinic_id": clinic_id,
            "pos_sale_id": sale_id,
            "status": {"$ne": "cancelled"},
        },
        {"_id": 0},
    ):
        if int(row.get("used_sessions") or 0) > 0:
            continue
        usages = await db.package_usage.count_documents(
            {
                "clinic_id": clinic_id,
                "patient_package_id": row["id"],
                "status": "active",
            },
        )
        if usages > 0:
            continue
        await db.patient_packages.update_one(
            {"id": row["id"]},
            {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        )
        n += 1
    return n


async def cancel_patient_packages_for_invoice(db, invoice: dict) -> int:
    if (invoice.get("payment_status") or "") not in ("cancelled", "refunded"):
        return 0
    n = 0
    async for row in db.patient_packages.find(
        {"clinic_id": invoice.get("clinic_id"), "invoice_id": invoice.get("id"), "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ):
        if int(row.get("used_sessions") or 0) > 0:
            continue
        await db.patient_packages.update_one(
            {"id": row["id"]},
            {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        )
        n += 1
    return n


class PackageUsageIn(BaseModel):
    visit_id: Optional[str] = None
    appointment_id: Optional[str] = None
    invoice_id: Optional[str] = None
    invoice_item_id: Optional[str] = None
    treatment_id: Optional[str] = None
    treatment_name: Optional[str] = None
    patient_package_component_id: Optional[str] = None
    used_sessions_count: int = 1
    notes: str = ""


class PatientPackageAdjustIn(BaseModel):
    total_sessions: Optional[int] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class EligiblePackagesQuery(BaseModel):
    treatment_id: Optional[str] = None
    treatment_name: Optional[str] = None
    visit_id: Optional[str] = None


def register_patient_packages(
    api: APIRouter,
    db,
    get_current_user,
    require_roles,
    require_permission,
    require_any_permission,
    assert_writeable,
    assert_feature,
    audit,
    scope,
):
    async def _get_pkg(user: dict, pkg_id: str) -> dict:
        doc = await db.patient_packages.find_one(scope(user, {"id": pkg_id}), {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Patient package not found")
        return _apply_status(doc)

    async def _usage_history(pkg_id: str) -> List[dict]:
        return await db.package_usage.find(
            {"patient_package_id": pkg_id},
            {"_id": 0},
        ).sort("usage_date", -1).to_list(500)

    async def _assert_patient_package_view(user: dict, patient_id: str) -> None:
        from server import assert_patient_access

        p = await db.patients.find_one(scope(user, {"id": patient_id}), {"_id": 0, "id": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, patient_id)

    @api.get("/patients/{patient_id}/patient-packages")
    async def list_patient_packages(
        patient_id: str,
        user: dict = Depends(require_permission("packages.view")),
        status: Optional[str] = None,
    ):
        await _assert_patient_package_view(user, patient_id)
        await assert_feature(user, "emr")
        flt = scope(user, {"patient_id": patient_id})
        if status:
            flt["status"] = status
        rows = await db.patient_packages.find(flt, {"_id": 0}).sort("created_at", -1).to_list(200)
        out = []
        for row in rows:
            row = _apply_status(row)
            row["usage_history"] = await _usage_history(row["id"])
            out.append(row)
        return out

    @api.post("/patients/{patient_id}/patient-packages/eligible")
    async def eligible_patient_packages(
        patient_id: str,
        payload: EligiblePackagesQuery,
        user: dict = Depends(require_permission("packages.view")),
    ):
        await _assert_patient_package_view(user, patient_id)
        await assert_feature(user, "emr")
        rows = await db.patient_packages.find(
            scope(user, {"patient_id": patient_id}),
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        rows = [_apply_status(r) for r in rows]
        visit_date = None
        if payload.visit_id:
            visit = await db.visits.find_one(scope(user, {"id": payload.visit_id}), {"_id": 0, "visit_date": 1})
            visit_date = (visit or {}).get("visit_date")
        usages = await db.package_usage.find(
            scope(user, {"patient_id": patient_id, "status": "active"}),
            {"_id": 0},
        ).to_list(500)
        return list_eligible_packages_for_treatment(
            rows,
            payload.treatment_id,
            payload.treatment_name,
            visit_date=visit_date,
            active_usages=usages,
        )

    @api.get("/patient-packages/{pkg_id}")
    async def get_patient_package(
        pkg_id: str,
        user: dict = Depends(require_permission("packages.view")),
    ):
        await assert_feature(user, "emr")
        doc = await _get_pkg(user, pkg_id)
        await _assert_patient_package_view(user, doc["patient_id"])
        doc["usage_history"] = await _usage_history(pkg_id)
        return doc

    @api.post("/patient-packages/{pkg_id}/use")
    async def use_patient_package_session(
        pkg_id: str,
        payload: PackageUsageIn,
        user: dict = Depends(require_permission("packages.use")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "emr")
        if payload.invoice_id and payload.invoice_item_id:
            inv = await db.invoices.find_one(scope(user, {"id": payload.invoice_id}), {"_id": 0})
            if not inv:
                raise HTTPException(status_code=404, detail="Invoice not found")
            inv = await apply_package_to_invoice_line(
                db, user, inv, payload.invoice_item_id, pkg_id,
                used_sessions_count=payload.used_sessions_count,
                notes=payload.notes,
                patient_package_component_id=payload.patient_package_component_id,
                audit=audit,
            )
            from invoices import _apply_totals_and_payment
            inv = _apply_totals_and_payment(inv)
            inv["updated_at"] = _now_iso()
            await db.invoices.update_one({"id": inv["id"]}, {"$set": inv})
            return {"invoice": inv, "package": await _get_pkg(user, pkg_id)}

        pkg = await _get_pkg(user, pkg_id)
        if pkg.get("status") not in ("active", "partially_used"):
            raise HTTPException(status_code=400, detail=f"Package is {pkg['status']} and cannot be used")

        old_snap = {
            "remaining_sessions": pkg.get("remaining_sessions"),
            "used_sessions": pkg.get("used_sessions"),
            "status": pkg.get("status"),
        }
        count = max(1, int(payload.used_sessions_count or 1))
        active_usages = await _load_active_usages(db, user.get("clinic_id"), pkg_id)
        component = find_eligible_component(
            pkg,
            payload.treatment_id,
            payload.treatment_name,
            visit_date=payload.visit_id and _now_iso(),
            active_usages=active_usages,
            component_id=payload.patient_package_component_id,
        )
        if component:
            pkg = deduct_component(pkg, component, count, active_usages=active_usages)
        elif int(pkg.get("remaining_sessions") or 0) < count:
            raise HTTPException(status_code=400, detail="Not enough remaining sessions")

        treatment_name = (payload.treatment_name or "").strip()
        if payload.treatment_id and not treatment_name:
            t = await db.treatments.find_one(
                {"clinic_id": user.get("clinic_id"), "$or": [{"id": payload.treatment_id}, {"key": payload.treatment_id}]},
                {"_id": 0, "name": 1},
            )
            treatment_name = (t or {}).get("name") or ""

        now = _now_iso()
        usage = {
            "id": str(uuid.uuid4()),
            "clinic_id": user.get("clinic_id"),
            "patient_package_id": pkg_id,
            "patient_package_component_id": component.get("id") if component else None,
            "patient_id": pkg["patient_id"],
            "visit_id": payload.visit_id,
            "appointment_id": payload.appointment_id,
            "invoice_id": payload.invoice_id,
            "invoice_item_id": payload.invoice_item_id,
            "package_type": pkg.get("package_type"),
            "treatment_id": payload.treatment_id,
            "treatment_name_snapshot": treatment_name,
            "treatment_value_snapshot": 0,
            "used_quantity": count,
            "used_sessions_count": count,
            "usage_date": now,
            "used_by_staff_id": user["id"],
            "notes": (payload.notes or "").strip(),
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        await db.package_usage.insert_one(usage)
        if not component:
            used = int(pkg.get("used_sessions") or 0) + count
            pkg = _apply_status({**pkg, "used_sessions": used, "remaining_sessions": max(0, int(pkg["total_sessions"]) - used)})
        await db.patient_packages.update_one({"id": pkg_id}, {"$set": {
            "components": pkg.get("components"),
            "used_sessions": pkg.get("used_sessions"),
            "remaining_sessions": pkg.get("remaining_sessions"),
            "status": pkg.get("status"),
            "first_redemption_date": pkg.get("first_redemption_date"),
            "updated_at": now,
        }})
        from audit_log import log_package_balance
        updated_pkg = await _get_pkg(user, pkg_id)
        await log_package_balance(
            db, user, "used", pkg_id,
            old_value=old_snap,
            new_value={
                "remaining_sessions": updated_pkg.get("remaining_sessions"),
                "used_sessions": updated_pkg.get("used_sessions"),
                "status": updated_pkg.get("status"),
            },
            record_id=usage["id"],
        )
        remaining = int(updated_pkg.get("remaining_sessions") or 0)
        if remaining == 1:
            try:
                import os
                from messaging import safe_trigger_messaging_event

                patient = None
                if updated_pkg.get("patient_id"):
                    patient = await db.patients.find_one(
                        {"id": updated_pkg["patient_id"], "clinic_id": user["clinic_id"]},
                        {"_id": 0},
                    )
                safe_trigger_messaging_event(
                    db,
                    os.environ.get("JWT_SECRET", ""),
                    user["clinic_id"],
                    "package_balance_reminder",
                    package=updated_pkg,
                    patient=patient,
                    reference_type="patient_package",
                    reference_id=pkg_id,
                )
            except Exception:
                pass
        usage.pop("_id", None)
        return {"usage": usage, "package": updated_pkg}

    @api.post("/package-usage/{usage_id}/reverse")
    async def reverse_package_usage(
        usage_id: str,
        user: dict = Depends(require_permission("packages.adjust")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "emr")
        usage = await db.package_usage.find_one(scope(user, {"id": usage_id}), {"_id": 0})
        if not usage:
            raise HTTPException(status_code=404, detail="Usage record not found")
        if usage.get("status") != "active":
            raise HTTPException(status_code=400, detail="Only active usage can be reversed")

        pkg = await _get_pkg(user, usage["patient_package_id"])
        if pkg.get("status") == "cancelled":
            raise HTTPException(status_code=400, detail="Package is cancelled")

        old_snap = {
            "remaining_sessions": pkg.get("remaining_sessions"),
            "used_sessions": pkg.get("used_sessions"),
            "status": pkg.get("status"),
        }
        now = _now_iso()
        await db.package_usage.update_one(
            {"id": usage_id},
            {"$set": {"status": "reversed", "updated_at": now}},
        )
        pkg = reverse_component_deduction(pkg, usage)
        await db.patient_packages.update_one({"id": pkg["id"]}, {"$set": {
            "components": pkg.get("components"),
            "used_sessions": pkg.get("used_sessions"),
            "remaining_sessions": pkg.get("remaining_sessions"),
            "status": pkg.get("status"),
            "updated_at": now,
        }})
        from invoices import restore_invoice_line_for_reversed_usage
        await restore_invoice_line_for_reversed_usage(db, user.get("clinic_id"), usage)
        from audit_log import log_package_balance
        updated_pkg = await _get_pkg(user, pkg["id"])
        await log_package_balance(
            db, user, "reversed", pkg["id"],
            old_value=old_snap,
            new_value={
                "remaining_sessions": updated_pkg.get("remaining_sessions"),
                "used_sessions": updated_pkg.get("used_sessions"),
                "status": updated_pkg.get("status"),
            },
            record_id=usage_id,
        )
        return updated_pkg

    @api.put("/patient-packages/{pkg_id}")
    async def adjust_patient_package(
        pkg_id: str,
        payload: PatientPackageAdjustIn,
        user: dict = Depends(require_permission("packages.adjust")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "emr")
        pkg = await _get_pkg(user, pkg_id)
        old_snap = {
            "total_sessions": pkg.get("total_sessions"),
            "remaining_sessions": pkg.get("remaining_sessions"),
            "expiry_date": pkg.get("expiry_date"),
            "status": pkg.get("status"),
            "notes": pkg.get("notes"),
        }
        data = payload.model_dump(exclude_none=True)
        if "total_sessions" in data:
            total = max(int(data["total_sessions"]), int(pkg.get("used_sessions") or 0))
            pkg["total_sessions"] = total
            if pkg.get("components") and len(pkg["components"]) == 1:
                comp = dict(pkg["components"][0])
                comp["total_quantity"] = total
                comp["remaining_quantity"] = max(0, total - int(comp.get("used_quantity") or 0))
                pkg["components"][0] = comp
        if "expiry_date" in data:
            pkg["expiry_date"] = data["expiry_date"]
        if "notes" in data:
            pkg["notes"] = data["notes"]
        if "status" in data and data["status"] in PATIENT_PACKAGE_STATUSES:
            pkg["status"] = data["status"]
        pkg = _apply_status(pkg)
        pkg["updated_at"] = _now_iso()
        await db.patient_packages.update_one({"id": pkg_id}, {"$set": pkg})
        from audit_log import log_package_balance
        await log_package_balance(
            db, user, "adjusted", pkg_id,
            old_value=old_snap,
            new_value={
                "total_sessions": pkg.get("total_sessions"),
                "remaining_sessions": pkg.get("remaining_sessions"),
                "expiry_date": pkg.get("expiry_date"),
                "status": pkg.get("status"),
                "notes": pkg.get("notes"),
            },
            reason=(data.get("notes") or "").strip(),
        )
        return pkg

    @api.post("/patient-packages/{pkg_id}/cancel")
    async def cancel_patient_package(
        pkg_id: str,
        user: dict = Depends(require_permission("packages.adjust")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "emr")
        pkg = await _get_pkg(user, pkg_id)
        old_snap = {"status": pkg.get("status"), "remaining_sessions": pkg.get("remaining_sessions")}
        await db.patient_packages.update_one(
            {"id": pkg_id},
            {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        )
        from audit_log import log_package_balance
        await log_package_balance(
            db, user, "cancelled", pkg_id,
            old_value=old_snap,
            new_value={"status": "cancelled"},
        )
        return await _get_pkg(user, pkg_id)

    @api.get("/patient-packages/reports/summary")
    async def patient_package_reports(
        user: dict = Depends(require_any_permission("reports.view", "packages.report")),
        expiring_days: int = Query(30, ge=1, le=365),
    ):
        await assert_feature(user, "emr")
        cid = user.get("clinic_id")
        today = _today_str()
        exp_cutoff = (datetime.now(timezone.utc).date() + timedelta(days=expiring_days)).strftime("%Y-%m-%d")

        all_rows = await db.patient_packages.find({"clinic_id": cid}, {"_id": 0}).to_list(5000)
        refreshed = []
        for row in all_rows:
            original_status = row.get("status")
            row = _apply_status(row)
            if row.get("status") != original_status:
                await db.patient_packages.update_one(
                    {"id": row["id"]},
                    {"$set": {
                        "status": row["status"],
                        "remaining_sessions": row.get("remaining_sessions"),
                        "components": row.get("components"),
                    }},
                )
            refreshed.append(row)
        all_rows = refreshed

        active = [r for r in all_rows if r.get("status") == "active"]
        partially_used = [r for r in all_rows if r.get("status") == "partially_used"]
        used_up = [r for r in all_rows if r.get("status") == "used_up"]
        expired = [r for r in all_rows if r.get("status") == "expired"]
        expiring_soon = [
            r for r in all_rows
            if r.get("status") in ("active", "partially_used")
            and r.get("expiry_date") and r["expiry_date"] <= exp_cutoff
        ]
        remaining_sessions = sum(int(r.get("remaining_sessions") or 0) for r in active + partially_used)

        sales_by_type: Dict[str, int] = {}
        usage_by_type: Dict[str, int] = {}
        component_remaining: List[dict] = []

        usage_rows = await db.package_usage.find(
            {"clinic_id": cid, "status": "active"},
            {"_id": 0},
        ).sort("usage_date", -1).to_list(500)

        for u in usage_rows:
            ptype = u.get("package_type") or "series_package"
            usage_by_type[ptype] = usage_by_type.get(ptype, 0) + int(u.get("used_quantity") or 1)

        async for inv in db.invoices.find({"clinic_id": cid, "payment_status": "paid"}, {"_id": 0, "items": 1}):
            for it in inv.get("items") or []:
                if it.get("item_type") != "package":
                    continue
                cat = await db.packages.find_one({"id": it.get("catalog_id")}, {"_id": 0, "package_type": 1})
                ptype = (cat or {}).get("package_type") or "series_package"
                sales_by_type[ptype] = sales_by_type.get(ptype, 0) + int(it.get("line_total_idr") or 0)

        for row in all_rows:
            if row.get("status") not in ("active", "partially_used"):
                continue
            for comp in row.get("components") or []:
                rem = int(comp.get("remaining_quantity") or 0)
                if rem > 0:
                    component_remaining.append({
                        "patient_package_id": row["id"],
                        "package_name": row.get("package_name_snapshot"),
                        "package_type": row.get("package_type"),
                        "treatment_name": comp.get("treatment_name_snapshot"),
                        "remaining_quantity": rem,
                        "total_quantity": comp.get("total_quantity"),
                    })

        package_sales = sum(sales_by_type.values())
        sessions_used = sum(int(u.get("used_quantity") or u.get("used_sessions_count") or 1) for u in usage_rows)
        usage_service_value = sum(int(u.get("treatment_value_snapshot") or 0) for u in usage_rows)

        return {
            "active_count": len(active),
            "partially_used_count": len(partially_used),
            "used_up_count": len(used_up),
            "expired_count": len(expired),
            "expiring_soon_count": len(expiring_soon),
            "remaining_sessions_total": remaining_sessions,
            "package_sales_revenue_idr": package_sales,
            "package_sales_by_type": sales_by_type,
            "package_usage_by_type": usage_by_type,
            "package_sessions_used": sessions_used,
            "package_usage_service_value_idr": usage_service_value,
            "component_remaining": component_remaining[:100],
            "active_packages": (active + partially_used)[:50],
            "expiring_soon": expiring_soon[:50],
            "recent_usage": usage_rows[:50],
        }
