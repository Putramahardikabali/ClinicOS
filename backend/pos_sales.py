"""Point-of-sale — clinic cashier (products, packages, gift cards, services, custom lines)."""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from daily_closing import aggregate_daily_closing, is_day_closed
from inventory_usage import apply_stock_change, reverse_stock_for_pos_sale
from patient_packages import cancel_patient_packages_for_pos_sale, create_patient_packages_from_pos_sale
from permissions import user_has_permission
from correction_constants import CLOSING_LOCK_MESSAGE
from transaction_corrections import assert_day_open_for_void
from pos_sales_helpers import (
    build_pos_sales_filter,
    sale_list_row,
    sales_to_csv_rows,
    summarize_paid_pos_sales,
    utc_today_str,
)

SALE_STATUSES = frozenset({"draft", "paid", "cancelled"})
SALE_TYPES = frozenset({
    "product_sale", "package_sale", "gift_card", "service_sale", "mixed",
})
PAYMENT_STATUSES = frozenset({"unpaid", "partial", "paid"})
PAYMENT_METHODS = frozenset({"cash", "card", "bank_transfer", "qris", "other", "gift_card"})
ITEM_TYPES = frozenset({"product", "package", "gift_card", "service", "custom"})
GIFT_CARD_TYPES = frozenset({"value_credit", "treatment", "package"})


def _sale_has_gift_card_items(items: List[dict]) -> bool:
    return any((i.get("item_type") or "").strip().lower() == "gift_card" for i in items)


def _require_gift_card_create(user: dict, items: List[dict]) -> None:
    """POS gift card lines require both pos.create (checked at route) and gift_cards.create."""
    if not _sale_has_gift_card_items(items):
        return
    if not user_has_permission(user, "gift_cards.create"):
        raise HTTPException(
            status_code=403,
            detail="gift_cards.create permission is required to add gift card items on POS",
        )


