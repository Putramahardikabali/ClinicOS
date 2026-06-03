"""Shared POS sale list/summary helpers (no routes)."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

SALE_STATUSES = frozenset({"draft", "paid", "cancelled"})
PAYMENT_METHODS = frozenset({"cash", "card", "bank_transfer", "qris", "other"})


def utc_today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def customer_display(sale: dict) -> str:
    return (
        sale.get("patient_name_snapshot")
        or sale.get("customer_name")
        or ("Walk-in" if sale.get("is_walk_in") else "—")
    )


def items_summary(sale: dict, max_items: int = 3) -> str:
    items = sale.get("items") or []
    if not items:
        return "—"
    parts = []
    for it in items[:max_items]:
        name = (it.get("name_snapshot") or "Item").strip()
        qty = it.get("qty") or 1
        parts.append(f"{name} ×{qty}" if float(qty) != 1 else name)
    extra = len(items) - max_items
    if extra > 0:
        parts.append(f"+{extra} more")
    return ", ".join(parts)


def sale_list_row(sale: dict) -> dict:
    paid_at = sale.get("paid_at") or sale.get("created_at") or ""
    return {
        "id": sale.get("id"),
        "sale_number": sale.get("sale_number"),
        "paid_at": sale.get("paid_at"),
        "created_at": sale.get("created_at"),
        "time_display": paid_at[11:16] if len(paid_at) > 16 else paid_at[:10],
        "date_display": paid_at[:10] if paid_at else "",
        "customer_display": customer_display(sale),
        "items_summary": items_summary(sale),
        "payment_method": sale.get("payment_method"),
        "subtotal": sale.get("subtotal"),
        "discount_total": sale.get("discount_total"),
        "tax_total": sale.get("tax_total"),
        "total": sale.get("total"),
        "amount_paid": sale.get("amount_paid"),
        "status": sale.get("status"),
        "cashier_name_snapshot": sale.get("cashier_name_snapshot"),
        "cashier_user_id": sale.get("cashier_user_id"),
        "is_walk_in": sale.get("is_walk_in"),
        "closing_locked": bool(sale.get("closing_locked")),
    }


def _split_line_amount(line: int, sale_total: int, cash_collected: int, gc_redemption: int) -> tuple[int, int]:
    """Return (cash_collected_portion, gift_card_redemption_portion) for a line total."""
    line = int(line or 0)
    if line <= 0:
        return 0, 0
    total = int(sale_total or 0)
    cash = int(cash_collected or 0)
    gc = int(gc_redemption or 0)
    if gc <= 0:
        return line, 0
    if cash <= 0:
        return 0, line
    if total <= 0:
        return 0, line
    cash_line = line * cash // total
    return cash_line, line - cash_line


def pos_sale_category_totals(sale: dict) -> Dict[str, int]:
    """
    POS line totals for daily closing / summaries.

    - gift_card_sales_idr: issuance lines only (money collected when selling cards).
    - product/package/service/custom: only the portion paid with cash/card/etc.
    - gift_card_redemption_settled_idr: retail lines paid using stored value (not new revenue).
    """
    total = int(sale.get("total") or 0)
    cash = int(sale.get("amount_paid") or 0)
    gc = int(sale.get("gift_card_payment_total_idr") or 0)
    product = package = gift = service = custom = 0
    redemption_settled = 0
    for it in sale.get("items") or []:
        line = int(it.get("total") or 0)
        t = (it.get("item_type") or "custom").strip().lower()
        if t == "gift_card":
            gift += line
            continue
        cash_line, gc_line = _split_line_amount(line, total, cash, gc)
        redemption_settled += gc_line
        if cash_line <= 0:
            continue
        if t == "product":
            product += cash_line
        elif t == "package":
            package += cash_line
        elif t == "service":
            service += cash_line
        else:
            custom += cash_line
    return {
        "product_sales_idr": product,
        "package_sales_idr": package,
        "gift_card_sales_idr": gift,
        "service_sales_idr": service,
        "custom_sales_idr": custom,
        "gift_card_redemption_settled_idr": redemption_settled,
    }


def invoice_category_totals(inv: dict) -> Dict[str, int]:
    """Invoice line totals — cash-collected vs gift-card redemption settlement."""
    total = int(inv.get("total_amount") or 0)
    amt_paid = int(inv.get("amount_paid") or 0)
    gc = int(inv.get("gift_card_payment_total_idr") or 0)
    cash = max(0, amt_paid - gc)
    treatment = package = other = 0
    redemption_settled = 0
    for it in inv.get("items") or []:
        line = int(it.get("line_total_idr") or it.get("amount_charged") or 0)
        itype = (it.get("item_type") or "custom").strip().lower()
        cash_line, gc_line = _split_line_amount(line, total, cash, gc)
        redemption_settled += gc_line
        if cash_line <= 0:
            continue
        if itype in ("treatment", "service"):
            treatment += cash_line
        elif itype == "package":
            package += cash_line
        else:
            other += cash_line
    return {
        "treatment_invoice_payments_idr": treatment,
        "package_sales_idr": package,
        "invoice_other_payments_idr": other,
        "gift_card_redemption_settled_idr": redemption_settled,
    }


def build_pos_sales_filter(
    clinic_id: str,
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    payment_method: Optional[str] = None,
    item_type: Optional[str] = None,
    cashier_id: Optional[str] = None,
    customer_search: Optional[str] = None,
    today_only: bool = False,
) -> Dict[str, Any]:
    clauses: List[Dict[str, Any]] = [{"clinic_id": clinic_id}]
    if status:
        st = status.strip().lower()
        if st in SALE_STATUSES:
            clauses.append({"status": st})
    if payment_method:
        pm = payment_method.strip().lower()
        if pm in PAYMENT_METHODS:
            clauses.append({"payment_method": pm})
    if cashier_id:
        clauses.append({"cashier_user_id": cashier_id.strip()})
    if item_type:
        it = item_type.strip().lower()
        clauses.append({"items": {"$elemMatch": {"item_type": it}}})
    if customer_search and customer_search.strip():
        rx = re.compile(re.escape(customer_search.strip()), re.IGNORECASE)
        clauses.append({
            "$or": [
                {"sale_number": rx},
                {"customer_name": rx},
                {"customer_phone": rx},
                {"customer_email": rx},
                {"patient_name_snapshot": rx},
            ],
        })
    if today_only:
        day = utc_today_str()
        clauses.append({"status": "paid"})
        clauses.append({"paid_at": {"$regex": f"^{re.escape(day)}"}})
    elif date_from or date_to:
        date_flt: Dict[str, Any] = {}
        if date_from:
            date_flt["$gte"] = f"{date_from[:10]}T00:00:00"
        if date_to:
            date_flt["$lte"] = f"{date_to[:10]}T23:59:59.999999"
        clauses.append({
            "$or": [
                {"paid_at": date_flt},
                {"created_at": date_flt},
            ],
        })
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def summarize_paid_pos_sales(sales: List[dict]) -> dict:
    """Summary cards for paid POS sales (today or filtered set)."""
    from daily_closing import _allocate_money_and_redemption

    methods: Dict[str, int] = defaultdict(int)
    product = package = gift_card = service = custom = 0
    redemption_settled = 0
    money_collected = 0
    gc_redemptions = 0
    count = 0
    for sale in sales:
        if sale.get("status") != "paid":
            continue
        count += 1
        income, gc_amt = _allocate_money_and_redemption(sale, is_pos=True)
        cash_amt = int(sale.get("amount_paid") or 0)
        money_collected += cash_amt
        gc_redemptions += gc_amt
        for k, v in income.items():
            methods[k] += v
        cats = pos_sale_category_totals(sale)
        product += cats["product_sales_idr"]
        package += cats["package_sales_idr"]
        gift_card += cats["gift_card_sales_idr"]
        service += cats["service_sales_idr"]
        custom += cats["custom_sales_idr"]
        redemption_settled += cats["gift_card_redemption_settled_idr"]
    service_custom = service + custom
    return {
        "transaction_count": count,
        "money_collected_idr": money_collected,
        "total_collected_idr": money_collected,
        "gift_card_redemptions_idr": gc_redemptions,
        "gift_card_redemption_settled_idr": redemption_settled,
        "by_payment_method": {
            "cash": methods.get("cash", 0),
            "card": methods.get("card", 0),
            "qris": methods.get("qris", 0),
            "bank_transfer": methods.get("bank_transfer", 0),
            "gift_card": gc_redemptions,
            "other": methods.get("other", 0),
        },
        "product_sales_idr": product,
        "package_sales_idr": package,
        "gift_card_sales_idr": gift_card,
        "service_sales_idr": service,
        "custom_sales_idr": custom,
        "service_custom_sales_idr": service_custom,
    }


def sales_to_csv_rows(sales: List[dict]) -> List[dict]:
    rows = []
    for s in sales:
        paid_at = s.get("paid_at") or s.get("created_at") or ""
        rows.append({
            "sale_number": s.get("sale_number"),
            "date": paid_at[:10],
            "time": paid_at[11:19] if len(paid_at) > 19 else "",
            "status": s.get("status"),
            "customer": customer_display(s),
            "items_summary": items_summary(s, max_items=10),
            "payment_method": s.get("payment_method"),
            "subtotal": s.get("subtotal"),
            "discount_total": s.get("discount_total"),
            "tax_total": s.get("tax_total"),
            "total": s.get("total"),
            "amount_paid": s.get("amount_paid"),
            "cashier": s.get("cashier_name_snapshot"),
        })
    return rows
