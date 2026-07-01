import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";

const COLOR_PRESETS = ["#DC2626", "#F59E0B", "#6B7280", "#7C3AED", "#06B6D4", "#10B981"];

export default function PatientLabelsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "patient_labels.manage") || ["super_admin", "manager"].includes(user?.role);
  const canView = canManage || hasPermission(user, "patient_labels.view");

  const [labels, setLabels] = useState([]);
  const [settings, setSettings] = useState({ blacklist_booking_policy: "require_confirmation", fo_can_assign_labels: true });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [l, s] = await Promise.all([
      api.get("/patient-labels", { params: { include_inactive: true } }),
      api.get("/patient-labels/settings"),
    ]);
    setLabels(l.data || []);
    setSettings(s.data || { blacklist_booking_policy: "require_confirmation", fo_can_assign_labels: true });
  };

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      try {
        const [l, s] = await Promise.all([
          api.get("/patient-labels", { params: { include_inactive: true } }),
          api.get("/patient-labels/settings"),
        ]);
        if (!cancelled) {
          setLabels(l.data || []);
          setSettings(s.data || { blacklist_booking_policy: "require_confirmation", fo_can_assign_labels: true });
        }
      } catch {
        if (!cancelled) toast.error("Could not load patient labels");
      }
    })();
    return () => { cancelled = true; };
  }, [canView]);

  if (!canView) return <div className="p-8 text-[#5C6C62]">You do not have permission to view patient labels.</div>;

  const updateLabel = (idx, field, value) => setLabels((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const saveLabel = async (row) => {
    if (!canManage) return;
    setBusy(true);
    try {
      await api.put(`/patient-labels/${row.id}`, {
        name: row.name,
        color: row.color,
        severity: row.severity,
        description: row.description,
        active: row.active,
      });
      toast.success("Label saved");
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const createLabel = async () => {
    setBusy(true);
    try {
      await api.post("/patient-labels", {
        name: "New label",
        color: "#6B7280",
        severity: "normal",
        description: "",
        active: true,
      });
      toast.success("Label created");
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      await api.put("/patient-labels/settings", settings);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto space-y-6" data-testid="patient-labels-page">
      <div>
        <div className="label-eyebrow">Settings</div>
        <h1 className="font-display text-3xl text-[#2D3A33]">Patient Labels</h1>
        <p className="text-sm text-[#5C6C62] mt-1">
          Manage clinic-wide patient labels. The Blacklist label is a protected system label for caution flags.
        </p>
      </div>

      <div className="bl-card p-5 space-y-4">
        <div className="font-display text-lg">Booking policy</div>
        <label className="block text-sm">
          <span className="label-eyebrow">Blacklist booking policy</span>
          <select
            className="bl-input mt-1"
            disabled={!canManage}
            value={settings.blacklist_booking_policy || "require_confirmation"}
            onChange={(e) => setSettings((s) => ({ ...s, blacklist_booking_policy: e.target.value }))}
          >
            <option value="warning_only">Warning only</option>
            <option value="require_confirmation">Require confirmation (recommended)</option>
            <option value="block">Block appointment creation</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!canManage}
            checked={!!settings.fo_can_assign_labels}
            onChange={(e) => setSettings((s) => ({ ...s, fo_can_assign_labels: e.target.checked }))}
          />
          Front office can assign and remove labels
        </label>
        {canManage && (
          <button type="button" className="bl-btn-secondary text-sm" disabled={busy} onClick={saveSettings}>
            Save policy
          </button>
        )}
      </div>

      <div className="bl-card p-5 space-y-4">
        <div className="flex justify-between items-center gap-2">
          <div className="font-display text-lg">Labels</div>
          {canManage && (
            <button type="button" className="bl-btn-secondary text-sm inline-flex items-center gap-1" disabled={busy} onClick={createLabel}>
              <Plus className="w-4 h-4" /> Add label
            </button>
          )}
        </div>
        {labels.map((row, idx) => (
          <div key={row.id} className="rounded-lg border border-[#EAE6D7] p-4 space-y-2">
            <div className="flex justify-between gap-2">
              <span className="text-xs text-[#5C6C62]">{row.type === "system" ? "System label" : "Custom label"}</span>
              {row.system_key === "blacklist" && <span className="text-xs text-red-700 font-medium">Protected</span>}
            </div>
            <input
              className="bl-input text-sm"
              value={row.name || ""}
              disabled={!canManage || row.system_key === "blacklist"}
              onChange={(e) => updateLabel(idx, "name", e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="bl-input text-sm"
                disabled={!canManage}
                value={row.severity || "normal"}
                onChange={(e) => updateLabel(idx, "severity", e.target.value)}
              >
                <option value="normal">Normal</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
              <input
                className="bl-input text-sm font-mono"
                value={row.color || ""}
                disabled={!canManage}
                onChange={(e) => updateLabel(idx, "color", e.target.value)}
              />
            </div>
            <input
              className="bl-input text-sm"
              placeholder="Description"
              value={row.description || ""}
              disabled={!canManage}
              onChange={(e) => updateLabel(idx, "description", e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canManage || row.system_key === "blacklist"}
                checked={row.active !== false}
                onChange={(e) => updateLabel(idx, "active", e.target.checked)}
              />
              Active
            </label>
            {canManage && (
              <button type="button" className="bl-btn-ghost text-sm" disabled={busy} onClick={() => saveLabel(labels[idx])}>
                Save label
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
