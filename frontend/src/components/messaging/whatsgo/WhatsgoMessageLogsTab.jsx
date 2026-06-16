import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import { whatsgoLogInboxLink } from "@/lib/whatsgo";

const STATUS_OPTIONS = ["", "sent", "failed", "queued", "skipped", "retrying"];
const EVENT_OPTIONS = [
  "",
  "appointment_created",
  "appointment_reminder",
  "appointment_cancelled",
  "appointment_rescheduled",
  "consent_form_request",
  "visit_completed_aftercare",
  "package_session_remaining",
  "package_expiry_reminder",
];

export default function WhatsgoMessageLogsTab() {
  const { user } = useAuth();
  const canRetry = hasPermission(user, "messaging.send") || hasPermission(user, "messaging.manage");
  const canCancel = hasPermission(user, "messaging.automation.manage") || user?.role === "super_admin" || user?.role === "manager";

  const [logs, setLogs] = useState([]);
  const [inboxBase, setInboxBase] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [filters, setFilters] = useState({
    status: "",
    event_type: "",
    patient_id: "",
    date_from: "",
    date_to: "",
  });

  const buildParams = (refresh = false) => {
    const params = {};
    if (refresh) params.refresh = true;
    if (filters.status) params.status = filters.status;
    if (filters.event_type) params.event_type = filters.event_type;
    if (filters.patient_id.trim()) params.patient_id = filters.patient_id.trim();
    if (filters.date_from) params.date_from = new Date(filters.date_from).toISOString();
    if (filters.date_to) {
      const end = new Date(filters.date_to);
      end.setHours(23, 59, 59, 999);
      params.date_to = end.toISOString();
    }
    return params;
  };

  const load = (refresh = false) => {
    const params = buildParams(refresh);
    return Promise.all([
      api.get("/messaging/whatsgo/messages/logs", { params }),
      api.get("/settings/messaging"),
    ])
      .then(([logsRes, settingsRes]) => {
        const items = logsRes.data.items || [];
        setLogs(items.filter((l) => l.provider === "whatsgo" || !l.provider || l.provider === "none"));
        setInboxBase(settingsRes.data.whatsgo_inbox_url || "");
      })
      .catch(() => toast.error("Could not load message logs"));
  };

  useEffect(() => {
    load().finally(() => setLoaded(true));
  }, [filters.status, filters.event_type, filters.patient_id, filters.date_from, filters.date_to]);

  const refreshRemote = async () => {
    setRefreshing(true);
    try {
      await load(true);
      toast.success("Logs refreshed");
    } finally {
      setRefreshing(false);
    }
  };

  const retry = async (log) => {
    setRetryingId(log.id);
    try {
      if (log.automation_job_id && (log.status === "failed" || log.status === "retrying")) {
        await api.post(`/messaging/automation/jobs/${log.automation_job_id}/retry`);
      } else {
        await api.post(`/messaging/whatsgo/messages/${log.id}/retry`);
      }
      toast.success("Message retried");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  const cancelJob = async (jobId) => {
    if (!window.confirm("Cancel this pending automation job?")) return;
    setCancellingId(jobId);
    try {
      await api.post(`/messaging/automation/jobs/${jobId}/cancel`);
      toast.success("Job cancelled");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="whatsgo-message-logs-tab">
      <div className="bl-card overflow-hidden">
        <div className="px-5 py-3 border-b border-[#EAE6D7] flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">Message logs</div>
            <p className="text-sm text-[#5C6C62] mt-1">ClinicOS-triggered WhatsApp messages sent via Whatsgo.</p>
          </div>
          <button type="button" onClick={refreshRemote} disabled={refreshing} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="whatsgo-logs-refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh from Whatsgo
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#EAE6D7] flex flex-wrap gap-3 items-end">
          <label className="text-xs text-[#5C6C62]">
            From
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
              className="bl-input mt-1 block text-sm"
            />
          </label>
          <label className="text-xs text-[#5C6C62]">
            To
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
              className="bl-input mt-1 block text-sm"
            />
          </label>
          <label className="text-xs text-[#5C6C62]">
            Status
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="bl-input mt-1 block text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>{s || "All"}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#5C6C62]">
            Event type
            <select
              value={filters.event_type}
              onChange={(e) => setFilters({ ...filters, event_type: e.target.value })}
              className="bl-input mt-1 block text-sm"
            >
              {EVENT_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>{s ? s.replace(/_/g, " ") : "All"}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#5C6C62]">
            Patient ID
            <input
              type="text"
              value={filters.patient_id}
              onChange={(e) => setFilters({ ...filters, patient_id: e.target.value })}
              placeholder="Optional"
              className="bl-input mt-1 block text-sm w-36"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Patient / recipient</th>
                <th className="px-4 py-3 text-left">Source event</th>
                <th className="px-4 py-3 text-left">Template</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-[#5C6C62]">No messages yet.</td>
                </tr>
              )}
              {logs.map((l) => {
                const href = whatsgoLogInboxLink(l, inboxBase);
                const err = l.error_reason || l.error_message;
                const attempts = l.attempt_count != null ? `${l.attempt_count}${l.max_attempts ? `/${l.max_attempts}` : ""}` : null;
                return (
                  <tr key={l.id} className="border-t border-[#EAE6D7]" data-testid={`whatsgo-log-${l.id}`}>
                    <td className="px-4 py-3 text-[#5C6C62] whitespace-nowrap">
                      {l.sent_at || l.created_at ? new Date(l.sent_at || l.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div>{l.recipient || "—"}</div>
                      {l.patient_id && <div className="text-xs text-[#A89F8B]">{l.patient_id}</div>}
                      {l.booking_id && <div className="text-xs text-[#A89F8B]">Appt: {l.booking_id.slice(0, 8)}…</div>}
                    </td>
                    <td className="px-4 py-3 text-[#5C6C62]">{l.source_event || l.reference_type || l.template_type || "—"}</td>
                    <td className="px-4 py-3">{l.template_name || l.template_type || l.rendered_message?.slice(0, 40) || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="bl-chip text-[10px] capitalize">{l.status}</span>
                      {attempts && (
                        <div className="text-xs text-[#5C6C62] mt-1">Attempts: {attempts}</div>
                      )}
                      {l.next_retry_at && (
                        <div className="text-xs text-[#5C6C62] mt-1">
                          Retry: {new Date(l.next_retry_at).toLocaleString()}
                        </div>
                      )}
                      {err && (
                        <div className="text-xs text-[#B14A2C] mt-1">{err}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canRetry && (l.status === "failed" || l.status === "queued" || l.status === "retrying") && (
                        <button
                          type="button"
                          onClick={() => retry(l)}
                          disabled={retryingId === l.id}
                          className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                          data-testid={`whatsgo-retry-${l.id}`}
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${retryingId === l.id ? "animate-spin" : ""}`} /> Retry
                        </button>
                      )}
                      {canCancel && l.automation_job_id && (l.status === "pending" || l.status === "retrying" || l.status === "queued") && (
                        <button
                          type="button"
                          onClick={() => cancelJob(l.automation_job_id)}
                          disabled={cancellingId === l.automation_job_id}
                          className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Cancel
                        </button>
                      )}
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="bl-btn-ghost text-xs inline-flex items-center gap-1">
                          <ExternalLink className="w-3.5 h-3.5" /> Open in Whatsgo
                        </a>
                      ) : (
                        <span className="text-xs text-[#A89F8B]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
