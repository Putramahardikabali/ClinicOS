import { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const SuperAdminAuthContext = createContext(null);

export function SuperAdminAuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("bl_token");
      if (!token) { setLoading(false); return; }
      try {
        const r = await api.get("/auth/me");
        if (r.data?.platform_admin) setAdmin(r.data);
      } catch {
        // ignore — not a platform admin
      } finally { setLoading(false); }
    })();
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    if (!r.data?.user?.platform_admin) {
      throw new Error("Not a platform admin account");
    }
    localStorage.setItem("bl_token", r.data.token);
    setAdmin(r.data.user);
    return r.data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("bl_token");
    setAdmin(null);
    window.location.href = "/superadmin";
  };

  return (
    <SuperAdminAuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </SuperAdminAuthContext.Provider>
  );
}

export const useSuperAdmin = () => useContext(SuperAdminAuthContext);
