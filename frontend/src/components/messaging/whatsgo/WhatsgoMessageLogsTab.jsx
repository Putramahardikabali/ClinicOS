import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import { whatsgoLogInboxLink } from "@/lib/whatsgo";

export default function WhatsgoMessageLogsTab() {
  const { user } = useAuth();
  const canRetry = hasPermission(user, "messaging.send") || hasPermission(user, "messaging.manage");
  const [logs, setLogs] = useState([]);
  const [inboxBase, setInboxBase] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  const load = (refresh = false) => {
    const params = refresh ? { refresh: true } : {};
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
  }, []);

  const refreshRemote = async () => {
    setRefreshing(true);
    try {
      await load(true);
      toast.success("Logs refreshed");
    } finally {
      setRefreshing(false);
    }
  };

  const retry = async (logId) => {
    setRetryingId(logId);
    try {
      await api.post(`/messaging/whatsgo/messages/${logId}/retry`);
      toast.success("Message retried");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Retry failed");
    } finally {
      setRetryingId(null);
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
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
                return (
                  <tr key={l.id} className="border-t border-[#EAE6D7]" data-testid={`whatsgo-log-${l.id}`}>
                    <td className="px-4 py-3 text-[#5C6C62] whitespace-nowrap">
                      {l.sent_at || l.created_at ? new Date(l.sent_at || l.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">{l.recipient || "—"}</td>
                    <td className="px-4 py-3 text-[#5C6C62]">{l.source_event || l.reference_type || l.template_type || "—"}</td>
                    <td className="px-4 py-3">{l.template_name || l.template_type || l.rendered_message?.slice(0, 40) || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="bl-chip text-[10px] capitalize">{l.status}</span>
                      {err && (
                        <div className="text-xs text-[#B14A2C] mt-1">{err}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canRetry && (l.status === "failed" || l.status === "queued") && (
                        <button
                          type="button"
                          onClick={() => retry(l.id)}
                          disabled={retryingId === l.id}
                          className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                          data-testid={`whatsgo-retry-${l.id}`}
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${retryingId === l.id ? "animate-spin" : ""}`} /> Retry
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
