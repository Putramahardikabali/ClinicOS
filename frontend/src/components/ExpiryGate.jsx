import { useClinic, formatIdr } from "@/lib/clinic";
import { useAuth } from "@/lib/auth";
import { Link } from "react-router-dom";
import { LockKeyhole, Check, Sparkles } from "lucide-react";

export default function ExpiryGate() {
  const { clinic } = useClinic();
  const { logout } = useAuth();
  if (!clinic || !clinic.readonly) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-[#2D3A33]/70 backdrop-blur-sm overflow-y-auto flex items-start justify-center p-4" data-testid="expiry-gate">
      <div className="bl-card max-w-4xl w-full my-10 p-6 sm:p-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "#FBE7DF", color: "#B14A2C" }}>
            <LockKeyhole className="w-5 h-5" />
          </div>
          <div className="label-eyebrow">Subscription required</div>
        </div>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light text-[#2D3A33]">Your subscription has expired.</h1>
        <p className="mt-2 text-[#5C6C62]">Choose a plan below to continue using ClinicOS. Your data is safe and ready to go the moment you renew.</p>
        <PlansGrid />
        <div className="mt-8 pt-6 border-t border-[#EAE6D7] flex flex-wrap items-center gap-4 justify-between">
          <p className="text-xs text-[#5C6C62]">Need help? Contact us at <a className="underline" href="https://wa.me/" target="_blank" rel="noreferrer">WhatsApp</a>.</p>
          <button onClick={logout} className="bl-btn-ghost text-sm" data-testid="expiry-gate-logout">Sign out</button>
        </div>
      </div>
    </div>
  );
}

export function PlansGrid({ onSelect, recommended }) {
  const { plans, clinic } = useClinic();
  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="plans-grid">
      {plans.map((p) => {
        const popular = p.most_popular;
        const isRecommended = recommended && recommended === p.key;
        const current = clinic?.subscription?.plan === p.key && clinic?.subscription?.status === "active";
        return (
          <div key={p.key} className={`bl-card p-6 relative ${isRecommended ? "ring-2" : popular ? "ring-2" : ""}`} style={isRecommended ? { boxShadow: "0 0 0 2px var(--bl-accent)" } : popular ? { boxShadow: "0 0 0 2px var(--bl-primary)" } : {}} data-testid={`plan-card-${p.key}`}>
            {isRecommended && (
              <div className="absolute -top-3 left-6 px-3 py-0.5 rounded-full text-xs font-semibold text-white flex items-center gap-1" style={{ background: "var(--bl-accent)" }} data-testid={`plan-recommended-${p.key}`}>
                <Sparkles className="w-3 h-3" /> Recommended for you
              </div>
            )}
            {!isRecommended && popular && (
              <div className="absolute -top-3 left-6 px-3 py-0.5 rounded-full text-xs font-semibold text-white flex items-center gap-1" style={{ background: "var(--bl-primary)" }}>
                <Sparkles className="w-3 h-3" /> Most popular
              </div>
            )}
            <div className="label-eyebrow">{p.name}</div>
            <div className="font-display text-3xl text-[#2D3A33] mt-2">{formatIdr(p.price_idr)}<span className="text-sm text-[#5C6C62] font-normal"> / month</span></div>
            <ul className="mt-5 space-y-2 text-sm text-[#2D3A33]">
              {p.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--bl-primary)" }} />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
            {current ? (
              <div className="mt-6 w-full text-center py-3 rounded-xl bg-[#EDF3EF] text-[#52796F] font-medium text-sm">Current plan</div>
            ) : onSelect ? (
              <button onClick={() => onSelect(p)} className="bl-btn-primary mt-6 w-full" data-testid={`plan-choose-${p.key}`}>Choose this plan</button>
            ) : (
              <Link to={`/billing/checkout?plan=${p.key}`} className="bl-btn-primary mt-6 w-full inline-block text-center" data-testid={`plan-choose-${p.key}`}>Choose this plan</Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
