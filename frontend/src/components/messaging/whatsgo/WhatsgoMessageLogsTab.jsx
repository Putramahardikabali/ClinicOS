import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

function inboxLink(log, inboxBase) {
  if (!inboxBase) return "";
  if (log.provider_message_id) return `${inboxBase}/messages/${log.provider_message_id}`;
  if (log.patient_id) return `${inboxBase}/contacts?external_reference_id=${log.patient_id}`;
  return inboxBase;
}

export default function WhatsgoMessageLogsTab() {
  const [logs, setLogs] = useState([]);
  const [inboxBase, setInboxBase] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/messaging/logs", { params: { limit: 100 } }),
      api.get("/settings/messaging"),
    ])
      .then(([logsRes, settingsRes]) => {
        setLogs(logsRes.data.items || []);
        setInboxBase(settingsRes.data.whatsgo_inbox_url || "");
      })
      .catch(() => toast.error("Could not load message logs"))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="whatsgo-message-logs-tab">
      <div className="bl-card overflow-hidden">
        <div className="px-5 py-3 border-b border-[#EAE6D7]">
          <div className="font-display text-lg text-[#2D3A33]">Message logs</div>
          <p className="text-sm text-[#5C6C62] mt-1">ClinicOS-triggered WhatsApp messages sent via Whatsgo.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Patient / recipient</th>
                <th className="px-4 py-3 text-left">Event</th>
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
                const href = inboxLink(l, inboxBase);
                return (
                  <tr key={l.id} className="border-t border-[#EAE6D7]" data-testid={`whatsgo-log-${l.id}`}>
                    <td className="px-4 py-3 text-[#5C6C62] whitespace-nowrap">
                      {l.sent_at || l.created_at ? new Date(l.sent_at || l.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">{l.recipient || "—"}</td>
                    <td className="px-4 py-3 text-[#5C6C62]">{l.reference_type || l.template_type || "—"}</td>
                    <td className="px-4 py-3">{l.template_type || l.rendered_message?.slice(0, 40) || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="bl-chip text-[10px] capitalize">{l.status}</span>
                      {l.error_message && (
                        <div className="text-xs text-[#B14A2C] mt-1">{l.error_message}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
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
