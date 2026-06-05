import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { CalendarCheck, RefreshCw } from "lucide-react";

const STATUS_OPTIONS = ["", "booked", "confirmed", "checked_in", "completed", "cancelled", "no_show"];

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SchedulePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from: fromDate, to: toDate, appointments_only: true };
      if (status) params.status = status;
      const r = await api.get("/bookings", { params });
      setRows(r.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, status]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(`${today}T00:00:00`);
    const todayEnd = new Date(`${today}T23:59:59`);
    const past = [];
    const todayRows = [];
    const upcoming = [];
    for (const b of rows) {
      const dt = new Date(b.scheduled_at);
      if (dt < todayStart) past.push(b);
      else if (dt <= todayEnd) todayRows.push(b);
      else upcoming.push(b);
    }
    return { past, today: todayRows, upcoming };
  }, [rows, today]);

  const Section = ({ title, items }) => (
    <div className="bl-card overflow-hidden">
      <div className="px-5 py-3 bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">{title}</div>
      {items.length === 0 ? (
        <div className="p-6 text-sm text-[#5C6C62] text-center">None in this period</div>
      ) : (
        <ul className="divide-y divide-[#EAE6D7]">
          {items.map((b) => (
            <li key={b.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 hover:bg-[#FDFBF7]">
              <div className="min-w-0">
                <div className="font-medium text-[#2D3A33]">{b.patient_name || "—"}</div>
                <div className="text-sm text-[#5C6C62]">{b.treatment} · {formatTime(b.scheduled_at)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`bl-chip ${b.status === "completed" ? "success" : "info"}`}>
                  {(b.status || "").replace("_", " ")}
                </span>
                {b.visit_id ? (
                  <Link to={`/visits/${b.visit_id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Session record</Link>
                ) : (
                  <span className="text-xs text-[#A89F8B]">No session record yet</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-5xl mx-auto" data-testid="schedule-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-eyebrow">My work</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Schedule</h1>
          <p className="mt-2 text-[#5C6C62]">Appointments where you are primary or additional assigned staff.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="bl-btn-ghost inline-flex items-center gap-2 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="mt-6 bl-card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label-eyebrow block mb-1">From</label>
          <input type="date" className="bl-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} data-testid="schedule-from" />
        </div>
        <div>
          <label className="label-eyebrow block mb-1">To</label>
          <input type="date" className="bl-input" value={toDate} onChange={(e) => setToDate(e.target.value)} data-testid="schedule-to" />
        </div>
        <div>
          <label className="label-eyebrow block mb-1">Status</label>
          <select className="bl-input" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="schedule-status">
            <option value="">All</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-[#5C6C62] py-10">Loading schedule…</div>
      ) : (
        <div className="mt-8 space-y-6">
          <Section title="Today" items={grouped.today} />
          <Section title="Upcoming" items={grouped.upcoming} />
          <Section title="Past" items={grouped.past} />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="mt-8 bl-card p-8 text-center text-[#5C6C62]">
          <CalendarCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          No assigned appointments in this date range.
        </div>
      )}
    </div>
  );
}
