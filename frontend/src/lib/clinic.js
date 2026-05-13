import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";

const ClinicContext = createContext(null);

export function ClinicProvider({ children }) {
  const { user } = useAuth();
  const [clinic, setClinic] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user || user.role === "platform_admin" || user.platform_admin) {
      setClinic(null); setLoading(false); return;
    }
    try {
      const [c, p] = await Promise.all([
        api.get("/clinics/me"),
        api.get("/plans"),
      ]);
      setClinic(c.data);
      setPlans(p.data);
    } catch {
      setClinic(null);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ClinicContext.Provider value={{ clinic, plans, loading, refresh }}>
      {children}
    </ClinicContext.Provider>
  );
}

export const useClinic = () => useContext(ClinicContext) || { clinic: null, plans: [], loading: false, refresh: () => {} };

export const hasFeature = (clinic, feature) => {
  if (!clinic) return true; // optimistic until loaded
  return (clinic.features || []).includes(feature);
};

export const trialDaysLeft = (clinic) => {
  if (!clinic?.subscription?.trial_end) return null;
  const end = new Date(clinic.subscription.trial_end);
  const ms = end - new Date();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

export const formatIdr = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
