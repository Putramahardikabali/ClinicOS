import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export default function WhatsgoTemplatesTab() {
  const [items, setItems] = useState([]);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api.get("/messaging/whatsgo/templates")
      .then((r) => {
        setItems(r.data.items || []);
        setSyncedAt(r.data.synced_at || null);
      })
      .catch(() => toast.error("Could not load Whatsgo templates"))
      .finally(() => setLoaded(true));
  };

  useEffect(() => { load(); }, []);

  const syncTemplates = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/messaging/whatsgo/templates/sync");
      setItems(r.data.items || []);
      setSyncedAt(r.data.synced_at || null);
      toast.success(`Synced ${(r.data.items || []).length} templates from Whatsgo`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Template sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-4xl space-y-6" data-testid="whatsgo-templates-tab">
      <div className="bl-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">Whatsgo templates</div>
            <p className="text-sm text-[#5C6C62] mt-1">
              Approved templates are managed in Whatsgo/Meta. Sync here to select them in automations.
            </p>
          </div>
          <button type="button" onClick={syncTemplates} disabled={syncing} className="bl-btn-secondary inline-flex items-center gap-2" data-testid="whatsgo-templates-sync">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> Sync templates
          </button>
        </div>
        {syncedAt && (
          <p className="text-xs text-[#5C6C62]">Last synced: {new Date(syncedAt).toLocaleString()}</p>
        )}
      </div>

      <div className="bl-card overflow-hidden">
        {items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[#5C6C62] text-center">No templates synced yet. Connect Whatsgo and run Sync templates.</p>
        ) : (
          <div className="divide-y divide-[#EAE6D7]">
            {items.map((tpl) => (
              <div key={`${tpl.name}-${tpl.language}`} className="px-5 py-4" data-testid={`whatsgo-template-${tpl.name}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#2D3A33]">{tpl.name}</span>
                  <span className="bl-chip text-[10px]">{tpl.language || "—"}</span>
                  <span className="bl-chip text-[10px]">{tpl.status || "approved"}</span>
                  {tpl.category && <span className="text-xs text-[#5C6C62]">{tpl.category}</span>}
                </div>
                {tpl.preview && (
                  <p className="text-sm text-[#5C6C62] mt-2 whitespace-pre-wrap">{tpl.preview}</p>
                )}
                {Array.isArray(tpl.components) && tpl.components.length > 0 && (
                  <p className="text-xs text-[#5C6C62] mt-2 font-mono">
                    Variables: {tpl.components.map((c) => (typeof c === "string" ? c : c.name || c)).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
