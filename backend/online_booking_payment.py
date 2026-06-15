"""Online booking payment — Phase 1 (clinic-owned gateway, no platform holding)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from permissions import user_has_permission
from saas import iso, now_utc

try:
    from cryptography.fernet import Fernet
except ImportError:  # pragma: no cover
    Fernet = None  # type: ignore

PAYMENT_STATUSES = frozenset({"pending", "success", "failed", "expired", "cancelled"})
PAYMENT_REQUIREMENTS = frozenset({"none", "full_payment", "deposit"})
DEPOSIT_TYPES = frozenset({"fixed", "percentage"})
PAYMENT_PROVIDERS = frozenset({"none", "midtrans", "xendit"})
PROVIDER_MODES = frozenset({"sandbox", "production"})
CONFIRMATION_RULES = frozenset({"confirm_after_payment", "allow_pending_payment"})

DEFAULT_ONLINE_BOOKING_PAYMENT: Dict[str, Any] = {
    "enable_online_booking_payment": False,
    "payment_requirement": "none",
    "deposit_type": "fixed",
    "deposit_value": 0,
    "payment_provider": "none",
    "provider_mode": "sandbox",
    "payment_expiry_minutes": 30,
    "booking_confirmation_rule": "confirm_after_payment",
    "provider_credentials_encrypted": None,
}

PUBLIC_PAYMENT_BOOKING_STATUSES = frozenset({
    "pending_payment", "confirmed", "payment_expired", "payment_failed",
})


def _fernet(secret: str, clinic_id: str) -> "Fernet":
    if Fernet is None:
        raise HTTPException(status_code=500, detail="cryptography package required for payment credentials")
    raw = hashlib.sha256(f"{secret}:{clinic_id}:online_booking_payment".encode()).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_provider_credentials(secret: str, clinic_id: str, creds: dict) -> str:
    f = _fernet(secret, clinic_id)
    payload = json.dumps(creds).encode("utf-8")
    return f.encrypt(payload).decode("utf-8")


def decrypt_provider_credentials(secret: str, clinic_id: str, encrypted: str) -> dict:
    if not encrypted:
        return {}
    f = _fernet(secret, clinic_id)
    try:
        return json.loads(f.decrypt(encrypted.encode("utf-8")).decode("utf-8"))
    except Exception as ex:
        raise HTTPException(status_code=500, detail="Could not decrypt payment credentials") from ex


def merge_payment_settings(raw: Optional[dict]) -> dict:
    out = dict(DEFAULT_ONLINE_BOOKING_PAYMENT)
    if raw:
        for k in DEFAULT_ONLINE_BOOKING_PAYMENT:
            if k in raw and raw[k] is not None:
                out[k] = raw[k]
    return out


def sanitize_settings_for_admin(settings: dict, *, has_credentials: bool) -> dict:
    out = {k: settings.get(k) for k in DEFAULT_ONLINE_BOOKING_PAYMENT if k != "provider_credentials_encrypted"}
    out["has_credentials"] = has_credentials
    out["credentials_configured"] = has_credentials
    return out


def sanitize_settings_for_public(settings: dict) -> dict:
    req = settings.get("payment_requirement") or "none"
    enabled = bool(settings.get("enable_online_booking_payment")) and req in ("full_payment", "deposit")
    return {
        "enable_online_booking_payment": enabled,
        "payment_requirement": req if enabled else "none",
        "deposit_type": settings.get("deposit_type") or "fixed",
        "payment_expiry_minutes": int(settings.get("payment_expiry_minutes") or 30),
        "booking_confirmation_rule": settings.get("booking_confirmation_rule") or "confirm_after_payment",
        "payment_provider": settings.get("payment_provider") if enabled else "none",
    }


def calculate_amount_due(settings: dict, booking_total_idr: int) -> Tuple[int, str]:
    total = max(0, int(booking_total_idr or 0))
    req = settings.get("payment_requirement") or "none"
    if not settings.get("enable_online_booking_payment") or req == "none":
        return 0, "none"
    if req == "full_payment":
        return total, "full_payment"
    if req == "deposit":
        dtype = settings.get("deposit_type") or "fixed"
        val = float(settings.get("deposit_value") or 0)
        if dtype == "percentage":
            amount = int(round(total * val / 100.0))
        else:
            amount = int(val)
        return min(total, max(0, amount)), "deposit"
    return 0, "none"


def payment_is_required(settings: dict) -> bool:
    if not settings.get("enable_online_booking_payment"):
        return False
    return (settings.get("payment_requirement") or "none") in ("full_payment", "deposit")


def _sanitize_provider_response(data: Any) -> dict:
    if not isinstance(data, dict):
        return {"raw": str(data)[:500]}
    out = dict(data)
    for key in list(out.keys()):
        if any(s in key.lower() for s in ("key", "secret", "token", "password", "authorization")):
            out[key] = "***"
    return out


class OnlineBookingPaymentSettingsIn(BaseModel):
    enable_online_booking_payment: bool = False
    payment_requirement: str = "none"
    deposit_type: str = "fixed"
    deposit_value: float = 0
    payment_provider: str = "none"
    provider_mode: str = "sandbox"
    payment_expiry_minutes: int = Field(30, ge=5, le=1440)
    booking_confirmation_rule: str = "confirm_after_payment"
    midtrans_server_key: Optional[str] = None
    midtrans_client_key: Optional[str] = None
    xendit_api_key: Optional[str] = None
    clear_credentials: bool = False


class PublicCheckoutIn(BaseModel):
    patient_name: str
    patient_phone: str
    patient_email: Optional[str] = ""
    nationality: Optional[str] = None
    nationality_code: Optional[str] = None
    patient_source: Optional[str] = None
    source_detail: Optional[str] = None
    treatment: str
    duration_min: int = 30
    scheduled_at: str
    notes: Optional[str] = ""
    package_id: Optional[str] = None
    booking_type: Optional[str] = "treatment"
    success_return_url: Optional[str] = None


def _validate_settings_payload(payload: OnlineBookingPaymentSettingsIn) -> None:
    if payload.payment_requirement not in PAYMENT_REQUIREMENTS:
        raise HTTPException(status_code=400, detail="Invalid payment_requirement")
    if payload.deposit_type not in DEPOSIT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid deposit_type")
    if payload.payment_provider not in PAYMENT_PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid payment_provider")
    if payload.provider_mode not in PROVIDER_MODES:
        raise HTTPException(status_code=400, detail="Invalid provider_mode")
    if payload.booking_confirmation_rule not in CONFIRMATION_RULES:
        raise HTTPException(status_code=400, detail="Invalid booking_confirmation_rule")


def _build_credentials_from_payload(
    payload: OnlineBookingPaymentSettingsIn,
    existing_encrypted: Optional[str],
    secret: str,
    clinic_id: str,
) -> Optional[str]:
    if payload.clear_credentials:
        return None
    creds: Dict[str, str] = {}
    if existing_encrypted:
        creds = decrypt_provider_credentials(secret, clinic_id, existing_encrypted)
    if payload.midtrans_server_key:
        creds["midtrans_server_key"] = payload.midtrans_server_key.strip()
    if payload.midtrans_client_key:
        creds["midtrans_client_key"] = payload.midtrans_client_key.strip()
    if payload.xendit_api_key:
        creds["xendit_api_key"] = payload.xendit_api_key.strip()
    if not creds:
        return existing_encrypted
    return encrypt_provider_credentials(secret, clinic_id, creds)


def _midtrans_base(mode: str) -> str:
    return "https://app.midtrans.com" if mode == "production" else "https://app.sandbox.midtrans.com"


def _xendit_base(mode: str) -> str:
    return "https://api.xendit.co"


def test_provider_connection(settings: dict, creds: dict) -> dict:
    provider = settings.get("payment_provider") or "none"
    mode = settings.get("provider_mode") or "sandbox"
    if provider == "midtrans":
        sk = creds.get("midtrans_server_key", "").strip()
        if not sk:
            raise HTTPException(status_code=400, detail="Midtrans server key is required")
        auth = base64.b64encode(f"{sk}:".encode()).decode()
        r = requests.get(
            f"{_midtrans_base(mode)}/snap/v1/transactions/status/dummy-test-connection",
            headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
            timeout=15,
        )
        # Midtrans returns 404/401 for dummy — treat 401 as bad key, other as reachable
        if r.status_code == 401:
            raise HTTPException(status_code=400, detail="Midtrans server key rejected (401)")
        return {"ok": True, "provider": "midtrans", "mode": mode, "http_status": r.status_code}
    if provider == "xendit":
        key = creds.get("xendit_api_key", "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Xendit API key is required")
        r = requests.get(
            f"{_xendit_base(mode)}/balance?account_type=CASH",
            auth=(key, ""),
            timeout=15,
        )
        if r.status_code == 401:
            raise HTTPException(status_code=400, detail="Xendit API key rejected (401)")
        if r.status_code >= 400:
            raise HTTPException(status_code=400, detail=f"Xendit test failed ({r.status_code})")
        return {"ok": True, "provider": "xendit", "mode": mode}
    raise HTTPException(status_code=400, detail="Select Midtrans or Xendit to test connection")


def create_provider_payment(
    *,
    settings: dict,
    creds: dict,
    order_id: str,
    amount: int,
    currency: str,
    customer: dict,
    expiry_minutes: int,
    clinic_name: str,
    success_return_url: Optional[str] = None,
) -> Tuple[str, str, dict]:
    provider = settings.get("payment_provider") or "none"
    mode = settings.get("provider_mode") or "sandbox"
    amount = max(1, int(amount))
    if provider == "midtrans":
        sk = creds.get("midtrans_server_key", "").strip()
        if not sk:
            raise HTTPException(status_code=400, detail="Midtrans is not configured for this clinic")
        auth = base64.b64encode(f"{sk}:".encode()).decode()
        body = {
            "transaction_details": {"order_id": order_id, "gross_amount": amount},
            "customer_details": {
                "first_name": customer.get("name") or "Guest",
                "email": customer.get("email") or "guest@booking.local",
                "phone": customer.get("phone") or "",
            },
            "credit_card": {"secure": True},
            "expiry": {
                "start_time": iso(now_utc()),
                "unit": "minutes",
                "duration": int(expiry_minutes),
            },
        }
        if success_return_url:
            body["callbacks"] = {"finish": success_return_url}
        r = requests.post(
            f"{_midtrans_base(mode)}/snap/v1/transactions",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
            json=body,
            timeout=30,
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Midtrans error: {r.text[:200]}")
        data = r.json()
        url = data.get("redirect_url") or ""
        ref = data.get("token") or order_id
        return url, ref, _sanitize_provider_response(data)
    if provider == "xendit":
        key = creds.get("xendit_api_key", "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Xendit is not configured for this clinic")
        body = {
            "external_id": order_id,
            "amount": amount,
            "description": f"Online booking — {clinic_name}"[:255],
            "invoice_duration": max(60, int(expiry_minutes) * 60),
            "currency": currency,
            "customer": {
                "given_names": (customer.get("name") or "Guest")[:255],
                "email": customer.get("email") or "guest@booking.local",
                "mobile_number": customer.get("phone") or "",
            },
        }
        if success_return_url:
            body["success_redirect_url"] = success_return_url
            body["failure_redirect_url"] = success_return_url
        r = requests.post(
            f"{_xendit_base(mode)}/v2/invoices",
            auth=(key, ""),
            json=body,
            timeout=30,
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Xendit error: {r.text[:200]}")
        data = r.json()
        url = data.get("invoice_url") or data.get("payment_url") or ""
        ref = data.get("id") or order_id
        return url, ref, _sanitize_provider_response(data)
    raise HTTPException(status_code=400, detail="Payment provider not configured")


async def load_clinic_payment_settings(db, clinic_id: str) -> dict:
    s = await db.settings.find_one({"id": "global", "clinic_id": clinic_id}, {"_id": 0})
    return merge_payment_settings((s or {}).get("online_booking_payment"))


async def save_clinic_payment_settings(db, clinic_id: str, settings: dict) -> None:
    await db.settings.update_one(
        {"id": "global", "clinic_id": clinic_id},
        {"$set": {"online_booking_payment": settings}},
        upsert=True,
    )


async def expire_stale_online_payments(db, clinic_id: str) -> int:
    now = iso(now_utc())
    n = 0
    async for pay in db.online_booking_payments.find(
        {"clinic_id": clinic_id, "status": "pending", "expires_at": {"$lt": now}},
        {"_id": 0},
    ):
        await db.online_booking_payments.update_one(
            {"id": pay["id"]},
            {"$set": {"status": "expired", "updated_at": now}},
        )
        bid = pay.get("booking_id")
        if bid:
            b = await db.bookings.find_one({"id": bid, "clinic_id": clinic_id}, {"_id": 0, "status": 1})
            if b and b.get("status") == "pending_payment":
                await db.bookings.update_one(
                    {"id": bid, "clinic_id": clinic_id},
                    {"$set": {"status": "payment_expired", "payment_status": "expired"}},
                )
        n += 1
    return n


async def mark_payment_success(
    db,
    payment: dict,
    *,
    amount_paid: Optional[int] = None,
    provider_reference: Optional[str] = None,
    raw: Optional[dict] = None,
    audit=None,
) -> None:
    now = iso(now_utc())
    upd = {
        "status": "success",
        "amount_paid": int(amount_paid if amount_paid is not None else payment.get("amount_due") or 0),
        "updated_at": now,
        "paid_at": now,
    }
    if provider_reference:
        upd["provider_reference_id"] = provider_reference
    if raw:
        upd["raw_provider_response"] = _sanitize_provider_response(raw)
    await db.online_booking_payments.update_one({"id": payment["id"]}, {"$set": upd})
    bid = payment.get("booking_id")
    if bid:
        await db.bookings.update_one(
            {"id": bid, "clinic_id": payment["clinic_id"]},
            {"$set": {"status": "confirmed", "payment_status": "paid", "confirmed_at": now}},
        )
    if audit:
        await audit(
            {"id": "payment_webhook", "email": "webhook@clinicos", "role": "system", "clinic_id": payment["clinic_id"]},
            "online_booking_payment_success",
            "online_booking_payment",
            payment["id"],
            {"booking_id": bid, "amount_paid": upd["amount_paid"]},
        )
    if bid:
        try:
            booking = await db.bookings.find_one({"id": bid, "clinic_id": payment["clinic_id"]}, {"_id": 0})
            if booking:
                import os
                from messaging import safe_trigger_booking_messaging
                safe_trigger_booking_messaging(
                    db, os.environ["JWT_SECRET"], payment["clinic_id"], booking, "confirmed",
                )
        except Exception:
            pass


async def mark_payment_failed(db, payment: dict, *, status: str = "failed", raw: Optional[dict] = None) -> None:
    now = iso(now_utc())
    if status not in ("failed", "expired", "cancelled"):
        status = "failed"
    await db.online_booking_payments.update_one(
        {"id": payment["id"]},
        {"$set": {"status": status, "updated_at": now, "raw_provider_response": _sanitize_provider_response(raw or {})}},
    )
    bid = payment.get("booking_id")
    if bid:
        booking_status = "payment_failed" if status == "failed" else "payment_expired"
        await db.bookings.update_one(
            {"id": bid, "clinic_id": payment["clinic_id"]},
            {"$set": {"status": booking_status, "payment_status": status}},
        )


def register_online_booking_payment(
    api: APIRouter,
    db,
    get_current_user,
    audit,
    jwt_secret: str,
    *,
    assert_feature=None,
    public_booking_helpers: dict,
):
    """Wire payment settings, public checkout, webhooks, and reports."""

    parse_iso = public_booking_helpers["parse_iso"]
    public_online_bookable_filter = public_booking_helpers["public_online_bookable_filter"]
    has_slot_conflict = public_booking_helpers["has_slot_conflict"]
    auto_pick_performer = public_booking_helpers["auto_pick_performer"]
    log_appointment_created = public_booking_helpers["log_appointment_created"]

    async def _resolve_catalog_price(clinic_id: str, treatment_name: str, package_id: Optional[str], booking_type: str) -> int:
        pub_flt = public_online_bookable_filter()
        if booking_type == "package" or package_id:
            flt: Dict[str, Any] = {"clinic_id": clinic_id, **pub_flt}
            if package_id:
                flt["id"] = package_id
            else:
                flt["name"] = treatment_name
            pkg = await db.packages.find_one(flt, {"_id": 0, "price_idr": 1})
            return int((pkg or {}).get("price_idr") or 0)
        tdoc = await db.treatments.find_one(
            {"clinic_id": clinic_id, "name": treatment_name, **pub_flt},
            {"_id": 0, "price_idr": 1},
        )
        return int((tdoc or {}).get("price_idr") or 0)

    async def _owner_settings_dep(user: dict = Depends(get_current_user)):
        if user.get("platform_admin"):
            raise HTTPException(status_code=400, detail="Clinic account required")
        if not user_has_permission(user, "settings.manage") and user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Owner settings access required")
        if assert_feature:
            await assert_feature(user, "online_booking_payment")
        return user

    @api.get("/settings/online-booking-payment")
    async def get_online_booking_payment_settings(user: dict = Depends(_owner_settings_dep)):
        cid = user.get("clinic_id")
        sdoc = await db.settings.find_one({"id": "global", "clinic_id": cid}, {"_id": 0})
        merged = merge_payment_settings((sdoc or {}).get("online_booking_payment"))
        enc = merged.pop("provider_credentials_encrypted", None)
        return sanitize_settings_for_admin(merged, has_credentials=bool(enc))

    @api.put("/settings/online-booking-payment")
    async def update_online_booking_payment_settings(
        payload: OnlineBookingPaymentSettingsIn,
        user: dict = Depends(_owner_settings_dep),
    ):
        _validate_settings_payload(payload)
        cid = user.get("clinic_id")
        sdoc = await db.settings.find_one({"id": "global", "clinic_id": cid}, {"_id": 0})
        existing = merge_payment_settings((sdoc or {}).get("online_booking_payment"))
        enc = existing.get("provider_credentials_encrypted")
        new_enc = _build_credentials_from_payload(payload, enc, jwt_secret, cid)
        saved = {
            "enable_online_booking_payment": payload.enable_online_booking_payment,
            "payment_requirement": payload.payment_requirement,
            "deposit_type": payload.deposit_type,
            "deposit_value": payload.deposit_value,
            "payment_provider": payload.payment_provider,
            "provider_mode": payload.provider_mode,
            "payment_expiry_minutes": payload.payment_expiry_minutes,
            "booking_confirmation_rule": payload.booking_confirmation_rule,
            "provider_credentials_encrypted": new_enc,
        }
        if payment_is_required(saved) and (saved.get("payment_provider") or "none") == "none":
            raise HTTPException(status_code=400, detail="Select a payment provider when payment is required")
        await save_clinic_payment_settings(db, cid, saved)
        await audit(user, "update", "online_booking_payment_settings", cid, {"enabled": saved["enable_online_booking_payment"]})
        return sanitize_settings_for_admin(saved, has_credentials=bool(new_enc))

    @api.post("/settings/online-booking-payment/test-connection")
    async def test_online_booking_payment_connection(user: dict = Depends(_owner_settings_dep)):
        cid = user.get("clinic_id")
        settings = await load_clinic_payment_settings(db, cid)
        enc = settings.get("provider_credentials_encrypted")
        if not enc:
            raise HTTPException(status_code=400, detail="Save provider credentials first")
        creds = decrypt_provider_credentials(jwt_secret, cid, enc)
        return test_provider_connection(settings, creds)

    @api.get("/reports/online-booking-payments")
    async def report_online_booking_payments(
        status: Optional[str] = None,
        provider: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        if assert_feature:
            await assert_feature(user, "online_booking_payment")
        if not user_has_permission(user, "reports.view") and not user_has_permission(user, "billing.view"):
            if user.get("role") not in ("super_admin", "manager"):
                raise HTTPException(status_code=403, detail="Not allowed")
        cid = user.get("clinic_id")
        flt: Dict[str, Any] = {"clinic_id": cid}
        if status:
            flt["status"] = status
        if provider:
            flt["provider"] = provider
        rows = await db.online_booking_payments.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        summary: Dict[str, int] = {}
        for r in rows:
            summary[r.get("status") or "unknown"] = summary.get(r.get("status") or "unknown", 0) + 1
        return {"items": rows, "summary": summary, "count": len(rows)}

    @api.get("/public/clinics/{slug}/online-booking-payment")
    async def public_payment_config(slug: str):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        settings = await load_clinic_payment_settings(db, c["id"])
        return sanitize_settings_for_public(settings)

    @api.post("/public/clinics/{slug}/bookings/checkout")
    async def public_checkout_booking(slug: str, payload: PublicCheckoutIn):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        sub = c.get("subscription", {})
        if sub.get("status") not in ("trial", "active"):
            raise HTTPException(status_code=402, detail="Bookings temporarily disabled for this clinic")
        settings = await load_clinic_payment_settings(db, c["id"])
        if not payment_is_required(settings):
            raise HTTPException(status_code=400, detail="Online booking payment is not enabled for this clinic")

        await expire_stale_online_payments(db, c["id"])

        from public_booking_time import assert_public_scheduled_at_valid
        try:
            assert_public_scheduled_at_valid(c, payload.scheduled_at)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at")

        booking_type = (payload.booking_type or "treatment").strip().lower()
        package_id = (payload.package_id or "").strip() or None
        treatment_name = payload.treatment.strip()
        duration_min = int(payload.duration_min or 30)
        pub_flt = public_online_bookable_filter()

        if booking_type == "package" or package_id:
            pkg_flt: Dict[str, Any] = {"clinic_id": c["id"], **pub_flt}
            if package_id:
                pkg_flt["id"] = package_id
            else:
                pkg_flt["name"] = treatment_name
            pkg = await db.packages.find_one(pkg_flt, {"_id": 0})
            if not pkg:
                raise HTTPException(status_code=400, detail="Package not available for online booking")
            booking_type = "package"
            package_id = pkg["id"]
            treatment_name = pkg["name"]
            duration_min = int(pkg.get("duration_min") or duration_min or 60)
        else:
            tdoc = await db.treatments.find_one(
                {"clinic_id": c["id"], "name": treatment_name, **pub_flt},
                {"_id": 0},
            )
            if not tdoc:
                raise HTTPException(status_code=400, detail="Treatment not available for online booking")
            booking_type = "treatment"
            package_id = None
            duration_min = int(tdoc.get("duration_min") or duration_min or 30)

        if await has_slot_conflict(
            c["id"], treatment_name, payload.scheduled_at, duration_min,
            package_id=package_id, booking_type=booking_type,
        ):
            raise HTTPException(status_code=409, detail="Slot just got taken — please pick another")

        total_idr = await _resolve_catalog_price(c["id"], treatment_name, package_id, booking_type)
        amount_due, req_type = calculate_amount_due(settings, total_idr)
        if amount_due <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")

        auto_performer_id = await auto_pick_performer(
            c["id"], treatment_name, payload.scheduled_at, duration_min,
            package_id=package_id, booking_type=booking_type,
        )

        from public_booking_patient import (
            normalize_public_email,
            normalize_public_phone,
            resolve_public_booking_patient,
        )

        normalized_phone = normalize_public_phone(payload.patient_phone)
        normalized_email = normalize_public_email(payload.patient_email)
        patient_id, _patient_matched = await resolve_public_booking_patient(
            db,
            c["id"],
            patient_name=payload.patient_name,
            patient_phone=payload.patient_phone,
            patient_email=payload.patient_email or "",
            nationality=payload.nationality,
            nationality_code=payload.nationality_code,
            patient_source=payload.patient_source,
            source_detail=payload.source_detail,
        )

        booking_id = str(uuid.uuid4())
        payment_id = str(uuid.uuid4())
        order_id = f"ob-{booking_id[:8]}-{payment_id[:8]}"
        expiry_min = int(settings.get("payment_expiry_minutes") or 30)
        expires_at = iso(now_utc() + timedelta(minutes=expiry_min))
        currency = c.get("currency") or "IDR"

        enc = settings.get("provider_credentials_encrypted")
        if not enc:
            raise HTTPException(status_code=400, detail="Clinic payment gateway is not configured")
        creds = decrypt_provider_credentials(jwt_secret, c["id"], enc)

        payment_url, provider_ref, raw_create = create_provider_payment(
            settings=settings,
            creds=creds,
            order_id=order_id,
            amount=amount_due,
            currency=currency,
            customer={"name": payload.patient_name, "email": normalized_email, "phone": normalized_phone},
            expiry_minutes=expiry_min,
            clinic_name=c.get("name") or slug,
            success_return_url=(payload.success_return_url or "").strip() or None,
        )

        booking = {
            "id": booking_id,
            "clinic_id": c["id"],
            "patient_id": patient_id,
            "patient_name": payload.patient_name,
            "patient_phone": payload.patient_phone,
            "patient_email": normalized_email,
            "treatment": treatment_name,
            "duration_min": duration_min,
            "scheduled_at": payload.scheduled_at,
            "performer_id": auto_performer_id,
            "performer_auto_assigned": bool(auto_performer_id),
            "notes": payload.notes or "",
            "booking_type": booking_type,
            "package_id": package_id,
            "subtotal_idr": total_idr,
            "total_idr": total_idr,
            "status": "pending_payment",
            "payment_status": "pending",
            "source": "public",
            "online_payment_id": payment_id,
            "created_at": iso(now_utc()),
            "wa_history": [],
        }
        payment_doc = {
            "id": payment_id,
            "clinic_id": c["id"],
            "booking_id": booking_id,
            "patient_id": patient_id,
            "provider": settings.get("payment_provider"),
            "provider_reference_id": provider_ref,
            "provider_order_id": order_id,
            "payment_requirement": req_type,
            "amount_due": amount_due,
            "amount_paid": 0,
            "booking_total_idr": total_idr,
            "currency": currency,
            "status": "pending",
            "payment_url": payment_url,
            "expires_at": expires_at,
            "raw_provider_response": raw_create,
            "created_at": iso(now_utc()),
            "updated_at": iso(now_utc()),
        }
        await db.bookings.insert_one(booking)
        await db.online_booking_payments.insert_one(payment_doc)
        booking.pop("_id", None)
        payment_doc.pop("_id", None)

        guest = {
            "id": "public_booking",
            "email": normalized_email or "public@guest",
            "role": "guest",
            "name": payload.patient_name.strip(),
            "clinic_id": c["id"],
        }
        await log_appointment_created(db, guest, booking)

        try:
            from messaging import safe_trigger_booking_messaging
            safe_trigger_booking_messaging(
                db, jwt_secret, c["id"], booking, "payment_pending", payment_url=payment_url,
            )
        except Exception:
            pass

        return {
            "booking": booking,
            "payment": {
                "id": payment_id,
                "amount_due": amount_due,
                "booking_total_idr": total_idr,
                "payment_requirement": req_type,
                "currency": currency,
                "status": "pending",
                "payment_url": payment_url,
                "expires_at": expires_at,
                "provider": settings.get("payment_provider"),
            },
        }

    @api.get("/public/clinics/{slug}/bookings/{booking_id}/payment-status")
    async def public_payment_status(slug: str, booking_id: str):
        c = await db.clinics.find_one({"slug": slug}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Clinic not found")
        await expire_stale_online_payments(db, c["id"])
        b = await db.bookings.find_one({"id": booking_id, "clinic_id": c["id"]}, {"_id": 0})
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        pay = None
        if b.get("online_payment_id"):
            pay = await db.online_booking_payments.find_one(
                {"id": b["online_payment_id"], "clinic_id": c["id"]},
                {"_id": 0},
            )
        return {
            "booking_id": booking_id,
            "booking_status": b.get("status"),
            "payment_status": (pay or {}).get("status") or b.get("payment_status"),
            "amount_due": (pay or {}).get("amount_due"),
            "amount_paid": (pay or {}).get("amount_paid"),
            "expires_at": (pay or {}).get("expires_at"),
            "confirmed": b.get("status") == "confirmed",
        }

    @api.post("/webhooks/payments/midtrans")
    async def webhook_midtrans(request: Request):
        raw_body = await request.body()
        try:
            body = json.loads(raw_body.decode("utf-8"))
        except Exception:
            body = {}
        order_id = body.get("order_id") or body.get("transaction_id")
        if not order_id:
            return {"ok": True}
        pay = await db.online_booking_payments.find_one({"provider_order_id": order_id}, {"_id": 0})
        if not pay:
            return {"ok": True}
        settings = await load_clinic_payment_settings(db, pay["clinic_id"])
        enc = settings.get("provider_credentials_encrypted")
        if enc:
            creds = decrypt_provider_credentials(jwt_secret, pay["clinic_id"], enc)
            sk = creds.get("midtrans_server_key", "")
            sig = request.headers.get("X-Signature") or request.headers.get("X-Midtrans-Signature")
            if sk and sig:
                digest = hmac.new(sk.encode(), raw_body, hashlib.sha512).hexdigest()
                if not hmac.compare_digest(digest, sig):
                    raise HTTPException(status_code=403, detail="Invalid signature")
        status = (body.get("transaction_status") or body.get("status") or "").lower()
        if status in ("capture", "settlement", "success"):
            await mark_payment_success(
                db, pay,
                amount_paid=int(body.get("gross_amount") or pay.get("amount_due") or 0),
                provider_reference=body.get("transaction_id") or order_id,
                raw=body,
                audit=audit,
            )
        elif status in ("deny", "cancel", "failure", "failed"):
            await mark_payment_failed(db, pay, status="failed", raw=body)
        elif status in ("expire", "expired"):
            await mark_payment_failed(db, pay, status="expired", raw=body)
        return {"ok": True}

    @api.post("/webhooks/payments/xendit")
    async def webhook_xendit(request: Request):
        body = await request.json()
        callback_token = request.headers.get("x-callback-token") or ""
        external_id = body.get("external_id") or body.get("id")
        pay = None
        if external_id:
            pay = await db.online_booking_payments.find_one({"provider_order_id": external_id}, {"_id": 0})
        if not pay and body.get("id"):
            pay = await db.online_booking_payments.find_one({"provider_reference_id": body.get("id")}, {"_id": 0})
        if not pay:
            return {"ok": True}
        settings = await load_clinic_payment_settings(db, pay["clinic_id"])
        enc = settings.get("provider_credentials_encrypted")
        if enc:
            creds = decrypt_provider_credentials(jwt_secret, pay["clinic_id"], enc)
            expected = creds.get("xendit_callback_token") or creds.get("xendit_api_key") or ""
            if expected and callback_token and callback_token != expected:
                raise HTTPException(status_code=403, detail="Invalid callback token")
        status = (body.get("status") or "").upper()
        if status == "PAID":
            await mark_payment_success(
                db, pay,
                amount_paid=int(body.get("paid_amount") or body.get("amount") or pay.get("amount_due") or 0),
                provider_reference=body.get("id"),
                raw=body,
                audit=audit,
            )
        elif status in ("EXPIRED",):
            await mark_payment_failed(db, pay, status="expired", raw=body)
        elif status in ("FAILED",):
            await mark_payment_failed(db, pay, status="failed", raw=body)
        return {"ok": True}
