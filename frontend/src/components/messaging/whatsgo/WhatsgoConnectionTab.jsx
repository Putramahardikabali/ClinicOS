import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, Link2, Unplug } from "lucide-react";

const STATUS_LABEL = {
  disabled: "Not connected",
  not_connected: "Not connected",
  connected: "Connected",
  error: "Error",
};

export default function WhatsgoConnectionTab() {
  const [form, setForm] = useState({
    enable_messaging: true,
    whatsgo_workspace_id: "",
    whatsgo_workspace_name: "",
    whatsgo_base_url: "",
    integration_token: "",
  });
  const [status, setStatus] = useState("not_connected");
  const [connectedPhone, setConnectedPhone] = useState("");
  const [lastHealthCheck, setLastHealthCheck] = useState(null);
  const [lastError, setLastError] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api.get("/settings/messaging")
      .then((r) => {
        const d = r.data;
        setForm((f) => ({
          ...f,
          enable_messaging: d.enable_messaging !== false,
          whatsgo_workspace_id: d.whatsgo_workspace_id || "",
          whatsgo_workspace_name: d.whatsgo_workspace_name || "",
          whatsgo_base_url: d.whatsgo_base_url || "",
        }));
        setStatus(d.connection_status || "not_connected");
        setConnectedPhone(d.connected_phone_number || "");
        setLastHealthCheck(d.last_health_check_at || d.last_connection_test_at || null);
        setLastError(d.last_connection_error || "");
        setHasToken(!!d.has_whatsgo_integration_token || !!d.has_credentials);
      })
      .catch(() => toast.error("Could not load Whatsgo settings"))
      .finally(() => setLoaded(true));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.whatsgo_workspace_id.trim()) {
      toast.error("Workspace ID is required");
      return;
    }
    setBusy(true);
    try {
      const body = {
        enable_messaging: true,
        provider: "whatsgo",
        whatsgo_workspace_id: form.whatsgo_workspace_id.trim(),
        whatsgo_workspace_name: form.whatsgo_workspace_name.trim(),
        whatsgo_base_url: form.whatsgo_base_url.trim(),
      };
      if (form.integration_token) body.integration_token = form.integration_token;
      const r = await api.put("/settings/messaging", body);
      setHasToken(!!r.data.has_whatsgo_integration_token || !!r.data.has_credentials);
      setStatus(r.data.connection_status || "not_connected");
      setForm((f) => ({ ...f, integration_token: "" }));
      toast.success("Whatsgo connection settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const r = await api.post("/settings/messaging/test-connection");
      setStatus(r.data?.connection_status || "connected");
      setConnectedPhone(r.data?.connected_phone_number || connectedPhone);
      setLastHealthCheck(new Date().toISOString());
      setLastError("");
      if (r.data?.workspace_name) {
        setForm((f) => ({ ...f, whatsgo_workspace_name: r.data.workspace_name }));
      }
      toast.success("Whatsgo connection verified");
      load();
    } catch (e) {
      setStatus("error");
      setLastError(e?.response?.data?.detail || "Connection test failed");
      toast.error(e?.response?.data?.detail || "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Whatsgo integration for this clinic?")) return;
    setBusy(true);
    try {
      await api.post("/settings/messaging/whatsgo/disconnect");
      setStatus("not_connected");
      setConnectedPhone("");
      setHasToken(false);
      toast.success("Whatsgo disconnected");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  const statusChip =
    status === "connected" ? "success" : status === "error" ? "neutral" : "warning";

  return (
    <div className="max-w-3xl space-y-6" data-testid="whatsgo-connection-tab">
      <div className="bl-card p-5 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-display text-lg text-[#2D3A33]">Whatsgo connection</div>
          <span className={`bl-chip ${statusChip}`} data-testid="whatsgo-connection-status">
            {STATUS_LABEL[status] || status}
          </span>
        </div>
        <p className="text-sm text-[#5C6C62]">
          ClinicOS connects to Whatsgo for WhatsApp templates, automations, inbox, and delivery status.
          You do not need Meta or raw WhatsApp API credentials in ClinicOS.
        </p>

        {(form.whatsgo_workspace_name || connectedPhone || lastHealthCheck) && (
          <div className="rounded-xl border border-[#EAE6D7] bg-[#F8F5EC] p-4 text-sm space-y-1">
            {form.whatsgo_workspace_name && (
              <div><span className="text-[#5C6C62]">Workspace:</span> {form.whatsgo_workspace_name}</div>
            )}
            {form.whatsgo_workspace_id && (
              <div><span className="text-[#5C6C62]">Workspace ID:</span> <span className="font-mono text-xs">{form.whatsgo_workspace_id}</span></div>
            )}
            {connectedPhone && (
              <div><span className="text-[#5C6C62]">Connected number:</span> {connectedPhone}</div>
            )}
            {lastHealthCheck && (
              <div><span className="text-[#5C6C62]">Last connection check:</span> {new Date(lastHealthCheck).toLocaleString()}</div>
            )}
          </div>
        )}

        {lastError && status !== "connected" && (
          <p className="text-xs text-[#B14A2C] bg-red-50 border border-red-100 rounded-lg px-3 py-2">{lastError}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label-eyebrow block mb-1.5">Whatsgo Workspace ID</label>
            <input
              className="bl-input font-mono text-sm"
              value={form.whatsgo_workspace_id}
              onChange={(e) => setForm({ ...form, whatsgo_workspace_id: e.target.value })}
              placeholder="workspace_…"
              data-testid="whatsgo-workspace-id"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Workspace name (optional)</label>
            <input
              className="bl-input"
              value={form.whatsgo_workspace_name}
              onChange={(e) => setForm({ ...form, whatsgo_workspace_name: e.target.value })}
              data-testid="whatsgo-workspace-name"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">API base URL (optional)</label>
            <input
              className="bl-input"
              value={form.whatsgo_base_url}
              onChange={(e) => setForm({ ...form, whatsgo_base_url: e.target.value })}
              placeholder="Uses platform default if empty"
              data-testid="whatsgo-base-url"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label-eyebrow block mb-1.5">Integration token</label>
            <input
              type="password"
              className="bl-input"
              value={form.integration_token}
              onChange={(e) => setForm({ ...form, integration_token: e.target.value })}
              placeholder={hasToken ? "Saved — leave blank to keep" : "Paste token from Whatsgo"}
              data-testid="whatsgo-integration-token"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary inline-flex items-center gap-2" data-testid="whatsgo-save">
            <Link2 className="w-4 h-4" /> Connect with Whatsgo
          </button>
          <button type="button" onClick={testConnection} disabled={testing || !hasToken} className="bl-btn-secondary inline-flex items-center gap-2" data-testid="whatsgo-test">
            <RefreshCw className={`w-4 h-4 ${testing ? "animate-spin" : ""}`} /> Test connection
          </button>
          <button type="button" onClick={disconnect} disabled={busy} className="bl-btn-ghost inline-flex items-center gap-2 text-[#B14A2C]" data-testid="whatsgo-disconnect">
            <Unplug className="w-4 h-4" /> Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
