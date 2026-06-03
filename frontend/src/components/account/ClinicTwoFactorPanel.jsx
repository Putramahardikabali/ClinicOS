import { useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import RecoveryCodesPanel from "./RecoveryCodesPanel";

export default function ClinicTwoFactorPanel({ account, onAccountChange }) {
  const [setupData, setSetupData] = useState(null);
  const [enableCode, setEnableCode] = useState("");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState(null);
  const [disableForm, setDisableForm] = useState({ current_password: "", code: "" });
  const [regenForm, setRegenForm] = useState({ current_password: "", code: "" });
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api.post("/account/2fa/setup");
      setSetupData(r.data);
      setEnableCode("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start 2FA setup");
    } finally {
      setBusy(false);
    }
  };

  const enable2fa = async (e) => {
    e.preventDefault();
    if (enableCode.length !== 6) {
      toast.error("Enter a 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/account/2fa/enable", { code: enableCode });
      setNewRecoveryCodes(r.data?.recovery_codes || []);
      setSetupData(null);
      setEnableCode("");
      await onAccountChange?.();
      toast.success(r.data?.message || "Two-factor authentication enabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/account/2fa/disable", disableForm);
      setDisableForm({ current_password: "", code: "" });
      await onAccountChange?.();
      toast.success(r.data?.message || "Two-factor authentication disabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/account/2fa/recovery-codes/regenerate", regenForm);
      setNewRecoveryCodes(r.data?.recovery_codes || []);
      setRegenForm({ current_password: "", code: "" });
      await onAccountChange?.();
      toast.success("Recovery codes regenerated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to regenerate recovery codes");
    } finally {
      setBusy(false);
    }
  };

  if (!account?.can_use_2fa) return null;

  return (
    <div className="bl-card p-5 space-y-5" data-testid="account-security-2fa">
      <div>
        <h2 className="font-display text-lg text-[#2D3A33]">Two-factor authentication</h2>
        <p className="text-sm text-[#5C6C62] mt-1">
          Add an extra layer of security with an authenticator app (Google Authenticator, Authy, etc.).
        </p>
        {account.require_2fa_for_owner_manager && (
          <p className="text-xs text-[#5C6C62] mt-2">
            Your clinic requires Owner and Manager accounts to use two-factor authentication.
          </p>
        )}
      </div>

      {newRecoveryCodes && (
        <RecoveryCodesPanel codes={newRecoveryCodes} onDismiss={() => setNewRecoveryCodes(null)} />
      )}

      {!account.totp_enabled && !setupData && (
        <button type="button" disabled={busy} onClick={startSetup} className="bl-btn-primary" data-testid="account-2fa-enable-start">
          {busy ? "Starting…" : "Enable two-factor authentication"}
        </button>
      )}

      {setupData && (
        <form onSubmit={enable2fa} className="space-y-4">
          <p className="text-sm text-[#5C6C62]">Scan this QR code or enter the setup key manually.</p>
          {setupData.qr_code_data_uri && (
            <img src={setupData.qr_code_data_uri} alt="2FA QR code" className="w-48 h-48 rounded-lg border border-[#EAE6D7]" />
          )}
          <div>
            <label className="label-eyebrow block mb-1">Manual setup key</label>
            <div className="font-mono text-sm break-all p-3 rounded-lg bg-[#F8F5EC] border border-[#EAE6D7]">{setupData.manual_setup_key}</div>
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Verification code</label>
            <input
              className="bl-input w-full tracking-widest"
              inputMode="numeric"
              maxLength={6}
              value={enableCode}
              onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              data-testid="account-2fa-verify-code"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || enableCode.length !== 6} className="bl-btn-primary">
              {busy ? "Enabling…" : "Verify and enable"}
            </button>
            <button type="button" onClick={() => { setSetupData(null); setEnableCode(""); }} className="bl-btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}

      {account.totp_enabled && (
        <>
          <p className="text-sm text-[#2D3A33]">
            Status: <span className="text-[#5C6C62]">Enabled</span>
            {" · "}
            {account.recovery_codes_remaining} recovery code{account.recovery_codes_remaining === 1 ? "" : "s"} remaining
          </p>

          <form onSubmit={regenerate} className="p-4 rounded-xl border border-[#EAE6D7] space-y-3">
            <div className="text-sm font-medium text-[#2D3A33]">Regenerate recovery codes</div>
            <input className="bl-input w-full" type="password" placeholder="Current password" value={regenForm.current_password} onChange={(e) => setRegenForm({ ...regenForm, current_password: e.target.value })} required />
            <input className="bl-input w-full" inputMode="numeric" maxLength={6} placeholder="Authenticator code" value={regenForm.code} onChange={(e) => setRegenForm({ ...regenForm, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} required />
            <button type="submit" disabled={busy} className="bl-btn-primary text-sm">Regenerate codes</button>
          </form>

          {!account.require_2fa_for_owner_manager && (
            <form onSubmit={disable2fa} className="p-4 rounded-xl border border-red-200 bg-red-50/50 space-y-3">
              <div className="text-sm font-medium text-[#2D3A33]">Disable two-factor authentication</div>
              <input className="bl-input w-full" type="password" placeholder="Current password" value={disableForm.current_password} onChange={(e) => setDisableForm({ ...disableForm, current_password: e.target.value })} required />
              <input className="bl-input w-full" inputMode="numeric" maxLength={6} placeholder="Authenticator code" value={disableForm.code} onChange={(e) => setDisableForm({ ...disableForm, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} required />
              <button type="submit" disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-red-700 text-white">
                Disable 2FA
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