DISCOUNT_TYPES = frozenset({"none", "fixed", "percentage"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _item_line_total(item: dict) -> int:
    qty = float(item.get("qty") or 1)
    unit = int(item.get("unit_price") or 0)
    discount = int(item.get("discount") or 0)
    tax = int(item.get("tax") or 0)
    gross = int(round(qty * unit))
    return max(0, gross - discount + tax)


def _resolve_discount_amount(
    subtotal: int,
    discount_type: str,
    discount_value: float,
    *,
    legacy_discount_total: int = 0,
) -> int:
    """Invoice-level discount: fixed IDR or percentage of subtotal."""
    dtype = (discount_type or "none").strip().lower()
    if dtype not in DISCOUNT_TYPES:
        dtype = "none"
    subtotal = max(0, int(subtotal or 0))
    if dtype == "percentage":
        amount = int(round(subtotal * float(discount_value or 0) / 100))
    elif dtype == "fixed":
        amount = int(float(discount_value or 0))
    else:
        amount = max(0, int(legacy_discount_total or 0))
    return max(0, min(amount, subtotal))


def _compute_sale_totals(
    items: List[dict],
    *,
    discount_type: str = "none",
    discount_value: float = 0,
    discount_total: int = 0,
    tax_total: int = 0,
) -> Dict[str, int]:
    subtotal = sum(_item_line_total(it) for it in items)
    resolved_discount = _resolve_discount_amount(
        subtotal, discount_type, discount_value, legacy_discount_total=discount_total,
    )
    tax_total = max(0, int(tax_total or 0))
    total = max(0, subtotal - resolved_discount + tax_total)
    return {
        "subtotal": subtotal,
        "discount_type": discount_type if discount_type in DISCOUNT_TYPES else "none",
        "discount_value": float(discount_value or 0),
        "discount_total": resolved_discount,
        "tax_total": tax_total,
        "total": total,
    }


def _derive_payment_status(amount_paid: int, total: int, status: str) -> str:
    if status == "cancelled":
        return "unpaid"
    amount_paid = int(amount_paid or 0)
    total = int(total or 0)
    if amount_paid <= 0:
        return "unpaid"
    if amount_paid >= total:
        return "paid"
    return "partial"


def _infer_sale_type(items: List[dict]) -> str:
    types = {(it.get("item_type") or "product") for it in items}
    if len(types) == 1:
        t = next(iter(types))
        if t == "product":
            return "product_sale"
        if t == "package":
            return "package_sale"
        if t == "gift_card":
            return "gift_card"
        if t == "service":
            return "service_sale"
        if t == "custom":
            return "mixed"
    return "mixed"


def _sale_requires_patient(items: List[dict]) -> bool:
    return any((it.get("item_type") or "") == "package" for it in items)


async def _next_sale_number(db, clinic_id: str) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"POS-{year}-"
    last = await db.pos_sales.find_one(
        {"clinic_id": clinic_id, "sale_number": {"$regex": f"^{re.escape(prefix)}"}},
        {"_id": 0, "sale_number": 1},
        sort=[("sale_number", -1)],
    )
    seq = 1
    if last and last.get("sale_number"):
        tail = last["sale_number"].replace(prefix, "")
        try:
            seq = int(tail) + 1
        except ValueError:
            seq = await db.pos_sales.count_documents({"clinic_id": clinic_id}) + 1
    return f"{prefix}{seq:05d}"


def _normalize_items(raw_items: List[dict]) -> List[dict]:
    out = []
    for i, raw in enumerate(raw_items):
        item_type = (raw.get("item_type") or "product").strip().lower()
        if item_type not in ITEM_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid item_type on line {i + 1}")
        name = (raw.get("name_snapshot") or "").strip()
        if not name:
            if item_type == "gift_card":
                name = "Gift card"
            else:
                raise HTTPException(status_code=400, detail=f"Item name required on line {i + 1}")
        qty = float(raw.get("qty") or 1)
        if qty <= 0:
            raise HTTPException(status_code=400, detail=f"Invalid quantity on line {i + 1}")
        meta = dict(raw.get("metadata") or {})
        if item_type == "gift_card":
            gc_type = (meta.get("gift_card_type") or "value_credit").strip().lower()
            if gc_type not in GIFT_CARD_TYPES:
                raise HTTPException(status_code=400, detail=f"Invalid gift_card_type on line {i + 1}")
            meta["gift_card_type"] = gc_type
        item = {
            "id": raw.get("id") or str(uuid.uuid4()),
            "item_type": item_type,
            "product_id": raw.get("product_id") or None,
            "package_catalog_id": raw.get("package_catalog_id") or None,
            "treatment_catalog_id": raw.get("treatment_catalog_id") or None,
            "gift_card_id": raw.get("gift_card_id") or None,
            "patient_package_id": raw.get("patient_package_id") or None,
            "name_snapshot": name,
            "qty": qty,
            "unit_price": int(raw.get("unit_price") or 0),
            "discount": int(raw.get("discount") or 0),
            "tax": int(raw.get("tax") or 0),
            "total": _item_line_total(raw),
            "stock_deducted": bool(raw.get("stock_deducted", False)),
            "fulfilled": bool(raw.get("fulfilled", False)),
            "metadata": meta,
        }
        out.append(item)
    return out


async def _deduct_stock_for_sale(db, sale: dict, *, created_by: str) -> None:
    clinic_id = sale["clinic_id"]
    items = sale.get("items") or []
    changed = False
    for item in items:
        if item.get("stock_deducted"):
            continue
        if item.get("item_type") != "product" or not item.get("product_id"):
            continue
        product = await db.products.find_one(
            {"clinic_id": clinic_id, "id": item["product_id"]},
            {"_id": 0},
        )
        if not product:
            raise HTTPException(status_code=400, detail=f"Product not found: {item.get('name_snapshot')}")
        if not product.get("track_stock", True):
            item["stock_deducted"] = True
            changed = True
            continue
        qty = float(item.get("qty") or 0)
        if qty <= 0:
            continue
        await apply_stock_change(
            db,
            clinic_id=clinic_id,
            product_id=item["product_id"],
            quantity_change=-qty,
            movement_type="retail_sale",
            reference_type="pos_sale",
            reference_id=sale["id"],
            created_by=created_by,
            reason=f"POS {sale.get('sale_number') or sale['id']}",
        )
        item["stock_deducted"] = True
        changed = True
    if changed:
        await db.pos_sales.update_one(
            {"id": sale["id"], "clinic_id": clinic_id},
            {"$set": {"items": items, "updated_at": _now_iso()}},
        )


async def _issue_gift_card_for_item(
    db, sale: dict, item: dict, *, created_by: str, issuer_user: Optional[dict] = None,
) -> Tuple[str, str]:
    from gift_cards_core import issue_gift_card_from_pos_item
    return await issue_gift_card_from_pos_item(
        db, sale, item, created_by=created_by, issuer_user=issuer_user,
    )


async def _fulfill_paid_sale(
    db, sale: dict, *, created_by: str, issuer_user: Optional[dict] = None,
) -> dict:
    """Stock deduction, patient packages, gift card issuance — only when paid."""
    await _deduct_stock_for_sale(db, sale, created_by=created_by)
    sale = await db.pos_sales.find_one(
        {"id": sale["id"], "clinic_id": sale["clinic_id"]},
        {"_id": 0},
    )
    pkg_stats = await create_patient_packages_from_pos_sale(db, sale)
    items = list(sale.get("items") or [])
    gift_card_ids: List[str] = []
    patient_package_ids: List[str] = []
    changed = False

    for item in items:
        if item.get("item_type") == "gift_card" and not item.get("gift_card_id"):
            gc_id, gc_code = await _issue_gift_card_for_item(
                db, sale, item, created_by=created_by, issuer_user=issuer_user,
            )
            item["gift_card_id"] = gc_id
            item["gift_card_code"] = gc_code
            item["fulfilled"] = True
            gift_card_ids.append(gc_id)
            changed = True
            try:
                import os
                from messaging import safe_trigger_messaging_event

                gc_doc = await db.gift_cards.find_one(
                    {"id": gc_id, "clinic_id": sale["clinic_id"]},
                    {"_id": 0},
                )
                patient = None
                if sale.get("patient_id"):
                    patient = await db.patients.find_one(
                        {"id": sale["patient_id"], "clinic_id": sale["clinic_id"]},
                        {"_id": 0},
                    )
                safe_trigger_messaging_event(
                    db,
                    os.environ.get("JWT_SECRET", ""),
                    sale["clinic_id"],
                    "gift_card_issued",
                    gift_card=gc_doc,
                    patient=patient,
                    recipient=(gc_doc or {}).get("recipient_phone") or sale.get("customer_phone"),
                    reference_type="gift_card",
                    reference_id=gc_id,
                )
            except Exception:
                pass
        elif item.get("item_type") == "package":
            pp = await db.patient_packages.find_one(
                {
                    "clinic_id": sale["clinic_id"],
                    "pos_sale_item_id": item.get("id"),
                },
                {"_id": 0, "id": 1},
            )
            if pp:
                item["patient_package_id"] = pp["id"]
                patient_package_ids.append(pp["id"])
                item["fulfilled"] = True
                changed = True

    upd: Dict[str, Any] = {"updated_at": _now_iso()}
    if changed:
        upd["items"] = items
    if gift_card_ids:
        upd["gift_card_ids"] = list({*(sale.get("gift_card_ids") or []), *gift_card_ids})
    if patient_package_ids:
        upd["patient_package_ids"] = list({
            *(sale.get("patient_package_ids") or []),
            *patient_package_ids,
        })
    if len(upd) > 1:
        await db.pos_sales.update_one(
            {"id": sale["id"], "clinic_id": sale["clinic_id"]},
            {"$set": upd},
        )
    sale.update(upd)
    sale["package_fulfillment"] = pkg_stats
    return sale


class PosSaleItemIn(BaseModel):
    item_type: str = "product"
    product_id: Optional[str] = None
    package_catalog_id: Optional[str] = None
    treatment_catalog_id: Optional[str] = None
    gift_card_id: Optional[str] = None
    name_snapshot: str
    qty: float = 1
    unit_price: int = 0
    discount: int = 0
    tax: int = 0
    metadata: Optional[Dict[str, Any]] = None


class PosSaleCreateIn(BaseModel):
    patient_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    is_walk_in: bool = False
    sale_type: Optional[str] = None
    items: List[PosSaleItemIn] = Field(default_factory=list)
    discount_type: str = "none"
    discount_value: float = 0
    discount_total: int = 0
    coupon_code: Optional[str] = None
    tax_total: int = 0
    payment_method: Optional[str] = None
    amount_paid: Optional[int] = None
    notes: Optional[str] = ""
    complete: bool = False
    gift_card_code: Optional[str] = None
    gift_card_amount_idr: Optional[int] = None
    wallet_amount_idr: Optional[int] = None
    overpayment_to_wallet: bool = False


class PosSaleUpdateIn(BaseModel):
    patient_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    is_walk_in: Optional[bool] = None
    sale_type: Optional[str] = None
    items: Optional[List[PosSaleItemIn]] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    discount_total: Optional[int] = None
    coupon_code: Optional[str] = None
    tax_total: Optional[int] = None
    notes: Optional[str] = None


class PosSalePayIn(BaseModel):
    payment_method: str = "cash"
    amount_paid: Optional[int] = None
    gift_card_code: Optional[str] = None
    gift_card_amount_idr: Optional[int] = None
    wallet_amount_idr: Optional[int] = None
    overpayment_to_wallet: bool = False


class PosSaleCancelIn(BaseModel):
    cancel_reason: str = Field(..., min_length=3)


class PosSaleRefundIn(BaseModel):
    amount_idr: int = Field(..., gt=0)
    method: str = "cash"
    reason: str = Field(..., min_length=3)
    notes: str = ""


def register_pos_sales(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    audit,
    scope,
):
    def _can_view(user: dict) -> bool:
        if user.get("role") in ("super_admin", "fo", "manager"):
            return user_has_permission(user, "pos.view") or user_has_permission(user, "billing.view")
        return user_has_permission(user, "pos.view")

    def _can_create(user: dict) -> bool:
        return user_has_permission(user, "pos.create")

    def _can_cancel(user: dict) -> bool:
        return user_has_permission(user, "pos.cancel")

    async def _complete_pos_payment(
        user: dict,
        sale: dict,
        *,
        payment_method: str,
        amount_paid: Optional[int],
        gift_card_code: Optional[str],
        gift_card_amount_idr: Optional[int],
        wallet_amount_idr: Optional[int] = None,
        overpayment_to_wallet: bool = False,
    ) -> dict:
        from gift_cards_core import (
            apply_gift_card_payment,
            find_gift_card_by_code,
            make_payment_record,
            redeem_value_credit,
            reverse_redemptions_for_reference,
        )
        from gift_card_models import is_entitlement_gift_card
        from gift_cards_booking import pos_entitlement_redemption_blocked_message
        from wallet_core import (
            apply_wallet_payment,
            credit_overpayment_to_wallet,
            reverse_wallet_transactions_for_reference,
        )

        total = int(sale.get("total") or 0)
        method = (payment_method or "cash").strip().lower()
        if method not in PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail="Invalid payment_method")
        code = (gift_card_code or "").strip() or None
        payments: list = []
        patient_id = sale.get("patient_id")
        remaining = total
        gc_paid = 0
        wallet_paid = 0
        reds: list = []

        async def _rollback() -> None:
            if reds:
                await reverse_redemptions_for_reference(db, user["clinic_id"], "pos_sale", sale["id"])
            if wallet_paid:
                await reverse_wallet_transactions_for_reference(db, user, "pos_sale", sale["id"])

        wallet_req = int(wallet_amount_idr or 0)
        use_split = wallet_req > 0 or overpayment_to_wallet

        if code or method == "gift_card":
            if use_split:
                if not code:
                    raise HTTPException(status_code=400, detail="Gift card code is required")
                card = await find_gift_card_by_code(db, user["clinic_id"], code)
                if not card:
                    raise HTTPException(status_code=404, detail="Gift card not found")
                if is_entitlement_gift_card(card):
                    raise HTTPException(status_code=400, detail=pos_entitlement_redemption_blocked_message(card))
                requested = int(gift_card_amount_idr or 0)
                if requested <= 0:
                    raise HTTPException(status_code=400, detail="Gift card redemption amount is required")
                if requested > remaining:
                    raise HTTPException(status_code=400, detail=f"Redemption cannot exceed amount due ({remaining:,} IDR)")
                red = await redeem_value_credit(
                    db,
                    clinic_id=user["clinic_id"],
                    user=user,
                    gift_card_code=code,
                    amount_idr=requested,
                    reference_type="pos_sale",
                    reference_id=sale["id"],
                    patient_id=patient_id,
                )
                gc_paid = int(red["amount_redeemed"])
                reds.append(red)
                payments.append(make_payment_record(
                    "gift_card", gc_paid, user,
                    gift_card_code=code,
                    gift_card_id=card.get("id"),
                    gift_card_redemption_id=red.get("id"),
                ))
                remaining = max(0, total - gc_paid)
            else:
                cash, gc_paid, reds, method, new_pays = await apply_gift_card_payment(
                    db,
                    user,
                    total_idr=total,
                    gift_card_code=code,
                    gift_card_amount_idr=gift_card_amount_idr,
                    cash_amount_paid=amount_paid,
                    reference_type="pos_sale",
                    reference_id=sale["id"],
                    payment_method=method,
                    patient_id=patient_id,
                    line_items=sale.get("items") or [],
                )
                payments.extend(new_pays)
                paid_total = cash + gc_paid
                now = _now_iso()
                await db.pos_sales.update_one(
                    scope(user, {"id": sale["id"]}),
                    {"$set": {
                        "status": "paid",
                        "amount_paid": cash,
                        "gift_card_payment_total_idr": gc_paid,
                        "wallet_payment_total_idr": 0,
                        "gift_card_redemptions": reds,
                        "payments": payments,
                        "balance_due": max(0, total - paid_total),
                        "payment_status": _derive_payment_status(paid_total, total, "paid"),
                        "payment_method": method,
                        "paid_at": now,
                        "updated_at": now,
                    }},
                )
                sale = await _get_sale(user, sale["id"])
                await _fulfill_paid_sale(db, sale, created_by=user["id"], issuer_user=user)
                return await _get_sale(user, sale["id"])

        if wallet_req > 0:
            if not patient_id:
                await _rollback()
                raise HTTPException(
                    status_code=400,
                    detail="Store credit requires a selected patient (walk-in cannot use wallet)",
                )
            applied, _, wallet_pay = await apply_wallet_payment(
                db,
                user,
                patient_id=patient_id,
                amount_idr=min(wallet_req, remaining),
                max_due=remaining,
                reference_type="pos_sale",
                reference_id=sale["id"],
            )
            wallet_paid = applied
            payments.append(wallet_pay)
            remaining = max(0, remaining - wallet_paid)

        cash = int(amount_paid if amount_paid is not None else remaining)
        if wallet_paid + gc_paid + cash < total:
            await _rollback()
            raise HTTPException(status_code=400, detail=f"Insufficient payment: need {total:,} IDR")

        cash_applied = min(cash, remaining) if remaining > 0 else 0
        excess_cash = max(0, cash - remaining) if remaining > 0 else max(0, cash - total)

        if cash_applied > 0:
            cash_method = "cash" if method == "gift_card" else method
            payments.append(make_payment_record(cash_method, cash_applied, user))

        if excess_cash > 0 and overpayment_to_wallet and patient_id:
            await credit_overpayment_to_wallet(
                db, user, patient_id, excess_cash,
                reference_type="pos_sale", reference_id=sale["id"],
            )

        paid_total = gc_paid + wallet_paid + cash_applied
        if gc_paid >= total and cash_applied <= 0 and wallet_paid <= 0:
            settled = "gift_card"
        elif wallet_paid >= total and cash_applied <= 0 and gc_paid <= 0:
            settled = "store_credit"
        elif (gc_paid + wallet_paid) > 0 and cash_applied > 0:
            settled = "mixed"
        elif gc_paid > 0:
            settled = "gift_card" if wallet_paid <= 0 else "mixed"
        elif wallet_paid > 0:
            settled = "mixed" if cash_applied > 0 else "store_credit"
        else:
            settled = method

        now = _now_iso()
        await db.pos_sales.update_one(
            scope(user, {"id": sale["id"]}),
            {"$set": {
                "status": "paid",
                "amount_paid": cash_applied if cash_applied > 0 else cash,
                "gift_card_payment_total_idr": gc_paid,
                "wallet_payment_total_idr": wallet_paid,
                "gift_card_redemptions": reds,
                "payments": payments,
                "balance_due": max(0, total - paid_total),
                "payment_status": _derive_payment_status(paid_total, total, "paid"),
                "payment_method": settled,
                "paid_at": now,
                "updated_at": now,
            }},
        )
        sale = await _get_sale(user, sale["id"])
        await _fulfill_paid_sale(db, sale, created_by=user["id"], issuer_user=user)
        return await _get_sale(user, sale["id"])

    async def _require_pos_feature(user: dict) -> None:
        await assert_feature(user, "products")

    async def _get_sale(user: dict, sale_id: str) -> dict:
        doc = await db.pos_sales.find_one(scope(user, {"id": sale_id}), {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="POS sale not found")
        return doc

    async def _validate_patient(user: dict, patient_id: Optional[str]) -> Optional[dict]:
        if not patient_id:
            return None
        p = await db.patients.find_one(
            scope(user, {"id": patient_id}),
            {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "email": 1},
        )
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        return p

    def _validate_customer_and_patient(
        *,
        is_walk_in: bool,
        patient_id: Optional[str],
        customer_name: Optional[str],
        items: List[dict],
    ) -> None:
        if _sale_requires_patient(items) and not patient_id:
            raise HTTPException(
                status_code=400,
                detail="Patient is required when selling a package (creates patient package after payment)",
            )
        if not is_walk_in and not patient_id:
            if not (customer_name or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="Select a patient or enter walk-in customer details",
                )

    async def _enrich_product_item(user: dict, item: dict) -> dict:
        if item.get("item_type") != "product" or not item.get("product_id"):
            return item
        product = await db.products.find_one(scope(user, {"id": item["product_id"]}), {"_id": 0})
        if not product:
            raise HTTPException(status_code=400, detail="Product not found")
        if not product.get("active", True):
            raise HTTPException(status_code=400, detail=f"Product inactive: {product.get('name')}")
        if product.get("pos_enabled", True) is False:
            raise HTTPException(status_code=400, detail=f"Product not enabled for POS: {product.get('name')}")
        if not item.get("name_snapshot") or item["name_snapshot"] == "Gift card":
            item["name_snapshot"] = product.get("name") or ""
        if item.get("unit_price") in (None, 0) and product.get("sale_price_idr"):
            item["unit_price"] = int(product.get("sale_price_idr") or 0)
        item["total"] = _item_line_total(item)
        return item

    async def _enrich_package_item(user: dict, item: dict) -> dict:
        if item.get("item_type") != "package":
            return item
        cid = item.get("package_catalog_id")
        if not cid:
            raise HTTPException(status_code=400, detail="Package catalog id required")
        pkg = await db.packages.find_one(scope(user, {"id": cid, "active": True}), {"_id": 0})
        if not pkg:
            raise HTTPException(status_code=400, detail="Package not found or inactive")
        if not item.get("name_snapshot") or item["name_snapshot"] == "Gift card":
            item["name_snapshot"] = pkg.get("name") or "Package"
        if item.get("unit_price") in (None, 0):
            item["unit_price"] = int(pkg.get("price_idr") or 0)
        item["total"] = _item_line_total(item)
        meta = item.get("metadata") or {}
        meta["package_type"] = pkg.get("package_type")
        meta["sessions_total"] = pkg.get("sessions_total")
        item["metadata"] = meta
        return item

    async def _enrich_service_item(user: dict, item: dict) -> dict:
        if item.get("item_type") != "service":
            return item
        tid = item.get("treatment_catalog_id")
        if not tid:
            raise HTTPException(status_code=400, detail="Treatment id required for service line")
        tr = await db.treatments.find_one(scope(user, {"id": tid, "active": True}), {"_id": 0})
        if not tr:
            raise HTTPException(status_code=400, detail="Treatment not found or inactive")
        if not item.get("name_snapshot") or item["name_snapshot"] == "Gift card":
            item["name_snapshot"] = tr.get("name") or "Service"
        if item.get("unit_price") in (None, 0):
            item["unit_price"] = int(tr.get("price_idr") or 0)
        item["total"] = _item_line_total(item)
        meta = item.get("metadata") or {}
        meta["duration_min"] = tr.get("duration_min")
        meta["category"] = tr.get("category")
        item["metadata"] = meta
        return item

    async def _enrich_gift_card_item(user: dict, item: dict) -> dict:
        if item.get("item_type") != "gift_card":
            return item
        _require_gift_card_create(user, [item])
        from gift_card_models import GIFT_CARD_TYPES

        meta = dict(item.get("metadata") or {})
        gc_type = (meta.get("gift_card_type") or "value_credit").strip().lower()
        if gc_type not in GIFT_CARD_TYPES:
            raise HTTPException(status_code=400, detail="Invalid gift card type")
        meta["gift_card_type"] = gc_type
        unit = int(item.get("unit_price") or 0)
        can_override = user_has_permission(user, "pos.override_price")

        if gc_type == "value_credit":
            value = int(meta.get("value_idr") or unit or 0)
            if value <= 0:
                raise HTTPException(status_code=400, detail="Gift card value is required")
            meta["value_idr"] = value
            if unit <= 0:
                unit = value
            elif unit != value and not can_override:
                raise HTTPException(
                    status_code=403,
                    detail="Insufficient permission to override gift card value",
                )
            item["name_snapshot"] = item.get("name_snapshot") or "Gift Card (Value / Credit)"
        elif gc_type == "treatment":
            tid = meta.get("treatment_catalog_id") or item.get("treatment_catalog_id")
            if not tid:
                raise HTTPException(status_code=400, detail="Treatment is required for treatment gift card")
            tr = await db.treatments.find_one(scope(user, {"id": tid, "active": True}), {"_id": 0})
            if not tr:
                raise HTTPException(status_code=400, detail="Treatment not found or inactive")
            catalog_price = int(tr.get("price_idr") or 0)
            meta["treatment_catalog_id"] = tid
            meta["treatment_name_snapshot"] = meta.get("treatment_name_snapshot") or tr.get("name")
            item["treatment_catalog_id"] = tid
            if unit <= 0:
                unit = catalog_price
            elif catalog_price > 0 and unit != catalog_price and not can_override:
                raise HTTPException(
                    status_code=403,
                    detail="Insufficient permission to override gift card price",
                )
            if unit <= 0:
                raise HTTPException(status_code=400, detail="Gift card price must be greater than zero")
            meta["value_idr"] = unit
            item["name_snapshot"] = f"Gift Card · {tr.get('name') or 'Treatment'}"
        elif gc_type == "package":
            pid = meta.get("package_catalog_id") or item.get("package_catalog_id")
            if not pid:
                raise HTTPException(status_code=400, detail="Package is required for package gift card")
            pkg = await db.packages.find_one(scope(user, {"id": pid, "active": True}), {"_id": 0})
            if not pkg:
                raise HTTPException(status_code=400, detail="Package not found or inactive")
            catalog_price = int(pkg.get("price_idr") or 0)
            meta["package_catalog_id"] = pid
            meta["package_name_snapshot"] = meta.get("package_name_snapshot") or pkg.get("name")
            item["package_catalog_id"] = pid
            if unit <= 0:
                unit = catalog_price
            elif catalog_price > 0 and unit != catalog_price and not can_override:
                raise HTTPException(
                    status_code=403,
                    detail="Insufficient permission to override gift card price",
                )
            if unit <= 0:
                raise HTTPException(status_code=400, detail="Gift card price must be greater than zero")
            meta["value_idr"] = unit
            item["name_snapshot"] = f"Gift Card · {pkg.get('name') or 'Package'}"
        else:
            raise HTTPException(status_code=400, detail="Invalid gift card type")

        if meta.get("recipient_name") and "—" not in (item.get("name_snapshot") or ""):
            item["name_snapshot"] = f"{item['name_snapshot']} — {meta['recipient_name']}"

        expiry = meta.get("expiry_date") or meta.get("expires_at")
        if expiry:
            meta["expiry_date"] = str(expiry)[:10]
            meta.pop("expires_at", None)

        item["unit_price"] = unit
        item["metadata"] = meta
        item["total"] = _item_line_total(item)

        if item.get("gift_card_id") and not item.get("gift_card_code"):
            gc = await db.gift_cards.find_one(
                {"clinic_id": user["clinic_id"], "id": item["gift_card_id"]},
                {"_id": 0, "code": 1},
            )
            if gc:
                item["gift_card_code"] = gc.get("code")
        return item

    async def _enrich_all_items(user: dict, items: List[dict]) -> List[dict]:
        for idx, item in enumerate(items):
            it = item.get("item_type")
            if it == "product":
                items[idx] = await _enrich_product_item(user, item)
            elif it == "package":
                await assert_feature(user, "packages")
                items[idx] = await _enrich_package_item(user, item)
            elif it == "service":
                await assert_feature(user, "treatments")
                items[idx] = await _enrich_service_item(user, item)
            elif it == "gift_card":
                items[idx] = await _enrich_gift_card_item(user, item)
            else:
                item["total"] = _item_line_total(item)
                items[idx] = item
        return items

    def _build_sale_doc(
        *,
        user: dict,
        patient: Optional[dict],
        payload: PosSaleCreateIn,
        items: List[dict],
        totals: Dict[str, int],
        status: str,
        sale_type: str,
        sale_number: str,
        now: str,
    ) -> dict:
        amount_paid = int(
            payload.amount_paid
            if payload.amount_paid is not None
            else (totals["total"] if status == "paid" else 0)
        )
        payment_method = (payload.payment_method or "cash").strip().lower() if status == "paid" else None
        balance = max(0, totals["total"] - amount_paid) if status == "paid" else totals["total"]
        return {
            "id": str(uuid.uuid4()),
            "clinic_id": user["clinic_id"],
            "sale_number": sale_number,
            "patient_id": payload.patient_id,
            "patient_name_snapshot": patient.get("full_name") if patient else None,
            "customer_name": (payload.customer_name or "").strip() or None,
            "customer_phone": (payload.customer_phone or "").strip() or None,
            "customer_email": (payload.customer_email or "").strip() or None,
            "is_walk_in": bool(payload.is_walk_in or not payload.patient_id),
            "sale_type": sale_type,
            "status": status,
            "items": items,
            "subtotal": totals["subtotal"],
            "discount_type": totals.get("discount_type", "none"),
            "discount_value": totals.get("discount_value", 0),
            "discount_total": totals["discount_total"],
            "coupon_code": (payload.coupon_code or "").strip().upper() or None,
            "tax_total": totals["tax_total"],
            "total": totals["total"],
            "amount_paid": amount_paid if status == "paid" else 0,
            "balance_due": balance,
            "payment_status": _derive_payment_status(amount_paid, totals["total"], status),
            "payment_method": payment_method,
            "payments": [],
            "cashier_user_id": user["id"],
            "cashier_name_snapshot": user.get("name") or "",
            "notes": (payload.notes or "").strip(),
            "visit_id": None,
            "booking_id": None,
            "gift_card_ids": [],
            "gift_card_redemptions": [],
            "gift_card_payment_total_idr": 0,
            "wallet_payment_total_idr": 0,
            "patient_package_ids": [],
            "created_at": now,
            "updated_at": now,
            "paid_at": now if status == "paid" else None,
            "cancelled_at": None,
        }

    @api.get("/pos/products")
    async def pos_products(
        user: dict = Depends(get_current_user),
        q: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=50),
    ):
        if not _can_view(user) and not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "active": True, "pos_enabled": {"$ne": False}}
        if q:
            rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
            flt["$or"] = [{"name": rx}, {"product_code": rx}, {"brand": rx}, {"category": rx}]
        skip = (page - 1) * page_size
        items = await db.products.find(flt, {"_id": 0}).sort("name", 1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.products.count_documents(flt)
        for p in items:
            p["sale_price"] = p.get("sale_price_idr")
            if p.get("sale_price_idr") in (None, 0):
                p["price_not_set"] = True
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    @api.get("/pos/packages")
    async def pos_packages(
        user: dict = Depends(get_current_user),
        q: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=50),
    ):
        if not _can_view(user) and not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_feature(user, "packages")
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "active": True}
        if q:
            rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
            flt["$or"] = [{"name": rx}, {"package_code": rx}, {"category": rx}]
        skip = (page - 1) * page_size
        items = await db.packages.find(flt, {"_id": 0}).sort("name", 1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.packages.count_documents(flt)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    @api.get("/pos/treatments")
    async def pos_treatments(
        user: dict = Depends(get_current_user),
        q: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=50),
    ):
        if not _can_view(user) and not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_feature(user, "treatments")
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "active": True}
        if q:
            rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
            flt["$or"] = [{"name": rx}, {"service_code": rx}, {"category": rx}]
        skip = (page - 1) * page_size
        items = await db.treatments.find(flt, {"_id": 0}).sort("name", 1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.treatments.count_documents(flt)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def _can_closing(user: dict) -> bool:
        return (
            user_has_permission(user, "closing.view")
            or user_has_permission(user, "billing.view")
            or user_has_permission(user, "reports.view")
            or _can_view(user)
        )

    async def _attach_closing_locks(clinic_id: str, rows: List[dict]) -> List[dict]:
        paid_dates = {
            (r.get("paid_at") or "")[:10]
            for r in rows
            if r.get("status") == "paid" and r.get("paid_at")
        }
        closed_dates = set()
        for d in paid_dates:
            if await is_day_closed(db, clinic_id, d):
                closed_dates.add(d)
        for r in rows:
            d = (r.get("paid_at") or "")[:10]
            r["closing_locked"] = r.get("status") == "paid" and d in closed_dates
        return rows

    @api.get("/pos/daily-closing")
    async def pos_daily_closing(
        user: dict = Depends(get_current_user),
        date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to today (UTC)"),
    ):
        """Legacy alias for closing preview."""
        if not _can_closing(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        day = (date or "").strip() or utc_today_str()
        try:
            return await aggregate_daily_closing(db, user["clinic_id"], day)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex

    @api.get("/pos/sales/today")
    async def pos_sales_today(user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        cid = user["clinic_id"]
        today = utc_today_str()
        flt = build_pos_sales_filter(cid, today_only=True)
        rows = await db.pos_sales.find(flt, {"_id": 0}).sort("paid_at", -1).to_list(2000)
        await _attach_closing_locks(cid, rows)
        summary = summarize_paid_pos_sales(rows)
        return {
            "date": today,
            "summary": summary,
            "items": [sale_list_row(r) for r in rows],
        }

    @api.get("/pos/sales/export")
    async def pos_sales_export(
        user: dict = Depends(get_current_user),
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        status: Optional[str] = None,
        payment_method: Optional[str] = None,
        item_type: Optional[str] = None,
        cashier_id: Optional[str] = None,
        customer_search: Optional[str] = Query(None, alias="q"),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        flt = build_pos_sales_filter(
            user["clinic_id"],
            date_from=date_from,
            date_to=date_to,
            status=status,
            payment_method=payment_method,
            item_type=item_type,
            cashier_id=cashier_id,
            customer_search=customer_search,
        )
        rows = await db.pos_sales.find(flt, {"_id": 0}).sort("paid_at", -1).to_list(10000)
        from fastapi.responses import Response

        buf = io.StringIO()
        w = csv.DictWriter(
            buf,
            fieldnames=[
                "sale_number", "date", "time", "status", "customer", "items_summary",
                "payment_method", "subtotal", "discount_total", "tax_total", "total",
                "amount_paid", "cashier",
            ],
        )
        w.writeheader()
        for row in sales_to_csv_rows(rows):
            w.writerow(row)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="pos-sales-export.csv"'},
        )

    @api.get("/pos/sales")
    async def list_pos_sales(
        user: dict = Depends(get_current_user),
        status: Optional[str] = None,
        payment_method: Optional[str] = None,
        item_type: Optional[str] = None,
        cashier_id: Optional[str] = None,
        customer_search: Optional[str] = Query(None, alias="q"),
        q: Optional[str] = None,
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        search = customer_search or q
        flt = build_pos_sales_filter(
            user["clinic_id"],
            date_from=date_from,
            date_to=date_to,
            status=status,
            payment_method=payment_method,
            item_type=item_type,
            cashier_id=cashier_id,
            customer_search=search,
        )
        skip = (page - 1) * page_size
        rows = await db.pos_sales.find(flt, {"_id": 0}).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.pos_sales.count_documents(flt)
        await _attach_closing_locks(user["clinic_id"], rows)
        return {
            "items": [sale_list_row(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    @api.get("/pos/sales/{sale_id}")
    async def get_pos_sale(sale_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        sale = await _get_sale(user, sale_id)
        if sale.get("status") == "paid":
            paid_day = (sale.get("paid_at") or "")[:10]
            sale["closing_locked"] = bool(
                paid_day and await is_day_closed(db, user["clinic_id"], paid_day)
            )
        else:
            sale["closing_locked"] = False
        from refunds import refund_to_api

        refund_rows = await db.refunds.find(
            {
                "clinic_id": user["clinic_id"],
                "reference_type": "pos_sale",
                "reference_id": sale_id,
                "status": "recorded",
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        sale["refunds"] = [refund_to_api(r) for r in refund_rows]
        return sale

    @api.post("/pos/sales")
    async def create_pos_sale(payload: PosSaleCreateIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions for POS sales")
        await _require_pos_feature(user)
        await assert_writeable(user)
        if not payload.items:
            raise HTTPException(status_code=400, detail="At least one sale item is required")

        patient = await _validate_patient(user, payload.patient_id)
        items = _normalize_items([i.model_dump() for i in payload.items])
        _require_gift_card_create(user, items)
        _validate_customer_and_patient(
            is_walk_in=bool(payload.is_walk_in or not payload.patient_id),
            patient_id=payload.patient_id,
            customer_name=payload.customer_name,
            items=items,
        )
        items = await _enrich_all_items(user, items)
        sale_type = (payload.sale_type or _infer_sale_type(items)).strip().lower()
        if sale_type not in SALE_TYPES:
            sale_type = _infer_sale_type(items)
        dtype = (payload.discount_type or "none").strip().lower()
        if dtype not in DISCOUNT_TYPES:
            dtype = "none"
        totals = _compute_sale_totals(
            items,
            discount_type=dtype,
            discount_value=payload.discount_value,
            discount_total=payload.discount_total,
            tax_total=payload.tax_total,
        )
        now = _now_iso()
        cid = user["clinic_id"]
        sale = _build_sale_doc(
            user=user,
            patient=patient,
            payload=payload,
            items=items,
            totals=totals,
            status="draft",
            sale_type=sale_type,
            sale_number=await _next_sale_number(db, cid),
            now=now,
        )
        await db.pos_sales.insert_one(sale)
        sale.pop("_id", None)
        if payload.complete:
            sale = await _complete_pos_payment(
                user,
                sale,
                payment_method=payload.payment_method or "cash",
                amount_paid=payload.amount_paid,
                gift_card_code=payload.gift_card_code,
                gift_card_amount_idr=payload.gift_card_amount_idr,
                wallet_amount_idr=payload.wallet_amount_idr,
                overpayment_to_wallet=payload.overpayment_to_wallet,
            )
        await audit(user, "create", "pos_sale", sale["id"], {"sale_number": sale["sale_number"], "status": sale["status"]})
        return sale

    @api.put("/pos/sales/{sale_id}")
    async def update_pos_sale(sale_id: str, payload: PosSaleUpdateIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        await assert_writeable(user)
        sale = await _get_sale(user, sale_id)
        if sale.get("status") != "draft":
            raise HTTPException(status_code=400, detail="Only draft sales can be edited")
        upd: Dict[str, Any] = {}
        patient_id = sale.get("patient_id")
        if payload.patient_id is not None:
            patient = await _validate_patient(user, payload.patient_id)
            patient_id = payload.patient_id
            upd["patient_id"] = payload.patient_id
            upd["patient_name_snapshot"] = patient.get("full_name") if patient else None
        if payload.customer_name is not None:
            upd["customer_name"] = payload.customer_name.strip() or None
        if payload.customer_phone is not None:
            upd["customer_phone"] = payload.customer_phone.strip() or None
        if payload.customer_email is not None:
            upd["customer_email"] = payload.customer_email.strip() or None
        if payload.is_walk_in is not None:
            upd["is_walk_in"] = payload.is_walk_in
        if payload.notes is not None:
            upd["notes"] = payload.notes.strip()
        items = sale.get("items") or []
        if payload.items is not None:
            items = _normalize_items([i.model_dump() for i in payload.items])
            _require_gift_card_create(user, items)
            items = await _enrich_all_items(user, items)
            upd["items"] = items
            upd["sale_type"] = _infer_sale_type(items)
        is_walk_in = upd.get("is_walk_in", sale.get("is_walk_in"))
        _validate_customer_and_patient(
            is_walk_in=bool(is_walk_in),
            patient_id=patient_id,
            customer_name=upd.get("customer_name", sale.get("customer_name")),
            items=upd.get("items", items),
        )
        dtype = payload.discount_type if payload.discount_type is not None else sale.get("discount_type", "none")
        dval = payload.discount_value if payload.discount_value is not None else sale.get("discount_value", 0)
        legacy_disc = payload.discount_total if payload.discount_total is not None else sale.get("discount_total", 0)
        tax_total = payload.tax_total if payload.tax_total is not None else sale.get("tax_total", 0)
        totals = _compute_sale_totals(
            upd.get("items", items),
            discount_type=dtype or "none",
            discount_value=dval,
            discount_total=legacy_disc,
            tax_total=tax_total,
        )
        upd.update(totals)
        if payload.coupon_code is not None:
            upd["coupon_code"] = payload.coupon_code.strip().upper() or None
        upd["balance_due"] = totals["total"]
        upd["payment_status"] = "unpaid"
        upd["updated_at"] = _now_iso()
        await db.pos_sales.update_one(scope(user, {"id": sale_id}), {"$set": upd})
        await audit(user, "update", "pos_sale", sale_id, {"fields": list(upd.keys())})
        return await _get_sale(user, sale_id)

    @api.post("/pos/sales/{sale_id}/pay")
    async def pay_pos_sale(sale_id: str, payload: PosSalePayIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        await assert_writeable(user)
        sale = await _get_sale(user, sale_id)
        if sale.get("status") == "cancelled":
            raise HTTPException(status_code=400, detail="Sale is cancelled")
        if sale.get("status") == "paid":
            raise HTTPException(status_code=400, detail="Sale already paid")
        if _sale_requires_patient(sale.get("items") or []) and not sale.get("patient_id"):
            raise HTTPException(status_code=400, detail="Patient required for package sale")
        _require_gift_card_create(user, sale.get("items") or [])
        sale = await _complete_pos_payment(
            user,
            sale,
            payment_method=payload.payment_method or "cash",
            amount_paid=payload.amount_paid,
            gift_card_code=payload.gift_card_code,
            gift_card_amount_idr=payload.gift_card_amount_idr,
            wallet_amount_idr=payload.wallet_amount_idr,
            overpayment_to_wallet=payload.overpayment_to_wallet,
        )
        await audit(user, "pay", "pos_sale", sale_id, {"method": sale.get("payment_method")})
        return sale

    @api.post("/pos/sales/{sale_id}/cancel")
    async def cancel_pos_sale(
        sale_id: str,
        payload: PosSaleCancelIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_cancel(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to cancel POS sales")
        await _require_pos_feature(user)
        await assert_writeable(user)
        sale = await _get_sale(user, sale_id)
        if sale.get("status") == "cancelled":
            return sale
        was_paid = sale.get("status") == "paid"
        if was_paid:
            paid_day = (sale.get("paid_at") or "")[:10]
            await assert_day_open_for_void(db, user["clinic_id"], paid_day)
        now = _now_iso()
        reason = payload.cancel_reason.strip()
        await db.pos_sales.update_one(
            scope(user, {"id": sale_id}),
            {"$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "cancelled_by": user.get("id"),
                "cancelled_by_name_snapshot": user.get("name") or "",
                "cancel_reason": reason,
                "updated_at": now,
                "payment_status": "unpaid",
            }},
        )
        if was_paid:
            cid = user["clinic_id"]
            sale = await _get_sale(user, sale_id)
            from gift_cards_core import cancel_gift_cards_for_pos_sale, reverse_redemptions_for_reference
            await reverse_stock_for_pos_sale(
                db, sale, created_by=user.get("id") or "", reason=reason,
            )
            await cancel_patient_packages_for_pos_sale(db, sale)
            await cancel_gift_cards_for_pos_sale(db, cid, sale_id)
            await reverse_redemptions_for_reference(db, cid, "pos_sale", sale_id)
            from wallet_core import reverse_wallet_transactions_for_reference
            await reverse_wallet_transactions_for_reference(db, user, "pos_sale", sale_id)
        await audit(user, "cancel", "pos_sale", sale_id, {"was_paid": was_paid, "reason": reason})
        return await _get_sale(user, sale_id)

    @api.post("/pos/sales/{sale_id}/refund")
    async def refund_pos_sale(
        sale_id: str,
        payload: PosSaleRefundIn,
        user: dict = Depends(get_current_user),
    ):
        """Record a refund/adjustment for a paid POS sale (allowed even after daily closing)."""
        from permissions import user_has_permission
        from refunds import create_refund_record
        from wallet_core import credit_refund_to_wallet

        if not user_has_permission(user, "refunds.create"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_pos_feature(user)
        await assert_writeable(user)
        sale = await _get_sale(user, sale_id)
        if sale.get("status") != "paid":
            raise HTTPException(status_code=400, detail="Only paid sales can be refunded")
        total = int(sale.get("total") or 0)
        if payload.amount_idr > total:
            raise HTTPException(status_code=400, detail="Refund cannot exceed sale total")
        method = (payload.method or "cash").strip().lower()
        if method == "store_credit" and not sale.get("patient_id"):
            raise HTTPException(status_code=400, detail="Patient required to refund to store credit")
        doc = await create_refund_record(
            db,
            user,
            reference_type="pos_sale",
            reference_id=sale_id,
            amount_idr=payload.amount_idr,
            method=method,
            reason=payload.reason,
            notes=payload.notes,
            business_date=(sale.get("paid_at") or "")[:10] or None,
        )
        if method == "store_credit":
            await credit_refund_to_wallet(
                db, user, sale["patient_id"], payload.amount_idr, doc["id"], payload.reason,
            )
        await audit(user, "refund_recorded", "pos_sale", sale_id, {"refund_id": doc["id"]})
        return doc
