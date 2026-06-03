import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth, hasPermission, ROLE_LABEL, canViewAllCommission, canViewOwnCommission, canManageCommission } from "@/lib/auth";
import { ArrowLeft, Percent } from "lucide-react";
import StaffCommissionPanel from "@/components/commission/StaffCommissionPanel";
import { FeatureRoute } from "@/components/FeatureGate";
import api from "@/lib/api";

function canAccessProfile(user, staffId, selfMode) {
  if (!user || !staffId) return false;
  if (selfMode && user.id === staffId && hasPermission(user, "profile.view_own")) return true;
  const isManager = user.role === "super_admin" || user.role === "manager";
  if (isManager && hasPermission(user, "staff.view")) return true;
  if (hasPermission(user, "commission.view") && user.id === staffId) return true;
  if (hasPermission(user, "commission.view_own") && user.id === staffId) return true;
  return false;
}

function canViewCommissionTab(user, staffId) {
  if (!user || !staffId) return false;
  if (canViewAllCommission(user)) return true;
  if (canViewOwnCommission(user) && user.id === staffId) return true;
  return false;
}

export default function StaffProfilePage({ selfMode = false, staffId: staffIdProp }) {
  const { staffId: routeStaffId } = useParams();
  const { user } = useAuth();
  const staffId = staffIdProp || routeStaffId;
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("commission");

  const isSelf = Boolean(selfMode || (user?.id && user.id === staffId));
  const showCommission = useMemo(() => canViewCommissionTab(user, staffId), [user, staffId]);
  const canManage = useMemo(() => canManageCommission(user), [user]);
  const canExport = useMemo(() => {
    if (!user || !staffId) return false;
    if (canViewAllCommission(user)) return true;
    if (canViewOwnCommission(user) && user.id === staffId) return true;
    return false;
  }, [user, staffId]);

  useEffect(() => {
    if (!staffId) return;
    setLoading(true);
    if (user?.id === staffId) {
      setProfile({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        role_name: user.role_name,
        job_title: user.job_title,
        active: user.active !== false,
      });
      setLoading(false);
      return;
    }
    api.get("/staff/users")
      .then((r) => {
        const found = (r.data || []).find((u) => u.id === staffId);
        setProfile(found || null);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [staffId, user]);

  if (!canAccessProfile(user, staffId, selfMode || isSelf)) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <div className="p-8 text-[#5C6C62]">Loading staff profile…</div>;
  }

  if (!profile) {
    return (
      <div className="p-8">
        <p className="text-[#5C6C62]">Staff member not found.</p>
        <Link to={isSelf ? "/" : "/staff/directory"} className="text-sm text-[#52796F] hover:underline mt-2 inline-block">
          {isSelf ? "Back to dashboard" : "Back to directory"}
        </Link>
      </div>
    );
  }

  const roleLabel = profile.role_name || ROLE_LABEL[profile.role] || profile.role;
  const backHref = isSelf ? "/" : "/staff/directory";
  const backLabel = isSelf ? "Dashboard" : "Staff directory";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-6xl" data-testid="staff-profile-page">
      <Link to={backHref} className="text-sm text-[#5C6C62] inline-flex items-center gap-1 mb-4 hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-eyebrow">{isSelf ? "My profile" : "Staff profile"}</div>
          <h1 className="font-display text-3xl text-[#2D3A33]">{profile.name}</h1>
          <p className="text-sm text-[#5C6C62] mt-1">
            {profile.email}
            {" · "}
            {roleLabel}
            {profile.job_title ? ` · ${profile.job_title}` : ""}
          </p>
        </div>
        <span className={`bl-chip ${profile.active === false ? "opacity-60" : ""}`}>
          {profile.active === false ? "Inactive" : "Active"}
        </span>
      </div>

      {showCommission && (
        <>
          <div className="mt-7 border-b border-[#EAE6D7] flex gap-1">
            <button
              type="button"
              onClick={() => setTab("commission")}
              className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 ${tab === "commission" ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62]"}`}
              style={tab === "commission" ? { borderColor: "var(--bl-primary)" } : {}}
              data-testid="staff-profile-tab-commission"
            >
              <Percent className="w-4 h-4" /> {isSelf ? "My commission" : "Commission"}
            </button>
          </div>

          <div className="mt-7">
            {tab === "commission" && (
              <FeatureRoute feature="commissions">
                <StaffCommissionPanel
                  staffId={staffId}
                  staffName={profile.name}
                  canManage={canManage}
                  canExport={canExport}
                />
              </FeatureRoute>
            )}
          </div>
        </>
      )}

      {!showCommission && !isSelf && (
        <div className="mt-8 bl-card p-5 text-sm text-[#5C6C62]">
          You don&apos;t have permission to view this staff member&apos;s commission records.
        </div>
      )}
    </div>
  );
}
