import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Routes, Route, useParams, useNavigate, NavLink, useLocation, Navigate, useSearchParams } from "react-router-dom";
import { SuperAdminAuthProvider, useSuperAdmin } from "@/lib/superadmin";
import api, { fileUrl } from "@/lib/api";
import { toast } from "sonner";
import {
  Shield, Building2, CreditCard, Megaphone, LogOut,
  Activity, Users, ExternalLink, CheckCircle2, XCircle, Clock,
  ChevronRight, Settings as SettingsIcon, X, Eye, KeyRound, UserCheck,
  BarChart3, ScrollText, RefreshCw, Bell, Plus, Copy, MessageCircle, Mail,
  AlertTriangle, History, HeartPulse, Download, Trash2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import SaSettingsPage from "@/pages/SaSettingsPage";
import SaPlatformOpsPage from "@/pages/SaPlatformOpsPage";
import SaCustomerLifecyclePage from "@/pages/SaCustomerLifecyclePage";
import SaQaCleanupPage from "@/pages/SaQaCleanupPage";
import SaAccountSettingsPage from "@/pages/SaAccountSettingsPage";
import SearchInput from "@/components/ui/SearchInput";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

// ------------- Layout -------------
const NAV = [
  { to: "/superadmin", label: "Dashboard", icon: Activity, end: true },
  { to: "/superadmin/clinics", label: "Clinics", icon: Building2 },
  { to: "/superadmin/payments", label: "Payments", icon: CreditCard },
  { to: "/superadmin/customers", label: "Customers", icon: Users },
  { to: "/superadmin/ops", label: "Platform ops", icon: HeartPulse },
  { to: "/superadmin/qa-cleanup", label: "QA cleanup", icon: Trash2 },
  { to: "/superadmin/audit-log", label: "Audit log", icon: ScrollText },
  { to: "/superadmin/announcements", label: "Announcements", icon: Megaphone },
  { to: "/superadmin/settings", label: "Settings", icon: SettingsIcon },
];

function SuperAdminShell({ children }) {
  const { admin, logout } = useSuperAdmin();
  const [unread, setUnread] = useState(0);
  const loc = useLocation();

  useEffect(() => {
    if (!admin) return;
    api.get("/superadmin/notifications", { params: { limit: 1 } })
      .then((r) => setUnread(r.data?.unread_count || 0))
      .catch(() => {});
  }, [admin, loc.pathname]);

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
          <Link
            to="/superadmin/account"
            className="mt-3 w-full text-sm py-2 rounded-lg border border-[#2A3942] inline-flex items-center justify-center gap-2 hover:bg-[#1A242B]"
            style={{ color: "#E6E8E6" }}
          >
            <SettingsIcon className="w-4 h-4" /> Account settings
          </Link>
          <button onClick={logout} className="mt-3 w-full text-sm py-2 rounded-lg border border-[#2A3942] inline-flex items-center justify-center gap-2 hover:bg-[#1A242B]" data-testid="sa-logout">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="hidden lg:flex items-center justify-end gap-2 px-8 py-3 border-b border-[#1F2A30]" style={{ background: "#141B22" }}>
          <Link
            to="/superadmin/notifications"
            className="relative p-2 rounded-lg hover:bg-[#1A242B]"
            style={{ color: "#E6E8E6" }}
            data-testid="sa-notifications-bell"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ background: "#D58B6B" }}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}

// ------------- Login -------------
function SaLoginPage() {
  const { login, admin, complete2faVerify, complete2faRecovery } = useSuperAdmin();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("credentials");
  const [challengeToken, setChallengeToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  if (admin) return <Navigate to="/superadmin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.requires2fa) {
        setChallengeToken(result.challengeToken);
        setStep("totp");
        return;
      }
      nav("/superadmin");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Login failed");
    } finally { setBusy(false); }
  };

  const submitTotp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await complete2faVerify(challengeToken, totpCode);
      nav("/superadmin");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Verification failed");
    } finally { setBusy(false); }
  };

  const submitRecovery = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await complete2faRecovery(challengeToken, recoveryCode);
      nav("/superadmin");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Recovery failed");
    } finally { setBusy(false); }
  };

  const backToCredentials = () => {
    setStep("credentials");
    setChallengeToken("");
    setTotpCode("");
    setRecoveryCode("");
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
            <div className="text-xs" style={{ color: "#8FA89E" }}>
              {step === "credentials"
                ? "Restricted access for ClinicOS platform administrators."
                : step === "totp"
                  ? "Two-factor authentication"
                  : "Recovery code"}
            </div>
          </div>
        </div>

        {step === "credentials" && (
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
        )}

        {step === "totp" && (
          <form onSubmit={submitTotp} className="space-y-4" data-testid="sa-2fa-form">
            <p className="text-sm" style={{ color: "#C7D1CB" }}>Enter the 6-digit code from your authenticator app.</p>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Authenticator code</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none tracking-widest text-center text-lg"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                data-testid="sa-2fa-code"
              />
            </div>
            <button type="submit" disabled={busy || totpCode.length !== 6} className="w-full py-2.5 rounded-lg text-white font-medium" style={{ background: "#3F5A52" }} data-testid="sa-2fa-submit">
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button type="button" onClick={() => setStep("recovery")} className="w-full text-sm underline" style={{ color: "#8FA89E" }}>
              Use a recovery code instead
            </button>
            <button type="button" onClick={backToCredentials} className="w-full text-sm" style={{ color: "#8FA89E" }}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "recovery" && (
          <form onSubmit={submitRecovery} className="space-y-4" data-testid="sa-recovery-form">
            <p className="text-sm" style={{ color: "#C7D1CB" }}>Enter one of your recovery codes. Each code can only be used once.</p>
            <div>
              <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Recovery code</label>
              <input
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg outline-none uppercase"
                style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
                required
                data-testid="sa-recovery-code"
              />
            </div>
            <button type="submit" disabled={busy || !recoveryCode.trim()} className="w-full py-2.5 rounded-lg text-white font-medium" style={{ background: "#3F5A52" }}>
              {busy ? "Verifying…" : "Sign in with recovery code"}
            </button>
            <button type="button" onClick={() => setStep("totp")} className="w-full text-sm underline" style={{ color: "#8FA89E" }}>
              Use authenticator app instead
            </button>
            <button type="button" onClick={backToCredentials} className="w-full text-sm" style={{ color: "#8FA89E" }}>
              Back to sign in
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-center" style={{ color: "#8FA89E" }}>For clinic staff, use the <Link to="/login" className="underline">main login</Link>.</p>
      </div>
    </div>
  );
}

// ------------- Dashboard -------------
function fmtCompactIDR(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(1)}b`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}k`;
  return `Rp ${v}`;
}

const CHART_COLORS = { starter: "#8AA992", clinic: "#D4A373", complete: "#C7A8E0" };

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg p-3 text-xs" style={{ background: "#0F1419", border: "1px solid #2A3942" }}>
      <div className="font-medium mb-1" style={{ color: "#F5F2EA" }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="capitalize inline-flex items-center gap-1.5" style={{ color: "#C7D1CB" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} /> {p.dataKey}
          </span>
          <span style={{ color: "#F5F2EA" }}>{fmtIDR(p.value)}</span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t flex items-center justify-between gap-4" style={{ borderColor: "#1F2A30", color: "#8AA992" }}>
        <span>Total</span><span>{fmtIDR(total)}</span>
      </div>
    </div>
  );
}

function RevenueChart() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/superadmin/revenue-chart?months=6").then(r => setData(r.data)); }, []);
  if (!data) return <div className="h-72 flex items-center justify-center text-sm" style={{ color: "#8FA89E" }}>Loading chart…</div>;
  const total = data.months.reduce((s, m) => s + (m.total || 0), 0);
  const peak = Math.max(...data.months.map(m => m.total || 0));
  const peakMonth = data.months.find(m => m.total === peak);

  return (
    <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid="sa-revenue-chart">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "#8FA89E" }}>
            <BarChart3 className="w-3.5 h-3.5" /> Revenue · last 6 months
          </div>
          <div className="font-display text-2xl mt-1" style={{ color: "#F5F2EA" }} data-testid="sa-revenue-total">{fmtIDR(total)}</div>
          <div className="text-xs mt-0.5" style={{ color: "#8FA89E" }}>
            {data.source === "verified_payments" ? "from verified subscription payments" : "active subscription snapshot"}
            {peak > 0 && peakMonth && <> · peak {peakMonth.label}</>}
          </div>
        </div>
        <div className="flex gap-3 text-xs">
          {["starter", "clinic", "complete"].map(k => (
            <div key={k} className="inline-flex items-center gap-1.5 capitalize" style={{ color: "#C7D1CB" }}>
              <span className="w-2 h-2 rounded-sm" style={{ background: CHART_COLORS[k] }} /> {k}
            </div>
          ))}
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.months} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2A30" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#8FA89E", fontSize: 11 }} axisLine={{ stroke: "#1F2A30" }} tickLine={false} />
            <YAxis tickFormatter={fmtCompactIDR} tick={{ fill: "#8FA89E", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<RevenueTooltip />} cursor={{ fill: "rgba(138,169,146,0.06)" }} />
            <Bar dataKey="starter"  stackId="rev" fill={CHART_COLORS.starter}  radius={[0,0,0,0]} />
            <Bar dataKey="clinic"   stackId="rev" fill={CHART_COLORS.clinic}   radius={[0,0,0,0]} />
            <Bar dataKey="complete" stackId="rev" fill={CHART_COLORS.complete} radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

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

      <div className="mt-6">
        <RevenueChart />
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
            <Link to="/superadmin/ops" className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
              <span className="flex items-center gap-2"><HeartPulse className="w-4 h-4" style={{ color: "#8AA992" }} /> Platform operations</span>
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
  trial: "#D8B96B", active: "#8AA992", past_due: "#D8B96B", suspended: "#D58B6B",
  expired: "#7A8A88", cancelled: "#5C6C62", archived: "#5C6C62", submitted: "#D8B96B", verified: "#8AA992",
  rejected: "#D58B6B", needs_clarification: "#C7A8E0",
};

