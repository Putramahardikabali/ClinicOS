import { useEffect, useMemo, useState } from "react";
import { Link, Routes, Route, useParams, useNavigate, NavLink, useLocation, Navigate } from "react-router-dom";
import { SuperAdminAuthProvider, useSuperAdmin } from "@/lib/superadmin";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Shield, Building2, CreditCard, Megaphone, LogOut, Search,
  Activity, TrendingUp, Users, ExternalLink, CheckCircle2, XCircle, Clock,
  Sparkles, ChevronRight,
} from "lucide-react";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

// ------------- Layout -------------
const NAV = [
  { to: "/superadmin", label: "Dashboard", icon: Activity, end: true },
  { to: "/superadmin/clinics", label: "Clinics", icon: Building2 },
  { to: "/superadmin/payments", label: "Payments", icon: CreditCard },
  { to: "/superadmin/announcements", label: "Announcements", icon: Megaphone },
];

function SuperAdminShell({ children }) {
  const { admin, logout } = useSuperAdmin();
  return (
    <div className="min-h-screen flex bg-[#0F1419]" style={{ color: "#E6E8E6" }}>
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-[#1F2A30]" style={{ background: "#141B22" }}>
        <div className="px-6 py-6 border-b border-[#1F2A30] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#3F5A52" }}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>ClinicOS</div>
            <div className="text-xs" style={{ color: "#8FA89E" }}>Platform Admin</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-5 space-y-1">
          {NAV.map(n => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${isActive ? "" : "hover:bg-[#1A242B]"}`
                }
                style={({ isActive }) => isActive ? { background: "#1F2D34", color: "#F5F2EA" } : { color: "#9FB3A7" }}
                data-testid={`sa-nav-${n.label.toLowerCase()}`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.6} /> {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#1F2A30]">
          <div className="text-xs" style={{ color: "#8FA89E" }}>Signed in as</div>
          <div className="text-sm font-medium mt-0.5" style={{ color: "#F5F2EA" }}>{admin?.email}</div>
          <button onClick={logout} className="mt-3 w-full text-sm py-2 rounded-lg border border-[#2A3942] inline-flex items-center justify-center gap-2 hover:bg-[#1A242B]" data-testid="sa-logout">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}

// ------------- Login -------------
function SaLoginPage() {
  const { login, admin } = useSuperAdmin();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to="/superadmin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      nav("/superadmin");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F1419" }}>
      <div className="w-full max-w-md p-8 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#3F5A52" }}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display text-xl" style={{ color: "#F5F2EA" }}>Platform Admin</div>
            <div className="text-xs" style={{ color: "#8FA89E" }}>Restricted access</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4" data-testid="sa-login-form">
          <div>
            <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Admin email</label>
            <input className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }} type="email" value={email} onChange={e => setEmail(e.target.value)} required data-testid="sa-email" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Password</label>
            <input className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }} type="password" value={password} onChange={e => setPassword(e.target.value)} required data-testid="sa-password" />
          </div>
          <button type="submit" disabled={busy} className="w-full py-2.5 rounded-lg text-white font-medium" style={{ background: "#3F5A52" }} data-testid="sa-submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-xs text-center" style={{ color: "#8FA89E" }}>For clinic staff, use the <Link to="/login" className="underline">main login</Link>.</p>
      </div>
    </div>
  );
}

// ------------- Dashboard -------------
function SaDashboardPage() {
  const [data, setData] = useState({});
  useEffect(() => { api.get("/superadmin/dashboard").then(r => setData(r.data)); }, []);
  const stat = (label, value, sub, testid) => (
    <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid={testid}>
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{label}</div>
      <div className="mt-3 font-display text-3xl" style={{ color: "#F5F2EA" }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: "#8FA89E" }}>{sub}</div>}
    </div>
  );
  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Platform overview</div>
      <h1 className="font-display text-3xl sm:text-4xl mt-2 font-light" style={{ color: "#F5F2EA" }}>
        Hello, <span style={{ color: "#8AA992" }}>Admin</span>
      </h1>
      <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="sa-dashboard-kpis">
        {stat("MRR", fmtIDR(data.mrr_idr), `${data.by_status?.active || 0} active subscriptions`, "sa-kpi-mrr")}
        {stat("Total clinics", data.total_clinics ?? "—", `${data.new_clinics_30d || 0} new this month`, "sa-kpi-clinics")}
        {stat("Pending payments", data.pending_payments ?? "—", "Awaiting verification", "sa-kpi-pending")}
        {stat("Active trials", data.by_status?.trial ?? 0, `${data.by_status?.suspended || 0} suspended`, "sa-kpi-trials")}
      </div>
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Plan distribution</div>
          <ul className="mt-4 space-y-2 text-sm">
            {Object.entries(data.by_plan || {}).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between" style={{ color: "#E6E8E6" }}>
                <span className="capitalize">{k}</span>
                <span style={{ color: "#8AA992" }}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Quick actions</div>
          <div className="mt-4 space-y-2">
            <Link to="/superadmin/payments" className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
              <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" style={{ color: "#8AA992" }} /> Verify pending payments</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link to="/superadmin/clinics" className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4" style={{ color: "#8AA992" }} /> Manage clinics</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link to="/superadmin/announcements" className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
              <span className="flex items-center gap-2"><Megaphone className="w-4 h-4" style={{ color: "#8AA992" }} /> Post an announcement</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------- Clinics list -------------
const STATUS_DOT = {
  trial: "#D8B96B", active: "#8AA992", suspended: "#D58B6B", expired: "#7A8A88", cancelled: "#5C6C62",
};

function SaClinicsPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState({ status: "", plan: "" });

  const load = () => api.get("/superadmin/clinics", { params: { q: q || undefined, status: filter.status || undefined, plan: filter.plan || undefined } }).then(r => setRows(r.data || []));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter.status, filter.plan]);

  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Tenants</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Clinics</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#8FA89E" }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") load(); }}
              placeholder="Search name, slug, email…"
              className="pl-9 pr-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6", minWidth: 260 }}
              data-testid="sa-clinics-search"
            />
          </div>
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-clinics-status">
            <option value="">All statuses</option>
            <option>trial</option><option>active</option><option>suspended</option><option>expired</option><option>cancelled</option>
          </select>
          <select value={filter.plan} onChange={e => setFilter({ ...filter, plan: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-clinics-plan">
            <option value="">All plans</option>
            <option>trial</option><option>starter</option><option>clinic</option><option>complete</option>
          </select>
        </div>
      </div>

      <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <table className="w-full text-sm" data-testid="sa-clinics-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={{ color: "#8FA89E" }}>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Clinic</th>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Plan</th>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Status</th>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Staff</th>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Patients</th>
              <th className="px-5 py-3 font-medium uppercase text-xs tracking-widest">Created</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center" style={{ color: "#8FA89E" }}>No clinics match.</td></tr>}
            {rows.map(c => {
              const sub = c.subscription || {};
              return (
                <tr key={c.id} className="border-t" style={{ borderColor: "#1F2A30" }} data-testid={`sa-clinic-row-${c.slug}`}>
                  <td className="px-5 py-3">
                    <div style={{ color: "#F5F2EA" }} className="font-medium">{c.name}</div>
                    <div className="text-xs" style={{ color: "#8FA89E" }}>/{c.slug} · {c.owner_email}</div>
                  </td>
                  <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{sub.plan}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[sub.status] || "#8FA89E" }} />
                      <span className="capitalize">{sub.status}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{c.staff_count}</td>
                  <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{c.patient_count}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#8FA89E" }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right">
                    <Link to={`/superadmin/clinics/${c.id}`} className="text-sm inline-flex items-center gap-1" style={{ color: "#8AA992" }} data-testid={`sa-clinic-open-${c.slug}`}>
                      Manage <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------- Clinic detail -------------
function SaClinicDetailPage() {
  const { cid } = useParams();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/superadmin/clinics/${cid}`).then(r => setC(r.data));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cid]);

  const action = async (body, msg) => {
    setBusy(true);
    try {
      await api.put(`/superadmin/clinics/${cid}/subscription`, body);
      toast.success(msg);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  if (!c) return <div className="p-10" style={{ color: "#8FA89E" }}>Loading…</div>;
  const sub = c.subscription || {};

  return (
    <div className="p-6 md:p-10 max-w-5xl" data-testid="sa-clinic-detail">
      <Link to="/superadmin/clinics" className="text-sm" style={{ color: "#8FA89E" }}>← All clinics</Link>
      <div className="mt-3 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Clinic</div>
          <h1 className="font-display text-3xl mt-1" style={{ color: "#F5F2EA" }}>{c.name}</h1>
          <div className="text-sm mt-1" style={{ color: "#8FA89E" }}>/{c.slug} · {c.owner_email} · {c.city || "—"}</div>
        </div>
        <a href={`/book/${c.slug}`} target="_blank" rel="noreferrer" className="text-sm inline-flex items-center gap-1 px-3 py-2 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>
          Public page <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Plan" value={sub.plan} />
        <Box label="Status" value={sub.status} />
        <Box label={sub.status === "trial" ? "Trial ends" : "Renews"} value={(sub.trial_end || sub.expiry_date) ? new Date(sub.trial_end || sub.expiry_date).toLocaleDateString() : "—"} />
        <Box label="Created" value={c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"} />
        <Box label="Staff" value={c.staff_count} />
        <Box label="Patients" value={c.patient_count} />
        <Box label="Visits" value={c.visit_count} />
        <Box label="Bookings" value={c.booking_count} />
      </div>

      <div className="mt-7 p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Subscription actions</div>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="sa-clinic-actions">
          {sub.status !== "active" && (
            <BtnAction onClick={() => action({ status: "active" }, "Activated")} disabled={busy} data-testid="sa-action-activate"><CheckCircle2 className="w-4 h-4" /> Activate</BtnAction>
          )}
          {sub.status !== "suspended" && (
            <BtnAction onClick={() => action({ status: "suspended" }, "Suspended")} disabled={busy} data-testid="sa-action-suspend"><XCircle className="w-4 h-4" /> Suspend</BtnAction>
          )}
          <BtnAction onClick={() => action({ extend_days: 30 }, "Extended 30 days")} disabled={busy} data-testid="sa-action-extend"><Clock className="w-4 h-4" /> Extend +30 days</BtnAction>
          <BtnAction onClick={() => action({ plan: "starter" }, "Plan → Starter")} disabled={busy} data-testid="sa-action-plan-starter">Plan → Starter</BtnAction>
          <BtnAction onClick={() => action({ plan: "clinic" }, "Plan → Clinic")} disabled={busy} data-testid="sa-action-plan-clinic">Plan → Clinic</BtnAction>
          <BtnAction onClick={() => action({ plan: "complete" }, "Plan → Complete")} disabled={busy} data-testid="sa-action-plan-complete">Plan → Complete</BtnAction>
        </div>
      </div>

      <div className="mt-6 p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Recent payment requests</div>
        {(c.recent_payments || []).length === 0 ? (
          <div className="mt-3 text-sm" style={{ color: "#8FA89E" }}>No payment requests yet.</div>
        ) : (
          <ul className="mt-3 space-y-2">
            {c.recent_payments.map(p => (
              <li key={p.id} className="flex items-center justify-between text-sm" style={{ color: "#E6E8E6" }}>
                <span>{p.plan} · {fmtIDR(p.amount_idr)} · code {p.unique_code}</span>
                <span className="text-xs uppercase tracking-widest" style={{ color: STATUS_DOT[p.status] || "#8AA992" }}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Box({ label, value }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{label}</div>
      <div className="mt-1.5 font-display capitalize" style={{ color: "#F5F2EA", fontSize: 20 }}>{value ?? "—"}</div>
    </div>
  );
}
function BtnAction({ children, ...rest }) {
  return (
    <button {...rest} className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>
      {children}
    </button>
  );
}

// ------------- Payments queue -------------
function SaPaymentsPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("submitted");
  const load = () => api.get("/superadmin/payments", { params: { status: status || undefined } }).then(r => setRows(r.data || []));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const act = async (id, action) => {
    try {
      await api.post(`/superadmin/payments/${id}/${action}`);
      toast.success(action === "verify" ? "Payment verified & plan activated" : "Payment rejected");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Verification queue</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Payments</h1>
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-payments-filter">
          <option value="submitted">Submitted</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <table className="w-full text-sm" data-testid="sa-payments-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={{ color: "#8FA89E" }}>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Clinic</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Plan</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Amount</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Code</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Submitted</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center" style={{ color: "#8FA89E" }}>No payments here.</td></tr>}
            {rows.map(p => (
              <tr key={p.id} className="border-t" style={{ borderColor: "#1F2A30" }} data-testid={`sa-payment-row-${p.id}`}>
                <td className="px-5 py-3">
                  <div style={{ color: "#F5F2EA" }} className="font-medium">{p.clinic_name || "—"}</div>
                  <div className="text-xs" style={{ color: "#8FA89E" }}>{p.owner_email || ""}</div>
                </td>
                <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{p.plan}</td>
                <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{fmtIDR(p.amount_idr)}</td>
                <td className="px-5 py-3 font-mono" style={{ color: "#E6E8E6" }}>{p.unique_code}</td>
                <td className="px-5 py-3 text-xs" style={{ color: "#8FA89E" }}>{new Date(p.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 capitalize">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[p.status] || "#8FA89E" }} />
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  {p.status === "submitted" && (
                    <div className="flex justify-end gap-2">
                      <button onClick={() => act(p.id, "verify")} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: "#3F5A52", color: "#fff" }} data-testid={`sa-verify-${p.id}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Verify
                      </button>
                      <button onClick={() => act(p.id, "reject")} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: "#5C2E1F", color: "#fff" }} data-testid={`sa-reject-${p.id}`}>
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------- Announcements -------------
function SaAnnouncementsPage() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ title: "", body: "", severity: "info", audience: "all", active: true });
  const load = () => api.get("/superadmin/announcements").then(r => setRows(r.data || []));
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    await api.post("/superadmin/announcements", form);
    setForm({ title: "", body: "", severity: "info", audience: "all", active: true });
    toast.success("Announcement posted");
    load();
  };
  const del = async (id) => {
    if (!window.confirm("Delete this announcement?")) return;
    await api.delete(`/superadmin/announcements/${id}`);
    load();
  };
  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Broadcast</div>
      <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Announcements</h1>

      <form onSubmit={submit} className="mt-6 p-5 rounded-2xl space-y-3" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid="sa-announcement-form">
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="Title" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }} data-testid="sa-ann-title" />
        <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required placeholder="Message body" rows={3} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }} data-testid="sa-ann-body" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option>
          </select>
          <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="all">All clinics</option><option value="trial">Trial only</option><option value="active">Active only</option><option value="expired">Expired only</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg text-white text-sm" style={{ background: "#3F5A52" }} data-testid="sa-ann-submit">Post announcement</button>
      </form>

      <ul className="mt-6 space-y-2">
        {rows.map(r => (
          <li key={r.id} className="p-4 rounded-xl flex items-center justify-between" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid={`sa-ann-row-${r.id}`}>
            <div>
              <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>{r.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "#8FA89E" }}>{r.audience} · {r.severity} · {new Date(r.created_at).toLocaleDateString()}</div>
              <div className="text-sm mt-2" style={{ color: "#E6E8E6" }}>{r.body}</div>
            </div>
            <button onClick={() => del(r.id)} className="text-xs px-2 py-1 rounded" style={{ color: "#D58B6B" }}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------- Auth guard -------------
function RequireSuperAdmin({ children }) {
  const { admin, loading } = useSuperAdmin();
  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F1419", color: "#8FA89E" }}>Loading…</div>;
  if (!admin) return <SaLoginPage />;
  return <SuperAdminShell>{children}</SuperAdminShell>;
}

export default function SuperAdminApp() {
  return (
    <SuperAdminAuthProvider>
      <Routes>
        <Route index element={<RequireSuperAdmin><SaDashboardPage /></RequireSuperAdmin>} />
        <Route path="clinics" element={<RequireSuperAdmin><SaClinicsPage /></RequireSuperAdmin>} />
        <Route path="clinics/:cid" element={<RequireSuperAdmin><SaClinicDetailPage /></RequireSuperAdmin>} />
        <Route path="payments" element={<RequireSuperAdmin><SaPaymentsPage /></RequireSuperAdmin>} />
        <Route path="announcements" element={<RequireSuperAdmin><SaAnnouncementsPage /></RequireSuperAdmin>} />
      </Routes>
    </SuperAdminAuthProvider>
  );
}
