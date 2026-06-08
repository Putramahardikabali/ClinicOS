import { Link, Navigate, useNavigate } from "react-router-dom";
import { Sparkles, Crown, Briefcase, Monitor, Stethoscope, Heart, Calculator } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DEMO_ROLE_ORDER,
  demoAccounts,
  demoLoginPath,
  isDemoAccountConfigured,
} from "@/lib/demoAccounts";

const ROLE_ICONS = {
  owner: Crown,
  manager: Briefcase,
  fo: Monitor,
  doctor: Stethoscope,
  therapist: Heart,
  accounting: Calculator,
};

export default function DemoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display text-xl text-[#2D3A33]">ClinicOS</div>
            <div className="text-xs font-medium" style={{ color: "var(--bl-accent)" }}>Sample clinic workspace</div>
          </div>
        </div>

        <div className="label-eyebrow">Live demo</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-2 text-[#2D3A33]" data-testid="demo-page-title">
          Try ClinicOS Demo
        </h1>
        <p className="mt-3 text-[#5C6C62] max-w-2xl">
          Explore ClinicOS using a sample clinic workspace.
        </p>
        <p className="mt-2 text-sm text-[#5C6C62]">
          Choose a role below. We&apos;ll fill in Demo Clinic credentials on the sign-in page — you still click Sign in yourself.
        </p>

        <div
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="demo-role-grid"
        >
          {DEMO_ROLE_ORDER.map((roleKey) => {
            const account = demoAccounts[roleKey];
            const Icon = ROLE_ICONS[roleKey] || Monitor;
            const ready = isDemoAccountConfigured(roleKey);
            return (
              <article
                key={roleKey}
                className="rounded-2xl border border-[#EAE6D7] bg-white p-5 flex flex-col shadow-sm"
                data-testid={`demo-role-card-${roleKey}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--bl-primary) 12%, white)" }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "var(--bl-primary)" }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg text-[#2D3A33]">{account.label}</h2>
                    <p className="mt-1 text-sm text-[#5C6C62] leading-relaxed">{account.description}</p>
                  </div>
                </div>
                <div className="mt-auto pt-4 border-t border-[#F0EDE4]">
                  {ready ? (
                    <button
                      type="button"
                      className="bl-btn-primary w-full"
                      data-testid={`demo-use-account-${roleKey}`}
                      onClick={() => navigate(demoLoginPath(roleKey))}
                    >
                      Use demo account
                    </button>
                  ) : (
                    <div
                      className="w-full text-center text-sm font-medium py-2.5 rounded-xl bg-[#F3F1EB] text-[#5C6C62]"
                      data-testid={`demo-coming-soon-${roleKey}`}
                    >
                      Coming soon
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-10 text-sm text-center text-[#5C6C62]">
          Already have a clinic?{" "}
          <Link to="/login" className="font-medium" style={{ color: "var(--bl-primary)" }} data-testid="demo-sign-in-link">
            Sign in →
          </Link>
        </p>
      </div>
    </div>
  );
}
