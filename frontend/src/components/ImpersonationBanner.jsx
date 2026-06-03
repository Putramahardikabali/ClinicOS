import { useAuth } from "@/lib/auth";
import api from "@/lib/api";
import { Shield, LogOut } from "lucide-react";

export default function ImpersonationBanner() {
  const { user } = useAuth();
  if (!user?.impersonating) return null;

  const clinicName = user.impersonator_clinic_name || "clinic";
  const clinicId = user.clinic_id;

  const exit = async () => {
    const platformToken = localStorage.getItem("bl_platform_token");
    if (platformToken && clinicId) {
      try {
        await api.post(
          "/superadmin/impersonate/end",
          { clinic_id: clinicId },
          { headers: { Authorization: `Bearer ${platformToken}` } },
        );
      } catch {
        /* still restore token locally */
      }
      localStorage.setItem("bl_token", platformToken);
      localStorage.removeItem("bl_platform_token");
      window.location.href = `/superadmin/clinics/${clinicId}`;
      return;
    }
    window.location.href = "/superadmin";
  };

  return (
    <div
      className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm z-[60] relative"
      style={{ background: "#2D3A33", color: "#F5F2EA", borderBottom: "1px solid #1F2A30" }}
      data-testid="impersonation-banner"
    >
      <Shield className="w-4 h-4 shrink-0 text-[#D4A373]" />
      <span className="flex-1 min-w-0">
        Impersonating <strong>{clinicName}</strong>
        {user.impersonator_email && (
          <span className="text-[#C7D1CB]"> · as platform admin ({user.impersonator_email})</span>
        )}
      </span>
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 transition"
        data-testid="exit-impersonation"
      >
        <LogOut className="w-3.5 h-3.5" /> Exit impersonation
      </button>
    </div>
  );
}
