"""Query builders for gift card list API."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from gift_card_models import REDEEMABLE_STATUSES

TAB_STATUSES = {
    "active": list(REDEEMABLE_STATUSES) + ["reserved"],
    "redeemed": ["redeemed"],
    "expired": ["expired"],
    "cancelled": ["cancelled"],
    "all": None,
}


def build_gift_card_list_filter(
    clinic_id: str,
    *,
    tab: Optional[str] = None,
    status: Optional[str] = None,
    gift_card_type: Optional[str] = None,
    q: Optional[str] = None,
    recipient_name: Optional[str] = None,
    recipient_phone: Optional[str] = None,
    purchaser_name: Optional[str] = None,
    purchaser_phone: Optional[str] = None,
    issued_from: Optional[str] = None,
    issued_to: Optional[str] = None,
    expiry_from: Optional[str] = None,
    expiry_to: Optional[str] = None,
) -> Dict[str, Any]:
    flt: Dict[str, Any] = {"clinic_id": clinic_id}

    tab_key = (tab or "all").strip().lower()
    if status and status.strip():
        flt["status"] = status.strip().lower()
    elif tab_key in TAB_STATUSES and TAB_STATUSES[tab_key]:
        flt["status"] = {"$in": TAB_STATUSES[tab_key]}

    if gift_card_type and gift_card_type.strip():
        flt["gift_card_type"] = gift_card_type.strip().lower()

    if issued_from or issued_to:
        issued: Dict[str, Any] = {}
        if issued_from:
            issued["$gte"] = f"{issued_from[:10]}T00:00:00"
        if issued_to:
            issued["$lte"] = f"{issued_to[:10]}T23:59:59"
        flt["issued_at"] = issued

    if expiry_from or expiry_to:
        expiry: Dict[str, Any] = {}
        if expiry_from:
            expiry["$gte"] = expiry_from[:10]
        if expiry_to:
            expiry["$lte"] = expiry_to[:10]
        flt["expiry_date"] = expiry

    or_clauses: List[Dict[str, Any]] = []
    if q and q.strip():
        rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
        or_clauses.append({
            "$or": [
                {"code": rx},
                {"recipient_name": rx},
                {"recipient_phone": rx},
                {"purchaser_name": rx},
                {"customer_name_snapshot": rx},
            ]
        })
    if recipient_name and recipient_name.strip():
        or_clauses.append({"recipient_name": re.compile(re.escape(recipient_name.strip()), re.IGNORECASE)})
    if recipient_phone and recipient_phone.strip():
        or_clauses.append({"recipient_phone": re.compile(re.escape(recipient_phone.strip()), re.IGNORECASE)})
    if purchaser_name and purchaser_name.strip():
        or_clauses.append({
            "$or": [
                {"purchaser_name": re.compile(re.escape(purchaser_name.strip()), re.IGNORECASE)},
                {"customer_name_snapshot": re.compile(re.escape(purchaser_name.strip()), re.IGNORECASE)},
            ]
        })
    if purchaser_phone and purchaser_phone.strip():
        or_clauses.append({"purchaser_phone": re.compile(re.escape(purchaser_phone.strip()), re.IGNORECASE)})

    if len(or_clauses) == 1:
        flt.update(or_clauses[0])
    elif len(or_clauses) > 1:
        flt["$and"] = or_clauses

    return flt
