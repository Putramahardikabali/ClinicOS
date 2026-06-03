"""Quantity resolution for visit treatment items and invoice line items."""
from __future__ import annotations

from typing import Any, Dict, Optional

TREATMENT_QTY_KEYS = (
    "quantity",
    "qty",
    "units",
    "amount",
    "session_count",
    "treatment_quantity",
)

INVOICE_QTY_KEYS = TREATMENT_QTY_KEYS


def _positive_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    return num


def treatment_item_quantity(item: dict) -> float:
    """Read quantity from a visit treatment_items document."""
    for key in TREATMENT_QTY_KEYS:
        q = _positive_float(item.get(key))
        if q is not None:
            return q
    return 1.0


def _line_unit_price_idr(raw: dict) -> float:
    """Unit price on invoice lines (supports legacy keys)."""
    for key in ("unit_price_idr", "unit_price", "price_idr", "price"):
        val = raw.get(key)
        if val is not None and val != "":
            try:
                p = float(val)
                if p >= 0:
                    return p
            except (TypeError, ValueError):
                continue
    return 0.0


def resolve_invoice_line_quantity(raw: dict, *, allow_infer: bool = True) -> float:
    """Resolve quantity for an invoice line from explicit fields or billing totals."""
    for key in INVOICE_QTY_KEYS:
        q = _positive_float(raw.get(key))
        if q is not None:
            return q
    if not allow_infer:
        return 1.0
    unit = _line_unit_price_idr(raw)
    if unit <= 0:
        return 1.0
    for total_key in ("original_treatment_value", "amount_charged", "line_total_idr"):
        total = raw.get(total_key)
        if total is None:
            continue
        try:
            t = float(total)
        except (TypeError, ValueError):
            continue
        if t > 0:
            inferred = t / unit
            if inferred > 0:
                return inferred
    return 1.0


def line_gross_idr(unit_price_idr: int, quantity: float) -> int:
    return int(round(max(0, int(unit_price_idr or 0)) * quantity))


def coerce_invoice_items_for_api(items: list) -> list:
    """Ensure every line item exposes a numeric quantity for API consumers."""
    out = []
    for it in items or []:
        row = dict(it)
        row["quantity"] = resolve_invoice_line_quantity(row)
        out.append(row)
    return out


def invoice_items_need_quantity_persist(items: list) -> bool:
    """True when stored items are missing a valid quantity field."""
    for it in items or []:
        if _positive_float(it.get("quantity")) is None:
            return True
    return False
