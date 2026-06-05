"""ISO 3166-1 nationality reference (shared JSON with frontend)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_PATH = Path(__file__).with_name("nationalities.json")
with _PATH.open(encoding="utf-8") as _f:
    NATIONALITIES: List[dict] = json.load(_f)

_BY_CODE: Dict[str, str] = {c["code"]: c["name"] for c in NATIONALITIES}
_BY_NAME_LOWER: Dict[str, dict] = {c["name"].lower(): c for c in NATIONALITIES}


def lookup_name_by_code(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return _BY_CODE.get(str(code).strip().upper())


def lookup_by_name(name: Optional[str]) -> Optional[dict]:
    if not name:
        return None
    return _BY_NAME_LOWER.get(str(name).strip().lower())


def normalize_nationality_fields(
    code: Optional[str] = None,
    name: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Return (nationality_code, nationality_name). Empty strings mean cleared."""
    code_raw = (code or "").strip().upper() if code is not None else ""
    name_raw = (name or "").strip() if name is not None else ""

    if not code_raw and not name_raw:
        return "", ""

    if code_raw:
        resolved_name = lookup_name_by_code(code_raw)
        if not resolved_name:
            return None, None
        return code_raw, resolved_name

    match = lookup_by_name(name_raw)
    if match:
        return match["code"], match["name"]

    # Import / legacy free text — keep display name without code.
    return "", name_raw
