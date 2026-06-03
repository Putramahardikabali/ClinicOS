import { useClinic } from "@/lib/clinic";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import {
  canAccessPathWhenLimited,
  isSubscriptionLimited,
  limitedAccessMessage,
} from "@/lib/subscriptionAccess";

export default function ExpiryGate() {
  const { clinic } = useClinic();
  const { user, logout } = useAuth();
  const loc = useLocation();

  if (!clinic || !user) return null;
  if (!isSubscriptionLimited(clinic)) return null;
  if (canAccessPathWhenLimited(clinic, loc.pathname, user)) return null;

  const sub = clinic.subscription || {};
  const msg = limitedAccessMessage(clinic, user);
  const isSuspended = sub.status === "suspended" || clinic.access_mode === "blocked";

  if (isSuspended && sub.status === "suspended") {
    return (
      <div className="fixed inset-0 z-[80] bg-[#2D3A33]/70 backdrop-blur-sm overflow-y-auto flex items-start justify-center p-4" data-testid="expiry-gate">
        <div className="bl-card max-w-lg w-full my-10 p-6 sm:p-10">
          <GateHeader title="Account suspended" />
          <p className="mt-2 text-[#5C6C62]">
            This clinic account has been suspended. Please contact ClinicOS support for assistance.
          </p>
          <GateFooter logout={logout} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-[#2D3A33]/70 backdrop-blur-sm overflow-y-auto flex items-start justify-center p-4" data-testid="expiry-gate">
      <div className="bl-card max-w-lg w-full my-10 p-6 sm:p-10">
        <GateHeader title={msg.title} />
        <p className="mt-2 text-[#5C6C62]">{msg.body}</p>
        {msg.showBillingCta && (
          <div className="mt-6">
            <Link to="/billing/plans" className="bl-btn-primary inline-flex" data-testid="expiry-gate-billing">
              Go to Billing & Plan
            </Link>
          </div>
        )}
        <GateFooter logout={logout} />
      </div>
    </div>
  );
}

function GateHeader({ title }) {
  return (
  <>
    <div className="flex items-center gap-3 mb-2">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "#FBE7DF", color: "#B14A2C" }}>
        <LockKeyhole className="w-5 h-5" />
      </div>
      <div className="label-eyebrow">Subscription required</div>
    </div>
    <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light text-[#2D3A33]">{title}</h1>
  </>
  );
}

function GateFooter({ logout }) {
  return (
    <div className="mt-8 pt-6 border-t border-[#EAE6D7] flex flex-wrap items-center gap-4 justify-between">
      <p className="text-xs text-[#5C6C62]">
        Need help? <Link to="/help" className="underline">Help & Support</Link>
      </p>
      <button type="button" onClick={logout} className="bl-btn-ghost text-sm" data-testid="expiry-gate-logout">
        Sign out
      </button>
    </div>
  );
}

export { PlansGrid } from "./PlansGrid";
