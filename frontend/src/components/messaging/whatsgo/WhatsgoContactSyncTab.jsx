import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export default function WhatsgoContactSyncTab() {
  const [settings, setSettings] = useState({
    whatsgo_auto_sync_patients: true,
    whatsgo_auto_update_contacts: true,
    whatsgo_sync_tags: false,
    whatsgo_sync_patient_source: true,
    whatsgo_sync_country: true,
    whatsgo_last_sync_at: null,
    whatsgo_last_sync_status: "",
    whatsgo_last_sync_error: "",
  });
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api.get("/settings/messaging")
      .then((r) => {
        const d = r.data;
        setSettings({
          whatsgo_auto_sync_patients: d.whatsgo_auto_sync_patients !== false,
          whatsgo_auto_update_contacts: d.whatsgo_auto_update_contacts !== false,
          whatsgo_sync_tags: !!d.whatsgo_sync_tags,
          whatsgo_sync_patient_source: d.whatsgo_sync_patient_source !== false,
          whatsgo_sync_country: d.whatsgo_sync_country !== false,
          whatsgo_last_sync_at: d.whatsgo_last_sync_at,
          whatsgo_last_sync_status: d.whatsgo_last_sync_status || "",
          whatsgo_last_sync_error: d.whatsgo_last_sync_error || "",
        });
      })
      .catch(() => toast.error("Could not load contact sync settings"))
      .finally(() => setLoaded(true));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings/messaging", {
        enable_messaging: true,
        provider: "whatsgo",
        whatsgo_auto_sync_patients: settings.whatsgo_auto_sync_patients,
        whatsgo_auto_update_contacts: settings.whatsgo_auto_update_contacts,
        whatsgo_sync_tags: settings.whatsgo_sync_tags,
        whatsgo_sync_patient_source: settings.whatsgo_sync_patient_source,
        whatsgo_sync_country: settings.whatsgo_sync_country,
      });
      toast.success("Contact sync settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/settings/messaging/whatsgo/contacts/sync");
      toast.success(`Synced ${r.data.synced || 0} of ${r.data.total || 0} contacts`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="whatsgo-contact-sync-tab">
      <div className="bl-card p-5 space-y-5">
        <div>
          <div className="font-display text-lg text-[#2D3A33]">Contact sync</div>
          <p className="text-sm text-[#5C6C62] mt-2">
            Keep Whatsgo contacts aligned with ClinicOS patients using patient ID as external reference.
          </p>
        </div>

        <ul className="text-xs text-[#5C6C62] list-disc pl-5 space-y-1">
          <li>Maps patient ID, full name, phone, email, language, country, source, and birthday when available.</li>
          <li>Tags/lists sync only when enabled below.</li>
        </ul>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.whatsgo_auto_sync_patients}
            onChange={(e) => setSettings({ ...settings, whatsgo_auto_sync_patients: e.target.checked })}
            data-testid="whatsgo-auto-sync-new"
          />
          <span className="text-sm text-[#2D3A33]">Auto-sync new patients to Whatsgo contacts</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.whatsgo_auto_update_contacts}
            onChange={(e) => setSettings({ ...settings, whatsgo_auto_update_contacts: e.target.checked })}
            data-testid="whatsgo-auto-update"
          />
          <span className="text-sm text-[#2D3A33]">Auto-update Whatsgo contact when patient profile changes</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.whatsgo_sync_patient_source}
            onChange={(e) => setSettings({ ...settings, whatsgo_sync_patient_source: e.target.checked })}
            data-testid="whatsgo-sync-source"
          />
          <span className="text-sm text-[#2D3A33]">Sync patient source</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.whatsgo_sync_country}
            onChange={(e) => setSettings({ ...settings, whatsgo_sync_country: e.target.checked })}
            data-testid="whatsgo-sync-country"
          />
          <span className="text-sm text-[#2D3A33]">Sync nationality / country</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.whatsgo_sync_tags}
            onChange={(e) => setSettings({ ...settings, whatsgo_sync_tags: e.target.checked })}
            data-testid="whatsgo-sync-tags"
          />
          <span className="text-sm text-[#2D3A33]">Sync patient tags/lists</span>
        </label>

        {(settings.whatsgo_last_sync_at || settings.whatsgo_last_sync_status) && (
          <div className="rounded-xl border border-[#EAE6D7] bg-[#F8F5EC] p-4 text-sm">
            <div><span className="text-[#5C6C62]">Last sync:</span> {settings.whatsgo_last_sync_status || "—"}</div>
            {settings.whatsgo_last_sync_at && (
              <div className="text-[#5C6C62] mt-1">{new Date(settings.whatsgo_last_sync_at).toLocaleString()}</div>
            )}
            {settings.whatsgo_last_sync_error && (
              <div className="text-[#B14A2C] mt-2 text-xs">{settings.whatsgo_last_sync_error}</div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="whatsgo-contact-sync-save">Save settings</button>
          <button type="button" onClick={syncNow} disabled={syncing} className="bl-btn-secondary inline-flex items-center gap-2" data-testid="whatsgo-contact-sync-now">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> Sync now
          </button>
        </div>
      </div>
    </div>
  );
}
