/**
 * Grouped clinic branding theme — owners set a few base colors;
 * derived tokens apply consistently across the app.
 */

export const DEFAULT_BRANDING_BASE = {
  clinic_name: "ClinicOS",
  tagline: "Clinic management",
  logo_path: "",
  primary_color: "#8A9A86",
  accent_color: "#D4A373",
  background: "#FDFBF7",
  surface: "#FFFFFF",
  text_primary: "#2D3A33",
};

/** Stored / edited by clinic owners */
export const BRANDING_BASE_KEYS = [
  "primary_color",
  "accent_color",
  "background",
  "surface",
  "text_primary",
];

/** Computed automatically — not edited directly in basic UI */
export const BRANDING_DERIVED_KEYS = [
  "primary_hover",
  "primary_soft",
  "primary_contrast",
  "border_color",
  "muted_text",
  "focus_ring",
  "link_color",
];

function normalizeHex(input, fallback) {
  if (!input || typeof input !== "string") return fallback;
  let hex = input.trim();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    hex = `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex, "#000000").slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function mixHex(a, b, weightA = 0.5) {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  const w = Math.max(0, Math.min(1, weightA));
  return rgbToHex({
    r: c1.r * w + c2.r * (1 - w),
    g: c1.g * w + c2.g * (1 - w),
    b: c1.b * w + c2.b * (1 - w),
  });
}

export function darkenHex(hex, amount = 0.1) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - Math.max(0, Math.min(1, amount));
  return rgbToHex({ r: r * f, g: g * f, b: b * f });
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastTextOn(backgroundHex, light = "#FFFFFF", dark = "#2D3A33") {
  return relativeLuminance(backgroundHex) > 0.45 ? dark : light;
}

export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Merge stored branding with defaults and compute derived semantic tokens.
 */
export function resolveBrandingTheme(raw = {}) {
  const base = { ...DEFAULT_BRANDING_BASE };
  if (raw && typeof raw === "object") {
    Object.assign(base, raw);
    if (raw.text_primary) base.text_primary = raw.text_primary;
  }

  const primary = normalizeHex(base.primary_color, DEFAULT_BRANDING_BASE.primary_color);
  const accent = normalizeHex(base.accent_color, DEFAULT_BRANDING_BASE.accent_color);
  const background = normalizeHex(base.background, DEFAULT_BRANDING_BASE.background);
  const surface = normalizeHex(base.surface, DEFAULT_BRANDING_BASE.surface);
  const text = normalizeHex(base.text_primary, DEFAULT_BRANDING_BASE.text_primary);

  const primaryHover = darkenHex(primary, 0.12);
  const primarySoft = mixHex(primary, surface, 0.14);
  const primaryContrast = contrastTextOn(primary, "#FFFFFF", text);
  const border = mixHex(text, surface, 0.12);
  const mutedText = mixHex(text, background, 0.55);
  const focusRing = hexToRgba(primary, 0.22);
  const linkColor = primary;

  return {
    clinic_name: base.clinic_name || DEFAULT_BRANDING_BASE.clinic_name,
    tagline: base.tagline || DEFAULT_BRANDING_BASE.tagline,
    logo_path: base.logo_path || "",
    primary_color: primary,
    accent_color: accent,
    background,
    surface,
    text_primary: text,
    primary_hover: primaryHover,
    primary_soft: primarySoft,
    primary_contrast: primaryContrast,
    border_color: border,
    muted_text: mutedText,
    focus_ring: focusRing,
    link_color: linkColor,
  };
}

/** CSS custom properties for document root */
export function brandingThemeCssVars(theme) {
  const t = theme || resolveBrandingTheme();
  return {
    "--bl-primary": t.primary_color,
    "--bl-primary-hover": t.primary_hover,
    "--bl-primary-soft": t.primary_soft,
    "--bl-primary-contrast": t.primary_contrast,
    "--bl-accent": t.accent_color,
    "--bl-background": t.background,
    "--bl-surface": t.surface,
    "--bl-text": t.text_primary,
    "--bl-muted-text": t.muted_text,
    "--bl-border": t.border_color,
    "--bl-focus-ring": t.focus_ring,
    "--bl-link": t.link_color,
  };
}

export function applyBrandingTheme(rawBranding) {
  const theme = resolveBrandingTheme(rawBranding);
  const root = document.documentElement;
  const vars = brandingThemeCssVars(theme);
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  document.title = `${theme.clinic_name} · ClinicOS`;
  return theme;
}

/** Strip to owner-editable fields for persistence */
export function brandingBaseForSave(raw = {}) {
  const theme = resolveBrandingTheme(raw);
  return {
    clinic_name: theme.clinic_name,
    tagline: theme.tagline,
    logo_path: theme.logo_path,
    primary_color: theme.primary_color,
    accent_color: theme.accent_color,
    background: theme.background,
    surface: theme.surface,
    text_primary: theme.text_primary,
  };
}
