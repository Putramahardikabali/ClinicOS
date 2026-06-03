import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission, ROLE_LABEL } from "@/lib/auth";
import { toast } from "sonner";
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
  { value: "working", label: "Working", badge: "Working" },
  { value: "off", label: "Off", badge: "Off" },
  { value: "sick_leave", label: "Sick Leave", badge: "Sick Leave" },
  { value: "annual_leave", label: "Annual Leave", badge: "Annual Leave" },
  { value: "training", label: "Training", badge: "Training" },
  { value: "blocked_time", label: "Blocked Time", badge: "Blocked" },
];

const APPLY_MODES = [
  { value: "single", label: "This date only" },
  { value: "weekday_in_month", label: "Every same weekday this month" },
  { value: "date_range", label: "Custom date range" },
];

const STATUS_COLORS = {
  working: { bg: "#E8F0EC", border: "#52796F", text: "#2D4A3E" },
  off: { bg: "#F3F1EB", border: "#A89F8B", text: "#5C6C62" },
  sick_leave: { bg: "#FCEEEA", border: "#B14A2C", text: "#8B3A22" },
  annual_leave: { bg: "#F3EDFA", border: "#9B7EC8", text: "#6B4F96" },
  training: { bg: "#FBF6ED", border: "#C4A574", text: "#7A6238" },
  blocked_time: { bg: "#F0EBE6", border: "#6B5344", text: "#4A382C" },
};

const TIME_INPUT = "bl-input text-xs py-1 px-1.5 w-[5.25rem] min-w-0";

function emptyWeek() {
  return WEEKDAYS.map((d) => ({
    day_of_week: d.key,
    day_label: d.full,
    is_working: false,
    start_time: "",
    end_time: "",
    break_start: "",
    break_end: "",
    notes: "",
  }));
}

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

function weeklyByDay(rows) {
  return Object.fromEntries(rows.map((r) => [r.day_of_week, r]));
}

function weeklyCellHint(row) {
  if (!row?.is_working) return "Off";
  const range = formatTimeRange(row.start_time, row.end_time);
  return range || "Working";
}

function overrideBadgeText(ov) {
  const meta = OVERRIDE_STATUSES.find((s) => s.value === ov.status);
  const label = meta?.badge || ov.status;
  if (ov.status === "working") {
    const range = formatTimeRange(ov.start_time, ov.end_time);
    return range ? `Working ${range}` : "Working";
  }
  if (ov.status === "blocked_time") {
    const range = formatTimeRange(ov.start_time, ov.end_time);
    return range ? `Blocked ${range}` : "Blocked";
  }
  return label;
}

function StatusToggle({ working, disabled, onChange, testId }) {
  return (
    <div
      className="inline-flex rounded-md border border-[#EAE6D7] overflow-hidden text-xs shrink-0"
      data-testid={testId}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={`px-2 py-1 font-medium transition ${working ? "bg-[#52796F] text-white" : "bg-white text-[#5C6C62] hover:bg-[#F8F5EC]"}`}
      >
        Working
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={`px-2 py-1 font-medium transition border-l border-[#EAE6D7] ${!working ? "bg-[#5C6C62] text-white" : "bg-white text-[#5C6C62] hover:bg-[#F8F5EC]"}`}
      >
        Off
      </button>
    </div>
  );
}

