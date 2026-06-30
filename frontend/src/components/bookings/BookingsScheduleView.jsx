import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import OvertimeBadge from "@/components/bookings/OvertimeBadge";
import {
  getClinicNowParts,
  hhmmToMin,
  isPastEmptySlot,
  loadScheduleOrientation,
  minToHhmm,
  minutesToTimeLabel,
  resolveClinicTimezone,
  resolveEmptySlotState,
  saveScheduleOrientation,
} from "@/components/bookings/scheduleUtils";
import {
  clipDragRangeToValid,
  isDragRangeSelection,
  isSlotSelectableForDrag,
  normalizeDragRange,
  SCHEDULE_DRAG_THRESHOLD_PX,
  slotInDragPreview,
} from "@/components/bookings/scheduleDragSelect";

const DEFAULT_HOURS = { open: "09:00", close: "20:00" };
const SLOT_PX = 32;
const ROW_H = 52;
const STAFF_COL_W = 132;
const TIME_COL_W = 76;

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

function slotOverlapsBooking(bookings, staffId, slotStart, slotEnd) {
  return bookings.some((b) => {
    if (!bookingAssignedToStaff(b, staffId)) return false;
    if (b.status === "cancelled" || b.status === "no_show") return false;
    const start = bookingStartMin(b.scheduled_at);
    const end = start + (b.duration_min || 30);
    return slotEnd > start && slotStart < end;
  });
}

