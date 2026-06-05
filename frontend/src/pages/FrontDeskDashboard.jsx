import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { formatIdr } from "@/lib/clinic";
import { AppointmentRemindersPanel } from "@/components/frontdesk/AppointmentReminders";
import { useFrontDeskReminders } from "@/lib/frontDeskReminderContext";
import {
  Users,
  Lock,
  Unlock,
  Search,
  Plus,
  ShoppingCart,
  AlertTriangle,
  ArrowRight,
  Receipt,
} from "lucide-react";

const STATUS_CHIP = {
  booked: "info",
  confirmed: "info",
  checked_in: "warning",
  in_progress: "warning",
  completed: "success",
  cancelled: "neutral",
  no_show: "neutral",
};

function SummaryCard({ label, value, sub, testid }) {
  return (
    <div className="bl-card p-4" data-testid={testid}>
      <div className="label-eyebrow">{label}</div>
      <div className="font-display text-2xl mt-1 text-[#2D3A33]">{value}</div>
      {sub && <div className="text-xs text-[#5C6C62] mt-1">{sub}</div>}
    </div>
  );
}

function ActionRow({ item }) {
  return (
    <Link
      to={item.link || "#"}
      className="flex items-start gap-3 px-4 py-3 rounded-lg hover:bg-[#F8F5EC] border border-transparent hover:border-[#EAE6D7] transition"
      data-testid={`action-${item.kind}`}
    >
      <AlertTriangle
        className={`w-4 h-4 shrink-0 mt-0.5 ${
          item.severity === "high" ? "text-[#B14A2C]" : item.severity === "warning" ? "text-[#B45309]" : "text-[#5C6C62]"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#2D3A33]">{item.label}</div>
        {item.sub && <div className="text-xs text-[#5C6C62]">{item.sub}</div>}
      </div>
      <ArrowRight className="w-4 h-4 text-[#A89F8B] shrink-0" />
    </Link>
  );
}

export default function FrontDeskDashboard({ embedded = false }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openPanel } = useFrontDeskReminders() || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [patientQ, setPatientQ] = useState("");

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const r = await api.get("/dashboard/front-desk/today");
      setData(r.data);
    } catch (e) {
      if (!silent) {
        setError(e?.response?.data?.detail || "Could not load today operations");
        setData(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard(false);
  }, [fetchDashboard]);

  useEffect(() => {
    if (searchParams.get("fd_reminders") !== "1") return;
    openPanel?.();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("fd_reminders");
      return next;
    }, { replace: true });
    window.setTimeout(() => {
      document.getElementById("fd-appointment-reminders-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [searchParams, setSearchParams, openPanel]);

  const summary = data?.summary || {};
  const sales = data?.sales_snapshot || {};
  const closing = data?.closing || {};
  const caps = data?.capabilities || {};
  const readOnly = data?.read_only;

  const searchPatient = (e) => {
    e.preventDefault();
    const q = patientQ.trim();
    if (q) nav(`/patients?q=${encodeURIComponent(q)}`);
  };

  if (loading && !data) {
    return <div className="py-12 text-center text-[#5C6C62]">Loading today&apos;s operations…</div>;
  }

  if (error && !data) {
    return (
      <div className="bl-card p-8 text-center">
        <p className="text-[#B14A2C]">{error}</p>
        <button type="button" className="bl-btn-ghost mt-4 text-sm" onClick={() => fetchDashboard(false)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="front-desk-dashboard">
      {!embedded && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-eyebrow">Today operations</div>
            <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light text-[#2D3A33]">
              Front desk
            </h1>
            <p className="mt-1 text-sm text-[#5C6C62]">
              {data?.date} · {data?.timezone}
              {readOnly && " · Read-only view"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPermission(user, "appointments.create") && !readOnly && (
              <Link to="/bookings?new=1" className="bl-btn-primary text-sm inline-flex items-center gap-1.5" data-testid="fd-new-booking">
                <Plus className="w-4 h-4" /> New appointment
              </Link>
            )}
            {hasPermission(user, "patients.create") && !readOnly && (
              <Link to="/patients?new=1" className="bl-btn-ghost text-sm inline-flex items-center gap-1.5">
                <Users className="w-4 h-4" /> New patient
              </Link>
            )}
            {hasPermission(user, "pos.create") && !readOnly && (
              <Link to="/pos" className="bl-btn-ghost text-sm inline-flex items-center gap-1.5" data-testid="fd-pos">
                <ShoppingCart className="w-4 h-4" /> POS sale
              </Link>
            )}
            <Link to="/bookings" className="bl-btn-ghost text-sm">Find appointment</Link>
          </div>
        </div>
      )}

      <form onSubmit={searchPatient} className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A89F8B]" />
          <input
            className="bl-input w-full pl-9"
            placeholder="Find patient by name or phone…"
            value={patientQ}
            onChange={(e) => setPatientQ(e.target.value)}
            data-testid="fd-find-patient"
          />
        </div>
        <button type="submit" className="bl-btn-ghost text-sm">Search</button>
      </form>

      <AppointmentRemindersPanel />

      <section data-testid="fd-summary-cards">
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <SummaryCard label="Appointments" value={summary.total_appointments ?? 0} testid="fd-total-appts" />
          <SummaryCard label="Checked in" value={summary.checked_in ?? 0} testid="fd-checked-in" />
          <SummaryCard label="In progress" value={summary.in_progress ?? 0} testid="fd-in-progress" />
          <SummaryCard label="Completed" value={summary.completed ?? 0} testid="fd-completed" />
          <SummaryCard label="Cancelled / no-show" value={summary.cancelled ?? 0} testid="fd-cancelled" />
          <SummaryCard label="Pending payment" value={summary.pending_payment ?? 0} testid="fd-pending-pay" />
          <SummaryCard label="Collected today" value={formatIdr(summary.today_collected_idr)} testid="fd-collected" />
          <SummaryCard
            label="Closing"
            value={summary.closing_status === "closed" ? "Closed" : "Open"}
            sub={summary.closing_status === "closed" ? "Day locked" : "Day open"}
            testid="fd-closing-status"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bl-card overflow-hidden" data-testid="fd-appointment-timeline">
          <div className="px-5 py-4 border-b flex justify-between items-center">
            <h2 className="font-display text-lg">Appointment timeline</h2>
            <Link to="/bookings" className="text-sm" style={{ color: "var(--bl-primary)" }}>All appointments →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62] text-left">
                <tr>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Patient</th>
                  <th className="px-4 py-2">Treatment</th>
                  <th className="px-4 py-2">Staff</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Consent</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.appointments || []).length === 0 && (
                  <tr><td colSpan={8} className="text-center py-10 text-[#5C6C62]">No appointments today</td></tr>
                )}
                {(data?.appointments || []).map((a) => (
                  <tr key={a.id} className="border-t border-[#EAE6D7]" data-testid="fd-appt-row">
                    <td className="px-4 py-3 font-mono whitespace-nowrap">{a.time}</td>
                    <td className="px-4 py-3">
                      {a.patient_id ? (
                        <Link to={`/patients/${a.patient_id}`} className="hover:underline">{a.patient_name}</Link>
                      ) : a.patient_name}
                    </td>
                    <td className="px-4 py-3">{a.treatment}</td>
                    <td className="px-4 py-3 text-[#5C6C62]">{a.performer}</td>
                    <td className="px-4 py-3">
                      <span className={`bl-chip ${STATUS_CHIP[a.status] || "info"}`}>{a.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 capitalize">{a.payment_status}</td>
                    <td className="px-4 py-3 capitalize">{a.consent_status}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(a.quick_actions || []).slice(0, 3).map((act) => (
                          <Link key={act.key} to={act.link} className="text-xs px-2 py-0.5 rounded bg-[#EDF3EF] text-[#2D6A4F] hover:bg-[#D8E8E0]">
                            {act.label}
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bl-card p-5" data-testid="fd-action-queue">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-[#B45309]" />
            <h2 className="font-display text-lg">Action queue</h2>
          </div>
          <div className="space-y-1 max-h-[480px] overflow-y-auto">
            {(data?.action_queue || []).length === 0 ? (
              <p className="text-sm text-[#5C6C62] py-6 text-center">All clear — nothing needs attention.</p>
            ) : (
              data.action_queue.map((item, i) => <ActionRow key={`${item.kind}-${i}`} item={item} />)
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bl-card p-5" data-testid="fd-sales-snapshot">
          <h2 className="font-display text-lg mb-4">Today sales snapshot</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-[#5C6C62]">POS collected</span><span className="font-mono">{formatIdr(sales.pos_collected_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Invoice payments</span><span className="font-mono">{formatIdr(sales.invoice_collected_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Gift card sales</span><span className="font-mono">{formatIdr(sales.gift_card_sales_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Package sales</span><span className="font-mono">{formatIdr(sales.package_sales_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Product sales</span><span className="font-mono">{formatIdr(sales.product_sales_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Refunds</span><span className="font-mono">{formatIdr(sales.refunds_idr)}</span></div>
            <div className="flex justify-between"><span className="text-[#5C6C62]">Store credit used</span><span className="font-mono">{formatIdr(sales.store_credit_used_idr)}</span></div>
            <div className="flex justify-between font-medium"><span>Total collected</span><span className="font-mono">{formatIdr(sales.total_collected_idr)}</span></div>
            <div className="col-span-2 border-t border-[#EAE6D7] pt-3 mt-1 grid grid-cols-2 gap-2">
              <div className="flex justify-between"><span className="text-[#5C6C62]">Cash</span><span className="font-mono">{formatIdr(sales.cash_idr)}</span></div>
              <div className="flex justify-between"><span className="text-[#5C6C62]">Card</span><span className="font-mono">{formatIdr(sales.card_idr)}</span></div>
              <div className="flex justify-between"><span className="text-[#5C6C62]">Bank transfer</span><span className="font-mono">{formatIdr(sales.bank_transfer_idr)}</span></div>
              <div className="flex justify-between"><span className="text-[#5C6C62]">QRIS</span><span className="font-mono">{formatIdr(sales.qris_idr)}</span></div>
              <div className="flex justify-between"><span className="text-[#5C6C62]">Other</span><span className="font-mono">{formatIdr(sales.other_idr)}</span></div>
            </div>
          </div>
        </section>

        <section className="bl-card p-5" data-testid="fd-closing-widget">
          <div className="flex items-center gap-2 mb-4">
            {closing.is_closed ? <Lock className="w-5 h-5 text-[#B45309]" /> : <Unlock className="w-5 h-5 text-[#52796F]" />}
            <h2 className="font-display text-lg">Daily closing — {closing.is_closed ? "Closed" : "Open"}</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[#5C6C62]">Expected cash</span><span className="font-mono">{formatIdr(closing.expected_cash_idr)}</span></div>
            {closing.actual_cash_counted_idr != null && (
              <div className="flex justify-between"><span className="text-[#5C6C62]">Actual cash counted</span><span className="font-mono">{formatIdr(closing.actual_cash_counted_idr)}</span></div>
            )}
            {closing.cash_difference_idr != null && (
              <div className="flex justify-between"><span className="text-[#5C6C62]">Cash difference</span><span className="font-mono">{formatIdr(closing.cash_difference_idr)}</span></div>
            )}
            {closing.closed_at && (
              <p className="text-xs text-[#5C6C62] pt-2">
                Closed {new Date(closing.closed_at).toLocaleString()}
                {closing.closed_by_name && ` by ${closing.closed_by_name}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            {caps.can_view_closing && (
              <Link to="/daily-closing" className="bl-btn-primary text-sm inline-flex items-center gap-1.5" data-testid="fd-preview-closing">
                <Receipt className="w-4 h-4" /> {closing.is_closed ? "View closing" : "Preview closing"}
              </Link>
            )}
            {closing.is_closed && closing.closing_id && caps.can_view_closing && (
              <Link to={`/daily-closing?date=${data?.date}`} className="bl-btn-ghost text-sm">Closing detail</Link>
            )}
          </div>
          {closing.is_closed && (
            <p className="mt-3 text-xs text-[#B45309]">Today is closed — reopen from Daily Closing to edit transactions.</p>
          )}
        </section>
      </div>

      <div className="flex justify-end">
        <button type="button" className="bl-btn-ghost text-sm" onClick={() => fetchDashboard(false)}>Refresh</button>
      </div>
    </div>
  );
}
