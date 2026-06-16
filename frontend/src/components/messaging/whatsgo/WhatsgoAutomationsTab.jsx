import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";

const EVENT_TYPES = [
  { value: "appointment_created", label: "Appointment created confirmation" },
  { value: "appointment_rescheduled", label: "Appointment rescheduled" },
  { value: "appointment_cancelled", label: "Appointment cancelled" },
  { value: "appointment_reminder", label: "Appointment reminder" },
  { value: "consent_form_request", label: "Consent form request" },
  { value: "visit_completed_aftercare", label: "Visit completed / aftercare" },
  { value: "package_session_remaining", label: "Package session remaining" },
  { value: "package_expiry_reminder", label: "Package expiry reminder" },
];

const VARIABLE_TAGS = [
  "patient_name", "clinic_name", "clinic_phone", "appointment_date", "appointment_time",
  "treatment_name", "staff_name", "consent_form_link", "package_name", "remaining_sessions",
  "package_expiry_date", "public_booking_link",
];

const TIMING_PRESETS = {
  appointment_created: { timing_type: "immediately", offset_value: 0, offset_unit: "hours" },
  appointment_rescheduled: { timing_type: "immediately", offset_value: 0, offset_unit: "hours" },
  appointment_cancelled: { timing_type: "immediately", offset_value: 0, offset_unit: "hours" },
  appointment_reminder: { timing_type: "before_event", offset_value: 1, offset_unit: "days" },
};

function formatTiming(rule) {
  if (rule.timing_type === "immediately") return "Immediately";
  const v = rule.offset_value ?? rule.timing_value;
  const u = rule.offset_unit || rule.timing_unit || "hours";
  const when = rule.timing_type === "before_event" ? "before" : "after";
  return `${v} ${u} ${when} event`;
}

