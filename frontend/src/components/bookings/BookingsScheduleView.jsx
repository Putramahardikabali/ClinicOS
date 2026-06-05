import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import OvertimeBadge from "@/components/bookings/OvertimeBadge";

const DEFAULT_HOURS = { open: "09:00", close: "20:00" };
const SLOT_PX = 32;
const ROW_H = 52;

const STATUS_BLOCK = {
  booked: { bg: "#E8E0F4", border: "#9B7EC8", text: "#5C3D8A" },
  confirmed: { bg: "#E3F1E8", border: "#52796F", text: "#2C7755" },
  checked_in: { bg: "#D4EDE0", border: "#2C7755", text: "#1F4D3A" },
  completed: { bg: "#F3F1EB", border: "#A89F8B", text: "#5C6C62" },
  blocked: { bg: "#F5E6D3", border: "#C4A574", text: "#6B5344" },
};

function isTimeBlock(booking) {
  return booking?.status === "blocked" || booking?.booking_type === "block";
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayKey(dateStr) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${dateStr}T12:00:00`).getDay()];
}

function hhmmToMin(s) {
  if (!s || !s.includes(":")) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minToLabel(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function bookingStartMin(scheduledAt) {
  const d = new Date(scheduledAt);
  return d.getHours() * 60 + d.getMinutes();
}

function bookingAssignedToStaff(booking, staffId) {
  if (booking.performer_id === staffId) return true;
  return (booking.performers || []).some((p) => p.staff_id === staffId);
}

function formatStaffRole(role) {
  if (!role) return "";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Mirrors backend staff_scheduling.slot_fits — staff schedule only, not clinic hours. */
function staffSlotFits(effective, slotStart, slotEnd) {
  if (!effective?.is_working) {
    return { available: false, reason: "Unavailable" };
  }
  const workWindows = (effective.work_windows || []).map((w) => [w.start, w.end]);
  const blockRanges = (effective.block_ranges || []).map((b) => [b.start, b.end]);
  if (!workWindows.length) {
    return { available: false, reason: "Unavailable" };
  }
  const inWork = workWindows.some(([a, b]) => a <= slotStart && slotEnd <= b);
  if (!inWork) {
    return { available: false, reason: "Outside working hours" };
  }
  for (const [b0, b1] of blockRanges) {
    if (slotEnd > b0 && slotStart < b1) {
      return { available: false, reason: "Unavailable" };
    }
  }
  return { available: true, reason: "" };
}

function slotOverlapsBooking(bookings, staffId, slotStart, slotEnd) {
  return bookings.some((b) => {
    if (!bookingAssignedToStaff(b, staffId)) return false;
    if (b.status === "cancelled" || b.status === "no_show") return false;
    const start = bookingStartMin(b.scheduled_at);
    const end = start + (b.duration_min || 30);
    return slotEnd > start && slotStart < end;
  });
}

function BookingBlock({ booking, openMin, interval, onSelect }) {
  const start = bookingStartMin(booking.scheduled_at);
  const dur = booking.duration_min || 30;
  const left = ((start - openMin) / interval) * SLOT_PX;
  const width = Math.max((dur / interval) * SLOT_PX - 2, SLOT_PX - 2);
  const block = isTimeBlock(booking);
  const st = block ? STATUS_BLOCK.blocked : (STATUS_BLOCK[booking.status] || STATUS_BLOCK.booked);
  const timeLabel = new Date(booking.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const label = block ? (booking.block_reason || booking.patient_name) : booking.patient_name;
  const sub = block ? "Blocked" : booking.treatment;
  const overtime = !block && booking.is_overtime;

  return (
    <button
      type="button"
      onClick={() => onSelect(booking)}
      className={`absolute top-1 bottom-1 z-10 rounded-md border text-left px-2 py-1 overflow-hidden transition cursor-pointer hover:shadow-sm hover:ring-1 hover:ring-[#2D3A33]/10 hover:brightness-[0.98] active:scale-[0.99] ${block ? "border-dashed" : ""}`}
      style={{ left, width, background: st.bg, borderColor: st.border, color: st.text }}
      data-testid={`schedule-block-${booking.id}`}
      title={block ? `Blocked · ${label}` : `${label} · ${booking.treatment}${overtime ? " · Overtime" : ""}`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <div className="text-xs font-semibold truncate leading-tight flex-1">{label}</div>
        {overtime && <OvertimeBadge className="shrink-0 scale-90" />}
      </div>
      <div className="text-[10px] truncate opacity-85 leading-tight">{sub}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{timeLabel} · {dur}m</div>
    </button>
  );
}

function StaffRow({
  staff,
  bookings,
  openMin,
  closeMin,
  interval,
  gridWidth,
  onSelectBooking,
  onEmptyClick,
  onOvertimeSlot,
  effective,
  canManage,
  canCreateOvertime,
}) {
  const rowBookings = bookings.filter(
    (b) =>
      bookingAssignedToStaff(b, staff.id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );
  const slotCount = (closeMin - openMin) / interval;

  return (
    <div className="flex border-b border-[#EAE6D7]" data-testid={`schedule-row-${staff.id}`}>
      <div
        className="shrink-0 border-r border-[#EAE6D7] bg-[#FAFAF7] px-3 py-2.5 flex flex-col justify-center"
        style={{ width: 148 }}
      >
        <div className="text-sm font-semibold text-[#2D3A33] truncate leading-snug">{staff.name}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#A89F8B] mt-0.5">{formatStaffRole(staff.role)}</div>
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ height: ROW_H, minWidth: gridWidth }}>
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${slotCount}, ${SLOT_PX}px)` }}
        >
          {Array.from({ length: slotCount }, (_, i) => {
            const slotMin = openMin + i * interval;
            const slotEnd = slotMin + interval;
            const h = Math.floor(slotMin / 60);
            const m = slotMin % 60;
            const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            const { available, reason } = staffSlotFits(effective, slotMin, slotEnd);
            const occupied = slotOverlapsBooking(bookings, staff.id, slotMin, slotEnd);
            const clickable = canManage && available && !occupied;
            const isOutsideHours = !available && reason === "Outside working hours";
            const overtimeClickable =
              canCreateOvertime && effective?.is_working && isOutsideHours && !occupied;
            const title = occupied
              ? "Booked"
              : clickable
                ? `Book ${staff.name} at ${timeStr}`
                : overtimeClickable
                  ? "Outside working hours — overtime appointment"
                  : reason || "Unavailable";

            if (clickable) {
              return (
                <button
                  key={i}
                  type="button"
                  className="border-r border-[#F0EDE4] hover:bg-[#F8F5EC]/80 h-full cursor-pointer"
                  onClick={() => onEmptyClick({ scheduled_date: null, scheduled_time: timeStr, performer_id: staff.id })}
                  aria-label={title}
                  title={title}
                />
              );
            }

            if (overtimeClickable) {
              return (
                <button
                  key={i}
                  type="button"
                  className="border-r border-[#F0EDE4] h-full bg-[#F3F1EB]/55 cursor-pointer hover:bg-[#EDE8DC]/90"
                  onClick={() =>
                    onOvertimeSlot({
                      scheduled_date: null,
                      scheduled_time: timeStr,
                      performer_id: staff.id,
                      staff,
                      effective,
                    })
                  }
                  aria-label={title}
                  title={title}
                  data-testid={`schedule-slot-overtime-${staff.id}-${timeStr}`}
                />
              );
            }

            return (
              <div
                key={i}
                className="border-r border-[#F0EDE4] h-full bg-[#F3F1EB]/55 cursor-default"
                aria-hidden={!available && !occupied}
                title={title}
                data-testid={`schedule-slot-disabled-${staff.id}-${timeStr}`}
              />
            );
          })}
        </div>
        {rowBookings.map((b) => (
          <BookingBlock
            key={b.id}
            booking={b}
            openMin={openMin}
            interval={interval}
            onSelect={onSelectBooking}
          />
        ))}
      </div>
    </div>
  );
}

export default function BookingsScheduleView({
  clinic,
  date,
  onDateChange,
  statusFilter,
  onSelectBooking,
  onEmptySlot,
  onOvertimeSlot,
  canManage,
  canCreateOvertime = false,
  reloadAt = 0,
}) {
  const [bookings, setBookings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [effectiveByStaff, setEffectiveByStaff] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = { date };
    if (statusFilter) params.status = statusFilter;
    Promise.all([
      api.get("/bookings", { params }),
      api.get("/users"),
      api.get("/staff/schedule/effective", { params: { date } }),
    ])
      .then(([bRes, uRes, effRes]) => {
        setBookings(bRes.data || []);
        const list = (uRes.data || []).filter(
          (u) => ["doctor", "therapist", "nurse"].includes(u.role) && u.active !== false,
        );
        setStaff(list);
        const map = {};
        for (const row of effRes.data || []) {
          map[row.staff_id] = row;
        }
        setEffectiveByStaff(map);
      })
      .catch(() => {
        setBookings([]);
        setStaff([]);
        setEffectiveByStaff({});
      })
      .finally(() => setLoading(false));
  }, [date, statusFilter]);

  useEffect(() => {
    load();
  }, [load, reloadAt]);

  const { openMin, closeMin, interval, closed, closedReason, gridWidth, hourMarks } = useMemo(() => {
    const dk = dayKey(date);
    const hours = clinic?.operating_hours || {};
    const dayH = hours[dk] || DEFAULT_HOURS;
    const closedDate = (clinic?.closed_dates || []).find((d) => d.date === date);
    const iv = Math.max(5, Number(clinic?.booking_slot_interval) || 30);
    let o = hhmmToMin(dayH.open) ?? hhmmToMin(DEFAULT_HOURS.open);
    let c = hhmmToMin(dayH.close) ?? hhmmToMin(DEFAULT_HOURS.close);
    if (o == null || c == null || o >= c) {
      return { openMin: 540, closeMin: 1200, interval: iv, closed: true, closedReason: "Clinic closed", gridWidth: 0, hourMarks: [] };
    }
    if (closedDate) {
      return { openMin: o, closeMin: c, interval: iv, closed: true, closedReason: closedDate.reason || "Clinic closed", gridWidth: 0, hourMarks: [] };
    }
    const slots = (c - o) / iv;
    const marks = [];
    for (let m = o; m < c; m += 60) {
      if (m >= o && m < c) marks.push({ min: m, left: ((m - o) / iv) * SLOT_PX });
    }
    return {
      openMin: o,
      closeMin: c,
      interval: iv,
      closed: false,
      closedReason: "",
      gridWidth: slots * SLOT_PX,
      hourMarks: marks,
    };
  }, [clinic, date]);

  const workingStaff = useMemo(
    () => staff.filter((s) => effectiveByStaff[s.id]?.is_working === true),
    [staff, effectiveByStaff],
  );

  const therapists = workingStaff.filter((s) => s.role === "therapist");
  const doctors = workingStaff.filter((s) => s.role === "doctor");
  const nurses = workingStaff.filter((s) => s.role === "nurse");

  const unassigned = bookings.filter(
    (b) =>
      !isTimeBlock(b) &&
      !b.performer_id &&
      !(b.performers || []).some((p) => p.staff_id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );

  const isToday = date === toDateStr(new Date());
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const shiftDay = (delta) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    onDateChange(toDateStr(d));
  };

  const handleEmptyClick = (partial) => {
    if (!canManage) return;
    onEmptySlot({ scheduled_date: date, scheduled_time: partial.scheduled_time, performer_id: partial.performer_id });
  };

  const renderSection = (label, members) => {
    if (members.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#5C6C62] bg-[#F3F1EB] border-b border-[#EAE6D7] sticky left-0">
          {label}
        </div>
        {members.map((s) => (
          <StaffRow
            key={s.id}
            staff={s}
            bookings={bookings}
            openMin={openMin}
            closeMin={closeMin}
            interval={interval}
            gridWidth={gridWidth}
            onSelectBooking={onSelectBooking}
            onEmptyClick={handleEmptyClick}
            onOvertimeSlot={onOvertimeSlot}
            effective={effectiveByStaff[s.id]}
            canManage={canManage}
            canCreateOvertime={canCreateOvertime}
          />
        ))}
      </div>
    );
  };

  const hasWorkingStaff = workingStaff.length > 0;

  return (
    <div data-testid="bookings-schedule-view">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shiftDay(-1)} className="p-2 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB]" data-testid="schedule-prev-day">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="font-display text-lg text-[#2D3A33] min-w-[140px] text-center" data-testid="schedule-date-label">
            {dateLabel}
          </div>
          <button type="button" onClick={() => shiftDay(1)} className="p-2 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB]" data-testid="schedule-next-day">
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button type="button" onClick={() => onDateChange(toDateStr(new Date()))} className="bl-btn-ghost text-sm" data-testid="schedule-today">
              Today
            </button>
          )}
        </div>
        <div className="text-xs text-[#A89F8B]">
          Click an open slot to book · click a block for details
        </div>
      </div>

      {loading ? (
        <div className="bl-card p-10 text-center text-[#5C6C62]">Loading schedule…</div>
      ) : closed ? (
        <div className="bl-card p-8 text-center text-[#5C6C62]" data-testid="schedule-closed">
          {closedReason} on {dateLabel}.
        </div>
      ) : staff.length === 0 ? (
        <div className="bl-card p-8 text-center text-[#5C6C62]">
          No clinical staff configured. Add doctors, therapists, or nurses in Staff.
        </div>
      ) : !hasWorkingStaff ? (
        <div className="bl-card p-8 text-center text-[#5C6C62]" data-testid="schedule-no-working-staff">
          No staff scheduled to work on {dateLabel}. Adjust staff schedules or pick another day.
        </div>
      ) : (
        <div className="bl-card overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: 148 + gridWidth }}>
              <div className="flex border-b border-[#EAE6D7] bg-[#F8F5EC] sticky top-0 z-10">
                <div className="shrink-0 px-3 py-2 text-xs uppercase tracking-widest text-[#5C6C62]" style={{ width: 148 }}>
                  Staff
                </div>
                <div className="relative" style={{ width: gridWidth, height: 32 }}>
                  {hourMarks.map((h) => (
                    <div
                      key={h.min}
                      className="absolute top-0 text-[10px] text-[#5C6C62] whitespace-nowrap"
                      style={{ left: h.left }}
                    >
                      {minToLabel(h.min)}
                    </div>
                  ))}
                </div>
              </div>

              {renderSection("Doctors", doctors)}
              {renderSection("Therapists", therapists)}
              {renderSection("Nurses", nurses)}

              {unassigned.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#B14A2C] bg-[#FAE5DC]/40 border-b border-[#EAE6D7]">
                    Unassigned ({unassigned.length})
                  </div>
                  <div className="px-5 py-3 flex flex-wrap gap-2">
                    {unassigned.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectBooking(b)}
                        className="text-left px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-[#F8F5EC]"
                        style={{ borderColor: "#EAE6D7", background: "#FFF8F5" }}
                        data-testid={`schedule-unassigned-${b.id}`}
                      >
                        <div className="font-medium">{b.patient_name}</div>
                        <div className="text-xs text-[#5C6C62]">
                          {new Date(b.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {b.treatment}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#A89F8B]" data-testid="schedule-legend">
        {Object.entries(STATUS_BLOCK).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className={`w-2.5 h-2.5 rounded-sm border ${k === "blocked" ? "border-dashed" : ""}`}
              style={{ background: v.bg, borderColor: v.border }}
            />
            {k === "blocked" ? "Blocked time" : k.replace("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export { toDateStr as scheduleDateStr };
