"""Campaign / promotion validation and discount calculation for invoices."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from saas import iso, now_utc

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DEFAULT_CLINIC_TZ = "Asia/Makassar"
_TZ_OFFSETS = {
    "Asia/Makassar": timedelta(hours=8),
    "Asia/Jakarta": timedelta(hours=7),
    "Asia/Jayapura": timedelta(hours=9),
}


def normalize_campaign_code(code: str) -> str:
    return re.sub(r"\s+", "", (code or "").strip().upper())


def _resolve_tz(tz_name: str):
    try:
        if ZoneInfo:
            return ZoneInfo(tz_name)
    except Exception:
        pass
    return timezone(_TZ_OFFSETS.get(tz_name, timedelta(hours=8)))


def clinic_local_now(clinic: dict, now: Optional[datetime] = None) -> datetime:
    tz_name = clinic.get("timezone") or DEFAULT_CLINIC_TZ
    base = now if now is not None else datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base.astimezone(_resolve_tz(tz_name))


def clinic_today_str(clinic: dict, now: Optional[datetime] = None) -> str:
    return clinic_local_now(clinic, now).strftime("%Y-%m-%d")


def compute_campaign_discount(
    subtotal_idr: int,
    discount_type: str,
    discount_value: int,
    max_discount_idr: Optional[int] = None,
) -> int:
    subtotal_idr = max(0, int(subtotal_idr or 0))
    if subtotal_idr <= 0:
        return 0
    dtype = (discount_type or "fixed").lower()
    if dtype in ("percent", "percentage"):
        val = min(max(0, int(discount_value or 0)), 100)
        discount = int(subtotal_idr * val / 100)
        if max_discount_idr is not None and max_discount_idr > 0:
            discount = min(discount, int(max_discount_idr))
    else:
        discount = min(max(0, int(discount_value or 0)), subtotal_idr)
    return max(0, discount)


def campaign_status(campaign: dict, clinic: dict, ref_date: Optional[str] = None, now: Optional[datetime] = None) -> str:
    if not campaign.get("active", True):
        return "inactive"
    today = ref_date or clinic_today_str(clinic, now)
    start = (campaign.get("start_date") or campaign.get("valid_from") or "")[:10] or None
    end = (campaign.get("end_date") or campaign.get("valid_until") or "")[:10] or None
    if start and today < start:
        return "scheduled"
    if end and today > end:
        return "expired"
    return "active"


def _date_in_range(campaign: dict, ref_date: str) -> bool:
    start = (campaign.get("start_date") or campaign.get("valid_from") or "")[:10] or None
    end = (campaign.get("end_date") or campaign.get("valid_until") or "")[:10] or None
    if start and ref_date < start:
        return False
    if end and ref_date > end:
        return False
    return True


def _invoice_line_matches_campaign(campaign: dict, item: dict) -> bool:
    applies_to = (campaign.get("applies_to") or "all").lower()
    if applies_to == "all":
        return True
    item_type = (item.get("item_type") or "").lower()
    catalog_id = item.get("catalog_id") or item.get("treatment_id") or item.get("package_id")
    category = (item.get("category") or item.get("treatment_category") or "").lower()
    if applies_to == "treatments":
        if item_type not in ("treatment", "custom"):
            return False
        ids = campaign.get("treatment_ids") or []
        return not ids or catalog_id in ids
    if applies_to == "categories":
        cats = [c.lower() for c in (campaign.get("category_keys") or [])]
        return bool(cats) and category in cats
    if applies_to == "packages":
        if item_type != "package":
            return False
        ids = campaign.get("package_ids") or []
        return not ids or catalog_id in ids
    return True


def eligible_subtotal_for_campaign(campaign: dict, items: List[dict]) -> int:
    total = 0
    for it in items or []:
        if it.get("paid_by") == "package":
            continue
        if not _invoice_line_matches_campaign(campaign, it):
            continue
        qty = float(it.get("quantity") or 1)
        price = int(it.get("unit_price_idr") or it.get("amount_charged") or 0)
        total += int(round(price * qty))
    return total


def validate_campaign_for_invoice(
    campaign: dict,
    *,
    clinic: dict,
    invoice_date: str,
    subtotal_idr: int,
    eligible_subtotal_idr: int,
    items: List[dict],
    patient_id: Optional[str] = None,
    patient_is_new: Optional[bool] = None,
    uses_for_patient: int = 0,
    has_package_payment: bool = False,
    has_gift_card_payment: bool = False,
    has_other_discount: bool = False,
    now: Optional[datetime] = None,
) -> Optional[str]:
    if not campaign:
        return "Campaign not found"
    status = campaign_status(campaign, clinic, invoice_date, now)
    if status != "active":
        return f"Campaign is {status}"
    if not _date_in_range(campaign, invoice_date):
        return "Campaign is not valid on this date"
    min_amt = int(campaign.get("min_invoice_amount_idr") or campaign.get("min_subtotal_idr") or 0)
    if min_amt > 0 and subtotal_idr < min_amt:
        return f"Minimum invoice amount is Rp {min_amt:,}".replace(",", ".")
    if eligible_subtotal_idr <= 0:
        return "Campaign does not apply to any items on this invoice"
    max_uses = campaign.get("max_uses_total")
    if max_uses is None:
        max_uses = campaign.get("max_uses")
    if max_uses is not None and int(campaign.get("uses_count") or 0) >= int(max_uses):
        return "Campaign usage limit reached"
    per_patient = campaign.get("max_uses_per_patient")
    if per_patient is not None and uses_for_patient >= int(per_patient):
        return "Campaign usage limit reached for this patient"
    if campaign.get("new_patients_only") and patient_is_new is False:
        return "Campaign is for new patients only"
    if campaign.get("returning_patients_only") and patient_is_new is True:
        return "Campaign is for returning patients only"
    if has_package_payment and not campaign.get("stackable_with_package", False):
        return "Campaign cannot be combined with package payment"
    if has_gift_card_payment and not campaign.get("stackable_with_gift_card", False):
        return "Campaign cannot be combined with gift card payment"
    if has_other_discount and not campaign.get("stackable_with_other_discounts", False):
        return "Campaign cannot be combined with other discounts"
    allowed_days = campaign.get("allowed_days_of_week") or []
    if allowed_days:
        try:
            dk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][
                datetime.fromisoformat(f"{invoice_date}T12:00:00").weekday()
            ]
            if dk not in [d.lower() for d in allowed_days]:
                return "Campaign is not valid on this day of week"
        except Exception:
            pass
    return None


def apply_campaign_to_invoice_subtotal(campaign: dict, eligible_subtotal_idr: int) -> Dict[str, int]:
    discount = compute_campaign_discount(
        eligible_subtotal_idr,
        campaign.get("discount_type", "percent"),
        int(campaign.get("discount_value") or 0),
        campaign.get("max_discount_idr"),
    )
    return {
        "eligible_subtotal_idr": int(eligible_subtotal_idr),
        "discount_amount_applied": discount,
    }


def campaign_discount_type_for_invoice(campaign: dict) -> Tuple[str, float]:
    dtype = (campaign.get("discount_type") or "percent").lower()
    if dtype in ("percent", "percentage"):
        return "percentage", float(campaign.get("discount_value") or 0)
    return "fixed", float(campaign.get("discount_value") or 0)


def build_campaign_doc(row: dict, clinic_id: str, user_id: str, existing: Optional[dict] = None) -> dict:
    code = normalize_campaign_code(row.get("code") or row.get("slug") or "")
    name = (row.get("name") or code or "Campaign").strip()
    doc = {
        "name": name,
        "code": code or None,
        "description": (row.get("description") or "").strip(),
        "active": bool(row.get("active", True)),
        "start_date": (row.get("start_date") or row.get("valid_from") or None),
        "end_date": (row.get("end_date") or row.get("valid_until") or None),
        "discount_type": row.get("discount_type") or "percent",
        "discount_value": int(row.get("discount_value") or 0),
        "max_discount_idr": int(row["max_discount_idr"]) if row.get("max_discount_idr") not in (None, "") else None,
        "min_invoice_amount_idr": int(row.get("min_invoice_amount_idr") or row.get("min_subtotal_idr") or 0),
        "applies_to": row.get("applies_to") or "all",
        "treatment_ids": list(row.get("treatment_ids") or []),
        "category_keys": list(row.get("category_keys") or []),
        "package_ids": list(row.get("package_ids") or []),
        "max_uses_total": int(row["max_uses_total"]) if row.get("max_uses_total") not in (None, "") else (
            int(row["max_uses"]) if row.get("max_uses") not in (None, "") else None
        ),
        "max_uses_per_patient": int(row["max_uses_per_patient"]) if row.get("max_uses_per_patient") not in (None, "") else None,
        "allowed_days_of_week": list(row.get("allowed_days_of_week") or []),
        "allowed_time_start": row.get("allowed_time_start") or None,
        "allowed_time_end": row.get("allowed_time_end") or None,
        "new_patients_only": bool(row.get("new_patients_only", False)),
        "returning_patients_only": bool(row.get("returning_patients_only", False)),
        "stackable_with_package": bool(row.get("stackable_with_package", False)),
        "stackable_with_gift_card": bool(row.get("stackable_with_gift_card", False)),
        "stackable_with_other_discounts": bool(row.get("stackable_with_other_discounts", False)),
        "clinic_id": clinic_id,
    }
    if existing:
        doc["uses_count"] = existing.get("uses_count", 0)
        doc["created_at"] = existing.get("created_at")
        doc["created_by"] = existing.get("created_by")
        doc["id"] = existing["id"]
        doc["legacy_coupon_id"] = existing.get("legacy_coupon_id")
    else:
        doc["uses_count"] = 0
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = iso(now_utc())
        doc["created_by"] = user_id
    return doc


def coupon_to_campaign(coupon: dict) -> dict:
    """Map legacy coupon document to campaign shape."""
    return {
        "id": str(uuid.uuid4()),
        "legacy_coupon_id": coupon.get("id"),
        "clinic_id": coupon.get("clinic_id"),
        "name": coupon.get("name") or coupon.get("code") or "Campaign",
        "code": coupon.get("code"),
        "description": "",
        "active": coupon.get("active", True),
        "start_date": (coupon.get("valid_from") or "")[:10] or None,
        "end_date": (coupon.get("valid_until") or "")[:10] or None,
        "discount_type": coupon.get("discount_type") or "percent",
        "discount_value": int(coupon.get("discount_value") or 0),
        "max_discount_idr": coupon.get("max_discount_idr"),
        "min_invoice_amount_idr": int(coupon.get("min_subtotal_idr") or 0),
        "applies_to": "all",
        "treatment_ids": [],
        "category_keys": [],
        "package_ids": [],
        "max_uses_total": coupon.get("max_uses"),
        "max_uses_per_patient": None,
        "allowed_days_of_week": [],
        "allowed_time_start": None,
        "allowed_time_end": None,
        "new_patients_only": False,
        "returning_patients_only": False,
        "stackable_with_package": False,
        "stackable_with_gift_card": False,
        "stackable_with_other_discounts": False,
        "uses_count": int(coupon.get("uses_count") or 0),
        "created_at": coupon.get("created_at") or iso(now_utc()),
        "created_by": coupon.get("created_by"),
    }


def campaign_snapshot_fields(campaign: dict, discount_amount: int, user_id: str) -> Dict[str, Any]:
    return {
        "campaign_id": campaign["id"],
        "campaign_name_snapshot": campaign.get("name") or "",
        "campaign_code_snapshot": campaign.get("code") or "",
        "discount_type_snapshot": campaign.get("discount_type") or "percent",
        "discount_value_snapshot": int(campaign.get("discount_value") or 0),
        "discount_amount_applied": int(discount_amount),
        "campaign_applied_by_user_id": user_id,
        "campaign_applied_at": iso(now_utc()),
    }
