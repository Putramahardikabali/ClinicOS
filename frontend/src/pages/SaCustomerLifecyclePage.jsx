import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Users, RefreshCw, Filter, Copy, Plus, Trash2, CheckCircle2, XCircle,
  MessageSquare, BarChart3, GitBranch, FileText, AlertTriangle, ChevronRight,
  Phone, Mail, Calendar, ClipboardList,
} from "lucide-react";

const TABS = [
  { id: "dashboard", label: "Commercial KPIs", icon: BarChart3 },
  { id: "pipeline", label: "Customer pipeline", icon: GitBranch },
  { id: "followups", label: "Follow-ups", icon: MessageSquare },
  { id: "templates", label: "Message templates", icon: FileText },
  { id: "plan-changes", label: "Plan changes", icon: ClipboardList },
  { id: "churn", label: "Churn report", icon: AlertTriangle },
];

const PIPELINE_COLORS = {
  new_signup: { bg: "#1a2a3d", fg: "#7EB8DA" },
  trial_active: { bg: "#1a3d2e", fg: "#8AA992" },
  setup_incomplete: { bg: "#3d321a", fg: "#D4A373" },
  active_trial: { bg: "#1a3d3d", fg: "#7EC8C8" },
  trial_ending_soon: { bg: "#3d2a1a", fg: "#E8B86D" },
  payment_pending: { bg: "#2a3520", fg: "#B8C99A" },
  paid_customer: { bg: "#1a3d2e", fg: "#A8D5B5" },
  past_due: { bg: "#3d1a1a", fg: "#E07A7A" },
  churn_risk: { bg: "#3d1a2a", fg: "#E07A9A" },
  cancelled: { bg: "#2a2020", fg: "#A89A9A" },
};

const HEALTH_COLORS = {
  Cold: { bg: "#2a2020", fg: "#A89A9A" },
  "Needs help": { bg: "#3d321a", fg: "#D4A373" },
  Active: { bg: "#1a3d2e", fg: "#8AA992" },
  "Ready to convert": { bg: "#1a2a3d", fg: "#7EB8DA" },
};

const CHURN_REASONS = [
  { value: "price_too_high", label: "Price too high" },
  { value: "not_using", label: "Not using product" },
  { value: "switched_competitor", label: "Switched to competitor" },
  { value: "missing_features", label: "Missing features" },
  { value: "business_closed", label: "Business closed" },
  { value: "other", label: "Other" },
];

const FOLLOW_UP_TYPES = ["whatsapp", "email", "call", "demo", "internal"];
const TEMPLATE_VARS = ["clinic_name", "owner_name", "trial_end_date", "plan_name", "amount_due", "payment_link", "support_whatsapp"];

const card = { background: "#141B22", border: "1px solid #1F2A30", borderRadius: "12px" };
const muted = { color: "#8FA89E" };
const text = { color: "#E6E8E6" };

