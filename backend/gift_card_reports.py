"""Gift card reporting — issuance, balances, redemptions."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional

from gift_card_models import (
    GIFT_CARD_STATUSES,
    effective_gift_card_status,
    gift_card_to_api,
    normalize_gift_card_document,
    normalize_redemption_document,
    redemption_to_api,
)
from gift_cards_core import aggregate_outstanding_summary


async def aggregate_gift_card_report(
    db,
    clinic_id: str,
    start_iso: str,
    end_iso: str,
) -> dict:
    """Gift card report for a date range (issued_at / redemption created_at)."""
    cards_raw = await db.gift_cards.find(
        {"clinic_id": clinic_id, "gift_card_type": "value_credit"},
        {"_id": 0},
    ).to_list(20000)

    status_counts: Dict[str, int] = {s: 0 for s in sorted(GIFT_CARD_STATUSES)}
    issued_in_range = 0
    issued_value_in_range = 0

    for raw in cards_raw:
        card = normalize_gift_card_document(raw)
        eff = effective_gift_card_status(card)
        if eff in status_counts:
            status_counts[eff] += 1
        else:
            status_counts[eff] = status_counts.get(eff, 0) + 1
        issued_at = card.get("issued_at") or card.get("created_at") or ""
        if issued_at and start_iso <= issued_at <= end_iso:
            issued_in_range += 1
            issued_value_in_range += int(card.get("original_value") or 0)

    redemptions_raw = await db.gift_card_redemptions.find(
        {
            "clinic_id": clinic_id,
            "created_at": {"$gte": start_iso, "$lte": end_iso},
            "reversed": {"$ne": True},
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(10000)

    redemption_total = 0
    redemption_rows: List[dict] = []
    for raw in redemptions_raw:
        row = normalize_redemption_document(raw)
        amt = int(row.get("amount_redeemed") or 0)
        redemption_total += amt
        api = redemption_to_api(row)
        redemption_rows.append({
            "id": api.get("id"),
            "created_at": api.get("created_at"),
            "gift_card_code": api.get("gift_card_code"),
            "amount_redeemed": amt,
            "balance_after": api.get("balance_after"),
            "reference_type": api.get("reference_type"),
            "reference_id": api.get("reference_id"),
            "patient_id": api.get("patient_id"),
            "redeemed_by_name_snapshot": api.get("redeemed_by_name_snapshot"),
        })

    outstanding = await aggregate_outstanding_summary(db, clinic_id)

    return {
        "summary": {
            "issued_in_range_count": issued_in_range,
            "issued_in_range_value_idr": issued_value_in_range,
            "redemptions_in_range_idr": redemption_total,
            "redemptions_in_range_count": len(redemption_rows),
            "outstanding_balance_idr": outstanding.get("outstanding_balance_idr", 0),
            "active_cards_count": outstanding.get("active_cards_count", 0),
            "total_issued_cards": len(cards_raw),
        },
        "by_status": [
            {"status": k, "count": status_counts.get(k, 0)}
            for k in ("active", "partially_redeemed", "redeemed", "expired", "cancelled", "draft")
        ],
        "redemptions": redemption_rows,
        "outstanding": outstanding,
    }
