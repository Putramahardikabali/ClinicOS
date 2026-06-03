import { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const SuperAdminAuthContext = createContext(null);

export function SuperAdminAuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(null);

  const refreshAdmin = async () => {
    const r = await api.get("/auth/me");
    if (r.data?.platform_admin) {
      setAdmin(r.data);
      return r.data;
    }
    throw new Error("Not a platform admin account");
  };

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("bl_token");
      if (!token) { setLoading(false); return; }
      try {
        await refreshAdmin();
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
    if (r.data.requires_2fa) {
      return {
        requires2fa: true,
        challengeToken: r.data.challenge_token,
        user: r.data.user,
      };
    }
    localStorage.setItem("bl_token", r.data.token);
    setAdmin(r.data.user);
    return { requires2fa: false, user: r.data.user };
  };

  const complete2faVerify = async (challengeToken, code) => {
    const r = await api.post("/auth/platform-2fa/verify", { challenge_token: challengeToken, code });
    localStorage.setItem("bl_token", r.data.token);
    setAdmin(r.data.user);
    return r.data.user;
  };

  const complete2faRecovery = async (challengeToken, recoveryCode) => {
    const r = await api.post("/auth/platform-2fa/recovery", { challenge_token: challengeToken, recovery_code: recoveryCode });
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
    <SuperAdminAuthContext.Provider value={{ admin, loading, login, logout, refreshAdmin, setAdmin, complete2faVerify, complete2faRecovery }}>
      {children}
    </SuperAdminAuthContext.Provider>
  );
}

export const useSuperAdmin = () => useContext(SuperAdminAuthContext);
