import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("bl_token");
      if (!token) { setLoading(false); return; }
      try {
        const r = await api.get("/auth/me");
        setUser(r.data);
      } catch {
        localStorage.removeItem("bl_token");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("bl_token");
    if (!token) return null;
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
      return r.data;
    } catch {
      return null;
    }
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    if (r.data?.requires_2fa) {
      return {
        requires2fa: true,
        challengeToken: r.data.challenge_token,
        user: r.data.user,
      };
    }
    localStorage.setItem("bl_token", r.data.token);
    setUser(r.data.user);
    return { requires2fa: false, user: r.data.user };
  };

  const complete2faVerify = async (challengeToken, code) => {
    const r = await api.post("/auth/clinic-2fa/verify", { challenge_token: challengeToken, code });
    localStorage.setItem("bl_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const complete2faRecovery = async (challengeToken, recoveryCode) => {
    const r = await api.post("/auth/clinic-2fa/recovery", { challenge_token: challengeToken, recovery_code: recoveryCode });
    localStorage.setItem("bl_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("bl_token");
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, complete2faVerify, complete2faRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const CLINIC_2FA_ROLES = ["super_admin", "manager", "fo", "doctor", "therapist", "nurse", "accounting"];

export const canUseClinic2fa = (user) => {
  if (!user || user.platform_admin || user.impersonating) return false;
  return CLINIC_2FA_ROLES.includes(user.role);
};

export const ROLE_LABEL = {
  super_admin: "Owner",
  doctor: "Doctor",
  therapist: "Therapist",
  nurse: "Nurse",
  fo: "Front desk",
  manager: "Manager",
  accounting: "Accounting",
  platform_admin: "Platform Admin",
};

export const ACCOUNTING_ROLE = "accounting";

export const isAccountingUser = (user) => {
  if (!user) return false;
  const rk = user.role_key || user.role;
  return rk === ACCOUNTING_ROLE;
};

const LEGACY_ACTION_PERMS = {
  create_patient: "patients.create",
  edit_patient: "patients.edit",
  export_patients: "patients.export",
  delete_patient: "patients.delete",
  create_visit: "visits.view",
  edit_clinical: "clinical_records.edit",
  edit_therapist: "clinical_records.edit",
  add_treatment: "clinical_records.edit",
  upload_photo: "clinical_records.edit",
  edit_mapping: "clinical_records.edit",
  close_visit: "billing.edit",
  view_audit: "audit.view",
};

const LEGACY_ACTION_ANY_PERMS = {
  create_visit: ["visits.view", "visits.view_own"],
};

export const CLINICAL_PERFORMER_ROLES = ["doctor", "therapist", "nurse"];

export const hasPermission = (user, permission) => {
  if (!user || !permission) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  const perms = user.permissions || [];
  if (perms.length > 0) return perms.includes(permission);
  return false;
};

export const canViewAllCommission = (user) => {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return hasPermission(user, "commission.view") || hasPermission(user, "commission.manage");
};

export const canViewOwnCommission = (user) => {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return hasPermission(user, "commission.view_own");
};

export const canManageCommission = (user) => {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return hasPermission(user, "commission.manage");
};

export const canSubscribeBilling = (user) => {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return hasPermission(user, "billing.subscribe");
};

export const canViewSaasBilling = (user) => {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return hasPermission(user, "billing.subscription_view") || hasPermission(user, "billing.subscribe");
};

/** Nav / feature visibility: permission if set, else legacy role list */
export const canAccessNav = (user, item) => {
  if (!user) return false;
  if (item.anyPermission?.some((p) => hasPermission(user, p))) return true;
  if (item.permission && hasPermission(user, item.permission)) return true;
  if (item.roles?.includes(user.role)) return true;
  return false;
};

export const can = (user, action) => {
  if (!user) return false;
  const anyPerms = LEGACY_ACTION_ANY_PERMS[action];
  if (anyPerms?.length && (user.permissions?.length || user.role === "super_admin" || user.platform_admin)) {
    return anyPerms.some((p) => hasPermission(user, p));
  }
  const perm = LEGACY_ACTION_PERMS[action];
  if (perm && (user.permissions?.length || user.role === "super_admin" || user.platform_admin)) {
    return hasPermission(user, perm);
  }
  if (user.role === "super_admin" || user.platform_admin) return true;
  const matrix = {
    create_patient: ["fo"],
    edit_patient: ["fo", "manager"],
    export_patients: ["fo", "manager"],
    delete_patient: [],
    create_visit: ["fo"],
    edit_clinical: ["doctor"],
    edit_therapist: ["therapist"],
    add_treatment: ["doctor", "therapist"],
    upload_photo: ["doctor", "therapist", "nurse"],
    edit_mapping: ["doctor", "therapist"],
    close_visit: ["fo"],
    view_audit: ["manager"],
  };
  return (matrix[action] || []).includes(user.role);
};
