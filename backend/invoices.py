"""Visit invoices — FO checkout without touching clinical records."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from invoice_quantity import (
    coerce_invoice_items_for_api,
    invoice_items_need_quantity_persist,
    line_gross_idr,
    resolve_invoice_line_quantity,
    treatment_item_quantity,
)

PAYMENT_STATUSES = frozenset({"unpaid", "partial", "paid", "cancelled", "refunded"})
DISCOUNT_TYPES = frozenset({"none", "percentage", "fixed"})
ITEM_TYPES = frozenset({"treatment", "package", "product", "custom"})
PAID_BY_VALUES = frozenset({
    "cash", "card", "bank_transfer", "package", "mixed", "other",
    "debit_card", "credit_card", "qris", "e_wallet",
})
PAYMENT_METHODS = frozenset({
    "cash", "card", "bank_transfer", "package", "mixed", "other",
    "debit_card", "credit_card", "qris", "e_wallet", "gift_card", "store_credit",
})

INVOICE_WRITE_ROLES = ("super_admin", "fo")
INVOICE_VIEW_ROLES = ("super_admin", "fo", "manager", "doctor", "therapist", "nurse")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _item_line_total(item: dict) -> int:
    qty = resolve_invoice_line_quantity(item)
    from invoice_quantity import _line_unit_price_idr
    return line_gross_idr(int(_line_unit_price_idr(item)), qty)


def _item_gross_value(item: dict) -> int:
    """Catalog / service value before package coverage."""
    if item.get("original_treatment_value") is not None:
        return int(item.get("original_treatment_value") or 0)
    return _item_line_total(item)


def _item_cash_due(item: dict) -> int:
    """Cash still due for this line (0 when covered by prepaid package)."""
    if item.get("paid_by") == "package":
        return 0
    if item.get("amount_charged") is not None:
        return max(0, int(item.get("amount_charged") or 0))
    return _item_line_total(item)


def _finalize_item_billing_fields(item: dict) -> dict:
    from invoice_quantity import _line_unit_price_idr

    qty = resolve_invoice_line_quantity(item)
    unit = int(_line_unit_price_idr(item))
    gross = line_gross_idr(unit, qty)
    item["quantity"] = qty
    paid_by = (item.get("paid_by") or "").strip().lower() or None
    if paid_by and paid_by not in PAID_BY_VALUES:
        paid_by = None

    if item.get("item_type") == "treatment" and item.get("original_treatment_value") is None:
        item["original_treatment_value"] = gross

    if paid_by == "package":
        if not item.get("original_treatment_value"):
            item["original_treatment_value"] = gross
        item["amount_charged"] = 0
        item["line_total_idr"] = 0
        item["paid_by"] = "package"
    else:
        if item.get("amount_charged") is None:
            item["amount_charged"] = gross
        item["line_total_idr"] = int(item.get("amount_charged") or 0)
        item["paid_by"] = paid_by or item.get("paid_by") or None
        if item.get("paid_by") not in PAID_BY_VALUES:
            item["paid_by"] = None

    return item


def compute_invoice_totals(
    items: List[dict],
    discount_type: str,
    discount_value: float,
) -> Dict[str, int]:
    cash_subtotal = sum(_item_cash_due(it) for it in items)
    service_value_subtotal = sum(_item_gross_value(it) for it in items)
    package_covered_value = sum(
        _item_gross_value(it) for it in items if it.get("paid_by") == "package"
    )
    discount_type = discount_type if discount_type in DISCOUNT_TYPES else "none"
    discount_amount = 0
    if discount_type == "percentage":
        discount_amount = int(round(cash_subtotal * float(discount_value or 0) / 100))
    elif discount_type == "fixed":
        discount_amount = int(float(discount_value or 0))
    discount_amount = max(0, min(discount_amount, cash_subtotal))
    total_amount = cash_subtotal - discount_amount
    return {
        "subtotal": cash_subtotal,
        "service_value_subtotal": service_value_subtotal,
        "package_covered_value": package_covered_value,
        "discount_amount": discount_amount,
        "total_amount": total_amount,
    }


def derive_payment_status(amount_paid: int, total_amount: int, current: str = "unpaid") -> str:
    if current in ("cancelled", "refunded"):
        return current
    amount_paid = int(amount_paid or 0)
    total_amount = int(total_amount or 0)
    if amount_paid <= 0:
        return "unpaid"
    if amount_paid >= total_amount:
        return "paid"
    return "partial"


async def lookup_performer_snapshot(db, clinic_id: str, performer_id: str) -> Dict[str, str]:
    user = await lookup_staff_performer(db, clinic_id, performer_id)
    return {
        "performer_id": user["id"],
        "performer_name_snapshot": (user.get("name") or "").strip() or "Staff",
        "performer_role_snapshot": user.get("role") or "",
    }


async def lookup_staff_performer(db, clinic_id: str, staff_id: str) -> dict:
    from performers import lookup_staff_performer as _lookup
    return await _lookup(db, clinic_id, staff_id)


async def resolve_visit_default_performer(db, clinic_id: str, visit: dict) -> Optional[Dict[str, str]]:
    from performers import get_performers, primary_performer_id

    performers = get_performers(visit)
    performer_id = primary_performer_id({"performers": performers, "performer_id": visit.get("performer_id")})
    if not performer_id and visit.get("booking_id"):
        booking = await db.bookings.find_one(
            {"id": visit["booking_id"], "clinic_id": clinic_id},
            {"_id": 0, "performer_id": 1, "performers": 1},
        )
        if booking:
            performer_id = primary_performer_id(booking)
    if not performer_id:
        return None
    return await lookup_performer_snapshot(db, clinic_id, performer_id)


async def _visit_performers(db, clinic_id: str, visit: dict) -> List[dict]:
    from performers import get_performers

    performers = get_performers(visit)
    if performers:
        return performers
    if visit.get("booking_id"):
        booking = await db.bookings.find_one(
            {"id": visit["booking_id"], "clinic_id": clinic_id},
            {"_id": 0, "performers": 1, "performer_id": 1},
        )
        if booking:
            return get_performers(booking)
    return []


async def _merge_visit_lines_into_invoice(
    db,
    clinic_id: str,
    existing_items: List[dict],
    visit_lines: List[dict],
    default_performer: Optional[dict],
) -> List[dict]:
    """Sync treatment quantities/prices from visit lines into invoice items; preserve package/custom lines."""
    by_treatment_id = {
        vl["treatment_item_id"]: vl
        for vl in visit_lines
        if vl.get("treatment_item_id")
    }
    by_name: Dict[str, List[dict]] = {}
    for vl in visit_lines:
        name_key = (vl.get("name") or "").strip().lower()
        by_name.setdefault(name_key, []).append(vl)

    used_visit_ids: set = set()
    merged: List[dict] = []

    for ex in existing_items or []:
        if ex.get("paid_by") == "package":
            merged.append(ex)
            continue

        src = None
        ti_id = ex.get("treatment_item_id")
        name_key = (ex.get("name") or "").strip().lower()
        if ti_id and ti_id in by_treatment_id and ti_id not in used_visit_ids:
            src = by_treatment_id[ti_id]
            used_visit_ids.add(ti_id)
        elif name_key and by_name.get(name_key):
            src = by_name[name_key].pop(0)
            if src.get("treatment_item_id"):
                used_visit_ids.add(src["treatment_item_id"])

        if src and (ex.get("item_type") or "treatment") in ("treatment", "custom"):
            row = {
                **ex,
                "item_type": ex.get("item_type") or "treatment",
                "name": src.get("name") or ex.get("name"),
                "catalog_id": src.get("catalog_id") or ex.get("catalog_id"),
                "unit_price_idr": src.get("unit_price_idr", ex.get("unit_price_idr")),
                "quantity": src.get("quantity"),
                "treatment_item_id": src.get("treatment_item_id") or ex.get("treatment_item_id"),
                "performers": src.get("performers") or ex.get("performers"),
            }
            row.pop("amount_charged", None)
            row.pop("original_treatment_value", None)
            merged.append(
                await normalize_invoice_item(
                    db, clinic_id, row, line_id=ex.get("id"), default_performer=default_performer,
                )
            )
        else:
            merged.append(
                await normalize_invoice_item(
                    db, clinic_id, dict(ex), line_id=ex.get("id"), default_performer=default_performer,
                )
            )

    for vl in visit_lines:
        ti_id = vl.get("treatment_item_id")
        if ti_id and ti_id in used_visit_ids:
            continue
        name_key = (vl.get("name") or "").strip().lower()
        already = any(
            (m.get("treatment_item_id") == ti_id)
            or ((m.get("name") or "").strip().lower() == name_key and (m.get("item_type") or "treatment") == "treatment")
            for m in merged
        )
        if not already:
            merged.append(vl)
            if ti_id:
                used_visit_ids.add(ti_id)

    return merged


async def refresh_invoice_from_visit(db, clinic_id: str, inv: dict) -> dict:
    """Reconcile invoice line quantities with current visit treatment items."""
    if inv.get("payment_status") in ("cancelled", "refunded"):
        return inv
    visit_id = inv.get("visit_id")
    if not visit_id:
        return inv
    visit = await db.visits.find_one({"id": visit_id, "clinic_id": clinic_id}, {"_id": 0})
    if not visit:
        return inv
    visit_lines = await build_invoice_items_from_visit(db, clinic_id, visit)
    default_perf = await resolve_visit_default_performer(db, clinic_id, visit)
    inv["items"] = await _merge_visit_lines_into_invoice(
        db, clinic_id, inv.get("items") or [], visit_lines, default_perf,
    )
    return _apply_totals_and_payment(inv)


async def build_invoice_items_from_visit(db, clinic_id: str, visit: dict) -> List[dict]:
    """Map visit treatment lines (and booking fallback) to invoice items with performers."""
    from visit_workflow import _booking_line_price

    default_perf = await resolve_visit_default_performer(db, clinic_id, visit)
    performers = await _visit_performers(db, clinic_id, visit)
    treatment_items = await db.treatment_items.find(
        {"visit_id": visit["id"], "clinic_id": clinic_id},
        {"_id": 0},
    ).to_list(200)

    if not treatment_items and visit.get("booking_id"):
        booking = await db.bookings.find_one(
            {"id": visit["booking_id"], "clinic_id": clinic_id},
            {"_id": 0},
        )
        if booking:
            price = await _booking_line_price(db, booking, clinic_id)
            treatment_items = [{
                "name": booking.get("treatment") or visit.get("chief_complaint") or "Appointment",
                "quantity": 1,
                "price": price,
            }]

    items: List[dict] = []
    for ti in treatment_items:
        qty = treatment_item_quantity(ti)
        price = int(float(ti.get("price") or 0))
        name = (ti.get("name") or "").strip() or "Treatment"
        catalog_id = None
        tdoc = await db.treatments.find_one(
            {"clinic_id": clinic_id, "name": name},
            {"_id": 0, "id": 1, "price_idr": 1},
        )
        if tdoc:
            catalog_id = tdoc.get("id")
            if price <= 0:
                price = int(tdoc.get("price_idr") or 0)
        raw = {
            "item_type": "treatment",
            "catalog_id": catalog_id,
            "name": name,
            "unit_price_idr": max(0, price),
            "quantity": qty,
            "treatment_item_id": ti.get("id"),
            "performers": performers,
        }
        items.append(
            await normalize_invoice_item(
                db, clinic_id, raw, default_performer=default_perf,
            )
        )
    return items


async def ensure_invoice_for_visit(
    db,
    clinic_id: str,
    visit: dict,
    *,
    created_by: str,
) -> dict:
    """Create or refresh the visit invoice; populate line items from treatment records."""
    visit_id = visit["id"]
    existing = await db.invoices.find_one(
        {"clinic_id": clinic_id, "visit_id": visit_id, "payment_status": {"$nin": ["cancelled"]}},
        {"_id": 0},
    )
    line_items = await build_invoice_items_from_visit(db, clinic_id, visit)
    default_perf = await resolve_visit_default_performer(db, clinic_id, visit)

    if existing:
        if line_items or (existing.get("items") or []):
            existing["items"] = await _merge_visit_lines_into_invoice(
                db, clinic_id, existing.get("items") or [], line_items, default_perf,
            )
            existing = _apply_totals_and_payment(existing)
            existing["updated_at"] = _now_iso()
            await db.invoices.update_one({"id": existing["id"]}, {"$set": existing})
            await sync_visit_from_invoice(db, existing)
        return existing

    inv_id = str(uuid.uuid4())
    now = _now_iso()
    doc = {
        "id": inv_id,
        "clinic_id": clinic_id,
        "invoice_number": await next_invoice_number(db, clinic_id),
        "patient_id": visit.get("patient_id"),
        "visit_id": visit_id,
        "appointment_id": visit.get("booking_id"),
        "default_performer_id": (default_perf or {}).get("performer_id"),
        "default_performer_name_snapshot": (default_perf or {}).get("performer_name_snapshot", ""),
        "default_performer_role_snapshot": (default_perf or {}).get("performer_role_snapshot", ""),
        "items": line_items,
        "discount_type": "none",
        "discount_value": 0,
        "discount_amount": 0,
        "discount_reason": "",
        "subtotal": 0,
        "total_amount": 0,
        "amount_paid": 0,
        "remaining_balance": 0,
        "payment_status": "unpaid",
        "payment_method": "cash",
        "payment_reference": "",
        "gift_card_payment_total_idr": 0,
        "gift_card_redemptions": [],
        "payments": [],
        "notes": "",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "paid_at": None,
        "closed_at": None,
    }
    doc = _apply_totals_and_payment(doc)
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await sync_visit_from_invoice(db, doc)
    return doc


def default_performer_from_invoice(inv: dict) -> Optional[Dict[str, str]]:
    pid = inv.get("default_performer_id")
    if not pid:
        return None
    return {
        "performer_id": pid,
        "performer_name_snapshot": inv.get("default_performer_name_snapshot") or "",
        "performer_role_snapshot": inv.get("default_performer_role_snapshot") or "",
    }


async def normalize_invoice_item(
    db,
    clinic_id: str,
    raw: dict,
    line_id: Optional[str] = None,
    default_performer: Optional[dict] = None,
) -> dict:
    from performers import normalize_performers_input, primary_performer_id, sync_invoice_item_legacy

    qty = resolve_invoice_line_quantity(raw)
    price = int(raw.get("unit_price_idr") or 0)
    if price < 0:
        price = 0
    item_type = raw.get("item_type") or "custom"
    if item_type not in ITEM_TYPES:
        item_type = "custom"
    name = (raw.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Each line item needs a name")

    performer_id = (raw.get("performer_id") or "").strip() or None
    raw_performers = raw.get("performers")
    if item_type == "treatment":
        performers = await normalize_performers_input(
            db,
            clinic_id,
            raw_performers,
            legacy_performer_id=performer_id or (default_performer or {}).get("performer_id"),
            require_at_least_one=True,
            allow_multiple=True,
        )
        performer_id = primary_performer_id({"performers": performers})
    else:
        performers = []
        if performer_id:
            snap = await lookup_performer_snapshot(db, clinic_id, performer_id)
            from performers import build_performer_entry
            user = await lookup_staff_performer(db, clinic_id, performer_id)
            performers = [build_performer_entry(user, performer_type="primary")]

    item = {
        "id": line_id or raw.get("id") or str(uuid.uuid4()),
        "item_type": item_type,
        "catalog_id": raw.get("catalog_id"),
        "name": name,
        "unit_price_idr": price,
        "quantity": qty,
        "line_total_idr": line_gross_idr(price, qty),
        "performer_id": performer_id,
        "performer_name_snapshot": "",
        "performer_role_snapshot": "",
        "performers": performers,
    }

    sync_invoice_item_legacy(item)

    # Preserve package billing linkage from client / prior save
    for key in (
        "original_treatment_value", "amount_charged", "paid_by",
        "patient_package_id", "patient_package_component_id", "package_usage_id",
        "treatment_item_id",
    ):
        if key in raw and raw.get(key) is not None:
            item[key] = raw.get(key)

    return _finalize_item_billing_fields(item)


async def next_invoice_number(db, clinic_id: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = {"clinic_id": clinic_id, "date": today, "type": "invoice"}
    doc = await db.counters.find_one_and_update(
        key,
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = int(doc.get("seq") or 1)
    return f"INV-{today}-{seq:04d}"


async def snapshot_catalog_item(db, clinic_id: str, item_type: str, catalog_id: str) -> dict:
    if item_type == "treatment":
        row = await db.treatments.find_one({"id": catalog_id, "clinic_id": clinic_id}, {"_id": 0})
        if not row:
            row = await db.treatments.find_one({"key": catalog_id, "clinic_id": clinic_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Treatment not found")
        return {
            "item_type": "treatment",
            "catalog_id": catalog_id,
            "name": row.get("name") or "Treatment",
            "unit_price_idr": int(row.get("price_idr") or row.get("price") or 0),
            "quantity": 1,
        }
    if item_type == "package":
        row = await db.packages.find_one({"id": catalog_id, "clinic_id": clinic_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Package not found")
        return {
            "item_type": "package",
            "catalog_id": catalog_id,
            "name": row.get("name") or "Package",
            "unit_price_idr": int(row.get("price_idr") or 0),
            "quantity": 1,
        }
    if item_type == "product":
        row = await db.products.find_one({"id": catalog_id, "clinic_id": clinic_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        return {
            "item_type": "product",
            "catalog_id": catalog_id,
            "name": row.get("name") or "Product",
            "unit_price_idr": int(row.get("sale_price_idr") or row.get("price_idr") or 0),
            "quantity": 1,
        }
    raise HTTPException(status_code=400, detail="Invalid catalog item type")


def _apply_totals_and_payment(doc: dict) -> dict:
    totals = compute_invoice_totals(
        doc.get("items") or [],
        doc.get("discount_type") or "none",
        doc.get("discount_value") or 0,
    )
    doc["subtotal"] = totals["subtotal"]
    doc["service_value_subtotal"] = totals.get("service_value_subtotal", 0)
    doc["package_covered_value"] = totals.get("package_covered_value", 0)
    doc["discount_amount"] = totals["discount_amount"]
    doc["total_amount"] = totals["total_amount"]
    amount_paid = int(doc.get("amount_paid") or 0)
    # Auto-settle when cash due is zero (e.g. all lines paid by package)
    if doc["total_amount"] == 0 and (doc.get("items") or []):
        amount_paid = 0
    doc["amount_paid"] = amount_paid
    doc["remaining_balance"] = max(0, doc["total_amount"] - amount_paid)
    has_package_covered = any(it.get("paid_by") == "package" for it in (doc.get("items") or []))
    if doc["total_amount"] == 0 and has_package_covered:
        doc["payment_status"] = "paid"
    else:
        doc["payment_status"] = derive_payment_status(
            amount_paid, doc["total_amount"], doc.get("payment_status") or "unpaid"
        )
    paid_bys = {it.get("paid_by") for it in (doc.get("items") or []) if it.get("paid_by")}
    if paid_bys == {"package"} and doc["total_amount"] == 0:
        doc["payment_method"] = "package"
    elif "package" in paid_bys and doc.get("payment_method") not in ("package", "mixed"):
        if doc["total_amount"] == 0 or amount_paid < doc["total_amount"]:
            doc["payment_method"] = doc.get("payment_method") or "mixed"
    if doc["payment_status"] == "paid" and not doc.get("paid_at"):
        doc["paid_at"] = _now_iso()
    if doc["payment_status"] != "paid":
        doc["paid_at"] = doc.get("paid_at") if doc.get("payment_status") == "partial" else None
    return doc


def _recalculate_invoice_from_payments(inv: dict) -> dict:
    from transaction_corrections import (
        active_gift_card_payment_total,
        active_payment_total,
        active_store_credit_payment_total,
    )

    payments = inv.get("payments") or []
    inv["amount_paid"] = active_payment_total(payments)
    inv["gift_card_payment_total_idr"] = active_gift_card_payment_total(payments)
    inv["wallet_payment_total_idr"] = active_store_credit_payment_total(payments)
    inv = _apply_totals_and_payment(inv)
    if inv.get("payment_status") != "paid":
        if inv.get("payment_status") == "unpaid":
            inv["paid_at"] = None
            inv["closed_at"] = None
    return inv


async def restore_invoice_line_for_reversed_usage(db, clinic_id: str, usage: dict) -> None:
    """Clear package billing on an invoice line when usage is reversed."""
    invoice_id = usage.get("invoice_id")
    item_id = usage.get("invoice_item_id")
    usage_id = usage.get("id")
    if not invoice_id or not item_id:
        return
    inv = await db.invoices.find_one({"clinic_id": clinic_id, "id": invoice_id}, {"_id": 0})
    if not inv:
        return
    items = list(inv.get("items") or [])
    changed = False
    for idx, it in enumerate(items):
        if it.get("id") != item_id:
            continue
        if usage_id and it.get("package_usage_id") != usage_id:
            continue
        qty = resolve_invoice_line_quantity(it)
        unit = int(it.get("unit_price_idr") or 0)
        val = int(it.get("original_treatment_value") or line_gross_idr(unit, qty))
        items[idx] = {
            **it,
            "amount_charged": val,
            "line_total_idr": val,
            "paid_by": None,
            "patient_package_id": None,
            "package_usage_id": None,
        }
        changed = True
        break
    if not changed:
        return
    inv["items"] = items
    inv = _apply_totals_and_payment(inv)
    inv["updated_at"] = _now_iso()
    await db.invoices.update_one({"id": invoice_id}, {"$set": inv})
    await sync_visit_from_invoice(db, inv)


async def sync_visit_from_invoice(db, invoice: dict) -> None:
    vid = invoice.get("visit_id")
    if not vid:
        return
    status = invoice.get("payment_status") or "unpaid"
    visit_pay = status if status in ("unpaid", "partial", "paid") else "unpaid"
    upd = {
        "invoice_id": invoice.get("id"),
        "payment_status": visit_pay,
        "subtotal_idr": invoice.get("subtotal") or 0,
        "amount_idr": invoice.get("amount_paid") or 0,
        "payment_method": invoice.get("payment_method") or "",
        "payment_notes": invoice.get("notes") or "",
    }
    if status == "paid":
        upd["paid_at"] = invoice.get("paid_at") or _now_iso()
        upd["paid_by"] = invoice.get("last_payment_by") or invoice.get("created_by")
    await db.visits.update_one({"id": vid}, {"$set": upd})


class InvoiceItemIn(BaseModel):
    id: Optional[str] = None
    item_type: str = "custom"
    catalog_id: Optional[str] = None
    name: Optional[str] = None
    unit_price_idr: int = 0
    quantity: float = 1
    performer_id: Optional[str] = None
    performers: Optional[List[dict]] = None
    treatment_item_id: Optional[str] = None
    original_treatment_value: Optional[int] = None
    amount_charged: Optional[int] = None
    paid_by: Optional[str] = None
    patient_package_id: Optional[str] = None
    package_usage_id: Optional[str] = None


class InvoicePayWithPackageIn(BaseModel):
    patient_package_id: str
    patient_package_component_id: Optional[str] = None
    used_sessions_count: int = 1
    notes: str = ""


class InvoiceAddCatalogItemIn(BaseModel):
    item_type: str
    catalog_id: str
    quantity: int = 1
    performer_id: Optional[str] = None
    performers: Optional[List[dict]] = None


class InvoiceDiscountIn(BaseModel):
    discount_type: str = "none"
    discount_value: float = 0
    discount_reason: str = ""


class InvoicePaymentIn(BaseModel):
    amount_paid: Optional[int] = None
    payment_method: str = "cash"
    payment_reference: str = ""
    notes: Optional[str] = None
    mark_paid: bool = False
    gift_card_code: Optional[str] = None
    gift_card_amount_idr: Optional[int] = None
    wallet_amount_idr: Optional[int] = None
    overpayment_to_wallet: bool = False


class PaymentVoidIn(BaseModel):
    reason: str = Field(..., min_length=3)


class InvoiceRefundIn(BaseModel):
    amount_idr: int = Field(..., gt=0)
    method: str = "cash"
    reason: str = Field(..., min_length=3)
    notes: str = ""


class InvoiceUpdateIn(BaseModel):
    items: Optional[List[InvoiceItemIn]] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    discount_reason: Optional[str] = None
    notes: Optional[str] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None


def register_invoices(
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
    def require_permissions(*perms: str):
        async def checker(user: dict = Depends(get_current_user)):
            from permissions import user_has_permission

            for perm in perms:
                if not user_has_permission(user, perm):
                    raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user

        return checker
    async def _get_invoice_scoped(user: dict, invoice_id: str) -> dict:
        inv = await db.invoices.find_one(scope(user, {"id": invoice_id}), {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return inv

    async def _save_invoice(user: dict, inv: dict) -> dict:
        if inv.get("payment_status") in ("cancelled", "refunded"):
            raise HTTPException(status_code=400, detail="Invoice is closed for edits")
        old_inv = await db.invoices.find_one(scope(user, {"id": inv["id"]}), {"_id": 0})
        if old_inv:
            from daily_closing import assert_invoice_not_closing_locked
            await assert_invoice_not_closing_locked(db, old_inv)
        discount_type = inv.get("discount_type") or "none"
        discount_amount = int(inv.get("discount_amount") or 0)
        if discount_amount > 0 and not (inv.get("discount_reason") or "").strip():
            raise HTTPException(status_code=400, detail="Discount reason is required when discount is applied")
        inv = _apply_totals_and_payment(inv)
        inv["updated_at"] = _now_iso()
        await db.invoices.update_one(
            scope(user, {"id": inv["id"]}),
            {"$set": inv},
        )
        await sync_visit_from_invoice(db, inv)
        saved = await db.invoices.find_one(scope(user, {"id": inv["id"]}), {"_id": 0})
        try:
            from commissions import sync_commission_records_for_invoice
            await sync_commission_records_for_invoice(db, saved)
        except Exception:
            pass
        try:
            from patient_packages import create_patient_packages_from_invoice, cancel_patient_packages_for_invoice
            if saved.get("payment_status") == "paid":
                await create_patient_packages_from_invoice(db, saved)
            elif saved.get("payment_status") in ("cancelled", "refunded"):
                await cancel_patient_packages_for_invoice(db, saved)
        except Exception:
            pass
        from audit_log import log_invoice_event
        old_status = (old_inv or {}).get("payment_status")
        new_status = saved.get("payment_status")
        if old_status != new_status and new_status == "paid":
            action = "paid"
        else:
            action = "updated"
        await log_invoice_event(
            db, user, action, saved,
            old_value={
                "payment_status": old_status,
                "amount_paid": (old_inv or {}).get("amount_paid"),
                "total_amount": (old_inv or {}).get("total_amount"),
                "remaining_balance": (old_inv or {}).get("remaining_balance"),
            } if old_inv else None,
            reason=(saved.get("discount_reason") or "").strip(),
        )
        if old_status != new_status and new_status == "paid":
            try:
                import os
                from messaging import safe_trigger_messaging_event

                patient = None
                if saved.get("patient_id"):
                    patient = await db.patients.find_one(
                        {"id": saved["patient_id"], "clinic_id": saved["clinic_id"]},
                        {"_id": 0},
                    )
                safe_trigger_messaging_event(
                    db,
                    os.environ.get("JWT_SECRET", ""),
                    saved["clinic_id"],
                    "payment_received",
                    invoice=saved,
                    patient=patient,
                    reference_type="invoice",
                    reference_id=saved.get("id"),
                    invoice_id=saved.get("id"),
                )
            except Exception:
                pass
        return saved

    async def _enrich_invoice(inv: dict) -> dict:
        if inv.get("patient_id"):
            p = await db.patients.find_one({"id": inv["patient_id"]}, {"_id": 0, "full_name": 1, "phone": 1})
            inv["patient"] = p
        if inv.get("visit_id"):
            v = await db.visits.find_one(
                {"id": inv["visit_id"]},
                {"_id": 0, "visit_date": 1, "status": 1, "visit_type": 1, "assigned_to": 1, "booking_id": 1},
            )
            if v and v.get("assigned_to"):
                u = await db.users.find_one({"id": v["assigned_to"]}, {"_id": 0, "id": 1, "name": 1, "role": 1})
                v["assigned_user"] = u
            inv["visit"] = v
        inv["default_performer"] = default_performer_from_invoice(inv)
        inv["items"] = coerce_invoice_items_for_api(inv.get("items") or [])
        from daily_closing import is_day_closed
        from refunds import refund_to_api

        paid_day = (inv.get("paid_at") or "")[:10]
        inv["closing_locked"] = bool(
            inv.get("payment_status") in ("paid", "partial")
            and paid_day
            and await is_day_closed(db, inv["clinic_id"], paid_day)
        )
        refund_rows = await db.refunds.find(
            {
                "clinic_id": inv["clinic_id"],
                "reference_type": "invoice",
                "reference_id": inv["id"],
                "status": "recorded",
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        inv["refunds"] = [refund_to_api(r) for r in refund_rows]
        return inv

    async def _repair_invoice_from_visit(db, clinic_id: str, inv: dict) -> dict:
        """Refresh visit lines, persist quantity fixes, return invoice ready for API."""
        refreshed = await refresh_invoice_from_visit(db, clinic_id, inv)
        refreshed["items"] = coerce_invoice_items_for_api(refreshed.get("items") or [])
        refreshed = _apply_totals_and_payment(refreshed)
        needs_save = (
            invoice_items_need_quantity_persist(inv.get("items"))
            or refreshed.get("items") != inv.get("items")
            or refreshed.get("total_amount") != inv.get("total_amount")
        )
        if needs_save and refreshed.get("payment_status") not in ("cancelled", "refunded"):
            refreshed["updated_at"] = _now_iso()
            await db.invoices.update_one({"id": refreshed["id"]}, {"$set": refreshed})
            await sync_visit_from_invoice(db, refreshed)
        return refreshed

    def _invoice_matches_q(inv: dict, q: str) -> bool:
        q_l = (q or "").strip().lower()
        if not q_l:
            return True
        if q_l in (inv.get("invoice_number") or "").lower():
            return True
        patient = inv.get("patient") or {}
        if q_l in (patient.get("full_name") or "").lower():
            return True
        phone = re.sub(r"[\s\-+]", "", patient.get("phone") or "").lower()
        q_phone = re.sub(r"[\s\-+]", "", q_l)
        if q_phone and q_phone in phone:
            return True
        return False

    async def _normalize_invoice_items(user: dict, inv: dict, raw_items: List[dict]) -> List[dict]:
        default_perf = default_performer_from_invoice(inv)
        if not default_perf and inv.get("visit_id"):
            visit = await db.visits.find_one(scope(user, {"id": inv["visit_id"]}), {"_id": 0})
            if visit:
                default_perf = await resolve_visit_default_performer(db, user.get("clinic_id"), visit)
        out = []
        for raw in raw_items:
            line_id = raw.get("id")
            out.append(
                await normalize_invoice_item(
                    db, user.get("clinic_id"), raw, line_id=line_id, default_performer=default_perf,
                )
            )
        return out

    @api.get("/invoices/dashboard/summary")
    async def invoice_dashboard_summary(
        user: dict = Depends(require_any_permission("billing.view", "invoices.view")),
    ):
        await assert_feature(user, "billing")
        cid = user.get("clinic_id")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        flt = {"clinic_id": cid, "created_at": {"$gte": f"{today}T00:00:00", "$lte": f"{today}T23:59:59"}}
        unpaid = await db.invoices.count_documents({**flt, "payment_status": "unpaid"})
        partial = await db.invoices.count_documents({**flt, "payment_status": "partial"})
        paid = await db.invoices.count_documents({**flt, "payment_status": "paid"})
        pipeline = [
            {"$match": {**flt, "payment_status": {"$in": ["paid", "partial"]}}},
            {"$group": {"_id": None, "revenue": {"$sum": "$amount_paid"}, "outstanding": {"$sum": "$remaining_balance"}}},
        ]
        revenue_today = 0
        outstanding = 0
        async for row in db.invoices.aggregate(pipeline):
            revenue_today = int(row.get("revenue") or 0)
            outstanding = int(row.get("outstanding") or 0)
        return {
            "date": today,
            "unpaid_count": unpaid,
            "partial_count": partial,
            "paid_count": paid,
            "revenue_today_idr": revenue_today,
            "outstanding_idr": outstanding,
        }

    @api.get("/invoices/reports/summary")
    async def invoice_reports_summary(
        user: dict = Depends(require_any_permission("billing.view", "invoices.view", "reports.view")),
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        await assert_feature(user, "billing")
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "payment_status": {"$nin": ["cancelled"]}}
        if from_date:
            flt.setdefault("created_at", {})["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            flt.setdefault("created_at", {})["$lte"] = f"{to_date}T23:59:59"

        by_method: Dict[str, int] = {}
        by_item: Dict[str, int] = {}
        total_revenue = 0
        outstanding = 0

        invs = await db.invoices.find(flt, {"_id": 0}).to_list(5000)
        for inv in invs:
            total_revenue += int(inv.get("amount_paid") or 0)
            outstanding += int(inv.get("remaining_balance") or 0)
            method = inv.get("payment_method") or "other"
            by_method[method] = by_method.get(method, 0) + int(inv.get("amount_paid") or 0)
            for it in inv.get("items") or []:
                key = it.get("name") or "—"
                if it.get("paid_by") == "package":
                    continue
                by_item[key] = by_item.get(key, 0) + int(it.get("line_total_idr") or 0)

        package_sales = 0
        package_usage_value = 0
        package_sessions_used = 0
        async for usage in db.package_usage.find(
            {"clinic_id": cid, "status": "active"},
            {"_id": 0, "used_sessions_count": 1, "treatment_value_snapshot": 1},
        ):
            package_sessions_used += int(usage.get("used_sessions_count") or 1)
            package_usage_value += int(usage.get("treatment_value_snapshot") or 0)
        for inv in invs:
            for it in inv.get("items") or []:
                if it.get("item_type") == "package" and inv.get("payment_status") == "paid":
                    package_sales += int(it.get("line_total_idr") or it.get("amount_charged") or 0)

        by_item_list = sorted(
            [{"name": k, "revenue_idr": v} for k, v in by_item.items()],
            key=lambda x: -x["revenue_idr"],
        )[:20]
        by_method_list = [{"method": k, "revenue_idr": v} for k, v in sorted(by_method.items(), key=lambda x: -x[1])]

        return {
            "total_revenue_idr": total_revenue,
            "outstanding_idr": outstanding,
            "by_payment_method": by_method_list,
            "by_item": by_item_list,
            "invoice_count": len(invs),
            "package_sales_revenue_idr": package_sales,
            "package_usage_service_value_idr": package_usage_value,
            "package_sessions_used": package_sessions_used,
        }

    @api.get("/invoices")
    async def list_invoices(
        user: dict = Depends(require_any_permission("billing.view", "invoices.view")),
        date: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        status: Optional[str] = None,
        patient_id: Optional[str] = None,
        payment_method: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = Query(100, le=500),
    ):
        await assert_feature(user, "billing")
        flt = scope(user, {})
        if date_from and date_to:
            flt["created_at"] = {"$gte": f"{date_from}T00:00:00", "$lte": f"{date_to}T23:59:59"}
        elif date:
            flt["created_at"] = {"$gte": f"{date}T00:00:00", "$lte": f"{date}T23:59:59"}
        if status:
            flt["payment_status"] = status
        if patient_id:
            flt["patient_id"] = patient_id
        if payment_method:
            flt["payment_method"] = payment_method
        rows = await db.invoices.find(flt, {"_id": 0}).sort("created_at", -1).to_list(limit)
        out = []
        for inv in rows:
            out.append(await _enrich_invoice(inv))
        if q:
            out = [r for r in out if _invoice_matches_q(r, q)]
        return out

    @api.post("/invoices/visit/{visit_id}")
    async def create_or_get_invoice_for_visit(
        visit_id: str,
        user: dict = Depends(require_permission("billing.create")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        visit = await db.visits.find_one(scope(user, {"id": visit_id}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")

        cid = user.get("clinic_id")
        had_invoice = await db.invoices.find_one(
            scope(user, {"visit_id": visit_id, "payment_status": {"$nin": ["cancelled"]}}),
            {"_id": 0, "id": 1},
        )
        doc = await ensure_invoice_for_visit(db, cid, visit, created_by=user["id"])
        if not had_invoice:
            from audit_log import log_invoice_event
            await log_invoice_event(db, user, "created", doc)
        doc = await _repair_invoice_from_visit(db, cid, doc)
        return await _enrich_invoice(doc)

    @api.get("/invoices/visit/{visit_id}")
    async def get_invoice_by_visit(
        visit_id: str,
        user: dict = Depends(require_any_permission("billing.view", "invoices.view")),
    ):
        await assert_feature(user, "billing")
        inv = await db.invoices.find_one(
            scope(user, {"visit_id": visit_id, "payment_status": {"$nin": ["cancelled"]}}),
            {"_id": 0},
        )
        if not inv:
            raise HTTPException(status_code=404, detail="No invoice for this visit")
        inv = await _repair_invoice_from_visit(db, user.get("clinic_id"), inv)
        return await _enrich_invoice(inv)

    @api.get("/invoices/{invoice_id}")
    async def get_invoice(
        invoice_id: str,
        user: dict = Depends(require_any_permission("billing.view", "invoices.view")),
    ):
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        inv = await _repair_invoice_from_visit(db, user.get("clinic_id"), inv)
        return await _enrich_invoice(inv)

    @api.put("/invoices/{invoice_id}")
    async def update_invoice(
        invoice_id: str,
        payload: InvoiceUpdateIn,
        user: dict = Depends(require_permission("billing.edit")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        data = payload.model_dump(exclude_none=True)
        if "items" in data:
            existing_by_id = {
                it["id"]: it for it in (inv.get("items") or []) if it.get("id")
            }
            merged_items = []
            for raw in data["items"]:
                row = dict(raw)
                prev = existing_by_id.get(row.get("id")) or {}
                if prev.get("package_usage_id") and not row.get("package_usage_id"):
                    row.update({
                        "paid_by": prev.get("paid_by"),
                        "package_usage_id": prev.get("package_usage_id"),
                        "patient_package_id": prev.get("patient_package_id"),
                        "amount_charged": prev.get("amount_charged"),
                        "original_treatment_value": prev.get("original_treatment_value"),
                    })
                merged_items.append(row)
            inv["items"] = await _normalize_invoice_items(user, inv, merged_items)
        for k in ("discount_type", "discount_value", "discount_reason", "notes", "payment_method", "payment_reference"):
            if k in data:
                inv[k] = data[k]
        if inv.get("discount_type") not in DISCOUNT_TYPES:
            inv["discount_type"] = "none"
        return await _save_invoice(user, inv)

    @api.post("/invoices/{invoice_id}/items/catalog")
    async def add_catalog_item(
        invoice_id: str,
        payload: InvoiceAddCatalogItemIn,
        user: dict = Depends(require_permission("billing.edit")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        default_perf = default_performer_from_invoice(inv)
        visit = None
        if not default_perf and inv.get("visit_id"):
            visit = await db.visits.find_one(scope(user, {"id": inv["visit_id"]}), {"_id": 0})
            if visit:
                default_perf = await resolve_visit_default_performer(db, user.get("clinic_id"), visit)
        snap = await snapshot_catalog_item(db, user["clinic_id"], payload.item_type, payload.catalog_id)
        snap["quantity"] = max(1.0, float(payload.quantity or 1))
        if payload.performer_id:
            snap["performer_id"] = payload.performer_id
        if payload.performers:
            snap["performers"] = payload.performers
        elif visit and payload.item_type == "treatment":
            from performers import get_performers
            snap["performers"] = get_performers(visit)
        line = await normalize_invoice_item(
            db, user.get("clinic_id"), snap, default_performer=default_perf,
        )
        inv.setdefault("items", []).append(line)
        return await _save_invoice(user, inv)

    @api.post("/invoices/{invoice_id}/items/{item_id}/pay-with-package")
    async def pay_invoice_item_with_package(
        invoice_id: str,
        item_id: str,
        payload: InvoicePayWithPackageIn,
        user: dict = Depends(require_permissions("billing.edit", "packages.use")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        await assert_feature(user, "emr")
        inv = await _get_invoice_scoped(user, invoice_id)
        if inv.get("payment_status") in ("cancelled", "refunded"):
            raise HTTPException(status_code=400, detail="Invoice is closed")

        item = next((it for it in (inv.get("items") or []) if it.get("id") == item_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="Invoice line not found")
        if item.get("paid_by") == "package":
            raise HTTPException(status_code=400, detail="Line is already paid by package")
        if item.get("item_type") not in ("treatment", "custom"):
            raise HTTPException(status_code=400, detail="Only treatment/custom lines can be paid with a package session")

        from patient_packages import apply_package_to_invoice_line

        inv = await apply_package_to_invoice_line(
            db,
            user,
            inv,
            item_id,
            payload.patient_package_id,
            used_sessions_count=payload.used_sessions_count,
            notes=payload.notes,
            patient_package_component_id=payload.patient_package_component_id,
            audit=audit,
        )
        return await _save_invoice(user, inv)

    @api.put("/invoices/{invoice_id}/discount")
    async def apply_discount(
        invoice_id: str,
        payload: InvoiceDiscountIn,
        user: dict = Depends(require_permission("billing.edit")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        inv["discount_type"] = payload.discount_type if payload.discount_type in DISCOUNT_TYPES else "none"
        inv["discount_value"] = payload.discount_value
        inv["discount_reason"] = (payload.discount_reason or "").strip()
        return await _save_invoice(user, inv)

    @api.put("/invoices/{invoice_id}/payment")
    async def update_payment(
        invoice_id: str,
        payload: InvoicePaymentIn,
        user: dict = Depends(require_permission("billing.edit")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        inv = _apply_totals_and_payment(inv)
        if payload.notes is not None:
            inv["notes"] = payload.notes
        method = (payload.payment_method or "cash").strip().lower().replace(" ", "_")
        if method not in PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail="Invalid payment_method")
        inv["payment_reference"] = (payload.payment_reference or "").strip()
        total = int(inv.get("total_amount") or 0)
        code = (payload.gift_card_code or "").strip() or None
        gift_card_redemptions = list(inv.get("gift_card_redemptions") or [])
        payments = list(inv.get("payments") or [])
        already_paid = int(inv.get("amount_paid") or 0)
        remaining = max(0, total - already_paid)

        if payload.mark_paid:
            from gift_cards_booking import finalize_booking_entitlement_gift_card_for_invoice
            fin = await finalize_booking_entitlement_gift_card_for_invoice(db, user, inv)
            if fin:
                gc_paid_booking, red = fin
                from gift_cards_core import make_payment_record
                inv["amount_paid"] = already_paid + gc_paid_booking
                inv["gift_card_payment_total_idr"] = int(inv.get("gift_card_payment_total_idr") or 0) + gc_paid_booking
                gift_card_redemptions.append(red)
                visit = await db.visits.find_one(
                    {"id": inv.get("visit_id"), "clinic_id": user["clinic_id"]},
                    {"_id": 0, "booking_id": 1},
                )
                bk = None
                if visit and visit.get("booking_id"):
                    bk = await db.bookings.find_one(
                        {"id": visit["booking_id"]},
                        {"_id": 0, "gift_card_id": 1},
                    )
                payments.append(
                    make_payment_record(
                        "gift_card",
                        gc_paid_booking,
                        user,
                        gift_card_code=red.get("gift_card_code"),
                        gift_card_id=(bk or {}).get("gift_card_id"),
                        gift_card_redemption_id=red.get("id"),
                    )
                )
                already_paid = int(inv["amount_paid"] or 0)
                remaining = max(0, total - already_paid)
                inv["payment_method"] = "gift_card" if remaining <= 0 else "mixed"

        if code or method == "gift_card":
            from gift_cards_core import apply_gift_card_payment

            gc_request = int(payload.gift_card_amount_idr or 0)
            if payload.mark_paid:
                pay_cap = remaining
            elif gc_request > 0:
                pay_cap = min(remaining, gc_request)
            else:
                pay_cap = remaining
            if method == "gift_card" and gc_request <= 0:
                card_probe = None
                if code:
                    from gift_card_models import is_entitlement_gift_card
                    from gift_cards_core import find_gift_card_by_code
                    card_probe = await find_gift_card_by_code(db, user["clinic_id"], code)
                if not card_probe or not is_entitlement_gift_card(card_probe):
                    raise HTTPException(status_code=400, detail="Gift card redemption amount is required")

            cash_target = payload.amount_paid
            if payload.mark_paid and cash_target is None:
                cash_target = max(0, pay_cap - gc_request)
            cash, gc_paid, reds, pmethod, new_pays = await apply_gift_card_payment(
                db,
                user,
                total_idr=pay_cap,
                gift_card_code=code,
                gift_card_amount_idr=gc_request,
                cash_amount_paid=cash_target,
                reference_type="invoice",
                reference_id=invoice_id,
                payment_method=method,
                patient_id=inv.get("patient_id"),
                line_items=inv.get("items") or [],
            )
            inv["amount_paid"] = already_paid + cash + gc_paid
            inv["gift_card_payment_total_idr"] = int(inv.get("gift_card_payment_total_idr") or 0) + gc_paid
            gift_card_redemptions.extend(reds)
            payments.extend(new_pays)
            inv["payment_method"] = pmethod
        elif method == "store_credit" or int(payload.wallet_amount_idr or 0) > 0:
            from gift_cards_core import make_payment_record
            from wallet_core import apply_wallet_payment, credit_overpayment_to_wallet

            if not inv.get("patient_id"):
                raise HTTPException(status_code=400, detail="Patient required for store credit payment")
            wallet_req = int(payload.wallet_amount_idr or 0)
            use_amt = wallet_req if wallet_req > 0 else remaining
            if payload.mark_paid and use_amt <= 0:
                use_amt = remaining
            applied, _, wp = await apply_wallet_payment(
                db,
                user,
                patient_id=inv["patient_id"],
                amount_idr=use_amt,
                max_due=remaining,
                reference_type="invoice",
                reference_id=invoice_id,
            )
            payments.append(wp)
            already_paid += applied
            remaining = max(0, total - already_paid)
            inv["wallet_payment_total_idr"] = int(inv.get("wallet_payment_total_idr") or 0) + applied
            if payload.mark_paid and remaining > 0:
                cash_add = int(payload.amount_paid if payload.amount_paid is not None else remaining)
                cash_add = min(remaining, max(0, cash_add))
                if cash_add > 0:
                    payments.append(make_payment_record("cash", cash_add, user))
                    already_paid += cash_add
                    remaining = max(0, total - already_paid)
            elif payload.amount_paid is not None and method != "store_credit":
                cash_add = min(remaining, max(0, int(payload.amount_paid)))
                if cash_add > 0:
                    pm = method if method != "store_credit" else "cash"
                    payments.append(make_payment_record(pm, cash_add, user))
                    already_paid += cash_add
            if payload.overpayment_to_wallet and payload.amount_paid:
                excess = max(0, int(payload.amount_paid) - max(0, remaining))
                if excess > 0:
                    await credit_overpayment_to_wallet(
                        db, user, inv["patient_id"], excess,
                        reference_type="invoice", reference_id=invoice_id,
                    )
            inv["amount_paid"] = already_paid
            inv["payment_method"] = "store_credit" if applied >= total else "mixed"
        else:
            inv["payment_method"] = method
            if payload.mark_paid:
                inv["amount_paid"] = total
                from gift_cards_core import make_payment_record
                payments.append(make_payment_record(method, remaining, user))
            elif payload.amount_paid is not None:
                add_amt = min(remaining, max(0, int(payload.amount_paid)))
                inv["amount_paid"] = already_paid + add_amt
                from gift_cards_core import make_payment_record
                payments.append(make_payment_record(method, add_amt, user))
        inv["gift_card_redemptions"] = gift_card_redemptions
        inv["payments"] = payments
        inv["last_payment_by"] = user["id"]
        inv = _apply_totals_and_payment(inv)
        if inv["payment_status"] == "paid":
            inv["paid_at"] = _now_iso()
            inv["closed_at"] = inv.get("closed_at") or _now_iso()
        return await _save_invoice(user, inv)

    @api.post("/invoices/{invoice_id}/payments/{payment_id}/void")
    async def void_invoice_payment(
        invoice_id: str,
        payment_id: str,
        payload: PaymentVoidIn,
        user: dict = Depends(require_any_permission("payments.void", "billing.edit")),
    ):
        from permissions import user_has_permission
        from gift_cards_core import reverse_redemption_by_id
        from transaction_corrections import assert_day_open_for_void

        if not (
            user_has_permission(user, "payments.void")
            or user_has_permission(user, "billing.edit")
        ):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        if inv.get("payment_status") in ("cancelled", "refunded"):
            raise HTTPException(status_code=400, detail="Invoice is closed")
        payments = list(inv.get("payments") or [])
        payment = next((p for p in payments if p.get("id") == payment_id), None)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
        if payment.get("voided"):
            return await _enrich_invoice(inv)
        pay_day = (payment.get("created_at") or inv.get("paid_at") or "")[:10]
        await assert_day_open_for_void(db, user["clinic_id"], pay_day)
        now = _now_iso()
        reason = payload.reason.strip()
        redemption_id = payment.get("gift_card_redemption_id")
        if redemption_id:
            await reverse_redemption_by_id(db, user["clinic_id"], redemption_id)
        elif (payment.get("method") or "").strip().lower() == "gift_card":
            from gift_cards_core import reverse_redemptions_for_reference
            await reverse_redemptions_for_reference(db, user["clinic_id"], "invoice", invoice_id)
        wallet_tx_id = payment.get("wallet_transaction_id")
        if wallet_tx_id:
            from wallet_core import reverse_wallet_transaction_by_id
            await reverse_wallet_transaction_by_id(db, user, wallet_tx_id, notes=reason)
        for p in payments:
            if p.get("id") == payment_id:
                p["voided"] = True
                p["voided_at"] = now
                p["voided_by"] = user.get("id")
                p["void_reason"] = reason
        inv["payments"] = payments
        reds = list(inv.get("gift_card_redemptions") or [])
        if redemption_id:
            for r in reds:
                if r.get("id") == redemption_id:
                    r["reversed"] = True
        inv["gift_card_redemptions"] = reds
        inv = _recalculate_invoice_from_payments(inv)
        inv["updated_at"] = now
        await db.invoices.update_one(scope(user, {"id": invoice_id}), {"$set": inv})
        await sync_visit_from_invoice(db, inv)
        await audit(user, "void_payment", "invoice", invoice_id, {"payment_id": payment_id, "reason": reason})
        return await _enrich_invoice(inv)

    @api.post("/invoices/{invoice_id}/refund")
    async def refund_invoice(
        invoice_id: str,
        payload: InvoiceRefundIn,
        user: dict = Depends(require_any_permission("refunds.create", "billing.edit")),
    ):
        from permissions import user_has_permission
        from refunds import create_refund_record
        from wallet_core import credit_refund_to_wallet

        if not user_has_permission(user, "refunds.create"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        if inv.get("payment_status") not in ("paid", "partial", "refunded"):
            raise HTTPException(status_code=400, detail="Invoice has no payment to refund")
        total = int(inv.get("amount_paid") or 0)
        if payload.amount_idr > total:
            raise HTTPException(status_code=400, detail="Refund cannot exceed amount paid")
        method = (payload.method or "cash").strip().lower()
        if method == "store_credit" and not inv.get("patient_id"):
            raise HTTPException(status_code=400, detail="Patient required to refund to store credit")
        doc = await create_refund_record(
            db,
            user,
            reference_type="invoice",
            reference_id=invoice_id,
            amount_idr=payload.amount_idr,
            method=method,
            reason=payload.reason,
            notes=payload.notes,
            business_date=(inv.get("paid_at") or "")[:10] or None,
        )
        if method == "store_credit":
            await credit_refund_to_wallet(
                db, user, inv["patient_id"], payload.amount_idr, doc["id"], payload.reason,
            )
        await audit(user, "refund_recorded", "invoice", invoice_id, {"refund_id": doc["id"]})
        return doc

    @api.post("/invoices/{invoice_id}/cancel")
    async def cancel_invoice(
        invoice_id: str,
        user: dict = Depends(require_permission("billing.edit")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "billing")
        inv = await _get_invoice_scoped(user, invoice_id)
        from daily_closing import assert_invoice_not_closing_locked
        await assert_invoice_not_closing_locked(db, inv, for_cancel=True)
        if inv.get("payment_status") == "paid":
            from gift_cards_core import reverse_redemptions_for_reference
            await reverse_redemptions_for_reference(db, user["clinic_id"], "invoice", invoice_id)
        old_inv = dict(inv)
        inv["payment_status"] = "cancelled"
        inv["closed_at"] = _now_iso()
        inv["updated_at"] = _now_iso()
        await db.invoices.update_one(scope(user, {"id": invoice_id}), {"$set": inv})
        await sync_visit_from_invoice(db, inv)
        try:
            from commissions import sync_commission_records_for_invoice
            await sync_commission_records_for_invoice(db, inv)
        except Exception:
            pass
        try:
            from patient_packages import cancel_patient_packages_for_invoice
            await cancel_patient_packages_for_invoice(db, inv)
        except Exception:
            pass
        from audit_log import log_invoice_event
        await log_invoice_event(db, user, "cancelled", inv, old_value=old_inv)
        return inv
