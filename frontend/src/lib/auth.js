import { createContext, useContext, useEffect, useState } from "react";
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

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
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
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABEL = {
  super_admin: "Super Admin",
  doctor: "Doctor",
  therapist: "Therapist",
  fo: "Front Office",
  manager: "Manager",
};

export const can = (user, action) => {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const matrix = {
    create_patient: ["fo"],
    create_visit: ["fo"],
    edit_clinical: ["doctor"],
    edit_therapist: ["therapist"],
    add_treatment: ["doctor", "therapist"],
    upload_photo: ["doctor", "therapist", "fo"],
    edit_mapping: ["doctor", "therapist"],
    close_visit: ["fo"],
    view_audit: ["manager"],
  };
  return (matrix[action] || []).includes(user.role);
};