function fmtDt(v) {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function fmtLabel(s) {
  return (s || "").replace(/_/g, " ");
}

function PipelinePill({ status }) {
  const c = PIPELINE_COLORS[status] || { bg: "#1A242B", fg: "#9FB3A7" };
  return (
    <span className="text-xs px-2 py-0.5 rounded capitalize whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {fmtLabel(status)}
    </span>
  );
}

function HealthPill({ label }) {
  const c = HEALTH_COLORS[label] || HEALTH_COLORS.Cold;
  return <span className="text-xs px-2 py-0.5 rounded" style={{ background: c.bg, color: c.fg }}>{label}</span>;
}

function TabDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api.get("/superadmin/commercial/dashboard")
      .then((r) => setData(r.data))
      .catch(() => toast.error("Failed to load commercial dashboard"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading && !data) return <div className="text-sm" style={muted}>Loading…</div>;
  if (!data) return null;
  const k = data.kpis || {};
  const f = data.funnel || {};
  const kpis = [
    { label: "New trials (7d)", value: k.new_trials_7d },
    { label: "Active trials", value: k.active_trials },
    { label: "Trials ending soon", value: k.trials_ending_soon },
    { label: "Paid clinics", value: k.paid_clinics },
    { label: "Payment pending", value: k.payment_pending },
    { label: "Past due", value: k.past_due },
    { label: "Churn risk", value: k.churn_risk },
    { label: "Est. MRR", value: `Rp ${Number(k.estimated_mrr_idr || 0).toLocaleString("id-ID")}` },
  ];
  const funnelSteps = [
    { key: "signup", label: "Signup" },
    { key: "setup_complete", label: "Setup complete" },
    { key: "first_booking", label: "First booking" },
    { key: "payment_submitted", label: "Payment submitted" },
    { key: "paid", label: "Paid" },
  ];
  return (
    <div>
      <div className="flex justify-end mb-4">
        <button type="button" onClick={load} className="text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ ...card, ...text }}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8" data-testid="sa-commercial-kpis">
        {kpis.map((item) => (
          <div key={item.label} className="p-4" style={card}>
            <div className="text-xs uppercase tracking-widest" style={muted}>{item.label}</div>
            <div className="text-2xl font-display mt-1" style={{ color: "#F5F2EA" }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div className="p-5 mb-6" style={card}>
        <div className="text-sm font-medium mb-4" style={{ color: "#F5F2EA" }}>Conversion funnel</div>
        <div className="flex flex-wrap gap-2 items-center">
          {funnelSteps.map((step, i) => (
            <div key={step.key} className="flex items-center gap-2">
              <div className="px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", color: "#E6E8E6" }}>
                <span className="text-xs block" style={muted}>{step.label}</span>
                <span className="font-display text-lg">{f[step.key] ?? 0}</span>
              </div>
              {i < funnelSteps.length - 1 && <ChevronRight className="w-4 h-4" style={muted} />}
            </div>
          ))}
        </div>
      </div>
      {data.pipeline_counts && (
        <div className="p-5" style={card}>
          <div className="text-sm font-medium mb-3" style={{ color: "#F5F2EA" }}>Pipeline breakdown</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.pipeline_counts).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
              <div key={st} className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ background: "#0F1419" }}>
                <PipelinePill status={st} />
                <span className="text-sm" style={text}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabPipeline({ onSelectClinic }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [overdue, setOverdue] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (status) params.status = status;
    if (q.trim()) params.q = q.trim();
    if (overdue) params.overdue_follow_up = true;
    api.get("/superadmin/pipeline", { params })
      .then((r) => setItems(r.data?.items || []))
      .catch(() => toast.error("Failed to load pipeline"))
      .finally(() => setLoading(false));
  }, [status, q, overdue]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="text-xs block mb-1" style={muted}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ ...card, ...text }}>
            <option value="">All statuses</option>
            {Object.keys(PIPELINE_COLORS).map((s) => <option key={s} value={s}>{fmtLabel(s)}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs block mb-1" style={muted}>Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Clinic, email, slug…" className="w-full text-sm px-3 py-2 rounded-lg" style={{ ...card, ...text }} />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer" style={text}>
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          Overdue follow-up
        </label>
        <button type="button" onClick={load} className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1" style={{ background: "#3F5A52", color: "#fff" }}>
          <Filter className="w-4 h-4" /> Filter
        </button>
      </div>
      {loading ? <div className="text-sm" style={muted}>Loading…</div> : (
        <div className="overflow-x-auto rounded-xl" style={card}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest border-b border-[#1F2A30]" style={muted}>
                <th className="p-3">Clinic</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Trial</th>
                <th className="p-3">Setup</th>
                <th className="p-3">Health</th>
                <th className="p-3">Pipeline</th>
                <th className="p-3">Next follow-up</th>
                <th className="p-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.clinic_id} className="border-b border-[#1F2A30] hover:bg-[#0F1419] cursor-pointer" onClick={() => onSelectClinic(row.clinic_id)}>
                  <td className="p-3">
                    <div className="font-medium" style={{ color: "#F5F2EA" }}>{row.clinic_name}</div>
                    <div className="text-xs" style={muted}>{row.owner_email}</div>
                  </td>
                  <td className="p-3">
                    <div>{row.owner_name}</div>
                    {row.whatsapp && <div className="text-xs" style={muted}>{row.whatsapp}</div>}
                  </td>
                  <td className="p-3 capitalize">{row.plan}</td>
                  <td className="p-3">
                    {row.trial_days_left != null ? `${row.trial_days_left}d left` : "—"}
                  </td>
                  <td className="p-3">{row.setup_progress}%</td>
                  <td className="p-3">
                    <HealthPill label={row.health_label} />
                    <div className="text-xs mt-0.5" style={muted}>{row.health_score}/100</div>
                  </td>
                  <td className="p-3"><PipelinePill status={row.pipeline_status} /></td>
                  <td className="p-3">{row.next_follow_up_date ? row.next_follow_up_date.slice(0, 10) : "—"}</td>
                  <td className="p-3 text-xs">{fmtDt(row.last_activity_at)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center" style={muted}>No clinics match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClinicDetailPanel({ clinicId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [noteType, setNoteType] = useState("whatsapp");
  const [noteContent, setNoteContent] = useState("");
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!clinicId) return;
    api.get(`/superadmin/pipeline/${clinicId}`)
      .then((r) => setDetail(r.data))
      .catch(() => toast.error("Failed to load clinic"));
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);
  const addNote = async () => {
    if (!noteContent.trim()) return;
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${clinicId}/follow-ups`, {
        type: noteType,
        content: noteContent.trim(),
        next_follow_up_date: nextFollowUp || null,
      });
      setNoteContent("");
      setNextFollowUp("");
      toast.success("Follow-up note added");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add note");
    } finally {
      setBusy(false);
    }
  };
  if (!clinicId) return null;
  const p = detail?.pipeline;
  const notes = detail?.follow_up_notes || [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto p-6 border-l border-[#1F2A30]" style={{ background: "#141B22" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest" style={muted}>Clinic detail</div>
            <h2 className="font-display text-xl mt-1" style={{ color: "#F5F2EA" }}>{p?.clinic_name || "…"}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm px-2 py-1 rounded" style={muted}>Close</button>
        </div>
        {p && (
          <div className="space-y-3 mb-6 text-sm">
            <div className="flex flex-wrap gap-2">
              <PipelinePill status={p.pipeline_status} />
              <HealthPill label={p.health_label} />
            </div>
            <div style={muted}>Owner: {p.owner_name} · {p.owner_email}</div>
            {p.whatsapp && <div style={muted}>WhatsApp: {p.whatsapp}</div>}
            <div style={muted}>Setup: {p.setup_progress}% · Last activity: {fmtDt(p.last_activity_at)}</div>
            <Link to={`/superadmin/clinics/${clinicId}`} className="text-sm inline-flex items-center gap-1" style={{ color: "#8AA992" }}>
              Open clinic admin <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}
        <div className="mb-6 p-4 rounded-xl" style={{ background: "#0F1419" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#F5F2EA" }}>Add follow-up</div>
          <select value={noteType} onChange={(e) => setNoteType(e.target.value)} className="w-full text-sm px-3 py-2 rounded-lg mb-2" style={card}>
            {FOLLOW_UP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={3} placeholder="Note content…" className="w-full text-sm px-3 py-2 rounded-lg mb-2" style={card} />
          <input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className="w-full text-sm px-3 py-2 rounded-lg mb-3" style={card} />
          <button type="button" disabled={busy} onClick={addNote} className="text-sm px-4 py-2 rounded-lg" style={{ background: "#3F5A52", color: "#fff" }}>Save note</button>
        </div>
        <div className="text-sm font-medium mb-2" style={{ color: "#F5F2EA" }}>Timeline</div>
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="p-3 rounded-lg text-sm" style={{ background: "#0F1419" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs uppercase tracking-widest capitalize" style={{ color: "#8AA992" }}>{n.type}</span>
                <span className="text-xs" style={muted}>{fmtDt(n.created_at)}</span>
              </div>
              <div style={text}>{n.content}</div>
              {n.next_follow_up_date && (
                <div className="text-xs mt-1 flex items-center gap-1" style={muted}>
                  <Calendar className="w-3 h-3" /> Next: {n.next_follow_up_date.slice(0, 10)}
                </div>
              )}
            </li>
          ))}
          {notes.length === 0 && <li style={muted}>No follow-up notes yet</li>}
        </ul>
      </div>
    </div>
  );
}

function TabTemplates() {
  const [items, setItems] = useState([]);
  const [vars, setVars] = useState(TEMPLATE_VARS);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rendered, setRendered] = useState(null);
  const [renderClinicId, setRenderClinicId] = useState("");
  const load = useCallback(() => {
    api.get("/superadmin/message-templates")
      .then((r) => {
        setItems(r.data?.items || []);
        if (r.data?.variables) setVars(r.data.variables);
      })
      .catch(() => toast.error("Failed to load templates"));
  }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    if (!name.trim() || !body.trim()) return;
    try {
      await api.post("/superadmin/message-templates", { name, channel, subject: channel === "email" ? subject : null, body });
      setName(""); setBody(""); setSubject("");
      toast.success("Template created");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete template?")) return;
    await api.delete(`/superadmin/message-templates/${id}`);
    load();
  };
  const preview = async (tid) => {
    if (!renderClinicId.trim()) {
      toast.error("Enter a clinic ID to preview");
      return;
    }
    const r = await api.post(`/superadmin/message-templates/${tid}/render`, { clinic_id: renderClinicId.trim() });
    setRendered(r.data);
  };
  const copyText = (t) => {
    navigator.clipboard.writeText(t);
    toast.success("Copied to clipboard");
  };
  return (
    <div>
      <div className="p-5 mb-6" style={card}>
        <div className="text-sm font-medium mb-2" style={{ color: "#F5F2EA" }}>New template (manual copy only)</div>
        <p className="text-xs mb-3" style={muted}>Variables: {vars.map((v) => `{{${v}}}`).join(", ")}</p>
        <div className="grid gap-2 sm:grid-cols-2 mb-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="text-sm px-3 py-2 rounded-lg" style={{ background: "#0F1419", ...text }} />
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ background: "#0F1419", ...text }}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
        </div>
        {channel === "email" && (
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" className="w-full text-sm px-3 py-2 rounded-lg mb-2" style={{ background: "#0F1419", ...text }} />
        )}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Hi {{owner_name}}, your trial for {{clinic_name}} ends {{trial_end_date}}…" className="w-full text-sm px-3 py-2 rounded-lg mb-2" style={{ background: "#0F1419", ...text }} />
        <button type="button" onClick={create} className="text-sm px-4 py-2 rounded-lg inline-flex items-center gap-1" style={{ background: "#3F5A52", color: "#fff" }}>
          <Plus className="w-4 h-4" /> Create
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        <input value={renderClinicId} onChange={(e) => setRenderClinicId(e.target.value)} placeholder="Clinic ID for preview" className="flex-1 text-sm px-3 py-2 rounded-lg" style={card} />
      </div>
      {rendered && (
        <div className="p-4 mb-4 rounded-xl relative" style={{ background: "#0F1419" }}>
          <button type="button" onClick={() => copyText(rendered.body)} className="absolute top-3 right-3 text-xs px-2 py-1 rounded inline-flex items-center gap-1" style={{ background: "#3F5A52", color: "#fff" }}>
            <Copy className="w-3 h-3" /> Copy
          </button>
          {rendered.subject && <div className="text-sm mb-2"><strong>Subject:</strong> {rendered.subject}</div>}
          <pre className="text-sm whitespace-pre-wrap" style={text}>{rendered.body}</pre>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t.id} className="p-4 flex flex-wrap justify-between gap-2" style={card}>
            <div>
              <div className="font-medium" style={{ color: "#F5F2EA" }}>{t.name}</div>
              <div className="text-xs capitalize" style={muted}>{t.channel}</div>
              <pre className="text-xs mt-2 whitespace-pre-wrap max-w-xl" style={muted}>{t.body.slice(0, 120)}…</pre>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => preview(t.id)} className="text-xs px-2 py-1 rounded" style={{ background: "#3F5A52", color: "#fff" }}>Preview</button>
              <button type="button" onClick={() => remove(t.id)} className="text-xs px-2 py-1 rounded" style={{ color: "#E07A7A" }}><Trash2 className="w-4 h-4" /></button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabPlanChanges() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending");
  const load = useCallback(() => {
    const params = status ? { status } : {};
    api.get("/superadmin/plan-change-requests", { params })
      .then((r) => setItems(r.data || []))
      .catch(() => toast.error("Failed to load"));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (id, action) => {
    const reason = action === "reject" ? window.prompt("Rejection reason:") : null;
    if (action === "reject" && !reason) return;
    try {
      if (action === "apply") await api.post(`/superadmin/plan-change-requests/${id}/apply`);
      else if (action === "approve") await api.post(`/superadmin/plan-change-requests/${id}/approve`, { reason: reason || "" });
      else await api.post(`/superadmin/plan-change-requests/${id}/reject`, { reason });
      toast.success(`Request ${action}d`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };
  return (
    <div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm px-3 py-2 rounded-lg mb-4" style={card}>
        <option value="">All</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="applied">Applied</option>
        <option value="rejected">Rejected</option>
      </select>
      <div className="space-y-2">
        {items.map((r) => (
          <div key={r.id} className="p-4" style={card}>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-medium" style={{ color: "#F5F2EA" }}>{r.clinic_name}</div>
                <div className="text-sm capitalize" style={muted}>{r.current_plan} → {r.requested_plan} · {r.billing_cycle}</div>
                {r.note && <div className="text-xs mt-1" style={muted}>{r.note}</div>}
              </div>
              <span className="text-xs uppercase tracking-widest capitalize" style={{ color: "#8AA992" }}>{r.status}</span>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => act(r.id, "approve")} className="text-xs px-2 py-1 rounded inline-flex items-center gap-1" style={{ background: "#1a3d2e", color: "#8AA992" }}>
                  <CheckCircle2 className="w-3 h-3" /> Approve
                </button>
                <button type="button" onClick={() => act(r.id, "apply")} className="text-xs px-2 py-1 rounded" style={{ background: "#3F5A52", color: "#fff" }}>Apply</button>
                <button type="button" onClick={() => act(r.id, "reject")} className="text-xs px-2 py-1 rounded inline-flex items-center gap-1" style={{ color: "#E07A7A" }}>
                  <XCircle className="w-3 h-3" /> Reject
                </button>
              </div>
            )}
            {r.status === "approved" && (
              <button type="button" onClick={() => act(r.id, "apply")} className="text-xs px-2 py-1 rounded mt-3" style={{ background: "#3F5A52", color: "#fff" }}>Apply plan change</button>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="text-sm" style={muted}>No requests</div>}
      </div>
    </div>
  );
}

function TabChurn() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/superadmin/churn-report").then((r) => setData(r.data)).catch(() => toast.error("Failed to load churn report"));
  }, []);
  if (!data) return <div className="text-sm" style={muted}>Loading…</div>;
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(data.by_reason || {}).map(([reason, n]) => (
          <div key={reason} className="px-3 py-2 rounded-lg text-sm" style={card}>
            <span className="capitalize">{fmtLabel(reason)}</span>
            <span className="ml-2 font-display" style={{ color: "#F5F2EA" }}>{n}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest border-b border-[#1F2A30]" style={muted}>
              <th className="p-3">Clinic</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Note</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((row) => (
              <tr key={row.clinic_id} className="border-b border-[#1F2A30]">
                <td className="p-3">
                  <div style={{ color: "#F5F2EA" }}>{row.clinic_name}</div>
                  <div className="text-xs" style={muted}>{row.owner_email}</div>
                </td>
                <td className="p-3 capitalize">{fmtLabel(row.churn_reason)}</td>
                <td className="p-3 text-xs max-w-xs truncate">{row.churn_note}</td>
                <td className="p-3 text-xs">{fmtDt(row.churned_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SaCustomerLifecyclePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "dashboard";
  const [selectedClinic, setSelectedClinic] = useState(null);
  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next);
  };
  const TabIcon = useMemo(() => TABS.find((t) => t.id === tab)?.icon || BarChart3, [tab]);
  return (
    <div className="p-6 md:p-10 max-w-7xl" data-testid="sa-customer-lifecycle">
      <div className="text-xs uppercase tracking-widest mb-1" style={muted}>Phase 5</div>
      <h1 className="font-display text-2xl md:text-3xl flex items-center gap-2" style={{ color: "#F5F2EA" }}>
        <Users className="w-7 h-7" style={{ color: "#8AA992" }} />
        Customer lifecycle
      </h1>
      <p className="text-sm mt-2 mb-6 max-w-2xl" style={muted}>
        Manage trials, follow-ups, conversions, and churn. Message templates are copy-only — no auto-send.
      </p>
      <div className="flex flex-wrap gap-1 mb-6 border-b border-[#1F2A30] pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`sa-lifecycle-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className="text-sm px-3 py-2 rounded-t-lg inline-flex items-center gap-1.5"
              style={{
                background: tab === t.id ? "#141B22" : "transparent",
                color: tab === t.id ? "#F5F2EA" : "#8FA89E",
                borderBottom: tab === t.id ? "2px solid #3F5A52" : "2px solid transparent",
              }}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "dashboard" && <TabDashboard />}
      {tab === "pipeline" && <TabPipeline onSelectClinic={setSelectedClinic} />}
      {tab === "followups" && <TabPipeline onSelectClinic={setSelectedClinic} />}
      {tab === "templates" && <TabTemplates />}
      {tab === "plan-changes" && <TabPlanChanges />}
      {tab === "churn" && <TabChurn />}
      {selectedClinic && <ClinicDetailPanel clinicId={selectedClinic} onClose={() => setSelectedClinic(null)} />}
    </div>
  );
}
