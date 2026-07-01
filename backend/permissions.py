"""Permission catalog and role resolution for clinic staff."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

# Module.action permission keys
PERMISSION_CATALOG: Dict[str, List[Dict[str, str]]] = {
    "Dashboard": [
        {"key": "dashboard.view", "label": "View dashboard"},
    ],
    "Schedule": [
        {"key": "schedule.view_own", "label": "View own schedule"},
    ],
    "Profile": [
        {"key": "profile.view_own", "label": "View own profile"},
        {"key": "profile.edit_own", "label": "Edit own profile"},
    ],
    "Patients": [
        {"key": "patients.view", "label": "View all patients"},
        {"key": "patients.view_assigned", "label": "View assigned patients only"},
        {"key": "patients.create", "label": "Create patients"},
        {"key": "patients.edit", "label": "Edit patients"},
        {"key": "patients.export", "label": "Export patients (Excel/CSV)"},
        {"key": "patients.delete", "label": "Delete patients"},
    ],
    "Appointments": [
        {"key": "appointments.view", "label": "View bookings"},
        {"key": "appointments.create", "label": "Create bookings"},
        {"key": "appointments.edit", "label": "Edit bookings"},
        {"key": "appointments.cancel", "label": "Cancel bookings"},
        {"key": "appointments.override_conflict", "label": "Override schedule conflicts (double-book staff)"},
        {"key": "bookings.create_overtime", "label": "Create overtime bookings (outside working hours)"},
        {"key": "coupons.manage", "label": "Manage campaigns (legacy permission key)"},
        {"key": "campaigns.view", "label": "View campaigns"},
        {"key": "campaigns.manage", "label": "Manage campaigns"},
        {"key": "loyalty.view", "label": "View loyalty program"},
        {"key": "loyalty.manage", "label": "Manage loyalty program"},
    ],
    "Visits": [
        {"key": "visits.view", "label": "View all visits"},
        {"key": "visits.view_own", "label": "View own assigned visits"},
    ],
    "Clinical records": [
        {"key": "clinical_records.view", "label": "View clinical records"},
        {"key": "clinical_records.create", "label": "Create clinical records"},
        {"key": "clinical_records.edit", "label": "Edit clinical records"},
    ],
    "Billing": [
        {"key": "billing.view", "label": "View billing / invoices"},
        {"key": "invoices.view", "label": "View invoices (read-only)"},
        {"key": "billing.create", "label": "Create invoices & payments"},
        {"key": "billing.edit", "label": "Edit invoices"},
        {"key": "payments.void", "label": "Void invoice payments"},
        {"key": "refunds.view", "label": "View refunds and adjustments"},
        {"key": "refunds.create", "label": "Record refunds and adjustments"},
        {"key": "billing.subscription_view", "label": "View SaaS subscription plans & quotes"},
        {"key": "billing.subscribe", "label": "Manage clinic subscription & plan payments"},
    ],
    "Packages": [
        {"key": "packages.view", "label": "View patient packages"},
        {"key": "packages.use", "label": "Use package sessions"},
        {"key": "packages.adjust", "label": "Adjust packages"},
        {"key": "packages.report", "label": "View package reports"},
    ],
    "Catalog": [
        {"key": "treatments.manage", "label": "Manage treatments catalog"},
        {"key": "packages_catalog.manage", "label": "Manage packages catalog"},
        {"key": "products.manage", "label": "Manage products catalog"},
    ],
    "Commission": [
        {"key": "commission.view", "label": "View all staff commissions"},
        {"key": "commission.view_own", "label": "View own commission only"},
        {"key": "commission.manage", "label": "Manage commission rules"},
    ],
    "Reports": [
        {"key": "reports.view", "label": "View reports"},
        {"key": "analytics.view", "label": "View marketing & business analytics"},
    ],
    "Inventory": [
        {"key": "inventory.view", "label": "View inventory"},
        {"key": "inventory.manage", "label": "Manage inventory"},
        {"key": "inventory.usage_record", "label": "Record treatment product usage"},
    ],
    "POS": [
        {"key": "pos.view", "label": "View POS sales"},
        {"key": "pos.create", "label": "Create and complete POS sales"},
        {"key": "pos.override_price", "label": "Override POS line prices (gift cards, etc.)"},
        {"key": "pos.cancel", "label": "Cancel POS sales"},
    ],
    "Gift cards": [
        {"key": "gift_cards.view", "label": "View gift cards and balances"},
        {"key": "gift_cards.create", "label": "Issue gift cards (POS sales)"},
        {"key": "gift_cards.redeem", "label": "Redeem gift cards as payment"},
        {"key": "gift_cards.cancel", "label": "Cancel gift cards"},
        {"key": "gift_cards.set_code", "label": "Set custom gift card code on issue"},
    ],
    "Prepaid": [
        {"key": "prepaid.view", "label": "View patient prepaid balances"},
        {"key": "prepaid.sell", "label": "Sell prepaid (POS)"},
        {"key": "prepaid.redeem", "label": "Redeem prepaid on invoices"},
        {"key": "prepaid.refund", "label": "Refund unused prepaid"},
        {"key": "prepaid.void", "label": "Void mistaken prepaid sales"},
    ],
    "Wallet": [
        {"key": "wallet.view", "label": "View patient wallet balances and history"},
        {"key": "wallet.adjust", "label": "Manual wallet credit adjustments"},
        {"key": "wallet.use", "label": "Use store credit for payments"},
        {"key": "wallet.export", "label": "Export wallet reports"},
    ],
    "Closing": [
        {"key": "closing.view", "label": "View daily closing preview and history"},
        {"key": "closing.create", "label": "Close business day"},
        {"key": "closing.reopen", "label": "Reopen closed business day"},
        {"key": "accounting.view", "label": "Accounting access (finance modules, read-only operations)"},
    ],
    "Staff": [
        {"key": "staff.view", "label": "View staff"},
        {"key": "staff.manage", "label": "Manage staff & schedules"},
    ],
    "Roles": [
        {"key": "roles.view", "label": "View roles"},
        {"key": "roles.manage", "label": "Manage roles & permissions"},
    ],
    "Settings": [
        {"key": "settings.view", "label": "View clinic settings"},
        {"key": "settings.manage", "label": "Manage clinic settings"},
    ],
    "Audit": [
        {"key": "audit.view", "label": "View audit log"},
    ],
    "Consent": [
        {"key": "consent.view", "label": "View consent forms"},
        {"key": "consent.send", "label": "Send and collect consent signatures"},
        {"key": "consent.manage", "label": "Manage consent templates"},
    ],
    "Messaging": [
        {"key": "messaging.manage", "label": "Configure messaging provider and templates"},
        {"key": "messaging.send", "label": "Send and resend patient messages"},
        {"key": "messaging.view", "label": "View message log"},
        {"key": "messaging.automation.view", "label": "View messaging automation rules"},
        {"key": "messaging.automation.manage", "label": "Manage messaging automation rules"},
    ],
}

ALL_PERMISSION_KEYS: Set[str] = {
    p["key"] for perms in PERMISSION_CATALOG.values() for p in perms
}

OWNER_PROTECTED = frozenset({"roles.manage", "staff.manage", "settings.manage"})

CLINICAL_SYSTEM_ROLE_KEYS = frozenset({"doctor", "therapist", "nurse"})

ACCOUNTING_ROLE_KEY = "accounting"

_ACCOUNTING_BASE_PERMS = {
    "accounting.view",
    "closing.view",
    "reports.view",
    "billing.view",
    "invoices.view",
    "pos.view",
    "gift_cards.view",
    "prepaid.view",
    "prepaid.refund",
    "refunds.view",
    "wallet.view",
    "wallet.export",
    "profile.view_own",
    "profile.edit_own",
}

_CLINICAL_BASE_PERMS = {
    "dashboard.view",
    "schedule.view_own",
    "visits.view_own",
    "patients.view_assigned",
    "profile.view_own",
    "profile.edit_own",
    "commission.view_own",
    "clinical_records.view",
    "clinical_records.create",
    "clinical_records.edit",
    "packages.view",
    "consent.view",
    "inventory.view",
    "inventory.usage_record",
}

SYSTEM_ROLE_DEFINITIONS = [
    {
        "role_key": "super_admin",
        "role_name": "Owner",
        "description": "Full clinic access. Cannot be deleted.",
        "is_system_role": True,
        "permissions": sorted(ALL_PERMISSION_KEYS),
    },
    {
        "role_key": "manager",
        "role_name": "Manager",
        "description": "Operations, staff, reports, and most clinic modules.",
        "is_system_role": True,
        "permissions": sorted({
            "dashboard.view", "patients.view", "patients.create", "patients.edit", "patients.export",
            "appointments.view", "appointments.create", "appointments.edit", "appointments.cancel",
            "appointments.override_conflict", "bookings.create_overtime", "coupons.manage", "campaigns.view", "campaigns.manage",
            "loyalty.view", "loyalty.manage",
            "visits.view", "clinical_records.view", "billing.view", "billing.create", "billing.edit",
            "payments.void", "refunds.view", "refunds.create",
            "billing.subscription_view", "billing.subscribe",
            "packages.view", "packages.use", "packages.adjust", "packages.report",
            "treatments.manage", "packages_catalog.manage", "products.manage",
            "inventory.view", "inventory.manage", "inventory.usage_record",
            "commission.view", "commission.manage", "reports.view", "analytics.view",
            "staff.view", "staff.manage", "roles.view", "roles.manage",
            "settings.view", "settings.manage", "audit.view",
            "consent.view", "consent.send", "consent.manage",
            "messaging.manage", "messaging.send", "messaging.view",
            "messaging.automation.view", "messaging.automation.manage",
            "pos.view", "pos.create", "pos.override_price", "pos.cancel",
            "gift_cards.view", "gift_cards.create", "gift_cards.redeem", "gift_cards.cancel",
            "prepaid.view", "prepaid.sell", "prepaid.redeem", "prepaid.refund", "prepaid.void",
            "wallet.view", "wallet.adjust", "wallet.use", "wallet.export",
            "closing.view", "closing.create", "closing.reopen",
            "accounting.view",
        }),
    },
    {
        "role_key": "fo",
        "role_name": "Front Office",
        "description": "Front desk, bookings, patients, and billing.",
        "is_system_role": True,
        "permissions": sorted({
            "dashboard.view", "patients.view", "patients.create", "patients.edit", "patients.export",
            "appointments.view", "appointments.create", "appointments.edit", "appointments.cancel",
            "visits.view", "billing.view", "billing.create", "billing.edit",
            "payments.void", "refunds.create",
            "packages.view", "packages.use", "packages.report",
            "treatments.manage", "packages_catalog.manage", "products.manage",
            "settings.view",
            "consent.view", "consent.send",
            "messaging.send", "messaging.view",
            "messaging.automation.view",
            "pos.view", "pos.create", "pos.cancel",
            "gift_cards.view", "gift_cards.create", "gift_cards.redeem",
            "prepaid.view", "prepaid.sell", "prepaid.redeem",
            "wallet.view", "wallet.use",
            "closing.view", "closing.create",
        }),
    },
    {
        "role_key": "doctor",
        "role_name": "Doctor",
        "description": "Clinical visits and records.",
        "is_system_role": True,
        "permissions": sorted(_CLINICAL_BASE_PERMS),
    },
    {
        "role_key": "therapist",
        "role_name": "Therapist",
        "description": "Treatment visits and therapist records.",
        "is_system_role": True,
        "permissions": sorted(_CLINICAL_BASE_PERMS),
    },
    {
        "role_key": "nurse",
        "role_name": "Nurse",
        "description": "Clinical support, treatments, and assigned visits.",
        "is_system_role": True,
        "permissions": sorted(_CLINICAL_BASE_PERMS),
    },
    {
        "role_key": ACCOUNTING_ROLE_KEY,
        "role_name": "Accounting",
        "description": "Finance review: reports, invoices, POS history, and daily closing (no clinical or operations).",
        "is_system_role": True,
        "permissions": sorted(_ACCOUNTING_BASE_PERMS),
    },
]

PERFORMER_TYPES = frozenset({
    "doctor", "therapist", "nurse", "front_office", "manager", "owner", "other",
})


def catalog_flat() -> List[dict]:
    out = []
    for group, perms in PERMISSION_CATALOG.items():
        for p in perms:
            out.append({**p, "module": group})
    return out


def sanitize_permissions(raw: Optional[List[str]]) -> List[str]:
    if not raw:
        return []
    return sorted({k for k in raw if k in ALL_PERMISSION_KEYS})


def user_has_permission(user: dict, permission: str) -> bool:
    if user.get("platform_admin"):
        return True
    if user.get("role") == "super_admin":
        return True
    perms = user.get("permissions") or []
    if permission in perms:
        return True
    # Legacy alias removed from catalog; treat as cancel.
    if permission == "gift_cards.cancel" and "gift_cards.manage" in perms:
        return True
    return False


def normalize_gift_card_permissions(perms: Set[str]) -> Set[str]:
    """Map retired gift_cards.manage to gift_cards.cancel when syncing roles."""
    out = set(perms)
    if "gift_cards.manage" in out:
        out.discard("gift_cards.manage")
        out.add("gift_cards.cancel")
    return out


def user_can_view_invoices(user: dict) -> bool:
    return user_has_permission(user, "billing.view") or user_has_permission(user, "invoices.view")


def is_accounting_user(user: dict) -> bool:
    rk = user.get("role_key") or user.get("role")
    return rk == ACCOUNTING_ROLE_KEY


def can_manage_roles(user: dict) -> bool:
    return user_has_permission(user, "roles.manage")


def owner_role_guard(role_doc: dict, new_permissions: List[str], editor: dict) -> None:
    """Prevent owner from stripping critical permissions from owner role."""
    if role_doc.get("role_key") != "super_admin":
        return
    if editor.get("role") != "super_admin" and not editor.get("platform_admin"):
        return
    missing = OWNER_PROTECTED - set(new_permissions)
    if missing:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail="Owner role must retain staff.manage, roles.manage, and settings.manage",
        )


async def ensure_clinic_roles(db, clinic_id: str) -> None:
    """Seed system roles for a clinic if missing; merge new permissions into existing system roles."""
    import uuid
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    for spec in SYSTEM_ROLE_DEFINITIONS:
        existing = await db.clinic_roles.find_one(
            {"clinic_id": clinic_id, "role_key": spec["role_key"]},
            {"_id": 0},
        )
        if not existing:
            await db.clinic_roles.insert_one({
                "id": str(uuid.uuid4()),
                "clinic_id": clinic_id,
                "role_name": spec["role_name"],
                "role_key": spec["role_key"],
                "description": spec.get("description", ""),
                "is_system_role": True,
                "is_active": True,
                "permissions": spec["permissions"],
                "created_at": now,
                "updated_at": now,
            })
            continue
        if not existing.get("is_system_role", True):
            continue
        spec_perms = normalize_gift_card_permissions(set(spec["permissions"]))
        existing_perms = normalize_gift_card_permissions(set(existing.get("permissions") or []))
        merged = normalize_gift_card_permissions(existing_perms | spec_perms)
        updates: Dict[str, Any] = {}
        if spec["role_key"] in CLINICAL_SYSTEM_ROLE_KEYS or spec["role_key"] == ACCOUNTING_ROLE_KEY:
            if existing_perms != spec_perms:
                updates["permissions"] = sorted(spec_perms)
        elif merged != existing_perms:
            updates["permissions"] = sorted(merged)
        if existing.get("role_name") != spec["role_name"]:
            updates["role_name"] = spec["role_name"]
        if updates:
            updates["updated_at"] = now
            await db.clinic_roles.update_one(
                {"clinic_id": clinic_id, "id": existing["id"]},
                {"$set": updates},
            )


async def resolve_role_for_user(db, user: dict) -> Optional[dict]:
    if not user.get("clinic_id"):
        return None
    cid = user["clinic_id"]
    if user.get("role_id"):
        doc = await db.clinic_roles.find_one(
            {"clinic_id": cid, "id": user["role_id"], "is_active": True},
            {"_id": 0},
        )
        if doc:
            return doc
    role_key = user.get("role")
    if role_key:
        return await db.clinic_roles.find_one(
            {"clinic_id": cid, "role_key": role_key, "is_active": True},
            {"_id": 0},
        )
    return None


async def attach_permissions_to_user(db, user: dict) -> dict:
    if user.get("platform_admin"):
        user = dict(user)
        user["permissions"] = sorted(ALL_PERMISSION_KEYS)
        user["role_name"] = "Platform Admin"
        return user
    role_doc = await resolve_role_for_user(db, user)
    user = dict(user)
    if role_doc:
        user["permissions"] = role_doc.get("permissions") or []
        user["role_id"] = role_doc.get("id")
        user["role_name"] = role_doc.get("role_name")
        user["role_key"] = role_doc.get("role_key")
    elif user.get("role") == "super_admin":
        user["permissions"] = sorted(ALL_PERMISSION_KEYS)
        user["role_name"] = "Owner"
        user["role_key"] = "super_admin"
    else:
        user["permissions"] = []
        user["role_key"] = user.get("role")
    return user


def legacy_can(user: dict, action: str) -> bool:
    """Map legacy can() actions to permissions."""
    mapping = {
        "create_patient": "patients.create",
        "delete_patient": "patients.delete",
        "create_visit": "visits.view",
        "edit_clinical": "clinical_records.edit",
        "edit_therapist": "clinical_records.edit",
        "add_treatment": "clinical_records.edit",
        "upload_photo": "clinical_records.edit",
        "edit_mapping": "clinical_records.edit",
        "close_visit": "billing.edit",
        "view_audit": "audit.view",
    }
    perm = mapping.get(action)
    if perm:
        return user_has_permission(user, perm)
    return False
