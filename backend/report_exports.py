"""Map report API payloads to Excel workbooks."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from report_excel import build_report_workbook, dict_rows, kv_rows, summary_from_dict


def _filters_dict(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if preset:
        out["preset"] = preset
    if from_date:
        out["from"] = from_date
    if to_date:
        out["to"] = to_date
    for k, v in kwargs.items():
        if v is not None and v != "" and v != "all":
            out[k] = v
    return out


def _tbl(
    name: str,
    title: str,
    items: List[dict],
    key: str,
    val: str,
    key_label: str,
    val_label: str,
) -> dict:
    headers, rows = kv_rows(items, key, val, key_label, val_label)
    return {"name": name, "title": title, "headers": headers, "rows": rows}


def export_overview(data: dict, filters: Optional[dict] = None) -> bytes:
    charts = data.get("charts") or {}
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("Revenue trend", "Revenue trend (paid invoices)", charts.get("revenue_trend") or [], "date", "revenue_idr", "Date", "Revenue IDR"),
        _tbl("Payment methods", "Revenue by payment method", charts.get("revenue_by_payment_method") or [], "method", "revenue_idr", "Method", "Revenue IDR"),
        _tbl("Top treatments", "Top treatments by revenue (cash)", charts.get("top_treatments") or [], "name", "revenue_idr", "Treatment", "Revenue IDR"),
        _tbl("Package usage", "Package usage (not new revenue)", charts.get("package_usage") or [], "treatment", "count", "Treatment", "Sessions used"),
        _tbl("Appointments", "Appointment status", charts.get("appointment_status") or [], "status", "count", "Status", "Count"),
        _tbl("Visits", "Visit status", charts.get("visit_status") or [], "status", "count", "Status", "Count"),
        _tbl("Commission", "Commission by status (existing records)", charts.get("commission_status") or [], "status", "amount_idr", "Status", "Amount IDR"),
    ]
    return build_report_workbook("Overview Report", data.get("range") or {}, filters, summary, sheets)


def export_revenue(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = [
        ("Total paid revenue IDR", data.get("total_paid_revenue_idr")),
        ("Unpaid amount IDR", data.get("unpaid_amount_idr")),
        ("Partial paid IDR", data.get("partial_paid_idr")),
        ("Invoice count", data.get("invoice_count")),
        ("Average invoice IDR", data.get("average_invoice_value_idr")),
        ("Package purchase revenue IDR", data.get("package_purchase_revenue_idr")),
        ("Package usage value IDR (not cash)", data.get("package_usage_service_value_idr")),
    ]
    sheets = [
        _tbl("By date", "Revenue by date", data.get("by_date") or [], "date", "revenue_idr", "Date", "Revenue IDR"),
        _tbl("By method", "By payment method", data.get("by_payment_method") or [], "method", "revenue_idr", "Method", "Revenue IDR"),
        _tbl("By treatment", "By treatment", data.get("by_treatment") or [], "name", "revenue_idr", "Treatment", "Revenue IDR"),
        _tbl("By item type", "By item type", data.get("by_item_type") or [], "item_type", "revenue_idr", "Item type", "Revenue IDR"),
        _tbl("Associated revenue", "Associated revenue by performer (not clinic total)", data.get("performer_associated_revenue") or [], "performer", "associated_revenue_idr", "Performer", "Associated revenue IDR"),
    ]
    return build_report_workbook("Revenue Report", data.get("range") or {}, filters, summary, sheets)


def export_billing(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    inv_headers, inv_rows = dict_rows(
        data.get("invoices") or [],
        [
            ("invoice_number", "Invoice #"),
            ("patient_name", "Patient"),
            ("date", "Date"),
            ("total_idr", "Total IDR"),
            ("paid_idr", "Paid IDR"),
            ("remaining_idr", "Remaining IDR"),
            ("status", "Status"),
            ("payment_method", "Payment method"),
        ],
    )
    sheets = [
        {"name": "Invoices", "title": "Invoice list", "headers": inv_headers, "rows": inv_rows},
        _tbl("Payment methods", "Payment method summary", data.get("by_payment_method") or [], "method", "amount_idr", "Method", "Amount IDR"),
        _tbl("Discounts", "Discount by reason", data.get("discount_by_reason") or [], "reason", "amount_idr", "Reason", "Amount IDR"),
    ]
    return build_report_workbook("Billing Report", data.get("range") or {}, filters, summary, sheets)


def export_packages(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("Usage by treatment", "Package usage by treatment", data.get("usage_by_treatment") or [], "treatment", "count", "Treatment", "Count"),
        _tbl("Usage by date", "Package usage by date", data.get("usage_by_date") or [], "date", "count", "Date", "Count"),
        _tbl("Components", "Bundle component usage", data.get("component_usage") or [], "component", "count", "Component", "Count"),
        _tbl("Expiring", "Expiring soon", data.get("expiring_soon") or [], "name", "expiry_date", "Package", "Expiry"),
    ]
    return build_report_workbook("Package Report", data.get("range") or {}, filters, summary, sheets)


def export_treatments(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("By category", "By category", data.get("by_category") or [], "category", "count", "Category", "Count"),
        _tbl("By performer", "By performer", data.get("by_performer") or [], "performer", "count", "Performer", "Count"),
        _tbl("Top by count", "Top by count", data.get("top_by_count") or [], "name", "count", "Treatment", "Count"),
        _tbl("Top by revenue", "Top by revenue (cash)", data.get("top_by_revenue") or [], "name", "revenue_idr", "Treatment", "Revenue IDR"),
    ]
    return build_report_workbook("Treatment Report", data.get("range") or {}, filters, summary, sheets)


def export_staff(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("Appointments", "Appointments by staff", data.get("appointments_by_staff") or [], "staff", "count", "Staff", "Count"),
        _tbl("Visits", "Visits by staff", data.get("visits_by_staff") or [], "staff", "count", "Staff", "Count"),
        _tbl("Associated revenue", "Associated revenue by staff", data.get("associated_revenue_by_staff") or [], "staff", "associated_revenue_idr", "Staff", "Associated revenue IDR"),
        _tbl("Commission", "Commission by staff", data.get("commission_by_staff") or [], "staff", "commission_idr", "Staff", "Commission IDR"),
    ]
    return build_report_workbook("Staff Report", data.get("range") or {}, filters, summary, sheets)


def export_commission(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    rec_headers, rec_rows = dict_rows(
        data.get("records") or [],
        [
            ("staff_name_snapshot", "Staff"),
            ("item_name_snapshot", "Item"),
            ("commission_amount", "Amount IDR"),
            ("status", "Status"),
            ("created_at", "Created"),
        ],
    )
    sheets = [
        {"name": "Records", "title": "Commission records (source data)", "headers": rec_headers, "rows": rec_rows},
        _tbl("By role", "By role", data.get("by_role") or [], "role", "commission_idr", "Role", "Commission IDR"),
        _tbl("By treatment", "By treatment", data.get("by_treatment") or [], "treatment", "commission_idr", "Treatment", "Commission IDR"),
    ]
    return build_report_workbook("Commission Report", data.get("range") or {}, filters, summary, sheets)


def export_appointments(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("By status", "Appointments by status", data.get("by_status") or [], "status", "count", "Status", "Count"),
        _tbl("By treatment", "By treatment", data.get("by_treatment") or [], "treatment", "count", "Treatment", "Count"),
        _tbl("By performer", "By performer", data.get("by_performer") or [], "performer", "count", "Performer", "Count"),
    ]
    return build_report_workbook("Appointments & Visits Report", data.get("range") or {}, filters, summary, sheets)


def export_patients(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("New patients", "New patients", data.get("new_patients") or [], "name", "date", "Name", "Date"),
        _tbl("Top spending", "Top spending", data.get("top_spending") or [], "patient_name", "spent_idr", "Patient", "Spent IDR"),
    ]
    return build_report_workbook("Patient Report", data.get("range") or {}, filters, summary, sheets)


def export_consent(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    form_headers, form_rows = dict_rows(
        data.get("consent_forms") or [],
        [
            ("patient_name", "Patient"),
            ("template_name_snapshot", "Template"),
            ("status", "Status"),
            ("created_at", "Created"),
        ],
    )
    sheets = [
        _tbl("Consent status", "Consent by status", data.get("consent_by_status") or [], "status", "count", "Status", "Count"),
        {"name": "Forms", "title": "Consent forms", "headers": form_headers, "rows": form_rows},
    ]
    return build_report_workbook("Consent & Clinical Report", data.get("range") or {}, filters, summary, sheets)


def export_audit(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    log_headers, log_rows = dict_rows(
        data.get("logs") or [],
        [
            ("created_at", "Time"),
            ("user_email", "User"),
            ("user_role", "Role"),
            ("action", "Action"),
            ("module", "Module"),
            ("record_id", "Record ID"),
        ],
    )
    sheets = [
        {"name": "Audit log", "title": "Audit events", "headers": log_headers, "rows": log_rows},
        _tbl("By module", "By module", data.get("by_module") or [], "module", "count", "Module", "Count"),
    ]
    return build_report_workbook("Audit Log Report", data.get("range") or {}, filters, summary, sheets)


def export_gift_cards(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    status_headers, status_rows = kv_rows(
        data.get("by_status") or [],
        "status",
        "count",
        "Status",
        "Count",
    )
    red_headers, red_rows = dict_rows(
        data.get("redemptions") or [],
        [
            ("created_at", "Date"),
            ("gift_card_code", "Code"),
            ("amount_redeemed", "Amount IDR"),
            ("balance_after", "Balance after"),
            ("reference_type", "Reference type"),
            ("reference_id", "Reference ID"),
            ("redeemed_by_name_snapshot", "Redeemed by"),
        ],
    )
    sheets = [
        {"name": "By status", "title": "Cards by status", "headers": status_headers, "rows": status_rows},
        {"name": "Redemptions", "title": "Redemption history", "headers": red_headers, "rows": red_rows},
    ]
    return build_report_workbook("Gift Card Report", data.get("range") or {}, filters, summary, sheets)


def export_prepaid(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    status_headers, status_rows = kv_rows(
        data.get("by_status") or [],
        "status",
        "count",
        "Status",
        "Count",
    )
    red_headers, red_rows = dict_rows(
        data.get("redemptions") or [],
        [
            ("created_at", "Date"),
            ("prepaid_code", "Code"),
            ("amount_redeemed_idr", "Amount IDR"),
            ("balance_after_idr", "Balance after"),
            ("reference_type", "Reference type"),
            ("reference_id", "Reference ID"),
            ("created_by_name_snapshot", "Redeemed by"),
        ],
    )
    sheets = [
        {"name": "By status", "title": "Prepaid by status", "headers": status_headers, "rows": status_rows},
        {"name": "Redemptions", "title": "Redemption history", "headers": red_headers, "rows": red_rows},
    ]
    return build_report_workbook("Prepaid Report", data.get("range") or {}, filters, summary, sheets)


def export_analytics_marketing(data: dict, filters: Optional[dict] = None) -> bytes:
    completeness = data.get("data_completeness") or {}
    summary = summary_from_dict(data.get("summary") or {})
    summary.extend([
        ("Patients with nationality %", completeness.get("with_nationality_pct")),
        ("Patients with source %", completeness.get("with_patient_source_pct")),
    ])
    sheets = [
        _tbl("Top nationalities", "Top nationalities", data.get("top_nationalities") or [], "label", "patient_count", "Nationality", "Patients"),
        _tbl("Patient sources", "Patient source breakdown", data.get("patient_source_breakdown") or [], "label", "patient_count", "Source", "Patients"),
        _tbl("Revenue by source", "Revenue by patient source", data.get("revenue_by_patient_source") or [], "label", "revenue_idr", "Source", "Revenue IDR"),
        _tbl("Revenue by nationality", "Revenue by nationality", data.get("revenue_by_nationality") or [], "label", "revenue_idr", "Nationality", "Revenue IDR"),
        _tbl("New by source", "New patients by source", data.get("new_patients_by_source") or [], "label", "count", "Source", "Count"),
    ]
    return build_report_workbook("Marketing Analytics", data.get("range") or {}, filters, summary, sheets)


def export_analytics_treatments(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("Top sessions", "Top treatments by sessions", data.get("top_by_sessions") or [], "name", "sessions", "Treatment", "Sessions"),
        _tbl("Top revenue", "Top treatments by revenue", data.get("top_by_revenue") or [], "name", "revenue_idr", "Treatment", "Revenue IDR"),
        _tbl("Bottom sessions", "Bottom treatments by sessions", data.get("bottom_by_sessions") or [], "name", "sessions", "Treatment", "Sessions"),
        _tbl("Revenue table", "Revenue by treatment", data.get("revenue_by_treatment") or [], "name", "revenue_idr", "Treatment", "Revenue IDR"),
        _tbl("Package value", "Package-delivered value", data.get("package_delivered_by_treatment") or [], "name", "package_value_idr", "Treatment", "Value IDR"),
    ]
    return build_report_workbook("Treatment Analytics", data.get("range") or {}, filters, summary, sheets)


def export_analytics_operational(data: dict, filters: Optional[dict] = None) -> bytes:
    summary = summary_from_dict(data.get("summary") or {})
    sheets = [
        _tbl("By day", "Appointments by day of week", data.get("appointments_by_day_of_week") or [], "label", "count", "Day", "Appointments"),
        _tbl("By status", "Appointments by status", data.get("appointments_by_status") or [], "status", "count", "Status", "Count"),
        _tbl("Revenue by day", "Revenue by day of week", data.get("revenue_by_day_of_week") or [], "label", "revenue_idr", "Day", "Revenue IDR"),
    ]
    return build_report_workbook("Operational Analytics", data.get("range") or {}, filters, summary, sheets)


EXPORTERS = {
    "overview": export_overview,
    "revenue": export_revenue,
    "billing": export_billing,
    "packages": export_packages,
    "treatments": export_treatments,
    "staff": export_staff,
    "commission": export_commission,
    "appointments": export_appointments,
    "patients": export_patients,
    "consent": export_consent,
    "audit": export_audit,
    "gift-cards": export_gift_cards,
    "prepaid": export_prepaid,
    "analytics-marketing": export_analytics_marketing,
    "analytics-treatments": export_analytics_treatments,
    "analytics-operational": export_analytics_operational,
}