const CLINIC_LIST_FILTERS = [
  { value: "", label: "Active (hide archived)" },
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All statuses" },
];

const SUB_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled", "expired", "archived"];

const CYCLE_LABEL = { monthly: "Monthly", semiannual: "6 months", annual: "Annually" };

function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function fmtDateTime(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

function SaClinicsPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState({ status: "", plan: "", list_filter: "" });

  const load = useCallback(
    () => api.get("/superadmin/clinics", {
      params: {
        q: q || undefined,
        status: filter.status || undefined,
        plan: filter.plan || undefined,
        list_filter: filter.list_filter || undefined,
      },
    }).then(r => setRows(r.data || [])),
    [q, filter.status, filter.plan, filter.list_filter]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter.status, filter.plan, filter.list_filter]);

  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Tenants</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Clinics</h1>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Link to="/superadmin/clinics/new" className="text-sm px-4 py-2 rounded-lg inline-flex items-center gap-2 text-white" style={{ background: "#3F5A52" }} data-testid="sa-create-clinic">
            <Plus className="w-4 h-4" /> Create clinic
          </Link>
          <SearchInput
            useBlInput={false}
            iconClassName="!text-[#8FA89E]"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") load(); }}
            placeholder="Search name, slug, email…"
            inputClassName="pr-3 py-2 rounded-lg outline-none text-sm min-w-[260px]"
            style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }}
            data-testid="sa-clinics-search"
          />
          <select value={filter.list_filter} onChange={e => setFilter({ ...filter, list_filter: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-clinics-list-filter">
            {CLINIC_LIST_FILTERS.map((f) => <option key={f.value || "default"} value={f.value}>{f.label}</option>)}
          </select>
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-clinics-status">
            <option value="">All statuses</option>
            <option>trial</option><option>active</option><option>past_due</option><option>suspended</option><option>expired</option><option>cancelled</option>
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

function SaCreateClinicPage() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    clinic_name: "",
    slug: "",
    owner_name: "",
    owner_email: "",
    password: "",
    invite_mode: "password",
    plan: "trial",
    billing_cycle: "monthly",
    trial_days: 14,
    template_preset: "default",
    initial_status: "",
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...form,
        slug: form.slug || undefined,
        password: form.invite_mode === "password" && form.password ? form.password : undefined,
        initial_status: form.initial_status || undefined,
      };
      const r = await api.post("/superadmin/clinics", body);
      setResult(r.data);
      toast.success("Clinic created");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create clinic");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const creds = result.owner_credentials || {};
    return (
      <div className="p-6 md:p-10 max-w-2xl" data-testid="sa-create-clinic-success">
        <Link to="/superadmin/clinics" className="text-sm" style={{ color: "#8FA89E" }}>← All clinics</Link>
        <h1 className="font-display text-3xl mt-3" style={{ color: "#F5F2EA" }}>{result.name} created</h1>
        <div className="mt-6 p-5 rounded-2xl space-y-3 text-sm" style={{ background: "#141B22", border: "1px solid #1F2A30", color: "#E6E8E6" }}>
          <div>Slug: <strong>/{result.slug}</strong></div>
          <div>Owner: <strong>{creds.email}</strong></div>
          {creds.temporary_password && (
            <div className="font-mono text-lg" style={{ color: "#D4A373" }}>{creds.temporary_password}</div>
          )}
          {creds.invite_mode === "invite" && <div style={{ color: "#8FA89E" }}>Invite mode — owner must change password on first login.</div>}
          <div className="pt-2 flex gap-2">
            <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/login`)} className="text-xs px-3 py-2 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
              Copy login URL
            </button>
            <Link to={`/superadmin/clinics/${result.id}`} className="text-xs px-3 py-2 rounded-lg text-white" style={{ background: "#3F5A52" }}>Open clinic</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-2xl" data-testid="sa-create-clinic-form">
      <Link to="/superadmin/clinics" className="text-sm" style={{ color: "#8FA89E" }}>← All clinics</Link>
      <div className="text-xs uppercase tracking-widest mt-3" style={{ color: "#8FA89E" }}>Onboarding</div>
      <h1 className="font-display text-3xl mt-1" style={{ color: "#F5F2EA" }}>Create clinic</h1>
      <form onSubmit={submit} className="mt-6 p-5 rounded-2xl space-y-4" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <Field label="Clinic name" value={form.clinic_name} onChange={(v) => setForm({ ...form, clinic_name: v })} required />
        <Field label="Slug (optional)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} placeholder="auto-generated if empty" />
        <Field label="Owner name" value={form.owner_name} onChange={(v) => setForm({ ...form, owner_name: v })} required />
        <Field label="Owner email" type="email" value={form.owner_email} onChange={(v) => setForm({ ...form, owner_email: v })} required />
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Access</span>
          <select value={form.invite_mode} onChange={(e) => setForm({ ...form, invite_mode: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            <option value="password">Temporary password</option>
            <option value="invite">Invite (must change password)</option>
          </select>
        </label>
        {form.invite_mode === "password" && (
          <Field label="Password (optional — auto-generated if empty)" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Plan</span>
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="clinic">Clinic</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Billing period</span>
            <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
              <option value="monthly">Monthly</option>
              <option value="semiannual">6 months</option>
              <option value="annual">Annually</option>
            </select>
          </label>
        </div>
        {form.plan === "trial" && (
          <Field label="Trial days" type="number" value={form.trial_days} onChange={(v) => setForm({ ...form, trial_days: Number(v) })} />
        )}
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Template preset</span>
          <select value={form.template_preset} onChange={(e) => setForm({ ...form, template_preset: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            <option value="default">Default (full forms & catalog)</option>
            <option value="minimal">Minimal</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className="w-full py-2.5 rounded-lg text-white font-medium" style={{ background: "#3F5A52" }}>
          {busy ? "Creating…" : "Create clinic"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 rounded-lg text-sm"
        style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}
      />
    </label>
  );
}

// ------------- Clinic detail -------------
function PlanChangeModal({ plan, preview, onClose, onConfirm, busy }) {
  if (!preview) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>Change plan → {plan}</div>
        <div className="mt-3 text-sm space-y-2" style={{ color: "#C7D1CB" }}>
          <div>Staff: {preview.usage?.staff_count} / {preview.limits?.max_staff >= 9999 ? "∞" : preview.limits?.max_staff}</div>
          <div>Storage: {preview.usage?.storage_used_gb} GB / {preview.limits?.storage_gb} GB</div>
          {preview.warnings?.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "#D58B6B" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" /> {w}
            </div>
          ))}
        </div>
        {preview.blocked ? (
          <p className="mt-3 text-xs" style={{ color: "#D58B6B" }}>Downgrade blocked — usage exceeds new plan limits. Use custom limit overrides or force with override below.</p>
        ) : preview.is_downgrade ? (
          <p className="mt-3 text-xs" style={{ color: "#D8B96B" }}>This is a downgrade. Confirm limits are acceptable.</p>
        ) : null}
        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm(preview.blocked)}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm text-white"
            style={{ background: preview.blocked ? "#5C2E1F" : "#3F5A52" }}
          >
            {preview.blocked ? "Force override" : "Apply plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children, danger }) {
  return (
    <div className="mt-5 p-5 rounded-2xl" style={{ background: "#141B22", border: `1px solid ${danger ? "#5C2E1F" : "#1F2A30"}` }}>
      <div className="text-xs uppercase tracking-widest" style={{ color: danger ? "#D58B6B" : "#8FA89E" }}>{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ChangeOwnerEmailModal({ onClose, onSubmit, busy }) {
  const [form, setForm] = useState({ new_email: "", confirm_email: "", reason: "", update_primary_clinic_email: false, invalidate_sessions: true });
  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl space-y-3" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>Change owner email</div>
        <Field label="New owner email" type="email" value={form.new_email} onChange={(v) => setForm({ ...form, new_email: v })} required />
        <Field label="Confirm new email" type="email" value={form.confirm_email} onChange={(v) => setForm({ ...form, confirm_email: v })} required />
        <Field label="Reason (required)" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} required />
        <label className="flex items-center gap-2 text-sm" style={{ color: "#C7D1CB" }}>
          <input type="checkbox" checked={form.update_primary_clinic_email} onChange={(e) => setForm({ ...form, update_primary_clinic_email: e.target.checked })} />
          Also update primary clinic email
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: "#C7D1CB" }}>
          <input type="checkbox" checked={form.invalidate_sessions} onChange={(e) => setForm({ ...form, invalidate_sessions: e.target.checked })} />
          Invalidate owner sessions
        </label>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => onSubmit(form)} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: "#3F5A52" }}>{busy ? "Saving…" : "Change email"}</button>
        </div>
      </div>
    </div>
  );
}

function ChurnReasonModal({ title, onClose, onSubmit, busy, confirmLabel = "Confirm" }) {
  const CHURN_OPTS = [
    { value: "price_too_high", label: "Price too high" },
    { value: "not_using", label: "Not using product" },
    { value: "switched_competitor", label: "Switched to competitor" },
    { value: "missing_features", label: "Missing features" },
    { value: "business_closed", label: "Business closed" },
    { value: "other", label: "Other" },
  ];
  const [churnReason, setChurnReason] = useState("not_using");
  const [churnNote, setChurnNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>{title}</div>
        <label className="block mt-4 text-sm">
          <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Churn reason</span>
          <select value={churnReason} onChange={(e) => setChurnReason(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            {CHURN_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block mt-3 text-sm">
          <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Note (required)</span>
          <textarea value={churnNote} onChange={(e) => setChurnNote(e.target.value)} rows={3} placeholder="Details about cancellation…" className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Close</button>
          <button type="button" disabled={busy || !churnNote.trim()} onClick={() => onSubmit({ churn_reason: churnReason, churn_note: churnNote.trim(), reason: churnNote.trim() })} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: "#5C2E1F" }}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ReasonModal({ title, onClose, onSubmit, busy, confirmLabel = "Confirm" }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>{title}</div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" className="mt-4 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button type="button" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: "#5C2E1F" }}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function PermanentDeleteModal({ clinic, onClose, onSubmit, busy }) {
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");

  const canContinue = slug.trim() === clinic.slug && reason.trim() && phrase.trim() === "DELETE PERMANENTLY";

  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #5C2E1F" }}>
        <div className="font-display text-lg" style={{ color: "#D58B6B" }}>Delete permanently</div>
        <p className="text-sm mt-1" style={{ color: "#8FA89E" }}>
          Test/demo clinic only. This removes all users, patients, visits, billing, and files for <strong>{clinic.name}</strong>.
        </p>
        {step === 1 ? (
          <>
            <label className="block mt-4 text-sm">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Type clinic slug to confirm</span>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={clinic.slug} className="mt-1 w-full px-3 py-2 rounded-lg text-sm font-mono" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
            </label>
            <label className="block mt-3 text-sm">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Deletion reason</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
            </label>
            <label className="block mt-3 text-sm">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Type DELETE PERMANENTLY</span>
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm font-mono" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
            </label>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
              <button type="button" disabled={!canContinue} onClick={() => setStep(2)} className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-40" style={{ background: "#5C2E1F" }}>Continue</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm" style={{ color: "#E6E8E6" }}>
              Final confirmation: permanently delete <strong>/{clinic.slug}</strong> and all related data? This cannot be undone.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setStep(1)} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Back</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSubmit({ confirm_slug: slug.trim(), reason: reason.trim(), confirm_phrase: phrase.trim(), confirmed: true })}
                className="px-4 py-2 rounded-lg text-sm text-white"
                style={{ background: "#5C2E1F" }}
              >
                {busy ? "Deleting…" : "Yes, delete permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DemoResetModal({ clinic, onClose, onSubmit, busy }) {
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const canReset = slug.trim() === clinic.slug && reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-md rounded-xl p-6" style={{ background: "#141B22", border: "1px solid #2A3942" }}>
        <h2 className="font-display text-xl" style={{ color: "#F5F2EA" }}>Reset demo data</h2>
        <p className="text-sm mt-2" style={{ color: "#8FA89E" }}>
          Clears patients, visits, bookings, and other demo data. Keeps the clinic account and owner. Resets trial subscription. Audit logged.
        </p>
        <label className="block text-sm mt-4">
          <span className="text-xs" style={{ color: "#8FA89E" }}>Confirm slug: <strong>/{clinic.slug}</strong></span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <label className="block text-sm mt-3">
          <span className="text-xs" style={{ color: "#8FA89E" }}>Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button type="button" disabled={!canReset || busy} onClick={() => onSubmit({ confirm_slug: slug.trim(), reason: reason.trim() })}
            className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-40" style={{ background: "#5C2E1F" }}>
            {busy ? "Resetting…" : "Reset demo data"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportClinicModal({ clinic, onClose, onSubmit, busy }) {
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [format, setFormat] = useState("zip");
  const canExport = slug.trim() === clinic.slug && reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-md rounded-xl p-6" style={{ background: "#141B22", border: "1px solid #2A3942" }}>
        <h2 className="font-display text-xl" style={{ color: "#F5F2EA" }}>Export support data</h2>
        <p className="text-sm mt-2" style={{ color: "#8FA89E" }}>
          Exports operational data for support. Sensitive clinical note content is excluded. Slug confirmation and a reason are required; this action is audit logged.
        </p>
        <label className="block text-sm mt-4">
          <span className="text-xs" style={{ color: "#8FA89E" }}>Confirm slug: <strong>/{clinic.slug}</strong></span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <label className="block text-sm mt-3">
          <span className="text-xs" style={{ color: "#8FA89E" }}>Reason for export</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        </label>
        <label className="block text-sm mt-3">
          <span className="text-xs" style={{ color: "#8FA89E" }}>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
            <option value="zip">ZIP of CSV files</option>
            <option value="xlsx">Excel workbook (.xlsx)</option>
          </select>
        </label>
        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button type="button" disabled={!canExport || busy} onClick={() => onSubmit({ confirm_slug: slug.trim(), reason: reason.trim(), format })}
            className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-40" style={{ background: "#3F5A52" }}>
            {busy ? "Exporting…" : "Download support data"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaClinicDetailPage() {
  const { cid } = useParams();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  const [limitDraft, setLimitDraft] = useState({ max_staff: "", storage_gb: "" });
  const [profileDraft, setProfileDraft] = useState({ name: "", slug: "", email: "", phone: "", timezone: "", currency: "IDR", reason: "" });
  const [subDraft, setSubDraft] = useState({ plan: "", status: "", billing_cycle: "monthly", expiry_date: "", trial_end: "", grace_days: "", reason: "" });
  const [tempPassword, setTempPassword] = useState(null);
  const [planModal, setPlanModal] = useState(null);
  const [reminderText, setReminderText] = useState("");
  const [reminderType, setReminderType] = useState("renewal");
  const [ownerEmailModal, setOwnerEmailModal] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [resetDemoModal, setResetDemoModal] = useState(false);

  const syncFromClinic = (data) => {
    setC(data);
    const lim = data?.limits || {};
    setLimitDraft({ max_staff: lim.max_staff ?? "", storage_gb: lim.storage_gb ?? "" });
    setProfileDraft({
      name: data?.name || "",
      slug: data?.slug || "",
      email: data?.email || "",
      phone: data?.phone || "",
      timezone: data?.timezone || "Asia/Makassar",
      currency: data?.currency || "IDR",
      reason: "",
    });
    const sub = data?.subscription || {};
    setSubDraft({
      plan: sub.plan || "trial",
      status: sub.status || "trial",
      billing_cycle: sub.billing_cycle || "monthly",
      expiry_date: sub.expiry_date ? String(sub.expiry_date).slice(0, 10) : "",
      trial_end: sub.trial_end ? String(sub.trial_end).slice(0, 10) : "",
      grace_days: "",
      reason: "",
    });
  };

  const load = useCallback(() => api.get(`/superadmin/clinics/${cid}`).then((r) => syncFromClinic(r.data)), [cid]);
  useEffect(() => { load(); }, [load]);

  const action = async (body, msg, force = false) => {
    setBusy(true);
    try {
      await api.put(`/superadmin/clinics/${cid}/subscription`, { ...body, force_plan_change: force || undefined });
      toast.success(msg);
      setPlanModal(null);
      load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (typeof detail === "object" && detail?.preview) {
        setPlanModal({ plan: body.plan, preview: detail.preview });
      } else {
        toast.error(typeof detail === "string" ? detail : detail?.message || "Failed");
      }
    } finally { setBusy(false); }
  };

  const startPlanChange = async (plan) => {
    setBusy(true);
    try {
      const r = await api.get(`/superadmin/clinics/${cid}/plan-change-preview`, { params: { plan } });
      const preview = r.data;
      if (preview.is_downgrade || preview.blocked || preview.warnings?.length) {
        setPlanModal({ plan, preview });
      } else {
        await action({ plan }, `Plan → ${plan}`);
      }
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const loadReminder = async (type) => {
    setReminderType(type);
    try {
      const r = await api.get(`/superadmin/clinics/${cid}/reminder-text`, { params: { reminder_type: type } });
      setReminderText(r.data.text || "");
    } catch (e) { toast.error("Failed to load reminder"); }
  };

  const markReminderSent = async () => {
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${cid}/mark-reminder-sent`, { reminder_type: reminderType });
      toast.success("Reminder marked as sent");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const resendInvite = async () => {
    if (!window.confirm("Regenerate owner invite credentials?")) return;
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/resend-owner-invite`);
      setTempPassword(r.data);
      toast.success("Invite resent");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const saveLimits = async () => {
    setBusy(true);
    try {
      await api.put(`/superadmin/clinics/${cid}/limits`, {
        max_staff: limitDraft.max_staff === "" ? null : Number(limitDraft.max_staff),
        storage_gb: limitDraft.storage_gb === "" ? null : Number(limitDraft.storage_gb),
      });
      toast.success("Custom limits saved");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const resetPassword = async () => {
    if (!window.confirm("Generate a new temporary password for the clinic owner?")) return;
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/reset-owner-password`);
      setTempPassword(r.data);
      toast.success("Temporary password generated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const impersonate = async () => {
    if (!window.confirm("Open the clinic app as the owner? Your platform session will be saved so you can exit impersonation.")) return;
    setBusy(true);
    try {
      const platformToken = localStorage.getItem("bl_token");
      const r = await api.post(`/superadmin/clinics/${cid}/impersonate`);
      localStorage.setItem("bl_platform_token", platformToken);
      localStorage.setItem("bl_token", r.data.token);
      window.location.href = "/";
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); setBusy(false); }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/superadmin/clinics/${cid}/profile`, {
        name: profileDraft.name,
        slug: profileDraft.slug,
        email: profileDraft.email,
        phone: profileDraft.phone,
        timezone: profileDraft.timezone,
        currency: profileDraft.currency,
        reason: profileDraft.reason || undefined,
      });
      syncFromClinic(r.data);
      toast.success("Clinic profile saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const saveSubscription = async (extra = {}, force = false, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm("Apply subscription changes? This is logged in the audit trail.")) return;
    setBusy(true);
    try {
      const body = {
        plan: subDraft.plan,
        status: subDraft.status,
        billing_cycle: subDraft.billing_cycle,
        expiry_date: subDraft.expiry_date ? `${subDraft.expiry_date}T00:00:00+00:00` : undefined,
        trial_end: subDraft.trial_end ? `${subDraft.trial_end}T00:00:00+00:00` : undefined,
        grace_days: subDraft.grace_days !== "" ? Number(subDraft.grace_days) : undefined,
        reason: subDraft.reason || undefined,
        force_plan_change: force || undefined,
        ...extra,
      };
      const r = await api.put(`/superadmin/clinics/${cid}/subscription`, body);
      syncFromClinic(r.data);
      setPlanModal(null);
      toast.success("Subscription updated");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (typeof detail === "object" && detail?.preview) {
        setPlanModal({ plan: subDraft.plan, preview: detail.preview, fromForm: true });
      } else {
        toast.error(typeof detail === "string" ? detail : detail?.message || "Failed");
      }
    } finally { setBusy(false); }
  };

  const changeOwnerEmail = async (form) => {
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/change-owner-email`, form);
      syncFromClinic(r.data);
      setOwnerEmailModal(false);
      toast.success("Owner email updated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const forceLogoutOwner = async () => {
    if (!window.confirm("Force logout the clinic owner? They will need to sign in again.")) return;
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${cid}/force-logout-owner`);
      toast.success("Owner sessions invalidated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const forceLogoutAll = async () => {
    if (!window.confirm("Force logout ALL users for this clinic?")) return;
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/force-logout-all`);
      toast.success(`Logged out ${r.data.users_affected} user(s)`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const archiveClinic = async (payload) => {
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/archive`, payload);
      syncFromClinic(r.data);
      setArchiveModal(false);
      toast.success("Clinic archived");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const cancelClinic = async (payload) => {
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${cid}/cancel`, payload);
      const r = await api.get(`/superadmin/clinics/${cid}`);
      syncFromClinic(r.data);
      setCancelModal(false);
      toast.success("Clinic cancelled");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const restoreClinic = async () => {
    if (!window.confirm("Restore this archived clinic?")) return;
    setBusy(true);
    try {
      const r = await api.post(`/superadmin/clinics/${cid}/restore`);
      syncFromClinic(r.data);
      toast.success("Clinic restored");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const setTestClinicFlag = async (isTest) => {
    const msg = isTest
      ? "Mark this clinic as test/demo? Permanent delete will become available."
      : "Remove test/demo flag? Permanent delete will be disabled.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await api.put(`/superadmin/clinics/${cid}/test-flag`, { is_test_clinic: isTest });
      syncFromClinic(r.data);
      toast.success(isTest ? "Marked as test/demo clinic" : "Test/demo flag removed");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const permanentDelete = async (payload) => {
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${cid}/delete-permanent`, payload);
      toast.success("Test clinic permanently deleted");
      setDeleteModal(false);
      window.location.href = "/superadmin/clinics";
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const exportClinicData = async ({ confirm_slug, reason, format }) => {
    setBusy(true);
    try {
      const r = await api.post(
        `/superadmin/clinics/${cid}/export`,
        { confirm_slug, reason },
        { params: { format }, responseType: "blob" },
      );
      const ext = format === "xlsx" ? "xlsx" : "zip";
      const blob = new Blob([r.data], { type: r.headers["content-type"] || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clinicos-support-data-${c?.slug || cid}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Support data export downloaded");
      setExportModal(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed");
    } finally { setBusy(false); }
  };

  const resetDemoClinic = async ({ confirm_slug, reason }) => {
    setBusy(true);
    try {
      await api.post(`/superadmin/clinics/${cid}/reset-demo`, { confirm_slug, reason });
      toast.success("Demo data reset");
      setResetDemoModal(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    } finally { setBusy(false); }
  };

  if (!c) return <div className="p-10" style={{ color: "#8FA89E" }}>Loading…</div>;
  const sub = c.subscription || {};
  const usage = c.usage || {};
  const limits = c.limits || {};
  const support = c.support || {};
  const owner = c.owner_account || support.owner || {};
  const staffUsed = usage.staff_count ?? c.staff_count ?? 0;
  const storageUsed = usage.storage_used_gb ?? 0;
  const storageLimit = limits.storage_gb ?? "—";
  const staffLimit = limits.max_staff >= 9999 ? "Unlimited" : (limits.max_staff ?? "—");
  const clinicUrl = `${window.location.origin}/login`;
  const bookingUrl = `${window.location.origin}/book/${c.slug}`;
  const isArchived = sub.status === "archived";
  const isTestClinic = Boolean(c.is_test_clinic);

  return (
    <div className="p-6 md:p-10 max-w-5xl" data-testid="sa-clinic-detail">
      <Link to="/superadmin/clinics" className="text-sm" style={{ color: "#8FA89E" }}>← All clinics</Link>
      <div className="mt-3 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Clinic</div>
          <h1 className="font-display text-3xl mt-1" style={{ color: "#F5F2EA" }}>{c.name}</h1>
          <div className="text-sm mt-1" style={{ color: "#8FA89E" }}>
            /{c.slug} · {c.owner_email} · {c.city || "—"}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to={`/superadmin/payments?clinic=${cid}`} className="text-sm px-3 py-2 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>
            View payments
          </Link>
          <Link to={`/superadmin/audit-log?clinic=${cid}`} className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>
            <History className="w-4 h-4" /> Clinic audit log
          </Link>
        </div>
      </div>

      <SectionCard title="Clinic profile">
        <div className="grid md:grid-cols-2 gap-3 max-w-3xl">
          <Field label="Clinic name" value={profileDraft.name} onChange={(v) => setProfileDraft({ ...profileDraft, name: v })} />
          <Field label="Slug / public URL" value={profileDraft.slug} onChange={(v) => setProfileDraft({ ...profileDraft, slug: v })} />
          <Field label="Primary clinic email" type="email" value={profileDraft.email} onChange={(v) => setProfileDraft({ ...profileDraft, email: v })} />
          <Field label="Clinic phone" value={profileDraft.phone} onChange={(v) => setProfileDraft({ ...profileDraft, phone: v })} />
          <Field label="Timezone" value={profileDraft.timezone} onChange={(v) => setProfileDraft({ ...profileDraft, timezone: v })} />
          <Field label="Currency" value={profileDraft.currency} onChange={(v) => setProfileDraft({ ...profileDraft, currency: v })} />
          <div className="md:col-span-2">
            <div className="text-xs mb-1" style={{ color: "#8FA89E" }}>Subscription status (read-only — change in Subscription section)</div>
            <div className="text-sm capitalize px-3 py-2 rounded-lg inline-block" style={{ background: "#0F1419", color: "#E6E8E6" }}>{sub.status}{isArchived ? " · archived" : ""}</div>
          </div>
          <div className="md:col-span-2">
            <Field label="Change reason (optional)" value={profileDraft.reason} onChange={(v) => setProfileDraft({ ...profileDraft, reason: v })} />
          </div>
        </div>
        <button type="button" onClick={saveProfile} disabled={busy} className="mt-4 text-sm px-4 py-2 rounded-lg text-white" style={{ background: "#3F5A52" }} data-testid="sa-save-profile">Save clinic profile</button>
      </SectionCard>

      <SectionCard title="Owner account">
        <div className="grid md:grid-cols-2 gap-2 text-sm max-w-3xl" style={{ color: "#E6E8E6" }}>
          <div><span style={{ color: "#8FA89E" }}>Name</span><div>{owner.name || c.owner_name || "—"}</div></div>
          <div><span style={{ color: "#8FA89E" }}>Owner login email</span><div>{owner.email || c.owner_email || "—"}</div></div>
          <div><span style={{ color: "#8FA89E" }}>User ID</span><div className="font-mono text-xs">{owner.id || "—"}</div></div>
          <div><span style={{ color: "#8FA89E" }}>Last login</span><div>{fmtDateTime(owner.last_login_at) || "—"}</div></div>
          <div><span style={{ color: "#8FA89E" }}>Account status</span><div className="capitalize">{owner.account_status || "active"}</div></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <BtnAction onClick={() => setOwnerEmailModal(true)} disabled={busy}><Mail className="w-4 h-4" /> Change owner email</BtnAction>
          <BtnAction onClick={resetPassword} disabled={busy} data-testid="sa-reset-owner-password"><KeyRound className="w-4 h-4" /> Generate temp password</BtnAction>
          <BtnAction onClick={resendInvite} disabled={busy}><Mail className="w-4 h-4" /> Resend invite</BtnAction>
          <BtnAction onClick={forceLogoutOwner} disabled={busy}>Force logout owner</BtnAction>
        </div>
        {tempPassword && (
          <div className="mt-4 p-4 rounded-xl text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-temp-password">
            <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Temporary password (shown once)</div>
            <div className="mt-1">Owner: <strong>{tempPassword.owner_email}</strong></div>
            <div className="font-mono mt-1 text-lg" style={{ color: "#D4A373" }}>{tempPassword.temporary_password}</div>
          </div>
        )}
      </SectionCard>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Status" value={sub.status} />
        <Box label="Plan" value={sub.plan} />
        <Box label="Billing period" value={CYCLE_LABEL[sub.billing_cycle] || sub.billing_cycle || "—"} />
        <Box label="Renewal date" value={fmtDate(sub.expiry_date)} />
        <Box label="Trial end" value={fmtDate(sub.trial_end)} />
        <Box label="Created" value={fmtDate(c.created_at)} />
        <Box label="Staff" value={`${staffUsed} / ${staffLimit}`} />
        <Box label="Storage" value={`${storageUsed} GB / ${storageLimit} GB`} />
        <Box label="Patients" value={c.patient_count} />
        <Box label="Visits" value={c.visit_count} />
        <Box label="Invoices" value={c.invoice_count} />
        <Box label="Bookings" value={c.booking_count} />
      </div>

      <SectionCard title="Subscription & limits">
        <div className="grid md:grid-cols-3 gap-3 max-w-4xl">
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Plan</span>
            <select value={subDraft.plan} onChange={(e) => setSubDraft({ ...subDraft, plan: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
              <option value="trial">Trial</option><option value="starter">Starter</option><option value="clinic">Clinic</option><option value="complete">Complete</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Status</span>
            <select value={subDraft.status} onChange={(e) => setSubDraft({ ...subDraft, status: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
              {SUB_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Billing period</span>
            <select value={subDraft.billing_cycle} onChange={(e) => setSubDraft({ ...subDraft, billing_cycle: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}>
              <option value="monthly">Monthly</option><option value="semiannual">6 months</option><option value="annual">Annually</option>
            </select>
          </label>
          <Field label="Renewal date" type="date" value={subDraft.expiry_date} onChange={(v) => setSubDraft({ ...subDraft, expiry_date: v })} />
          <Field label="Trial end" type="date" value={subDraft.trial_end} onChange={(v) => setSubDraft({ ...subDraft, trial_end: v })} />
          <Field label="Grace period (days)" type="number" value={subDraft.grace_days} onChange={(v) => setSubDraft({ ...subDraft, grace_days: v })} />
          <div className="md:col-span-3">
            <Field label="Reason for subscription change" value={subDraft.reason} onChange={(v) => setSubDraft({ ...subDraft, reason: v })} />
          </div>
        </div>
        <div className="mt-3 text-xs" style={{ color: "#8FA89E" }}>Usage: {staffUsed} staff / {storageUsed} GB storage · Limits: {staffLimit} staff / {storageLimit} GB</div>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="sa-clinic-actions">
          <BtnAction onClick={() => saveSubscription()} disabled={busy}>Save subscription</BtnAction>
          <BtnAction onClick={() => action({ extend_days: 14 }, "Trial extended 14 days")} disabled={busy}><Clock className="w-4 h-4" /> Extend trial +14d</BtnAction>
          <BtnAction onClick={() => action({ extend_days: 30 }, "Extended 30 days")} disabled={busy}><RefreshCw className="w-4 h-4" /> Extend +30d</BtnAction>
          <BtnAction onClick={() => startPlanChange("starter")} disabled={busy}>Preview → Starter</BtnAction>
          <BtnAction onClick={() => startPlanChange("clinic")} disabled={busy}>Preview → Clinic</BtnAction>
          <BtnAction onClick={() => startPlanChange("complete")} disabled={busy}>Preview → Complete</BtnAction>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <label className="text-sm">
            <span className="text-xs" style={{ color: "#8FA89E" }}>Custom max staff</span>
            <input type="number" min={1} value={limitDraft.max_staff} onChange={(e) => setLimitDraft({ ...limitDraft, max_staff: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
          </label>
          <label className="text-sm">
            <span className="text-xs" style={{ color: "#8FA89E" }}>Custom storage (GB)</span>
            <input type="number" min={1} value={limitDraft.storage_gb} onChange={(e) => setLimitDraft({ ...limitDraft, storage_gb: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
          </label>
        </div>
        <button type="button" onClick={saveLimits} disabled={busy} className="mt-3 text-sm px-4 py-2 rounded-lg text-white" style={{ background: "#3F5A52" }} data-testid="sa-save-limits">Save custom limits</button>
      </SectionCard>

      <SectionCard title="Support actions">
        <div className="flex flex-wrap gap-2">
          <BtnAction onClick={impersonate} disabled={busy || isArchived} data-testid="sa-impersonate"><UserCheck className="w-4 h-4" /> Impersonate owner</BtnAction>
          <BtnAction onClick={forceLogoutAll} disabled={busy}>Force logout all users</BtnAction>
          <BtnAction onClick={() => copyText(clinicUrl, "Clinic login URL")} disabled={busy}><Copy className="w-4 h-4" /> Copy clinic URL</BtnAction>
          <BtnAction onClick={() => copyText(bookingUrl, "Booking URL")} disabled={busy}><ExternalLink className="w-4 h-4" /> Copy booking URL</BtnAction>
          <a href={`/book/${c.slug}`} target="_blank" rel="noreferrer" className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5" style={{ background: "#1A242B", color: "#8AA992", border: "1px solid #2A3942" }}>Open public booking</a>
          <Link to={`/superadmin/payments?clinic=${cid}`} className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>View payments</Link>
          <BtnAction onClick={() => setExportModal(true)} disabled={busy} data-testid="sa-export-support-data"><Download className="w-4 h-4" /> Export support data</BtnAction>
        </div>
      </SectionCard>

      <SectionCard title="Danger zone" danger>
        <p className="text-sm mb-4" style={{ color: "#C7D1CB" }}>Suspend blocks login. Archive hides the clinic from the default list. Permanent delete is only available for test/demo clinics.</p>
        <label className="flex items-center gap-3 text-sm mb-4 cursor-pointer" style={{ color: "#E6E8E6" }}>
          <input
            type="checkbox"
            checked={isTestClinic}
            onChange={(e) => setTestClinicFlag(e.target.checked)}
            disabled={busy}
            data-testid="sa-test-clinic-toggle"
          />
          <span>
            <strong>Test / Demo clinic</strong>
            <span className="block text-xs mt-0.5" style={{ color: "#8FA89E" }}>Required to enable permanent deletion. Never enable for production tenants.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          {sub.status !== "suspended" && !isArchived && (
            <BtnAction onClick={() => action({ status: "suspended" }, "Clinic suspended")} disabled={busy} data-testid="sa-action-suspend"><XCircle className="w-4 h-4" /> Suspend clinic</BtnAction>
          )}
          {sub.status === "suspended" && (
            <BtnAction onClick={() => action({ status: "active" }, "Clinic reactivated")} disabled={busy} data-testid="sa-action-activate"><CheckCircle2 className="w-4 h-4" /> Reactivate clinic</BtnAction>
          )}
          {!isArchived && sub.status !== "cancelled" && (
            <BtnAction onClick={() => setCancelModal(true)} disabled={busy} style={{ color: "#D58B6B" }}>Cancel subscription</BtnAction>
          )}
          {!isArchived && (
            <BtnAction onClick={() => setArchiveModal(true)} disabled={busy}>Archive clinic</BtnAction>
          )}
          {isArchived && (
            <BtnAction onClick={restoreClinic} disabled={busy}><CheckCircle2 className="w-4 h-4" /> Restore archived clinic</BtnAction>
          )}
          {isTestClinic ? (
            <>
              <BtnAction onClick={() => setResetDemoModal(true)} disabled={busy} data-testid="sa-reset-demo"><RefreshCw className="w-4 h-4" /> Reset demo data</BtnAction>
              <BtnAction onClick={() => setDeleteModal(true)} disabled={busy} style={{ color: "#D58B6B" }} data-testid="sa-delete-permanent">Delete permanently</BtnAction>
            </>
          ) : (
            <span className="text-xs self-center px-2" style={{ color: "#8FA89E" }} title="Enable Test / Demo clinic to unlock permanent delete">
              Delete permanently (test clinics only)
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Payment reminders">
        <div className="mt-3 flex flex-wrap gap-2">
          <BtnAction onClick={() => loadReminder("renewal")} disabled={busy}><MessageCircle className="w-4 h-4" /> WhatsApp renewal</BtnAction>
          <BtnAction onClick={() => loadReminder("payment_due")} disabled={busy}><MessageCircle className="w-4 h-4" /> Payment due</BtnAction>
          {reminderText && (
            <>
              <BtnAction onClick={() => copyText(reminderText, "Reminder")} disabled={busy}><Copy className="w-4 h-4" /> Copy message</BtnAction>
              <BtnAction onClick={markReminderSent} disabled={busy}>Mark sent</BtnAction>
            </>
          )}
        </div>
        {support.reminder_sent_at && (
          <div className="mt-2 text-xs" style={{ color: "#8FA89E" }}>
            Last sent {fmtDateTime(support.reminder_sent_at)} by {support.reminder_sent_by || "—"} ({support.reminder_type || "—"})
          </div>
        )}
        {reminderText && (
          <textarea readOnly value={reminderText} rows={4} className="mt-3 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        )}
      </SectionCard>

      <SectionCard title="Support panel">
        <div className="mt-4 grid md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs mb-2" style={{ color: "#8FA89E" }}>Recent logins</div>
            <ul className="space-y-1 text-sm" style={{ color: "#E6E8E6" }}>
              {(support.recent_logins || []).slice(0, 5).map((l, i) => (
                <li key={i} className="text-xs">{fmtDateTime(l.created_at)} · {l.user_email || "—"}</li>
              ))}
              {!(support.recent_logins || []).length && <li className="text-xs" style={{ color: "#8FA89E" }}>No login events</li>}
            </ul>
          </div>
          <div>
            <div className="text-xs mb-2" style={{ color: "#8FA89E" }}>Staff summary</div>
            <ul className="space-y-1 text-sm max-h-32 overflow-y-auto" style={{ color: "#E6E8E6" }}>
              {(support.staff_summary || []).map((u, i) => (
                <li key={i} className="text-xs capitalize">{u.name} · {u.role} · {u.email}</li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs mb-2" style={{ color: "#8FA89E" }}>Subscription timeline</div>
            <ul className="space-y-1 text-sm" style={{ color: "#E6E8E6" }}>
              {(support.subscription_timeline || []).slice(0, 8).map((t, i) => (
                <li key={i} className="text-xs capitalize">{fmtDateTime(t.at)} · {t.event}{t.by ? ` · ${t.by}` : ""}</li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs mb-2" style={{ color: "#8FA89E" }}>Recent audit events</div>
            <ul className="space-y-1 text-sm max-h-40 overflow-y-auto" style={{ color: "#E6E8E6" }}>
              {(support.recent_audit || []).slice(0, 10).map((a, i) => (
                <li key={i} className="text-xs capitalize">{fmtDateTime(a.created_at)} · {(a.action || "").replace(/_/g, " ")} · {a.user_email || "—"}</li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent payment requests">
        {(c.recent_payments || []).length === 0 ? (
          <div className="mt-3 text-sm" style={{ color: "#8FA89E" }}>No payment requests yet.</div>
        ) : (
          <ul className="mt-3 space-y-2">
            {c.recent_payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm gap-3" style={{ color: "#E6E8E6" }}>
                <span>{p.plan} · {CYCLE_LABEL[p.billing_cycle] || p.billing_cycle} · {fmtIDR(p.amount_idr)} · +{p.unique_code}</span>
                <span className="text-xs uppercase tracking-widest shrink-0" style={{ color: STATUS_DOT[p.status] || "#8AA992" }}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {ownerEmailModal && (
        <ChangeOwnerEmailModal onClose={() => setOwnerEmailModal(false)} onSubmit={changeOwnerEmail} busy={busy} />
      )}
      {archiveModal && (
        <ChurnReasonModal title="Archive clinic" confirmLabel="Archive" onClose={() => setArchiveModal(false)} onSubmit={archiveClinic} busy={busy} />
      )}
      {cancelModal && (
        <ChurnReasonModal title="Cancel clinic subscription" confirmLabel="Cancel" onClose={() => setCancelModal(false)} onSubmit={cancelClinic} busy={busy} />
      )}
      {deleteModal && (
        <PermanentDeleteModal clinic={c} onClose={() => setDeleteModal(false)} onSubmit={permanentDelete} busy={busy} />
      )}
      {exportModal && (
        <ExportClinicModal clinic={c} onClose={() => setExportModal(false)} onSubmit={exportClinicData} busy={busy} />
      )}
      {resetDemoModal && (
        <DemoResetModal clinic={c} onClose={() => setResetDemoModal(false)} onSubmit={resetDemoClinic} busy={busy} />
      )}
      {planModal && (
        <PlanChangeModal
          plan={planModal.plan}
          preview={planModal.preview}
          onClose={() => setPlanModal(null)}
          onConfirm={(force) => {
            if (planModal.fromForm) {
              setSubDraft((d) => ({ ...d, plan: planModal.plan }));
              saveSubscription({ plan: planModal.plan, force_plan_change: force }, force, true);
            } else {
              action({ plan: planModal.plan }, `Plan → ${planModal.plan}`, force);
            }
          }}
          busy={busy}
        />
      )}
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
function ProofViewer({ payment, onClose }) {
  const url = payment.proof_path ? fileUrl(payment.proof_path) : null;
  const isPdf = (payment.proof_content_type || "").includes("pdf");
  const baseAmount = Number(payment.amount_idr || 0) - Number(payment.unique_code || 0);
  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 backdrop-blur-sm flex items-center justify-center p-4" data-testid="sa-proof-viewer">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "#1F2A30" }}>
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Payment proof</div>
            <div className="font-display text-xl mt-0.5" style={{ color: "#F5F2EA" }}>{payment.clinic_name}</div>
            <div className="text-xs mt-1 space-y-0.5" style={{ color: "#8FA89E" }}>
              <div>{payment.plan} · {CYCLE_LABEL[payment.billing_cycle] || payment.billing_cycle || "—"}</div>
              <div>Total {fmtIDR(payment.amount_idr)} · base {fmtIDR(baseAmount)} · +{payment.unique_code}</div>
              <div>Submitted {fmtDateTime(payment.created_at)} · {payment.status}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#1A242B]" style={{ color: "#E6E8E6" }} data-testid="sa-proof-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-5" style={{ background: "#0F1419" }}>
          {!url ? (
            <div className="py-16 text-center text-sm" style={{ color: "#8FA89E" }}>No proof file uploaded for this payment.</div>
          ) : isPdf ? (
            <iframe src={url} className="w-full h-[60vh] rounded-lg" title="proof" data-testid="sa-proof-pdf" />
          ) : (
            <img src={url} alt="payment proof" className="w-full rounded-lg" data-testid="sa-proof-image" />
          )}
        </div>
      </div>
    </div>
  );
}

function RejectPaymentModal({ payment, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [clarify, setClarify] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("Rejection reason is required");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/superadmin/payments/${payment.id}/reject`, {
        reason: reason.trim(),
        request_clarification: clarify,
      });
      toast.success(clarify ? "Clarification requested" : "Payment rejected");
      onDone();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F1419]/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="font-display text-lg" style={{ color: "#F5F2EA" }}>{clarify ? "Request clarification" : "Reject payment"}</div>
        <p className="text-sm mt-1" style={{ color: "#8FA89E" }}>{payment.clinic_name} · {fmtIDR(payment.amount_idr)}</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" className="mt-4 w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }} />
        <label className="mt-3 flex items-center gap-2 text-sm" style={{ color: "#C7D1CB" }}>
          <input type="checkbox" checked={clarify} onChange={(e) => setClarify(e.target.checked)} />
          Request clarification instead of final rejection
        </label>
        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm" style={{ color: "#8FA89E" }}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: "#5C2E1F" }}>{busy ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function SaPaymentsPage() {
  const [searchParams] = useSearchParams();
  const clinicFilter = searchParams.get("clinic") || "";
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("submitted");
  const [viewing, setViewing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const load = useCallback(
    () => api.get("/superadmin/payments", {
      params: { status: status || undefined, clinic: clinicFilter || undefined },
    }).then((r) => setRows(r.data || [])),
    [status, clinicFilter],
  );
  useEffect(() => { load(); }, [load]);

  const verify = async (id) => {
    if (!window.confirm("Approve this payment and activate/renew the clinic subscription?")) return;
    try {
      await api.post(`/superadmin/payments/${id}/verify`);
      toast.success("Payment approved & subscription updated");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Verification queue</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Payments</h1>
          {clinicFilter && (
            <div className="text-xs mt-1" style={{ color: "#8FA89E" }}>
              Filtered by clinic · <Link to="/superadmin/payments" className="underline">Clear filter</Link>
            </div>
          )}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }} data-testid="sa-payments-filter">
          <option value="submitted">Submitted</option>
          <option value="needs_clarification">Needs clarification</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="mt-6 rounded-2xl overflow-x-auto" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <table className="w-full text-sm min-w-[960px]" data-testid="sa-payments-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={{ color: "#8FA89E" }}>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Clinic</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Plan</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Period</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Amount</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Code</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Submitted</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center" style={{ color: "#8FA89E" }}>No payments here.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-t" style={{ borderColor: "#1F2A30" }} data-testid={`sa-payment-row-${p.id}`}>
                <td className="px-5 py-3">
                  <Link to={`/superadmin/clinics/${p.clinic_id}`} className="font-medium hover:underline" style={{ color: "#F5F2EA" }}>{p.clinic_name || "—"}</Link>
                  <div className="text-xs" style={{ color: "#8FA89E" }}>{p.owner_email || ""}</div>
                </td>
                <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{p.plan}</td>
                <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{CYCLE_LABEL[p.billing_cycle] || p.billing_cycle || "—"}</td>
                <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{fmtIDR(p.amount_idr)}</td>
                <td className="px-5 py-3 font-mono" style={{ color: "#E6E8E6" }}>+{p.unique_code}</td>
                <td className="px-5 py-3 text-xs" style={{ color: "#8FA89E" }}>{fmtDateTime(p.created_at)}</td>
                <td className="px-5 py-3 capitalize">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[p.status] || "#8FA89E" }} />
                    {(p.status || "").replace("_", " ")}
                  </span>
                  {p.rejection_reason && <div className="text-xs mt-0.5 max-w-[180px] truncate" style={{ color: "#8FA89E" }} title={p.rejection_reason}>{p.rejection_reason}</div>}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-2 flex-wrap">
                    {p.proof_path && (
                      <button type="button" onClick={() => setViewing(p)} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }} data-testid={`sa-view-proof-${p.id}`}>
                        <Eye className="w-3.5 h-3.5" /> Proof
                      </button>
                    )}
                    {(p.status === "submitted" || p.status === "needs_clarification") && (
                      <>
                        <button type="button" onClick={() => verify(p.id)} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: "#3F5A52", color: "#fff" }} data-testid={`sa-verify-${p.id}`}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button type="button" onClick={() => setRejecting(p)} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: "#5C2E1F", color: "#fff" }} data-testid={`sa-reject-${p.id}`}>
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && <ProofViewer payment={viewing} onClose={() => setViewing(null)} />}
      {rejecting && <RejectPaymentModal payment={rejecting} onClose={() => setRejecting(null)} onDone={load} />}
    </div>
  );
}

