"""Gift card entitlement matching and line amount helpers (treatment / package)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _line_item_type(item: dict) -> str:
    t = (item.get("item_type") or "custom").strip().lower()
    if t == "service":
        return "treatment"
    return t


def _line_catalog_id(item: dict) -> Optional[str]:
    itype = _line_item_type(item)
    if itype == "treatment":
        return item.get("treatment_catalog_id") or item.get("catalog_id")
    if itype == "package":
        return item.get("package_catalog_id") or item.get("catalog_id")
    return item.get("catalog_id")


def line_payable_amount(item: dict) -> int:
    """Payable IDR for a POS or invoice line."""
    for key in ("total", "line_total_idr", "amount_charged"):
        if item.get(key) is not None:
            return max(0, int(item.get(key) or 0))
    qty = float(item.get("qty") or item.get("quantity") or 1)
    unit = int(item.get("unit_price") or item.get("unit_price_idr") or 0)
    disc = int(item.get("discount") or 0)
    return max(0, int(unit * qty) - disc)


def find_entitlement_match_line(card: dict, items: Optional[List[dict]]) -> Optional[dict]:
    """Find sale/invoice line matching a treatment or package gift card."""
    gc_type = (card.get("gift_card_type") or "").strip().lower()
    if gc_type == "treatment":
        tid = card.get("treatment_catalog_id")
        if not tid:
            return None
        for it in items or []:
            if _line_item_type(it) != "treatment":
                continue
            cid = _line_catalog_id(it)
            if cid == tid:
                return it
    elif gc_type == "package":
        pid = card.get("package_catalog_id")
        if not pid:
            return None
        for it in items or []:
            if _line_item_type(it) != "package":
                continue
            cid = _line_catalog_id(it)
            if cid == pid:
                return it
    return None