export default function WhatsgoAutomationsTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "messaging.automation.manage") || user?.role === "super_admin" || user?.role === "manager";
  const canRetry = canManage || hasPermission(user, "messaging.send");

  const empty = {
    name: "",
    display_name: "",
    event_type: "appointment_reminder",
    trigger_type: "appointment_reminder",
    timing_type: "before_event",
    offset_value: 1,
    offset_unit: "days",
    timing_value: 1,
    timing_unit: "days",
    whatsjet_template_name: "",
    language_code: "id",
    variable_mapping: ["patient_name", "clinic_name", "appointment_date", "appointment_time"],
    preview_text: "",
    enabled: false,
    recipient_audience: "patient",
    conditions: { send_once_per_booking: true, require_phone: true },
  };

  const [rules, setRules] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [provider, setProvider] = useState("");
  const [automationSendingEnabled, setAutomationSendingEnabled] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testBookingId, setTestBookingId] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("");

  const load = () => {
    api.get("/messaging/automation/rules").then((r) => {
      setRules(r.data.items || []);
      setProvider(r.data.provider || "");
    }).catch(() => toast.error("Could not load automation rules"));
    const params = { limit: 50 };
    if (jobStatusFilter) params.status = jobStatusFilter;
    api.get("/messaging/automation/runs", { params }).then((r) => setJobs(r.data.items || [])).catch(() => {});
    api.get("/settings/messaging").then((r) => {
      setAutomationSendingEnabled(!!r.data.whatsgo_automation_sending_enabled);
    }).catch(() => {});
  };

  useEffect(() => { load(); }, [jobStatusFilter]);

  const setVariableAt = (index, tag) => {
    const mapping = [...(form.variable_mapping || [])];
    while (mapping.length <= index) mapping.push("");
    mapping[index] = tag;
    setForm({ ...form, variable_mapping: mapping.filter((_, i) => i < 8 || mapping[i]) });
  };

  const onEventTypeChange = (eventType) => {
    const preset = TIMING_PRESETS[eventType] || {};
    setForm({
      ...form,
      event_type: eventType,
      trigger_type: eventType,
      timing_type: preset.timing_type || form.timing_type,
      offset_value: preset.offset_value ?? form.offset_value,
      offset_unit: preset.offset_unit || form.offset_unit,
      timing_value: preset.offset_value ?? form.timing_value,
      timing_unit: preset.offset_unit || form.timing_unit,
    });
  };

  const save = async () => {
    if (!canManage) return;
    if (!form.name.trim() || !form.whatsjet_template_name.trim()) {
      toast.error("Rule name and Whatsgo template name required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        event_type: form.event_type || form.trigger_type,
        trigger_type: form.event_type || form.trigger_type,
        offset_value: Number(form.offset_value ?? form.timing_value) || 0,
        timing_value: Number(form.offset_value ?? form.timing_value) || 0,
        offset_unit: form.offset_unit || form.timing_unit,
        timing_unit: form.offset_unit || form.timing_unit,
        display_name: form.display_name || form.name,
        variable_mapping: (form.variable_mapping || []).filter(Boolean),
      };
      if (payload.timing_type === "immediately") {
        payload.offset_value = 0;
        payload.timing_value = 0;
      }
      if (editingId) {
        await api.put(`/messaging/automation/rules/${editingId}`, payload);
        toast.success("Rule updated");
      } else {
        await api.post("/messaging/automation/rules", payload);
        toast.success("Rule created (disabled by default)");
      }
      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save rule");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (rule) => {
    if (!canManage) return;
    try {
      await api.patch(`/messaging/automation/rules/${rule.id}/enabled?enabled=${!rule.enabled}`);
      toast.success(rule.enabled ? "Rule disabled" : "Rule enabled");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update rule");
    }
  };

  const remove = (rule) => {
    if (!canManage) return;
    if (!window.confirm(`Delete automation rule "${rule.name}"?`)) return;
    api.delete(`/messaging/automation/rules/${rule.id}`).then(() => load()).catch((e) => {
      toast.error(e?.response?.data?.detail || "Delete failed");
    });
  };

  const testRule = async (rule) => {
    if (!canManage) return;
    try {
      const body = { trigger_type: rule.event_type || rule.trigger_type };
      if (testBookingId.trim()) body.booking_id = testBookingId.trim();
      const r = await api.post(`/messaging/automation/rules/${rule.id}/test`, body);
      toast.success(`Test finished (${(r.data.recent_runs || []).length} recent runs)`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test failed");
    }
  };

  const retryJob = async (job) => {
    if (!canRetry) return;
    try {
      await api.post(`/messaging/automation/jobs/${job.id}/retry`);
      toast.success("Retry queued");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Retry failed");
    }
  };

  const cancelJob = async (job) => {
    if (!canManage) return;
    try {
      await api.post(`/messaging/automation/jobs/${job.id}/cancel`);
      toast.success("Job cancelled");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed");
    }
  };

  const startEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      ...empty,
      ...rule,
      event_type: rule.event_type || rule.trigger_type,
      trigger_type: rule.event_type || rule.trigger_type,
      offset_value: rule.offset_value ?? rule.timing_value ?? 0,
      offset_unit: rule.offset_unit || rule.timing_unit || "hours",
      whatsjet_template_name: rule.whatsjet_template_name || rule.whatsgo_template_name || rule.provider_template_name || "",
      variable_mapping: rule.variable_mapping || empty.variable_mapping,
      conditions: rule.conditions || empty.conditions,
    });
  };

  const showReminderWarning = form.event_type === "appointment_reminder" || form.trigger_type === "appointment_reminder";
  const variableSlots = form.variable_mapping?.length ? form.variable_mapping : [""];

  return (
    <div className="max-w-5xl space-y-6" data-testid="whatsgo-automations-tab">
      <div className="bl-card p-5 space-y-4">
        <div>
          <div className="font-display text-lg text-[#2D3A33]">Whatsgo automations</div>
          <p className="text-sm text-[#5C6C62] mt-1">
            Map ClinicOS events to approved Whatsgo templates. Rules are disabled by default — enable only after testing.
          </p>
        </div>

        {canManage && provider === "whatsgo" && (
          <div className="rounded-xl border border-[#EAE6D7] bg-[#F8F5EC] p-4" data-testid="whatsgo-automation-master">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={automationSendingEnabled}
                onChange={async (e) => {
                  try {
                    await api.put("/settings/messaging", {
                      enable_messaging: true,
                      provider: "whatsgo",
                      whatsgo_automation_sending_enabled: e.target.checked,
                    });
                    setAutomationSendingEnabled(e.target.checked);
                    toast.success(e.target.checked ? "Automatic sending enabled" : "Automatic sending disabled");
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Could not update");
                  }
                }}
                data-testid="whatsgo-automation-sending-enabled"
              />
              <span className="text-sm text-[#2D3A33]">
                Enable automatic Whatsgo message sending
                <span className="block text-xs text-[#5C6C62] mt-1">Required for scheduled reminders. Individual rules must also be enabled.</span>
              </span>
            </label>
          </div>
        )}

        {canManage && (
          <>
            <div className="font-display text-base text-[#2D3A33] pt-2">{editingId ? "Edit rule" : "New rule"}</div>
            {showReminderWarning && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Reminders need an approved WhatsApp template. Use 1 day or 3 hours before the appointment start.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="bl-input" placeholder="Internal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="automation-rule-name" />
              <input className="bl-input" placeholder="Display name (optional)" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              <select className="bl-input sm:col-span-2" value={form.event_type} onChange={(e) => onEventTypeChange(e.target.value)} data-testid="automation-trigger">
                {EVENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select className="bl-input" value={form.timing_type} onChange={(e) => setForm({ ...form, timing_type: e.target.value })}>
                <option value="immediately">Immediately</option>
                <option value="before_event">Before event</option>
                <option value="after_event">After event</option>
              </select>
              {form.timing_type !== "immediately" && (
                <>
                  <input type="number" min={0} className="bl-input" value={form.offset_value} onChange={(e) => setForm({ ...form, offset_value: e.target.value, timing_value: e.target.value })} data-testid="automation-timing-value" />
                  <select className="bl-input" value={form.offset_unit} onChange={(e) => setForm({ ...form, offset_unit: e.target.value, timing_unit: e.target.value })} data-testid="automation-timing-unit">
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </>
              )}
              <input className="bl-input sm:col-span-2 font-mono text-sm" placeholder="Whatsgo template name" value={form.whatsjet_template_name} onChange={(e) => setForm({ ...form, whatsjet_template_name: e.target.value })} data-testid="automation-whatsjet-template" />
              <input className="bl-input" placeholder="Language (id, en)" value={form.language_code} onChange={(e) => setForm({ ...form, language_code: e.target.value })} />
            </div>

            <div className="space-y-2 rounded-xl border border-[#EAE6D7] p-4">
              <p className="text-xs font-medium text-[#2D3A33]">Template variable mapping</p>
              {variableSlots.map((tag, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="text-xs text-[#5C6C62] w-6">{i + 1}.</span>
                  <select className="bl-input flex-1" value={tag} onChange={(e) => setVariableAt(i, e.target.value)} data-testid={`automation-var-${i + 1}`}>
                    <option value="">—</option>
                    {VARIABLE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Enabled (off by default)
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="automation-save">{busy ? "Saving…" : editingId ? "Update rule" : "Add rule"}</button>
              {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="bl-btn-ghost">Cancel</button>}
            </div>
            <div className="pt-2 border-t border-[#EAE6D7]">
              <label className="label-eyebrow block mb-1">Test with appointment ID</label>
              <input className="bl-input max-w-md" placeholder="Appointment UUID" value={testBookingId} onChange={(e) => setTestBookingId(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <div className="bl-card overflow-hidden">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Event</th>
              <th className="px-4 py-3 text-left">Template</th>
              <th className="px-4 py-3 text-left">Timing</th>
              <th className="px-4 py-3 text-left">Last run</th>
              <th className="px-4 py-3 text-left">On</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-[#EAE6D7]" data-testid={`automation-rule-${r.id}`}>
                <td className="px-4 py-3 font-medium">{r.display_name || r.name}</td>
                <td className="px-4 py-3 text-[#5C6C62]">{(r.event_type || r.trigger_type || "").replace(/_/g, " ")}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.whatsjet_template_name || r.whatsgo_template_name || "—"}</td>
                <td className="px-4 py-3 text-[#5C6C62]">{formatTiming(r)}</td>
                <td className="px-4 py-3 text-[#5C6C62] capitalize">{r.last_run_status || "—"}</td>
                <td className="px-4 py-3">{r.enabled ? "Yes" : "No"}</td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {canManage && <button type="button" onClick={() => toggleEnabled(r)} className="text-xs underline">{r.enabled ? "Disable" : "Enable"}</button>}
                  {canManage && <button type="button" onClick={() => startEdit(r)} className="text-xs underline">Edit</button>}
                  {canManage && <button type="button" onClick={() => testRule(r)} className="text-xs underline">Test</button>}
                  {canManage && <button type="button" onClick={() => remove(r)} className="text-xs text-[#B14A2C]">Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No automation rules yet.</p>}
      </div>

      <div className="bl-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EAE6D7] flex flex-wrap items-center justify-between gap-2">
          <div className="font-display">Automation jobs</div>
          <select className="bl-input text-sm w-40" value={jobStatusFilter} onChange={(e) => setJobStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="retrying">Retrying</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead className="bg-[#F8F5EC] text-[#5C6C62] uppercase tracking-widest">
              <tr>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Event</th>
                <th className="px-4 py-2 text-left">Patient</th>
                <th className="px-4 py-2 text-left">Scheduled</th>
                <th className="px-4 py-2 text-left">Attempts</th>
                <th className="px-4 py-2 text-left">Error</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-[#EAE6D7]">
                  <td className="px-4 py-2 capitalize">{job.status}</td>
                  <td className="px-4 py-2">{(job.event_type || "").replace(/_/g, " ") || "—"}</td>
                  <td className="px-4 py-2 font-mono">{job.patient_id?.slice(0, 8) || "—"}</td>
                  <td className="px-4 py-2">{job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2">{job.attempt_count || 0}/{job.max_attempts || 3}</td>
                  <td className="px-4 py-2 text-[#B14A2C]">{job.error_reason || job.error_message || job.skip_reason || "—"}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {canRetry && ["failed", "retrying"].includes(job.status) && (
                      <button type="button" onClick={() => retryJob(job)} className="underline">Retry</button>
                    )}
                    {canManage && ["pending", "retrying", "queued"].includes(job.status) && (
                      <button type="button" onClick={() => cancelJob(job)} className="underline text-[#B14A2C]">Cancel</button>
                    )}
                    {job.open_conversation_url && (
                      <a href={job.open_conversation_url} target="_blank" rel="noopener noreferrer" className="underline">Whatsgo</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No automation jobs yet.</p>}
        </div>
      </div>
    </div>
  );
}