function SaAuditLogPage() {
  const [searchParams] = useSearchParams();
  const clinicFilter = searchParams.get("clinic") || "";
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get("/superadmin/audit-log", { params: { limit: 200, clinic_id: clinicFilter || undefined } })
      .then((r) => setRows(r.data || []));
  }, [clinicFilter]);
  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Platform activity</div>
      <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Audit log</h1>
      {clinicFilter && (
        <div className="text-xs mt-1" style={{ color: "#8FA89E" }}>
          Filtered by clinic · <Link to="/superadmin/audit-log" className="underline">Show all</Link>
        </div>
      )}
      <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <table className="w-full text-sm" data-testid="sa-audit-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={{ color: "#8FA89E" }}>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">When</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Action</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Clinic</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">User</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center" style={{ color: "#8FA89E" }}>No audit entries yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id || `${r.created_at}-${r.action}`} className="border-t" style={{ borderColor: "#1F2A30" }}>
                <td className="px-5 py-3 text-xs whitespace-nowrap" style={{ color: "#8FA89E" }}>{fmtDateTime(r.created_at)}</td>
                <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{(r.action || "").replace(/_/g, " ")}</td>
                <td className="px-5 py-3" style={{ color: "#E6E8E6" }}>{r.clinic_name || r.clinic_id || "—"}</td>
                <td className="px-5 py-3 text-xs" style={{ color: "#8FA89E" }}>{r.user_email || "—"}</td>
                <td className="px-5 py-3 text-xs max-w-xs truncate" style={{ color: "#C7D1CB" }} title={r.reason || JSON.stringify(r.new_value || r.meta || "")}>
                  {r.reason || r.record_id || "—"}
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
function targetLabel(r) {
  const t = r.target_type || r.audience || "all";
  if (t === "clinic") return `Clinic: ${r.target_clinic_id || (r.target_clinic_ids || [])[0] || "—"}`;
  if (t === "plan") return `Plan: ${r.target_plan || r.audience}`;
  if (t === "status") return `Status: ${r.target_status || r.audience}`;
  return "All clinics";
}

