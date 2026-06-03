import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = [
  { key: "mon", label: "Mon", full: "Monday" },
  { key: "tue", label: "Tue", full: "Tuesday" },
  { key: "wed", label: "Wed", full: "Wednesday" },
  { key: "thu", label: "Thu", full: "Thursday" },
  { key: "fri", label: "Fri", full: "Friday" },
  { key: "sat", label: "Sat", full: "Saturday" },
  { key: "sun", label: "Sun", full: "Sunday" },
];

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const OVERRIDE_STATUSES = [
  { value: "working", badge: "Working" },
  { value: "off", badge: "Off" },
  { value: "sick_leave", badge: "Sick Leave" },
  { value: "annual_leave", badge: "Annual Leave" },
  { value: "training", badge: "Training" },
  { value: "blocked_time", badge: "Blocked" },
];

const STATUS_COLORS = {
  working: { bg: "#E8F0EC", border: "#52796F", text: "#2D4A3E" },
  off: { bg: "#DDD8CE", border: "#A89F8B", text: "#5C6C62" },
  sick_leave: { bg: "#FCEEEA", border: "#B14A2C", text: "#8B3A22" },
  annual_leave: { bg: "#F3EDFA", border: "#9B7EC8", text: "#6B4F96" },
  training: { bg: "#FBF6ED", border: "#C4A574", text: "#7A6238" },
  blocked_time: { bg: "#F0EBE6", border: "#6B5344", text: "#4A382C" },
};

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dayKeyFromDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const pyWd = (d.getDay() + 6) % 7;
  return WEEKDAY_KEYS[pyWd];
}

function formatTimeRange(start, end) {
  if (!start || !end) return "";
  return `${start}–${end}`;
}

function overrideBadgeText(ov) {
  const meta = OVERRIDE_STATUSES.find((s) => s.value === ov.status);
  const label = meta?.badge || ov.status;
  if (ov.status === "working") {
    const range = formatTimeRange(ov.start_time, ov.end_time);
    return range || "Working";
  }
  if (ov.status === "blocked_time") {
    const range = formatTimeRange(ov.start_time, ov.end_time);
    return range ? `Blocked ${range}` : "Blocked";
  }
  if (ov.status === "off") return "OFF";
  return label;
}

/** Effective display for a calendar cell: override wins, else weekly template. */
function resolveDayCell(dateStr, override, weeklyRow) {
  if (override) {
    const status = override.status || "off";
    return {
      label: overrideBadgeText(override),
      colors: STATUS_COLORS[status] || STATUS_COLORS.off,
      isOff: status === "off" || status === "sick_leave" || status === "annual_leave",
      fromOverride: true,
    };
  }
  if (weeklyRow?.is_working) {
    const hours = formatTimeRange(weeklyRow.start_time, weeklyRow.end_time);
    return {
      label: hours || "Working",
      colors: STATUS_COLORS.working,
      isOff: false,
      fromOverride: false,
    };
  }
  return {
    label: "OFF",
    colors: STATUS_COLORS.off,
    isOff: true,
    fromOverride: false,
  };
}

