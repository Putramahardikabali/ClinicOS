import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useClinic, formatIdr, hasFeature } from "@/lib/clinic";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, CalendarCheck, Stethoscope, Receipt,
  FileText, Shield, Package, Wallet, AlertTriangle, UserPlus, BarChart3,
  Calendar, ArrowRight, ScrollText, ChevronDown, MoreHorizontal,
} from "lucide-react";

const COLORS = ["#52796F", "#84A98C", "#354F52", "#CAD2C5", "#6B9080", "#A8C5B8"];

const fmtShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};

function KpiCard({ icon: Icon, label, value, helper, trend, testid }) {
  const trendUp = typeof trend === "number" && trend >= 0;
  return (
    <div className="bl-card p-4 sm:p-5" data-testid={testid}>
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#EDF3EF] text-[#52796F]">
          <Icon className="w-4 h-4" strokeWidth={1.6} />
        </div>
        <div className="label-eyebrow">{label}</div>
      </div>
      <div className="mt-2 font-display text-2xl sm:text-3xl text-[#2D3A33] tabular-nums">{value}</div>
      {helper && <div className="text-xs text-[#5C6C62] mt-0.5">{helper}</div>}
      {typeof trend === "number" && (
        <div className={`text-xs mt-1 flex items-center gap-0.5 ${trendUp ? "text-[#52796F]" : "text-[#B14A2C]"}`}>
          {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trendUp ? "+" : ""}{trend}% vs yesterday
        </div>
      )}
    </div>
  );
}

