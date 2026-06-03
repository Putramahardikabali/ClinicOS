import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, hasPermission, ROLE_LABEL, canViewOwnCommission, canUseClinic2fa } from "@/lib/auth";
import { ArrowLeft, User, Calendar, Percent, Shield } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import MyScheduleReadOnly from "@/components/profile/MyScheduleReadOnly";
import StaffCommissionPanel from "@/components/commission/StaffCommissionPanel";
import { FeatureRoute } from "@/components/FeatureGate";
import ClinicTwoFactorPanel from "@/components/account/ClinicTwoFactorPanel";
import InstallAppPrompt from "@/components/InstallAppPrompt";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("account");
  const [busy, setBusy] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: "", phone: "", email: "", current_password: "" });
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_new_password: "",
  });
  const [savedEmail, setSavedEmail] = useState("");

  const canEdit = !!user && !user?.impersonating;
  const showCommission = canViewOwnCommission(user);
  const showSecurity = (account?.can_use_2fa ?? canUseClinic2fa(user)) && !user?.impersonating;
  const showSchedule = ["doctor", "therapist", "nurse"].includes(user?.role);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/account/me");
      setAccount(r.data);
      setSavedEmail(r.data?.email || "");
      setProfileForm({
        full_name: r.data?.full_name || "",
        phone: r.data?.phone || "",
        email: r.data?.email || "",
        current_password: "",
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load account settings");
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    loadAccount();
  }, [user?.id, loadAccount]);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const full_name = profileForm.full_name.trim();
    const email = profileForm.email.trim().toLowerCase();
    if (!full_name) {
      toast.error("Full name is required");
      return;
    }
    setBusy(true);
    try {
      const emailChanged = email !== String(savedEmail || "").toLowerCase();
      if (emailChanged) {
        if (!profileForm.current_password) {
          toast.error("Current password is required to change email");
          return;
        }
        await api.put("/account/email", {
          new_email: email,
          current_password: profileForm.current_password,
        });
        toast.success("Email updated. Use the new email next time you sign in.");
      }
      await api.put("/account/profile", { full_name, phone: profileForm.phone });
      await loadAccount();
      await refreshUser?.();
      toast.success("Account updated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save account");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_new_password) {
      toast.error("Please fill all password fields");
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_new_password) {
      toast.error("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/account/change-password", {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_new_password: passwordForm.confirm_new_password,
      });
      setPasswordForm({ current_password: "", new_password: "", confirm_new_password: "" });
      toast.success(r.data?.message || "Password updated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { key: "account", label: "Account", icon: User },
    ...(showSecurity ? [{ key: "security", label: "Security", icon: Shield }] : []),
    ...(showSchedule ? [{ key: "schedule", label: "Work schedule", icon: Calendar }] : []),
    ...(showCommission ? [{ key: "commission", label: "My commission", icon: Percent }] : []),
  ];

  const header = account || user;
  const roleLabel = account?.role_label || ROLE_LABEL[account?.role || user?.role] || account?.role;
  const emailChanged = profileForm.email.trim().toLowerCase() !== String(savedEmail || "").toLowerCase();

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-4xl mx-auto" data-testid="profile-page">
      <Link to="/" className="text-sm text-[#5C6C62] inline-flex items-center gap-1 mb-4 hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-eyebrow">Account</div>
          <h1 className="font-display text-3xl text-[#2D3A33]">Account settings</h1>
          <p className="text-sm text-[#5C6C62] mt-1">
            {header?.email}
            {" · "}
            {roleLabel}
            {account?.clinic_name ? ` · ${account.clinic_name}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62]"}`}
              style={active ? { borderColor: "var(--bl-primary)" } : {}}
              data-testid={`profile-tab-${t.key}`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-7">
        <InstallAppPrompt persistent />
        {loading && tab === "account" && (
          <div className="text-sm text-[#5C6C62] py-6">Loading account settings…</div>
        )}

        {!loading && tab === "account" && account && (
          <div className="space-y-6">
            <div className="bl-card p-5 space-y-2 text-sm">
              <div><span className="text-[#5C6C62]">Clinic:</span> {account.clinic_name || "—"}</div>
              <div><span className="text-[#5C6C62]">Role:</span> {roleLabel}</div>
            </div>

            <form onSubmit={saveProfile} className="bl-card p-5 space-y-4" data-testid="account-profile-form">
              <h2 className="font-display text-lg text-[#2D3A33]">Profile</h2>
              <div>
                <label className="label-eyebrow block mb-1">Full name</label>
                <input
                  className="bl-input w-full"
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                  disabled={!canEdit || busy}
                  required
                  data-testid="account-full-name"
                />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Email</label>
                <input
                  className="bl-input w-full"
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  disabled={!canEdit || busy}
                  required
                  data-testid="account-email"
                />
              </div>
              {emailChanged && (
                <div>
                  <label className="label-eyebrow block mb-1">Current password (required for email change)</label>
                  <input
                    className="bl-input w-full"
                    type="password"
                    value={profileForm.current_password}
                    onChange={(e) => setProfileForm({ ...profileForm, current_password: e.target.value })}
                    disabled={!canEdit || busy}
                    required
                  />
                </div>
              )}
              <div>
                <label className="label-eyebrow block mb-1">Phone (optional)</label>
                <input
                  className="bl-input w-full"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  disabled={!canEdit || busy}
                  placeholder="Optional"
                  data-testid="account-phone"
                />
              </div>
              {canEdit && (
                <button type="submit" className="bl-btn-primary" disabled={busy} data-testid="account-save-profile">
                  {busy ? "Saving…" : "Save changes"}
                </button>
              )}
            </form>

            {canEdit && (
              <form onSubmit={savePassword} className="bl-card p-5 space-y-4" data-testid="account-password-form">
                <h2 className="font-display text-lg text-[#2D3A33]">Change password</h2>
                <input className="bl-input w-full" type="password" placeholder="Current password" value={passwordForm.current_password} onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })} required autoComplete="current-password" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input className="bl-input w-full" type="password" placeholder="New password" value={passwordForm.new_password} onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })} required autoComplete="new-password" />
                  <input className="bl-input w-full" type="password" placeholder="Confirm new password" value={passwordForm.confirm_new_password} onChange={(e) => setPasswordForm({ ...passwordForm, confirm_new_password: e.target.value })} required autoComplete="new-password" />
                </div>
                <button type="submit" className="bl-btn-primary" disabled={busy}>
                  {busy ? "Updating…" : "Update password"}
                </button>
              </form>
            )}
          </div>
        )}

        {tab === "security" && showSecurity && (
          <ClinicTwoFactorPanel account={account} onAccountChange={loadAccount} />
        )}

        {tab === "schedule" && showSchedule && user?.id && (
          <MyScheduleReadOnly staffId={user.id} />
        )}

        {tab === "commission" && showCommission && user?.id && (
          <FeatureRoute feature="commissions">
            <StaffCommissionPanel
              staffId={user.id}
              staffName={account?.full_name || user.name}
              canManage={false}
              canExport={false}
              readOnly
            />
          </FeatureRoute>
        )}

        {tab === "commission" && !showCommission && (
          <div className="bl-card p-6 text-sm text-[#5C6C62]">
            You don&apos;t have permission to view commission records.
          </div>
        )}
      </div>
    </div>
  );
}
