import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const DEMO = [
  { role: "Super Admin", email: "admin@bodylab.id" },
  { role: "Doctor", email: "doctor@bodylab.id" },
  { role: "Therapist", email: "therapist@bodylab.id" },
  { role: "Front Office", email: "fo@bodylab.id" },
  { role: "Manager", email: "manager@bodylab.id" },
];

export default function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) { nav("/"); }

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

  const fillDemo = (em) => {
    setEmail(em);
    setPassword("password123");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#FDFBF7]">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#F3F1EB] border-r border-[#EAE6D7]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#8A9A86] flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <div className="font-display text-2xl text-[#2D3A33]">Body Lab Bali</div>
            <div className="text-sm text-[#D4A373] font-medium">Aesthetic Clinic · Internal EMR</div>
          </div>
        </div>

        <div>
          <div className="label-eyebrow">Modern clinical records</div>
          <h1 className="font-display text-5xl tracking-tight font-light mt-3 text-[#2D3A33] leading-[1.05]">
            Where <span className="text-[#8A9A86]">care</span><br/>meets clarity.
          </h1>
          <p className="mt-6 max-w-md text-[#5C6C62] leading-relaxed">
            A secure internal medical record system designed for our doctors, therapists,
            front office and management. Tablet-first, role-aware, and built for the way
            we work at Body Lab Bali.
          </p>
        </div>

        <div className="bl-card p-5">
          <div className="label-eyebrow">Demo accounts (password: <span className="normal-case tracking-normal text-[#2D3A33]">password123</span>)</div>
          <div className="mt-3 grid grid-cols-1 gap-1.5">
            {DEMO.map((d) => (
              <button
                key={d.email}
                onClick={() => fillDemo(d.email)}
                className="text-left px-3 py-2 rounded-lg hover:bg-[#F3F1EB] flex items-center justify-between text-sm transition"
                data-testid={`demo-${d.role.toLowerCase().replace(/\s+/g,'-')}`}
              >
                <span className="font-medium text-[#2D3A33]">{d.role}</span>
                <span className="text-xs text-[#5C6C62]">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#8A9A86] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="font-display text-xl text-[#2D3A33]">Body Lab Bali</div>
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

          <div className="lg:hidden mt-8 bl-card p-4">
            <div className="label-eyebrow">Demo accounts</div>
            <div className="mt-2 grid grid-cols-1 gap-1">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => fillDemo(d.email)} className="text-left text-sm py-1.5 px-2 rounded hover:bg-[#F3F1EB]">
                  <span className="font-medium">{d.role}</span> · <span className="text-[#5C6C62]">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
