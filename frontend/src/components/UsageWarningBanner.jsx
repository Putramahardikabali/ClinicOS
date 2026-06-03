import { Link } from "react-router-dom";
import { useClinic } from "@/lib/clinic";
import { AlertTriangle } from "lucide-react";

export default function UsageWarningBanner() {
  const { clinic } = useClinic();
  if (!clinic) return null;
  const alerts = clinic.usage_alerts || [];
  if (!alerts.length) return null;

  const critical = alerts.find((a) => a.level === "critical");
  const alert = critical || alerts[0];
  const bg = alert.level === "critical" ? { background: "#FBE7DF", color: "#B14A2C", border: "#F1C9B7" } : { background: "#FBF3DB", color: "#8A6D1F", border: "#EFE2B0" };

  return (
    <div
      className="px-4 py-2.5 flex items-center gap-3 text-sm border-b"
      style={{ background: bg.background, color: bg.color, borderColor: bg.border }}
      data-testid="usage-warning-banner"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1">{alert.message}</span>
      <Link to={alert.link || "/billing/plans"} className="underline font-medium whitespace-nowrap" data-testid="usage-upgrade-cta">
        Upgrade plan →
      </Link>
    </div>
  );
}
