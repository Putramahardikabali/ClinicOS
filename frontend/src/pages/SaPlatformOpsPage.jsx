import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Database, HardDrive, RefreshCw, Shield,
  LifeBuoy, BarChart3, Users, CheckCircle2, XCircle, Clock, Download,
} from "lucide-react";

const TABS = [
  { id: "health", label: "System health", icon: Activity },
  { id: "errors", label: "Error logs", icon: AlertTriangle },
  { id: "backups", label: "Backups", icon: Database },
  { id: "support", label: "Support", icon: LifeBuoy },
  { id: "activity", label: "Clinic activity", icon: Users },
  { id: "analytics", label: "Usage analytics", icon: BarChart3 },
  { id: "security", label: "Security", icon: Shield },
];

const card = { background: "#141B22", border: "1px solid #1F2A30", borderRadius: "12px" };
const muted = { color: "#8FA89E" };
const text = { color: "#E6E8E6" };

function StatusPill({ status }) {
  const ok = status === "ok" || status === "success";
  const bad = status === "error" || status === "failed" || status === "critical";
  const bg = ok ? "#1a3d2e" : bad ? "#3d1a1a" : "#1A242B";
  const fg = ok ? "#8AA992" : bad ? "#E07A7A" : "#9FB3A7";
  return (
    <span className="text-xs px-2 py-0.5 rounded capitalize" style={{ background: bg, color: fg }}>{status || "—"}</span>
  );
}

function ActivityBadge({ label }) {
  const colors = {
    Active: { bg: "#1a3d2e", fg: "#8AA992" },
    Quiet: { bg: "#2a3520", fg: "#B8C99A" },
    "At risk": { bg: "#3d321a", fg: "#D4A373" },
    Inactive: { bg: "#2a2020", fg: "#A89A9A" },
  };
  const c = colors[label] || colors.Inactive;
  return <span className="text-xs px-2 py-0.5 rounded" style={{ background: c.bg, color: c.fg }}>{label}</span>;
}

function fmtDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

function TabHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api.get("/superadmin/ops/health").then((r) => setData(r.data)).catch(() => toast.error("Failed to load health")).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading && !data) return <div className="text-sm" style={muted}>Loading…</div>;
  if (!data) return null;
  const tiles = [
    { label: "Backend", ...data.backend, icon: Activity },
    { label: "Database", ...data.database, icon: Database },
    { label: "Storage", ...data.storage, icon: HardDrive },
  ];
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs" style={muted}>Last checked {fmtDt(data.checked_at)}</div>
        <button type="button" onClick={load} className="text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ ...card, ...text }}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-6">
        {tiles.map((t) => (
          <div key={t.label} className="p-4" style={card}>
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#F5F2EA" }}>
              <t.icon className="w-4 h-4" /> {t.label}
            </div>
            <div className="mt-2"><StatusPill status={t.status} /></div>
            <div className="text-xs mt-2" style={muted}>{t.message}</div>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-4 gap-3 mb-6">
        {[
          ["Open errors", data.open_errors],
          ["Failed uploads (24h)", data.failed_uploads_24h],
          ["Failed sends (24h)", data.failed_sends_24h],
          ["Failed logins (24h)", data.failed_logins_24h],
        ].map(([l, v]) => (
          <div key={l} className="p-3 text-center" style={card}>
            <div className="text-2xl font-display" style={{ color: "#F5F2EA" }}>{v ?? 0}</div>
            <div className="text-xs mt-1" style={muted}>{l}</div>
          </div>
        ))}
      </div>
      <div className="p-4 mb-4" style={card}>
        <div className="text-sm font-medium mb-2" style={{ color: "#F5F2EA" }}>Queue / jobs</div>
        <div className="text-sm" style={text}>Pending payments: {data.queue_jobs?.pending_payments ?? 0} · Open support: {data.queue_jobs?.open_support_requests ?? 0}</div>
        <div className="text-xs mt-1" style={muted}>{data.queue_jobs?.message}</div>
      </div>
      <div className="p-4 mb-4" style={card}>
        <div className="text-sm font-medium mb-2" style={{ color: "#F5F2EA" }}>Backups</div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm" style={text}>
          <div>Last DB: {fmtDt(data.backups?.last_database)} · <StatusPill status={data.backups?.db_status} /></div>
          <div>Last files: {fmtDt(data.backups?.last_files)} · <StatusPill status={data.backups?.file_status} /></div>
        </div>
        {data.backups?.failed_last_24h > 0 && (
          <div className="mt-2 text-sm flex items-center gap-1" style={{ color: "#E07A7A" }}>
            <AlertTriangle className="w-4 h-4" /> {data.backups.failed_last_24h} failed backup(s) in last 24h
          </div>
        )}
      </div>
      <div className="p-4" style={card}>
        <div className="text-sm font-medium mb-3" style={{ color: "#F5F2EA" }}>Recent errors</div>
        {(data.recent_errors || []).length === 0 ? (
          <div className="text-sm" style={muted}>No errors in the last 24 hours.</div>
        ) : (
          <div className="space-y-2">
            {data.recent_errors.map((e) => (
              <div key={e.id} className="text-sm py-2 border-b border-[#1F2A30] last:border-0">
                <div className="flex flex-wrap gap-2 items-center">
                  <StatusPill status={e.severity} />
                  <span style={muted}>{e.module}</span>
                  {e.clinic_name && <span style={text}>{e.clinic_name}</span>}
                  <span className="text-xs ml-auto" style={muted}>{fmtDt(e.created_at)}</span>
                </div>
                <div className="mt-1" style={text}>{e.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabErrors() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("open");
  const load = useCallback(() => {
    api.get("/superadmin/ops/errors", { params: { status: filter || undefined, limit: 200 } })
      .then((r) => setRows(r.data || [])).catch(() => toast.error("Failed to load errors"));
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (id, status) => {
    await api.put(`/superadmin/ops/errors/${id}/status`, { status });
    toast.success(`Marked ${status}`);
    load();
  };
  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {["open", "resolved", "ignored", ""].map((s) => (
          <button key={s || "all"} type="button" onClick={() => setFilter(s)}
            className="text-xs px-3 py-1.5 rounded-lg capitalize"
            style={filter === s ? { background: "#3F5A52", color: "#fff" } : { ...card, ...text }}>
            {s || "all"}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest" style={muted}>
              <th className="p-3">Severity</th><th className="p-3">Clinic</th><th className="p-3">Module</th>
              <th className="p-3">Message</th><th className="p-3">Time</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-[#1F2A30]">
                <td className="p-3"><StatusPill status={e.severity} /></td>
                <td className="p-3" style={text}>{e.clinic_name || "—"}</td>
                <td className="p-3" style={muted}>{e.module}</td>
                <td className="p-3 max-w-md truncate" style={text} title={e.message}>{e.message}</td>
                <td className="p-3 text-xs whitespace-nowrap" style={muted}>{fmtDt(e.created_at)}</td>
                <td className="p-3 capitalize" style={text}>{e.status}</td>
                <td className="p-3 whitespace-nowrap">
                  {e.status === "open" && (
                    <>
                      <button type="button" className="text-xs mr-2" style={{ color: "#8AA992" }} onClick={() => setStatus(e.id, "resolved")}>Resolve</button>
                      <button type="button" className="text-xs" style={{ color: "#8FA89E" }} onClick={() => setStatus(e.id, "ignored")}>Ignore</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-sm text-center" style={muted}>No errors found.</div>}
      </div>
    </div>
  );
}

function TabBackups() {
  const [data, setData] = useState(null);
  const load = () => api.get("/superadmin/ops/backups").then((r) => setData(r.data)).catch(() => toast.error("Failed to load backups"));
  useEffect(() => { load(); }, []);
  const record = async (backup_type, status) => {
    await api.post("/superadmin/ops/backups/record", { backup_type, status, message: `Manual ${status} record` });
    toast.success("Backup recorded");
    load();
  };
  if (!data) return <div className="text-sm" style={muted}>Loading…</div>;
  const st = data.status || {};
  return (
    <div>
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <div className="p-4" style={card}>
          <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>Database backup</div>
          <div className="mt-2 text-sm" style={text}>Last: {fmtDt(st.last_db_backup_at)}</div>
          <StatusPill status={st.last_db_status || "unknown"} />
        </div>
        <div className="p-4" style={card}>
          <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>File backup</div>
          <div className="mt-2 text-sm" style={text}>Last: {fmtDt(st.last_file_backup_at)}</div>
          <StatusPill status={st.last_file_status || "unknown"} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-xs w-full" style={muted}>Record manual backup status (for ops when external jobs run):</span>
        {["database", "files"].flatMap((t) => ["success", "failed"].map((s) => (
          <button key={`${t}-${s}`} type="button" onClick={() => record(t, s)}
            className="text-xs px-3 py-1.5 rounded-lg capitalize"
            style={{ background: s === "success" ? "#1a3d2e" : "#3d1a1a", color: s === "success" ? "#8AA992" : "#E07A7A" }}>
            {t} · {s}
          </button>
        )))}
      </div>
      {(data.recent_failures || []).length > 0 && (
        <div className="p-4 mb-4" style={{ ...card, borderColor: "#5c3030" }}>
          <div className="text-sm font-medium mb-2 flex items-center gap-1" style={{ color: "#E07A7A" }}>
            <AlertTriangle className="w-4 h-4" /> Failed backup alerts
          </div>
          {data.recent_failures.map((b) => (
            <div key={b.id} className="text-sm py-1" style={text}>{b.backup_type} · {fmtDt(b.started_at)} · {b.message || "Failed"}</div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl" style={card}>
        <div className="p-3 text-sm font-medium" style={{ color: "#F5F2EA" }}>Backup history</div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase" style={muted}><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Started</th><th className="p-3">Message</th></tr></thead>
          <tbody>
            {(data.history || []).map((b) => (
              <tr key={b.id} className="border-t border-[#1F2A30]">
                <td className="p-3 capitalize" style={text}>{b.backup_type}</td>
                <td className="p-3"><StatusPill status={b.status} /></td>
                <td className="p-3 text-xs" style={muted}>{fmtDt(b.started_at)}</td>
                <td className="p-3" style={text}>{b.message || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabSupport() {
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState({ clinic_id: "", subject: "", priority: "normal", internal_note: "" });
  const load = () => api.get("/superadmin/ops/support").then((r) => setRows(r.data || []));
  useEffect(() => {
    load();
    api.get("/superadmin/clinics").then((r) => setClinics(r.data || [])).catch(() => {});
  }, []);
  const create = async () => {
    if (!form.clinic_id || !form.subject.trim()) return toast.error("Clinic and subject required");
    await api.post("/superadmin/ops/support", form);
    toast.success("Support request created");
    setForm({ clinic_id: "", subject: "", priority: "normal", internal_note: "" });
    load();
  };
  const update = async (id, patch) => {
    await api.put(`/superadmin/ops/support/${id}`, patch);
    load();
  };
  return (
    <div>
      <div className="p-4 mb-6 grid md:grid-cols-2 gap-3" style={card}>
        <label className="text-sm block">
          <span className="text-xs" style={muted}>Clinic</span>
          <select value={form.clinic_id} onChange={(e) => setForm({ ...form, clinic_id: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            <option value="">Select clinic…</option>
            {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm block">
          <span className="text-xs" style={muted}>Subject</span>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <label className="text-sm block">
          <span className="text-xs" style={muted}>Priority</span>
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-sm block md:col-span-2">
          <span className="text-xs" style={muted}>Internal note</span>
          <input value={form.internal_note} onChange={(e) => setForm({ ...form, internal_note: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <button type="button" onClick={create} className="text-sm px-4 py-2 rounded-lg text-white md:col-span-2 w-fit" style={{ background: "#3F5A52" }}>Create request</button>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="p-4" style={card}>
            <div className="flex flex-wrap gap-2 items-start justify-between">
              <div>
                <div className="font-medium" style={{ color: "#F5F2EA" }}>{r.subject}</div>
                <div className="text-sm mt-1" style={muted}>{r.clinic_name} · {r.priority} · {fmtDt(r.updated_at)}</div>
              </div>
              <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value })}
                className="text-xs px-2 py-1 rounded" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
                {["open", "in_progress", "resolved", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="mt-2 flex gap-2 flex-wrap text-sm">
              <input placeholder="Assigned to" defaultValue={r.assigned_to || ""} onBlur={(e) => update(r.id, { assigned_to: e.target.value })}
                className="px-2 py-1 rounded text-xs" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
              <input placeholder="Add internal note…" onKeyDown={(e) => {
                if (e.key === "Enter" && e.target.value.trim()) {
                  update(r.id, { internal_note: e.target.value.trim() });
                  e.target.value = "";
                }
              }} className="flex-1 min-w-[200px] px-2 py-1 rounded text-xs" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
            </div>
            {(r.internal_notes || []).length > 0 && (
              <div className="mt-3 text-xs space-y-1" style={muted}>
                {r.internal_notes.map((n, i) => (
                  <div key={i}>{fmtDt(n.at)} · {n.by}: {n.text}</div>
                ))}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm" style={muted}>No support requests yet.</div>}
      </div>
    </div>
  );
}

function TabActivity() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("");
  const load = useCallback(() => {
    api.get("/superadmin/ops/activity", { params: { list_filter: filter || undefined } }).then((r) => setData(r.data));
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="text-sm" style={muted}>Loading…</div>;
  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", "Active", "Quiet", "At risk", "Inactive"].map((f) => (
          <button key={f || "all"} type="button" onClick={() => setFilter(f)}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={filter === f ? { background: "#3F5A52", color: "#fff" } : { ...card, ...text }}>
            {f || "All"} {data.summary?.[f] != null && f ? `(${data.summary[f]})` : ""}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase" style={muted}>
              <th className="p-3">Clinic</th><th className="p-3">Label</th><th className="p-3">Last login</th>
              <th className="p-3">Last booking</th><th className="p-3">Last visit</th><th className="p-3">Last invoice</th>
              <th className="p-3">Active users 7d</th>
            </tr>
          </thead>
          <tbody>
            {(data.clinics || []).map((c) => (
              <tr key={c.clinic_id} className="border-t border-[#1F2A30]">
                <td className="p-3">
                  <Link to={`/superadmin/clinics/${c.clinic_id}`} className="hover:underline" style={{ color: "#F5F2EA" }}>{c.clinic_name}</Link>
                </td>
                <td className="p-3"><ActivityBadge label={c.activity_label} /></td>
                <td className="p-3 text-xs" style={muted}>{fmtDt(c.last_login)}</td>
                <td className="p-3 text-xs" style={muted}>{fmtDt(c.last_booking)}</td>
                <td className="p-3 text-xs" style={muted}>{fmtDt(c.last_visit)}</td>
                <td className="p-3 text-xs" style={muted}>{fmtDt(c.last_invoice)}</td>
                <td className="p-3" style={text}>{c.active_users_7d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabAnalytics() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/superadmin/ops/analytics").then((r) => setData(r.data));
  }, []);
  if (!data) return <div className="text-sm" style={muted}>Loading…</div>;
  return (
    <div>
      <div className="text-sm mb-4" style={muted}>{data.alert_clinics} clinic(s) at ≥80% of a plan limit</div>
      <div className="overflow-x-auto rounded-xl" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase" style={muted}>
              <th className="p-3">Clinic</th><th className="p-3">Staff</th><th className="p-3">Storage GB</th>
              <th className="p-3">Patients</th><th className="p-3">Visits</th><th className="p-3">Invoices</th><th className="p-3">Files</th><th className="p-3">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {(data.clinics || []).map((c) => (
              <tr key={c.clinic_id} className="border-t border-[#1F2A30]">
                <td className="p-3">
                  <Link to={`/superadmin/clinics/${c.clinic_id}`} style={{ color: "#F5F2EA" }}>{c.clinic_name}</Link>
                </td>
                <td className="p-3" style={text}>{c.usage.staff_count} / {c.limits.max_staff}</td>
                <td className="p-3" style={text}>{c.usage.storage_used_gb} / {c.limits.storage_gb}</td>
                <td className="p-3" style={text}>{c.usage.patient_count}</td>
                <td className="p-3" style={text}>{c.usage.visit_count}</td>
                <td className="p-3" style={text}>{c.usage.invoice_count}</td>
                <td className="p-3" style={text}>{c.usage.file_count}</td>
                <td className="p-3">
                  {(c.alerts || []).map((a, i) => (
                    <span key={i} className="text-xs block" style={{ color: a.level === "critical" ? "#E07A7A" : "#D4A373" }}>
                      {a.metric} {a.level} ({a.used}/{a.limit})
                    </span>
                  ))}
                  {!c.alerts?.length && <span style={muted}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabSecurity() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/superadmin/ops/security").then((r) => setData(r.data));
  }, []);
  if (!data) return <div className="text-sm" style={muted}>Loading…</div>;
  return (
    <div>
      <div className="p-4 mb-4" style={card}>
        <div className="text-sm" style={text}>Failed logins (7d): <strong>{data.failed_logins_7d}</strong></div>
        <div className="text-xs mt-2" style={muted}>{data.active_sessions_note}</div>
        <div className="text-xs mt-2" style={muted}>Force logout, password reset, and suspend are available on each clinic detail page under Owner account and Danger zone. All actions are audit logged.</div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4" style={card}>
          <div className="text-sm font-medium mb-3" style={{ color: "#F5F2EA" }}>Failed login attempts</div>
          {(data.failed_logins || []).slice(0, 30).map((e) => (
            <div key={e.id} className="text-xs py-1 border-b border-[#1F2A30]" style={text}>
              {fmtDt(e.created_at)} · {e.clinic_name || "—"} · {e.message}
            </div>
          ))}
          {!data.failed_logins?.length && <div className="text-sm" style={muted}>None in last 7 days.</div>}
        </div>
        <div className="p-4" style={card}>
          <div className="text-sm font-medium mb-3" style={{ color: "#F5F2EA" }}>Recent logins</div>
          {(data.recent_logins || []).map((e, i) => (
            <div key={i} className="text-xs py-1 border-b border-[#1F2A30]" style={text}>
              {fmtDt(e.created_at)} · {e.user_email || "—"} · {e.clinic_name || "platform"}
              {e.clinic_id && (
                <Link to={`/superadmin/clinics/${e.clinic_id}`} className="ml-2" style={{ color: "#8AA992" }}>Open clinic</Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TAB_CONTENT = {
  health: TabHealth,
  errors: TabErrors,
  backups: TabBackups,
  support: TabSupport,
  activity: TabActivity,
  analytics: TabAnalytics,
  security: TabSecurity,
};

export default function SaPlatformOpsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "health";
  const setTab = (id) => setParams({ tab: id });
  const Active = TAB_CONTENT[tab] || TabHealth;

  return (
    <div className="p-6 md:p-10 max-w-6xl" data-testid="sa-platform-ops">
      <div className="text-xs uppercase tracking-widest" style={muted}>Phase 3</div>
      <h1 className="font-display text-3xl mt-1" style={{ color: "#F5F2EA" }}>Platform operations</h1>
      <p className="text-sm mt-2 max-w-2xl" style={muted}>
        Monitoring, support, security, backups, and usage analytics for operating the SaaS at scale.
      </p>
      <div className="flex flex-wrap gap-1 mt-6 mb-6 border-b border-[#1F2A30] pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className="text-sm px-3 py-2 rounded-t-lg inline-flex items-center gap-1.5 mb-[-1px]"
              style={active ? { background: "#141B22", color: "#F5F2EA", borderBottom: "2px solid #3F5A52" } : { color: "#9FB3A7" }}
              data-testid={`sa-ops-tab-${t.id}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>
      <Active />
    </div>
  );
}
