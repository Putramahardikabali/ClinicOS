import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { MessagingTemplatesTab } from "@/pages/admin/settingsTabs";

export default function WhatsgoAdvancedTab() {
  const [form, setForm] = useState({
    whatsgo_base_url: "",
    integration_token: "",
    webhook_secret: "",
    whatsgo_retry_max_attempts: 3,
    whatsgo_inbox_url: "",
  });
  const [hasToken, setHasToken] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    api.get("/settings/messaging")
      .then((r) => {
        const d = r.data;
        setForm({
          whatsgo_base_url: d.whatsgo_base_url || "",
          integration_token: "",
          webhook_secret: "",
          whatsgo_retry_max_attempts: d.whatsgo_retry_max_attempts ?? 3,
          whatsgo_inbox_url: d.whatsgo_inbox_url || "",
        });
        setHasToken(!!d.has_whatsgo_integration_token || !!d.has_credentials);
        setHasWebhookSecret(!!d.has_whatsgo_webhook_secret);
      })
      .catch(() => toast.error("Could not load advanced settings"))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        enable_messaging: true,
        provider: "whatsgo",
        whatsgo_base_url: form.whatsgo_base_url.trim(),
        whatsgo_retry_max_attempts: Number(form.whatsgo_retry_max_attempts) || 3,
        whatsgo_inbox_url: form.whatsgo_inbox_url.trim(),
      };
      if (form.integration_token) body.integration_token = form.integration_token;
      if (form.webhook_secret) body.whatsgo_webhook_secret = form.webhook_secret;
      await api.put("/settings/messaging", body);
      setForm((f) => ({ ...f, integration_token: "", webhook_secret: "" }));
      toast.success("Advanced settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Whatsgo integration?")) return;
    try {
      await api.post("/settings/messaging/whatsgo/disconnect");
      toast.success("Disconnected");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed");
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="whatsgo-advanced-tab">
      <div className="bl-card p-5 space-y-4">
        <div className="font-display text-lg text-[#2D3A33]">Advanced</div>
        <p className="text-sm text-[#5C6C62]">API endpoints, secrets, and retry behavior. Sensitive values are masked after save.</p>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="label-eyebrow block mb-1.5">API base URL</label>
            <input className="bl-input" value={form.whatsgo_base_url} onChange={(e) => setForm({ ...form, whatsgo_base_url: e.target.value })} data-testid="whatsgo-advanced-base-url" />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Integration token / API key</label>
            <input type="password" className="bl-input" value={form.integration_token} onChange={(e) => setForm({ ...form, integration_token: e.target.value })} placeholder={hasToken ? "Leave blank to keep" : "Required"} data-testid="whatsgo-advanced-token" />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Webhook secret (optional)</label>
            <input type="password" className="bl-input" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder={hasWebhookSecret ? "Leave blank to keep" : "Optional"} data-testid="whatsgo-advanced-webhook-secret" />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Whatsgo inbox URL (for Open in Whatsgo links)</label>
            <input className="bl-input" value={form.whatsgo_inbox_url} onChange={(e) => setForm({ ...form, whatsgo_inbox_url: e.target.value })} placeholder="https://app.whatsgo.example/inbox" data-testid="whatsgo-inbox-url" />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Retry attempts (0–10)</label>
            <input type="number" min={0} max={10} className="bl-input w-32" value={form.whatsgo_retry_max_attempts} onChange={(e) => setForm({ ...form, whatsgo_retry_max_attempts: e.target.value })} data-testid="whatsgo-retry-attempts" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="whatsgo-advanced-save">Save advanced settings</button>
          <button type="button" onClick={disconnect} className="bl-btn-ghost text-[#B14A2C]" data-testid="whatsgo-advanced-disconnect">Disconnect integration</button>
        </div>
      </div>

      <div className="bl-card p-5">
        <button type="button" className="text-sm text-[#5C6C62] underline" onClick={() => setShowLegacy((v) => !v)}>
          {showLegacy ? "Hide" : "Show"} legacy ClinicOS message templates (optional)
        </button>
        {showLegacy && (
          <div className="mt-4 border-t border-[#EAE6D7] pt-4">
            <MessagingTemplatesTab showLogs={false} />
          </div>
        )}
      </div>
    </div>
  );
}
