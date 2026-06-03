"""Visit treatment product usage and inventory stock movements."""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from permissions import user_has_permission

MOVEMENT_TYPES = frozenset({"treatment_usage", "adjustment", "reversal", "retail_sale"})
REFERENCE_TYPES = frozenset({"visit", "treatment_item", "product_usage", "pos_sale"})
USAGE_STATUSES = frozenset({"active", "reversed"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_inventory_settings(db, clinic_id: str) -> dict:
    s = await db.settings.find_one({"id": "global", "clinic_id": clinic_id}, {"_id": 0, "inventory": 1})
    inv = (s or {}).get("inventory") or {}
    return {
        "allow_negative_stock": bool(inv.get("allow_negative_stock", False)),
    }


async def _load_product(db, clinic_id: str, product_id: str) -> dict:
    product = await db.products.find_one({"clinic_id": clinic_id, "id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.get("active", True):
        raise HTTPException(status_code=400, detail="Product is inactive")
    return product


async def apply_stock_change(
    db,
    *,
    clinic_id: str,
    product_id: str,
    quantity_change: float,
    movement_type: str,
    reference_type: str,
    reference_id: str,
    created_by: str,
    reason: str = "",
) -> dict:
    """Apply stock delta and log movement. quantity_change negative = deduct."""
    if movement_type not in MOVEMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid movement type")
    if reference_type not in REFERENCE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid reference type")

    inv_settings = await get_inventory_settings(db, clinic_id)
    product = await _load_product(db, clinic_id, product_id)
    previous = float(product.get("current_stock") or 0)
    new_stock = previous + float(quantity_change)

    if not inv_settings["allow_negative_stock"] and new_stock < 0:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {product.get('name') or 'product'} (available: {int(previous)})",
        )

    now = _now_iso()
    await db.products.update_one(
        {"clinic_id": clinic_id, "id": product_id},
        {"$set": {"current_stock": new_stock, "stock_updated_at": now}},
    )
    movement = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "product_id": product_id,
        "product_name_snapshot": product.get("name") or "",
        "movement_type": movement_type,
        "quantity_change": float(quantity_change),
        "previous_stock": previous,
        "new_stock": new_stock,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "created_by": created_by,
        "reason": reason or "",
        "created_at": now,
    }
    await db.stock_movements.insert_one(movement)
    movement.pop("_id", None)
    return movement


async def reverse_stock_for_pos_sale(
    db,
    sale: dict,
    *,
    created_by: str,
    reason: str = "POS sale cancelled",
) -> int:
    """Restore product stock deducted on a paid POS sale."""
    clinic_id = sale.get("clinic_id")
    sale_id = sale.get("id")
    items = list(sale.get("items") or [])
    reversed_count = 0
    changed = False
    for item in items:
        if not item.get("stock_deducted"):
            continue
        if item.get("item_type") != "product" or not item.get("product_id"):
            item["stock_deducted"] = False
            changed = True
            continue
        qty = float(item.get("qty") or 0)
        if qty <= 0:
            item["stock_deducted"] = False
            changed = True
            continue
        await apply_stock_change(
            db,
            clinic_id=clinic_id,
            product_id=item["product_id"],
            quantity_change=qty,
            movement_type="reversal",
            reference_type="pos_sale",
            reference_id=sale_id,
            created_by=created_by,
            reason=reason or f"POS cancel {sale.get('sale_number') or sale_id}",
        )
        item["stock_deducted"] = False
        reversed_count += 1
        changed = True
    if changed:
        await db.pos_sales.update_one(
            {"id": sale_id, "clinic_id": clinic_id},
            {"$set": {"items": items, "updated_at": _now_iso()}},
        )
    return reversed_count


async def reverse_product_usage(
    db,
    usage: dict,
    *,
    created_by: str,
    reason: str = "Usage reversed",
) -> Optional[dict]:
    if usage.get("status") != "active":
        return None
    qty = float(usage.get("quantity_used") or 0)
    if qty <= 0:
        return None
    movement = await apply_stock_change(
        db,
        clinic_id=usage["clinic_id"],
        product_id=usage["product_id"],
        quantity_change=qty,
        movement_type="reversal",
        reference_type="product_usage",
        reference_id=usage["id"],
        created_by=created_by,
        reason=reason,
    )
    now = _now_iso()
    await db.visit_product_usages.update_one(
        {"id": usage["id"]},
        {"$set": {"status": "reversed", "reversed_at": now, "updated_at": now}},
    )
    return movement


async def reverse_usages_for_treatment_item(
    db,
    clinic_id: str,
    treatment_item_id: str,
    *,
    created_by: str,
    reason: str = "Treatment item removed",
) -> int:
    usages = await db.visit_product_usages.find(
        {"clinic_id": clinic_id, "treatment_item_id": treatment_item_id, "status": "active"},
        {"_id": 0},
    ).to_list(50)
    count = 0
    for u in usages:
        if await reverse_product_usage(db, u, created_by=created_by, reason=reason):
            count += 1
    return count


async def reverse_usages_for_visit(
    db,
    clinic_id: str,
    visit_id: str,
    *,
    created_by: str,
    reason: str = "Visit cancelled",
) -> int:
    usages = await db.visit_product_usages.find(
        {"clinic_id": clinic_id, "visit_id": visit_id, "status": "active"},
        {"_id": 0},
    ).to_list(500)
    count = 0
    for u in usages:
        if await reverse_product_usage(db, u, created_by=created_by, reason=reason):
            count += 1
    return count


async def create_product_usage(
    db,
    *,
    clinic_id: str,
    visit_id: str,
    treatment_item_id: str,
    product_id: str,
    quantity_used: float,
    dose_notes: str,
    used_by_staff_id: str,
    performer_id: Optional[str],
    performer_snap: dict,
    user_id: str,
) -> dict:
    if quantity_used <= 0:
        raise HTTPException(status_code=400, detail="Quantity used must be greater than 0")

    product = await _load_product(db, clinic_id, product_id)
    now = _now_iso()
    usage_id = str(uuid.uuid4())

    await apply_stock_change(
        db,
        clinic_id=clinic_id,
        product_id=product_id,
        quantity_change=-float(quantity_used),
        movement_type="treatment_usage",
        reference_type="product_usage",
        reference_id=usage_id,
        created_by=user_id,
        reason=f"Treatment usage on visit {visit_id}",
    )

    doc = {
        "id": usage_id,
        "clinic_id": clinic_id,
        "visit_id": visit_id,
        "treatment_item_id": treatment_item_id,
        "product_id": product_id,
        "product_name_snapshot": product.get("name") or "",
        "quantity_used": float(quantity_used),
        "unit_snapshot": product.get("unit") or "pcs",
        "dose_notes": dose_notes or "",
        "used_by_staff_id": used_by_staff_id,
        "performer_id": performer_id or performer_snap.get("performer_id") or "",
        "performer_name_snapshot": performer_snap.get("performer_name_snapshot") or "",
        "performer_role_snapshot": performer_snap.get("performer_role_snapshot") or "",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await db.visit_product_usages.insert_one(doc)
    doc.pop("_id", None)

    await db.treatment_items.update_one(
        {"id": treatment_item_id, "visit_id": visit_id, "clinic_id": clinic_id},
        {"$set": {
            "product_used": doc["product_name_snapshot"],
            "product_id": product_id,
            "quantity_used": doc["quantity_used"],
            "unit_snapshot": doc["unit_snapshot"],
        }},
    )
    return doc


async def update_product_usage(
    db,
    usage: dict,
    *,
    product_id: Optional[str],
    quantity_used: Optional[float],
    dose_notes: Optional[str],
    user_id: str,
) -> dict:
    if usage.get("status") != "active":
        raise HTTPException(status_code=400, detail="Cannot edit reversed usage")

    clinic_id = usage["clinic_id"]
    old_qty = float(usage.get("quantity_used") or 0)
    old_product_id = usage.get("product_id")
    new_product_id = product_id or old_product_id
    new_qty = float(quantity_used) if quantity_used is not None else old_qty

    if new_qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity used must be greater than 0")

    if new_product_id != old_product_id:
        await reverse_product_usage(
            db, usage, created_by=user_id, reason="Product changed on usage edit",
        )
        product = await _load_product(db, clinic_id, new_product_id)
        usage_id = usage["id"]
        await apply_stock_change(
            db,
            clinic_id=clinic_id,
            product_id=new_product_id,
            quantity_change=-new_qty,
            movement_type="treatment_usage",
            reference_type="product_usage",
            reference_id=usage_id,
            created_by=user_id,
            reason="Treatment usage updated (product changed)",
        )
        now = _now_iso()
        upd = {
            "product_id": new_product_id,
            "product_name_snapshot": product.get("name") or "",
            "quantity_used": new_qty,
            "unit_snapshot": product.get("unit") or "pcs",
            "status": "active",
            "updated_at": now,
        }
        if dose_notes is not None:
            upd["dose_notes"] = dose_notes
        await db.visit_product_usages.update_one({"id": usage_id}, {"$set": upd})
    else:
        delta = new_qty - old_qty
        if delta != 0:
            await apply_stock_change(
                db,
                clinic_id=clinic_id,
                product_id=old_product_id,
                quantity_change=-delta,
                movement_type="treatment_usage" if delta > 0 else "reversal",
                reference_type="product_usage",
                reference_id=usage["id"],
                created_by=user_id,
                reason="Treatment usage quantity adjusted",
            )
        now = _now_iso()
        upd = {"quantity_used": new_qty, "updated_at": now}
        if dose_notes is not None:
            upd["dose_notes"] = dose_notes
        await db.visit_product_usages.update_one({"id": usage["id"]}, {"$set": upd})

    updated = await db.visit_product_usages.find_one({"id": usage["id"]}, {"_id": 0})
    if updated:
        await db.treatment_items.update_one(
            {"id": updated["treatment_item_id"]},
            {"$set": {
                "product_used": updated.get("product_name_snapshot") or "",
                "product_id": updated.get("product_id"),
                "quantity_used": updated.get("quantity_used"),
                "unit_snapshot": updated.get("unit_snapshot"),
            }},
        )
    return updated or usage


class ProductUsageIn(BaseModel):
    product_id: str
    quantity_used: float = Field(gt=0)
    dose_notes: Optional[str] = ""
    performer_id: Optional[str] = None


class ProductUsageUpdateIn(BaseModel):
    product_id: Optional[str] = None
    quantity_used: Optional[float] = Field(None, gt=0)
    dose_notes: Optional[str] = None


class InventorySettingsIn(BaseModel):
    allow_negative_stock: bool = False


def register_inventory_usage(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    audit,
    scope,
    assert_staff_visit_access,
):
    def _can_record_usage(user: dict) -> bool:
        if user.get("role") in ("doctor", "therapist", "nurse", "super_admin"):
            return user_has_permission(user, "clinical_records.edit")
        return user_has_permission(user, "inventory.usage_record")

    def _can_view_inventory(user: dict) -> bool:
        return (
            user.get("role") in ("super_admin", "manager", "fo")
            or user_has_permission(user, "inventory.view")
            or user_has_permission(user, "inventory.manage")
            or user_has_permission(user, "products.manage")
            or _can_record_usage(user)
        )

    async def _require_products(user: dict) -> None:
        await assert_feature(user, "products")

    @api.get("/settings/inventory")
    async def get_inventory_settings_endpoint(user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "settings.view") and not _can_view_inventory(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        return await get_inventory_settings(db, user.get("clinic_id"))

    @api.put("/admin/settings/inventory")
    async def update_inventory_settings(payload: InventorySettingsIn, user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "settings.manage") and user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        await assert_writeable(user)
        await db.settings.update_one(
            scope(user, {"id": "global"}),
            {"$set": {"inventory": {"allow_negative_stock": payload.allow_negative_stock}}},
            upsert=True,
        )
        await audit(user, "update", "inventory_settings", "global", {"allow_negative_stock": payload.allow_negative_stock})
        return await get_inventory_settings(db, user.get("clinic_id"))

    @api.get("/visits/{vid}/product-usages")
    async def list_visit_product_usages(vid: str, user: dict = Depends(get_current_user)):
        if not user_has_permission(user, "visits.view") and not user_has_permission(user, "visits.view_own"):
            raise HTTPException(status_code=403, detail="Not allowed")
        visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await assert_staff_visit_access(db, user, visit)
        rows = await db.visit_product_usages.find(
            {"clinic_id": user.get("clinic_id"), "visit_id": vid},
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        return rows

    @api.post("/visits/{vid}/treatments/{tid}/product-usages")
    async def add_product_usage(
        vid: str,
        tid: str,
        payload: ProductUsageIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_record_usage(user):
            raise HTTPException(status_code=403, detail="Not allowed to record product usage")
        await assert_writeable(user)
        await _require_products(user)
        await assert_feature(user, "emr")
        visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await assert_staff_visit_access(db, user, visit)
        item = await db.treatment_items.find_one(
            scope(user, {"id": tid, "visit_id": vid}),
            {"_id": 0},
        )
        if not item:
            raise HTTPException(status_code=404, detail="Treatment item not found")
        existing = await db.visit_product_usages.find_one(
            {"clinic_id": user.get("clinic_id"), "treatment_item_id": tid, "status": "active"},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=400, detail="Active product usage already exists for this treatment item")

        performer_snap = {
            "performer_id": item.get("performer_id") or payload.performer_id,
            "performer_name_snapshot": item.get("performer_name_snapshot") or "",
            "performer_role_snapshot": item.get("performer_role_snapshot") or "",
        }
        doc = await create_product_usage(
            db,
            clinic_id=user.get("clinic_id"),
            visit_id=vid,
            treatment_item_id=tid,
            product_id=payload.product_id,
            quantity_used=payload.quantity_used,
            dose_notes=payload.dose_notes or "",
            used_by_staff_id=user["id"],
            performer_id=payload.performer_id or item.get("performer_id"),
            performer_snap=performer_snap,
            user_id=user["id"],
        )
        await audit(user, "create", "visit_product_usage", doc["id"], {"visit_id": vid, "product_id": payload.product_id})
        return doc

    @api.put("/visits/{vid}/product-usages/{uid}")
    async def edit_product_usage(
        vid: str,
        uid: str,
        payload: ProductUsageUpdateIn,
        user: dict = Depends(get_current_user),
    ):
        if not _can_record_usage(user):
            raise HTTPException(status_code=403, detail="Not allowed to record product usage")
        await assert_writeable(user)
        await _require_products(user)
        visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await assert_staff_visit_access(db, user, visit)
        usage = await db.visit_product_usages.find_one(
            scope(user, {"id": uid, "visit_id": vid}),
            {"_id": 0},
        )
        if not usage:
            raise HTTPException(status_code=404, detail="Product usage not found")
        updated = await update_product_usage(
            db,
            usage,
            product_id=payload.product_id,
            quantity_used=payload.quantity_used,
            dose_notes=payload.dose_notes,
            user_id=user["id"],
        )
        await audit(user, "update", "visit_product_usage", uid)
        return updated

    @api.delete("/visits/{vid}/product-usages/{uid}")
    async def delete_product_usage(vid: str, uid: str, user: dict = Depends(get_current_user)):
        if not _can_record_usage(user):
            raise HTTPException(status_code=403, detail="Not allowed to record product usage")
        await assert_writeable(user)
        visit = await db.visits.find_one(scope(user, {"id": vid}), {"_id": 0})
        if not visit:
            raise HTTPException(status_code=404, detail="Visit not found")
        await assert_staff_visit_access(db, user, visit)
        usage = await db.visit_product_usages.find_one(
            scope(user, {"id": uid, "visit_id": vid}),
            {"_id": 0},
        )
        if not usage:
            raise HTTPException(status_code=404, detail="Product usage not found")
        await reverse_product_usage(db, usage, created_by=user["id"], reason="Usage deleted")
        await audit(user, "delete", "visit_product_usage", uid)
        return {"ok": True}

    @api.get("/products-catalog/{pid}/stock-movements")
    async def list_stock_movements(
        pid: str,
        user: dict = Depends(get_current_user),
        limit: int = Query(50, ge=1, le=200),
    ):
        if not _can_view_inventory(user):
            raise HTTPException(status_code=403, detail="Not allowed to view stock movements")
        await _require_products(user)
        product = await db.products.find_one(scope(user, {"id": pid}), {"_id": 0, "id": 1})
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        rows = await db.stock_movements.find(
            {"clinic_id": user.get("clinic_id"), "product_id": pid},
            {"_id": 0},
        ).sort("created_at", -1).to_list(limit)
        return rows

    @api.get("/reports/inventory-usage")
    async def reports_inventory_usage(
        user: dict = Depends(get_current_user),
        preset: Optional[str] = None,
        from_date: Optional[str] = Query(None, alias="from"),
        to_date: Optional[str] = Query(None, alias="to"),
    ):
        from reports_common import assert_report_access, range_meta, resolve_date_range, ts_in_range

        assert_report_access(user, "inventory")
        await assert_feature(user, "reports")
        await _require_products(user)
        start_iso, end_iso, from_str, to_str = resolve_date_range(preset, from_date, to_date)
        cid = user.get("clinic_id")

        usages = await db.visit_product_usages.find(
            {"clinic_id": cid, "status": "active"},
            {"_id": 0},
        ).to_list(10000)
        in_range = [u for u in usages if ts_in_range(u.get("created_at"), start_iso, end_iso)]

        by_date: Dict[str, float] = defaultdict(float)
        by_treatment: Dict[str, float] = defaultdict(float)
        by_staff: Dict[str, float] = defaultdict(float)
        treatment_names: Dict[str, str] = {}

        for u in in_range:
            day = (u.get("created_at") or "")[:10]
            qty = float(u.get("quantity_used") or 0)
            by_date[day] += qty
            tid = u.get("treatment_item_id") or ""
            if tid and tid not in treatment_names:
                ti = await db.treatment_items.find_one({"id": tid}, {"_id": 0, "name": 1})
                treatment_names[tid] = (ti or {}).get("name") or tid
            by_treatment[treatment_names.get(tid, tid or "—")] += qty
            staff_key = u.get("performer_name_snapshot") or u.get("used_by_staff_id") or "—"
            by_staff[staff_key] += qty

        products = await db.products.find({"clinic_id": cid, "active": True}, {"_id": 0}).to_list(5000)
        low_stock = []
        out_of_stock = []
        for p in products:
            cur = float(p.get("current_stock") or 0)
            mn = float(p.get("minimum_stock") or 0)
            row = {
                "id": p.get("id"),
                "name": p.get("name"),
                "current_stock": cur,
                "minimum_stock": mn,
                "unit": p.get("unit") or "pcs",
            }
            if cur <= 0:
                out_of_stock.append(row)
            elif cur <= mn:
                low_stock.append(row)

        return {
            "range": range_meta(start_iso, end_iso, from_str, to_str, preset),
            "usage_by_date": [{"date": d, "quantity": q} for d, q in sorted(by_date.items())],
            "usage_by_treatment": [{"treatment": k, "quantity": q} for k, q in sorted(by_treatment.items(), key=lambda x: -x[1])],
            "usage_by_staff": [{"staff": k, "quantity": q} for k, q in sorted(by_staff.items(), key=lambda x: -x[1])],
            "low_stock_products": sorted(low_stock, key=lambda x: x["current_stock"]),
            "out_of_stock_products": sorted(out_of_stock, key=lambda x: x["name"] or ""),
            "total_usage_records": len(in_range),
        }

    return api
