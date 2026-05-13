import { useClinic, hasFeature } from "@/lib/clinic";
import { Lock } from "lucide-react";
import { Link } from "react-router-dom";

/** Wrap a UI region that requires a specific plan feature. */
export default function FeatureGate({ feature, children, fallback }) {
  const { clinic } = useClinic();
  if (!clinic) return children; // still loading — optimistic render
  if (hasFeature(clinic, feature)) return children;
  if (fallback) return fallback;
  return <LockedNotice feature={feature} />;
}

export function LockedNotice({ feature }) {
  return (
    <div className="bl-card p-8 flex flex-col items-center text-center" data-testid={`locked-${feature}`}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "#F3F1EB", color: "var(--bl-primary)" }}>
        <Lock className="w-5 h-5" />
      </div>
      <div className="font-display text-lg text-[#2D3A33]">This feature is locked.</div>
      <p className="text-sm text-[#5C6C62] mt-1 max-w-md">
        Upgrade your plan to unlock <strong className="capitalize">{feature.replace(/_/g, " ")}</strong> and more.
      </p>
      <Link to="/billing/plans" className="bl-btn-primary mt-4 text-sm">Upgrade now →</Link>
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
