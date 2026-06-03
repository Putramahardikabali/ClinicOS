import { Link } from "react-router-dom";
import { useClinic, trialDaysLeft } from "@/lib/clinic";
import { useAuth } from "@/lib/auth";
import { Sparkles, AlertTriangle } from "lucide-react";
import { canManageSubscription, isSubscriptionLimited, subscriptionWasTrial } from "@/lib/subscriptionAccess";

export default function SubscriptionBanner() {
  const { clinic } = useClinic();
  const { user } = useAuth();
  if (!clinic) return null;
  const sub = clinic.subscription || {};

  if (isSubscriptionLimited(clinic) && canManageSubscription(clinic, user)) {
    const trialEnded = sub.status === "expired" && subscriptionWasTrial(clinic);
    return (
      <div className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ background: "#FBE7DF", color: "#B14A2C", borderBottom: "1px solid #F1C9B7" }} data-testid="expired-banner">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          {trialEnded
            ? "Your trial has ended. Please renew your subscription to continue using ClinicOS."
            : "Your subscription has expired. Please renew to restore full access."}
        </span>
        <Link to="/billing/plans" className="underline font-medium whitespace-nowrap" data-testid="expired-cta">Go to Billing & Plan →</Link>
      </div>
    );
  }

  if (sub.status === "trial") {
    const days = trialDaysLeft(clinic);
    if (days === null) return null;
    if (days <= 0) return null; // expired modal will handle
    return (
      <div className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ background: "#FBF3DB", color: "#8A6D1F", borderBottom: "1px solid #EFE2B0" }} data-testid="trial-banner">
        <Sparkles className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          Your free trial ends in <strong>{days} day{days !== 1 ? "s" : ""}</strong>. Choose a plan to keep your data flowing.
        </span>
        <Link to="/billing/plans" className="underline font-medium whitespace-nowrap" data-testid="trial-cta">Choose a plan →</Link>
      </div>
    );
  }

  if (sub.status === "past_due") {
    const until = sub.past_due_until ? new Date(sub.past_due_until) : null;
    const days = until ? Math.ceil((until - new Date()) / (1000 * 60 * 60 * 24)) : null;
    return (
      <div className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ background: "#FBE7DF", color: "#B14A2C", borderBottom: "1px solid #F1C9B7" }} data-testid="past-due-banner">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          Payment overdue{days != null && days > 0 ? ` · ${days} day${days !== 1 ? "s" : ""} of grace remaining` : ""}. Renew to avoid losing access.
        </span>
        <Link to="/billing/plans" className="underline font-medium whitespace-nowrap">Renew →</Link>
      </div>
    );
  }

  if (sub.expiry_date && sub.status === "active") {
    const days = Math.ceil((new Date(sub.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7 && days > 0) {
      return (
        <div className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ background: "#FBE7DF", color: "#B14A2C", borderBottom: "1px solid #F1C9B7" }} data-testid="renewal-banner">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">Your subscription renews in <strong>{days} day{days !== 1 ? "s" : ""}</strong>. Renew now to avoid interruption.</span>
          <Link to="/billing/plans" className="underline font-medium whitespace-nowrap">Renew →</Link>
        </div>
      );
    }
  }
  return null;
}
