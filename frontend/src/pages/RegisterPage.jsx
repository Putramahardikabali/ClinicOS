import { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Sparkles, Check } from "lucide-react";

export default function RegisterPage() {
  const { user } = useAuth();
  const { branding } = useSettings();
  const nav = useNavigate();
  const [form, setForm] = useState({ clinic_name: "", owner_name: "", email: "", password: "", phone: "", city: "" });
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/auth/register-clinic", form);
      localStorage.setItem("bl_token", r.data.token);
      toast.success("Welcome to ClinicOS — your 14-day trial just started!");
      window.location.href = "/onboarding";
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Registration failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#FDFBF7]">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#F3F1EB] border-r border-[#EAE6D7]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="font-display text-2xl text-[#2D3A33]">ClinicOS</div>
            <div className="text-sm font-medium" style={{ color: "var(--bl-accent)" }}>The all-in-one OS for aesthetic clinics</div>
          </div>
        </div>
        <div>
          <div className="label-eyebrow">Free 14-day trial</div>
          <h1 className="font-display text-5xl font-light mt-3 text-[#2D3A33] leading-[1.05]">
            Run your <span style={{ color: "var(--bl-primary)" }}>clinic</span>,<br/>not your spreadsheets.
          </h1>
          <ul className="mt-7 space-y-3 text-[#2D3A33]">
            {["Multi-role patient chart with digital signatures", "Online appointment page for your patients", "Photo & face-mapping documentation", "Treatment, billing, reports & more"].map((t, i) => (
              <li key={i} className="flex items-center gap-2"><Check className="w-4 h-4" style={{ color: "var(--bl-primary)" }} /> {t}</li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-[#5C6C62]">No credit card required · Cancel anytime</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="label-eyebrow">Create your clinic</div>
          <h2 className="font-display text-3xl mt-2 text-[#2D3A33]">Start your trial.</h2>
          <p className="mt-2 text-[#5C6C62]">14 days of full access. No card needed.</p>

          <form onSubmit={submit} className="mt-7 space-y-3" data-testid="register-form">
            <div>
              <label className="label-eyebrow block mb-1.5">Clinic name</label>
              <input required className="bl-input" value={form.clinic_name} onChange={e=>setForm({...form, clinic_name: e.target.value})} placeholder="e.g. Glow Aesthetic Clinic" data-testid="register-clinic-name" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Your name</label>
              <input required className="bl-input" value={form.owner_name} onChange={e=>setForm({...form, owner_name: e.target.value})} placeholder="dr. Sarah Wijaya" data-testid="register-owner-name" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Email</label>
              <input required type="email" className="bl-input" value={form.email} onChange={e=>setForm({...form, email: e.target.value})} placeholder="you@clinic.com" data-testid="register-email" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Password</label>
                <input required type="password" minLength={6} className="bl-input" value={form.password} onChange={e=>setForm({...form, password: e.target.value})} data-testid="register-password" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Phone</label>
                <input className="bl-input" value={form.phone} onChange={e=>setForm({...form, phone: e.target.value})} placeholder="0812…" />
              </div>
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">City</label>
              <input className="bl-input" value={form.city} onChange={e=>setForm({...form, city: e.target.value})} placeholder="Jakarta / Bali / Surabaya" />
            </div>
            <button type="submit" className="bl-btn-primary w-full mt-3" disabled={busy} data-testid="register-submit">{busy ? "Creating…" : "Start free 14-day trial"}</button>
          </form>

          <p className="mt-6 text-sm text-center text-[#5C6C62]">
            Already have an account? <Link to="/login" className="font-medium" style={{ color: "var(--bl-primary)" }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
