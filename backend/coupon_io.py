"""Coupon validation and discount calculation for clinic bookings."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from saas import iso, now_utc


def normalize_coupon_code(code: str) -> str:
    return re.sub(r"\s+", "", (code or "").strip().upper())


def compute_discount(subtotal_idr: int, discount_type: str, discount_value: int, max_discount_idr: Optional[int] = None) -> int:
    subtotal_idr = max(0, int(subtotal_idr or 0))
    if subtotal_idr <= 0:
        return 0
    dtype = (discount_type or "fixed").lower()
    val = max(0, int(discount_value or 0))
    if dtype == "percent":
        val = min(val, 100)
        discount = int(subtotal_idr * val / 100)
        if max_discount_idr is not None and max_discount_idr > 0:
            discount = min(discount, int(max_discount_idr))
    else:
        discount = min(val, subtotal_idr)
    return max(0, discount)


def coupon_is_valid_now(coupon: dict, subtotal_idr: int) -> Optional[str]:
    """Return error message if invalid, else None."""
    if not coupon.get("active", True):
        return "Coupon is inactive"
    now = now_utc()
    vf = coupon.get("valid_from")
    if vf:
        try:
            if now < datetime.fromisoformat(vf.replace("Z", "+00:00")):
                return "Coupon is not valid yet"
        except Exception:
            pass
    vu = coupon.get("valid_until")
    if vu:
        try:
            if now > datetime.fromisoformat(vu.replace("Z", "+00:00")):
                return "Coupon has expired"
        except Exception:
            pass
    min_sub = int(coupon.get("min_subtotal_idr") or 0)
    if min_sub > 0 and subtotal_idr < min_sub:
        return f"Minimum purchase is Rp {min_sub:,}".replace(",", ".")
    max_uses = coupon.get("max_uses")
    if max_uses is not None and int(coupon.get("uses_count") or 0) >= int(max_uses):
        return "Coupon usage limit reached"
    return None


def apply_coupon_to_subtotal(coupon: dict, subtotal_idr: int) -> Dict[str, int]:
    discount = compute_discount(
        subtotal_idr,
        coupon.get("discount_type", "fixed"),
        coupon.get("discount_value", 0),
        coupon.get("max_discount_idr"),
    )
    total = max(0, int(subtotal_idr) - discount)
    return {
        "subtotal_idr": int(subtotal_idr),
        "discount_idr": discount,
        "total_idr": total,
    }


def build_coupon_doc(row: dict, clinic_id: str, user_id: str, existing: Optional[dict] = None) -> dict:
    code = normalize_coupon_code(row.get("code") or "")
    doc = {
        "code": code,
        "name": (row.get("name") or code).strip(),
        "discount_type": row.get("discount_type") or "percent",
        "discount_value": int(row.get("discount_value") or 0),
        "max_discount_idr": int(row["max_discount_idr"]) if row.get("max_discount_idr") not in (None, "") else None,
        "min_subtotal_idr": int(row.get("min_subtotal_idr") or 0),
        "active": bool(row.get("active", True)),
        "valid_from": row.get("valid_from") or None,
        "valid_until": row.get("valid_until") or None,
        "max_uses": int(row["max_uses"]) if row.get("max_uses") not in (None, "") else None,
        "clinic_id": clinic_id,
    }
    if existing:
        doc["uses_count"] = existing.get("uses_count", 0)
        doc["created_at"] = existing.get("created_at")
        doc["created_by"] = existing.get("created_by")
        doc["id"] = existing["id"]
    else:
        doc["uses_count"] = 0
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = iso(now_utc())
        doc["created_by"] = user_id
    return doc
