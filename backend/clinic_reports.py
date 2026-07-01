"""Clinic reporting API — summarizes existing records; does not recalculate core data."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from permissions import user_has_permission
from reports_common import (
    BILLING_VIEW_SECTIONS,
    assert_report_access,
    item_cash_revenue,
    item_performers,
    item_service_value,
    range_meta,
    resolve_date_range,
    ts_in_range,
)
from report_excel import xlsx_response
from report_exports import EXPORTERS, _filters_dict


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _load_invoices(db, cid: str, start_iso: str, end_iso: str) -> List[dict]:
    return await db.invoices.find(
        {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
        {"_id": 0},
    ).to_list(10000)


async def _load_paid_invoices_by_paid_at(db, cid: str, start_iso: str, end_iso: str) -> List[dict]:
    rows = await db.invoices.find(
        {
            "clinic_id": cid,
            "payment_status": {"$in": ["paid", "partial"]},
        },
        {"_id": 0},
    ).to_list(10000)
    out = []
    for inv in rows:
        ref = inv.get("paid_at") or inv.get("updated_at") or inv.get("created_at")
        if ts_in_range(ref, start_iso, end_iso):
            out.append(inv)
    return out


def _aggregate_revenue(invoices: List[dict], paid_in_range: List[dict]) -> dict:
    paid_ids = {i["id"] for i in paid_in_range}
    total_paid = sum(int(i.get("amount_paid") or 0) for i in paid_in_range if i.get("payment_status") == "paid")
    partial_paid = sum(int(i.get("amount_paid") or 0) for i in paid_in_range if i.get("payment_status") == "partial")
    unpaid = sum(int(i.get("remaining_balance") or 0) for i in invoices if i.get("payment_status") == "unpaid")
    partial_outstanding = sum(int(i.get("remaining_balance") or 0) for i in invoices if i.get("payment_status") == "partial")
    cancelled = sum(int(i.get("total_amount") or 0) for i in invoices if i.get("payment_status") == "cancelled")
    refunded = sum(int(i.get("amount_paid") or 0) for i in invoices if i.get("payment_status") == "refunded")

    by_date: Dict[str, int] = defaultdict(int)
    by_method: Dict[str, int] = defaultdict(int)
    by_treatment: Dict[str, int] = defaultdict(int)
    by_package: Dict[str, int] = defaultdict(int)
    by_item_type: Dict[str, int] = defaultdict(int)
    performer_assoc: Dict[str, int] = defaultdict(int)
    package_purchase_revenue = 0
    package_usage_value = 0
    cash_line_revenue = 0

    revenue_invs = [i for i in paid_in_range if i.get("payment_status") == "paid"]
    for inv in revenue_invs:
        day = (inv.get("paid_at") or inv.get("created_at") or "")[:10]
        by_date[day] += int(inv.get("amount_paid") or 0)
        method = inv.get("payment_method") or "other"
        by_method[method] += int(inv.get("amount_paid") or 0)

    for inv in revenue_invs:
        for it in inv.get("items") or []:
            cash = item_cash_revenue(it)
            cash_line_revenue += cash
            itype = it.get("item_type") or "custom"
            by_item_type[itype] += cash
            if it.get("paid_by") == "package":
                package_usage_value += item_service_value(it)
                continue
            name = it.get("name") or "—"
            if itype == "package":
                by_package[name] += cash
                package_purchase_revenue += cash
            elif itype == "treatment":
                by_treatment[name] += cash
            for p in item_performers(it):
                key = p.get("staff_name_snapshot") or p.get("staff_id") or "—"
                performer_assoc[key] += cash

    inv_count = len(revenue_invs)
    avg = int(total_paid / inv_count) if inv_count else 0

    return {
        "total_paid_revenue_idr": total_paid,
        "partial_paid_idr": partial_paid,
        "unpaid_amount_idr": unpaid,
        "partial_outstanding_idr": partial_outstanding,
        "cancelled_amount_idr": cancelled,
        "refunded_amount_idr": refunded,
        "cash_line_revenue_idr": cash_line_revenue,
        "package_purchase_revenue_idr": package_purchase_revenue,
        "package_usage_service_value_idr": package_usage_value,
        "invoice_count": inv_count,
        "average_invoice_value_idr": avg,
        "by_date": [{"date": k, "revenue_idr": v} for k, v in sorted(by_date.items())],
        "by_payment_method": [{"method": k, "revenue_idr": v} for k, v in sorted(by_method.items(), key=lambda x: -x[1])],
        "by_treatment": [{"name": k, "revenue_idr": v} for k, v in sorted(by_treatment.items(), key=lambda x: -x[1])[:30]],
        "by_package": [{"name": k, "revenue_idr": v} for k, v in sorted(by_package.items(), key=lambda x: -x[1])[:30]],
        "by_item_type": [{"item_type": k, "revenue_idr": v} for k, v in sorted(by_item_type.items(), key=lambda x: -x[1])],
        "performer_associated_revenue": [
            {"performer": k, "associated_revenue_idr": v, "note": "Not added to clinic total — per-line attribution"}
            for k, v in sorted(performer_assoc.items(), key=lambda x: -x[1])[:50]
        ],
    }


def register_clinic_reports(
    api: APIRouter,
    db,
    get_current_user,
    assert_feature,
    scope,
):
    async def _assert_reports_feature(user: dict, section: str) -> None:
        section = (section or "overview").strip().lower()
        if (
            section in BILLING_VIEW_SECTIONS
            and not user_has_permission(user, "reports.view")
            and user_has_permission(user, "billing.view")
        ):
            await assert_feature(user, "billing")
        else:
            await assert_feature(user, "reports")

    def _xlsx(section: str, data: dict, preset: Optional[str], from_date: Optional[str], to_date: Optional[str], **filters: Any):
        flt = _filters_dict(preset=preset, from_date=from_date, to_date=to_date, **filters)
        content = EXPORTERS[section](data, flt)
        r = data.get("range") or {}
        return xlsx_response(f"{section}-{r.get('from', 'range')}-{r.get('to', '')}", content)
    async def _params(
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        return start_iso, end_iso, from_str, to_str, preset

    @api.get("/reports/overview")
    async def reports_overview(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "overview")
        await _assert_reports_feature(user, "overview")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        invoices = await _load_invoices(db, cid, start_iso, end_iso)
        paid_in_range = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
        rev = _aggregate_revenue(invoices, paid_in_range)

        visits = await db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "status": 1},
        ).to_list(10000)
        completed_visits = sum(1 for v in visits if v.get("status") == "completed")

        new_patients = await db.patients.count_documents({
            "clinic_id": cid,
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        })

        pkg_rows = await db.patient_packages.find(
            {"clinic_id": cid, "status": {"$in": ["active", "partially_used"]}},
            {"_id": 0, "id": 1},
        ).to_list(5000)
        usage_rows = await db.package_usage.find(
            {"clinic_id": cid, "usage_date": {"$gte": start_iso, "$lte": end_iso}, "status": "active"},
            {"_id": 0},
        ).to_list(5000)
        sessions_used = sum(int(u.get("used_sessions_count") or u.get("used_quantity") or 1) for u in usage_rows)

        comm_approved = 0
        async for r in db.commission_records.find(
            {"clinic_id": cid, "status": "approved", "approved_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "commission_amount": 1},
        ):
            comm_approved += int(r.get("commission_amount") or 0)

        pending_notes = await db.visits.count_documents({
            "clinic_id": cid,
            "status": "completed",
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        })
        # rough: visits completed without submitted clinical/therapist note
        pending_notes_count = 0
        pending_visits = await db.visits.find(
            {"clinic_id": cid, "status": "completed", "completed_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "id": 1, "visit_type": 1},
        ).to_list(500)
        for v in pending_visits:
            vid = v["id"]
            if v.get("visit_type") == "doctor":
                rec = await db.clinical_records.find_one({"visit_id": vid}, {"_id": 0, "submitted": 1, "note_status": 1})
                if not rec or (not rec.get("submitted") and rec.get("note_status") not in ("completed", "locked")):
                    pending_notes_count += 1
            else:
                rec = await db.therapist_records.find_one({"visit_id": vid}, {"_id": 0, "submitted": 1, "note_status": 1})
                if not rec or (not rec.get("submitted") and rec.get("note_status") not in ("completed", "locked")):
                    pending_notes_count += 1

        pending_consent = await db.consent_forms.count_documents({
            "clinic_id": cid,
            "status": {"$in": ["not_sent", "pending"]},
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        })

        revenue_invs = [i for i in paid_in_range if i.get("payment_status") == "paid"]
        treatment_by_count: Dict[str, int] = defaultdict(int)
        for inv in revenue_invs:
            for it in inv.get("items") or []:
                if it.get("item_type") == "treatment":
                    treatment_by_count[it.get("name") or "—"] += int(it.get("quantity") or 1)

        usage_by_treatment: Dict[str, int] = defaultdict(int)
        for u in usage_rows:
            usage_by_treatment[u.get("treatment_name_snapshot") or "—"] += int(
                u.get("used_quantity") or u.get("used_sessions_count") or 1
            )

        bookings = await db.bookings.find(
            {"clinic_id": cid, "scheduled_at": {"$gte": start_iso, "$lte": end_iso}, "booking_type": {"$ne": "block"}},
            {"_id": 0, "status": 1},
        ).to_list(10000)
        appt_status: Dict[str, int] = defaultdict(int)
        for b in bookings:
            appt_status[b.get("status") or "booked"] += 1

        visit_status: Dict[str, int] = defaultdict(int)
        for v in visits:
            visit_status[v.get("status") or "—"] += 1

        comm_by_status: Dict[str, int] = defaultdict(int)
        async for c in db.commission_records.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "status": 1, "commission_amount": 1},
        ):
            comm_by_status[c.get("status") or "pending"] += int(c.get("commission_amount") or 0)

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "paid_revenue_idr": rev["total_paid_revenue_idr"],
                "paid_invoices": rev["invoice_count"],
                "outstanding_balance_idr": rev["unpaid_amount_idr"] + rev["partial_outstanding_idr"],
                "completed_visits": completed_visits,
                "new_patients": new_patients,
                "active_packages": len(pkg_rows),
                "package_sessions_used": sessions_used,
                "commission_approved_idr": comm_approved,
                "pending_clinical_notes": pending_notes_count,
                "pending_consent": pending_consent,
            },
            "charts": {
                "revenue_trend": rev["by_date"],
                "revenue_by_payment_method": rev["by_payment_method"],
                "top_treatments": rev["by_treatment"][:10],
                "top_treatments_by_count": [
                    {"name": k, "count": v}
                    for k, v in sorted(treatment_by_count.items(), key=lambda x: -x[1])[:10]
                ],
                "package_usage": [
                    {"treatment": k, "count": v}
                    for k, v in sorted(usage_by_treatment.items(), key=lambda x: -x[1])[:10]
                ],
                "appointment_status": [
                    {"status": k, "count": v} for k, v in sorted(appt_status.items(), key=lambda x: -x[1])
                ],
                "visit_status": [
                    {"status": k, "count": v} for k, v in sorted(visit_status.items(), key=lambda x: -x[1])
                ],
                "commission_status": [
                    {"status": k, "amount_idr": v}
                    for k, v in sorted(comm_by_status.items(), key=lambda x: -x[1])
                ],
            },
        }

    @api.get("/reports/overview/export")
    async def reports_overview_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "overview")
        await _assert_reports_feature(user, "overview")
        data = await reports_overview(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("overview", data, preset, from_date, to_date)

    @api.get("/reports/revenue")
    async def reports_revenue(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        payment_status: Optional[str] = None,
        staff_id: Optional[str] = None,
    ):
        assert_report_access(user, "revenue")
        await _assert_reports_feature(user, "revenue")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")
        invoices = await _load_invoices(db, cid, start_iso, end_iso)
        paid_in_range = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
        if payment_status:
            paid_in_range = [i for i in paid_in_range if i.get("payment_status") == payment_status]
        data = _aggregate_revenue(invoices, paid_in_range)
        return {"range": range_meta(start_iso, end_iso, from_str, to_str, preset), **data}

    @api.get("/reports/revenue/export")
    async def reports_revenue_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "revenue")
        await _assert_reports_feature(user, "revenue")
        data = await reports_revenue(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("revenue", data, preset, from_date, to_date)

    @api.get("/reports/billing")
    async def reports_billing(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        payment_status: Optional[str] = None,
        payment_method: Optional[str] = None,
    ):
        assert_report_access(user, "billing")
        await _assert_reports_feature(user, "billing")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}}
        if payment_status:
            flt["payment_status"] = payment_status
        if payment_method:
            flt["payment_method"] = payment_method
        invoices = await db.invoices.find(flt, {"_id": 0}).sort("created_at", -1).to_list(5000)

        by_status: Dict[str, int] = defaultdict(int)
        by_method: Dict[str, int] = defaultdict(int)
        discount_total = 0
        discount_reasons: Dict[str, int] = defaultdict(int)
        campaign_discounts: Dict[str, int] = defaultdict(int)
        campaign_counts: Dict[str, int] = defaultdict(int)
        gross_before_discount = 0
        outstanding = 0
        rows_out = []

        patient_names = {}
        for inv in invoices:
            st = inv.get("payment_status") or "unpaid"
            by_status[st] += 1
            by_method[inv.get("payment_method") or "other"] += int(inv.get("amount_paid") or 0)
            discount_total += int(inv.get("discount_amount") or 0)
            gross_before_discount += int(inv.get("total_amount") or 0) + int(inv.get("discount_amount") or 0)
            reason = (inv.get("discount_reason") or "").strip() or "(none)"
            if int(inv.get("discount_amount") or 0) > 0:
                discount_reasons[reason] += int(inv.get("discount_amount") or 0)
            if inv.get("campaign_id"):
                cname = inv.get("campaign_name_snapshot") or inv.get("campaign_id")
                camt = int(inv.get("discount_amount_applied") or inv.get("discount_amount") or 0)
                campaign_discounts[cname] += camt
                campaign_counts[cname] += 1
            outstanding += int(inv.get("remaining_balance") or 0)
            pid = inv.get("patient_id")
            if pid and pid not in patient_names:
                p = await db.patients.find_one({"id": pid}, {"_id": 0, "full_name": 1})
                patient_names[pid] = (p or {}).get("full_name") or "—"
            rows_out.append({
                "invoice_id": inv.get("id"),
                "invoice_number": inv.get("invoice_number"),
                "patient_name": patient_names.get(pid, "—"),
                "date": (inv.get("created_at") or "")[:10],
                "total_idr": int(inv.get("total_amount") or 0),
                "paid_idr": int(inv.get("amount_paid") or 0),
                "remaining_idr": int(inv.get("remaining_balance") or 0),
                "status": st,
                "payment_method": inv.get("payment_method"),
            })

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "paid_count": by_status.get("paid", 0),
                "unpaid_count": by_status.get("unpaid", 0),
                "partial_count": by_status.get("partial", 0),
                "cancelled_count": by_status.get("cancelled", 0),
                "outstanding_balance_idr": outstanding,
                "discount_total_idr": discount_total,
                "gross_sales_idr": gross_before_discount,
                "campaign_discount_total_idr": sum(campaign_discounts.values()),
                "net_sales_idr": gross_before_discount - discount_total,
            },
            "by_payment_method": [{"method": k, "amount_idr": v} for k, v in sorted(by_method.items(), key=lambda x: -x[1])],
            "discount_by_reason": [{"reason": k, "amount_idr": v} for k, v in sorted(discount_reasons.items(), key=lambda x: -x[1])],
            "discount_by_campaign": [
                {"campaign": k, "amount_idr": campaign_discounts[k], "invoice_count": campaign_counts[k]}
                for k in sorted(campaign_discounts.keys(), key=lambda x: -campaign_discounts[x])
            ],
            "invoices": rows_out[:500],
        }

    @api.get("/reports/billing/export")
    async def reports_billing_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "billing")
        await _assert_reports_feature(user, "billing")
        data = await reports_billing(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("billing", data, preset, from_date, to_date)

    @api.get("/reports/packages")
    async def reports_packages(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        package_type: Optional[str] = None,
    ):
        assert_report_access(user, "packages")
        await _assert_reports_feature(user, "packages")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        all_pkgs = await db.patient_packages.find({"clinic_id": cid}, {"_id": 0}).to_list(5000)
        status_counts = defaultdict(int)
        remaining_sessions = 0
        for row in all_pkgs:
            status_counts[row.get("status") or "unknown"] += 1
            if row.get("status") in ("active", "partially_used"):
                remaining_sessions += int(row.get("remaining_sessions") or 0)

        exp_cutoff = (datetime.now(timezone.utc).date() + timedelta(days=30)).strftime("%Y-%m-%d")
        expiring = [r for r in all_pkgs if r.get("status") in ("active", "partially_used") and r.get("expiry_date") and r["expiry_date"] <= exp_cutoff]

        usage_rows = await db.package_usage.find(
            {"clinic_id": cid, "usage_date": {"$gte": start_iso, "$lte": end_iso}, "status": "active"},
            {"_id": 0},
        ).to_list(5000)
        usage_by_treatment: Dict[str, int] = defaultdict(int)
        usage_by_date: Dict[str, int] = defaultdict(int)
        component_usage: Dict[str, int] = defaultdict(int)
        for u in usage_rows:
            if package_type and u.get("package_type") != package_type:
                continue
            name = u.get("treatment_name_snapshot") or "—"
            usage_by_treatment[name] += int(u.get("used_quantity") or u.get("used_sessions_count") or 1)
            usage_by_date[(u.get("usage_date") or "")[:10]] += 1
            comp = u.get("treatment_name_snapshot") or u.get("patient_package_component_id") or "—"
            component_usage[comp] += int(u.get("used_quantity") or 1)

        sales_revenue = 0
        sales_count = 0
        async for inv in db.invoices.find(
            {"clinic_id": cid, "payment_status": "paid", "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "items": 1},
        ):
            for it in inv.get("items") or []:
                if it.get("item_type") != "package":
                    continue
                sales_revenue += item_cash_revenue(it)
                sales_count += 1

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "package_sales_revenue_idr": sales_revenue,
                "package_sales_count": sales_count,
                "active_count": status_counts.get("active", 0),
                "partially_used_count": status_counts.get("partially_used", 0),
                "used_up_count": status_counts.get("used_up", 0),
                "expired_count": status_counts.get("expired", 0),
                "cancelled_count": status_counts.get("cancelled", 0),
                "expiring_soon_count": len(expiring),
                "remaining_sessions_total": remaining_sessions,
                "sessions_used_in_range": sum(int(u.get("used_quantity") or 1) for u in usage_rows),
            },
            "usage_by_treatment": [{"treatment": k, "count": v} for k, v in sorted(usage_by_treatment.items(), key=lambda x: -x[1])[:30]],
            "usage_by_date": [{"date": k, "count": v} for k, v in sorted(usage_by_date.items())],
            "component_usage": [{"component": k, "count": v} for k, v in sorted(component_usage.items(), key=lambda x: -x[1])[:30]],
            "expiring_soon": [
                {"id": r.get("id"), "name": r.get("package_name_snapshot"), "expiry_date": r.get("expiry_date"), "remaining": r.get("remaining_sessions")}
                for r in expiring[:50]
            ],
        }

    @api.get("/reports/treatments")
    async def reports_treatments(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        category: Optional[str] = None,
        staff_id: Optional[str] = None,
    ):
        assert_report_access(user, "treatments")
        await _assert_reports_feature(user, "treatments")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        by_category: Dict[str, int] = defaultdict(int)
        by_performer: Dict[str, int] = defaultdict(int)
        by_role: Dict[str, int] = defaultdict(int)
        by_payment: Dict[str, int] = defaultdict(int)
        by_name_count: Dict[str, int] = defaultdict(int)
        by_name_revenue: Dict[str, int] = defaultdict(int)
        package_delivered = 0
        total_performed = 0

        invoices = await _load_invoices(db, cid, start_iso, end_iso)
        for inv in invoices:
            if inv.get("payment_status") not in ("paid", "partial"):
                continue
            for it in inv.get("items") or []:
                if it.get("item_type") != "treatment":
                    continue
                if category and (it.get("category") or "") != category:
                    continue
                performers = item_performers(it)
                if staff_id and not any(p.get("staff_id") == staff_id for p in performers):
                    continue
                total_performed += int(it.get("quantity") or 1)
                name = it.get("name") or "—"
                by_name_count[name] += int(it.get("quantity") or 1)
                cash = item_cash_revenue(it)
                by_name_revenue[name] += cash
                cat = it.get("category") or "general"
                by_category[cat] += int(it.get("quantity") or 1)
                pay = it.get("paid_by") or inv.get("payment_method") or "cash"
                by_payment[pay] += 1
                if it.get("paid_by") == "package":
                    package_delivered += item_service_value(it)
                for p in performers:
                    by_performer[p.get("staff_name_snapshot") or p.get("staff_id") or "—"] += 1
                    by_role[p.get("staff_role_snapshot") or p.get("performer_type") or "—"] += 1

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {"total_treatments_performed": total_performed, "package_delivered_value_idr": package_delivered},
            "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
            "by_performer": [{"performer": k, "count": v} for k, v in sorted(by_performer.items(), key=lambda x: -x[1])[:30]],
            "by_role": [{"role": k, "count": v} for k, v in sorted(by_role.items(), key=lambda x: -x[1])],
            "by_payment": [{"payment": k, "count": v} for k, v in sorted(by_payment.items(), key=lambda x: -x[1])],
            "top_by_count": [{"name": k, "count": v} for k, v in sorted(by_name_count.items(), key=lambda x: -x[1])[:20]],
            "top_by_revenue": [{"name": k, "revenue_idr": v} for k, v in sorted(by_name_revenue.items(), key=lambda x: -x[1])[:20]],
        }

    @api.get("/reports/staff")
    async def reports_staff(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        performer_role: Optional[str] = None,
    ):
        assert_report_access(user, "staff")
        await _assert_reports_feature(user, "staff")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        appts_by_staff: Dict[str, int] = defaultdict(int)
        visits_by_staff: Dict[str, int] = defaultdict(int)
        assoc_revenue: Dict[str, int] = defaultdict(int)
        treatments_by_staff: Dict[str, int] = defaultdict(int)
        assistant_count = 0
        nurse_assist_count = 0

        bflt = {"clinic_id": cid, "scheduled_at": {"$gte": start_iso, "$lte": end_iso}, "status": {"$ne": "blocked"}}
        async for b in db.bookings.find(bflt, {"_id": 0, "performers": 1, "performer_id": 1}):
            for p in (b.get("performers") or []):
                sid = p.get("staff_id")
                if not sid:
                    continue
                if staff_id and sid != staff_id:
                    continue
                if performer_role and (p.get("staff_role_snapshot") or "") != performer_role:
                    continue
                appts_by_staff[p.get("staff_name_snapshot") or sid] += 1
                if (p.get("performer_type") or "") in ("assistant", "secondary"):
                    assistant_count += 1
                if (p.get("staff_role_snapshot") or "") == "nurse":
                    nurse_assist_count += 1

        async for v in db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "assigned_to": 1, "performers": 1},
        ):
            for p in (v.get("performers") or []):
                sid = p.get("staff_id")
                if staff_id and sid != staff_id:
                    continue
                visits_by_staff[p.get("staff_name_snapshot") or sid or "—"] += 1

        paid_in_range = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
        for inv in paid_in_range:
            if inv.get("payment_status") != "paid":
                continue
            for it in inv.get("items") or []:
                cash = item_cash_revenue(it)
                for p in item_performers(it):
                    sid = p.get("staff_id")
                    if staff_id and sid != staff_id:
                        continue
                    if performer_role and (p.get("staff_role_snapshot") or "") != performer_role:
                        continue
                    key = p.get("staff_name_snapshot") or sid or "—"
                    assoc_revenue[key] += cash
                    if it.get("item_type") == "treatment":
                        treatments_by_staff[key] += int(it.get("quantity") or 1)

        comm_by_staff: Dict[str, int] = defaultdict(int)
        async for c in db.commission_records.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "staff_name_snapshot": 1, "commission_amount": 1, "status": 1},
        ):
            if c.get("status") in ("approved", "paid_out"):
                comm_by_staff[c.get("staff_name_snapshot") or "—"] += int(c.get("commission_amount") or 0)

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "assistant_performer_count": assistant_count,
                "nurse_assisted_count": nurse_assist_count,
            },
            "appointments_by_staff": [{"staff": k, "count": v} for k, v in sorted(appts_by_staff.items(), key=lambda x: -x[1])],
            "visits_by_staff": [{"staff": k, "count": v} for k, v in sorted(visits_by_staff.items(), key=lambda x: -x[1])],
            "associated_revenue_by_staff": [
                {"staff": k, "associated_revenue_idr": v, "note": "Per-line attribution; clinic total is deduplicated"}
                for k, v in sorted(assoc_revenue.items(), key=lambda x: -x[1])[:40]
            ],
            "treatments_by_staff": [{"staff": k, "count": v} for k, v in sorted(treatments_by_staff.items(), key=lambda x: -x[1])],
            "commission_by_staff": [{"staff": k, "commission_idr": v} for k, v in sorted(comm_by_staff.items(), key=lambda x: -x[1])],
        }

    @api.get("/reports/commission")
    async def reports_commission(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        status: Optional[str] = Query("all"),
        staff_id: Optional[str] = None,
        role: Optional[str] = None,
    ):
        assert_report_access(user, "commission")
        await _assert_reports_feature(user, "commission")
        await assert_feature(user, "commissions")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}}
        if staff_id:
            flt["staff_id"] = staff_id
        if role:
            flt["staff_role_snapshot"] = role
        if status and status != "all":
            flt["status"] = status

        rows = await db.commission_records.find(flt, {"_id": 0}).to_list(10000)
        totals = {"earned": 0, "approved": 0, "paid_out": 0, "pending": 0}
        by_staff: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        by_role: Dict[str, int] = defaultdict(int)
        by_treatment: Dict[str, int] = defaultdict(int)

        for r in rows:
            st = r.get("status") or "pending"
            amt = int(r.get("commission_amount") or 0)
            if st in totals:
                totals[st] += amt
            name = r.get("staff_name_snapshot") or r.get("staff_id") or "—"
            by_staff[name][st] += amt
            by_role[r.get("staff_role_snapshot") or "—"] += amt
            by_treatment[r.get("item_name_snapshot") or "—"] += amt

        approved_unpaid = sum(
            int(r.get("commission_amount") or 0)
            for r in rows if r.get("status") == "approved"
        )

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                **totals,
                "approved_unpaid_idr": approved_unpaid,
                "record_count": len(rows),
            },
            "by_staff": [
                {"staff": k, **dict(v)} for k, v in sorted(by_staff.items())
            ],
            "by_role": [{"role": k, "commission_idr": v} for k, v in sorted(by_role.items(), key=lambda x: -x[1])],
            "by_treatment": [{"treatment": k, "commission_idr": v} for k, v in sorted(by_treatment.items(), key=lambda x: -x[1])[:30]],
            "records": rows[:200],
        }

    @api.get("/reports/appointments")
    async def reports_appointments(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        treatment: Optional[str] = None,
    ):
        assert_report_access(user, "appointments")
        await _assert_reports_feature(user, "appointments")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        flt = {"clinic_id": cid, "scheduled_at": {"$gte": start_iso, "$lte": end_iso}, "booking_type": {"$ne": "block"}}
        bookings = await db.bookings.find(flt, {"_id": 0}).to_list(10000)
        by_status: Dict[str, int] = defaultdict(int)
        by_treatment: Dict[str, int] = defaultdict(int)
        by_performer: Dict[str, int] = defaultdict(int)

        for b in bookings:
            if treatment and b.get("treatment") != treatment:
                continue
            by_status[b.get("status") or "booked"] += 1
            by_treatment[b.get("treatment") or "—"] += 1
            for p in (b.get("performers") or []):
                if staff_id and p.get("staff_id") != staff_id:
                    continue
                by_performer[p.get("staff_name_snapshot") or p.get("staff_id") or "—"] += 1

        visits = await db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "status": 1},
        ).to_list(10000)
        visit_status = defaultdict(int)
        for v in visits:
            visit_status[v.get("status") or "—"] += 1

        rescheduled = await db.audit_logs.count_documents({
            "clinic_id": cid,
            "module": "appointment",
            "action": "rescheduled",
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        })

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "total_appointments": len(bookings),
                "completed": by_status.get("completed", 0),
                "cancelled": by_status.get("cancelled", 0),
                "no_show": by_status.get("no_show", 0),
                "rescheduled": rescheduled,
                "visits_completed": visit_status.get("completed", 0),
                "visits_in_progress": visit_status.get("in_progress", 0),
            },
            "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items(), key=lambda x: -x[1])],
            "by_treatment": [{"treatment": k, "count": v} for k, v in sorted(by_treatment.items(), key=lambda x: -x[1])[:30]],
            "by_performer": [{"performer": k, "count": v} for k, v in sorted(by_performer.items(), key=lambda x: -x[1])[:30]],
        }

    @api.get("/reports/patients")
    async def reports_patients(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "patients")
        await _assert_reports_feature(user, "patients")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        new_patients = await db.patients.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "id": 1, "full_name": 1, "patient_source": 1, "created_at": 1},
        ).to_list(5000)
        new_ids = {p["id"] for p in new_patients}

        returning = 0
        async for v in db.visits.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "patient_id": 1},
        ):
            pid = v.get("patient_id")
            if pid and pid not in new_ids:
                returning += 1

        active_packages = await db.patient_packages.count_documents({
            "clinic_id": cid, "status": {"$in": ["active", "partially_used"]},
        })
        expired_pids = set()
        async for r in db.patient_packages.find(
            {"clinic_id": cid, "status": "expired"}, {"_id": 0, "patient_id": 1}
        ):
            if r.get("patient_id"):
                expired_pids.add(r["patient_id"])
        expired_packages_patients = len(expired_pids)

        spend_by_patient: Dict[str, int] = defaultdict(int)
        names: Dict[str, str] = {}
        paid_in_range = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
        for inv in paid_in_range:
            if inv.get("payment_status") != "paid":
                continue
            pid = inv.get("patient_id")
            if not pid:
                continue
            spend_by_patient[pid] += int(inv.get("amount_paid") or 0)

        top_spend = []
        for pid, amt in sorted(spend_by_patient.items(), key=lambda x: -x[1])[:20]:
            if pid not in names:
                p = await db.patients.find_one({"id": pid}, {"_id": 0, "full_name": 1})
                names[pid] = (p or {}).get("full_name") or "—"
            top_spend.append({"patient_id": pid, "patient_name": names[pid], "spent_idr": amt})

        follow_up = []
        async for rec in db.clinical_records.find(
            {"clinic_id": cid, "follow_up_recommendation": {"$exists": True, "$ne": ""}},
            {"_id": 0, "visit_id": 1, "follow_up_recommendation": 1},
        ).limit(50):
            follow_up.append(rec)
        async for rec in db.therapist_records.find(
            {"clinic_id": cid, "follow_up_recommendation": {"$exists": True, "$ne": ""}},
            {"_id": 0, "visit_id": 1, "follow_up_recommendation": 1},
        ).limit(50):
            follow_up.append(rec)

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "new_patients": len(new_patients),
                "returning_visit_count": returning,
                "total_active_patients": await db.patients.count_documents({"clinic_id": cid}),
                "patients_with_active_packages": active_packages,
                "patients_with_expired_packages": expired_packages_patients,
                "follow_up_notes_count": len(follow_up),
            },
            "new_patients": [{"name": p.get("full_name"), "patient_source": p.get("patient_source"), "date": (p.get("created_at") or "")[:10]} for p in new_patients[:100]],
            "top_spending": top_spend,
        }

    @api.get("/reports/consent")
    async def reports_consent(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "consent")
        await _assert_reports_feature(user, "consent")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        forms = await db.consent_forms.find(
            {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "patient_signature": 0, "staff_signature": 0},
        ).to_list(5000)
        by_status = defaultdict(int)
        for f in forms:
            by_status[f.get("status") or "—"] += 1

        notes_completed = await db.clinical_records.count_documents({
            "clinic_id": cid,
            "note_status": {"$in": ["completed", "locked"]},
            "updated_at": {"$gte": start_iso, "$lte": end_iso},
        })
        notes_completed += await db.therapist_records.count_documents({
            "clinic_id": cid,
            "note_status": {"$in": ["completed", "locked"]},
            "updated_at": {"$gte": start_iso, "$lte": end_iso},
        })
        locked_notes = await db.clinical_records.count_documents({
            "clinic_id": cid, "note_status": "locked",
        })
        locked_notes += await db.therapist_records.count_documents({
            "clinic_id": cid, "note_status": "locked",
        })

        edited_after_lock = await db.audit_logs.count_documents({
            "clinic_id": cid,
            "module": "clinical_note",
            "action": "edited",
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        })

        missing_notes = 0
        completed_visits = await db.visits.find(
            {"clinic_id": cid, "status": "completed", "completed_at": {"$gte": start_iso, "$lte": end_iso}},
            {"_id": 0, "id": 1, "visit_type": 1},
        ).to_list(300)
        for v in completed_visits:
            vid = v["id"]
            coll = "clinical_records" if v.get("visit_type") == "doctor" else "therapist_records"
            rec = await db[coll].find_one({"visit_id": vid}, {"_id": 0, "note_status": 1, "submitted": 1})
            if not rec or rec.get("note_status") not in ("completed", "locked"):
                missing_notes += 1

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {
                "consent_signed": by_status.get("signed", 0),
                "consent_pending": by_status.get("pending", 0) + by_status.get("not_sent", 0),
                "consent_expired": by_status.get("expired", 0),
                "consent_cancelled": by_status.get("cancelled", 0),
                "clinical_notes_completed": notes_completed,
                "locked_notes": locked_notes,
                "notes_edited_after_lock": edited_after_lock,
                "visits_missing_notes": missing_notes,
            },
            "consent_by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
            "consent_forms": forms[:100],
        }

    @api.get("/reports/audit-log")
    async def reports_audit_log(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        module: Optional[str] = None,
        user_id: Optional[str] = None,
    ):
        assert_report_access(user, "audit")
        await _assert_reports_feature(user, "audit")
        if not user_has_permission(user, "audit.view") and user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Audit report requires audit.view")
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}}
        if module:
            flt["module"] = module
        if user_id:
            flt["user_id"] = user_id

        logs = await db.audit_logs.find(flt, {"_id": 0}).sort("created_at", -1).to_list(1000)
        by_module: Dict[str, int] = defaultdict(int)
        by_user: Dict[str, int] = defaultdict(int)
        for row in logs:
            by_module[row.get("module") or row.get("entity") or "—"] += 1
            by_user[row.get("user_email") or row.get("user_id") or "—"] += 1

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "summary": {"total_events": len(logs)},
            "by_module": [{"module": k, "count": v} for k, v in sorted(by_module.items(), key=lambda x: -x[1])],
            "by_user": [{"user": k, "count": v} for k, v in sorted(by_user.items(), key=lambda x: -x[1])[:30]],
            "logs": logs[:500],
        }

    @api.get("/reports/audit-log/export")
    async def reports_audit_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        module: Optional[str] = None,
    ):
        assert_report_access(user, "audit")
        await _assert_reports_feature(user, "audit")
        if not user_has_permission(user, "audit.view") and user.get("role") not in ("super_admin", "manager"):
            raise HTTPException(status_code=403, detail="Audit report requires audit.view")
        data = await reports_audit_log(user=user, preset=preset, from_date=from_date, to_date=to_date, module=module)
        return _xlsx("audit", data, preset, from_date, to_date, module=module)

    @api.get("/reports/packages/export")
    async def reports_packages_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        package_type: Optional[str] = None,
    ):
        assert_report_access(user, "packages")
        await _assert_reports_feature(user, "packages")
        data = await reports_packages(user=user, preset=preset, from_date=from_date, to_date=to_date, package_type=package_type)
        return _xlsx("packages", data, preset, from_date, to_date, package_type=package_type)

    @api.get("/reports/treatments/export")
    async def reports_treatments_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        category: Optional[str] = None,
        staff_id: Optional[str] = None,
    ):
        assert_report_access(user, "treatments")
        await _assert_reports_feature(user, "treatments")
        data = await reports_treatments(user=user, preset=preset, from_date=from_date, to_date=to_date, category=category, staff_id=staff_id)
        return _xlsx("treatments", data, preset, from_date, to_date, category=category, staff_id=staff_id)

    @api.get("/reports/staff/export")
    async def reports_staff_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        performer_role: Optional[str] = None,
    ):
        assert_report_access(user, "staff")
        await _assert_reports_feature(user, "staff")
        data = await reports_staff(user=user, preset=preset, from_date=from_date, to_date=to_date, staff_id=staff_id, performer_role=performer_role)
        return _xlsx("staff", data, preset, from_date, to_date, staff_id=staff_id, performer_role=performer_role)

    @api.get("/reports/commission/export")
    async def reports_commission_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        status: Optional[str] = Query("all"),
        staff_id: Optional[str] = None,
        role: Optional[str] = None,
    ):
        assert_report_access(user, "commission")
        await _assert_reports_feature(user, "commission")
        await assert_feature(user, "commissions")
        data = await reports_commission(user=user, preset=preset, from_date=from_date, to_date=to_date, status=status, staff_id=staff_id, role=role)
        return _xlsx("commission", data, preset, from_date, to_date, status=status, staff_id=staff_id, role=role)

    @api.get("/reports/appointments/export")
    async def reports_appointments_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        treatment: Optional[str] = None,
    ):
        assert_report_access(user, "appointments")
        await _assert_reports_feature(user, "appointments")
        data = await reports_appointments(user=user, preset=preset, from_date=from_date, to_date=to_date, staff_id=staff_id, treatment=treatment)
        return _xlsx("appointments", data, preset, from_date, to_date, staff_id=staff_id, treatment=treatment)

    @api.get("/reports/patients/export")
    async def reports_patients_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "patients")
        await _assert_reports_feature(user, "patients")
        data = await reports_patients(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("patients", data, preset, from_date, to_date)

    @api.get("/reports/consent/export")
    async def reports_consent_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "consent")
        await _assert_reports_feature(user, "consent")
        data = await reports_consent(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("consent", data, preset, from_date, to_date)

    @api.get("/reports/gift-cards")
    async def reports_gift_cards(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "gift-cards")
        await _assert_reports_feature(user, "gift-cards")
        from gift_card_reports import aggregate_gift_card_report

        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        data = await aggregate_gift_card_report(db, user["clinic_id"], start_iso, end_iso)
        return {"range": range_meta(start_iso, end_iso, from_str, to_str, preset), **data}

    @api.get("/reports/gift-cards/export")
    async def reports_gift_cards_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "gift-cards")
        await _assert_reports_feature(user, "gift-cards")
        data = await reports_gift_cards(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("gift-cards", data, preset, from_date, to_date)

    @api.get("/reports/prepaid")
    async def reports_prepaid(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "prepaid")
        await _assert_reports_feature(user, "prepaid")
        from prepaid_reports import aggregate_prepaid_report

        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        data = await aggregate_prepaid_report(db, user["clinic_id"], start_iso, end_iso)
        return {"range": range_meta(start_iso, end_iso, from_str, to_str, preset), **data}

    @api.get("/reports/prepaid/export")
    async def reports_prepaid_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        assert_report_access(user, "prepaid")
        await _assert_reports_feature(user, "prepaid")
        data = await reports_prepaid(user=user, preset=preset, from_date=from_date, to_date=to_date)
        return _xlsx("prepaid", data, preset, from_date, to_date)

    return api
