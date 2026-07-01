"""Grouped clinic branding theme — base colors + derived semantic tokens."""
from __future__ import annotations

import re
from typing import Any, Dict

DEFAULT_BRANDING_BASE: Dict[str, str] = {
    "clinic_name": "Body Lab Bali",
    "tagline": "Aesthetic Clinic · Patient chart",
    "logo_path": "",
    "primary_color": "#8A9A86",
    "accent_color": "#D4A373",
    "background": "#FDFBF7",
    "surface": "#FFFFFF",
    "text_primary": "#2D3A33",
}

_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _normalize_hex(value: Any, fallback: str) -> str:
    if not value or not isinstance(value, str):
        return fallback.upper()
    raw = value.strip()
    if not raw.startswith("#"):
        raw = f"#{raw}"
    if re.match(r"^#[0-9A-Fa-f]{3}$", raw):
        r, g, b = raw[1], raw[2], raw[3]
        raw = f"#{r}{r}{g}{g}{b}{b}"
    return raw.upper() if _HEX_RE.match(raw) else fallback.upper()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = _normalize_hex(hex_color, "#000000")[1:]
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    clamp = lambda n: max(0, min(255, int(round(n))))
    return f"#{clamp(r):02X}{clamp(g):02X}{clamp(b):02X}"


def mix_hex(a: str, b: str, weight_a: float = 0.5) -> str:
    r1, g1, b1 = _hex_to_rgb(a)
    r2, g2, b2 = _hex_to_rgb(b)
    w = max(0.0, min(1.0, weight_a))
    return _rgb_to_hex(
        r1 * w + r2 * (1 - w),
        g1 * w + g2 * (1 - w),
        b1 * w + b2 * (1 - w),
    )


def darken_hex(hex_color: str, amount: float = 0.1) -> str:
    r, g, b = _hex_to_rgb(hex_color)
    f = 1.0 - max(0.0, min(1.0, amount))
    return _rgb_to_hex(r * f, g * f, b * f)


def _relative_luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)

    def channel(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_text_on(background_hex: str, light: str = "#FFFFFF", dark: str = "#2D3A33") -> str:
    return dark if _relative_luminance(background_hex) > 0.45 else light


def resolve_branding_theme(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    base = dict(DEFAULT_BRANDING_BASE)
    if raw:
        for k, v in raw.items():
            if v is not None:
                base[k] = v

    primary = _normalize_hex(base.get("primary_color"), DEFAULT_BRANDING_BASE["primary_color"])
    accent = _normalize_hex(base.get("accent_color"), DEFAULT_BRANDING_BASE["accent_color"])
    background = _normalize_hex(base.get("background"), DEFAULT_BRANDING_BASE["background"])
    surface = _normalize_hex(base.get("surface"), DEFAULT_BRANDING_BASE["surface"])
    text = _normalize_hex(base.get("text_primary"), DEFAULT_BRANDING_BASE["text_primary"])

    return {
        "clinic_name": (base.get("clinic_name") or DEFAULT_BRANDING_BASE["clinic_name"]).strip(),
        "tagline": (base.get("tagline") or DEFAULT_BRANDING_BASE["tagline"]).strip(),
        "logo_path": base.get("logo_path") or "",
        "primary_color": primary,
        "accent_color": accent,
        "background": background,
        "surface": surface,
        "text_primary": text,
        "primary_hover": darken_hex(primary, 0.12),
        "primary_soft": mix_hex(primary, surface, 0.14),
        "primary_contrast": contrast_text_on(primary, "#FFFFFF", text),
        "border_color": mix_hex(text, surface, 0.12),
        "muted_text": mix_hex(text, background, 0.55),
        "focus_ring": primary,
        "link_color": primary,
    }


def branding_base_for_save(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    theme = resolve_branding_theme(raw or {})
    return {
        "clinic_name": theme["clinic_name"],
        "tagline": theme["tagline"],
        "logo_path": theme["logo_path"],
        "primary_color": theme["primary_color"],
        "accent_color": theme["accent_color"],
        "background": theme["background"],
        "surface": theme["surface"],
        "text_primary": theme["text_primary"],
    }
