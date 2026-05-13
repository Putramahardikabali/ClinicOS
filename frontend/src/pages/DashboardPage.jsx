import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { useClinic, formatIdr } from "@/lib/clinic";
import { Link } from "react-router-dom";
import {
  Users, Stethoscope, Activity, Calendar, CheckCircle2,
  TrendingUp, TrendingDown, CalendarCheck, Sparkles,
} from "lucide-react";

const Stat = ({ icon: Icon, label, value, accent, sub, testid }) => (
  <div className="bl-card p-5" data-testid={testid || `stat-${label.toLowerCase().replace(/\s+/g,"-")}`}>
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
        <Icon className="w-5 h-5" strokeWidth={1.6} />
      </div>
      <div className="label-eyebrow">{label}</div>
    </div>
    <div className="mt-3 font-display text-3xl text-[#2D3A33]">{value}</div>
    {sub && <div className="mt-1 text-xs text-[#5C6C62]">{sub}</div>}
  </div>
);

export default function DashboardPage() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const [data, setData] = useState({});
  const [recent, setRecent] = useState([]);
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    api.get("/dashboard/owner").then(r => setData(r.data || {})).catch(() => {});
    api.get("/visits").then(r => setRecent((r.data || []).slice(0, 6))).catch(() => {});
    api.get("/bookings", { params: { scope: "today" } }).then(r => setBookings(r.data || [])).catch(() => {});
  }, []);

  const delta = data.revenue_delta_pct;
  const deltaPositive = typeof delta === "number" && delta >= 0;

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">{ROLE_LABEL[user?.role] || user?.role} dashboard</div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-tight font-light mt-2 text-[#2D3A33]">
            Hello, <span style={{ color: "var(--bl-primary)" }}>{user?.name?.split(" ")[0]}</span>
          </h1>
          <p className="mt-2 text-[#5C6C62]">
            Today is {new Date().toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/bookings" className="bl-btn-ghost" data-testid="dash-quick-bookings">View bookings</Link>
          <Link to="/patients" className="bl-btn-ghost" data-testid="dash-quick-patients">View patients</Link>
          {(user?.role === "fo" || user?.role === "super_admin") && (
            <Link to="/patients" className="bl-btn-primary" data-testid="dash-quick-new-patient">+ New patient</Link>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        <Stat icon={CalendarCheck} label="Bookings today" value={data.bookings_today ?? "—"} accent="bg-[#FBF3DB] text-[#8A6D1F]" testid="kpi-bookings-today" />
        <Stat icon={Calendar} label="Upcoming" value={data.upcoming_bookings ?? "—"} accent="bg-[#E5EEF5] text-[#2C5A77]" testid="kpi-upcoming" sub={`${data.pending_confirm ?? 0} need confirm`} />
        <Stat
          icon={deltaPositive ? TrendingUp : TrendingDown}
          label="Revenue MTD"
          value={formatIdr(data.revenue_mtd ?? 0)}
          accent="bg-[#EDF3EF] text-[#52796F]"
          testid="kpi-revenue-mtd"
          sub={typeof delta === "number" ? `${deltaPositive ? "+" : ""}${delta.toFixed(0)}% vs last month` : "—"}
        />
        <Stat icon={Users} label="Total patients" value={data.total_patients ?? "—"} accent="bg-[#F3F1EB] text-[#5C6C62]" testid="kpi-total-patients" />
        <Stat icon={Stethoscope} label="In progress" value={data.in_progress ?? "—"} accent="bg-[#E5EEF5] text-[#2C5A77]" testid="kpi-in-progress" />
        <Stat icon={Activity} label="Visits today" value={data.visits_today ?? "—"} accent="bg-[#FBF3DB] text-[#8A6D1F]" testid="kpi-visits-today" />
        <Stat icon={CheckCircle2} label="Total visits" value={data.total_visits ?? "—"} accent="bg-[#EDF3EF] text-[#52796F]" testid="kpi-total-visits" />
        <div className="bl-card p-5" data-testid="kpi-quick-book">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#F3F1EB]" style={{ color: "var(--bl-primary)" }}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="label-eyebrow">Public booking</div>
          </div>
          {clinic?.slug ? (
            <>
              <div className="mt-3 text-xs font-mono break-all text-[#2D3A33]">{`/book/${clinic.slug}`}</div>
              <Link to="/bookings" className="mt-3 inline-block text-sm" style={{ color: "var(--bl-primary)" }}>Manage link →</Link>
            </>
          ) : <div className="mt-3 text-sm text-[#5C6C62]">—</div>}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">Today's bookings</h2>
            <Link to="/bookings" className="text-sm" style={{ color: "var(--bl-primary)" }}>See all →</Link>
          </div>
          <div className="bl-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]" data-testid="today-bookings-table">
                <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62] text-left">
                  <tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Treatment</th><th className="px-5 py-3">Status</th></tr>
                </thead>
                <tbody>
                  {bookings.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-[#5C6C62]">No bookings today</td></tr>}
                  {bookings.map(b => {
                    const dt = new Date(b.scheduled_at);
                    return (
                      <tr key={b.id} className="border-t border-[#EAE6D7]">
                        <td className="px-5 py-3 text-sm text-[#5C6C62] whitespace-nowrap">{dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="px-5 py-3 text-sm text-[#2D3A33]">{b.patient_name}</td>
                        <td className="px-5 py-3 text-sm">{b.treatment}</td>
                        <td className="px-5 py-3"><span className={`bl-chip ${b.status === "confirmed" || b.status === "checked_in" ? "success" : "info"}`}>{b.status.replace("_", " ")}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33] mb-4">Top treatments (MTD)</h2>
          <div className="bl-card p-5" data-testid="top-treatments">
            {(data.top_treatments || []).length === 0 ? (
              <div className="text-sm text-[#5C6C62]">No treatment data yet this month.</div>
            ) : (
              <ul className="space-y-3">
                {(data.top_treatments || []).map((t, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-[#2D3A33]">{t.name}</div>
                      <div className="text-xs text-[#5C6C62]">{t.count} session{t.count !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-sm font-medium text-[#2D3A33]">{formatIdr(t.revenue)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">Recent visits</h2>
          <Link to="/visits" className="text-sm" style={{ color: "var(--bl-primary)" }}>See all →</Link>
        </div>
        <div className="bl-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <tr>
                  <th className="px-5 py-3">Patient</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Date</th><th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No visits yet</td></tr>}
                {recent.map(v => (
                  <tr key={v.id} className="border-t border-[#EAE6D7]">
                    <td className="px-5 py-3 font-medium text-[#2D3A33]">{v.patient_name}</td>
                    <td className="px-5 py-3 capitalize text-[#5C6C62]">{v.visit_type}</td>
                    <td className="px-5 py-3"><span className={`bl-chip ${v.status === "completed" ? "success" : "info"}`}>{v.status.replace("_", " ")}</span></td>
                    <td className="px-5 py-3 text-[#5C6C62] text-sm">{new Date(v.visit_date || v.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right"><Link to={`/visits/${v.id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Open →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