function SaAnnouncementsPage() {
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState({
    title: "", body: "", severity: "info", target_type: "all",
    target_clinic_id: "", target_plan: "starter", target_status: "trial", active: true, status: "published",
  });
  const load = () => api.get("/superadmin/announcements").then(r => setRows(r.data || []));
  useEffect(() => {
    load();
    api.get("/superadmin/clinics").then((r) => setClinics(r.data || [])).catch(() => {});
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form };
    if (payload.target_type !== "clinic") delete payload.target_clinic_id;
    if (payload.target_type !== "plan") delete payload.target_plan;
    if (payload.target_type !== "status") delete payload.target_status;
    await api.post("/superadmin/announcements", payload);
    setForm({ title: "", body: "", severity: "info", target_type: "all", target_clinic_id: "", target_plan: "starter", target_status: "trial", active: true, status: "published" });
    toast.success("Announcement created");
    load();
  };
  const publish = async (id) => {
    await api.post(`/superadmin/announcements/${id}/publish`);
    toast.success("Published");
    load();
  };
  const archive = async (id) => {
    await api.post(`/superadmin/announcements/${id}/archive`);
    toast.success("Archived");
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
          <select value={form.target_type} onChange={e => setForm({ ...form, target_type: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="all">All clinics</option>
            <option value="clinic">Specific clinic</option>
            <option value="plan">By plan</option>
            <option value="status">By status</option>
          </select>
        </div>
        {form.target_type === "clinic" && (
          <select value={form.target_clinic_id} onChange={e => setForm({ ...form, target_clinic_id: e.target.value })} required className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="">Select clinic</option>
            {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {form.target_type === "plan" && (
          <select value={form.target_plan} onChange={e => setForm({ ...form, target_plan: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="trial">Trial</option><option value="starter">Starter</option><option value="clinic">Clinic</option><option value="complete">Complete</option>
          </select>
        )}
        {form.target_type === "status" && (
          <select value={form.target_status} onChange={e => setForm({ ...form, target_status: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" }}>
            <option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="expired">Expired</option>
          </select>
        )}
        <button type="submit" className="px-4 py-2 rounded-lg text-white text-sm" style={{ background: "#3F5A52" }} data-testid="sa-ann-submit">Create announcement</button>
      </form>

      <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <table className="w-full text-sm" data-testid="sa-announcements-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={{ color: "#8FA89E" }}>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Title</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Type</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Target</th>
              <th className="px-5 py-3 uppercase text-xs tracking-widest">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center" style={{ color: "#8FA89E" }}>No announcements yet.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: "#1F2A30" }} data-testid={`sa-ann-row-${r.id}`}>
                <td className="px-5 py-3">
                  <div style={{ color: "#F5F2EA" }}>{r.title}</div>
                  <div className="text-xs mt-1 max-w-md truncate" style={{ color: "#8FA89E" }}>{r.body}</div>
                </td>
                <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{r.severity}</td>
                <td className="px-5 py-3 text-xs" style={{ color: "#8FA89E" }}>{targetLabel(r)}</td>
                <td className="px-5 py-3 capitalize" style={{ color: "#E6E8E6" }}>{r.status || (r.active ? "published" : "draft")}</td>
                <td className="px-5 py-3 text-right space-x-2">
                  {r.status === "archived" ? (
                    <button type="button" onClick={() => publish(r.id)} className="text-xs px-2 py-1 rounded" style={{ color: "#8AA992" }}>Publish</button>
                  ) : (
                    <button type="button" onClick={() => archive(r.id)} className="text-xs px-2 py-1 rounded" style={{ color: "#D8B96B" }}>Archive</button>
                  )}
                  <button type="button" onClick={() => del(r.id)} className="text-xs px-2 py-1 rounded" style={{ color: "#D58B6B" }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SaNotificationsPage() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const load = () => api.get("/superadmin/notifications", { params: { limit: 100 } }).then((r) => {
    setItems(r.data?.items || []);
    setUnread(r.data?.unread_count || 0);
  });
  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    await api.post(`/superadmin/notifications/${id}/read`);
    load();
  };
  const markAll = async () => {
    await api.post("/superadmin/notifications/read-all");
    load();
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Platform alerts</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Notifications</h1>
        </div>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="text-sm px-3 py-2 rounded-lg" style={{ background: "#1A242B", color: "#E6E8E6" }}>
            Mark all read ({unread})
          </button>
        )}
      </div>
      <ul className="mt-6 space-y-2">
        {items.length === 0 && <li className="text-sm py-10 text-center" style={{ color: "#8FA89E" }}>No notifications yet.</li>}
        {items.map((n) => (
          <li
            key={n.id}
            className="p-4 rounded-xl flex items-start gap-3"
            style={{
              background: n.read_at ? "#141B22" : "#1A242B",
              border: `1px solid ${n.read_at ? "#1F2A30" : "#2A3942"}`,
              opacity: n.read_at ? 0.75 : 1,
            }}
            data-testid={`sa-notification-${n.id}`}
          >
            <Bell className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#8AA992" }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: "#F5F2EA" }}>{n.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "#8FA89E" }}>{fmtDateTime(n.created_at)} · {n.type?.replace(/_/g, " ")}</div>
              <div className="text-sm mt-1" style={{ color: "#E6E8E6" }}>{n.body}</div>
              {n.link && (
                <Link to={n.link} className="text-xs mt-2 inline-block" style={{ color: "#8AA992" }} onClick={() => !n.read_at && markRead(n.id)}>
                  View →
                </Link>
              )}
            </div>
            {!n.read_at && (
              <button type="button" onClick={() => markRead(n.id)} className="text-xs px-2 py-1 rounded shrink-0" style={{ color: "#8FA89E" }}>Mark read</button>
            )}
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
        <Route path="clinics/new" element={<RequireSuperAdmin><SaCreateClinicPage /></RequireSuperAdmin>} />
        <Route path="clinics/:cid" element={<RequireSuperAdmin><SaClinicDetailPage /></RequireSuperAdmin>} />
        <Route path="payments" element={<RequireSuperAdmin><SaPaymentsPage /></RequireSuperAdmin>} />
        <Route path="customers" element={<RequireSuperAdmin><SaCustomerLifecyclePage /></RequireSuperAdmin>} />
        <Route path="notifications" element={<RequireSuperAdmin><SaNotificationsPage /></RequireSuperAdmin>} />
        <Route path="ops" element={<RequireSuperAdmin><SaPlatformOpsPage /></RequireSuperAdmin>} />
        <Route path="qa-cleanup" element={<RequireSuperAdmin><SaQaCleanupPage /></RequireSuperAdmin>} />
        <Route path="audit-log" element={<RequireSuperAdmin><SaAuditLogPage /></RequireSuperAdmin>} />
        <Route path="announcements" element={<RequireSuperAdmin><SaAnnouncementsPage /></RequireSuperAdmin>} />
        <Route path="settings" element={<RequireSuperAdmin><SaSettingsPage /></RequireSuperAdmin>} />
        <Route path="account" element={<RequireSuperAdmin><SaAccountSettingsPage /></RequireSuperAdmin>} />
      </Routes>
    </SuperAdminAuthProvider>
  );
}
