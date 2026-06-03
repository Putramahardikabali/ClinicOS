import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useSuperAdmin } from "@/lib/superadmin";
import { toast } from "sonner";

const TAB_PROFILE = "profile";
const TAB_SECURITY = "security";

function RecoveryCodesPanel({ codes, onDismiss }) {
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy codes");
    }
  };

  return (
    <div className="p-4 rounded-xl space-y-3" style={{ background: "#0F1419", border: "1px solid #2A3942" }}>
      <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>Save your recovery codes</div>
      <p className="text-xs" style={{ color: "#8FA89E" }}>
        Store these codes in a secure place. Each code works once if you lose access to your authenticator app.
      </p>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm" style={{ color: "#E6E8E6" }}>
        {codes.map((c) => (
          <div key={c} className="px-2 py-1 rounded" style={{ background: "#141B22" }}>{c}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={copyAll} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#1A242B", color: "#E6E8E6" }}>
          Copy all
        </button>
        <button type="button" onClick={onDismiss} className="px-3 py-2 rounded-lg text-sm text-white" style={{ background: "#3F5A52" }}>
          I saved these codes
        </button>
      </div>
    </div>
  );
}

export default function SaAccountSettingsPage() {
  const { setAdmin, refreshAdmin } = useSuperAdmin();
  const [activeTab, setActiveTab] = useState(TAB_PROFILE);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "",
    email: "",
    role: "super_admin",
  });
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    email: "",
    current_password: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_new_password: "",
  });

  const [twoFa, setTwoFa] = useState({ enabled: false, recovery_codes_remaining: 0 });
  const [setupData, setSetupData] = useState(null);
  const [enableCode, setEnableCode] = useState("");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState(null);
  const [disableForm, setDisableForm] = useState({ current_password: "", code: "" });
  const [regenForm, setRegenForm] = useState({ current_password: "", code: "" });
  const [twoFaBusy, setTwoFaBusy] = useState(false);

  const loadAccount = async () => {
    const r = await api.get("/superadmin/account");
    const p = {
      full_name: r.data?.full_name || "",
      email: r.data?.email || "",
      role: r.data?.role || "super_admin",
    };
    setProfile(p);
    setProfileForm((f) => ({ ...f, full_name: p.full_name, email: p.email }));
    setTwoFa({
      enabled: !!r.data?.totp_enabled,
      recovery_codes_remaining: r.data?.recovery_codes_remaining || 0,
    });
  };

  const load2faStatus = async () => {
    const r = await api.get("/superadmin/account/2fa");
    setTwoFa({
      enabled: !!r.data?.enabled,
      recovery_codes_remaining: r.data?.recovery_codes_remaining || 0,
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await loadAccount();
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Failed to load account settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    const full_name = profileForm.full_name.trim();
    const email = profileForm.email.trim().toLowerCase();
    if (!full_name) {
      toast.error("Full name is required");
      return;
    }
    if (!email) {
      toast.error("Email is required");
      return;
    }

    setSavingProfile(true);
    try {
      const emailChanged = email !== String(profile.email || "").toLowerCase();

      if (emailChanged) {
        if (!profileForm.current_password) {
          toast.error("Current password is required to change email");
          return;
        }
        await api.put("/superadmin/account/email", {
          new_email: email,
          current_password: profileForm.current_password,
        });
        toast.success("Email updated successfully. Please use the new email next time you log in.");
      }

      const r = await api.put("/superadmin/account/profile", { full_name, email });
      const p = {
        full_name: r.data?.full_name || full_name,
        email: r.data?.email || email,
        role: r.data?.role || "super_admin",
      };
      setProfile(p);
      setProfileForm((f) => ({ ...f, full_name: p.full_name, email: p.email, current_password: "" }));

      const me = await refreshAdmin();
      setAdmin(me);
      toast.success("Profile updated successfully.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_new_password) {
      toast.error("Please fill all password fields");
      return;
    }
    setSavingPassword(true);
    try {
      const r = await api.put("/superadmin/account/password", {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_new_password: passwordForm.confirm_new_password,
      });
      setPasswordForm({ current_password: "", new_password: "", confirm_new_password: "" });
      toast.success(r.data?.message || "Password updated successfully.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const start2faSetup = async () => {
    setTwoFaBusy(true);
    try {
      const r = await api.post("/superadmin/account/2fa/setup");
      setSetupData(r.data);
      setEnableCode("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start 2FA setup");
    } finally {
      setTwoFaBusy(false);
    }
  };

  const enable2fa = async (e) => {
    e.preventDefault();
    if (enableCode.length !== 6) {
      toast.error("Enter a 6-digit code");
      return;
    }
    setTwoFaBusy(true);
    try {
      const r = await api.post("/superadmin/account/2fa/enable", { code: enableCode });
      setNewRecoveryCodes(r.data?.recovery_codes || []);
      setSetupData(null);
      setEnableCode("");
      await load2faStatus();
      toast.success(r.data?.message || "Two-factor authentication enabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to enable 2FA");
    } finally {
      setTwoFaBusy(false);
    }
  };

  const disable2fa = async (e) => {
    e.preventDefault();
    setTwoFaBusy(true);
    try {
      const r = await api.post("/superadmin/account/2fa/disable", disableForm);
      setDisableForm({ current_password: "", code: "" });
      await load2faStatus();
      toast.success(r.data?.message || "Two-factor authentication disabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to disable 2FA");
    } finally {
      setTwoFaBusy(false);
    }
  };

  const regenerateRecoveryCodes = async (e) => {
    e.preventDefault();
    setTwoFaBusy(true);
    try {
      const r = await api.post("/superadmin/account/2fa/recovery-codes/regenerate", regenForm);
      setNewRecoveryCodes(r.data?.recovery_codes || []);
      setRegenForm({ current_password: "", code: "" });
      await load2faStatus();
      toast.success("Recovery codes regenerated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to regenerate recovery codes");
    } finally {
      setTwoFaBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl">
        <div className="text-sm" style={{ color: "#8FA89E" }}>Loading account settings…</div>
      </div>
    );
  }

  const emailChanged = profileForm.email.trim().toLowerCase() !== String(profile.email || "").toLowerCase();

  return (
    <div className="p-6 md:p-10 max-w-4xl space-y-6">
      <div>
        <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Super Admin</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-2 font-light" style={{ color: "#F5F2EA" }}>
          Account settings
        </h1>
      </div>

      <div className="flex gap-2">
        {[TAB_PROFILE, TAB_SECURITY].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-lg text-sm capitalize"
            style={{
              background: activeTab === tab ? "#3F5A52" : "#141B22",
              color: activeTab === tab ? "#FFFFFF" : "#8FA89E",
              border: "1px solid #1F2A30",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === TAB_PROFILE && (
        <>
          <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
            <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Account info</div>
            <div className="mt-3 text-sm space-y-1" style={{ color: "#E6E8E6" }}>
              <div><span style={{ color: "#8FA89E" }}>Role:</span> Super Admin</div>
              <div><span style={{ color: "#8FA89E" }}>Current email:</span> {profile.email}</div>
            </div>
          </div>

          <form onSubmit={saveProfile} className="p-5 rounded-2xl space-y-4" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
            <h2 className="font-display text-xl" style={{ color: "#F5F2EA" }}>Profile</h2>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Full name</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                value={profileForm.full_name}
                onChange={(e) => setProfileForm((f) => ({ ...f, full_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Email</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            {emailChanged && (
              <div>
                <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Current password (required for email change)</label>
                <input
                  className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  type="password"
                  value={profileForm.current_password}
                  onChange={(e) => setProfileForm((f) => ({ ...f, current_password: e.target.value }))}
                  required
                />
              </div>
            )}
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "#3F5A52" }}
            >
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
          </form>

          <form onSubmit={savePassword} className="p-5 rounded-2xl space-y-4" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
            <h2 className="font-display text-xl" style={{ color: "#F5F2EA" }}>Change password</h2>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Current password</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                type="password"
                value={passwordForm.current_password}
                onChange={(e) => setPasswordForm((f) => ({ ...f, current_password: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>New password</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                type="password"
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm((f) => ({ ...f, new_password: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Confirm new password</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                type="password"
                value={passwordForm.confirm_new_password}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirm_new_password: e.target.value }))}
                required
              />
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "#3F5A52" }}
            >
              {savingPassword ? "Updating…" : "Update password"}
            </button>
          </form>
        </>
      )}

      {activeTab === TAB_SECURITY && (
        <div className="p-5 rounded-2xl space-y-5" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
          <div>
            <h2 className="font-display text-xl" style={{ color: "#F5F2EA" }}>Two-factor authentication</h2>
            <p className="text-sm mt-2" style={{ color: "#8FA89E" }}>
              Protect your Super Admin account with an authenticator app (Google Authenticator, Authy, etc.).
            </p>
          </div>

          {newRecoveryCodes && (
            <RecoveryCodesPanel codes={newRecoveryCodes} onDismiss={() => setNewRecoveryCodes(null)} />
          )}

          {!twoFa.enabled && !setupData && (
            <button
              type="button"
              disabled={twoFaBusy}
              onClick={start2faSetup}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "#3F5A52" }}
            >
              {twoFaBusy ? "Starting…" : "Enable two-factor authentication"}
            </button>
          )}

          {setupData && (
            <form onSubmit={enable2fa} className="space-y-4">
              <div className="text-sm" style={{ color: "#C7D1CB" }}>Scan this QR code with your authenticator app, or enter the setup key manually.</div>
              {setupData.qr_code_data_uri && (
                <img src={setupData.qr_code_data_uri} alt="2FA QR code" className="w-48 h-48 rounded-lg" style={{ background: "#FFFFFF" }} />
              )}
              <div>
                <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Manual setup key</div>
                <div className="mt-1 font-mono text-sm break-all px-3 py-2 rounded-lg" style={{ background: "#0F1419", color: "#E6E8E6", border: "1px solid #2A3942" }}>
                  {setupData.manual_setup_key}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Verification code</label>
                <input
                  className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none tracking-widest"
                  style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  inputMode="numeric"
                  maxLength={6}
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={twoFaBusy || enableCode.length !== 6} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "#3F5A52" }}>
                  {twoFaBusy ? "Enabling…" : "Verify and enable"}
                </button>
                <button type="button" onClick={() => { setSetupData(null); setEnableCode(""); }} className="px-4 py-2 rounded-lg text-sm" style={{ background: "#1A242B", color: "#E6E8E6" }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {twoFa.enabled && (
            <>
              <div className="text-sm" style={{ color: "#E6E8E6" }}>
                Status: <span style={{ color: "#8FA89E" }}>Enabled</span>
                {" · "}
                {twoFa.recovery_codes_remaining} recovery code{twoFa.recovery_codes_remaining === 1 ? "" : "s"} remaining
              </div>

              <form onSubmit={regenerateRecoveryCodes} className="p-4 rounded-xl space-y-3" style={{ background: "#0F1419", border: "1px solid #2A3942" }}>
                <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>Regenerate recovery codes</div>
                <p className="text-xs" style={{ color: "#8FA89E" }}>This replaces all existing recovery codes. Requires your password and a current authenticator code.</p>
                <input
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ background: "#141B22", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  type="password"
                  placeholder="Current password"
                  value={regenForm.current_password}
                  onChange={(e) => setRegenForm((f) => ({ ...f, current_password: e.target.value }))}
                  required
                />
                <input
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ background: "#141B22", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Authenticator code"
                  value={regenForm.code}
                  onChange={(e) => setRegenForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  required
                />
                <button type="submit" disabled={twoFaBusy} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "#3F5A52" }}>
                  {twoFaBusy ? "Regenerating…" : "Regenerate codes"}
                </button>
              </form>

              <form onSubmit={disable2fa} className="p-4 rounded-xl space-y-3" style={{ background: "#0F1419", border: "1px solid #2A3942" }}>
                <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>Disable two-factor authentication</div>
                <p className="text-xs" style={{ color: "#8FA89E" }}>Requires your password and a current authenticator code.</p>
                <input
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ background: "#141B22", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  type="password"
                  placeholder="Current password"
                  value={disableForm.current_password}
                  onChange={(e) => setDisableForm((f) => ({ ...f, current_password: e.target.value }))}
                  required
                />
                <input
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ background: "#141B22", border: "1px solid #2A3942", color: "#F5F2EA" }}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Authenticator code"
                  value={disableForm.code}
                  onChange={(e) => setDisableForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  required
                />
                <button type="submit" disabled={twoFaBusy} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "#7A3A3A", color: "#FFFFFF" }}>
                  {twoFaBusy ? "Disabling…" : "Disable 2FA"}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
