import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { useClinic } from "@/lib/clinic";
import { useSettings } from "@/lib/settings";
import { Check, Upload, Building2, Sparkles, ArrowRight } from "lucide-react";

const STEPS = ["Profile", "Branding", "Done"];

export default function OnboardingPage() {
  const { clinic, refresh } = useClinic();
  const { refresh: refreshSettings } = useSettings();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({ address: "", phone: "", city: clinic?.city || "" });

  const skip = async () => {
    try { await api.put("/clinics/me", { onboarded: true }); await refresh(); nav("/"); } catch {}
  };

  const next = async () => {
    if (step === 0) {
      try {
        await api.put("/clinics/me", profile);
        await refresh();
      } catch (e) { toast.error("Failed to save"); return; }
    }
    if (step === STEPS.length - 1) {
      await api.put("/clinics/me", { onboarded: true });
      await refresh();
      nav("/");
    } else {
      setStep(step + 1);
    }
  };

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      await api.post("/admin/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await refreshSettings();
      toast.success("Logo uploaded");
    } catch (err) { toast.error(err?.response?.data?.detail || "Logo upload failed"); }
    e.target.value = "";
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-4">
      <div className="bl-card max-w-2xl w-full p-6 sm:p-10" data-testid="onboarding-card">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4" style={{ color: "var(--bl-accent)" }} />
          <div className="label-eyebrow">Welcome to ClinicOS</div>
        </div>
        <h1 className="font-display text-3xl text-[#2D3A33]">Let's set up {clinic?.name || "your clinic"}.</h1>

        <div className="mt-6 flex gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 h-1.5 rounded-full" style={{ background: i <= step ? "var(--bl-primary)" : "#EAE6D7" }} />
          ))}
        </div>
        <div className="mt-1 text-xs text-[#5C6C62]">Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>

        <div className="mt-7">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#2D3A33]"><Building2 className="w-5 h-5" /> <span className="font-medium">Clinic profile</span></div>
              <div>
                <label className="label-eyebrow block mb-1.5">Address</label>
                <input className="bl-input" value={profile.address} onChange={e=>setProfile({...profile, address: e.target.value})} placeholder="Jl. Sunset Road no. 123" data-testid="onboard-address" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">City</label>
                  <input className="bl-input" value={profile.city} onChange={e=>setProfile({...profile, city: e.target.value})} />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Phone</label>
                  <input className="bl-input" value={profile.phone} onChange={e=>setProfile({...profile, phone: e.target.value})} />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#2D3A33]"><Sparkles className="w-5 h-5" /> <span className="font-medium">Add your logo (optional)</span></div>
              <p className="text-sm text-[#5C6C62]">Your logo will appear on the dashboard, login screen, and patient-facing booking page. PNG, JPG, or SVG.</p>
              <label className="bl-btn-ghost inline-flex items-center gap-2 cursor-pointer" data-testid="onboard-logo">
                <Upload className="w-4 h-4" /> Upload logo
                <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "#EDF3EF", color: "#52796F" }}>
                <Check className="w-7 h-7" />
              </div>
              <h2 className="font-display text-2xl text-[#2D3A33] mt-4">You're all set.</h2>
              <p className="text-[#5C6C62] mt-2">Your 14-day trial is active. You can invite staff and explore every feature from your dashboard.</p>
            </div>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-[#EAE6D7] flex items-center justify-between">
          <button onClick={skip} className="text-sm text-[#5C6C62] hover:text-[#2D3A33]" data-testid="onboard-skip">Skip for now</button>
          <button onClick={next} className="bl-btn-primary inline-flex items-center gap-2" data-testid="onboard-next">
            {step === STEPS.length - 1 ? "Go to dashboard" : "Continue"} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
