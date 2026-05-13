import { Link } from "react-router-dom";
import { useClinic, trialDaysLeft } from "@/lib/clinic";
import { Sparkles, AlertTriangle } from "lucide-react";

export default function SubscriptionBanner() {
  const { clinic } = useClinic();
  if (!clinic) return null;
  const sub = clinic.subscription || {};

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
