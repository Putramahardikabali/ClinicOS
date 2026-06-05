import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, Stethoscope, FileText } from "lucide-react";

function BookingRow({ b }) {
  const time = b.scheduled_at ? new Date(b.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <Link
      to={b.visit_id ? `/visits/${b.visit_id}` : "/schedule"}
      className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#F8F5EC] border border-transparent hover:border-[#EAE6D7]"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-[#2D3A33] truncate">{b.patient_name || "—"}</div>
        <div className="text-xs text-[#5C6C62]">{b.treatment} · {time}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-[#5C6C62] shrink-0" />
    </Link>
  );
}

export default function ClinicalDashboardSections({ data }) {
  const { today_bookings = [], upcoming_bookings = [], awaiting_notes = [], recent_visits = [] } = data || {};

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bl-card p-5" data-testid="dash-today-bookings">
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
            <h2 className="font-display text-lg text-[#2D3A33]">Today&apos;s assigned appointments</h2>
          </div>
          <div className="space-y-1">
            {today_bookings.length === 0 ? (
              <p className="text-sm text-[#5C6C62] py-4 text-center">No appointments today.</p>
            ) : today_bookings.map((b) => <BookingRow key={b.id} b={b} />)}
          </div>
          <Link to="/schedule" className="inline-block mt-3 text-sm" style={{ color: "var(--bl-primary)" }}>Full schedule →</Link>
        </div>

        <div className="bl-card p-5" data-testid="dash-upcoming-bookings">
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
            <h2 className="font-display text-lg text-[#2D3A33]">Upcoming assigned appointments</h2>
          </div>
          <div className="space-y-1">
            {upcoming_bookings.length === 0 ? (
              <p className="text-sm text-[#5C6C62] py-4 text-center">Nothing upcoming.</p>
            ) : upcoming_bookings.slice(0, 8).map((b) => <BookingRow key={b.id} b={b} />)}
          </div>
        </div>
      </div>

      <div className="bl-card p-5" data-testid="dash-awaiting-notes">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
          <h2 className="font-display text-lg text-[#2D3A33]">Patients awaiting notes</h2>
        </div>
        <div className="space-y-1">
          {awaiting_notes.length === 0 ? (
            <p className="text-sm text-[#5C6C62] py-4 text-center">All notes submitted.</p>
          ) : awaiting_notes.map((v) => (
            <Link
              key={v.visit_id}
              to={`/visits/${v.visit_id}`}
              className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#F8F5EC]"
            >
              <div>
                <div className="text-sm font-medium text-[#2D3A33]">{v.patient_name}</div>
                <div className="text-xs text-[#5C6C62]">{v.chief_complaint || "Complete clinical notes"}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#5C6C62]" />
            </Link>
          ))}
        </div>
      </div>

      <div className="bl-card p-5" data-testid="dash-recent-visits">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
            <h2 className="font-display text-lg text-[#2D3A33]">Recent assigned sessions</h2>
          </div>
          <Link to="/visits" className="text-sm" style={{ color: "var(--bl-primary)" }}>All sessions →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-xs uppercase tracking-widest text-[#5C6C62] text-left">
              <tr><th className="pb-2">Patient</th><th className="pb-2">Status</th><th className="pb-2">Date</th><th /></tr>
            </thead>
            <tbody>
              {recent_visits.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-[#5C6C62]">No sessions yet</td></tr>
              )}
              {recent_visits.map((v) => (
                <tr key={v.id} className="border-t border-[#EAE6D7]">
                  <td className="py-2.5 font-medium">{v.patient_name}</td>
                  <td className="py-2.5 capitalize">{(v.status || "").replace("_", " ")}</td>
                  <td className="py-2.5 text-[#5C6C62]">{new Date(v.visit_date || v.created_at).toLocaleDateString()}</td>
                  <td className="py-2.5 text-right">
                    <Link to={`/visits/${v.id}`} style={{ color: "var(--bl-primary)" }}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/schedule" className="bl-btn-ghost">My schedule</Link>
        <Link to="/visits" className="bl-btn-primary">My sessions</Link>
      </div>
    </div>
  );
}