export default function MyScheduleReadOnly({ staffId }) {
  const [subTab, setSubTab] = useState("weekly");
  const [weekly, setWeekly] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!staffId) return;
    setLoading(true);
    setError(null);
    api.get(`/staff/users/${staffId}/weekly-schedule`)
      .then((r) => {
        const days = r.data?.days || [];
        const byKey = Object.fromEntries(days.map((d) => [d.day_of_week, d]));
        setWeekly(WEEKDAYS.map((d) => ({
          ...byKey[d.key],
          day_of_week: d.key,
          day_label: d.full,
        })));
      })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load schedule"))
      .finally(() => setLoading(false));
  }, [staffId]);

  const loadOverrides = useCallback(() => {
    if (!staffId || !month) return;
    setCalendarLoading(true);
    api.get(`/staff/users/${staffId}/date-overrides`, { params: { month } })
      .then((r) => setOverrides(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load schedule overrides"))
      .finally(() => setCalendarLoading(false));
  }, [staffId, month]);

  useEffect(() => {
    if (subTab === "calendar") loadOverrides();
  }, [subTab, loadOverrides]);

  const weeklyMap = useMemo(
    () => Object.fromEntries(weekly.map((r) => [r.day_of_week, r])),
    [weekly],
  );

  const overrideByDate = useMemo(() => {
    const m = {};
    for (const o of overrides) m[o.date] = o;
    return m;
  }, [overrides]);

  const [y, mo] = month.split("-").map(Number);
  const calDays = daysInMonth(y, mo);
  const firstDow = new Date(y, mo - 1, 1).getDay();
  const pad = firstDow === 0 ? 6 : firstDow - 1;
  const monthLabel = new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  const shiftMonth = (delta) => {
    const [yy, mm] = month.split("-").map(Number);
    setMonth(monthKey(new Date(yy, mm - 1 + delta, 1)));
  };

  if (loading) {
    return <div className="text-sm text-[#5C6C62] py-6">Loading your schedule…</div>;
  }

  if (error && weekly.length === 0) {
    return <div className="bl-card p-5 text-sm text-[#5C6C62]">{error}</div>;
  }

  return (
    <div className="space-y-4" data-testid="profile-schedule-readonly">
      <p className="text-sm text-[#5C6C62]">
        Your weekly template is shown on every date. One-off changes (leave, training, etc.) override the default for that day.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[#F3F1EB] rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setSubTab("weekly")}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition"
            style={subTab === "weekly" ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(45,58,51,0.08)" } : { color: "#5C6C62" }}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setSubTab("calendar")}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition"
            style={subTab === "calendar" ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(45,58,51,0.08)" } : { color: "#5C6C62" }}
          >
            Calendar
          </button>
        </div>
        {subTab === "calendar" && (
          <div className="flex items-center gap-3 text-xs text-[#5C6C62]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm border" style={{ background: STATUS_COLORS.working.bg, borderColor: STATUS_COLORS.working.border }} />
              Working
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm border" style={{ background: STATUS_COLORS.off.bg, borderColor: STATUS_COLORS.off.border }} />
              Off
            </span>
          </div>
        )}
      </div>

      {subTab === "weekly" && (
        <div className="bl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-4 py-3 text-left">Day</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Hours</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Break</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((row) => (
                <tr key={row.day_of_week} className="border-t border-[#EAE6D7]">
                  <td className="px-4 py-3 font-medium text-[#2D3A33]">{row.day_label}</td>
                  <td className="px-4 py-3">
                    <span className={`bl-chip ${row.is_working ? "success" : ""}`}>
                      {row.is_working ? "Working" : "Off"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#5C6C62]">
                    {row.is_working ? formatTimeRange(row.start_time, row.end_time) || "—" : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#5C6C62] hidden sm:table-cell">
                    {row.is_working && row.break_start && row.break_end
                      ? formatTimeRange(row.break_start, row.break_end)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#5C6C62] hidden md:table-cell">{row.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "calendar" && (
        <div className="bl-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg text-[#2D3A33]">{monthLabel}</h3>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shiftMonth(-1)} className="p-2 rounded-lg hover:bg-[#F3F1EB]" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setMonth(monthKey(new Date()))} className="text-xs px-2 py-1 text-[#52796F]">Today</button>
              <button type="button" onClick={() => shiftMonth(1)} className="p-2 rounded-lg hover:bg-[#F3F1EB]" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          {calendarLoading && (
            <div className="text-xs text-[#5C6C62] mb-2">Updating calendar…</div>
          )}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-[#5C6C62] mb-2">
            {WEEKDAYS.map((d) => <div key={d.key}>{d.label}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: pad }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[80px]" />
            ))}
            {Array.from({ length: calDays }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dow = dayKeyFromDate(dateStr);
              const weeklyRow = weeklyMap[dow];
              const ov = overrideByDate[dateStr];
              const cell = resolveDayCell(dateStr, ov, weeklyRow);
              return (
                <div
                  key={dateStr}
                  className={`min-h-[80px] rounded-lg border p-1.5 text-left flex flex-col ${cell.isOff ? "opacity-95" : ""}`}
                  style={{
                    background: cell.colors.bg,
                    borderColor: cell.colors.border,
                  }}
                  data-testid={`schedule-day-${dateStr}`}
                >
                  <div className="text-xs font-semibold text-[#2D3A33]">{day}</div>
                  <div
                    className={`text-[10px] mt-1 leading-snug flex-1 ${cell.isOff ? "font-semibold uppercase tracking-wide" : "font-medium"}`}
                    style={{ color: cell.colors.text }}
                  >
                    {cell.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
