import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const APP_NAME = "ClinicOS";
const APP_TAGLINE = "Clinic management for modern clinics";

export default function LoginPage() {
  const { login, user, complete2faVerify, complete2faRecovery } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("credentials");
  const [challengeToken, setChallengeToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.requires2fa) {
        setChallengeToken(result.challengeToken);
        setStep("totp");
        return;
      }
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      let msg = err?.response?.data?.detail;
      if (!msg && !err?.response) {
        msg = "Cannot reach the API. Start the backend (port 8000) and MongoDB, then restart the frontend.";
      }
      if (!msg) msg = "Invalid email or password";
      toast.error(typeof msg === "string" ? msg : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await complete2faVerify(challengeToken, totpCode);
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const submitRecovery = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await complete2faRecovery(challengeToken, recoveryCode);
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Recovery failed");
    } finally {
      setBusy(false);
    }
  };

  const backToCredentials = () => {
    setStep("credentials");
    setChallengeToken("");
    setTotpCode("");
    setRecoveryCode("");
  };

  const formTitle = step === "credentials" ? "Welcome back." : step === "totp" ? "Two-factor authentication" : "Recovery code";
  const formSubtitle =
    step === "credentials"
      ? "Sign in to manage your clinic operations."
      : step === "totp"
        ? "Enter the 6-digit code from your authenticator app."
        : "Enter one of your recovery codes. Each code works once.";

  const brandMark = (
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "var(--bl-primary)" }}>
        <Sparkles className="w-6 h-6 text-white" strokeWidth={1.5} />
      </div>
      <div>
        <div className="font-display text-2xl text-[#2D3A33]">{APP_NAME}</div>
        <div className="text-sm font-medium" style={{ color: "var(--bl-accent)" }}>{APP_TAGLINE}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#FDFBF7]">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#F3F1EB] border-r border-[#EAE6D7]">
        {brandMark}

        <div>
          <div className="label-eyebrow">Clinical operations platform</div>
          <h1 className="font-display text-5xl tracking-tight font-light mt-3 text-[#2D3A33] leading-[1.05]">
            Where <span style={{ color: "var(--bl-primary)" }}>care</span><br />meets clarity.
          </h1>
          <p className="mt-6 max-w-md text-[#5C6C62] leading-relaxed">
            A secure workspace for doctors, therapists, front desk, and management — appointments, treatment sessions, billing, and more in one place.
          </p>
        </div>

        <div className="text-xs text-[#5C6C62]">
          © {new Date().getFullYear()} {APP_NAME}. Confidential clinical records.
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="font-display text-xl text-[#2D3A33]">{APP_NAME}</div>
            </div>
          </div>

          <div className="label-eyebrow">Sign in</div>
          <h2 className="font-display text-3xl mt-2 text-[#2D3A33]">{formTitle}</h2>
          <p className="mt-2 text-[#5C6C62]">{formSubtitle}</p>

          {step === "credentials" && (
            <form onSubmit={submit} className="mt-8 space-y-4" data-testid="login-form">
              <div>
                <label className="label-eyebrow block mb-2">Email</label>
                <input
                  className="bl-input w-full"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                  required
                  data-testid="login-email-input"
                />
              </div>
              <div>
                <label className="label-eyebrow block mb-2">Password</label>
                <input
                  className="bl-input w-full"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  data-testid="login-password-input"
                />
              </div>
              <button className="bl-btn-primary w-full mt-2" type="submit" disabled={busy} data-testid="login-submit-button">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {step === "totp" && (
            <form onSubmit={submitTotp} className="mt-8 space-y-4" data-testid="login-2fa-form">
              <div>
                <label className="label-eyebrow block mb-2">Authenticator code</label>
                <input
                  className="bl-input text-center text-lg tracking-widest w-full"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  data-testid="login-2fa-code"
                />
              </div>
              <button className="bl-btn-primary w-full" type="submit" disabled={busy || totpCode.length !== 6} data-testid="login-2fa-submit">
                {busy ? "Verifying…" : "Verify"}
              </button>
              <button type="button" onClick={() => setStep("recovery")} className="w-full text-sm text-[#5C6C62] underline">
                Use a recovery code instead
              </button>
              <button type="button" onClick={backToCredentials} className="w-full text-sm text-[#5C6C62]">
                Back to sign in
              </button>
            </form>
          )}

          {step === "recovery" && (
            <form onSubmit={submitRecovery} className="mt-8 space-y-4" data-testid="login-recovery-form">
              <div>
                <label className="label-eyebrow block mb-2">Recovery code</label>
                <input
                  className="bl-input uppercase w-full"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                  required
                  data-testid="login-recovery-code"
                />
              </div>
              <button className="bl-btn-primary w-full" type="submit" disabled={busy || !recoveryCode.trim()}>
                {busy ? "Verifying…" : "Sign in with recovery code"}
              </button>
              <button type="button" onClick={() => setStep("totp")} className="w-full text-sm text-[#5C6C62] underline">
                Use authenticator app instead
              </button>
              <button type="button" onClick={backToCredentials} className="w-full text-sm text-[#5C6C62]">
                Back to sign in
              </button>
            </form>
          )}

          {step === "credentials" && (
            <>
              <p className="mt-8 text-sm text-center text-[#5C6C62]">
                New to ClinicOS?{" "}
                <Link to="/register" className="font-medium" style={{ color: "var(--bl-primary)" }} data-testid="login-register-link">
                  Start your free trial →
                </Link>
              </p>
              <p className="mt-3 text-xs text-[#5C6C62] text-center">
                Lost access? Contact your clinic administrator.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
