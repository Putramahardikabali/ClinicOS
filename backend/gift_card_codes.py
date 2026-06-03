"""Gift card code generation and validation (per-clinic unique)."""
from __future__ import annotations

import re
import secrets
from typing import Optional

from fastapi import HTTPException

from gift_card_models import GC_CODE_ALPHABET, GC_CODE_PATTERN, GC_CODE_SEGMENT_LEN, normalize_gift_card_code

_CODE_RE = re.compile(GC_CODE_PATTERN)
_MAX_GENERATION_ATTEMPTS = 40


def _random_segment(length: int = GC_CODE_SEGMENT_LEN) -> str:
    return "".join(secrets.choice(GC_CODE_ALPHABET) for _ in range(length))


def generate_gift_card_code() -> str:
    """Return a new code like GC-8K4P-29LM (not checked for uniqueness)."""
    return f"GC-{_random_segment()}-{_random_segment()}"


def validate_gift_card_code_format(code: str) -> str:
    norm = normalize_gift_card_code(code)
    if not norm:
        raise HTTPException(status_code=400, detail="Gift card code is required")
    if not _CODE_RE.match(norm):
        raise HTTPException(
            status_code=400,
            detail="Gift card code must match format GC-XXXX-XXXX (example: GC-8K4P-29LM)",
        )
    return norm


async def gift_card_code_exists(db, clinic_id: str, code: str) -> bool:
    norm = normalize_gift_card_code(code)
    if not norm or not _CODE_RE.match(norm):
        return False
    doc = await db.gift_cards.find_one(
        {"clinic_id": clinic_id, "code": norm},
        {"_id": 1},
    )
    return doc is not None


async def allocate_gift_card_code(
    db,
    clinic_id: str,
    *,
    manual_code: Optional[str] = None,
    allow_manual: bool = False,
) -> str:
    """
    Return a clinic-unique gift card code.
    Manual codes require allow_manual=True (gift_cards.set_code) and must not duplicate.
    """
    if manual_code and str(manual_code).strip():
        if not allow_manual:
            raise HTTPException(
                status_code=403,
                detail="Insufficient permissions to set a custom gift card code",
            )
        norm = validate_gift_card_code_format(manual_code)
        if await gift_card_code_exists(db, clinic_id, norm):
            raise HTTPException(
                status_code=409,
                detail=f"Gift card code {norm} already exists in this clinic",
            )
        return norm

    for _ in range(_MAX_GENERATION_ATTEMPTS):
        candidate = generate_gift_card_code()
        if not await gift_card_code_exists(db, clinic_id, candidate):
            return candidate

    raise HTTPException(
        status_code=500,
        detail="Could not generate a unique gift card code; try again",
    )
