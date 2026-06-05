"""ClinicOS Analytics v1 — marketing, treatment, and operational summaries."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from patient_profile import PATIENT_SOURCE_VALUES
from reports_common import (
    assert_analytics_access,
    item_cash_revenue,
    item_performers,
    item_service_value,
    load_clinic_timezone,
    marketing_bucket,
    marketing_label,
    range_meta,
    resolve_date_range,
    to_clinic_local,
    ts_in_range,
)

UNKNOWN_KEY = "__unknown__"
BOTTOM_MIN_SESSIONS = 2

PATIENT_SOURCE_LABELS = {
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "facebook": "Facebook",
    "google": "Google",
    "website": "Website",
    "referral": "Referral",
    "walk_in": "Walk-in",
    "whatsapp": "WhatsApp",
    "hotel_villa": "Hotel / Villa",
    "other": "Other",
    UNKNOWN_KEY: "Unknown / Not recorded",
}

DOW_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

MARKETING_DISCLAIMERS = [
    "Nationality and patient source are optional. Many patients may not have these recorded.",
    "Revenue is attributed using the patient's current profile values, not values at time of payment.",
    "Unknown / Not recorded is not the same as Walk-in.",
    "Do not use these figures alone for ad budget decisions until source coverage is consistently high.",
]

TREATMENT_DISCLAIMERS = [
    "Session count is based on paid/partial invoice treatment lines in range.",
    "Package-paid treatments contribute service value, not cash revenue.",
    f"Bottom performers require at least {BOTTOM_MIN_SESSIONS} sessions in range.",
]

OPERATIONAL_DISCLAIMERS = [
    "Day-of-week is calculated in the clinic timezone.",
    "Blocked time appointments are excluded from volume metrics.",
]

GLOBAL_DISCLAIMER = "Analytics summarizes existing clinic data. Figures are read-only and do not change billing or patient records."


async def _load_invoices(db, cid: str, start_iso: str, end_iso: str) -> List[dict]:
    return await db.invoices.find(
        {"clinic_id": cid, "created_at": {"$gte": start_iso, "$lte": end_iso}},
        {"_id": 0},
    ).to_list(10000)


async def _load_paid_invoices_by_paid_at(db, cid: str, start_iso: str, end_iso: str) -> List[dict]:
    rows = await db.invoices.find(
        {"clinic_id": cid, "payment_status": {"$in": ["paid", "partial"]}},
        {"_id": 0},
    ).to_list(10000)
    out = []
    for inv in rows:
        ref = inv.get("paid_at") or inv.get("updated_at") or inv.get("created_at")
        if ts_in_range(ref, start_iso, end_iso):
            out.append(inv)
    return out


def _nationality_key(patient: Optional[dict]) -> str:
    if not patient:
        return UNKNOWN_KEY
    code = (patient.get("nationality_code") or "").strip()
    if code:
        return code.upper()
    name = (patient.get("nationality") or "").strip()
    return name if name else UNKNOWN_KEY


def _nationality_label(key: str, patient: Optional[dict] = None) -> str:
    if key == UNKNOWN_KEY:
        return PATIENT_SOURCE_LABELS[UNKNOWN_KEY]
    if patient and (patient.get("nationality") or "").strip():
        return patient["nationality"].strip()
    return key


def _has_nationality(patient: dict) -> bool:
    return bool((patient.get("nationality") or "").strip() or (patient.get("nationality_code") or "").strip())


def compute_completeness(patients: List[dict]) -> dict:
    total = len(patients)
    with_nat = sum(1 for p in patients if _has_nationality(p))
    with_src = sum(1 for p in patients if (p.get("patient_source") or "").strip())
    with_both = sum(
        1 for p in patients
        if _has_nationality(p) and (p.get("patient_source") or "").strip()
    )
    return {
        "denominator_label": "Active patient records",
        "total_patients": total,
        "with_nationality": with_nat,
        "with_nationality_pct": round(100 * with_nat / total, 1) if total else 0,
        "with_patient_source": with_src,
        "with_patient_source_pct": round(100 * with_src / total, 1) if total else 0,
        "with_both": with_both,
        "with_both_pct": round(100 * with_both / total, 1) if total else 0,
    }


def _patient_matches_filters(
    patient: Optional[dict],
    nationalities: Optional[List[str]] = None,
    patient_sources: Optional[List[str]] = None,
) -> bool:
    if not nationalities and not patient_sources:
        return True
    if not patient:
        if nationalities and UNKNOWN_KEY not in nationalities:
            return False
        if patient_sources and UNKNOWN_KEY not in patient_sources:
            return False
        return bool(nationalities or patient_sources)
    if nationalities:
        nat_key = _nationality_key(patient)
        if nat_key not in nationalities:
            return False
    if patient_sources:
        src_key = marketing_bucket(patient.get("patient_source"))
        if src_key not in patient_sources:
            return False
    return True


def _invoice_has_treatment(inv: dict, treatment: Optional[str]) -> bool:
    if not treatment:
        return True
    for it in inv.get("items") or []:
        if it.get("item_type") == "treatment" and (it.get("name") or "") == treatment:
            return True
    return False


def _pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0


async def build_marketing_analytics(
    db,
    cid: str,
    start_iso: str,
    end_iso: str,
    from_str: str,
    to_str: str,
    preset: Optional[str],
    timezone: str,
    nationalities: Optional[List[str]] = None,
    patient_sources: Optional[List[str]] = None,
    treatment: Optional[str] = None,
) -> dict:
    patients = await db.patients.find(
        {"clinic_id": cid},
        {"_id": 0, "id": 1, "full_name": 1, "nationality": 1, "nationality_code": 1,
         "patient_source": 1, "source_detail": 1, "created_at": 1},
    ).to_list(20000)
    patient_map = {p["id"]: p for p in patients}

    nat_counts: Dict[str, int] = defaultdict(int)
    nat_labels: Dict[str, str] = {}
    source_counts: Dict[str, int] = {k: 0 for k in PATIENT_SOURCE_VALUES}
    source_counts[UNKNOWN_KEY] = 0

    for p in patients:
        nat_key = _nationality_key(p)
        if nat_key != UNKNOWN_KEY:
            nat_counts[nat_key] += 1
            nat_labels[nat_key] = _nationality_label(nat_key, p)
        src_key = marketing_bucket(p.get("patient_source"))
        source_counts[src_key] = source_counts.get(src_key, 0) + 1

    known_nat_total = sum(nat_counts.values())
    top_nationalities = []
    for key, count in sorted(nat_counts.items(), key=lambda x: -x[1])[:5]:
        top_nationalities.append({
            "key": key,
            "label": nat_labels.get(key, key),
            "patient_count": count,
            "pct_of_known": _pct(count, known_nat_total),
            "pct_of_all": _pct(count, len(patients)),
        })

    total_patients = len(patients)
    patient_source_breakdown = []
    for key in sorted(source_counts.keys(), key=lambda k: (-source_counts[k], k)):
        if key == UNKNOWN_KEY or source_counts[key] > 0:
            known_src_total = sum(
                c for k, c in source_counts.items() if k != UNKNOWN_KEY
            )
            count = source_counts[key]
            patient_source_breakdown.append({
                "key": key,
                "label": marketing_label(key, PATIENT_SOURCE_LABELS),
                "patient_count": count,
                "pct_of_known": _pct(count, known_src_total) if key != UNKNOWN_KEY else 0,
                "pct_of_all": _pct(count, total_patients),
            })

    new_patients = [p for p in patients if ts_in_range(p.get("created_at"), start_iso, end_iso)]
    new_ids = {p["id"] for p in new_patients}
    new_by_source: Dict[str, int] = defaultdict(int)
    for p in new_patients:
        new_by_source[marketing_bucket(p.get("patient_source"))] += 1

    paid_invoices = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
    revenue_by_source: Dict[str, int] = defaultdict(int)
    revenue_by_nat: Dict[str, int] = defaultdict(int)
    source_invoice_count: Dict[str, int] = defaultdict(int)
    nat_invoice_count: Dict[str, int] = defaultdict(int)
    total_paid = 0
    attributed = 0

    returning_ids: Set[str] = set()
    for inv in paid_invoices:
        if inv.get("payment_status") != "paid":
            continue
        if treatment and not _invoice_has_treatment(inv, treatment):
            continue
        pid = inv.get("patient_id")
        patient = patient_map.get(pid) if pid else None
        if not _patient_matches_filters(patient, nationalities, patient_sources):
            continue
        amount = int(inv.get("amount_paid") or 0)
        total_paid += amount
        src_key = marketing_bucket(patient.get("patient_source") if patient else None)
        nat_key = _nationality_key(patient)
        revenue_by_source[src_key] += amount
        revenue_by_nat[nat_key] += amount
        source_invoice_count[src_key] += 1
        nat_invoice_count[nat_key] += 1
        if src_key != UNKNOWN_KEY or nat_key != UNKNOWN_KEY:
            attributed += amount
        if pid and pid not in new_ids and patient and (patient.get("created_at") or "") < start_iso:
            returning_ids.add(pid)

    def _revenue_rows(rev_map: Dict[str, int], count_map: Dict[str, int], label_fn) -> List[dict]:
        rows = []
        for key, rev in sorted(rev_map.items(), key=lambda x: -x[1]):
            rows.append({
                "key": key,
                "label": label_fn(key),
                "revenue_idr": rev,
                "invoice_count": count_map.get(key, 0),
                "pct_of_attributed": _pct(rev, attributed) if attributed else 0,
            })
        return rows

    source_detail_samples = []
    detail_counts: Dict[Tuple[str, str], int] = defaultdict(int)
    for p in patients:
        detail = (p.get("source_detail") or "").strip()
        src = marketing_bucket(p.get("patient_source"))
        if detail and src != UNKNOWN_KEY:
            detail_counts[(src, detail)] += 1
    for (src, detail), count in sorted(detail_counts.items(), key=lambda x: -x[1])[:20]:
        source_detail_samples.append({
            "patient_source": src,
            "source_detail": detail,
            "count": count,
        })

    unattributed = total_paid - attributed if total_paid >= attributed else 0

    return {
        "range": {**range_meta(start_iso, end_iso, from_str, to_str, preset), "timezone": timezone},
        "disclaimers": [GLOBAL_DISCLAIMER, *MARKETING_DISCLAIMERS],
        "data_completeness": compute_completeness(patients),
        "summary": {
            "new_patients": len(new_patients),
            "new_patients_with_source": sum(
                1 for p in new_patients if (p.get("patient_source") or "").strip()
            ),
            "returning_patients": len(returning_ids),
            "paid_revenue_idr": total_paid,
            "attributed_revenue_idr": attributed,
            "unattributed_revenue_idr": unattributed,
        },
        "new_vs_returning": {
            "new_patients": len(new_patients),
            "returning_patients": len(returning_ids),
            "note": "Returning = unique patients with paid revenue in range who existed before the range start.",
        },
        "top_nationalities": top_nationalities,
        "patient_source_breakdown": patient_source_breakdown,
        "revenue_by_patient_source": _revenue_rows(
            revenue_by_source, source_invoice_count,
            lambda k: marketing_label(k, PATIENT_SOURCE_LABELS),
        ),
        "revenue_by_nationality": _revenue_rows(
            revenue_by_nat, nat_invoice_count,
            lambda k: PATIENT_SOURCE_LABELS[UNKNOWN_KEY] if k == UNKNOWN_KEY else (
                nat_labels.get(k) or k
            ),
        ),
        "new_patients_by_source": [
            {
                "key": k,
                "label": marketing_label(k, PATIENT_SOURCE_LABELS),
                "count": v,
            }
            for k, v in sorted(new_by_source.items(), key=lambda x: -x[1])
        ],
        "source_detail_samples": source_detail_samples,
        "filters_applied": {
            "nationality": nationalities or [],
            "patient_source": patient_sources or [],
            "treatment": treatment,
        },
    }


async def build_treatment_analytics(
    db,
    cid: str,
    start_iso: str,
    end_iso: str,
    from_str: str,
    to_str: str,
    preset: Optional[str],
    timezone: str,
    category: Optional[str] = None,
    treatment: Optional[str] = None,
    staff_id: Optional[str] = None,
) -> dict:
    by_name_count: Dict[str, int] = defaultdict(int)
    by_name_revenue: Dict[str, int] = defaultdict(int)
    by_name_package: Dict[str, int] = defaultdict(int)
    catalog_ids: Dict[str, Optional[str]] = {}

    invoices = await _load_invoices(db, cid, start_iso, end_iso)
    total_sessions = 0
    for inv in invoices:
        if inv.get("payment_status") not in ("paid", "partial"):
            continue
        for it in inv.get("items") or []:
            if it.get("item_type") != "treatment":
                continue
            if category and (it.get("category") or "") != category:
                continue
            if treatment and (it.get("name") or "") != treatment:
                continue
            performers = item_performers(it)
            if staff_id and not any(p.get("staff_id") == staff_id for p in performers):
                continue
            name = it.get("name") or "—"
            qty = int(it.get("quantity") or 1)
            total_sessions += qty
            by_name_count[name] += qty
            by_name_revenue[name] += item_cash_revenue(it)
            if it.get("paid_by") == "package":
                by_name_package[name] += item_service_value(it)
            if name not in catalog_ids:
                catalog_ids[name] = it.get("catalog_id")

    def _row(name: str, sessions: int, revenue: int) -> dict:
        return {
            "name": name,
            "catalog_id": catalog_ids.get(name),
            "sessions": sessions,
            "revenue_idr": revenue,
            "package_value_idr": by_name_package.get(name, 0),
        }

    top_by_sessions = [_row(n, c, by_name_revenue.get(n, 0))
                       for n, c in sorted(by_name_count.items(), key=lambda x: -x[1])[:5]]
    top_by_revenue = [_row(n, by_name_count.get(n, 0), r)
                      for n, r in sorted(by_name_revenue.items(), key=lambda x: -x[1])[:5]]
    eligible = [(n, c) for n, c in by_name_count.items() if c >= BOTTOM_MIN_SESSIONS]
    bottom_by_sessions = [
        {**_row(n, c, by_name_revenue.get(n, 0)), "below_threshold": False}
        for n, c in sorted(eligible, key=lambda x: x[1])[:5]
    ]

    revenue_by_treatment = [
        _row(n, by_name_count.get(n, 0), by_name_revenue.get(n, 0))
        for n, _ in sorted(by_name_revenue.items(), key=lambda x: -x[1])[:50]
    ]
    package_delivered = [
        {"name": n, "sessions": by_name_count.get(n, 0), "package_value_idr": v}
        for n, v in sorted(by_name_package.items(), key=lambda x: -x[1]) if v > 0
    ]

    return {
        "range": {**range_meta(start_iso, end_iso, from_str, to_str, preset), "timezone": timezone},
        "disclaimers": [GLOBAL_DISCLAIMER, *TREATMENT_DISCLAIMERS],
        "summary": {
            "total_sessions": total_sessions,
            "total_treatment_revenue_idr": sum(by_name_revenue.values()),
            "package_delivered_value_idr": sum(by_name_package.values()),
            "unique_treatments": len(by_name_count),
        },
        "top_by_sessions": top_by_sessions,
        "top_by_revenue": top_by_revenue,
        "bottom_by_sessions": bottom_by_sessions,
        "revenue_by_treatment": revenue_by_treatment,
        "package_delivered_by_treatment": package_delivered[:30],
        "thresholds": {"bottom_min_sessions": BOTTOM_MIN_SESSIONS},
        "filters_applied": {
            "category": category,
            "treatment": treatment,
            "staff_id": staff_id,
        },
    }


async def build_operational_analytics(
    db,
    cid: str,
    start_iso: str,
    end_iso: str,
    from_str: str,
    to_str: str,
    preset: Optional[str],
    timezone: str,
    staff_id: Optional[str] = None,
    treatment: Optional[str] = None,
) -> dict:
    bookings = await db.bookings.find(
        {
            "clinic_id": cid,
            "booking_type": {"$ne": "block"},
            "status": {"$ne": "blocked"},
            "scheduled_at": {"$gte": start_iso, "$lte": end_iso},
        },
        {"_id": 0, "scheduled_at": 1, "status": 1, "treatment": 1, "performers": 1},
    ).to_list(20000)

    by_dow: Dict[int, int] = defaultdict(int)
    by_status: Dict[str, int] = defaultdict(int)

    for b in bookings:
        if treatment and (b.get("treatment") or "") != treatment:
            continue
        if staff_id:
            performers = b.get("performers") or []
            if not any(p.get("staff_id") == staff_id for p in performers):
                if b.get("performer_id") != staff_id:
                    continue
        by_status[b.get("status") or "booked"] += 1
        local_dt = to_clinic_local(b.get("scheduled_at"), timezone)
        if local_dt:
            by_dow[local_dt.weekday()] += 1

    paid_invoices = await _load_paid_invoices_by_paid_at(db, cid, start_iso, end_iso)
    revenue_by_dow: Dict[int, int] = defaultdict(int)
    total_paid = 0
    for inv in paid_invoices:
        if inv.get("payment_status") != "paid":
            continue
        if treatment and not _invoice_has_treatment(inv, treatment):
            continue
        amount = int(inv.get("amount_paid") or 0)
        total_paid += amount
        ref = inv.get("paid_at") or inv.get("updated_at") or inv.get("created_at")
        local_dt = to_clinic_local(ref, timezone)
        if local_dt:
            revenue_by_dow[local_dt.weekday()] += amount

    appointments_by_dow = [
        {"dow": i, "label": DOW_LABELS[i], "count": by_dow.get(i, 0)}
        for i in range(7)
    ]
    revenue_dow_rows = [
        {"dow": i, "label": DOW_LABELS[i], "revenue_idr": revenue_by_dow.get(i, 0)}
        for i in range(7)
    ]

    busiest_i = max(range(7), key=lambda i: by_dow.get(i, 0)) if by_dow else 0
    quietest_i = min(range(7), key=lambda i: by_dow.get(i, 0)) if by_dow else 0

    rescheduled = await db.audit_logs.count_documents({
        "clinic_id": cid,
        "module": "appointment",
        "action": "rescheduled",
        "created_at": {"$gte": start_iso, "$lte": end_iso},
    })

    return {
        "range": {**range_meta(start_iso, end_iso, from_str, to_str, preset), "timezone": timezone},
        "disclaimers": [GLOBAL_DISCLAIMER, *OPERATIONAL_DISCLAIMERS],
        "summary": {
            "total_appointments": sum(by_status.values()),
            "completed": by_status.get("completed", 0),
            "cancelled": by_status.get("cancelled", 0),
            "no_show": by_status.get("no_show", 0),
            "booked_or_confirmed": (
                by_status.get("booked", 0) + by_status.get("confirmed", 0)
                + by_status.get("checked_in", 0)
            ),
            "rescheduled": rescheduled,
            "busiest_day": DOW_LABELS[busiest_i],
            "quietest_day": DOW_LABELS[quietest_i],
            "paid_revenue_idr": total_paid,
        },
        "appointments_by_day_of_week": appointments_by_dow,
        "appointments_by_status": [
            {"status": k, "count": v}
            for k, v in sorted(by_status.items(), key=lambda x: -x[1])
        ],
        "revenue_by_day_of_week": revenue_dow_rows,
        "filters_applied": {
            "staff_id": staff_id,
            "treatment": treatment,
        },
    }


def register_clinic_analytics(
    api: APIRouter,
    db,
    get_current_user,
    assert_feature,
):
    async def _assert_analytics_feature(user: dict) -> None:
        await assert_feature(user, "reports")

    def _xlsx(section: str, data: dict, preset: Optional[str], from_date: Optional[str], to_date: Optional[str], **filters: Any):
        from report_excel import xlsx_response
        from report_exports import EXPORTERS, _filters_dict

        flt = _filters_dict(preset=preset, from_date=from_date, to_date=to_date, **filters)
        content = EXPORTERS[section](data, flt)
        r = data.get("range") or {}
        return xlsx_response(f"{section}-{r.get('from', 'range')}-{r.get('to', '')}", content)

    async def _tz_and_range(user, preset, from_date, to_date):
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        tz = await load_clinic_timezone(db, user.get("clinic_id"))
        return start_iso, end_iso, from_str, to_str, preset, tz

    @api.get("/reports/analytics/marketing")
    async def analytics_marketing(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        nationality: Optional[List[str]] = Query(None),
        patient_source: Optional[List[str]] = Query(None),
        treatment: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        start_iso, end_iso, from_str, to_str, preset, tz = await _tz_and_range(
            user, preset, from_date, to_date
        )
        if patient_source:
            for src in patient_source:
                if src != UNKNOWN_KEY and src not in PATIENT_SOURCE_VALUES:
                    raise HTTPException(status_code=400, detail=f"Invalid patient source: {src}")
        return await build_marketing_analytics(
            db, user.get("clinic_id"), start_iso, end_iso, from_str, to_str, preset, tz,
            nationalities=nationality, patient_sources=patient_source, treatment=treatment,
        )

    @api.get("/reports/analytics/marketing/export")
    async def analytics_marketing_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        nationality: Optional[List[str]] = Query(None),
        patient_source: Optional[List[str]] = Query(None),
        treatment: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        data = await analytics_marketing(
            user=user, preset=preset, from_date=from_date, to_date=to_date,
            nationality=nationality, patient_source=patient_source, treatment=treatment,
        )
        return _xlsx("analytics-marketing", data, preset, from_date, to_date,
                     nationality=nationality, patient_source=patient_source, treatment=treatment)

    @api.get("/reports/analytics/treatments")
    async def analytics_treatments(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        category: Optional[str] = None,
        treatment: Optional[str] = None,
        staff_id: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        start_iso, end_iso, from_str, to_str, preset, tz = await _tz_and_range(
            user, preset, from_date, to_date
        )
        return await build_treatment_analytics(
            db, user.get("clinic_id"), start_iso, end_iso, from_str, to_str, preset, tz,
            category=category, treatment=treatment, staff_id=staff_id,
        )

    @api.get("/reports/analytics/treatments/export")
    async def analytics_treatments_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        category: Optional[str] = None,
        treatment: Optional[str] = None,
        staff_id: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        data = await analytics_treatments(
            user=user, preset=preset, from_date=from_date, to_date=to_date,
            category=category, treatment=treatment, staff_id=staff_id,
        )
        return _xlsx("analytics-treatments", data, preset, from_date, to_date,
                     category=category, treatment=treatment, staff_id=staff_id)

    @api.get("/reports/analytics/operational")
    async def analytics_operational(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        treatment: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        start_iso, end_iso, from_str, to_str, preset, tz = await _tz_and_range(
            user, preset, from_date, to_date
        )
        return await build_operational_analytics(
            db, user.get("clinic_id"), start_iso, end_iso, from_str, to_str, preset, tz,
            staff_id=staff_id, treatment=treatment,
        )

    @api.get("/reports/analytics/operational/export")
    async def analytics_operational_export(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        staff_id: Optional[str] = None,
        treatment: Optional[str] = None,
    ):
        assert_analytics_access(user)
        await _assert_analytics_feature(user)
        data = await analytics_operational(
            user=user, preset=preset, from_date=from_date, to_date=to_date,
            staff_id=staff_id, treatment=treatment,
        )
        return _xlsx("analytics-operational", data, preset, from_date, to_date,
                     staff_id=staff_id, treatment=treatment)

    return api
