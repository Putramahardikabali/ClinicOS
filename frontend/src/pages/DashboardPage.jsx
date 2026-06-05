import { useEffect, useState } from "react";

import api from "@/lib/api";

import { useAuth, ROLE_LABEL, hasPermission, isAccountingUser } from "@/lib/auth";

import ClinicalDashboardSections from "@/pages/ClinicalDashboardSections";

import ManagerDashboard from "@/pages/ManagerDashboard";

import FrontDeskDashboard from "@/pages/FrontDeskDashboard";

import { useClinic, formatIdr, hasFeature } from "@/lib/clinic";

import { Link, Navigate } from "react-router-dom";

import {

  Users, Stethoscope, Activity, Calendar, CheckCircle2,

  TrendingUp, TrendingDown, CalendarCheck, Sparkles,

  ListChecks, ArrowRight,

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



const QUEUE_HEADERS = {

  doctor: "Patients awaiting your clinical notes",

  therapist: "Your treatments to perform",

  nurse: "Your assigned appointments & sessions",

  fo: "Appointments to handle today",

};



function QueueItemLink({ item }) {

  if (item.kind === "summary") {

    return (

      <Link to={item.link || "#"} className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#F8F5EC] transition border border-transparent hover:border-[#EAE6D7]">

        <div>

          <div className="text-sm font-medium text-[#2D3A33]">{item.label}</div>

          <div className="text-xs text-[#5C6C62]">{item.sub}</div>

        </div>

        <ArrowRight className="w-4 h-4 text-[#5C6C62]" />

      </Link>

    );

  }

  const href = item.visit_id

    ? (item.sub === "Collect payment" ? `/invoices/visit/${item.visit_id}` : `/visits/${item.visit_id}`)

    : (item.booking_id ? `/bookings?open=${item.booking_id}` : "#");

  return (

    <Link to={href} className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#F8F5EC] transition border border-transparent hover:border-[#EAE6D7]" data-testid="queue-item">

      <div className="flex-1 min-w-0">

        <div className="text-sm font-medium text-[#2D3A33] truncate">{item.patient_name || "—"}</div>

        <div className="text-xs text-[#5C6C62]">{item.label} {item.sub && <span className="text-[#A89F8B]">· {item.sub}</span>}</div>

      </div>

      <ArrowRight className="w-4 h-4 text-[#5C6C62] shrink-0" />

    </Link>

  );

}



/** FO / legacy staff dashboard — not Owner/Manager operations view */

function FrontOfficeDashboard({ user, clinic }) {

  const [data, setData] = useState({});

  const [recent, setRecent] = useState([]);

  const [bookings, setBookings] = useState([]);

  const [queue, setQueue] = useState({ role: user?.role, items: [] });

  const [billingSummary, setBillingSummary] = useState(null);



  const showBilling = hasFeature(clinic, "billing") && hasPermission(user, "billing.view");



  useEffect(() => {

    api.get("/dashboard/owner").then(r => setData(r.data || {})).catch(() => {});

    api.get("/visits").then(r => setRecent((r.data || []).slice(0, 6))).catch(() => {});

    api.get("/bookings", { params: { scope: "today", appointments_only: true } }).then(r => setBookings(r.data || [])).catch(() => {});

    api.get("/dashboard/me-queue").then(r => setQueue(r.data || { items: [] })).catch(() => {});

    if (showBilling) {

      api.get("/invoices/dashboard/summary").then(r => setBillingSummary(r.data)).catch(() => {});

    }

  }, [showBilling]);



  const delta = data.revenue_delta_pct;

  const deltaPositive = typeof delta === "number" && delta >= 0;



  return (

    <>

      {showBilling && billingSummary && (

        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">

          <Stat icon={CalendarCheck} label="Unpaid today" value={billingSummary.unpaid_count} accent="bg-[#FBF3DB] text-[#8A6D1F]" testid="billing-unpaid" />

          <Stat icon={Activity} label="Partial today" value={billingSummary.partial_count} accent="bg-[#E5EEF5] text-[#2C5A77]" testid="billing-partial" />

          <Stat icon={CheckCircle2} label="Paid today" value={billingSummary.paid_count} accent="bg-[#EDF3EF] text-[#52796F]" testid="billing-paid" />

          <Stat icon={TrendingUp} label="Revenue today" value={formatIdr(billingSummary.revenue_today_idr)} accent="bg-[#F3F1EB] text-[#5C6C62]" testid="billing-revenue" />

        </div>

      )}



      <div className="mt-8 bl-card p-5" data-testid="todays-queue">

        <div className="flex items-center gap-2 mb-1">

          <ListChecks className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />

          <div className="label-eyebrow">Today&apos;s queue</div>

        </div>

        <h2 className="font-display text-xl text-[#2D3A33] mt-0.5">{QUEUE_HEADERS[user?.role] || "Your queue"}</h2>

        <div className="mt-3 space-y-1.5" data-testid="queue-items-list">

          {queue.items.length === 0 ? (

            <div className="py-6 text-center text-[#5C6C62] text-sm">All clear — no items pending.</div>

          ) : queue.items.map((it, i) => <QueueItemLink key={i} item={it} />)}

        </div>

      </div>



      <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">

        <Stat icon={CalendarCheck} label="Appointments today" value={data.bookings_today ?? "—"} accent="bg-[#FBF3DB] text-[#8A6D1F]" testid="kpi-bookings-today" />

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

        <Stat icon={Activity} label="Sessions today" value={data.visits_today ?? "—"} accent="bg-[#FBF3DB] text-[#8A6D1F]" testid="kpi-visits-today" />

        <Stat icon={CheckCircle2} label="Total sessions" value={data.total_visits ?? "—"} accent="bg-[#EDF3EF] text-[#52796F]" testid="kpi-total-visits" />

        <div className="bl-card p-5" data-testid="kpi-quick-book">

          <div className="flex items-center gap-3">

            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#F3F1EB]" style={{ color: "var(--bl-primary)" }}>

              <Sparkles className="w-5 h-5" />

            </div>

            <div className="label-eyebrow">Public appointment page</div>

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

            <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">Today&apos;s appointments</h2>

            <Link to="/bookings" className="text-sm" style={{ color: "var(--bl-primary)" }}>See all →</Link>

          </div>

          <div className="bl-card overflow-hidden">

            <div className="overflow-x-auto">

              <table className="w-full min-w-[480px]" data-testid="today-bookings-table">

                <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62] text-left">

                  <tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Treatment</th><th className="px-5 py-3">Status</th></tr>

                </thead>

                <tbody>

                  {bookings.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-[#5C6C62]">No appointments today</td></tr>}

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

          <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">Recent sessions</h2>

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

                {recent.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No sessions yet</td></tr>}

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

    </>

  );

}



export default function DashboardPage() {

  const { user } = useAuth();

  const { clinic } = useClinic();

  const isOpsDash = user?.role === "super_admin" || user?.role === "manager";

  const isAccounting = isAccountingUser(user);

  const isClinicalDash = !isOpsDash && !isAccounting && (

    hasPermission(user, "schedule.view_own") || (

      hasPermission(user, "visits.view_own") && !hasPermission(user, "appointments.view")

    )

  );



  const [clinicalData, setClinicalData] = useState(null);



  useEffect(() => {

    if (isClinicalDash) {

      api.get("/dashboard/clinical").then(r => setClinicalData(r.data || {})).catch(() => setClinicalData({}));

    }

  }, [isClinicalDash]);



  if (isAccounting) {
    return <Navigate to="/reports" replace />;
  }

  if (user?.role === "fo") {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <FrontDeskDashboard />
      </div>
    );
  }

  if (isOpsDash) {

    return (

      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">

        <ManagerDashboard />

      </div>

    );

  }



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

          {hasPermission(user, "patients.view") || hasPermission(user, "patients.view_assigned") ? (

            <Link to="/patients" className="bl-btn-ghost" data-testid="dash-quick-patients">Patients</Link>

          ) : null}

          {hasPermission(user, "appointments.view") && (

            <>

              <Link to="/bookings" className="bl-btn-ghost" data-testid="dash-quick-bookings">Appointments</Link>

              {hasFeature(clinic, "billing") && hasPermission(user, "billing.view") && (

                <Link to="/invoices" className="bl-btn-primary" data-testid="dash-quick-invoices">Invoices</Link>

              )}

            </>

          )}

          {isClinicalDash && (

            <>

              <Link to="/schedule" className="bl-btn-ghost" data-testid="dash-quick-schedule">Schedule</Link>

              <Link to="/visits" className="bl-btn-primary" data-testid="dash-quick-visits">Sessions</Link>

            </>

          )}

        </div>

      </div>



      {isClinicalDash && (

        <div className="mt-8">

          <ClinicalDashboardSections data={clinicalData} />

        </div>

      )}



      {!isClinicalDash && <FrontOfficeDashboard user={user} clinic={clinic} />}

    </div>

  );

}


