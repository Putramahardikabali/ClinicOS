"""Shared helpers for clinic reporting (summarize existing records only)."""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from fastapi.responses import Response

from permissions import is_accounting_user, user_has_permission

REPORT_SECTIONS = frozenset({
    "overview", "revenue", "billing", "packages", "treatments",
    "staff", "commission", "appointments", "patients", "consent", "audit", "inventory",
    "gift-cards",
})

BILLING_VIEW_SECTIONS = frozenset({"billing"})

ACCOUNTING_REPORT_SECTIONS = frozenset({
    "overview", "revenue", "billing", "packages", "gift-cards", "online-booking-payments",
})


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def resolve_date_range(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> Tuple[str, str, str, str]:
    """Return start_iso, end_iso, from_str, to_str (YYYY-MM-DD)."""
    today = _utc_today()

    def _bounds(start: date, end: date) -> Tuple[str, str, str, str]:
        return (
            f"{start.isoformat()}T00:00:00",
            f"{end.isoformat()}T23:59:59",
            start.isoformat(),
            end.isoformat(),
        )

    p = (preset or "").strip().lower()
    if p == "today":
        return _bounds(today, today)
    if p == "yesterday":
        d = today - timedelta(days=1)
        return _bounds(d, d)
    if p == "this_week":
        start = today - timedelta(days=today.weekday())
        return _bounds(start, today)
    if p == "last_week":
        end = today - timedelta(days=today.weekday() + 1)
        start = end - timedelta(days=6)
        return _bounds(start, end)
    if p == "this_month":
        start = today.replace(day=1)
        return _bounds(start, today)
    if p == "last_month":
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        start = end.replace(day=1)
        return _bounds(start, end)
    if from_date and to_date:
        try:
            start = date.fromisoformat(from_date[:10])
            end = date.fromisoformat(to_date[:10])
        except ValueError as ex:
            raise HTTPException(status_code=400, detail="Invalid date range") from ex
        if start > end:
            raise HTTPException(status_code=400, detail="from must be before to")
        return _bounds(start, end)
    # default: this month
    start = today.replace(day=1)
    return _bounds(start, today)


def ts_in_range(ts: Optional[str], start_iso: str, end_iso: str) -> bool:
    if not ts:
        return False
    return start_iso <= ts <= end_iso


def assert_report_access(user: dict, section: str = "overview") -> None:
    if user.get("platform_admin"):
        return
    section = (section or "overview").strip().lower()
    if section not in REPORT_SECTIONS:
        section = "overview"

    if is_accounting_user(user):
        if section in ACCOUNTING_REPORT_SECTIONS:
            return
        raise HTTPException(status_code=403, detail="Not allowed to view this report section")

    if section == "audit":
        if user_has_permission(user, "audit.view"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if section == "billing":
        if user_has_permission(user, "reports.view") or user_has_permission(user, "billing.view"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if section == "packages":
        if user_has_permission(user, "reports.view") or user_has_permission(user, "packages.report"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if section == "commission":
        if user_has_permission(user, "reports.view") or user_has_permission(user, "commission.view"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if section == "inventory":
        if user_has_permission(user, "reports.view") or user_has_permission(user, "inventory.view"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if section == "gift-cards":
        if user_has_permission(user, "reports.view"):
            return
        if user_has_permission(user, "gift_cards.view"):
            return
        if user_has_permission(user, "accounting.view"):
            return
        raise HTTPException(status_code=403, detail="Not allowed to view reports")

    if user_has_permission(user, "reports.view"):
        return
    raise HTTPException(status_code=403, detail="Not allowed to view reports")


def item_cash_revenue(item: dict) -> int:
    if item.get("paid_by") == "package":
        return 0
    if item.get("amount_charged") is not None:
        return max(0, int(item.get("amount_charged") or 0))
    if item.get("line_total_idr") is not None:
        return max(0, int(item.get("line_total_idr") or 0))
    unit = int(item.get("unit_price_idr") or 0)
    return unit * int(item.get("quantity") or 1)


def item_service_value(item: dict) -> int:
    if item.get("original_treatment_value") is not None:
        return int(item.get("original_treatment_value") or 0)
    unit = int(item.get("unit_price_idr") or 0)
    return unit * int(item.get("quantity") or 1)


def item_performers(item: dict) -> List[dict]:
    performers = item.get("performers") or []
    if performers:
        return performers
    pid = item.get("performer_id")
    if pid:
        return [{"staff_id": pid, "staff_name_snapshot": item.get("performer_name") or ""}]
    return []


def csv_response(filename: str, headers: List[str], rows: List[List[Any]]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    for row in rows:
        w.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def range_meta(start_iso: str, end_iso: str, from_str: str, to_str: str, preset: Optional[str]) -> dict:
    return {
        "from": from_str,
        "to": to_str,
        "start_iso": start_iso,
        "end_iso": end_iso,
        "preset": preset or "custom",
    }
