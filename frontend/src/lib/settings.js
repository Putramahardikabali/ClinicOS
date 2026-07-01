import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { API_BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyBrandingTheme, resolveBrandingTheme } from "@/lib/clinicTheme";

const SettingsContext = createContext(null);

const FALLBACK_BRANDING = resolveBrandingTheme();

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [branding, setBranding] = useState(FALLBACK_BRANDING);

  const refresh = useCallback(async () => {
    try {
      if (user) {
        const r = await api.get("/settings");
        setSettings(r.data);
        if (r.data.branding) {
          const theme = resolveBrandingTheme(r.data.branding);
          setBranding(theme);
          applyBrandingTheme(theme);
        }
      } else {
        const r = await fetch(`${API_BASE}/branding`).then((x) => x.json()).catch(() => null);
        if (r) {
          const theme = resolveBrandingTheme(r);
          setBranding(theme);
          applyBrandingTheme(theme);
        }
      }
    } catch {
      applyBrandingTheme(FALLBACK_BRANDING);
    }
  }, [user]);

  useEffect(() => { applyBrandingTheme(FALLBACK_BRANDING); }, []);
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
  const publicBase =
    process.env.REACT_APP_PUBLIC_UPLOAD_BASE_URL
    || process.env.VITE_PUBLIC_UPLOAD_BASE_URL
    || (process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "")}/uploads` : "");
  if (publicBase) return `${publicBase}/${logo_path}`;
  return `${API_BASE}/files/${logo_path}`;
};
