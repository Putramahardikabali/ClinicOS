"""Public consent links — secure token-based patient signing (Phase 3)."""
from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from consent_forms import (
    _can_send,
    _can_view,
    _refresh_expired,
    _template_snapshot,
    apply_consent_signature,
)
from permissions import user_has_permission

LINK_STATUSES = frozenset({"pending", "opened", "signed", "expired", "cancelled"})

_submit_buckets: Dict[str, List[float]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_base_url() -> str:
    return (os.environ.get("PUBLIC_APP_URL") or os.environ.get("REACT_APP_FRONTEND_URL") or "http://localhost:3000").rstrip("/")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def _rate_limit_check(ip: str, *, limit: int = 10, window: int = 60) -> None:
    now = time.time()
    bucket = _submit_buckets.setdefault(ip or "unknown", [])
    bucket[:] = [t for t in bucket if now - t < window]
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests — please try again shortly")
    bucket.append(now)


async def _expire_link_if_needed(db, link: dict) -> dict:
    if link.get("status") not in ("pending", "opened"):
        return link
    exp = link.get("expires_at")
    if exp and exp < _now_iso():
        await db.consent_public_links.update_one(
            {"id": link["id"]},
            {"$set": {"status": "expired", "updated_at": _now_iso()}},
        )
        return {**link, "status": "expired"}
    return link


async def _active_link_for_consent(db, consent_id: str) -> Optional[dict]:
    link = await db.consent_public_links.find_one(
        {
            "consent_id": consent_id,
            "status": {"$in": ["pending", "opened"]},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not link:
        return None
    return await _expire_link_if_needed(db, link)


async def attach_public_link_summary(db, form: dict) -> dict:
    """Attach non-sensitive public link metadata to a consent form."""
    out = dict(form)
    link = await db.consent_public_links.find_one(
        {"consent_id": form["id"]},
        {"_id": 0, "id": 1, "status": 1, "expires_at": 1, "created_at": 1, "opened_at": 1, "signed_at": 1},
        sort=[("created_at", -1)],
    )
    if link:
        link = await _expire_link_if_needed(db, link)
        out["public_link"] = {
            "id": link["id"],
            "status": link.get("status"),
            "expires_at": link.get("expires_at"),
            "created_at": link.get("created_at"),
            "opened_at": link.get("opened_at"),
            "signed_at": link.get("signed_at"),
            "has_active_link": link.get("status") in ("pending", "opened"),
        }
    else:
        out["public_link"] = None
    return out


async def create_public_consent_link(
    db,
    *,
    form: dict,
    created_by: str = "",
    expires_days: Optional[int] = None,
) -> tuple[dict, str]:
    """Create link record; returns (link_doc, plain_token)."""
    if form.get("status") == "signed":
        raise HTTPException(status_code=400, detail="Consent is already signed")
    if form.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Consent is cancelled")

    existing = await _active_link_for_consent(db, form["id"])
    if existing:
        raise HTTPException(status_code=409, detail="An active public link already exists. Cancel or regenerate it first.")

    token = _generate_token()
    now = _now_iso()
    expires_at = None
    if expires_days and expires_days > 0:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=int(expires_days))).isoformat()

    link = {
        "id": str(uuid.uuid4()),
        "clinic_id": form["clinic_id"],
        "consent_id": form["id"],
        "visit_id": form.get("visit_id"),
        "patient_id": form.get("patient_id"),
        "token_hash": _hash_token(token),
        "expires_at": expires_at,
        "status": "pending",
        "opened_at": None,
        "signed_at": None,
        "signed_ip": None,
        "signed_user_agent": None,
        "created_by": created_by or None,
        "created_at": now,
        "updated_at": now,
        "cancelled_at": None,
    }
    await db.consent_public_links.insert_one(link)
    link.pop("_id", None)

    if form.get("status") == "not_sent":
        await db.consent_forms.update_one(
            {"id": form["id"]},
            {"$set": {"status": "pending", "sent_at": now, "updated_at": now}},
        )

    return link, token


def public_consent_url(token: str) -> str:
    return f"{_public_base_url()}/consent/{token}"


async def _link_by_token(db, token: str) -> dict:
    if not token or len(token) < 16:
        raise HTTPException(status_code=404, detail="Consent link not found")
    link = await db.consent_public_links.find_one(
        {"token_hash": _hash_token(token.strip())},
        {"_id": 0},
    )
    if not link:
        raise HTTPException(status_code=404, detail="Consent link not found")
    return await _expire_link_if_needed(db, link)


async def _public_consent_payload(db, link: dict, *, mark_opened: bool = False) -> dict:
    if link.get("status") in ("cancelled", "expired"):
        raise HTTPException(status_code=410, detail=f"Consent link is {link.get('status')}")

    form = await db.consent_forms.find_one({"id": link["consent_id"]}, {"_id": 0})
    if not form:
        raise HTTPException(status_code=404, detail="Consent form not found")
    form = await _refresh_expired(form, db)

    if form.get("status") == "cancelled":
        raise HTTPException(status_code=410, detail="Consent form was cancelled")

    if mark_opened and link.get("status") == "pending":
        now = _now_iso()
        await db.consent_public_links.update_one(
            {"id": link["id"]},
            {"$set": {"status": "opened", "opened_at": now, "updated_at": now}},
        )
        link = {**link, "status": "opened", "opened_at": now}

    clinic = await db.clinics.find_one({"id": link["clinic_id"]}, {"_id": 0, "name": 1, "slug": 1, "phone": 1, "address": 1})
    settings = await db.settings.find_one(
        {"id": "global", "clinic_id": link["clinic_id"]},
        {"_id": 0, "branding": 1},
    )
    branding = (settings or {}).get("branding") or {}
    patient = None
    if link.get("patient_id"):
        patient = await db.patients.find_one(
            {"id": link["patient_id"], "clinic_id": link["clinic_id"]},
            {"_id": 0, "full_name": 1},
        )

    visit = None
    if link.get("visit_id"):
        visit = await db.visits.find_one(
            {"id": link["visit_id"], "clinic_id": link["clinic_id"]},
            {"_id": 0, "scheduled_at": 1, "chief_complaint": 1},
        )

    snap = form.get("template_snapshot") or {}
    signed = form.get("status") == "signed" or link.get("status") == "signed"
    requires_staff = bool(snap.get("requires_staff_signature"))
    can_sign = (
        not signed
        and link.get("status") in ("pending", "opened")
        and form.get("status") not in ("signed", "cancelled", "expired")
    )

    return {
        "link_status": link.get("status"),
        "consent_status": form.get("status"),
        "signed": signed,
        "can_sign": can_sign and not requires_staff,
        "requires_staff_signature": requires_staff,
        "clinic": {
            "name": (clinic or {}).get("name") or branding.get("clinic_name") or "Clinic",
            "phone": (clinic or {}).get("phone") or "",
            "address": (clinic or {}).get("address") or "",
            "logo_path": branding.get("logo_path"),
            "primary_color": branding.get("primary_color"),
        },
        "patient_name": (patient or {}).get("full_name") or form.get("patient_name_snapshot") or "",
        "treatment_name": form.get("treatment_name_snapshot") or "",
        "performer_name": form.get("performer_name_snapshot") or "",
        "visit_summary": (visit or {}).get("chief_complaint") or form.get("treatment_name_snapshot") or "",
        "template": {
            "title": snap.get("title") or snap.get("name") or "Consent form",
            "body": snap.get("body") or "",
            "sections": snap.get("sections") or [],
        },
        "signed_at": form.get("signed_at") or link.get("signed_at"),
        "expires_at": link.get("expires_at"),
    }


class PublicConsentLinkCreateIn(BaseModel):
    expires_days: Optional[int] = Field(None, ge=1, le=365)


class PublicConsentSignIn(BaseModel):
    patient_signature: str


def register_public_consent_links(
    api: APIRouter,
    db,
    get_current_user,
    assert_writeable,
    assert_feature,
    scope,
    audit,
):
    """Wire authenticated link management and public consent routes."""

    async def _get_form_for_send(form_id: str, user: dict) -> dict:
        if not _can_send(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        await assert_writeable(user)
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        return form

    @api.post("/consent-forms/{form_id}/public-link")
    async def generate_public_link(
        form_id: str,
        payload: PublicConsentLinkCreateIn = PublicConsentLinkCreateIn(),
        user: dict = Depends(get_current_user),
    ):
        await assert_feature(user, "consent")
        form = await _get_form_for_send(form_id, user)
        link, token = await create_public_consent_link(
            db, form=form, created_by=user["id"], expires_days=payload.expires_days,
        )
        url = public_consent_url(token)
        from audit_log import log_consent
        await log_consent(
            db, user, "public_link_created", form["patient_id"],
            new_value={"form_id": form_id, "link_id": link["id"], "visit_id": form.get("visit_id")},
        )
        await audit(user, "create", "consent_public_link", link["id"], {"consent_id": form_id})
        return {
            "link": await attach_public_link_summary(db, {**form, "id": form_id}),
            "public_link": {**link, "url": url},
            "url": url,
            "token": token,
        }

    @api.get("/consent-forms/{form_id}/public-link")
    async def get_public_link_status(form_id: str, user: dict = Depends(get_current_user)):
        if not _can_view(user):
            raise HTTPException(status_code=403, detail="Not allowed")
        form = await db.consent_forms.find_one(scope(user, {"id": form_id}), {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        summary = await attach_public_link_summary(db, form)
        return summary.get("public_link") or {}

    @api.post("/consent-forms/{form_id}/public-link/cancel")
    async def cancel_public_link(form_id: str, user: dict = Depends(get_current_user)):
        await assert_feature(user, "consent")
        form = await _get_form_for_send(form_id, user)
        link = await _active_link_for_consent(db, form_id)
        if not link:
            raise HTTPException(status_code=404, detail="No active public link")
        now = _now_iso()
        await db.consent_public_links.update_one(
            {"id": link["id"]},
            {"$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now}},
        )
        from audit_log import log_consent
        await log_consent(
            db, user, "public_link_cancelled", form["patient_id"],
            new_value={"form_id": form_id, "link_id": link["id"]},
        )
        await audit(user, "cancel", "consent_public_link", link["id"], {})
        return {"ok": True}

    @api.post("/consent-forms/{form_id}/public-link/regenerate")
    async def regenerate_public_link(
        form_id: str,
        payload: PublicConsentLinkCreateIn = PublicConsentLinkCreateIn(),
        user: dict = Depends(get_current_user),
    ):
        await assert_feature(user, "consent")
        form = await _get_form_for_send(form_id, user)
        if form.get("status") == "signed":
            raise HTTPException(status_code=400, detail="Signed consent cannot be regenerated")
        active = await _active_link_for_consent(db, form_id)
        if active:
            now = _now_iso()
            await db.consent_public_links.update_one(
                {"id": active["id"]},
                {"$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now}},
            )
        link, token = await create_public_consent_link(
            db, form=form, created_by=user["id"], expires_days=payload.expires_days,
        )
        url = public_consent_url(token)
        from audit_log import log_consent
        await log_consent(
            db, user, "public_link_regenerated", form["patient_id"],
            new_value={"form_id": form_id, "link_id": link["id"]},
        )
        await audit(user, "regenerate", "consent_public_link", link["id"], {"consent_id": form_id})
        return {"url": url, "token": token, "link_id": link["id"]}

    @api.post("/consent-forms/{form_id}/public-link/send")
    async def send_public_link_via_messaging(form_id: str, user: dict = Depends(get_current_user)):
        await assert_feature(user, "consent")
        form = await _get_form_for_send(form_id, user)
        active = await _active_link_for_consent(db, form_id)
        if active:
            raise HTTPException(
                status_code=400,
                detail="An active link exists. Copy it from the visit screen or regenerate to get a new link for messaging.",
            )
        link, token = await create_public_consent_link(db, form=form, created_by=user["id"])
        url = public_consent_url(token)
        try:
            import os
            from messaging import (
                load_messaging_settings,
                render_message,
                build_message_context,
                create_message_log,
                dispatch_message,
                decrypt_credentials,
                get_provider_credentials,
                is_automation_active,
                normalize_phone,
            )

            settings = await load_messaging_settings(db, form["clinic_id"])
            creds = get_provider_credentials(os.environ["JWT_SECRET"], form["clinic_id"], settings)
            if is_automation_active(settings, creds):
                patient = await db.patients.find_one(
                    {"id": form.get("patient_id"), "clinic_id": form["clinic_id"]},
                    {"_id": 0},
                )
                booking = None
                if form.get("booking_id"):
                    booking = await db.bookings.find_one({"id": form["booking_id"]}, {"_id": 0})
                ctx = await build_message_context(
                    db, form["clinic_id"], booking=booking, patient=patient, consent_url=url,
                )
                tpl = await db.messaging_templates.find_one(
                    {"clinic_id": form["clinic_id"], "template_type": "consent_link", "active": True},
                    {"_id": 0},
                )
                phone = (patient or {}).get("phone") or (booking or {}).get("patient_phone") or ""
                if tpl and phone:
                    enc = settings.get("provider_credentials_encrypted")
                    creds = decrypt_credentials(os.environ["JWT_SECRET"], form["clinic_id"], enc) if enc else {}
                    rendered = render_message(tpl.get("message_body") or "", ctx)
                    log = await create_message_log(
                        db,
                        clinic_id=form["clinic_id"],
                        template=tpl,
                        recipient=normalize_phone(phone),
                        rendered=rendered,
                        provider=settings.get("provider") or "none",
                        channel=tpl.get("channel") or "whatsapp",
                        patient_id=form.get("patient_id"),
                        booking_id=form.get("booking_id"),
                        visit_id=form.get("visit_id"),
                        send_at=datetime.now(timezone.utc),
                    )
                    await dispatch_message(db, log, settings, creds, tpl)
        except Exception:
            pass
        return {"ok": True, "url": url, "token": token}

    @api.get("/public/consent/{token}")
    async def public_get_consent(token: str, request: Request):
        _rate_limit_check(request.client.host if request.client else "unknown", limit=30)
        link = await _link_by_token(db, token)
        return await _public_consent_payload(db, link, mark_opened=True)

    @api.post("/public/consent/{token}/sign")
    async def public_sign_consent(token: str, payload: PublicConsentSignIn, request: Request):
        ip = request.client.host if request.client else "unknown"
        _rate_limit_check(ip, limit=10)
        link = await _link_by_token(db, token)
        if link.get("status") in ("signed", "cancelled", "expired"):
            raise HTTPException(status_code=400, detail="Consent link is no longer available for signing")

        form = await db.consent_forms.find_one({"id": link["consent_id"]}, {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Consent form not found")
        if form.get("status") == "signed":
            raise HTTPException(status_code=400, detail="Consent already completed")

        snap = form.get("template_snapshot") or {}
        if snap.get("requires_staff_signature"):
            raise HTTPException(
                status_code=400,
                detail="This consent requires in-clinic staff co-signature. Please complete signing at the clinic.",
            )

        if not (payload.patient_signature or "").strip().startswith("data:image"):
            raise HTTPException(status_code=400, detail="Valid signature is required")

        saved = await apply_consent_signature(
            db,
            form,
            patient_signature=payload.patient_signature.strip(),
            staff_signature=None,
            staff_user=None,
        )
        now = _now_iso()
        ua = (request.headers.get("user-agent") or "")[:500]
        await db.consent_public_links.update_one(
            {"id": link["id"]},
            {"$set": {
                "status": "signed",
                "signed_at": now,
                "signed_ip": ip,
                "signed_user_agent": ua,
                "updated_at": now,
            }},
        )
        guest = {
            "id": "public_consent",
            "email": "public@consent",
            "role": "guest",
            "name": "Public consent",
            "clinic_id": link["clinic_id"],
        }
        from audit_log import log_consent
        await log_consent(
            db, guest, "signed_public", form["patient_id"],
            new_value={
                "form_id": form["id"],
                "link_id": link["id"],
                "visit_id": form.get("visit_id"),
                "signed_ip": ip,
            },
        )
        return {"ok": True, "signed_at": saved.get("signed_at"), "status": "signed"}
