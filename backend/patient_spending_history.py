"""Patient spending / expense history aggregation and export."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from permissions import user_has_permission

SOURCE_VALUES = frozenset({
    "invoice", "pos", "package", "prepaid", "gift_card", "treatment_session",
})
ITEM_TYPE_VALUES = frozenset({
    "treatment", "package", "product", "prepaid", "gift_card", "custom", "service",
})
PAYMENT_STATUS_VALUES = frozenset({
    "paid", "partial", "unpaid", "void", "refunded", "redeemed", "usage",
})

ITEM_TYPE_LABELS = {
    "treatment": "Treatment",
    "package": "Package",
    "product": "Product",
    "prepaid": "Prepaid",
    "gift_card": "Gift Card",
    "custom": "Custom line",
    "service": "Service",
}

SOURCE_LABELS = {
    "invoice": "Invoice",
    "pos": "POS",
    "package": "Package",
    "prepaid": "Prepaid",
    "gift_card": "Gift Card",
    "treatment_session": "Treatment Session",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    try:
        if len(raw) == 10:
            return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _day_start(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _day_end(d: datetime) -> datetime:
    return d.replace(hour=23, minute=59, second=59, microsecond=999999)


def _coerce_at(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value).strip()


def _int(val: Any, default: int = 0) -> int:
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return default


def _float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val or 0)
    except (TypeError, ValueError):
        return default


def _slug_name(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (name or "patient").strip().lower())
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    return s[:60] or "patient"


def _item_type_label(item_type: str) -> str:
    return ITEM_TYPE_LABELS.get((item_type or "custom").lower(), (item_type or "Custom").title())


def _source_label(source: str) -> str:
    return SOURCE_LABELS.get((source or "").lower(), (source or "").title())


def _invoice_line_total(item: dict) -> int:
    if item.get("line_total_idr") is not None:
        return max(0, _int(item.get("line_total_idr")))
    if item.get("amount_charged") is not None:
        return max(0, _int(item.get("amount_charged")))
    qty = _float(item.get("quantity") or item.get("qty") or 1, 1.0)
    price = _int(item.get("unit_price_idr") or item.get("unit_price"))
    return max(0, int(round(price * qty)))


def _pos_line_total(item: dict) -> int:
    if item.get("total") is not None:
        return max(0, _int(item.get("total")))
    qty = _float(item.get("qty") or 1, 1.0)
    price = _int(item.get("unit_price"))
    discount = _int(item.get("discount"))
    return max(0, int(round(price * qty)) - discount)


def _performer_name(item: dict, staff_map: Dict[str, str]) -> str:
    if item.get("performer_name"):
        return str(item.get("performer_name"))
    pid = item.get("performer_id")
    if pid and staff_map.get(pid):
        return staff_map[pid]
    performers = item.get("performers") or []
    if performers:
        names = [p.get("staff_name") or staff_map.get(p.get("staff_id") or "", "") for p in performers]
        names = [n for n in names if n]
        if names:
            return ", ".join(names)
    return ""


def _discount_label(doc: dict) -> str:
    parts = []
    if doc.get("campaign_name_snapshot"):
        parts.append(str(doc.get("campaign_name_snapshot")))
    if doc.get("coupon_code"):
        parts.append(f"Coupon {doc.get('coupon_code')}")
    dtype = (doc.get("discount_type") or "").strip().lower()
    if dtype and dtype != "none":
        val = doc.get("discount_value")
        if val:
            parts.append(f"{dtype} {val}")
    if doc.get("discount_reason"):
        parts.append(str(doc.get("discount_reason")))
    return " · ".join(parts)


def _row(
    *,
    row_id: str,
    at: Any,
    source: str,
    reference_number: str = "",
    item_type: str = "custom",
    item_name: str = "",
    session_date: str = "",
    quantity: float = 1,
    unit_price_idr: int = 0,
    discount_idr: int = 0,
    discount_label: str = "",
    line_total_idr: int = 0,
    payment_method: str = "",
    payment_status: str = "",
    staff_name: str = "",
    notes: str = "",
    reference_id: str = "",
    counts_toward_cash_paid: bool = False,
    row_kind: str = "purchase",
) -> dict:
    return {
        "id": row_id,
        "date": _coerce_at(at),
        "source": source,
        "source_label": _source_label(source),
        "reference_number": reference_number,
        "item_type": item_type,
        "item_type_label": _item_type_label(item_type),
        "item_name": item_name,
        "session_date": session_date,
        "quantity": quantity,
        "unit_price_idr": unit_price_idr,
        "discount_idr": discount_idr,
        "discount_label": discount_label,
        "line_total_idr": line_total_idr,
        "payment_method": payment_method,
        "payment_status": payment_status,
        "staff_name": staff_name,
        "notes": notes,
        "reference_id": reference_id,
        "counts_toward_cash_paid": counts_toward_cash_paid,
        "row_kind": row_kind,
    }


def _in_date_range(at: Any, date_from: Optional[datetime], date_to: Optional[datetime]) -> bool:
    if not date_from and not date_to:
        return True
    parsed = _parse_date(_coerce_at(at))
    if not parsed:
        return not date_from and not date_to
    if date_from and parsed < _day_start(date_from):
        return False
    if date_to and parsed > _day_end(date_to):
        return False
    return True


def _matches_filters(
    row: dict,
    *,
    source: Optional[str],
    item_type: Optional[str],
    payment_status: Optional[str],
    search: Optional[str],
) -> bool:
    if source and source != "all" and row.get("source") != source:
        return False
    if item_type and item_type != "all" and row.get("item_type") != item_type:
        return False
    if payment_status and payment_status != "all" and row.get("payment_status") != payment_status:
        return False
    if search:
        q = search.strip().lower()
        if not q:
            return True
        hay = " ".join([
            row.get("item_name") or "",
            row.get("reference_number") or "",
            row.get("notes") or "",
            row.get("staff_name") or "",
        ]).lower()
        if q not in hay:
            return False
    return True


def _build_summary(rows: List[dict], invoices: List[dict], pos_sales: List[dict], prepaid_docs: List[dict]) -> dict:
    total_invoice_paid = sum(_int(i.get("amount_paid")) for i in invoices if (i.get("payment_status") or "").lower() in ("paid", "partial"))
    outstanding_balance = sum(max(0, _int(i.get("remaining_balance"))) for i in invoices if (i.get("payment_status") or "").lower() not in ("void", "cancelled"))
    total_pos_paid = sum(_int(s.get("amount_paid")) for s in pos_sales if (s.get("status") or "").lower() == "paid")

    total_prepaid_purchased = sum(_int(p.get("original_amount_idr")) for p in prepaid_docs if (p.get("status") or "").lower() not in ("voided",))
    total_prepaid_remaining = sum(_int(p.get("remaining_balance_idr")) for p in prepaid_docs if (p.get("status") or "").lower() not in ("voided", "refunded", "used"))

    total_prepaid_redeemed = sum(
        _int(r.get("line_total_idr"))
        for r in rows
        if r.get("row_kind") == "prepaid_redemption"
    )
    total_package_purchases = sum(
        _int(r.get("line_total_idr"))
        for r in rows
        if r.get("item_type") == "package" and r.get("row_kind") == "purchase"
    )
    total_product_purchases = sum(
        _int(r.get("line_total_idr"))
        for r in rows
        if r.get("item_type") == "product" and r.get("row_kind") == "purchase"
    )

    paid_dates = []
    for i in invoices:
        if i.get("paid_at"):
            paid_dates.append(_coerce_at(i.get("paid_at")))
    for s in pos_sales:
        if s.get("paid_at"):
            paid_dates.append(_coerce_at(s.get("paid_at")))
    last_payment_date = max(paid_dates) if paid_dates else ""

    total_cash_paid = total_invoice_paid + total_pos_paid
    lifetime_spend = total_cash_paid + total_prepaid_purchased

    return {
        "lifetime_spend_idr": lifetime_spend,
        "total_cash_paid_idr": total_cash_paid,
        "total_invoice_paid_idr": total_invoice_paid,
        "total_pos_paid_idr": total_pos_paid,
        "outstanding_balance_idr": outstanding_balance,
        "total_prepaid_purchased_idr": total_prepaid_purchased,
        "total_prepaid_remaining_idr": total_prepaid_remaining,
        "total_prepaid_redeemed_idr": total_prepaid_redeemed,
        "total_package_purchases_idr": total_package_purchases,
        "total_product_purchases_idr": total_product_purchases,
        "last_payment_date": last_payment_date,
    }


async def build_patient_spending_history(
    db,
    clinic_id: str,
    patient_id: str,
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = None,
    item_type: Optional[str] = None,
    payment_status: Optional[str] = None,
    search: Optional[str] = None,
    include_billing: bool = True,
    include_pos: bool = True,
    include_prepaid: bool = True,
    include_packages: bool = True,
    include_gift_cards: bool = True,
) -> dict:
    parsed_from = _parse_date(date_from)
    parsed_to = _parse_date(date_to)

    staff_map: Dict[str, str] = {}
    async for u in db.users.find({"clinic_id": clinic_id}, {"_id": 0, "id": 1, "name": 1}):
        if u.get("id"):
            staff_map[u["id"]] = u.get("name") or ""

    visit_dates: Dict[str, str] = {}
    async for v in db.visits.find(
        {"clinic_id": clinic_id, "patient_id": patient_id},
        {"_id": 0, "id": 1, "visit_date": 1},
    ):
        if v.get("id"):
            visit_dates[v["id"]] = _coerce_at(v.get("visit_date"))

    rows: List[dict] = []
    seen_prepaid_purchase: Set[str] = set()
    seen_gift_card_purchase: Set[str] = set()

    invoices: List[dict] = []
    pos_sales: List[dict] = []
    prepaid_docs: List[dict] = []

    if include_billing:
        async for inv in db.invoices.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0},
        ).sort("created_at", -1):
            invoices.append(inv)
            inv_at = inv.get("paid_at") or inv.get("created_at")
            if not _in_date_range(inv_at, parsed_from, parsed_to):
                continue
            inv_status = (inv.get("payment_status") or "unpaid").lower()
            inv_ref = inv.get("invoice_number") or inv.get("id", "")[:8]
            visit_id = inv.get("visit_id") or ""
            session_date = visit_dates.get(visit_id, "")
            disc_label = _discount_label(inv)
            pay_method = inv.get("payment_method") or ""
            if inv.get("payments"):
                methods = list({(p.get("payment_method") or "").strip() for p in inv["payments"] if p.get("payment_method")})
                if methods:
                    pay_method = ", ".join(methods)

            for idx, item in enumerate(inv.get("items") or []):
                itype = (item.get("item_type") or "custom").lower()
                if item.get("package_usage_id") or item.get("paid_by") == "package":
                    row_kind = "package_usage"
                    pstatus = "usage"
                else:
                    row_kind = "purchase"
                    pstatus = inv_status
                line_total = _invoice_line_total(item)
                counts_cash = row_kind == "purchase" and inv_status in ("paid", "partial") and line_total > 0
                rows.append(_row(
                    row_id=f"inv:{inv.get('id')}:{item.get('id') or idx}",
                    at=inv_at,
                    source="invoice",
                    reference_number=inv_ref,
                    item_type=itype,
                    item_name=item.get("name") or item.get("name_snapshot") or "Line item",
                    session_date=session_date,
                    quantity=_float(item.get("quantity") or 1, 1.0),
                    unit_price_idr=_int(item.get("unit_price_idr") or item.get("unit_price")),
                    discount_idr=_int(item.get("discount_idr")),
                    discount_label=disc_label,
                    line_total_idr=line_total,
                    payment_method=pay_method,
                    payment_status=pstatus,
                    staff_name=_performer_name(item, staff_map),
                    notes=inv.get("notes") or "",
                    reference_id=inv.get("id") or "",
                    counts_toward_cash_paid=counts_cash,
                    row_kind=row_kind,
                ))

    if include_pos:
        async for sale in db.pos_sales.find(
            {"clinic_id": clinic_id, "patient_id": patient_id, "status": {"$in": ["paid", "completed"]}},
            {"_id": 0},
        ).sort("paid_at", -1):
            pos_sales.append(sale)
            sale_at = sale.get("paid_at") or sale.get("created_at")
            if not _in_date_range(sale_at, parsed_from, parsed_to):
                continue
            sale_ref = sale.get("sale_number") or sale.get("id", "")[:8]
            disc_label = _discount_label(sale)
            pay_method = sale.get("payment_method") or ""

            for idx, item in enumerate(sale.get("items") or []):
                itype = (item.get("item_type") or "product").lower()
                if itype == "prepaid" and item.get("prepaid_id"):
                    seen_prepaid_purchase.add(str(item.get("prepaid_id")))
                if itype == "gift_card" and item.get("gift_card_id"):
                    seen_gift_card_purchase.add(str(item.get("gift_card_id")))
                source_key = "prepaid" if itype == "prepaid" else ("gift_card" if itype == "gift_card" else "pos")
                rows.append(_row(
                    row_id=f"pos:{sale.get('id')}:{item.get('id') or idx}",
                    at=sale_at,
                    source=source_key if itype in ("prepaid", "gift_card") else "pos",
                    reference_number=sale_ref,
                    item_type=itype,
                    item_name=item.get("name_snapshot") or item.get("name") or "POS item",
                    session_date="",
                    quantity=_float(item.get("qty") or 1, 1.0),
                    unit_price_idr=_int(item.get("unit_price")),
                    discount_idr=_int(item.get("discount")),
                    discount_label=disc_label,
                    line_total_idr=_pos_line_total(item),
                    payment_method=pay_method,
                    payment_status="paid",
                    staff_name="",
                    notes=sale.get("notes") or "",
                    reference_id=sale.get("id") or "",
                    counts_toward_cash_paid=True,
                    row_kind="prepaid_purchase" if itype == "prepaid" else "purchase",
                ))

    if include_prepaid:
        async for pp in db.patient_prepaid.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0},
        ).sort("purchased_at", -1):
            prepaid_docs.append(pp)
            pp_id = str(pp.get("id") or "")
            if pp_id in seen_prepaid_purchase:
                continue
            at = pp.get("purchased_at") or pp.get("created_at")
            if not _in_date_range(at, parsed_from, parsed_to):
                continue
            status = (pp.get("status") or "active").lower()
            rows.append(_row(
                row_id=f"prepaid:{pp_id}",
                at=at,
                source="prepaid",
                reference_number=pp.get("code") or pp_id[:8],
                item_type="prepaid",
                item_name=pp.get("treatment_name_snapshot") or pp.get("prepaid_type_label") or "Prepaid purchase",
                session_date="",
                quantity=1,
                unit_price_idr=_int(pp.get("original_amount_idr")),
                discount_idr=0,
                discount_label=pp.get("campaign_name_snapshot") or "",
                line_total_idr=_int(pp.get("original_amount_idr")),
                payment_method="",
                payment_status=status,
                staff_name=pp.get("created_by_name_snapshot") or "",
                notes="Prepaid purchase",
                reference_id=pp_id,
                counts_toward_cash_paid=False,
                row_kind="prepaid_purchase",
            ))

        async for red in db.prepaid_redemptions.find(
            {"clinic_id": clinic_id, "patient_id": patient_id, "reversed": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1):
            at = red.get("created_at")
            if not _in_date_range(at, parsed_from, parsed_to):
                continue
            ref_type = (red.get("reference_type") or "").lower()
            ref_id = red.get("reference_id") or ""
            ref_num = ref_id[:8]
            if ref_type == "invoice":
                inv = next((i for i in invoices if i.get("id") == ref_id), None)
                if inv:
                    ref_num = inv.get("invoice_number") or ref_num
            elif ref_type == "pos_sale":
                sale = next((s for s in pos_sales if s.get("id") == ref_id), None)
                if sale:
                    ref_num = sale.get("sale_number") or ref_num
            rows.append(_row(
                row_id=f"prepaid-red:{red.get('id') or uuid.uuid4()}",
                at=at,
                source="prepaid",
                reference_number=red.get("prepaid_code") or ref_num,
                item_type="prepaid",
                item_name="Prepaid redeemed",
                session_date="",
                quantity=1,
                unit_price_idr=_int(red.get("amount_redeemed_idr")),
                discount_idr=0,
                discount_label="",
                line_total_idr=_int(red.get("amount_redeemed_idr")),
                payment_method="prepaid",
                payment_status="redeemed",
                staff_name="",
                notes=f"Applied to {ref_type} {ref_num}".strip(),
                reference_id=ref_id,
                counts_toward_cash_paid=False,
                row_kind="prepaid_redemption",
            ))

    if include_packages:
        async for usage in db.package_usage.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0},
        ).sort("usage_date", -1):
            at = usage.get("usage_date") or usage.get("created_at")
            if not _in_date_range(at, parsed_from, parsed_to):
                continue
            if any(r.get("id") == f"pkg-usage:{usage.get('id')}" for r in rows):
                continue
            rows.append(_row(
                row_id=f"pkg-usage:{usage.get('id')}",
                at=at,
                source="package",
                reference_number=usage.get("patient_package_id", "")[:8],
                item_type="package",
                item_name=usage.get("treatment_name_snapshot") or "Package session used",
                session_date=_coerce_at(usage.get("usage_date")),
                quantity=_float(usage.get("used_sessions_count") or 1, 1.0),
                unit_price_idr=_int(usage.get("treatment_value_snapshot")),
                discount_idr=0,
                discount_label="",
                line_total_idr=_int(usage.get("treatment_value_snapshot")),
                payment_method="package",
                payment_status="usage",
                staff_name=usage.get("performer_name_snapshot") or "",
                notes=usage.get("notes") or "Package redemption",
                reference_id=usage.get("id") or "",
                counts_toward_cash_paid=False,
                row_kind="package_usage",
            ))

        async for pkg in db.patient_packages.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0},
        ).sort("created_at", -1):
            if pkg.get("invoice_id") or pkg.get("pos_sale_id"):
                continue
            at = pkg.get("start_date") or pkg.get("created_at")
            if not _in_date_range(at, parsed_from, parsed_to):
                continue
            rows.append(_row(
                row_id=f"pkg-buy:{pkg.get('id')}",
                at=at,
                source="package",
                reference_number=pkg.get("id", "")[:8],
                item_type="package",
                item_name=pkg.get("package_name_snapshot") or "Package purchase",
                session_date="",
                quantity=1,
                unit_price_idr=_int(pkg.get("purchase_price_snapshot")),
                discount_idr=0,
                discount_label="",
                line_total_idr=_int(pkg.get("purchase_price_snapshot")),
                payment_method="",
                payment_status=(pkg.get("status") or "active").lower(),
                staff_name="",
                notes="Package purchase",
                reference_id=pkg.get("id") or "",
                counts_toward_cash_paid=True,
                row_kind="purchase",
            ))

    if include_gift_cards:
        async for gc in db.gift_cards.find(
            {
                "clinic_id": clinic_id,
                "$or": [
                    {"purchaser_patient_id": patient_id},
                    {"recipient_patient_id": patient_id},
                ],
            },
            {"_id": 0},
        ).sort("issued_at", -1):
            gc_id = str(gc.get("id") or "")
            if gc.get("purchaser_patient_id") == patient_id and gc_id not in seen_gift_card_purchase:
                at = gc.get("issued_at") or gc.get("created_at")
                if _in_date_range(at, parsed_from, parsed_to):
                    rows.append(_row(
                        row_id=f"gc-buy:{gc_id}",
                        at=at,
                        source="gift_card",
                        reference_number=gc.get("code") or gc_id[:8],
                        item_type="gift_card",
                        item_name=gc.get("gift_card_type_label") or "Gift card purchase",
                        session_date="",
                        quantity=1,
                        unit_price_idr=_int(gc.get("original_value")),
                        discount_idr=0,
                        discount_label="",
                        line_total_idr=_int(gc.get("original_value")),
                        payment_method="",
                        payment_status=(gc.get("status") or "active").lower(),
                        staff_name=gc.get("purchaser_name") or "",
                        notes="Gift card purchase",
                        reference_id=gc_id,
                        counts_toward_cash_paid=True,
                        row_kind="purchase",
                    ))

        async for gr in db.gift_card_redemptions.find(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0},
        ).sort("created_at", -1):
            at = gr.get("created_at")
            if not _in_date_range(at, parsed_from, parsed_to):
                continue
            rows.append(_row(
                row_id=f"gc-red:{gr.get('id') or uuid.uuid4()}",
                at=at,
                source="gift_card",
                reference_number=gr.get("gift_card_code") or "",
                item_type="gift_card",
                item_name="Gift card redeemed",
                session_date="",
                quantity=1,
                unit_price_idr=_int(gr.get("amount_redeemed")),
                discount_idr=0,
                discount_label="",
                line_total_idr=_int(gr.get("amount_redeemed")),
                payment_method="gift_card",
                payment_status="redeemed",
                staff_name="",
                notes=f"Applied to {(gr.get('reference_type') or '')} {(gr.get('reference_id') or '')[:8]}".strip(),
                reference_id=gr.get("reference_id") or "",
                counts_toward_cash_paid=False,
                row_kind="gift_card_redemption",
            ))

    rows.sort(key=lambda r: r.get("date") or "", reverse=True)
    filtered = [
        r for r in rows
        if _matches_filters(r, source=source, item_type=item_type, payment_status=payment_status, search=search)
    ]

    summary = _build_summary(filtered, invoices, pos_sales, prepaid_docs)

    return {
        "summary": summary,
        "rows": filtered,
        "filters": {
            "date_from": date_from or "",
            "date_to": date_to or "",
            "source": source or "all",
            "item_type": item_type or "all",
            "payment_status": payment_status or "all",
            "search": search or "",
        },
    }


def _fmt_idr(val: int) -> str:
    return f"Rp {int(val or 0):,}".replace(",", ".")


def build_spending_history_xlsx(
    *,
    clinic_name: str,
    patient: dict,
    data: dict,
    date_from: str,
    date_to: str,
) -> bytes:
    from report_excel import build_report_workbook

    summary = data.get("summary") or {}
    rows = data.get("rows") or []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    summary_rows = [
        ("Lifetime spend", _fmt_idr(summary.get("lifetime_spend_idr"))),
        ("Total cash paid", _fmt_idr(summary.get("total_cash_paid_idr"))),
        ("Total invoice paid", _fmt_idr(summary.get("total_invoice_paid_idr"))),
        ("Outstanding balance", _fmt_idr(summary.get("outstanding_balance_idr"))),
        ("Prepaid purchased", _fmt_idr(summary.get("total_prepaid_purchased_idr"))),
        ("Prepaid remaining", _fmt_idr(summary.get("total_prepaid_remaining_idr"))),
        ("Prepaid redeemed", _fmt_idr(summary.get("total_prepaid_redeemed_idr"))),
        ("Package purchases", _fmt_idr(summary.get("total_package_purchases_idr"))),
        ("Product purchases", _fmt_idr(summary.get("total_product_purchases_idr"))),
        ("Last payment date", summary.get("last_payment_date") or "—"),
    ]

    detail_headers = [
        "Date", "Source", "Reference", "Item type", "Item name", "Session date",
        "Quantity", "Unit price", "Discount", "Total", "Payment method", "Payment status",
        "Staff/performer", "Notes",
    ]
    detail_rows = []
    for r in rows:
        detail_rows.append([
            r.get("date") or "",
            r.get("source_label") or r.get("source") or "",
            r.get("reference_number") or "",
            r.get("item_type_label") or r.get("item_type") or "",
            r.get("item_name") or "",
            r.get("session_date") or "",
            r.get("quantity") or 0,
            _int(r.get("unit_price_idr")),
            r.get("discount_label") or _int(r.get("discount_idr")),
            _int(r.get("line_total_idr")),
            r.get("payment_method") or "",
            r.get("payment_status") or "",
            r.get("staff_name") or "",
            r.get("notes") or "",
        ])

    wb = build_report_workbook(
        title=f"{clinic_name} — Patient Spending History",
        range_info={"from": date_from or "All", "to": date_to or "All", "preset": "custom"},
        filters={
            "clinic": clinic_name,
            "patient": patient.get("full_name") or "",
            "phone": patient.get("phone") or "",
            "email": patient.get("email") or "",
            "export_date": today,
        },
        summary_rows=summary_rows,
        detail_sheets=[{"name": "Transactions", "title": "Spending history", "headers": detail_headers, "rows": detail_rows}],
    )

    # Patch Info sheet with clinic + patient meta (re-open not needed — prepend via rebuild)
    # build_report_workbook already has Info sheet; we pass patient in filters.
    return wb


def register_patient_spending_history(
    api: APIRouter,
    db,
    get_current_user,
    scope,
    assert_patient_access,
    audit,
):
    def _can_view(user: dict) -> bool:
        return user_has_permission(user, "patient_spending.view") or user_has_permission(user, "billing.view")

    def _can_export(user: dict) -> bool:
        return user_has_permission(user, "patient_spending.export")

    async def _load_patient(user: dict, pid: str) -> dict:
        p = await db.patients.find_one(scope(user, {"id": pid}), {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        await assert_patient_access(db, user, pid)
        return p

    async def _history_payload(
        user: dict,
        pid: str,
        *,
        date_from: Optional[str],
        date_to: Optional[str],
        source: Optional[str],
        item_type: Optional[str],
        payment_status: Optional[str],
        search: Optional[str],
    ) -> dict:
        clinic_id = user["clinic_id"]
        include_billing = _can_view(user) and user_has_permission(user, "billing.view")
        include_pos = user_has_permission(user, "pos.view") or user_has_permission(user, "billing.view")
        include_prepaid = user_has_permission(user, "prepaid.view") or user_has_permission(user, "billing.view")
        include_packages = user_has_permission(user, "packages.view") or user_has_permission(user, "billing.view")
        include_gift_cards = user_has_permission(user, "gift_cards.view") or user_has_permission(user, "billing.view")

        if source and source not in SOURCE_VALUES and source != "all":
            raise HTTPException(status_code=400, detail="Invalid source filter")
        if item_type and item_type not in ITEM_TYPE_VALUES and item_type != "all":
            raise HTTPException(status_code=400, detail="Invalid item_type filter")
        if payment_status and payment_status not in PAYMENT_STATUS_VALUES and payment_status != "all":
            raise HTTPException(status_code=400, detail="Invalid payment_status filter")

        return await build_patient_spending_history(
            db,
            clinic_id,
            pid,
            date_from=date_from,
            date_to=date_to,
            source=source,
            payment_status=payment_status,
            item_type=item_type,
            search=search,
            include_billing=include_billing,
            include_pos=include_pos,
            include_prepaid=include_prepaid,
            include_packages=include_packages,
            include_gift_cards=include_gift_cards,
        )

    @api.get("/patients/{pid}/spending-history")
    async def patient_spending_history(
        pid: str,
        user: dict = Depends(get_current_user),
        date_from: Optional[str] = Query(None, alias="date_from"),
        date_to: Optional[str] = Query(None, alias="date_to"),
        source: Optional[str] = Query("all"),
        item_type: Optional[str] = Query("all"),
        payment_status: Optional[str] = Query("all"),
        search: Optional[str] = Query(None),
    ):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="patient_spending.view permission required")
        await _load_patient(user, pid)
        return await _history_payload(
            user, pid,
            date_from=date_from, date_to=date_to,
            source=source, item_type=item_type, payment_status=payment_status, search=search,
        )

    @api.get("/patients/{pid}/spending-history/export")
    async def patient_spending_history_export(
        pid: str,
        user: dict = Depends(get_current_user),
        date_from: Optional[str] = Query(None, alias="date_from"),
        date_to: Optional[str] = Query(None, alias="date_to"),
        source: Optional[str] = Query("all"),
        item_type: Optional[str] = Query("all"),
        payment_status: Optional[str] = Query("all"),
        search: Optional[str] = Query(None),
    ):
        if not _can_export(user):
            raise HTTPException(status_code=403, detail="patient_spending.export permission required")
        patient = await _load_patient(user, pid)
        data = await _history_payload(
            user, pid,
            date_from=date_from, date_to=date_to,
            source=source, item_type=item_type, payment_status=payment_status, search=search,
        )
        clinic = await db.clinics.find_one({"id": user["clinic_id"]}, {"_id": 0, "name": 1})
        clinic_name = (clinic or {}).get("name") or "Clinic"
        content = build_spending_history_xlsx(
            clinic_name=clinic_name,
            patient=patient,
            data=data,
            date_from=date_from or "All",
            date_to=date_to or "All",
        )
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        filename = f"patient-spending-history-{_slug_name(patient.get('full_name') or 'patient')}-{today}.xlsx"
        await audit(
            user,
            "export",
            "patient_spending_history",
            pid,
            {
                "patient_id": pid,
                "date_from": date_from,
                "date_to": date_to,
                "source": source,
                "item_type": item_type,
                "payment_status": payment_status,
                "search": search,
            },
        )
        from report_excel import xlsx_response
        return xlsx_response(filename, content)
