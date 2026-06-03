import { Link } from "react-router-dom";
import { useClinic } from "@/lib/clinic";
import { Bell, X } from "lucide-react";
import { useState } from "react";
import api from "@/lib/api";

const TYPE_STYLES = {
  trial_started: { bg: "#EDF3EF", color: "#2D5A4A" },
  trial_ending: { bg: "#FBF3DB", color: "#8A6D1F" },
  trial_expired: { bg: "#FBE7DF", color: "#B14A2C" },
  payment_submitted: { bg: "#EDF3EF", color: "#2D5A4A" },
  payment_approved: { bg: "#EDF3EF", color: "#2D5A4A" },
  payment_rejected: { bg: "#FBE7DF", color: "#B14A2C" },
  past_due: { bg: "#FBE7DF", color: "#B14A2C" },
  suspended: { bg: "#FBE7DF", color: "#B14A2C" },
  reactivated: { bg: "#EDF3EF", color: "#2D5A4A" },
  renewed: { bg: "#FBF3DB", color: "#8A6D1F" },
};

export default function BillingNotificationBanner() {
  const { clinic, refresh } = useClinic();
  const [dismissed, setDismissed] = useState(() => new Set());

  if (!clinic) return null;
  const notifications = (clinic.notifications || []).filter((n) => !n.read_at && !dismissed.has(n.id));
  const top = notifications[0];
  if (!top) return null;

  const style = TYPE_STYLES[top.type] || { bg: "#F3F1EB", color: "#2D3A33" };

  const dismiss = async () => {
    setDismissed((s) => new Set(s).add(top.id));
    try {
      await api.post(`/clinic/notifications/${top.id}/read`);
      refresh?.();
    } catch { /* ignore */ }
  };

  return (
    <div
      className="px-4 py-2.5 flex items-center gap-3 text-sm border-b"
      style={{ background: style.bg, color: style.color, borderColor: "#EAE6D7" }}
      data-testid={`billing-notif-${top.type}`}
    >
      <Bell className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <strong>{top.title}</strong>
        {top.body && <span className="ml-1 opacity-90">· {top.body}</span>}
      </div>
      {top.link && (
        <Link to={top.link} className="underline font-medium whitespace-nowrap shrink-0">View</Link>
      )}
      <button type="button" onClick={dismiss} className="p-1 rounded hover:opacity-70" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
