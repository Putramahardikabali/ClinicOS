import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useSettings, logoUrl } from "@/lib/settings";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export default function LoginPage() {
  const { login, user } = useAuth();
  const { branding } = useSettings();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Invalid email or password";
      toast.error(typeof msg === "string" ? msg : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#FDFBF7]">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#F3F1EB] border-r border-[#EAE6D7]">
        <div className="flex items-center gap-3">
          {branding?.logo_path ? (
            <img src={logoUrl(branding.logo_path)} alt="logo" className="w-11 h-11 rounded-2xl object-cover" />
          ) : (
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
              <Sparkles className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <div className="font-display text-2xl text-[#2D3A33]">{branding?.clinic_name || "Body Lab Bali"}</div>
            <div className="text-sm font-medium" style={{ color: "var(--bl-accent)" }}>{branding?.tagline || "Aesthetic Clinic · Internal EMR"}</div>
          </div>
        </div>

        <div>
          <div className="label-eyebrow">Modern clinical records</div>
          <h1 className="font-display text-5xl tracking-tight font-light mt-3 text-[#2D3A33] leading-[1.05]">
            Where <span style={{ color: "var(--bl-primary)" }}>care</span><br/>meets clarity.
          </h1>
          <p className="mt-6 max-w-md text-[#5C6C62] leading-relaxed">
            A secure internal medical record system designed for our doctors, therapists,
            front office and management. Tablet-first, role-aware, and built for the way
            we work.
          </p>
        </div>

        <div className="text-xs text-[#5C6C62]">
          © {new Date().getFullYear()} {branding?.clinic_name || "Body Lab Bali"}. Confidential clinical records.
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            {branding?.logo_path ? (
              <img src={logoUrl(branding.logo_path)} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
                <Sparkles className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="font-display text-xl text-[#2D3A33]">{branding?.clinic_name || "Body Lab Bali"}</div>
          </div>

          <div className="label-eyebrow">Sign in</div>
          <h2 className="font-display text-3xl mt-2 text-[#2D3A33]">Welcome back.</h2>
          <p className="mt-2 text-[#5C6C62]">Enter your credentials to access the EMR.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" data-testid="login-form">
            <div>
              <label className="label-eyebrow block mb-2">Email</label>
              <input
                className="bl-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@bodylab.id"
                required
                data-testid="login-email-input"
              />
            </div>
            <div>
              <label className="label-eyebrow block mb-2">Password</label>
              <input
                className="bl-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                data-testid="login-password-input"
              />
            </div>
            <button
              className="bl-btn-primary w-full mt-2"
              type="submit"
              disabled={busy}
              data-testid="login-submit-button"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-xs text-[#5C6C62] text-center">
            Lost access? Contact your clinic Super Admin.
          </p>
        </div>
      </div>
    </div>
  );
}
