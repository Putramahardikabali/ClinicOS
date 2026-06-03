import { API_BASE } from "@/lib/api";

const FALLBACK = {
  app_name: "ClinicOS",
  short_name: "ClinicOS",
  description: "Clinic management system",
  favicon_url: "",
  app_icon_192_url: "",
  app_icon_512_url: "",
  maskable_icon_url: "",
  theme_color: "#3F5A52",
  background_color: "#FDFBF7",
  updated_at: null,
};

const MANIFEST_URL =
  process.env.REACT_APP_MANIFEST_URL
  || "/manifest.json";

function ensureFavicon(url) {
  if (!url) return;
  let link = document.querySelector('link[rel="icon"][data-platform-branding="true"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.setAttribute("data-platform-branding", "true");
    document.head.appendChild(link);
  }
  link.href = url;
}

function ensureThemeColor(color) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

function ensureManifestHref(updatedAt) {
  const m = document.querySelector('link[rel="manifest"]');
  if (!m || !MANIFEST_URL) return;
  const v = updatedAt ? `?v=${encodeURIComponent(String(updatedAt))}` : "";
  m.href = `${MANIFEST_URL}${v}`;
}

export async function loadPlatformBranding() {
  try {
    const res = await fetch(`${API_BASE}/platform/branding`).then((r) => r.json());
    const b = { ...FALLBACK, ...(res || {}) };
    document.title = b.app_name || "ClinicOS";
    ensureThemeColor(b.theme_color || FALLBACK.theme_color);
    ensureManifestHref(b.updated_at);
    if (b.favicon_url) {
      const v = b.updated_at ? encodeURIComponent(String(b.updated_at)) : "";
      const sep = b.favicon_url.includes("?") ? "&" : "?";
      ensureFavicon(v ? `${b.favicon_url}${sep}v=${v}` : b.favicon_url);
    }
    return b;
  } catch {
    ensureThemeColor(FALLBACK.theme_color);
    ensureManifestHref(null);
    return FALLBACK;
  }
}