export default function StaffScheduleTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "staff.manage");
  const [subTab, setSubTab] = useState("weekly");
  const [staff, setStaff] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [weekly, setWeekly] = useState(emptyWeek());
  const [overrides, setOverrides] = useState([]);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overrideModal, setOverrideModal] = useState(null);

  useEffect(() => {
    api.get("/staff/schedule/users")
      .then((r) => {
        const list = r.data || [];
        setStaff(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed to load staff"))
      .finally(() => setLoading(false));
  }, []);

  const loadWeekly = useCallback(() => {
    if (!selectedId) return;
    api.get(`/staff/users/${selectedId}/weekly-schedule`)
      .then((r) => {
        const days = r.data?.days || [];
        const byKey = Object.fromEntries(days.map((d) => [d.day_of_week, d]));
        setWeekly(WEEKDAYS.map((d) => ({
          ...byKey[d.key],
          day_of_week: d.key,
          day_label: d.full,
        })));
      })
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed to load weekly schedule"));
  }, [selectedId]);

  const loadOverrides = useCallback(() => {
    if (!selectedId || !month) return;
    api.get(`/staff/users/${selectedId}/date-overrides`, { params: { month } })
      .then((r) => setOverrides(r.data || []))
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed to load overrides"));
  }, [selectedId, month]);

  useEffect(() => { loadWeekly(); }, [loadWeekly]);
  useEffect(() => {
    if (subTab === "overrides") loadOverrides();
  }, [subTab, loadOverrides]);

  const weeklyMap = useMemo(() => weeklyByDay(weekly), [weekly]);

  const saveWeekly = async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      const days = weekly.map((row) => ({
        day_of_week: row.day_of_week,
        is_working: row.is_working,
        start_time: row.is_working ? (row.start_time || "") : "",
        end_time: row.is_working ? (row.end_time || "") : "",
        break_start: row.is_working ? (row.break_start || "") : "",
        break_end: row.is_working ? (row.break_end || "") : "",
        notes: row.notes || "",
      }));
      await api.put(`/staff/users/${selectedId}/weekly-schedule`, { days });
      toast.success("Weekly schedule saved");
      loadWeekly();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const updateDay = (key, field, value) => {
    setWeekly((rows) => rows.map((r) => (r.day_of_week === key ? { ...r, [field]: value } : r)));
  };

  const setDayWorking = (key, isWorking) => {
    setWeekly((rows) => rows.map((r) => {
      if (r.day_of_week !== key) return r;
      return {
        ...r,
        is_working: isWorking,
        start_time: isWorking && !r.start_time ? "09:00" : r.start_time,
        end_time: isWorking && !r.end_time ? "17:00" : r.end_time,
        break_start: isWorking ? r.break_start : "",
        break_end: isWorking ? r.break_end : "",
      };
    }));
  };

  const copyMondayToWeekdays = () => {
    const mon = weekly.find((r) => r.day_of_week === "mon");
    if (!mon) return;
    setWeekly((rows) => rows.map((r) => {
      if (!["tue", "wed", "thu", "fri"].includes(r.day_of_week)) return r;
      return {
        ...r,
        is_working: mon.is_working,
        start_time: mon.start_time,
        end_time: mon.end_time,
        break_start: mon.break_start,
        break_end: mon.break_end,
        notes: mon.notes,
      };
    }));
    toast.message("Copied Monday to Tue–Fri");
  };

  const setAllDaysOff = () => {
    setWeekly((rows) => rows.map((r) => ({
      ...r,
      is_working: false,
    })));
  };

  const clearSchedule = () => {
    setWeekly(emptyWeek());
  };

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

  const openOverride = (dateStr, existing) => {
    const dow = dayKeyFromDate(dateStr);
    const base = weeklyMap[dow];
    setOverrideModal({
      date: dateStr,
      existing: !!existing,
      status: existing?.status || (base?.is_working ? "working" : "off"),
      start_time: existing?.start_time || base?.start_time || "09:00",
      end_time: existing?.end_time || base?.end_time || "17:00",
      break_start: existing?.break_start || "",
      break_end: existing?.break_end || "",
      reason: existing?.reason || "",
      notes: existing?.notes || "",
      apply_mode: "single",
      range_end: dateStr,
    });
  };

  const saveOverride = async () => {
    if (!canManage || !overrideModal) return;
    setBusy(true);
    try {
      const {
        date, status, start_time, end_time, break_start, break_end,
        reason, notes, apply_mode, range_end,
      } = overrideModal;
      await api.put(`/staff/users/${selectedId}/date-overrides`, {
        date,
        status,
        start_time,
        end_time,
        break_start,
        break_end,
        reason,
        notes,
        apply_mode,
        range_end,
      });
      toast.success("Date override saved");
      setOverrideModal(null);
      loadOverrides();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const removeOverride = async (dateStr) => {
    if (!canManage || !window.confirm(`Remove override for ${dateStr}? Weekly schedule will apply.`)) return;
    try {
      await api.delete(`/staff/users/${selectedId}/date-overrides/${dateStr}`);
      toast.success("Override removed");
      setOverrideModal(null);
      loadOverrides();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const shiftMonth = (delta) => {
    const [yy, mm] = month.split("-").map(Number);
    const d = new Date(yy, mm - 1 + delta, 1);
    setMonth(monthKey(d));
  };

  const goToday = () => setMonth(monthKey(new Date()));

  const needsTimes = overrideModal && ["working", "blocked_time"].includes(overrideModal.status);

  if (loading) return <div className="text-sm text-[#5C6C62] py-6">Loading staff schedules…</div>;
  if (staff.length === 0) {
    return (
      <div className="text-sm text-[#5C6C62] py-6">
        No active staff yet. Add staff in Staff Directory first.
      </div>
    );
  }

  const selectedStaff = staff.find((s) => s.id === selectedId);

  return (
    <div className="max-w-4xl space-y-4" data-testid="staff-schedule-v2">
      <p className="text-sm text-[#5C6C62] leading-relaxed">
        Set the staff member&apos;s normal weekly schedule. Use date overrides for leave, training, shift changes, or extra working days.
      </p>

      <div className="bl-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label-eyebrow block mb-1">Staff member</label>
          <select
            className="bl-input text-sm w-full max-w-md"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            data-testid="staff-schedule-select"
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {ROLE_LABEL[s.role] || s.role}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1 bg-[#F3F1EB] rounded-lg p-1 self-end">
          <button
            type="button"
            onClick={() => setSubTab("weekly")}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition"
            style={subTab === "weekly" ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(45,58,51,0.08)" } : { color: "#5C6C62" }}
            data-testid="schedule-subtab-weekly"
          >
            Weekly Schedule
          </button>
          <button
            type="button"
            onClick={() => setSubTab("overrides")}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition"
            style={subTab === "overrides" ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(45,58,51,0.08)" } : { color: "#5C6C62" }}
            data-testid="schedule-subtab-overrides"
          >
            Date Overrides
          </button>
        </div>
      </div>

      {subTab === "weekly" && (
        <div className="bl-card overflow-hidden" data-testid="weekly-schedule-table">
          <div className="px-4 py-3 border-b border-[#EAE6D7] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#2D3A33]">Weekly schedule</h3>
              <p className="text-xs text-[#5C6C62] mt-0.5">
                Default for {selectedStaff?.name || "staff"}. Overrides take priority on specific dates.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={saveWeekly}
                disabled={busy}
                className="bl-btn-primary text-sm py-1.5 px-4 disabled:opacity-50 shrink-0"
                data-testid="weekly-schedule-save"
              >
                {busy ? "Saving…" : "Save schedule"}
              </button>
            )}
          </div>

          {canManage && (
            <div className="px-4 py-2 border-b border-[#EAE6D7] bg-[#FAFAF7] flex flex-wrap gap-2">
              <button type="button" onClick={copyMondayToWeekdays} className="text-xs text-[#52796F] font-medium hover:underline">
                Copy Monday → weekdays
              </button>
              <span className="text-[#EAE6D7]">|</span>
              <button type="button" onClick={setAllDaysOff} className="text-xs text-[#5C6C62] font-medium hover:underline">
                Set all days off
              </button>
              <span className="text-[#EAE6D7]">|</span>
              <button type="button" onClick={clearSchedule} className="text-xs text-[#B14A2C] font-medium hover:underline">
                Clear schedule
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8F5EC] text-left text-[10px] uppercase tracking-wider text-[#5C6C62]">
                  <th className="px-3 py-2 font-semibold w-[88px]">Day</th>
                  <th className="px-3 py-2 font-semibold w-[120px]">Status</th>
                  <th className="px-3 py-2 font-semibold">Start</th>
                  <th className="px-3 py-2 font-semibold">End</th>
                  <th className="px-3 py-2 font-semibold">Break</th>
                  <th className="px-3 py-2 font-semibold min-w-[100px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((row) => (
                  <tr key={row.day_of_week} className="border-t border-[#EAE6D7] hover:bg-[#FCFBF8]" data-testid={`weekly-row-${row.day_of_week}`}>
                    <td className="px-3 py-2 font-medium text-[#2D3A33] whitespace-nowrap">{row.day_label}</td>
                    <td className="px-3 py-2">
                      <StatusToggle
                        working={!!row.is_working}
                        disabled={!canManage}
                        onChange={(v) => setDayWorking(row.day_of_week, v)}
                        testId={`weekly-working-${row.day_of_week}`}
                      />
                    </td>
                    {row.is_working ? (
                      <>
                        <td className="px-3 py-2">
                          <input
                            type="time"
                            className={TIME_INPUT}
                            disabled={!canManage}
                            value={row.start_time || ""}
                            onChange={(e) => updateDay(row.day_of_week, "start_time", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="time"
                            className={TIME_INPUT}
                            disabled={!canManage}
                            value={row.end_time || ""}
                            onChange={(e) => updateDay(row.day_of_week, "end_time", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-0.5">
                            <input
                              type="time"
                              className={TIME_INPUT}
                              disabled={!canManage}
                              value={row.break_start || ""}
                              onChange={(e) => updateDay(row.day_of_week, "break_start", e.target.value)}
                              title="Break start"
                            />
                            <span className="text-[10px] text-[#A89F8B]">–</span>
                            <input
                              type="time"
                              className={TIME_INPUT}
                              disabled={!canManage}
                              value={row.break_end || ""}
                              onChange={(e) => updateDay(row.day_of_week, "break_end", e.target.value)}
                              title="Break end"
                            />
                          </div>
                        </td>
                      </>
                    ) : (
                      <td className="px-3 py-2 text-xs text-[#A89F8B] italic" colSpan={3}>
                        Off day
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        className="bl-input text-xs py-1 w-full max-w-[140px]"
                        disabled={!canManage}
                        placeholder="Optional"
                        value={row.notes || ""}
                        onChange={(e) => updateDay(row.day_of_week, "notes", e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "overrides" && (
        <div className="bl-card p-4" data-testid="date-overrides-calendar">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#2D3A33]">Date overrides</h3>
              <p className="text-xs text-[#5C6C62] mt-0.5">
                Faded text shows the weekly default. Colored badges are overrides.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-2 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] transition"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-[#2D3A33] min-w-[140px] text-center">{monthLabel}</span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-2 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] transition"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={goToday}
                className="ml-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] text-[#52796F]"
              >
                Today
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-[#5C6C62] mb-1.5">
            {WEEKDAYS.map((d) => <div key={d.key}>{d.label}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: pad }, (_, i) => <div key={`pad-${i}`} className="min-h-[88px]" />)}
            {Array.from({ length: calDays }, (_, i) => {
              const day = i + 1;
              const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const ov = overrideByDate[dateStr];
              const defaultRow = weeklyMap[dayKeyFromDate(dateStr)];
              const defaultHint = weeklyCellHint(defaultRow);
              const colors = ov ? STATUS_COLORS[ov.status] : null;
              const isToday = dateStr === new Date().toISOString().slice(0, 10);

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => openOverride(dateStr, ov)}
                  className={`min-h-[88px] rounded-lg border p-1.5 flex flex-col items-stretch text-left transition hover:shadow-sm ${canManage ? "cursor-pointer" : "cursor-default"} ${isToday ? "ring-2 ring-[#52796F]/40" : ""}`}
                  style={{
                    borderColor: ov ? colors?.border : "#EAE6D7",
                    background: ov ? colors?.bg : "#FFFFFF",
                  }}
                  data-testid={`cal-day-${dateStr}`}
                >
                  <span className={`text-sm font-semibold leading-none ${isToday ? "text-[#52796F]" : "text-[#2D3A33]"}`}>
                    {day}
                  </span>
                  {ov ? (
                    <span
                      className="mt-1.5 text-[10px] font-medium leading-tight px-1 py-0.5 rounded"
                      style={{ color: colors?.text, background: `${colors?.border}18` }}
                    >
                      {overrideBadgeText(ov)}
                    </span>
                  ) : (
                    <span className="mt-1.5 text-[10px] text-[#B5B0A3] leading-tight truncate" title={`Weekly: ${defaultHint}`}>
                      {defaultHint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-[#EAE6D7] flex flex-wrap gap-3 text-xs text-[#5C6C62]">
            {OVERRIDE_STATUSES.map((s) => (
              <span key={s.value} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0 border"
                  style={{ background: STATUS_COLORS[s.value]?.bg, borderColor: STATUS_COLORS[s.value]?.border }}
                />
                {s.badge}
                {s.value === "working" && " 09:00–17:00"}
              </span>
            ))}
            <span className="text-[#A89F8B]">· Faded = weekly default</span>
          </div>

          {overrides.length > 0 && (
            <div className="mt-4">
              <div className="label-eyebrow mb-2">Overrides in {monthLabel}</div>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {overrides.map((o) => {
                  const colors = STATUS_COLORS[o.status] || STATUS_COLORS.off;
                  return (
                    <li
                      key={o.date}
                      className="flex items-center justify-between gap-2 text-sm px-2 py-1.5 rounded-lg border"
                      style={{ background: colors.bg, borderColor: colors.border }}
                    >
                      <button
                        type="button"
                        onClick={() => openOverride(o.date, o)}
                        className="text-left flex-1 hover:underline"
                      >
                        <span className="font-mono text-xs">{o.date}</span>
                        <span className="mx-1.5 text-[#A89F8B]">·</span>
                        <span className="font-medium" style={{ color: colors.text }}>{overrideBadgeText(o)}</span>
                        {o.reason ? <span className="text-[#5C6C62]"> — {o.reason}</span> : null}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => removeOverride(o.date)}
                          className="text-xs text-[#B14A2C] hover:underline shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {overrideModal && (
        <div
          className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOverrideModal(null)}
        >
          <div
            className="bl-card w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="override-modal"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-lg text-[#2D3A33]">Date override</h3>
                <p className="text-sm text-[#5C6C62] font-mono mt-0.5">{overrideModal.date}</p>
              </div>
              {overrideModal.existing && canManage && (
                <button
                  type="button"
                  onClick={() => removeOverride(overrideModal.date)}
                  className="text-xs text-[#B14A2C] hover:underline shrink-0"
                >
                  Remove
                </button>
              )}
            </div>

            <div>
              <label className="label-eyebrow block mb-1">Status</label>
              <select
                className="bl-input text-sm w-full"
                disabled={!canManage}
                value={overrideModal.status}
                onChange={(e) => setOverrideModal({ ...overrideModal, status: e.target.value })}
              >
                {OVERRIDE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {needsTimes && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1">Start</label>
                  <input
                    type="time"
                    className="bl-input text-sm w-full"
                    disabled={!canManage}
                    value={overrideModal.start_time}
                    onChange={(e) => setOverrideModal({ ...overrideModal, start_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">End</label>
                  <input
                    type="time"
                    className="bl-input text-sm w-full"
                    disabled={!canManage}
                    value={overrideModal.end_time}
                    onChange={(e) => setOverrideModal({ ...overrideModal, end_time: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label-eyebrow block mb-1">Reason</label>
              <input
                className="bl-input text-sm w-full"
                disabled={!canManage}
                value={overrideModal.reason}
                onChange={(e) => setOverrideModal({ ...overrideModal, reason: e.target.value })}
                placeholder="e.g. Public holiday cover"
              />
            </div>

            <div>
              <label className="label-eyebrow block mb-1">Notes</label>
              <textarea
                className="bl-input text-sm w-full min-h-[72px] resize-y"
                disabled={!canManage}
                value={overrideModal.notes}
                onChange={(e) => setOverrideModal({ ...overrideModal, notes: e.target.value })}
                placeholder="Internal notes (optional)"
              />
            </div>

            <div>
              <label className="label-eyebrow block mb-1">Apply to</label>
              <select
                className="bl-input text-sm w-full"
                disabled={!canManage}
                value={overrideModal.apply_mode}
                onChange={(e) => setOverrideModal({ ...overrideModal, apply_mode: e.target.value })}
              >
                {APPLY_MODES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            {overrideModal.apply_mode === "date_range" && (
              <div>
                <label className="label-eyebrow block mb-1">Range end date</label>
                <input
                  type="date"
                  className="bl-input text-sm w-full"
                  disabled={!canManage}
                  value={overrideModal.range_end}
                  onChange={(e) => setOverrideModal({ ...overrideModal, range_end: e.target.value })}
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {canManage && (
                <button
                  type="button"
                  onClick={saveOverride}
                  disabled={busy}
                  className="bl-btn-primary flex-1 text-sm py-2 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save override"}
                </button>
              )}
              <button type="button" onClick={() => setOverrideModal(null)} className="bl-btn-ghost text-sm py-2">
                {canManage ? "Cancel" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