function BookingBlock({ booking, openMin, interval, onSelect, orientation = "horizontal" }) {
  const start = bookingStartMin(booking.scheduled_at);
  const dur = booking.duration_min || 30;
  const block = isTimeBlock(booking);
  const st = block ? STATUS_BLOCK.blocked : (STATUS_BLOCK[booking.status] || STATUS_BLOCK.booked);
  const timeLabel = new Date(booking.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const label = block ? (booking.block_reason || booking.patient_name) : booking.patient_name;
  const sub = block ? "Blocked" : booking.treatment;
  const overtime = !block && booking.is_overtime;

  const style =
    orientation === "vertical"
      ? {
          top: ((start - openMin) / interval) * ROW_H,
          height: Math.max((dur / interval) * ROW_H - 2, ROW_H - 2),
          left: 2,
          right: 2,
        }
      : {
          left: ((start - openMin) / interval) * SLOT_PX,
          width: Math.max((dur / interval) * SLOT_PX - 2, SLOT_PX - 2),
        };

  return (
    <button
      type="button"
      onClick={() => onSelect(booking)}
      className={`absolute z-10 rounded-md border text-left px-2 py-1 overflow-hidden transition cursor-pointer hover:shadow-sm hover:ring-1 hover:ring-[#2D3A33]/10 hover:brightness-[0.98] active:scale-[0.99] ${block ? "border-dashed" : ""}`}
      style={{ ...style, background: st.bg, borderColor: st.border, color: st.text }}
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

function ScheduleSlotCell({
  state,
  timeStr,
  staffId,
  slotMin,
  slotEnd,
  onSlotPointerDown,
  onSlotPointerEnter,
  onOvertimeClick,
  orientation,
  highlighted,
}) {
  const edge =
    orientation === "vertical"
      ? "border-b border-[#F0EDE4] w-full"
      : "border-r border-[#F0EDE4] h-full";
  const testSuffix = `${staffId}-${timeStr}`;
  const highlightCls = highlighted ? "bg-[#D4E8E0]/60 ring-1 ring-inset ring-[#52796F]/35" : "";

  if (state.kind === "available") {
    return (
      <button
        type="button"
        className={`${edge} hover:bg-[#F8F5EC]/80 cursor-pointer select-none relative z-[1] ${highlightCls} ${orientation === "vertical" ? "min-h-[52px] w-full" : ""}`}
        style={orientation === "vertical" ? { height: ROW_H } : undefined}
        data-schedule-slot=""
        data-staff-id={staffId}
        data-slot-min={slotMin}
        data-slot-end={slotEnd}
        onPointerDown={(e) => onSlotPointerDown?.(e, { staffId, slotMin, slotEnd })}
        onPointerEnter={(e) => onSlotPointerEnter?.(e, { staffId, slotMin, slotEnd })}
        aria-label={state.title}
        title={state.title}
        data-testid={`schedule-slot-available-${testSuffix}`}
      />
    );
  }

  if (state.kind === "overtime") {
    return (
      <button
        type="button"
        className={`${edge} bg-[#F3F1EB]/55 cursor-pointer hover:bg-[#EDE8DC]/90 ${orientation === "vertical" ? "min-h-[52px]" : ""}`}
        style={orientation === "vertical" ? { height: ROW_H } : undefined}
        onClick={onOvertimeClick}
        aria-label={state.title}
        title={state.title}
        data-testid={`schedule-slot-overtime-${testSuffix}`}
      />
    );
  }

  if (state.kind === "past") {
    return (
      <div
        className={`${edge} bg-[#EDE8DC]/70 opacity-60 cursor-not-allowed ${orientation === "vertical" ? "min-h-[52px]" : ""}`}
        style={orientation === "vertical" ? { height: ROW_H } : undefined}
        title="Past time"
        aria-label="Past time"
        data-testid={`schedule-slot-past-${testSuffix}`}
      />
    );
  }

  return (
    <div
      className={`${edge} bg-[#F3F1EB]/55 cursor-default ${orientation === "vertical" ? "min-h-[52px]" : ""}`}
      style={orientation === "vertical" ? { height: ROW_H } : undefined}
      title={state.title}
      data-testid={`schedule-slot-disabled-${testSuffix}`}
    />
  );
}

function StaffRow({
  staff,
  bookings,
  scheduleDate,
  timezone,
  openMin,
  closeMin,
  interval,
  gridWidth,
  onSelectBooking,
  onOvertimeSlot,
  effective,
  canManage,
  canCreateOvertime,
  dragPreview,
  onSlotPointerDown,
  onSlotPointerEnter,
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
        className="shrink-0 border-r border-[#EAE6D7] bg-[#FAFAF7] px-3 py-2.5 flex flex-col justify-center sticky left-0 z-[2]"
        style={{ width: STAFF_COL_W }}
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
            const timeStr = minToHhmm(slotMin);
            const occupied = slotOverlapsBooking(bookings, staff.id, slotMin, slotEnd);
            const state = resolveEmptySlotState({
              scheduleDate,
              slotMin,
              slotEnd,
              timezone,
              effective,
              occupied,
              canManage,
              canCreateOvertime,
              staffName: staff.name,
              timeStr,
            });
            return (
              <ScheduleSlotCell
                key={i}
                state={state}
                timeStr={timeStr}
                staffId={staff.id}
                slotMin={slotMin}
                slotEnd={slotEnd}
                orientation="horizontal"
                highlighted={slotInDragPreview(slotMin, dragPreview, interval) && dragPreview?.staffId === staff.id}
                onSlotPointerDown={onSlotPointerDown}
                onSlotPointerEnter={onSlotPointerEnter}
                onOvertimeClick={() =>
                  onOvertimeSlot({
                    scheduled_time: timeStr,
                    performer_id: staff.id,
                    staff,
                    effective,
                  })
                }
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
            orientation="horizontal"
          />
        ))}
        {dragPreview?.staffId === staff.id && (
          <div
            className="absolute top-0 bottom-0 z-[8] pointer-events-none rounded-sm border border-[#52796F]/35 bg-[#C5DDD4]/40"
            style={{
              left: ((dragPreview.startMin - openMin) / interval) * SLOT_PX,
              width: ((dragPreview.endMinExclusive - dragPreview.startMin) / interval) * SLOT_PX,
            }}
            data-testid="schedule-drag-preview-horizontal"
          >
            <span className="absolute -top-4 left-0 text-[10px] font-medium text-[#2C7755] whitespace-nowrap bg-white/90 px-1 rounded">
              {minToHhmm(dragPreview.startMin)} – {minToHhmm(dragPreview.endMinExclusive)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function StaffColumn({
  staff,
  bookings,
  scheduleDate,
  timezone,
  openMin,
  closeMin,
  interval,
  onSelectBooking,
  onOvertimeSlot,
  effective,
  canManage,
  canCreateOvertime,
  dragPreview,
  onSlotPointerDown,
  onSlotPointerEnter,
}) {
  const rowBookings = bookings.filter(
    (b) =>
      bookingAssignedToStaff(b, staff.id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );
  const slotCount = (closeMin - openMin) / interval;
  const trackHeight = slotCount * ROW_H;

  return (
    <div
      className="shrink-0 border-r border-[#EAE6D7] relative"
      style={{ width: STAFF_COL_W, height: trackHeight }}
      data-testid={`schedule-col-${staff.id}`}
    >
      {Array.from({ length: slotCount }, (_, i) => {
        const slotMin = openMin + i * interval;
        const slotEnd = slotMin + interval;
        const timeStr = minToHhmm(slotMin);
        const occupied = slotOverlapsBooking(bookings, staff.id, slotMin, slotEnd);
        const state = resolveEmptySlotState({
          scheduleDate,
          slotMin,
          slotEnd,
          timezone,
          effective,
          occupied,
          canManage,
          canCreateOvertime,
          staffName: staff.name,
          timeStr,
        });
        return (
          <div key={i} className="absolute left-0 right-0 z-[1]" style={{ top: i * ROW_H, height: ROW_H }}>
            <ScheduleSlotCell
              state={state}
              timeStr={timeStr}
              staffId={staff.id}
              slotMin={slotMin}
              slotEnd={slotEnd}
              orientation="vertical"
              highlighted={slotInDragPreview(slotMin, dragPreview, interval) && dragPreview?.staffId === staff.id}
              onSlotPointerDown={onSlotPointerDown}
              onSlotPointerEnter={onSlotPointerEnter}
              onOvertimeClick={() =>
                onOvertimeSlot({
                  scheduled_time: timeStr,
                  performer_id: staff.id,
                  staff,
                  effective,
                })
              }
            />
          </div>
        );
      })}
      {rowBookings.map((b) => (
        <BookingBlock
          key={b.id}
          booking={b}
          openMin={openMin}
          interval={interval}
          onSelect={onSelectBooking}
          orientation="vertical"
        />
      ))}
      {dragPreview?.staffId === staff.id && (
        <div
          className="absolute left-0 right-0 z-[8] pointer-events-none rounded-sm border border-[#52796F]/35 bg-[#C5DDD4]/40"
          style={{
            top: ((dragPreview.startMin - openMin) / interval) * ROW_H,
            height: ((dragPreview.endMinExclusive - dragPreview.startMin) / interval) * ROW_H,
          }}
          data-testid="schedule-drag-preview-vertical"
        >
          <span className="absolute top-1 left-1 text-[10px] font-medium text-[#2C7755] whitespace-nowrap bg-white/90 px-1 rounded">
            {minToHhmm(dragPreview.startMin)} – {minToHhmm(dragPreview.endMinExclusive)}
          </span>
        </div>
      )}
    </div>
  );
}

function NowIndicator({ orientation, openMin, interval, nowMin }) {
  const offset = ((nowMin - openMin) / interval) * (orientation === "vertical" ? ROW_H : SLOT_PX);
  if (orientation === "vertical") {
    return (
      <div
        className="absolute left-0 right-0 z-[5] pointer-events-none border-t-2 border-[#B45309]/70"
        style={{ top: offset }}
        data-testid="schedule-now-line"
        aria-hidden
      />
    );
  }
  return (
    <div
      className="absolute top-0 bottom-0 z-[5] pointer-events-none border-l-2 border-[#B45309]/70"
      style={{ left: offset }}
      data-testid="schedule-now-line"
      aria-hidden
    />
  );
}

function ScheduleLegend() {
  return (
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
      <span className="inline-flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-sm bg-[#EDE8DC]/70 border border-[#D8D0C0]" />
        Past time
      </span>
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
  onRangeSelect,
  canManage,
  canCreateOvertime = false,
  reloadAt = 0,
  modalPortalRef,
  onFullscreenChange,
}) {
  const [bookings, setBookings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [effectiveByStaff, setEffectiveByStaff] = useState({});
  const [loading, setLoading] = useState(true);
  const [orientation, setOrientation] = useState(() => loadScheduleOrientation());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const [dragPreview, setDragPreview] = useState(null);

  const updateDragPreview = useCallback((preview) => {
    dragPreviewRef.current = preview;
    setDragPreview(preview);
  }, []);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
  }, []);

  useEffect(() => () => clearDrag(), [clearDrag]);

  const timezone = resolveClinicTimezone(clinic);
  const clinicNow = useMemo(() => getClinicNowParts(timezone), [timezone]);
  const isToday = date === clinicNow.dateStr;

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

  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      onFullscreenChange?.(fs);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onFullscreenChange]);

  useEffect(() => {
    onFullscreenChange?.(isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

  const { openMin, closeMin, interval, closed, closedReason, gridWidth, hourMarks, slotCount } = useMemo(() => {
    const dk = dayKey(date);
    const hours = clinic?.operating_hours || {};
    const dayH = hours[dk] || DEFAULT_HOURS;
    const closedDate = (clinic?.closed_dates || []).find((d) => d.date === date);
    const iv = Math.max(5, Number(clinic?.booking_slot_interval) || 30);
    let o = hhmmToMin(dayH.open) ?? hhmmToMin(DEFAULT_HOURS.open);
    let c = hhmmToMin(dayH.close) ?? hhmmToMin(DEFAULT_HOURS.close);
    if (o == null || c == null || o >= c) {
      return { openMin: 540, closeMin: 1200, interval: iv, closed: true, closedReason: "Clinic closed", gridWidth: 0, hourMarks: [], slotCount: 0 };
    }
    if (closedDate) {
      return { openMin: o, closeMin: c, interval: iv, closed: true, closedReason: closedDate.reason || "Clinic closed", gridWidth: 0, hourMarks: [], slotCount: 0 };
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
      slotCount: slots,
    };
  }, [clinic, date]);

  const workingStaff = useMemo(
    () => staff.filter((s) => effectiveByStaff[s.id]?.is_working === true),
    [staff, effectiveByStaff],
  );

  const staffGroups = useMemo(
    () => [
      { label: "Doctors", members: workingStaff.filter((s) => s.role === "doctor") },
      { label: "Therapists", members: workingStaff.filter((s) => s.role === "therapist") },
      { label: "Nurses", members: workingStaff.filter((s) => s.role === "nurse") },
    ].filter((g) => g.members.length > 0),
    [workingStaff],
  );

  const flatStaff = useMemo(() => staffGroups.flatMap((g) => g.members), [staffGroups]);

  const unassigned = bookings.filter(
    (b) =>
      !isTimeBlock(b) &&
      !b.performer_id &&
      !(b.performers || []).some((p) => p.staff_id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );

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

  const handleEmptyClick = useCallback((partial) => {
    if (!canManage) return;
    onEmptySlot({ scheduled_date: date, scheduled_time: partial.scheduled_time, performer_id: partial.performer_id });
  }, [canManage, date, onEmptySlot]);

  const handleOvertimeClick = (partial) => {
    const slotMin = hhmmToMin(partial.scheduled_time);
    if (slotMin == null) return;
    if (isPastEmptySlot({ scheduleDate: date, slotMin, timezone })) return;
    onOvertimeSlot({
      scheduled_date: date,
      scheduled_time: partial.scheduled_time,
      performer_id: partial.performer_id,
      staff: partial.staff,
      effective: partial.effective,
    });
  };

  const isSlotValidForDrag = useCallback(
    (staffId, slotMin, slotEnd) => {
      const occupied = slotOverlapsBooking(bookings, staffId, slotMin, slotEnd);
      return isSlotSelectableForDrag({
        scheduleDate: date,
        slotMin,
        slotEnd,
        timezone,
        effective: effectiveByStaff[staffId],
        occupied,
        canManage,
      });
    },
    [bookings, date, timezone, effectiveByStaff, canManage],
  );

  const finishDrag = useCallback(() => {
    const d = dragRef.current;
    const preview = dragPreviewRef.current;
    dragRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
    if (!d || !preview || preview.staffId !== d.staffId) return;

    const { startMin, endMinExclusive } = preview;
    if (isDragRangeSelection(d.moved, startMin, endMinExclusive, interval)) {
      onRangeSelect?.({
        scheduled_date: date,
        scheduled_time: minToHhmm(startMin),
        scheduled_end_time: minToHhmm(endMinExclusive),
        performer_id: d.staffId,
        duration_min: endMinExclusive - startMin,
        fromDragRange: true,
      });
      return;
    }
    if (!d.moved) {
      handleEmptyClick({ scheduled_time: minToHhmm(d.anchorMin), performer_id: d.staffId });
    }
  }, [date, interval, onRangeSelect, handleEmptyClick]);

  const expandDragToSlot = useCallback(
    (staffId, slotMin, slotEnd, clientX, clientY) => {
      const d = dragRef.current;
      if (!d) return;
      if (staffId !== d.staffId) return;
      const dist = Math.hypot(clientX - d.startX, clientY - d.startY);
      if (dist >= SCHEDULE_DRAG_THRESHOLD_PX) d.moved = true;
      const { startMin, endMinExclusive } = normalizeDragRange(d.anchorMin, slotMin, interval);
      const clipped = clipDragRangeToValid({
        startMin,
        endMinExclusive,
        interval,
        isSlotValid: (sm, se) => isSlotValidForDrag(staffId, sm, se),
      });
      if (clipped) updateDragPreview({ staffId, ...clipped });
    },
    [interval, isSlotValidForDrag, updateDragPreview],
  );

  useEffect(() => {
    const onGlobalPointerUp = () => {
      if (dragRef.current) finishDrag();
    };
    const onGlobalPointerMove = (e) => {
      if (!dragRef.current || (e.buttons & 1) === 0) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slotEl = el?.closest?.("[data-schedule-slot]");
      if (!slotEl) return;
      const staffId = slotEl.getAttribute("data-staff-id");
      const slotMin = Number(slotEl.getAttribute("data-slot-min"));
      const slotEnd = Number(slotEl.getAttribute("data-slot-end"));
      if (!staffId || Number.isNaN(slotMin) || Number.isNaN(slotEnd)) return;
      expandDragToSlot(staffId, slotMin, slotEnd, e.clientX, e.clientY);
    };
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);
    window.addEventListener("pointermove", onGlobalPointerMove);
    return () => {
      window.removeEventListener("pointerup", onGlobalPointerUp);
      window.removeEventListener("pointercancel", onGlobalPointerUp);
      window.removeEventListener("pointermove", onGlobalPointerMove);
    };
  }, [finishDrag, expandDragToSlot]);

  const onSlotPointerDown = useCallback(
    (e, { staffId, slotMin, slotEnd }) => {
      if (!canManage) return;
      if (!isSlotValidForDrag(staffId, slotMin, slotEnd)) return;
      if (e.button !== 0) return;
      dragRef.current = {
        staffId,
        anchorMin: slotMin,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
      };
      updateDragPreview({ staffId, startMin: slotMin, endMinExclusive: slotEnd });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [canManage, isSlotValidForDrag, updateDragPreview],
  );

  const onSlotPointerEnter = useCallback(
    (e, { staffId, slotMin, slotEnd }) => {
      if ((e.buttons & 1) === 0) return;
      expandDragToSlot(staffId, slotMin, slotEnd, e.clientX, e.clientY);
    },
    [expandDragToSlot],
  );

  const setLayout = (next) => {
    setOrientation(next);
    saveScheduleOrientation(next);
  };

  const enterFullscreen = async () => {
    setIsFullscreen(true);
    try {
      if (shellRef.current?.requestFullscreen) {
        await shellRef.current.requestFullscreen();
      }
    } catch {
      /* app-level fullscreen still applies */
    }
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
    setIsFullscreen(false);
  };

  const hasWorkingStaff = workingStaff.length > 0;
  const trackHeight = slotCount * ROW_H;
  const showNow = isToday && clinicNow.minutes >= openMin && clinicNow.minutes < closeMin;

  const gridScrollClass = isFullscreen ? "h-full" : "max-h-[min(72vh,900px)]";

  const renderHorizontal = () => (
    <div className={`overflow-auto ${gridScrollClass}`} data-testid="schedule-horizontal">
      <div style={{ minWidth: STAFF_COL_W + gridWidth }}>
        <div className="flex border-b border-[#EAE6D7] bg-[#F8F5EC] sticky top-0 z-20">
          <div className="shrink-0 px-3 py-2 text-xs uppercase tracking-widest text-[#5C6C62] sticky left-0 z-30 bg-[#F8F5EC]" style={{ width: STAFF_COL_W }}>
            Staff
          </div>
          <div className="relative" style={{ width: gridWidth, height: 32 }}>
            {hourMarks.map((h) => (
              <div
                key={h.min}
                className="absolute top-0 text-[10px] text-[#5C6C62] whitespace-nowrap"
                style={{ left: h.left }}
              >
                {minutesToTimeLabel(h.min)}
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          {showNow && (
            <div className="absolute top-8 bottom-0 z-[5] pointer-events-none" style={{ left: STAFF_COL_W }}>
              <NowIndicator orientation="horizontal" openMin={openMin} interval={interval} nowMin={clinicNow.minutes} />
            </div>
          )}
          {staffGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#5C6C62] bg-[#F3F1EB] border-b border-[#EAE6D7] sticky left-0">
                {group.label}
              </div>
              {group.members.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  bookings={bookings}
                  scheduleDate={date}
                  timezone={timezone}
                  openMin={openMin}
                  closeMin={closeMin}
                  interval={interval}
                  gridWidth={gridWidth}
                  onSelectBooking={onSelectBooking}
                  onOvertimeSlot={handleOvertimeClick}
                  effective={effectiveByStaff[s.id]}
                  canManage={canManage}
                  canCreateOvertime={canCreateOvertime}
                  dragPreview={dragPreview}
                  onSlotPointerDown={onSlotPointerDown}
                  onSlotPointerEnter={onSlotPointerEnter}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderVertical = () => (
    <div className={`overflow-auto ${gridScrollClass}`} data-testid="schedule-vertical">
      <div style={{ minWidth: TIME_COL_W + flatStaff.length * STAFF_COL_W }}>
        {/* Sticky header: time corner + staff names */}
        <div className="flex sticky top-0 z-30 border-b border-[#EAE6D7] bg-[#F8F5EC]">
          <div
            className="sticky left-0 z-40 shrink-0 bg-[#F8F5EC] border-r border-[#EAE6D7]"
            style={{ width: TIME_COL_W }}
          >
            <div className="h-6 border-b border-[#EAE6D7]/80" />
            <div className="h-[56px] px-2 flex items-end pb-2 text-[10px] uppercase tracking-widest text-[#5C6C62]">
              Time
            </div>
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex h-6 border-b border-[#EAE6D7]/80">
              {staffGroups.map((group) => (
                <div
                  key={group.label}
                  className="shrink-0 px-1 text-[9px] uppercase tracking-widest text-[#5C6C62] flex items-center justify-center border-r border-[#EAE6D7] bg-[#F8F5EC]"
                  style={{ width: STAFF_COL_W * group.members.length }}
                >
                  {group.label}
                </div>
              ))}
            </div>
            <div className="flex h-[56px]">
              {flatStaff.map((s) => (
                <div
                  key={s.id}
                  className="shrink-0 px-2 py-2 border-r border-[#EAE6D7] bg-[#FAFAF7] flex flex-col justify-center"
                  style={{ width: STAFF_COL_W }}
                >
                  <div className="text-xs font-semibold text-[#2D3A33] truncate">{s.name}</div>
                  <div className="text-[9px] uppercase tracking-wide text-[#A89F8B]">{formatStaffRole(s.role)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Body: sticky time column + staff grid */}
        <div className="flex relative">
          <div
            className="sticky left-0 z-20 shrink-0 bg-[#F8F5EC] border-r border-[#EAE6D7]"
            style={{ width: TIME_COL_W }}
          >
            {Array.from({ length: slotCount }, (_, i) => {
              const slotMin = openMin + i * interval;
              return (
                <div
                  key={slotMin}
                  className="px-2 text-[10px] text-[#5C6C62] border-b border-[#F0EDE4] flex items-center"
                  style={{ height: ROW_H }}
                >
                  {minutesToTimeLabel(slotMin)}
                </div>
              );
            })}
          </div>

          <div className="relative flex min-w-0" style={{ height: trackHeight }}>
            {showNow && (
              <div
                className="absolute inset-0 z-[5] pointer-events-none"
                data-testid="schedule-now-line-wrap"
              >
                <NowIndicator orientation="vertical" openMin={openMin} interval={interval} nowMin={clinicNow.minutes} />
              </div>
            )}
            {flatStaff.map((s) => (
              <StaffColumn
                key={s.id}
                staff={s}
                bookings={bookings}
                scheduleDate={date}
                timezone={timezone}
                openMin={openMin}
                closeMin={closeMin}
                interval={interval}
                onSelectBooking={onSelectBooking}
                onOvertimeSlot={handleOvertimeClick}
                effective={effectiveByStaff[s.id]}
                canManage={canManage}
                canCreateOvertime={canCreateOvertime}
                dragPreview={dragPreview}
                onSlotPointerDown={onSlotPointerDown}
                onSlotPointerEnter={onSlotPointerEnter}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const shellClass = isFullscreen
    ? "fixed inset-0 z-[70] bg-[#FDFBF7] flex flex-col p-3 sm:p-4 overflow-hidden"
    : "";

  return (
    <div
      ref={shellRef}
      className={shellClass}
      data-testid="bookings-schedule-view"
      data-schedule-fullscreen={isFullscreen ? "true" : "false"}
    >
      <div className={`flex items-center justify-between flex-wrap gap-3 mb-4 ${isFullscreen ? "shrink-0" : ""}`}>
        <div className="flex items-center gap-2 flex-wrap">
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
            <button type="button" onClick={() => onDateChange(clinicNow.dateStr)} className="bl-btn-ghost text-sm" data-testid="schedule-today">
              Today
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-[#EAE6D7] p-0.5 bg-[#F3F1EB]" data-testid="schedule-orientation-toggle">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${orientation === "horizontal" ? "bg-white text-[#2D3A33] shadow-sm" : "text-[#5C6C62]"}`}
              onClick={() => setLayout("horizontal")}
              data-testid="schedule-orientation-horizontal"
            >
              Horizontal
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${orientation === "vertical" ? "bg-white text-[#2D3A33] shadow-sm" : "text-[#5C6C62]"}`}
              onClick={() => setLayout("vertical")}
              data-testid="schedule-orientation-vertical"
            >
              Vertical
            </button>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] text-[#2D3A33]"
            onClick={isFullscreen ? exitFullscreen : enterFullscreen}
            data-testid={isFullscreen ? "schedule-exit-fullscreen" : "schedule-enter-fullscreen"}
            title={isFullscreen ? "Exit full screen" : "View full screen schedule"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      <p className={`text-xs text-[#A89F8B] mb-3 ${isFullscreen ? "shrink-0" : ""}`}>
        Click an open slot to book · drag across slots to block a range · click a block for details
      </p>

      <div className={`${isFullscreen ? "flex-1 min-h-0 overflow-hidden" : ""}`}>
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
          <div className={`bl-card overflow-hidden ${isFullscreen ? "h-full flex flex-col" : ""}`}>
            <div className={isFullscreen ? "flex-1 min-h-0 overflow-auto" : ""}>
              {orientation === "vertical" ? renderVertical() : renderHorizontal()}
            </div>

            {unassigned.length > 0 && (
              <div className="border-t border-[#EAE6D7] px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-[#B14A2C] mb-2">
                  Unassigned ({unassigned.length})
                </div>
                <div className="flex flex-wrap gap-2">
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
        )}
      </div>

      {!isFullscreen && <ScheduleLegend />}

      <div
        ref={modalPortalRef}
        className={isFullscreen ? "fixed inset-0 z-[120] pointer-events-none [&>*]:pointer-events-auto" : "hidden"}
        data-testid="schedule-modal-portal"
        aria-hidden={!isFullscreen}
      />
    </div>
  );
}

export { toDateStr as scheduleDateStr };
