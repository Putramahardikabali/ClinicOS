"""Daily closing — POS + invoice payments by business date."""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from permissions import user_has_permission
from pos_sales_helpers import customer_display, invoice_category_totals, items_summary, pos_sale_category_totals
from refunds import aggregate_refunds_for_date
from correction_constants import CLOSING_LOCK_MESSAGE

CLOSING_STATUSES = frozenset({"closed", "reopened"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _method_bucket() -> Dict[str, int]:
    return {"cash": 0, "card": 0, "qris": 0, "bank_transfer": 0, "gift_card": 0, "store_credit": 0, "other": 0}


def _add_method(bucket: Dict[str, int], method: str, amount: int) -> None:
    m = (method or "other").strip().lower()
    if m not in bucket:
        m = "other"
    bucket[m] += int(amount or 0)


def _allocate_money_and_redemption(doc: dict, *, is_pos: bool) -> tuple[Dict[str, int], int, int]:
    """
    Split a paid POS sale or invoice into:
    - income_methods: cash/card/QRIS/bank (money collected; excludes gift card / store credit)
    - gift_card_redemption_idr: store credit applied via gift card
    - store_credit_redemption_idr: patient wallet applied as payment
    """
    income = _method_bucket()
    gc_redemption = int(doc.get("gift_card_payment_total_idr") or 0)
    wallet_redemption = int(doc.get("wallet_payment_total_idr") or 0)
    payments = doc.get("payments") or []

    if payments:
        gc_from_payments = 0
        wallet_from_payments = 0
        for p in payments:
            if p.get("voided"):
                continue
            m = (p.get("method") or "other").strip().lower()
            amt = int(p.get("amount_idr") or 0)
            if m == "gift_card":
                gc_from_payments += amt
                continue
            if m == "store_credit":
                wallet_from_payments += amt
                continue
            _add_method(income, m, amt)
        if gc_from_payments > 0:
            gc_redemption = gc_from_payments
        if wallet_from_payments > 0:
            wallet_redemption = wallet_from_payments
    else:
        if is_pos:
            cash_amt = int(doc.get("amount_paid") or 0)
            total = int(doc.get("total") or 0)
        else:
            total_paid = int(doc.get("amount_paid") or 0)
            cash_amt = max(0, total_paid - gc_redemption - wallet_redemption)
            total = int(doc.get("total_amount") or 0)
        pm = (doc.get("payment_method") or "other").strip().lower()
        if gc_redemption <= 0:
            tender = cash_amt if cash_amt > 0 else total
            _add_method(income, pm if pm != "gift_card" else "cash", tender)
        elif cash_amt > 0:
            tender_method = pm if pm not in ("gift_card", "mixed") else "cash"
            _add_method(income, tender_method, cash_amt)

    if gc_redemption > 0:
        pass  # tracked separately, not in income_methods
    return income, gc_redemption, wallet_redemption


def _invoice_customer(inv: dict) -> str:
    patient = inv.get("patient") or {}
    if isinstance(patient, dict) and patient.get("full_name"):
        return patient["full_name"]
    return inv.get("patient_name_snapshot") or "—"


def _invoice_items_summary(inv: dict) -> str:
    items = inv.get("items") or []
    if not items:
        return "—"
    parts = []
    for it in items[:3]:
        name = (it.get("name") or "Item").strip()
        qty = it.get("quantity") or 1
        parts.append(f"{name} ×{qty}" if float(qty) != 1 else name)
    extra = len(items) - 3
    if extra > 0:
        parts.append(f"+{extra} more")
    return ", ".join(parts)


def _pos_transaction_row(sale: dict) -> dict:
    gc = int(sale.get("gift_card_payment_total_idr") or 0)
    cash = int(sale.get("amount_paid") or 0)
    paid_at = sale.get("paid_at") or ""
    return {
        "id": sale.get("id"),
        "source": "pos",
        "reference": sale.get("sale_number"),
        "time": paid_at,
        "time_display": paid_at[11:16] if len(paid_at) > 16 else paid_at[:10],
        "customer_display": customer_display(sale),
        "items_summary": items_summary(sale),
        "payment_method": sale.get("payment_method"),
        "amount_idr": cash + gc,
        "money_collected_idr": cash,
        "gift_card_redemption_idr": gc,
        "cashier_name_snapshot": sale.get("cashier_name_snapshot"),
    }


def _invoice_transaction_row(inv: dict) -> dict:
    gc = int(inv.get("gift_card_payment_total_idr") or 0)
    amt = int(inv.get("amount_paid") or inv.get("total_amount") or 0)
    cash = max(0, amt - gc)
    paid_at = inv.get("paid_at") or ""
    return {
        "id": inv.get("id"),
        "source": "invoice",
        "reference": inv.get("invoice_number"),
        "time": paid_at,
        "time_display": paid_at[11:16] if len(paid_at) > 16 else paid_at[:10],
        "customer_display": _invoice_customer(inv),
        "items_summary": _invoice_items_summary(inv),
        "payment_method": inv.get("payment_method"),
        "amount_idr": amt,
        "money_collected_idr": cash,
        "gift_card_redemption_idr": gc,
        "cashier_name_snapshot": None,
    }


async def get_closing_for_date(db, clinic_id: str, date_str: str) -> Optional[dict]:
    return await db.daily_closings.find_one(
        {"clinic_id": clinic_id, "business_date": date_str, "status": "closed"},
        {"_id": 0},
    )


async def is_day_closed(db, clinic_id: str, date_str: str) -> bool:
    doc = await get_closing_for_date(db, clinic_id, date_str)
    return doc is not None


async def assert_invoice_not_closing_locked(db, inv: dict, *, for_cancel: bool = False) -> None:
    """Block edits/cancel on paid invoices included in a closed business day."""
    status = inv.get("payment_status")
    if status != "paid" and not (for_cancel and status in ("paid", "partial")):
        return
    paid_at = (inv.get("paid_at") or "")[:10]
    if not paid_at or len(paid_at) < 10:
        return
    if await is_day_closed(db, inv["clinic_id"], paid_at):
        raise HTTPException(
            status_code=400,
            detail=CLOSING_LOCK_MESSAGE,
        )


async def aggregate_daily_closing(db, clinic_id: str, date_str: str) -> dict:
    """Paid POS + paid invoices for a calendar day (UTC date prefix on paid_at)."""
    date_str = (date_str or "").strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        raise ValueError("date must be YYYY-MM-DD")

    paid_rx = {"$regex": f"^{re.escape(date_str)}"}
    closing = await get_closing_for_date(db, clinic_id, date_str)

    pos_income_methods = _method_bucket()
    pos_product = pos_package = pos_gift = pos_service = pos_custom = 0
    pos_redemption_settled = 0
    pos_money_collected = 0
    pos_gc_redemptions = 0
    pos_wallet_redemptions = 0
    pos_count = 0
    pos_transactions: List[dict] = []

    pos_rows = await db.pos_sales.find(
        {"clinic_id": clinic_id, "status": "paid", "paid_at": paid_rx},
        {"_id": 0},
    ).sort("paid_at", -1).to_list(5000)
    for sale in pos_rows:
        pos_count += 1
        income, gc_amt, wallet_amt = _allocate_money_and_redemption(sale, is_pos=True)
        cash_amt = int(sale.get("amount_paid") or 0)
        pos_money_collected += cash_amt
        pos_gc_redemptions += gc_amt
        pos_wallet_redemptions += wallet_amt
        for k in pos_income_methods:
            pos_income_methods[k] += income.get(k, 0)
        pos_transactions.append(_pos_transaction_row(sale))
        cats = pos_sale_category_totals(sale)
        pos_product += cats["product_sales_idr"]
        pos_package += cats["package_sales_idr"]
        pos_gift += cats["gift_card_sales_idr"]
        pos_service += cats["service_sales_idr"]
        pos_custom += cats["custom_sales_idr"]
        pos_redemption_settled += cats["gift_card_redemption_settled_idr"]

    inv_income_methods = _method_bucket()
    inv_treatment = 0
    inv_package = 0
    inv_other = 0
    inv_redemption_settled = 0
    inv_money_collected = 0
    inv_gc_redemptions = 0
    inv_wallet_redemptions = 0
    inv_count = 0
    inv_transactions: List[dict] = []
    inv_campaign_discount_idr = 0
    inv_gross_sales_idr = 0

    inv_rows = await db.invoices.find(
        {"clinic_id": clinic_id, "payment_status": "paid", "paid_at": paid_rx},
        {"_id": 0},
    ).sort("paid_at", -1).to_list(5000)
    for inv in inv_rows:
        inv_count += 1
        income, gc_amt, wallet_amt = _allocate_money_and_redemption(inv, is_pos=False)
        amt = int(inv.get("amount_paid") or inv.get("total_amount") or 0)
        cash_portion = max(0, amt - gc_amt - wallet_amt)
        inv_money_collected += cash_portion
        inv_gc_redemptions += gc_amt
        inv_wallet_redemptions += wallet_amt
        for k in inv_income_methods:
            inv_income_methods[k] += income.get(k, 0)
        inv_transactions.append(_invoice_transaction_row(inv))
        inv_cats = invoice_category_totals(inv)
        inv_treatment += inv_cats["treatment_invoice_payments_idr"]
        inv_package += inv_cats["package_sales_idr"]
        inv_other += inv_cats["invoice_other_payments_idr"]
        inv_redemption_settled += inv_cats["gift_card_redemption_settled_idr"]
        if inv.get("campaign_id"):
            inv_campaign_discount_idr += int(inv.get("discount_amount_applied") or inv.get("discount_amount") or 0)
        inv_gross_sales_idr += int(inv.get("total_amount") or 0) + int(inv.get("discount_amount") or 0)

    redemption_rows = await db.gift_card_redemptions.find(
        {
            "clinic_id": clinic_id,
            "created_at": {"$regex": f"^{re.escape(date_str)}"},
            "reversed": {"$ne": True},
        },
        {"_id": 0, "amount_redeemed": 1, "amount_idr": 1},
    ).to_list(10000)
    redemption_from_ledger = 0
    for r in redemption_rows:
        redemption_from_ledger += int(
            r.get("amount_redeemed") if r.get("amount_redeemed") is not None else r.get("amount_idr") or 0
        )
    gift_card_redemptions_idr = max(
        pos_gc_redemptions + inv_gc_redemptions,
        redemption_from_ledger,
    )

    from gift_cards_core import aggregate_outstanding_summary
    from wallet_core import aggregate_outstanding_wallet_liability, aggregate_wallet_for_date
    outstanding = await aggregate_outstanding_summary(db, clinic_id)
    wallet_outstanding = await aggregate_outstanding_wallet_liability(db, clinic_id)
    wallet_summary = await aggregate_wallet_for_date(db, clinic_id, date_str)
    refunds_summary = await aggregate_refunds_for_date(db, clinic_id, date_str)

    store_credit_payments_idr = pos_wallet_redemptions + inv_wallet_redemptions

    income_methods = _method_bucket()
    for k in income_methods:
        income_methods[k] = pos_income_methods[k] + inv_income_methods[k]

    # Income tenders (cash/card/QRIS/bank) — separate from gift card redemption usage.
    payment_methods = dict(income_methods)
    redemption_payment_methods = {
        "gift_card": gift_card_redemptions_idr,
        "store_credit": store_credit_payments_idr,
    }
    redemption_settled_total = pos_redemption_settled + inv_redemption_settled

    money_collected_idr = pos_money_collected + inv_money_collected
    expected_cash_idr = int(income_methods.get("cash") or 0)

    breakdown = {
        "product_sales_idr": pos_product,
        "package_sales_idr": pos_package + inv_package,
        "service_sales_idr": pos_service,
        "custom_sales_idr": pos_custom,
        "gift_card_sales_idr": pos_gift,
        "gift_card_redemptions_idr": gift_card_redemptions_idr,
        "gift_card_redemption_settled_idr": redemption_settled_total,
        "refunds_idr": refunds_summary.get("total_idr") or 0,
        "refunds_by_method": refunds_summary.get("by_method") or {},
        "store_credit_payments_idr": store_credit_payments_idr,
        "wallet_credits_issued_idr": wallet_summary.get("wallet_credits_issued_idr") or 0,
        "wallet_credits_used_idr": wallet_summary.get("wallet_credits_used_idr") or 0,
        "refunds_to_wallet_idr": wallet_summary.get("refunds_to_wallet_idr") or 0,
        "gift_card_to_wallet_idr": wallet_summary.get("gift_card_to_wallet_idr") or 0,
        "treatment_invoice_payments_idr": inv_treatment,
        "invoice_other_payments_idr": inv_other,
        "invoice_campaign_discount_idr": inv_campaign_discount_idr,
        "invoice_gross_sales_idr": inv_gross_sales_idr,
        "invoice_net_sales_idr": max(0, inv_gross_sales_idr - inv_campaign_discount_idr),
        "payment_methods": payment_methods,
        "redemption_payment_methods": redemption_payment_methods,
        "refunds": refunds_summary,
    }
    all_transactions = sorted(
        pos_transactions + inv_transactions,
        key=lambda r: r.get("time") or "",
        reverse=True,
    )

    return {
        "date": date_str,
        "is_closed": closing is not None,
        "closing_id": closing.get("id") if closing else None,
        "closed_at": closing.get("closed_at") if closing else None,
        "expected_cash_idr": expected_cash_idr,
        "actual_cash_counted_idr": closing.get("actual_cash_counted_idr") if closing else None,
        "cash_difference_idr": closing.get("cash_difference_idr") if closing else None,
        "closing_notes": (closing.get("notes") or "") if closing else "",
        "money_collected_idr": money_collected_idr,
        "total_collected_idr": money_collected_idr,
        "gift_card_redemptions_idr": gift_card_redemptions_idr,
        "gift_card_redemption_settled_idr": redemption_settled_total,
        "gift_card_sales_idr": pos_gift,
        "outstanding_gift_card_liability_idr": int(outstanding.get("outstanding_balance_idr") or 0),
        "outstanding_wallet_liability_idr": int(wallet_outstanding.get("outstanding_balance_idr") or 0),
        "store_credit_payments_idr": store_credit_payments_idr,
        "wallet": wallet_summary,
        "payment_methods": payment_methods,
        "redemption_payment_methods": redemption_payment_methods,
        "income_payment_methods": income_methods,
        "breakdown": breakdown,
        "refunds": refunds_summary,
        "transactions": all_transactions,
        "pos": {
            "transaction_count": pos_count,
            "money_collected_idr": pos_money_collected,
            "total_collected_idr": pos_money_collected,
            "gift_card_redemptions_idr": pos_gc_redemptions,
            "product_sales_idr": pos_product,
            "package_sales_idr": pos_package,
            "gift_card_sales_idr": pos_gift,
            "service_sales_idr": pos_service,
            "custom_sales_idr": pos_custom,
            "service_custom_sales_idr": pos_service + pos_custom,
            "gift_card_redemption_settled_idr": pos_redemption_settled,
            "by_payment_method": dict(pos_income_methods),
            "redemption_payment_methods": {"gift_card": pos_gc_redemptions},
            "transactions": pos_transactions,
        },
        "invoices": {
            "transaction_count": inv_count,
            "money_collected_idr": inv_money_collected,
            "total_collected_idr": inv_money_collected,
            "gift_card_redemptions_idr": inv_gc_redemptions,
            "treatment_payments_idr": inv_treatment,
            "package_payments_idr": inv_package,
            "other_payments_idr": inv_other,
            "gift_card_redemption_settled_idr": inv_redemption_settled,
            "by_payment_method": dict(inv_income_methods),
            "redemption_payment_methods": {"gift_card": inv_gc_redemptions},
            "transactions": inv_transactions,
        },
    }


def history_list_row(doc: dict) -> dict:
    snap = doc.get("snapshot") or {}
    return {
        "id": doc.get("id"),
        "business_date": doc.get("business_date"),
        "status": doc.get("status"),
        "total_collected_idr": int(snap.get("total_collected_idr") or 0),
        "expected_cash_idr": int(doc.get("expected_cash_idr") or snap.get("expected_cash_idr") or 0),
        "actual_cash_counted_idr": doc.get("actual_cash_counted_idr"),
        "cash_difference_idr": doc.get("cash_difference_idr"),
        "closed_at": doc.get("closed_at"),
        "closed_by_name_snapshot": doc.get("closed_by_name_snapshot"),
        "reopened_at": doc.get("reopened_at"),
    }


class CloseDayIn(BaseModel):
    date: str
    notes: Optional[str] = ""
    actual_cash_counted_idr: Optional[int] = Field(None, ge=0)


class ReopenDayIn(BaseModel):
    date: str
    reason: Optional[str] = ""


def register_daily_closing(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    audit,
    scope,
):
    async def _require_products(user: dict) -> None:
        await assert_feature(user, "products")

    def _can_view(user: dict) -> bool:
        return (
            user_has_permission(user, "closing.view")
            or user_has_permission(user, "accounting.view")
            or user_has_permission(user, "reports.view")
        )

    def _can_create(user: dict) -> bool:
        return user_has_permission(user, "closing.create")

    def _can_reopen(user: dict) -> bool:
        return user_has_permission(user, "closing.reopen")

    @api.get("/closing/preview")
    async def closing_preview(
        user: dict = Depends(get_current_user),
        date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    ):
        if not _can_view(user) and not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        day = (date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            return await aggregate_daily_closing(db, user["clinic_id"], day)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex

    @api.post("/closing/close")
    async def closing_close(payload: CloseDayIn, user: dict = Depends(get_current_user)):
        if not _can_create(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to close day")
        await _require_products(user)
        await assert_writeable(user)
        day = payload.date.strip()[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            raise HTTPException(status_code=400, detail="Invalid date")
        cid = user["clinic_id"]
        existing = await get_closing_for_date(db, cid, day)
        if existing:
            raise HTTPException(status_code=400, detail="Day is already closed")
        snapshot = await aggregate_daily_closing(db, cid, day)
        expected_cash = int(snapshot.get("expected_cash_idr") or snapshot["payment_methods"].get("cash") or 0)
        actual = payload.actual_cash_counted_idr
        cash_diff = (int(actual) - expected_cash) if actual is not None else None
        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "business_date": day,
            "status": "closed",
            "snapshot": snapshot,
            "expected_cash_idr": expected_cash,
            "actual_cash_counted_idr": actual,
            "cash_difference_idr": cash_diff,
            "notes": (payload.notes or "").strip(),
            "closed_at": now,
            "closed_by_user_id": user["id"],
            "closed_by_name_snapshot": user.get("name") or "",
            "reopened_at": None,
            "reopened_by_user_id": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.daily_closings.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "close", "daily_closing", doc["id"], {"business_date": day})
        return doc

    @api.post("/closing/reopen")
    async def closing_reopen(payload: ReopenDayIn, user: dict = Depends(get_current_user)):
        if not _can_reopen(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions to reopen day")
        await _require_products(user)
        await assert_writeable(user)
        day = payload.date.strip()[:10]
        cid = user["clinic_id"]
        existing = await get_closing_for_date(db, cid, day)
        if not existing:
            raise HTTPException(status_code=404, detail="No closed day found for this date")
        now = _now_iso()
        await db.daily_closings.update_one(
            {"id": existing["id"]},
            {"$set": {
                "status": "reopened",
                "reopened_at": now,
                "reopened_by_user_id": user["id"],
                "reopened_by_name_snapshot": user.get("name") or "",
                "reopen_reason": (payload.reason or "").strip(),
                "updated_at": now,
            }},
        )
        await audit(user, "reopen", "daily_closing", existing["id"], {"business_date": day})
        return await db.daily_closings.find_one({"id": existing["id"]}, {"_id": 0})

    @api.get("/closing/history")
    async def closing_history(
        user: dict = Depends(get_current_user),
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        flt = {"clinic_id": user["clinic_id"]}
        skip = (page - 1) * page_size
        rows = await db.daily_closings.find(flt, {"_id": 0}).sort("business_date", -1).skip(skip).limit(page_size).to_list(page_size)
        total = await db.daily_closings.count_documents(flt)
        return {
            "items": [history_list_row(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    @api.get("/closing/{closing_id}")
    async def closing_detail(closing_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        doc = await db.daily_closings.find_one(
            scope(user, {"id": closing_id}),
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Closing not found")
        return doc

    @api.get("/closing/{closing_id}/export")
    async def closing_export(closing_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await _require_products(user)
        doc = await db.daily_closings.find_one(scope(user, {"id": closing_id}), {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Closing not found")
        snap = doc.get("snapshot") or {}
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Daily Closing", doc.get("business_date")])
        w.writerow(["Status", doc.get("status")])
        w.writerow(["Closed at", doc.get("closed_at")])
        w.writerow(["Closed by", doc.get("closed_by_name_snapshot")])
        w.writerow(["Notes", doc.get("notes")])
        w.writerow(["Expected cash IDR", doc.get("expected_cash_idr")])
        w.writerow(["Actual cash counted IDR", doc.get("actual_cash_counted_idr")])
        w.writerow(["Cash difference IDR", doc.get("cash_difference_idr")])
        w.writerow([])
        bd = snap.get("breakdown") or {}
        w.writerow(["Section", "Amount IDR"])
        w.writerow(["Money collected (cash/card/QRIS)", snap.get("money_collected_idr", 0)])
        w.writerow(["Gift card redemptions (not cash income)", snap.get("gift_card_redemptions_idr", 0)])
        w.writerow(["Outstanding gift card liability", snap.get("outstanding_gift_card_liability_idr", 0)])
        w.writerow([])
        w.writerow(["Sales breakdown", "Amount IDR"])
        w.writerow(["Product sales", bd.get("product_sales_idr", 0)])
        w.writerow(["Package sales", bd.get("package_sales_idr", 0)])
        w.writerow(["Service sales", bd.get("service_sales_idr", 0)])
        w.writerow(["Custom sales", bd.get("custom_sales_idr", 0)])
        w.writerow(["Gift card sales (issued)", bd.get("gift_card_sales_idr", 0)])
        w.writerow(["Sales settled via gift card (not revenue)", bd.get("gift_card_redemption_settled_idr", 0)])
        w.writerow(["Gift card redemptions (liability usage)", bd.get("gift_card_redemptions_idr", 0)])
        w.writerow(["Treatment invoice payments", bd.get("treatment_invoice_payments_idr", 0)])
        w.writerow([])
        pm = snap.get("payment_methods") or {}
        w.writerow(["Income payment methods (money collected)", "Amount IDR"])
        for k in ("cash", "card", "qris", "bank_transfer", "other"):
            if pm.get(k):
                w.writerow([k, pm.get(k, 0)])
        for k, v in pm.items():
            if k not in ("cash", "card", "qris", "bank_transfer", "gift_card", "other") and v:
                w.writerow([k, v])
        rpm = snap.get("redemption_payment_methods") or {}
        if rpm.get("gift_card"):
            w.writerow([])
            w.writerow(["Gift card redemptions (not cash income)", rpm.get("gift_card", 0)])
        w.writerow([])
        w.writerow(["Type", "Reference", "Time", "Customer", "Payment", "Amount IDR"])
        for tx in snap.get("transactions") or []:
            w.writerow([
                tx.get("source"),
                tx.get("reference"),
                tx.get("time"),
                tx.get("customer_display"),
                tx.get("payment_method"),
                tx.get("amount_idr"),
            ])
        content = buf.getvalue()
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="closing-{doc.get("business_date")}.csv"'},
        )
