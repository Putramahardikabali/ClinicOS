import { useClinic, hasFeature, minimumPlanForFeature } from "@/lib/clinic";
import { Lock, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export const FEATURE_LABELS = {
  audit_log: "Audit log",
  reports: "Reports & analytics",
  treatments: "Treatment catalog (appointments)",
  emr: "Patient chart & treatment notes",
  mapping: "Face & body mapping",
  photos: "Photo gallery",
  online_booking: "Online appointments",
  billing: "Session billing & receipts",
  signature: "Digital signatures",
  whatsapp_automation: "WhatsApp automation",
  multi_location: "Multi-location",
  products: "Products inventory",
  commissions: "Staff commissions",
  packages: "Treatment packages",
  consent: "Consent forms",
  online_booking_payment: "Online appointment payment",
};

export function featureLabel(feature) {
  return FEATURE_LABELS[feature] || feature.replace(/_/g, " ");
}

/** Wrap a UI region that requires a specific plan feature. */
export default function FeatureGate({ feature, children, fallback, page = false }) {
  const { clinic, loading } = useClinic();
  if (feature && loading) {
    return page ? (
      <div className="p-10 text-center text-sm text-[#5C6C62]">Loading…</div>
    ) : null;
  }
  if (!clinic) return feature ? null : children;
  if (hasFeature(clinic, feature)) return children;
  if (fallback) return fallback;
  return page ? (
    <div className="p-6 md:p-8 lg:p-10 max-w-2xl mx-auto">
      <LockedNotice feature={feature} />
    </div>
  ) : (
    <LockedNotice feature={feature} />
  );
}

/** Full-page route wrapper for plan-gated screens. */
export function FeatureRoute({ feature, children }) {
  return (
    <FeatureGate feature={feature} page>
      {children}
    </FeatureGate>
  );
}

export function LockedNotice({ feature }) {
  const { plans } = useClinic();
  const label = featureLabel(feature);
  const minPlan = minimumPlanForFeature(plans, feature);
  const planHint = minPlan
    ? `Included on the ${minPlan.name} plan and above.`
    : "Upgrade your subscription to unlock it.";
  return (
    <div
      className="bl-card p-8 sm:p-10 flex flex-col items-center text-center"
      data-testid={`locked-${feature}`}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "#F3F1EB", color: "var(--bl-primary)" }}
      >
        <Lock className="w-6 h-6" strokeWidth={1.6} />
      </div>
      <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">
        Please upgrade to use this feature
      </h2>
      <p className="text-sm text-[#5C6C62] mt-2 max-w-md leading-relaxed">
        <strong className="text-[#2D3A33] font-medium">{label}</strong> is not included on your
        current plan. {planHint}
      </p>
      <Link
        to="/billing/plans"
        className="bl-btn-primary mt-6 inline-flex items-center gap-2 text-sm"
        data-testid="upgrade-plan-button"
      >
        Upgrade plan
        <ArrowUpRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

export function FeatureBadge({ feature }) {
  const { clinic } = useClinic();
  if (!clinic || hasFeature(clinic, feature)) return null;
  return (
    <span className="inline-flex items-center" title="Upgrade required">
      <Lock className="w-3.5 h-3.5 text-[#5C6C62] ml-1" />
    </span>
  );
}
