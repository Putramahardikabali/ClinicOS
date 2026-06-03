"""Phase 1 commission rules and records — per invoice item, performer-based."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response as FastResponse
from pydantic import BaseModel, Field
from performers import (
    commission_eligible_performers,
    sync_invoice_item_legacy,
)
from commission_io import (
    DATE_BASIS_FIELDS,
    commission_record_to_detail_row,
    rows_to_staff_export_xlsx,
    build_staff_period_summary,
)
from permissions import user_has_permission

# TODO(phase2): tiered commission rates by volume or revenue bands
# TODO(phase2): split commission between multiple staff on one line item
# TODO(phase2): refund / invoice cancellation reversal with payout clawback
# TODO(phase2): inventory-linked or product COGS-based commission
# TODO(phase2): package session / multi-visit package commission allocation
# TODO(phase2): payroll export and accounting integration

DATE_BASIS_VALUES = frozenset(DATE_BASIS_FIELDS.keys())
EXPORTABLE_STATUSES = frozenset({"approved", "paid_out"})

DEFAULT_TREATMENT_COMMISSION_RULE = {
    "rule_name": "Default Treatment Commission",
    "is_active": True,
    "priority": 999,
    "applies_to_role": "therapist",
    "applies_to_staff": None,
    "applies_to_treatment": None,
    "applies_to_category": None,
    "applies_to_item_type": "treatment",
    "commission_type": "percentage",
    "commission_value": 10.0,
    "calculation_basis": "net",
    "trigger": "invoice_paid",
    "exclude_discounted_items": False,
    "exclude_package_items": False,
    "requires_approval": True,
    "notes": "Seeded default rule for therapist treatment commissions (testing).",
    "start_date": None,
    "end_date": None,
}


async def ensure_default_commission_rules(db, clinic_id: str) -> None:
    """Ensure each clinic has the standard default treatment commission rule for testing."""
    if not clinic_id:
        return
    spec = dict(DEFAULT_TREATMENT_COMMISSION_RULE)
    existing = await db.commission_rules.find_one(
        {"clinic_id": clinic_id, "rule_name": spec["rule_name"]},
        {"_id": 0, "id": 1},
    )
    now = _now_iso()
    if existing:
        await db.commission_rules.update_one(
            {"id": existing["id"]},
            {"$set": {**spec, "updated_at": now}},
        )
        return
    await db.commission_rules.insert_one({
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        **spec,
        "created_by": None,
        "created_at": now,
        "updated_at": now,
    })


def _can_view_all_commission(user: dict) -> bool:
    return user_has_permission(user, "commission.view") or user_has_permission(user, "commission.manage")


def _can_view_own_commission(user: dict) -> bool:
    return user_has_permission(user, "commission.view_own")


def _resolve_commission_staff_filter(user: dict, staff_id: Optional[str]) -> Optional[str]:
    """commission.view/manage: any staff; commission.view_own: own records only."""
    if _can_view_all_commission(user):
        return staff_id
    if _can_view_own_commission(user):
        if staff_id and staff_id != user.get("id"):
            raise HTTPException(status_code=403, detail="You can only view your own commission records")
        return user.get("id")
    raise HTTPException(status_code=403, detail="Not allowed to view commission records")


def _resolve_commission_export_staff(user: dict, staff_id: Optional[str]) -> str:
    if not staff_id:
        raise HTTPException(status_code=400, detail="staff_id is required for commission export")
    if _can_view_all_commission(user):
        return staff_id
    if _can_view_own_commission(user) and user.get("id") == staff_id:
        return staff_id
    raise HTTPException(status_code=403, detail="Not allowed to export commission for this staff member")

RECORD_STATUSES = frozenset({"pending", "earned", "approved", "paid_out", "cancelled"})
LOCKED_RECORD_STATUSES = frozenset({"approved", "paid_out"})
COMMISSION_TYPES = frozenset({"percentage", "fixed_amount", "none"})
CALCULATION_BASES = frozenset({"gross", "net", "paid"})
TRIGGERS = frozenset({"invoice_paid", "visit_completed", "both", "manual"})
ITEM_TYPES = frozenset({"treatment", "package", "product", "custom", "all"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def line_amounts(invoice: dict, item: dict) -> Tuple[int, int, int, int]:
    """Return gross, discount_share, net, paid_share for an invoice line."""
    gross = int(item.get("line_total_idr") or 0)
    subtotal = int(invoice.get("subtotal") or 0)
    inv_discount = int(invoice.get("discount_amount") or 0)
    if subtotal <= 0:
        discount_share = 0
    else:
        discount_share = int(round(inv_discount * gross / subtotal))
    net = max(0, gross - discount_share)
    total_amount = int(invoice.get("total_amount") or 0)
    amount_paid = int(invoice.get("amount_paid") or 0)
    if total_amount <= 0:
        paid_share = 0
    else:
        paid_share = int(round(amount_paid * net / total_amount))
    return gross, discount_share, net, paid_share


def basis_amount(calculation_basis: str, gross: int, net: int, paid: int) -> int:
    basis = calculation_basis if calculation_basis in CALCULATION_BASES else "paid"
    if basis == "gross":
        return gross
    if basis == "net":
        return net
    return paid


def compute_commission_amount(commission_type: str, commission_value: float, basis: int) -> int:
    if commission_type == "none" or basis <= 0:
        return 0
    if commission_type == "percentage":
        return int(round(basis * float(commission_value or 0) / 100))
    if commission_type == "fixed_amount":
        return int(float(commission_value or 0))
    return 0


def rule_tier(rule: dict) -> int:
    s = bool(rule.get("applies_to_staff"))
    r = bool(rule.get("applies_to_role"))
    t = bool(rule.get("applies_to_treatment"))
    c = bool(rule.get("applies_to_category"))
    it = (rule.get("applies_to_item_type") or "all") != "all"
    if s and t:
        return 1
    if s and c:
        return 2
    if r and t:
        return 3
    if r and c:
        return 4
    if it or s or r:
        return 5
    return 6


def rule_in_date_range(rule: dict, today: str) -> bool:
    start = (rule.get("start_date") or "").strip()
    end = (rule.get("end_date") or "").strip()
    if start and today < start:
        return False
    if end and today > end:
        return False
    return True


def rule_matches(rule: dict, ctx: dict, today: str) -> bool:
    if not rule.get("is_active", True):
        return False
    if not rule_in_date_range(rule, today):
        return False
    staff = rule.get("applies_to_staff")
    if staff and staff != ctx.get("staff_id"):
        return False
    role = rule.get("applies_to_role")
    if role and role != ctx.get("staff_role"):
        return False
    treatment = rule.get("applies_to_treatment")
    if treatment and treatment != ctx.get("treatment_id"):
        return False
    category = rule.get("applies_to_category")
    if category and category != ctx.get("category"):
        return False
    item_type = rule.get("applies_to_item_type") or "all"
    if item_type != "all" and item_type != ctx.get("item_type"):
        return False
    return True


def find_best_rule(rules: List[dict], ctx: dict, today: str) -> Optional[dict]:
    matches = [r for r in rules if rule_matches(r, ctx, today)]
    if not matches:
        return None
    matches.sort(key=lambda r: (rule_tier(r), -int(r.get("priority") or 0)))
    return matches[0]


def trigger_met(invoice: dict, visit: Optional[dict], rule: dict) -> bool:
    trigger = rule.get("trigger") or "invoice_paid"
    inv_paid = (invoice.get("payment_status") or "") == "paid"
    visit_done = bool(visit and visit.get("status") == "completed")
    if trigger == "invoice_paid":
        return inv_paid
    if trigger == "visit_completed":
        return visit_done
    if trigger == "both":
        return inv_paid and visit_done
    return False


def derive_record_status(
    invoice: dict,
    visit: Optional[dict],
    rule: dict,
    current: Optional[str] = None,
) -> str:
    if (invoice.get("payment_status") or "") in ("cancelled", "refunded"):
        return "cancelled"
    if current in LOCKED_RECORD_STATUSES:
        return current
    if current == "cancelled":
        current = None
    if rule.get("commission_type") == "none":
        return "cancelled"
    if trigger_met(invoice, visit, rule):
        return "earned"
    return "pending"


async def resolve_treatment_category(db, clinic_id: str, catalog_id: Optional[str]) -> Optional[str]:
    if not catalog_id:
        return None
    row = await db.treatments.find_one(
        {"clinic_id": clinic_id, "$or": [{"id": catalog_id}, {"key": catalog_id}]},
        {"_id": 0, "category": 1},
    )
    return (row or {}).get("category")


def should_skip_item(rule: Optional[dict], item: dict, discount_share: int) -> bool:
    if not rule:
        return True
    if rule.get("commission_type") == "none":
        return True
    if rule.get("exclude_discounted_items") and discount_share > 0:
        return True
    if rule.get("exclude_package_items") and item.get("item_type") == "package":
        return True
    return False


def build_record_doc(
    *,
    clinic_id: str,
    invoice: dict,
    item: dict,
    rule: dict,
    visit: Optional[dict],
    gross: int,
    discount_share: int,
    net: int,
    paid_share: int,
    performer: dict,
    existing: Optional[dict] = None,
) -> dict:
    now = _now_iso()
    calc_basis = rule.get("calculation_basis") or "paid"
    basis = basis_amount(calc_basis, gross, net, paid_share)
    commission_amount = compute_commission_amount(
        rule.get("commission_type") or "none",
        rule.get("commission_value") or 0,
        basis,
    )
    prev_status = (existing or {}).get("status")
    status = derive_record_status(invoice, visit, rule, prev_status)

    doc = {
        "id": (existing or {}).get("id") or str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "invoice_id": invoice.get("id"),
        "invoice_number_snapshot": invoice.get("invoice_number") or "",
        "invoice_item_id": item.get("id"),
        "patient_id": invoice.get("patient_id"),
        "visit_id": invoice.get("visit_id"),
        "appointment_id": invoice.get("appointment_id"),
        "staff_id": performer.get("staff_id"),
        "staff_name_snapshot": performer.get("staff_name_snapshot") or "",
        "staff_role_snapshot": performer.get("staff_role_snapshot") or "",
        "performer_type": performer.get("performer_type") or "primary",
        "item_name_snapshot": item.get("name") or "",
        "item_type": item.get("item_type") or "custom",
        "treatment_id_snapshot": item.get("catalog_id") if item.get("item_type") == "treatment" else None,
        "gross_amount": gross,
        "discount_amount": discount_share,
        "net_amount": net,
        "paid_amount": paid_share,
        "commission_rule_id": rule.get("id"),
        "commission_rule_name_snapshot": rule.get("rule_name") or "",
        "commission_type": rule.get("commission_type") or "none",
        "commission_value": float(rule.get("commission_value") or 0),
        "calculation_basis": calc_basis,
        "commission_amount": commission_amount,
        "status": status,
        "approved_by": (existing or {}).get("approved_by"),
        "approved_at": (existing or {}).get("approved_at"),
        "paid_out_by": (existing or {}).get("paid_out_by"),
        "paid_out_at": (existing or {}).get("paid_out_at"),
        "notes": (existing or {}).get("notes") or "",
        "needs_adjustment": False,
        "adjustment_note": "",
        "created_at": (existing or {}).get("created_at") or now,
        "updated_at": now,
    }
    return doc


async def sync_commission_records_for_invoice(
    db,
    invoice: dict,
    visit: Optional[dict] = None,
) -> Dict[str, Any]:
    """Create/update commission records for each invoice line with a performer."""
    clinic_id = invoice.get("clinic_id")
    if not clinic_id:
        return {"created": 0, "updated": 0, "cancelled": 0, "warnings": []}

    if visit is None and invoice.get("visit_id"):
        visit = await db.visits.find_one({"id": invoice["visit_id"]}, {"_id": 0})

    inv_status = invoice.get("payment_status") or "unpaid"
    today = _today_str()
    rules = await db.commission_rules.find(
        {"clinic_id": clinic_id, "is_active": True},
        {"_id": 0},
    ).to_list(500)

    item_ids = {it.get("id") for it in (invoice.get("items") or []) if it.get("id")}
    existing_rows = await db.commission_records.find(
        {"clinic_id": clinic_id, "invoice_id": invoice.get("id")},
        {"_id": 0},
    ).to_list(500)
    by_item_staff = {
        (r["invoice_item_id"], r.get("staff_id")): r
        for r in existing_rows
        if r.get("invoice_item_id") and r.get("staff_id")
    }
    # Legacy index keyed only by item — map orphaned rows to primary performer
    for r in existing_rows:
        iid = r.get("invoice_item_id")
        sid = r.get("staff_id")
        if iid and sid and (iid, sid) not in by_item_staff:
            by_item_staff[(iid, sid)] = r

    result = {"created": 0, "updated": 0, "cancelled": 0, "warnings": []}

    if inv_status in ("cancelled", "refunded"):
        for rec in existing_rows:
            if rec.get("status") in LOCKED_RECORD_STATUSES:
                result["warnings"].append({
                    "invoice_item_id": rec.get("invoice_item_id"),
                    "record_id": rec.get("id"),
                    "message": "Invoice cancelled but commission is approved/paid — manual adjustment required",
                })
                await db.commission_records.update_one(
                    {"id": rec["id"]},
                    {"$set": {
                        "needs_adjustment": True,
                        "adjustment_note": "Invoice cancelled after commission was approved or paid out",
                        "updated_at": _now_iso(),
                    }},
                )
                continue
            if rec.get("status") != "cancelled":
                await db.commission_records.update_one(
                    {"id": rec["id"]},
                    {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
                )
                result["cancelled"] += 1
        return result

    seen_pairs: set = set()
    for item in invoice.get("items") or []:
        item_id = item.get("id")
        if not item_id:
            continue
        sync_invoice_item_legacy(item)
        item_performers = commission_eligible_performers(item)
        if not item_performers:
            continue

        gross, discount_share, net, paid_share = line_amounts(invoice, item)
        category = None
        treatment_id = item.get("catalog_id") if item.get("item_type") == "treatment" else None
        if item.get("item_type") == "treatment":
            category = await resolve_treatment_category(db, clinic_id, item.get("catalog_id"))

        for performer in item_performers:
            staff_id = performer.get("staff_id")
            if not staff_id:
                continue
            pair = (item_id, staff_id)
            seen_pairs.add(pair)

            ctx = {
                "staff_id": staff_id,
                "staff_role": performer.get("staff_role_snapshot") or "",
                "treatment_id": treatment_id,
                "category": category,
                "item_type": item.get("item_type") or "custom",
            }
            rule = find_best_rule(rules, ctx, today)
            existing = by_item_staff.get(pair)
            # Legacy single-performer record without staff_id collision
            if not existing:
                legacy = next(
                    (r for r in existing_rows if r.get("invoice_item_id") == item_id and not r.get("staff_id")),
                    None,
                )
                if legacy and len(item_performers) == 1:
                    existing = legacy
                elif legacy and legacy.get("staff_id") == staff_id:
                    existing = legacy

            if existing and existing.get("status") in LOCKED_RECORD_STATUSES:
                new_doc = build_record_doc(
                    clinic_id=clinic_id,
                    invoice=invoice,
                    item=item,
                    rule=rule or {"id": existing.get("commission_rule_id"), "rule_name": existing.get("commission_rule_name_snapshot"), "commission_type": existing.get("commission_type"), "commission_value": existing.get("commission_value"), "calculation_basis": existing.get("calculation_basis"), "trigger": "manual"},
                    visit=visit,
                    gross=gross,
                    discount_share=discount_share,
                    net=net,
                    paid_share=paid_share,
                    performer=performer,
                    existing=existing,
                )
                changed = (
                    new_doc["gross_amount"] != existing.get("gross_amount")
                    or new_doc["commission_amount"] != existing.get("commission_amount")
                    or new_doc["staff_id"] != existing.get("staff_id")
                )
                if changed:
                    result["warnings"].append({
                        "invoice_item_id": item_id,
                        "record_id": existing.get("id"),
                        "message": "Invoice item changed but commission is approved/paid — manual adjustment required",
                    })
                    await db.commission_records.update_one(
                        {"id": existing["id"]},
                        {"$set": {
                            "needs_adjustment": True,
                            "adjustment_note": "Source invoice item changed after commission was approved or paid out",
                            "updated_at": _now_iso(),
                        }},
                    )
                continue

            if should_skip_item(rule, item, discount_share):
                if existing and existing.get("status") not in LOCKED_RECORD_STATUSES:
                    await db.commission_records.update_one(
                        {"id": existing["id"]},
                        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
                    )
                    result["cancelled"] += 1
                continue

            if not rule:
                if existing and existing.get("status") not in LOCKED_RECORD_STATUSES:
                    await db.commission_records.update_one(
                        {"id": existing["id"]},
                        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
                    )
                    result["cancelled"] += 1
                continue

            doc = build_record_doc(
                clinic_id=clinic_id,
                invoice=invoice,
                item=item,
                rule=rule,
                visit=visit,
                gross=gross,
                discount_share=discount_share,
                net=net,
                paid_share=paid_share,
                performer=performer,
                existing=existing,
            )
            if existing:
                await db.commission_records.update_one({"id": existing["id"]}, {"$set": doc})
                result["updated"] += 1
            else:
                await db.commission_records.insert_one(doc)
                result["created"] += 1

    for rec in existing_rows:
        iid = rec.get("invoice_item_id")
        sid = rec.get("staff_id")
        if not iid:
            continue
        if (iid, sid) in seen_pairs:
            continue
        if rec.get("status") not in LOCKED_RECORD_STATUSES:
            await db.commission_records.update_one(
                {"id": rec["id"]},
                {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
            )
            result["cancelled"] += 1

    return result


class CommissionRuleIn(BaseModel):
    rule_name: str
    is_active: bool = True
    priority: int = 0
    applies_to_role: Optional[str] = None
    applies_to_staff: Optional[str] = None
    applies_to_treatment: Optional[str] = None
    applies_to_category: Optional[str] = None
    applies_to_item_type: str = "all"
    commission_type: str = "percentage"
    commission_value: float = 0
    calculation_basis: str = "paid"
    trigger: str = "invoice_paid"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    exclude_discounted_items: bool = False
    exclude_package_items: bool = False
    requires_approval: bool = True
    notes: str = ""


class CommissionBulkIdsIn(BaseModel):
    record_ids: List[str] = Field(..., min_length=1)


def _validate_date_range(from_date: Optional[str], to_date: Optional[str], *, required: bool = False) -> None:
    if required and (not from_date or not to_date):
        raise HTTPException(status_code=400, detail="from and to dates are required")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=400, detail="from date must be on or before to date")


def _date_field_range_filter(from_date: Optional[str], to_date: Optional[str]) -> dict:
    r: dict = {}
    if from_date:
        r["$gte"] = f"{from_date}T00:00:00"
    if to_date:
        r["$lte"] = f"{to_date}T23:59:59"
    return r


def _records_date_range_filter(
    from_date: Optional[str],
    to_date: Optional[str],
    date_basis: str = "approved_at",
) -> Optional[dict]:
    if not from_date and not to_date:
        return None
    basis = date_basis if date_basis in DATE_BASIS_VALUES else "approved_at"
    field = DATE_BASIS_FIELDS[basis]
    date_range = _date_field_range_filter(from_date, to_date)
    if not date_range:
        return None
    if basis == "approved_at":
        return {
            "$or": [
                {"approved_at": date_range},
                {
                    "$and": [
                        {"status": {"$in": ["approved", "earned", "pending"]}},
                        {"$or": [{"approved_at": None}, {"approved_at": ""}]},
                        {"created_at": date_range},
                    ],
                },
            ],
        }
    return {field: date_range}


def _export_status_filter(status: str) -> dict:
    st = (status or "approved").strip().lower()
    if st == "all":
        return {"status": {"$in": sorted(EXPORTABLE_STATUSES)}}
    if st == "paid_out":
        return {"status": "paid_out"}
    return {"status": "approved"}


def _normalize_rule_payload(data: dict) -> dict:
    if data.get("applies_to_item_type") not in ITEM_TYPES:
        data["applies_to_item_type"] = "all"
    if data.get("commission_type") not in COMMISSION_TYPES:
        data["commission_type"] = "percentage"
    if data.get("calculation_basis") not in CALCULATION_BASES:
        data["calculation_basis"] = "paid"
    if data.get("trigger") not in TRIGGERS:
        data["trigger"] = "invoice_paid"
    for k in ("applies_to_role", "applies_to_staff", "applies_to_treatment", "applies_to_category", "start_date", "end_date"):
        if data.get(k) == "":
            data[k] = None
    data["rule_name"] = (data.get("rule_name") or "").strip()
    if not data["rule_name"]:
        raise HTTPException(status_code=400, detail="Rule name is required")
    return data


def register_commissions(
    api: APIRouter,
    db,
    get_current_user,
    require_roles,
    require_permission,
    assert_writeable,
    assert_feature,
    audit,
    scope,
):
    async def _enrich_records(rows: List[dict]) -> List[dict]:
        patient_ids = {r.get("patient_id") for r in rows if r.get("patient_id")}
        patients = {}
        if patient_ids:
            async for p in db.patients.find({"id": {"$in": list(patient_ids)}}, {"_id": 0, "id": 1, "full_name": 1}):
                patients[p["id"]] = p
        out = []
        for r in rows:
            r = dict(r)
            if r.get("patient_id"):
                r["patient"] = patients.get(r["patient_id"])
            out.append(r)
        return out

    def _records_list_filter(
        user: dict,
        *,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        date_basis: str = "approved_at",
        staff_id: Optional[str] = None,
        role: Optional[str] = None,
        treatment_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> dict:
        _validate_date_range(from_date, to_date)
        flt = scope(user, {})
        date_clause = _records_date_range_filter(from_date, to_date, date_basis)
        if date_clause:
            flt.update(date_clause)
        if staff_id:
            flt["staff_id"] = staff_id
        if role:
            flt["staff_role_snapshot"] = role
        if treatment_id:
            flt["treatment_id_snapshot"] = treatment_id
        if status and status != "all":
            flt["status"] = status
        return flt

    @api.get("/commission-rules")
    async def list_commission_rules(user: dict = Depends(require_permission("commission.manage"))):
        await assert_feature(user, "commissions")
        rows = await db.commission_rules.find(scope(user, {}), {"_id": 0}).sort(
            [("priority", -1), ("rule_name", 1)]
        ).to_list(500)
        return rows

    @api.post("/commission-rules")
    async def create_commission_rule(
        payload: CommissionRuleIn,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        data = _normalize_rule_payload(payload.model_dump())
        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": user.get("clinic_id"),
            **data,
            "created_by": user["id"],
            "created_at": now,
            "updated_at": now,
        }
        await db.commission_rules.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "commission_rule", doc["id"], {"rule_name": doc["rule_name"]})
        return doc

    @api.put("/commission-rules/{rule_id}")
    async def update_commission_rule(
        rule_id: str,
        payload: CommissionRuleIn,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        existing = await db.commission_rules.find_one(scope(user, {"id": rule_id}), {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Commission rule not found")
        data = _normalize_rule_payload(payload.model_dump())
        data["updated_at"] = _now_iso()
        await db.commission_rules.update_one(scope(user, {"id": rule_id}), {"$set": data})
        await audit(user, "update", "commission_rule", rule_id)
        return await db.commission_rules.find_one(scope(user, {"id": rule_id}), {"_id": 0})

    @api.post("/commission-rules/{rule_id}/deactivate")
    async def deactivate_commission_rule(
        rule_id: str,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        res = await db.commission_rules.update_one(
            scope(user, {"id": rule_id}),
            {"$set": {"is_active": False, "updated_at": _now_iso()}},
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Commission rule not found")
        await audit(user, "deactivate", "commission_rule", rule_id)
        return {"ok": True}

    @api.delete("/commission-rules/{rule_id}")
    async def delete_commission_rule(
        rule_id: str,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        res = await db.commission_rules.delete_one(scope(user, {"id": rule_id}))
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Commission rule not found")
        await audit(user, "delete", "commission_rule", rule_id)
        return {"ok": True}

    @api.get("/commission-records")
    async def list_commission_records(
        user: dict = Depends(get_current_user),
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
        date_basis: str = Query("approved_at", description="earned_at, approved_at, paid_out_at, invoice_paid_at"),
        staff_id: Optional[str] = None,
        role: Optional[str] = None,
        treatment_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = Query(200, le=1000),
    ):
        await assert_feature(user, "commissions")
        if date_basis not in DATE_BASIS_VALUES:
            raise HTTPException(status_code=400, detail="Invalid date_basis")
        staff_id = _resolve_commission_staff_filter(user, staff_id)
        flt = _records_list_filter(
            user,
            from_date=from_date,
            to_date=to_date,
            date_basis=date_basis,
            staff_id=staff_id,
            role=role,
            treatment_id=treatment_id,
            status=status,
        )
        rows = await db.commission_records.find(flt, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return await _enrich_records(rows)

    @api.get("/commission-records/export")
    async def export_commission_records(
        user: dict = Depends(get_current_user),
        from_date: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
        to_date: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
        staff_id: str = Query(..., description="Staff member id (required)"),
        date_basis: str = Query("approved_at", description="earned_at, approved_at, paid_out_at, invoice_paid_at"),
        status: str = Query("approved", description="approved, paid_out, or all"),
    ):
        """Export one staff member's commission records for a custom date range."""
        await assert_feature(user, "commissions")
        _validate_date_range(from_date, to_date, required=True)
        if date_basis not in DATE_BASIS_VALUES:
            raise HTTPException(status_code=400, detail="Invalid date_basis")
        staff_id = _resolve_commission_export_staff(user, staff_id)

        flt = scope(user, {"staff_id": staff_id})
        flt.update(_export_status_filter(status))
        date_clause = _records_date_range_filter(from_date, to_date, date_basis)
        if date_clause:
            flt.update(date_clause)

        sort_field = DATE_BASIS_FIELDS.get(date_basis, "approved_at")
        rows_db = await db.commission_records.find(flt, {"_id": 0}).sort(sort_field, 1).to_list(10000)
        enriched = await _enrich_records(rows_db)

        staff_name = ""
        staff_role = ""
        if enriched:
            staff_name = enriched[0].get("staff_name_snapshot") or ""
            staff_role = enriched[0].get("staff_role_snapshot") or ""
        else:
            staff_doc = await db.users.find_one(scope(user, {"id": staff_id}), {"_id": 0, "name": 1, "role": 1})
            if staff_doc:
                staff_name = staff_doc.get("name") or ""
                staff_role = staff_doc.get("role") or ""

        detail_rows = [
            commission_record_to_detail_row(
                r,
                (r.get("patient") or {}).get("full_name") or "",
                date_basis=date_basis,
            )
            for r in enriched
        ]
        summary = build_staff_period_summary(
            enriched,
            staff_name=staff_name,
            staff_role=staff_role,
            period_start=from_date,
            period_end=to_date,
        )
        xlsx_bytes = rows_to_staff_export_xlsx(summary, detail_rows)
        slug = (staff_name or staff_id[:8]).replace(" ", "-").lower()
        filename = f"commission-{slug}-{from_date}-to-{to_date}.xlsx"
        await audit(
            user, "export", "commission_record", f"{staff_id}:{from_date}:{to_date}",
            {"count": len(detail_rows), "status": status, "staff_id": staff_id, "date_basis": date_basis},
        )
        return FastResponse(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @api.get("/commission-records/my-summary")
    async def my_commission_summary(
        user: dict = Depends(get_current_user),
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        await assert_feature(user, "commissions")
        if not _can_view_own_commission(user):
            raise HTTPException(status_code=403, detail="Not allowed to view your commission summary")
        flt = scope(user, {"staff_id": user["id"]})
        if from_date:
            flt.setdefault("created_at", {})["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            flt.setdefault("created_at", {})["$lte"] = f"{to_date}T23:59:59"
        rows = await db.commission_records.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        totals = {"pending": 0, "earned": 0, "approved": 0, "paid_out": 0}
        for r in rows:
            st = r.get("status") or "pending"
            if st in totals:
                totals[st] += int(r.get("commission_amount") or 0)
        return {
            "records": rows,
            "totals_idr": totals,
            "total_commission_idr": sum(totals.values()),
        }

    @api.post("/commission-records/approve")
    async def approve_commission_records(
        payload: CommissionBulkIdsIn,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        now = _now_iso()
        approved = 0
        skipped = []
        for rid in payload.record_ids:
            rec = await db.commission_records.find_one(scope(user, {"id": rid}), {"_id": 0})
            if not rec:
                skipped.append({"id": rid, "reason": "not found"})
                continue
            if rec.get("status") != "earned":
                skipped.append({"id": rid, "reason": f"status is {rec.get('status')}, expected earned"})
                continue
            await db.commission_records.update_one(
                {"id": rid},
                {"$set": {
                    "status": "approved",
                    "approved_by": user["id"],
                    "approved_at": now,
                    "updated_at": now,
                }},
            )
            approved += 1
        from audit_log import log_commission_event
        await log_commission_event(db, user, "approved", payload.record_ids, count=approved)
        return {"approved": approved, "skipped": skipped}

    @api.post("/commission-records/paid-out")
    async def mark_commission_paid_out(
        payload: CommissionBulkIdsIn,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_writeable(user)
        await assert_feature(user, "commissions")
        now = _now_iso()
        paid = 0
        skipped = []
        for rid in payload.record_ids:
            rec = await db.commission_records.find_one(scope(user, {"id": rid}), {"_id": 0})
            if not rec:
                skipped.append({"id": rid, "reason": "not found"})
                continue
            if rec.get("status") != "approved":
                skipped.append({"id": rid, "reason": f"status is {rec.get('status')}, expected approved"})
                continue
            await db.commission_records.update_one(
                {"id": rid},
                {"$set": {
                    "status": "paid_out",
                    "paid_out_by": user["id"],
                    "paid_out_at": now,
                    "updated_at": now,
                }},
            )
            paid += 1
        from audit_log import log_commission_event
        await log_commission_event(db, user, "paid_out", payload.record_ids, count=paid)
        return {"paid_out": paid, "skipped": skipped}

    @api.post("/commission-records/sync-invoice/{invoice_id}")
    async def sync_invoice_commissions(
        invoice_id: str,
        user: dict = Depends(require_permission("commission.manage")),
    ):
        await assert_feature(user, "commissions")
        inv = await db.invoices.find_one(scope(user, {"id": invoice_id}), {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        result = await sync_commission_records_for_invoice(db, inv)
        return result
