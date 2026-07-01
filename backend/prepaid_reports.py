"""Prepaid reporting — sales (liability), redemptions (revenue), outstanding balances."""
from __future__ import annotations

from typing import Dict, List

from prepaid_core import aggregate_outstanding_prepaid_liability
from prepaid_models import PREPAID_STATUSES, effective_prepaid_status, prepaid_to_api


async def aggregate_prepaid_report(
    db,
    clinic_id: str,
    start_iso: str,
    end_iso: str,
) -> dict:
    cards_raw = await db.patient_prepaid.find({"clinic_id": clinic_id}, {"_id": 0}).to_list(20000)

    status_counts: Dict[str, int] = {s: 0 for s in sorted(PREPAID_STATUSES)}
    sold_in_range = 0
    sold_value_in_range = 0
    expiring_soon: List[dict] = []

    for raw in cards_raw:
        card = prepaid_to_api(raw)
        eff = effective_prepaid_status(card)
        status_counts[eff] = status_counts.get(eff, 0) + 1
        purchased_at = card.get("purchased_at") or card.get("created_at") or ""
        if purchased_at and start_iso <= purchased_at <= end_iso and eff != "voided":
            sold_in_range += 1
            sold_value_in_range += int(card.get("original_amount_idr") or 0)
        expiry = (card.get("expiry_date") or "").strip()
        if expiry and eff in ("active", "partially_used"):
            expiring_soon.append({
                "id": card.get("id"),
                "code": card.get("code"),
                "patient_id": card.get("patient_id"),
                "expiry_date": expiry,
                "remaining_balance_idr": card.get("remaining_balance_idr"),
            })

    redemptions_raw = await db.prepaid_redemptions.find(
        {
            "clinic_id": clinic_id,
            "created_at": {"$gte": start_iso, "$lte": end_iso},
            "reversed": {"$ne": True},
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(10000)

    redemption_total = 0
    redemption_rows: List[dict] = []
    for row in redemptions_raw:
        amt = int(row.get("amount_redeemed_idr") or 0)
        redemption_total += amt
        redemption_rows.append({
            "id": row.get("id"),
            "created_at": row.get("created_at"),
            "prepaid_code": row.get("prepaid_code"),
            "amount_redeemed_idr": amt,
            "balance_after_idr": row.get("balance_after_idr"),
            "recognized_revenue_idr": row.get("recognized_revenue_idr"),
            "reference_type": row.get("reference_type"),
            "reference_id": row.get("reference_id"),
            "patient_id": row.get("patient_id"),
            "created_by_name_snapshot": row.get("created_by_name_snapshot"),
        })

    outstanding = await aggregate_outstanding_prepaid_liability(db, clinic_id)
    expiring_soon.sort(key=lambda r: r.get("expiry_date") or "")

    return {
        "summary": {
            "prepaid_sold_in_range_count": sold_in_range,
            "prepaid_sold_in_range_idr": sold_value_in_range,
            "prepaid_liability_added_idr": sold_value_in_range,
            "prepaid_redeemed_in_range_idr": redemption_total,
            "prepaid_liability_used_idr": redemption_total,
            "prepaid_redeemed_in_range_count": len(redemption_rows),
            "outstanding_balance_idr": outstanding.get("outstanding_balance_idr", 0),
            "active_prepaid_count": outstanding.get("active_count", 0),
            "total_prepaid_records": len(cards_raw),
            "expiring_count": len(expiring_soon),
        },
        "by_status": [{"status": k, "count": status_counts.get(k, 0)} for k in sorted(PREPAID_STATUSES)],
        "redemptions": redemption_rows,
        "expiring": expiring_soon[:200],
        "outstanding": outstanding,
    }
