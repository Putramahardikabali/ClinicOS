"""Staff module: directory, schedules, roles & permissions."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr

from staff_scheduling import (
    DAY_KEYS,
    WeeklyScheduleIn,
    WeeklyDayIn,
    migrate_legacy_user_schedule,
    register_staff_scheduling,
)
from permissions import (
    ALL_PERMISSION_KEYS,
    OWNER_PROTECTED,
    PERFORMER_TYPES,
    PERMISSION_CATALOG,
    SYSTEM_ROLE_DEFINITIONS,
    attach_permissions_to_user,
    catalog_flat,
    ensure_clinic_roles,
    owner_role_guard,
    sanitize_permissions,
    user_has_permission,
)

LEGACY_ROLES = frozenset({"super_admin", "doctor", "therapist", "nurse", "fo", "manager", "accounting"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return key[:48] or "custom_role"


class RoleIn(BaseModel):
    role_name: str
    role_key: Optional[str] = None
    description: str = ""
    permissions: List[str] = []
    is_active: bool = True


class RoleUpdateIn(BaseModel):
    role_name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None


class StaffUserIn(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    name: str
    phone: Optional[str] = ""
    job_title: Optional[str] = ""
    role_id: Optional[str] = None
    role: Optional[str] = None
    performer_type: Optional[str] = None
    active: bool = True
    notes: Optional[str] = ""


class StaffScheduleIn(BaseModel):
    working_hours: Optional[Dict[str, Any]] = None
    days_off: Optional[List[Dict[str, Any]]] = None


def register_staff(
    api: APIRouter,
    db,
    get_current_user,
    require_roles,
    assert_writeable,
    audit,
    scope,
    assert_staff_capacity,
    hash_password,
):
    def require_perm(permission: str):
        async def checker(user: dict = Depends(get_current_user)):
            user = await attach_permissions_to_user(db, user)
            if not user_has_permission(user, permission):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user
        return checker

    async def _staff_in_clinic(user: dict, uid: str) -> dict:
        u = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return u

    async def _get_role(user: dict, role_id: str) -> dict:
        doc = await db.clinic_roles.find_one(scope(user, {"id": role_id}), {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Role not found")
        return doc

    @api.get("/staff/permissions/catalog")
    async def permissions_catalog(user: dict = Depends(require_perm("roles.view"))):
        return {"groups": PERMISSION_CATALOG, "flat": catalog_flat()}

    @api.get("/staff/roles")
    async def list_roles(
        user: dict = Depends(require_perm("roles.view")),
        include_inactive: bool = False,
    ):
        await ensure_clinic_roles(db, user.get("clinic_id"))
        flt = scope(user, {})
        if not include_inactive:
            flt["is_active"] = True
        rows = await db.clinic_roles.find(flt, {"_id": 0}).sort("role_name", 1).to_list(200)
        counts = {}
        async for u in db.users.find(scope(user, {}), {"_id": 0, "role_id": 1, "role": 1}):
            rid = u.get("role_id")
            rk = u.get("role")
            if rid:
                counts[rid] = counts.get(rid, 0) + 1
            elif rk:
                for r in rows:
                    if r.get("role_key") == rk:
                        counts[r["id"]] = counts.get(r["id"], 0) + 1
        for r in rows:
            r["user_count"] = counts.get(r["id"], 0)
        return rows

    @api.post("/staff/roles")
    async def create_role(payload: RoleIn, user: dict = Depends(require_perm("roles.manage"))):
        await assert_writeable(user)
        await ensure_clinic_roles(db, user.get("clinic_id"))
        cid = user.get("clinic_id")
        role_key = (payload.role_key or _slug_key(payload.role_name)).strip().lower()
        if role_key in LEGACY_ROLES and role_key != "super_admin":
            raise HTTPException(status_code=400, detail="Reserved role key — use a different name")
        existing = await db.clinic_roles.find_one({"clinic_id": cid, "role_key": role_key}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Role key already exists")
        perms = sanitize_permissions(payload.permissions)
        doc = {
            "id": str(uuid.uuid4()),
            "clinic_id": cid,
            "role_name": payload.role_name.strip(),
            "role_key": role_key,
            "description": (payload.description or "").strip(),
            "is_system_role": False,
            "is_active": payload.is_active,
            "permissions": perms,
            "created_by": user["id"],
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db.clinic_roles.insert_one(doc)
        doc.pop("_id", None)
        await audit(user, "create", "clinic_role", doc["id"], {"role_key": role_key})
        return doc

    @api.put("/staff/roles/{role_id}")
    async def update_role(
        role_id: str,
        payload: RoleUpdateIn,
        user: dict = Depends(require_perm("roles.manage")),
    ):
        await assert_writeable(user)
        role = await _get_role(user, role_id)
        data = payload.model_dump(exclude_none=True)
        if "permissions" in data:
            new_perms = sanitize_permissions(data["permissions"])
            owner_role_guard(role, new_perms, user)
            data["permissions"] = new_perms
        if role.get("is_system_role") and "role_name" in data:
            data["role_name"] = role["role_name"]
        if role.get("role_key") == "super_admin" and data.get("is_active") is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate Owner role")
        data["updated_at"] = _now_iso()
        await db.clinic_roles.update_one({"id": role_id}, {"$set": data})
        from audit_log import log_staff_role_change
        await log_staff_role_change(db, user, role_id, role, {**role, **data})
        updated = await _get_role(user, role_id)
        updated["system_role_warning"] = bool(role.get("is_system_role"))
        return updated

    @api.delete("/staff/roles/{role_id}")
    async def delete_role(role_id: str, user: dict = Depends(require_perm("roles.manage"))):
        await assert_writeable(user)
        role = await _get_role(user, role_id)
        if role.get("is_system_role"):
            raise HTTPException(status_code=400, detail="System roles cannot be deleted")
        in_use = await db.users.count_documents(scope(user, {"role_id": role_id}))
        if in_use > 0:
            raise HTTPException(status_code=400, detail=f"Role is assigned to {in_use} staff member(s)")
        await db.clinic_roles.update_one(
            {"id": role_id},
            {"$set": {"is_active": False, "updated_at": _now_iso()}},
        )
        await audit(user, "deactivate", "clinic_role", role_id)
        return {"ok": True}

    async def _resolve_user_role(user: dict, payload: StaffUserIn) -> tuple[str, str, str]:
        cid = user.get("clinic_id")
        if payload.role_id:
            role_doc = await db.clinic_roles.find_one(
                scope(user, {"id": payload.role_id, "is_active": True}),
                {"_id": 0},
            )
            if not role_doc:
                raise HTTPException(status_code=400, detail="Invalid role")
            return role_doc["id"], role_doc["role_key"], role_doc["role_name"]
        if payload.role:
            role_doc = await db.clinic_roles.find_one(
                scope(user, {"role_key": payload.role, "is_active": True}),
                {"_id": 0},
            )
            if role_doc:
                return role_doc["id"], role_doc["role_key"], role_doc["role_name"]
            if payload.role not in LEGACY_ROLES:
                raise HTTPException(status_code=400, detail="Unknown role")
            return None, payload.role, payload.role
        raise HTTPException(status_code=400, detail="Role is required")

    @api.get("/staff/users")
    async def list_staff_users(
        user: dict = Depends(require_perm("staff.view")),
        active_only: bool = False,
    ):
        flt = scope(user, {})
        if active_only:
            flt["active"] = {"$ne": False}
        rows = await db.users.find(flt, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(500)
        roles = {r["id"]: r for r in await db.clinic_roles.find(scope(user, {}), {"_id": 0}).to_list(200)}
        for row in rows:
            rd = roles.get(row.get("role_id")) or {}
            if not rd and row.get("role"):
                rd = next((r for r in roles.values() if r.get("role_key") == row.get("role")), {})
            row["role_name"] = rd.get("role_name") or row.get("role", "")
            row["role_key"] = rd.get("role_key") or row.get("role")
            if row.get("active") is None:
                row["active"] = True
        return rows

    @api.post("/staff/users")
    async def create_staff_user(payload: StaffUserIn, user: dict = Depends(require_perm("staff.manage"))):
        await assert_writeable(user)
        await assert_staff_capacity(user)
        if not payload.password:
            raise HTTPException(status_code=400, detail="Password required")
        email = payload.email.lower()
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="Email already exists")
        role_id, role_key, _ = await _resolve_user_role(user, payload)
        if role_key == "super_admin":
            owners = await db.users.count_documents(scope(user, {"role": "super_admin", "active": {"$ne": False}}))
            if owners >= 1:
                pass
        perf = (payload.performer_type or "").strip().lower() or None
        if perf and perf not in PERFORMER_TYPES:
            raise HTTPException(status_code=400, detail="Invalid performer type")
        doc = {
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(payload.password),
            "name": payload.name.strip(),
            "phone": (payload.phone or "").strip(),
            "job_title": (payload.job_title or "").strip(),
            "role": role_key,
            "role_id": role_id,
            "performer_type": perf,
            "active": payload.active,
            "notes": (payload.notes or "").strip(),
            "clinic_id": user.get("clinic_id"),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db.users.insert_one(doc)
        doc.pop("_id", None)
        doc.pop("password_hash", None)
        await audit(user, "create", "user", doc["id"])
        return doc

    @api.put("/staff/users/{uid}")
    async def update_staff_user(
        uid: str,
        payload: StaffUserIn,
        user: dict = Depends(require_perm("staff.manage")),
    ):
        await assert_writeable(user)
        target = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if uid == user["id"] and payload.active is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
        role_id, role_key, _ = await _resolve_user_role(user, payload)
        if target.get("role") == "super_admin" and role_key != "super_admin":
            owners = await db.users.count_documents(
                scope(user, {"role": "super_admin", "active": {"$ne": False}, "id": {"$ne": uid}}),
            )
            if owners < 1:
                raise HTTPException(status_code=400, detail="Clinic must have at least one active Owner")
        upd = {
            "email": payload.email.lower(),
            "name": payload.name.strip(),
            "phone": (payload.phone or "").strip(),
            "job_title": (payload.job_title or "").strip(),
            "role": role_key,
            "role_id": role_id,
            "performer_type": (payload.performer_type or "").strip().lower() or None,
            "active": payload.active,
            "notes": (payload.notes or "").strip(),
            "updated_at": _now_iso(),
        }
        if payload.password:
            upd["password_hash"] = hash_password(payload.password)
        perf = upd.get("performer_type")
        if perf and perf not in PERFORMER_TYPES:
            raise HTTPException(status_code=400, detail="Invalid performer type")
        await db.users.update_one({"id": uid}, {"$set": upd})
        from audit_log import log_staff_user_role_change
        await log_staff_user_role_change(db, user, uid, target, role_key, role_id)
        return await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "password_hash": 0})

    @api.delete("/staff/users/{uid}")
    async def delete_staff_user(uid: str, user: dict = Depends(require_perm("staff.manage"))):
        if uid == user["id"]:
            raise HTTPException(status_code=400, detail="Cannot delete your own account")
        await assert_writeable(user)
        target = await db.users.find_one(scope(user, {"id": uid}), {"_id": 0, "role": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("role") == "super_admin":
            owners = await db.users.count_documents(
                scope(user, {"role": "super_admin", "active": {"$ne": False}, "id": {"$ne": uid}}),
            )
            if owners < 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last Owner")
        r = await db.users.delete_one(scope(user, {"id": uid}))
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        await audit(user, "delete", "user", uid)
        return {"ok": True}

    async def _schedule_read_allowed(user: dict, uid: str) -> dict:
        user = await attach_permissions_to_user(db, user)
        if uid == user.get("id"):
            return user
        if user_has_permission(user, "staff.view"):
            return user
        if user.get("role") in ("super_admin", "manager", "fo"):
            return user
        raise HTTPException(status_code=403, detail="Not allowed")

    @api.get("/staff/users/{uid}/schedule")
    async def get_staff_schedule_legacy(uid: str, user: dict = Depends(get_current_user)):
        """Legacy shape for API compat — backed by weekly schedule + date overrides."""
        user = await _schedule_read_allowed(user, uid)
        u = await _staff_in_clinic(user, uid)
        cid = user.get("clinic_id")
        await migrate_legacy_user_schedule(db, cid, uid, u)
        weekly = await db.weekly_staff_schedules.find(
            scope(user, {"staff_id": uid}),
            {"_id": 0},
        ).to_list(20)
        working_hours = {}
        for row in weekly:
            if row.get("is_working"):
                working_hours[row["day_of_week"]] = {
                    "open": row.get("start_time", ""),
                    "close": row.get("end_time", ""),
                }
        overrides = await db.staff_date_overrides.find(
            scope(user, {"staff_id": uid}),
            {"_id": 0, "date": 1, "status": 1, "reason": 1},
        ).to_list(500)
        days_off = [
            {"date": o["date"], "reason": o.get("reason") or o.get("status", "")}
            for o in overrides
            if o.get("status") in ("off", "sick_leave", "annual_leave", "training")
        ]
        return {
            "id": u["id"],
            "name": u["name"],
            "role": u.get("role"),
            "performer_type": u.get("performer_type"),
            "working_hours": working_hours,
            "days_off": days_off,
        }

    @api.put("/staff/users/{uid}/schedule")
    async def set_staff_schedule_legacy(
        uid: str,
        payload: StaffScheduleIn,
        user: dict = Depends(get_current_user),
    ):
        user = await attach_permissions_to_user(db, user)
        can_edit = user_has_permission(user, "staff.manage") or uid == user["id"]
        if not can_edit:
            raise HTTPException(status_code=403, detail="Only staff managers or self can edit schedule")
        await assert_writeable(user)
        await _staff_in_clinic(user, uid)
        if payload.working_hours is not None:
            days = []
            for dow in DAY_KEYS:
                h = (payload.working_hours or {}).get(dow) or {}
                o = (h.get("open") or "").strip()
                c = (h.get("close") or "").strip()
                days.append(
                    WeeklyDayIn(
                        day_of_week=dow,
                        is_working=bool(o and c),
                        start_time=o,
                        end_time=c,
                    )
                )
            ws = WeeklyScheduleIn(days=days)
            cid = user.get("clinic_id")
            for day in ws.days:
                if day.is_working and day.start_time >= day.end_time:
                    raise HTTPException(status_code=400, detail=f"{day.day_of_week}: start must be before end")
                await db.weekly_staff_schedules.update_one(
                    {"clinic_id": cid, "staff_id": uid, "day_of_week": day.day_of_week},
                    {
                        "$set": {
                            "clinic_id": cid,
                            "staff_id": uid,
                            "day_of_week": day.day_of_week,
                            "is_working": day.is_working,
                            "start_time": day.start_time if day.is_working else "",
                            "end_time": day.end_time if day.is_working else "",
                            "break_start": "",
                            "break_end": "",
                            "notes": "",
                            "updated_at": _now_iso(),
                        },
                        "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()},
                    },
                    upsert=True,
                )
        if payload.days_off is not None:
            for item in payload.days_off:
                if isinstance(item, str):
                    item = {"date": item, "reason": ""}
                d = (item.get("date") or "").strip()
                if not d:
                    continue
                doc = {
                    "clinic_id": user["clinic_id"],
                    "staff_id": uid,
                    "date": d,
                    "status": "off",
                    "reason": (item.get("reason") or "").strip(),
                    "updated_at": _now_iso(),
                }
                await db.staff_date_overrides.update_one(
                    {"clinic_id": user["clinic_id"], "staff_id": uid, "date": d},
                    {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
                    upsert=True,
                )
        await audit(user, "update", "staff_schedule", uid)
        return await get_staff_schedule_legacy(uid, user)

    @api.get("/staff/schedule/users")
    async def schedule_staff_list(user: dict = Depends(require_perm("staff.view"))):
        flt = scope(user, {"active": {"$ne": False}})
        rows = await db.users.find(
            flt,
            {"_id": 0, "password_hash": 0},
        ).sort("name", 1).to_list(500)
        return rows

    register_staff_scheduling(
        api=api,
        db=db,
        get_current_user=get_current_user,
        scope=scope,
        audit=audit,
        attach_permissions_to_user=attach_permissions_to_user,
        user_has_permission=user_has_permission,
        assert_writeable=assert_writeable,
    )