function OverviewPill({ label, value, accent }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${accent || "bg-[#F8F5EC]"}`}>
      <div className="text-xs uppercase tracking-widest text-[#5C6C62]">{label}</div>
      <div className="font-display text-2xl text-[#2D3A33] mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function AlertRow({ alert }) {
  const sev = alert.severity === "high" ? "border-[#E8C4B8] bg-[#FBF5F0]" : alert.severity === "warning" ? "border-[#E8DFC4] bg-[#FBF8F0]" : "border-[#EAE6D7] bg-[#F8F5EC]";
  return (
    <Link
      to={alert.link || "#"}
      className={`flex items-center justify-between px-4 py-3 rounded-lg border transition hover:opacity-90 ${sev}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 text-[#8A6D1F]" />
        <span className="text-sm text-[#2D3A33] truncate">{alert.label}</span>
      </div>
      <ArrowRight className="w-4 h-4 text-[#5C6C62] shrink-0" />
    </Link>
  );
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const showReports = hasFeature(clinic, "reports");
  const showBilling = hasFeature(clinic, "billing");

  useEffect(() => {
    setLoading(true);
    api.get("/dashboard/operations")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const k = data?.kpis || {};
  const ov = data?.clinic_overview || {};
  const charts = data?.charts || {};
  const staff = data?.staff_performance || {};

  const revenueTrend = (charts.revenue_last_7_days || []).map((r) => ({
    label: (r.date || "").slice(5),
    revenue: r.revenue_idr,
  }));
  const statusBreakdown = [
    ...(charts.booking_status_breakdown || []).map((r) => ({
      name: `Appt: ${String(r.status).replace(/_/g, " ")}`,
      count: r.count,
    })),
    ...(charts.visit_status_breakdown || []).map((r) => ({
      name: `Visit: ${String(r.status).replace(/_/g, " ")}`,
      count: r.count,
    })),
  ];
  const topTreatments = (charts.top_treatments_by_count || []).map((r) => ({
    name: r.name?.length > 18 ? `${r.name.slice(0, 16)}…` : r.name,
    count: r.count,
  }));
  const payMethods = (charts.revenue_by_payment_method || []).map((r) => ({
    name: String(r.method || "other").replace(/_/g, " "),
    value: r.revenue_idr,
  }));

  const todayLabel = data?.date
    ? new Date(data.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })
    : new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });

  if (loading) {
    return <div className="p-10 text-center text-[#5C6C62]">Loading clinic overview…</div>;
  }

  return (
    <div data-testid="manager-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-eyebrow">Clinic operations</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
            Hello, <span style={{ color: "var(--bl-primary)" }}>{user?.name?.split(" ")[0]}</span>
          </h1>
          <p className="mt-2 text-[#5C6C62]">{todayLabel} · clinic-wide overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/front-desk" className="bl-btn-secondary text-sm inline-flex items-center gap-1.5" data-testid="qa-front-desk">
            <CalendarCheck className="w-4 h-4" /> Today operations
          </Link>
          <Link to="/bookings" className="bl-btn-primary text-sm inline-flex items-center gap-1.5" data-testid="qa-new-booking">
            <CalendarCheck className="w-4 h-4" /> New booking
          </Link>
          <Link to="/staff/schedule" className="bl-btn-secondary text-sm inline-flex items-center gap-1.5" data-testid="qa-schedule">
            <Calendar className="w-4 h-4" /> Schedule
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="bl-btn-secondary text-sm inline-flex items-center gap-1.5"
                data-testid="qa-more-actions"
              >
                <MoreHorizontal className="w-4 h-4" />
                More actions
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[12rem] bg-white border-[#EAE6D7] text-[#2D3A33] shadow-lg"
            >
              {showReports && (
                <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                  <Link to="/reports" className="flex items-center gap-2 w-full" data-testid="qa-reports">
                    <BarChart3 className="w-4 h-4 text-[#5C6C62]" />
                    Reports
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                <Link to="/patients" className="flex items-center gap-2 w-full" data-testid="qa-new-patient">
                  <UserPlus className="w-4 h-4 text-[#5C6C62]" />
                  New patient
                </Link>
              </DropdownMenuItem>
              {showBilling && (
                <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                  <Link to="/invoices" className="flex items-center gap-2 w-full" data-testid="qa-outstanding">
                    <Receipt className="w-4 h-4 text-[#5C6C62]" />
                    Outstanding payments
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                <Link to="/visits" className="flex items-center gap-2 w-full" data-testid="qa-notes">
                  <FileText className="w-4 h-4 text-[#5C6C62]" />
                  Pending notes
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Wallet} label="Revenue today" value={formatIdr(k.revenue_today_idr)} helper="Paid invoices only" trend={k.revenue_today_trend_pct} testid="kpi-revenue-today" />
        <KpiCard icon={CalendarCheck} label="Bookings today" value={k.bookings_today ?? 0} helper="All appointments today" trend={k.bookings_today_trend_pct} testid="kpi-bookings-today" />
        <KpiCard icon={Stethoscope} label="Completed visits" value={k.visits_completed_today ?? 0} helper="Finished today" trend={k.visits_completed_today_trend_pct} testid="kpi-visits-completed" />
        <KpiCard icon={Receipt} label="Outstanding" value={formatIdr(k.outstanding_payment_idr)} helper="Unpaid + partial balances" testid="kpi-outstanding" />
        <KpiCard icon={FileText} label="Pending notes" value={k.pending_clinical_notes ?? 0} helper="Completed visits missing notes" testid="kpi-pending-notes" />
        <KpiCard icon={Shield} label="Pending consent" value={k.pending_consent ?? 0} helper="Not sent or awaiting signature" testid="kpi-pending-consent" />
        <KpiCard icon={Package} label="Active packages" value={k.active_packages ?? 0} helper="Active or partially used" testid="kpi-active-packages" />
        <KpiCard icon={Wallet} label="Commission unpaid" value={formatIdr(k.commission_approved_unpaid_idr)} helper="Approved, not paid out" testid="kpi-commission-unpaid" />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bl-card p-4">
          <h3 className="font-display text-base text-[#2D3A33]">Revenue — last 7 days</h3>
          <p className="text-xs text-[#5C6C62] mb-3">Paid invoice cash revenue</p>
          {revenueTrend.length ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={revenueTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5C6C62" }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "#5C6C62" }} width={48} />
                  <Tooltip formatter={(v) => formatIdr(v)} />
                  <Line type="monotone" dataKey="revenue" stroke="#52796F" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[#5C6C62] py-10 text-center">No revenue in this period.</p>
          )}
        </div>
        <div className="bl-card p-4">
          <h3 className="font-display text-base text-[#2D3A33]">Booking & visit status (7 days)</h3>
          <p className="text-xs text-[#5C6C62] mb-3">Clinic-wide counts</p>
          {statusBreakdown.length ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#84A98C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[#5C6C62] py-10 text-center">No activity in this period.</p>
          )}
        </div>
      </div>

      <div className="mt-8 bl-card p-5">
        <h2 className="font-display text-xl text-[#2D3A33]">Today&apos;s clinic overview</h2>
        <p className="text-sm text-[#5C6C62] mt-1">All bookings and visits scheduled for today</p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <OverviewPill label="Total bookings" value={ov.total_bookings ?? 0} />
          <OverviewPill label="Confirmed" value={ov.confirmed ?? 0} accent="bg-[#EDF3EF]" />
          <OverviewPill label="Arrived" value={ov.arrived ?? 0} />
          <OverviewPill label="In treatment" value={ov.in_treatment ?? 0} accent="bg-[#E5EEF5]" />
          <OverviewPill label="Completed" value={ov.completed ?? 0} accent="bg-[#EDF3EF]" />
          <OverviewPill label="Cancelled" value={ov.cancelled ?? 0} />
          <OverviewPill label="No-show" value={ov.no_show ?? 0} />
        </div>
        {(ov.booked_pending ?? 0) > 0 && (
          <p className="mt-3 text-sm text-[#8A6D1F]">{ov.booked_pending} booking(s) still need confirmation.</p>
        )}
        <Link to="/bookings" className="inline-block mt-3 text-sm" style={{ color: "var(--bl-primary)" }}>Open bookings →</Link>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bl-card p-5">
          <h2 className="font-display text-lg text-[#2D3A33]">Action required</h2>
          <div className="mt-3 space-y-2">
            {(data?.alerts || []).length === 0 ? (
              <p className="text-sm text-[#5C6C62] py-6 text-center">No alerts — operations look good.</p>
            ) : (
              data.alerts.map((a) => <AlertRow key={a.id} alert={a} />)
            )}
          </div>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Top treatments (7d)</h3>
            {topTreatments.length ? (
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={topTreatments}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" height={48} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#52796F" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-[#5C6C62] py-8 text-center">No treatments yet.</p>
            )}
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Revenue by payment method (7d)</h3>
            {payMethods.length ? (
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={payMethods} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                      {payMethods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatIdr(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-[#5C6C62] py-8 text-center">No payments yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bl-card p-5">
          <h2 className="font-display text-lg text-[#2D3A33]">Staff performance today</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="label-eyebrow mb-2">Bookings by performer</div>
              <ul className="space-y-1.5 text-sm">
                {(staff.bookings_by_performer || []).slice(0, 8).map((r, i) => (
                  <li key={i} className="flex justify-between"><span className="text-[#5C6C62] truncate">{r.performer}</span><span>{r.count}</span></li>
                ))}
                {!(staff.bookings_by_performer || []).length && <li className="text-[#5C6C62]">No bookings today.</li>}
              </ul>
            </div>
            <div>
              <div className="label-eyebrow mb-2">Visits by performer</div>
              <ul className="space-y-1.5 text-sm">
                {(staff.visits_by_performer || []).slice(0, 8).map((r, i) => (
                  <li key={i} className="flex justify-between"><span className="text-[#5C6C62] truncate">{r.performer}</span><span>{r.count}</span></li>
                ))}
                {!(staff.visits_by_performer || []).length && <li className="text-[#5C6C62]">No visits today.</li>}
              </ul>
            </div>
          </div>
          {(staff.workload_by_role || []).length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#EAE6D7]">
              <div className="label-eyebrow mb-2">Workload by role (bookings)</div>
              <div className="flex flex-wrap gap-2">
                {staff.workload_by_role.map((r) => (
                  <span key={r.role} className="bl-chip capitalize">{r.role}: {r.bookings}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bl-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg text-[#2D3A33]">Recent activity</h2>
            <Link to="/audit" className="text-sm" style={{ color: "var(--bl-primary)" }}>Audit log →</Link>
          </div>
          <ul className="space-y-2 text-sm">
            {(data?.audit_highlights || []).length === 0 ? (
              <li className="text-[#5C6C62] py-4 text-center">No recent audit events.</li>
            ) : (
              data.audit_highlights.map((a, i) => (
                <li key={i} className="flex gap-2 items-start border-b border-[#EAE6D7] pb-2 last:border-0">
                  <ScrollText className="w-4 h-4 text-[#5C6C62] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[#2D3A33] capitalize">{a.action} · {a.module}</div>
                    <div className="text-xs text-[#5C6C62]">{a.user} · {a.time}</div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
