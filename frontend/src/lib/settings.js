import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { API_BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const SettingsContext = createContext(null);

const FALLBACK_BRANDING = {
  clinic_name: "Body Lab Bali",
  tagline: "Aesthetic Clinic · Internal EMR",
  logo_path: "",
  primary_color: "#8A9A86",
  primary_hover: "#748470",
  accent_color: "#D4A373",
  background: "#FDFBF7",
  surface: "#FFFFFF",
  text_primary: "#2D3A33",
};

function applyTheme(branding) {
  const r = document.documentElement;
  r.style.setProperty("--bl-primary", branding.primary_color);
  r.style.setProperty("--bl-primary-hover", branding.primary_hover);
  r.style.setProperty("--bl-accent", branding.accent_color);
  r.style.setProperty("--bl-background", branding.background);
  r.style.setProperty("--bl-surface", branding.surface);
  r.style.setProperty("--bl-text", branding.text_primary);
  document.title = `${branding.clinic_name} · EMR`;
}

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [branding, setBranding] = useState(FALLBACK_BRANDING);

  const refresh = useCallback(async () => {
    try {
      if (user) {
        const r = await api.get("/settings");
        setSettings(r.data);
        if (r.data.branding) { setBranding(r.data.branding); applyTheme(r.data.branding); }
      } else {
        // public branding for login page
        const r = await fetch(`${API_BASE}/branding`).then(x => x.json()).catch(() => null);
        if (r) { setBranding(r); applyTheme(r); }
      }
    } catch {
      applyTheme(FALLBACK_BRANDING);
    }
  }, [user]);

  useEffect(() => { applyTheme(branding); }, []); // initial paint
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SettingsContext.Provider value={{ settings, branding, refresh, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);

export const logoUrl = (logo_path) => {
  if (!logo_path) return null;
  return `${API_BASE}/files/${logo_path}`; // branding files are public
};
