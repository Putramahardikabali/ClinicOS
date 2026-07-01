import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight, Layers, Maximize2, Minimize2 } from "lucide-react";
import OvertimeBadge from "@/components/bookings/OvertimeBadge";
import {
  buildSchedulePreviewLines,
  INDICATOR_DEFS,
  isTimeBlockBooking,
  resolveScheduleCardColors,
  SCHEDULE_STATUS_COLORS,
  selectCardIcons,
  supportsHoverPreview,
} from "@/components/bookings/scheduleBookingIndicators";
import ScheduleFullscreenUtilityRail from "@/components/bookings/ScheduleFullscreenUtilityRail";
import ScheduleUtilityDrawer from "@/components/bookings/ScheduleUtilityDrawer";
import { resolveScheduleUtilityAccess } from "@/components/bookings/scheduleUtilityPermissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { layoutOverlappingBookings } from "@/lib/scheduleOverlapLayout";
import ScheduleMoveConfirmModal from "@/components/bookings/ScheduleMoveConfirmModal";
import {
  APPT_MANIP_THRESHOLD_PX,
  buildScheduledAtIso,
  canManipulateAppointment,
  clampDuration,
  describeScheduleChange,
  findLocalScheduleConflicts,
  pointerToSnappedStartMin,
  resolveStaffIdFromPointer,
} from "@/lib/scheduleAppointmentManip";
import { parseScheduleConflict } from "@/lib/bookingConflicts";
import { hasPermission } from "@/lib/auth";
import { DURATION_SOURCES } from "@/lib/bookingDuration";
import {
  bookingMatchesPatientHighlight,
  countVisiblePatientBookings,
  isHighlightableBooking,
  patientHighlightBannerText,
} from "@/components/bookings/schedulePatientHighlight";
import {
  filterBookingsByScheduleStatus,
  resolveApiStatusFilter,
  SCHEDULE_STATUS_FILTER_OPTIONS,
} from "@/components/bookings/scheduleStatusFilter";
import {
  bookingMatchesScheduleSearch,
  countSearchMatches,
} from "@/components/bookings/scheduleSearch";
import SearchInput from "@/components/ui/SearchInput";
import { toast } from "sonner";

const DEFAULT_HOURS = { open: "09:00", close: "20:00" };
const SLOT_PX = 32;
const ROW_H = 52;
const STAFF_COL_W = 132;
const TIME_COL_W = 76;

function isTimeBlock(booking) {
  return isTimeBlockBooking(booking);
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

function resolveBookingCardHighlight(booking, { patientHighlight, scheduleDate, searchQuery }) {
  const patientMatch = patientHighlight && bookingMatchesPatientHighlight(booking, patientHighlight, scheduleDate);
  const searchActive = Boolean((searchQuery || "").trim());
  const searchMatch = searchActive && bookingMatchesScheduleSearch(booking, searchQuery);
  const dimmed =
    (patientHighlight && !patientMatch && !isTimeBlock(booking))
    || (searchActive && !searchMatch && !isTimeBlock(booking));
  return {
    patientHighlightMatch: patientMatch || searchMatch,
    patientHighlightDimmed: dimmed,
    searchHighlightMatch: searchMatch && !patientMatch,
  };
}

function BookingBlock({
  booking,
  openMin,
  interval,
  onSelect,
  orientation = "horizontal",
  overlapLayout = null,
  canManipulate = false,
  displayOverride = null,
  onManipulateStart,
  patientHighlightMatch = false,
  patientHighlightDimmed = false,
  searchHighlightMatch = false,
  onHighlightPatient,
  tooltipContainer = null,
}) {
  const start = displayOverride?.startMin ?? bookingStartMin(booking.scheduled_at);
  const dur = displayOverride?.durationMin ?? (booking.duration_min || 30);
  const block = isTimeBlock(booking);
  const st = resolveScheduleCardColors(booking);
  const timeLabel = new Date(booking.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const label = block ? (booking.block_reason || booking.patient_name) : booking.patient_name;
  const sub = block ? "Blocked" : booking.treatment;
  const overtime = !block && booking.is_overtime;
  const ghost = Boolean(displayOverride?.ghost);
  const ol = overlapLayout || { column: 0, columns: 1, hasOverlap: false };
  const showOverlapBadge = ol.hasOverlap || booking.overlap_override;
  const { visible: visibleIcons, overflow: iconOverflow } = selectCardIcons(booking);
  const hoverPreview = supportsHoverPreview() && !ghost;
  const previewLines = useMemo(() => {
    const lines = buildSchedulePreviewLines(booking);
    if (showOverlapBadge) {
      lines.push({ label: "Overlap", value: "Overlapping appointment", strong: false });
    }
    return lines;
  }, [booking, showOverlapBadge]);

  const baseSpan = orientation === "vertical"
    ? Math.max((dur / interval) * ROW_H - 2, ROW_H - 2)
    : Math.max((dur / interval) * SLOT_PX - 2, SLOT_PX - 2);
  const baseOffset = orientation === "vertical"
    ? ((start - openMin) / interval) * ROW_H
    : ((start - openMin) / interval) * SLOT_PX;
  const colCount = Math.max(1, ol.columns || 1);
  const col = ol.column || 0;

  const positionStyle =
    orientation === "vertical"
      ? {
          top: baseOffset,
          height: baseSpan,
          left: colCount > 1 ? `calc(2px + ${col} * (100% - 4px) / ${colCount})` : 2,
          right: colCount > 1 ? undefined : 2,
          width: colCount > 1 ? `calc((100% - 4px) / ${colCount} - 2px)` : undefined,
          zIndex: ghost ? 25 : 10,
        }
      : {
          left: baseOffset + (col * baseSpan) / colCount,
          width: Math.max(baseSpan / colCount - 2, SLOT_PX / colCount - 2),
          zIndex: ghost ? 25 : 10,
        };

  const cardStyle = {
    background: st.bg,
    borderColor: st.border,
    color: st.text,
    borderLeftWidth: block ? undefined : 3,
  };

  const cardClasses = `w-full h-full min-h-0 rounded-md border text-left px-2 py-1 overflow-hidden transition hover:shadow-sm hover:ring-1 hover:ring-[#2D3A33]/10 hover:brightness-[0.98] ${block ? "border-dashed" : "border-solid"} ${ghost ? "opacity-75 ring-2 ring-[#52796F]/45 shadow-md" : ""} ${patientHighlightMatch ? "ring-2 ring-[#1D4ED8] ring-offset-1 shadow-[0_0_0_3px_rgba(29,78,216,0.22)] z-20" : ""} ${searchHighlightMatch ? "ring-1 ring-[#52796F]/70 z-[12]" : ""} ${patientHighlightDimmed ? "opacity-40 saturate-50" : ""} ${canManipulate ? "cursor-grab active:cursor-grabbing" : "cursor-pointer active:scale-[0.99]"}`;

  const cardBody = (
    <>
      <div className="flex items-center gap-1 min-w-0">
        <div className="text-xs font-semibold truncate leading-tight flex-1">{label}</div>
        {!block && visibleIcons.length > 0 && (
          <div className="flex items-center gap-0.5 shrink-0" data-testid={`schedule-block-icons-${booking.id}`}>
            {visibleIcons.map((key) => {
              const def = INDICATOR_DEFS[key];
              if (!def) return null;
              const Icon = def.Icon;
              return (
                <span
                  key={key}
                  className="inline-flex items-center justify-center rounded-sm bg-white/50 p-0.5"
                  title={def.title}
                  data-testid={`schedule-icon-${key}-${booking.id}`}
                >
                  <Icon className="w-3 h-3" strokeWidth={2.25} aria-hidden />
                </span>
              );
            })}
            {iconOverflow > 0 && (
              <span className="text-[9px] font-semibold opacity-80 leading-none" data-testid={`schedule-icon-overflow-${booking.id}`}>
                +{iconOverflow}
              </span>
            )}
          </div>
        )}
        {overtime && <OvertimeBadge className="shrink-0 scale-90" />}
        {showOverlapBadge && (
          <span
            className="inline-flex items-center justify-center rounded-sm bg-amber-100/80 text-amber-800 p-0.5 shrink-0"
            title="Overlapping appointment"
            data-testid={`schedule-overlap-${booking.id}`}
          >
            <Layers className="w-3 h-3" strokeWidth={2.25} aria-hidden />
          </span>
        )}
      </div>
      <div className="text-[10px] truncate opacity-85 leading-tight">{sub}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{timeLabel} · {dur}m</div>
      {canManipulate && (
        <div
          role="separator"
          aria-label="Resize appointment"
          className={`absolute opacity-70 hover:opacity-100 bg-[#2D3A33]/20 ${
            orientation === "vertical"
              ? "left-1 right-1 bottom-0 h-2 cursor-ns-resize rounded-b-md"
              : "top-1 bottom-1 right-0 w-2 cursor-ew-resize rounded-r-md"
          }`}
          data-testid={`schedule-resize-handle-${booking.id}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onManipulateStart?.(e, booking, "resize");
          }}
        />
      )}
    </>
  );

  const interactiveCard = canManipulate ? (
    <div
      className={`relative ${cardClasses}`}
      style={cardStyle}
      data-testid={`schedule-block-${booking.id}`}
      onPointerDown={(e) => {
        if (e.target.closest("[data-testid^='schedule-resize-handle-']")) return;
        onManipulateStart?.(e, booking, "move");
      }}
    >
      {cardBody}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => onSelect(booking)}
      className={cardClasses}
      style={cardStyle}
      data-testid={`schedule-block-${booking.id}`}
    >
      {cardBody}
    </button>
  );

  const positionedCard = (
    <div
      className="absolute"
      style={positionStyle}
      data-patient-highlight-match={patientHighlightMatch ? "true" : undefined}
    >
      {hoverPreview && !block ? (
        <Tooltip delayDuration={280}>
          <TooltipTrigger asChild>{interactiveCard}</TooltipTrigger>
          <TooltipContent
            container={tooltipContainer}
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={tooltipContainer ? { top: 8, bottom: 8, left: 8, right: 88 } : 8}
            className={`max-w-[260px] p-0 border border-[#EAE6D7] bg-white text-[#2D3A33] shadow-lg rounded-lg ${tooltipContainer ? "z-[95]" : "z-50"}`}
            data-testid={`schedule-preview-${booking.id}`}
          >
            <div className="px-3 py-2.5 space-y-1.5">
              {previewLines.map((line) => (
                <div key={line.label} className="text-xs leading-snug">
                  <span className="text-[#A89F8B]">{line.label}: </span>
                  <span className={line.strong ? "font-semibold text-[#2D3A33]" : "text-[#5C6C62]"}>{line.value}</span>
                </div>
              ))}
              {onHighlightPatient && booking.patient_id && !block && (
                <button
                  type="button"
                  className="mt-2 w-full text-left text-xs font-medium text-[#1D4ED8] hover:underline"
                  data-testid={`schedule-preview-highlight-${booking.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onHighlightPatient(booking);
                  }}
                >
                  Highlight Patient
                </button>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        interactiveCard
      )}
    </div>
  );

  return positionedCard;
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
  canDragResize,
  apptManip,
  onManipulateStart,
  dragPreview,
  onSlotPointerDown,
  onSlotPointerEnter,
  patientHighlight,
  onHighlightPatient,
  searchQuery = "",
  tooltipContainer = null,
}) {
  const rowBookings = bookings.filter(
    (b) =>
      bookingAssignedToStaff(b, staff.id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );
  const overlapLayout = useMemo(() => layoutOverlappingBookings(rowBookings), [rowBookings]);
  const slotCount = (closeMin - openMin) / interval;

  const renderBooking = (b) => {
    const manipulable = canDragResize && canManipulateAppointment(b, canManage);
    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate, searchQuery });
    const blockProps = {
      ...highlight,
      onHighlightPatient,
      tooltipContainer,
    };
    if (apptManip?.bookingId === b.id) {
      if (apptManip.preview.staffId !== staff.id) return null;
      return (
        <BookingBlock
          key={`${b.id}-ghost`}
          booking={b}
          openMin={openMin}
          interval={interval}
          onSelect={onSelectBooking}
          orientation="horizontal"
          overlapLayout={overlapLayout.get(b.id)}
          canManipulate={false}
          displayOverride={{
            startMin: apptManip.preview.startMin,
            durationMin: apptManip.preview.durationMin,
            ghost: true,
          }}
          {...blockProps}
        />
      );
    }
    if (!bookingAssignedToStaff(b, staff.id)) return null;
    return (
      <BookingBlock
        key={b.id}
        booking={b}
        openMin={openMin}
        interval={interval}
        onSelect={onSelectBooking}
        orientation="horizontal"
        overlapLayout={overlapLayout.get(b.id)}
        canManipulate={manipulable}
        onManipulateStart={onManipulateStart}
        {...blockProps}
      />
    );
  };

  const visibleBookings = useMemo(() => {
    const ids = new Set(rowBookings.map((b) => b.id));
    if (apptManip?.preview?.staffId === staff.id && !ids.has(apptManip.bookingId)) {
      const dragged = bookings.find((b) => b.id === apptManip.bookingId);
      return dragged ? [...rowBookings, dragged] : rowBookings;
    }
    return rowBookings;
  }, [rowBookings, bookings, apptManip, staff.id]);

  return (
    <div className="flex border-b border-[#EAE6D7]" data-testid={`schedule-row-${staff.id}`}>
      <div
        className="shrink-0 border-r border-[#EAE6D7] bg-[#FAFAF7] px-3 py-2.5 flex flex-col justify-center sticky left-0 z-[2]"
        style={{ width: STAFF_COL_W }}
      >
        <div className="text-sm font-semibold text-[#2D3A33] truncate leading-snug">{staff.name}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#A89F8B] mt-0.5">{formatStaffRole(staff.role)}</div>
      </div>
      <div
        className="relative flex-1 overflow-hidden"
        style={{ height: ROW_H, minWidth: gridWidth }}
        data-schedule-track=""
        data-staff-id={staff.id}
        data-open-min={openMin}
        data-close-min={closeMin}
        data-interval={interval}
        data-orientation="horizontal"
      >
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
        {visibleBookings.map((b) => renderBooking(b))}
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
  canDragResize,
  apptManip,
  onManipulateStart,
  dragPreview,
  onSlotPointerDown,
  onSlotPointerEnter,
  patientHighlight,
  onHighlightPatient,
  searchQuery = "",
  tooltipContainer = null,
}) {
  const rowBookings = bookings.filter(
    (b) =>
      bookingAssignedToStaff(b, staff.id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );
  const overlapLayout = useMemo(() => layoutOverlappingBookings(rowBookings), [rowBookings]);
  const slotCount = (closeMin - openMin) / interval;
  const trackHeight = slotCount * ROW_H;

  const renderBooking = (b) => {
    const manipulable = canDragResize && canManipulateAppointment(b, canManage);
    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate, searchQuery });
    const blockProps = {
      ...highlight,
      onHighlightPatient,
      tooltipContainer,
    };
    if (apptManip?.bookingId === b.id) {
      if (apptManip.preview.staffId !== staff.id) return null;
      return (
        <BookingBlock
          key={`${b.id}-ghost`}
          booking={b}
          openMin={openMin}
          interval={interval}
          onSelect={onSelectBooking}
          orientation="vertical"
          overlapLayout={overlapLayout.get(b.id)}
          canManipulate={false}
          displayOverride={{
            startMin: apptManip.preview.startMin,
            durationMin: apptManip.preview.durationMin,
            ghost: true,
          }}
          {...blockProps}
        />
      );
    }
    if (!bookingAssignedToStaff(b, staff.id)) return null;
    return (
      <BookingBlock
        key={b.id}
        booking={b}
        openMin={openMin}
        interval={interval}
        onSelect={onSelectBooking}
        orientation="vertical"
        overlapLayout={overlapLayout.get(b.id)}
        canManipulate={manipulable}
        onManipulateStart={onManipulateStart}
        {...blockProps}
      />
    );
  };

  const visibleBookings = useMemo(() => {
    const ids = new Set(rowBookings.map((b) => b.id));
    if (apptManip?.preview?.staffId === staff.id && !ids.has(apptManip.bookingId)) {
      const dragged = bookings.find((b) => b.id === apptManip.bookingId);
      return dragged ? [...rowBookings, dragged] : rowBookings;
    }
    return rowBookings;
  }, [rowBookings, bookings, apptManip, staff.id]);

  return (
    <div
      className="shrink-0 border-r border-[#EAE6D7] relative"
      style={{ width: STAFF_COL_W, height: trackHeight }}
      data-testid={`schedule-col-${staff.id}`}
      data-schedule-track=""
      data-staff-id={staff.id}
      data-open-min={openMin}
      data-close-min={closeMin}
      data-interval={interval}
      data-orientation="vertical"
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
      {visibleBookings.map((b) => renderBooking(b))}
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
  const legendKeys = [
    "booked",
    "confirmed",
    "checked_in",
    "treatment_started",
    "closed",
    "completed",
    "block_out",
    "unavailable",
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#A89F8B]" data-testid="schedule-legend">
      {legendKeys.map((k) => {
        const v = SCHEDULE_STATUS_COLORS[k];
        if (!v) return null;
        return (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className={`w-2.5 h-2.5 rounded-sm border ${k === "block_out" ? "border-dashed" : ""}`}
              style={{ background: v.bg, borderColor: v.border }}
            />
            {v.label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-sm bg-[#EDE8DC]/70 border border-[#D8D0C0]" />
        Past time
      </span>
    </div>
  );
}

export default function BookingsScheduleView({
  clinic,
  user,
  date,
  onDateChange,
  statusFilter,
  onStatusFilterChange,
  onSelectBooking,
  onEmptySlot,
  onOvertimeSlot,
  onRangeSelect,
  canManage,
  canCreateOvertime = false,
  reloadAt = 0,
  modalPortalRef,
  onFullscreenChange,
  highlightApiRef,
  onHighlightActivated,
}) {
  const [bookings, setBookings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [effectiveByStaff, setEffectiveByStaff] = useState({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  const lastReloadAtRef = useRef(0);
  const lastRefreshErrorAtRef = useRef(0);
  const [orientation, setOrientation] = useState(() => loadScheduleOrientation());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeUtility, setActiveUtility] = useState(null);
  const [patientHighlight, setPatientHighlight] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const [dragPreview, setDragPreview] = useState(null);
  const apptManipRef = useRef(null);
  const [apptManip, setApptManip] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const canDragResize = canManage && hasPermission(user, "appointments.edit");
  const canOverrideConflict = useMemo(() => {
    if (!user) return false;
    if (["super_admin", "manager"].includes(user.role)) return true;
    return hasPermission(user, "appointments.override_conflict") || hasPermission(user, "appointments.edit");
  }, [user]);

  const staffById = useMemo(
    () => Object.fromEntries(staff.map((s) => [s.id, s])),
    [staff],
  );

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

  const load = useCallback(async ({ silent = false } = {}) => {
    const isBackground = silent || hasLoadedRef.current;
    const seq = ++loadSeqRef.current;
    if (!isBackground) setInitialLoading(true);
    else setRefreshing(true);

    const params = { date, schedule_meta: true };
    const apiStatus = resolveApiStatusFilter(statusFilter);
    if (apiStatus) params.status = apiStatus;

    try {
      const [bRes, uRes, effRes] = await Promise.all([
        api.get("/bookings", { params }),
        api.get("/users"),
        api.get("/staff/schedule/effective", { params: { date } }),
      ]);
      if (seq !== loadSeqRef.current) return;

      let items = bRes.data || [];
      items = filterBookingsByScheduleStatus(items, statusFilter);
      setBookings(items);
      const list = (uRes.data || []).filter(
        (u) => ["doctor", "therapist", "nurse"].includes(u.role) && u.active !== false,
      );
      setStaff(list);
      const map = {};
      for (const row of effRes.data || []) {
        map[row.staff_id] = row;
      }
      setEffectiveByStaff(map);
      hasLoadedRef.current = true;
    } catch {
      if (seq !== loadSeqRef.current) return;
      if (!isBackground) {
        setBookings([]);
        setStaff([]);
        setEffectiveByStaff({});
      } else {
        const now = Date.now();
        if (now - lastRefreshErrorAtRef.current > 60000) {
          lastRefreshErrorAtRef.current = now;
          toast.message("Could not refresh schedule — showing last loaded data");
        }
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [date, statusFilter]);

  useEffect(() => {
    load({ silent: hasLoadedRef.current });
  }, [date, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!reloadAt || reloadAt === lastReloadAtRef.current) return;
    lastReloadAtRef.current = reloadAt;
    load({ silent: true });
  }, [reloadAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearPatientHighlight = useCallback(() => {
    setPatientHighlight(null);
  }, []);

  const activatePatientHighlight = useCallback(async (booking) => {
    if (!isHighlightableBooking(booking)) {
      toast.error("This appointment has no linked patient to highlight.");
      return;
    }
    const patientId = booking.patient_id;
    const patientName = booking.patient_name || "Patient";
    let totalCount = 0;
    let hiddenCount = 0;
    try {
      const r = await api.get("/bookings", {
        params: { date, patient_id: patientId, appointments_only: true },
      });
      const all = (r.data || []).filter(
        (b) => isHighlightableBooking(b) && (b.scheduled_at || "").slice(0, 10) === date,
      );
      totalCount = all.length;
      const visibleCount = countVisiblePatientBookings(bookings, patientId, date);
      hiddenCount = Math.max(0, totalCount - visibleCount);
    } catch {
      totalCount = countVisiblePatientBookings(bookings, patientId, date);
    }
    const visibleCount = countVisiblePatientBookings(bookings, patientId, date);
    setPatientHighlight({
      patientId,
      patientName,
      totalCount: totalCount || visibleCount,
      visibleCount,
      hiddenCount,
    });
    setActiveUtility(null);
    onHighlightActivated?.();
  }, [bookings, date, onHighlightActivated]);

  useEffect(() => {
    if (!highlightApiRef) return undefined;
    highlightApiRef.current = {
      highlightFromBooking: activatePatientHighlight,
      clearHighlight: clearPatientHighlight,
    };
    return () => {
      if (highlightApiRef.current) highlightApiRef.current = null;
    };
  }, [highlightApiRef, activatePatientHighlight, clearPatientHighlight]);

  useEffect(() => {
    clearPatientHighlight();
    setSearchQuery("");
  }, [date, statusFilter, clearPatientHighlight]);

  useEffect(() => {
    if (!patientHighlight) return undefined;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector('[data-patient-highlight-match="true"]');
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [patientHighlight, bookings, orientation]);

  const onHighlightPatient = useCallback((booking) => {
    activatePatientHighlight(booking);
  }, [activatePatientHighlight]);

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

  useEffect(() => {
    if (!isFullscreen) setActiveUtility(null);
  }, [isFullscreen]);

  const utilityAccess = useMemo(
    () => resolveScheduleUtilityAccess(user, clinic),
    [user, clinic],
  );

  useEffect(() => {
    if (!isFullscreen || !activeUtility) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setActiveUtility(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isFullscreen, activeUtility]);

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
    if (apptManipRef.current) return;
    const d = dragRef.current;
    const preview = dragPreviewRef.current;
    dragRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
    if (!d || !preview || preview.staffId !== d.staffId) return;

    const { startMin, endMinExclusive } = preview;
    if (isDragRangeSelection(d.moved, startMin, endMinExclusive, interval)) {
      const startTime = minToHhmm(startMin);
      const endTime = minToHhmm(endMinExclusive);
      onRangeSelect?.({
        scheduled_date: date,
        scheduled_time: startTime,
        scheduled_end_time: endTime,
        selected_start_time: startTime,
        selected_end_time: endTime,
        selected_range_label: `${startTime}–${endTime}`,
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

  const trackParamsFromEl = useCallback((trackEl) => ({
    openMin: Number(trackEl.getAttribute("data-open-min")),
    closeMin: Number(trackEl.getAttribute("data-close-min")),
    interval: Number(trackEl.getAttribute("data-interval")),
    orientation: trackEl.getAttribute("data-orientation") || orientation,
    slotPx: SLOT_PX,
    rowH: ROW_H,
  }), [orientation]);

  const updateApptManipPreview = useCallback((clientX, clientY) => {
    const m = apptManipRef.current;
    if (!m) return;
    const dist = Math.hypot(clientX - m.startX, clientY - m.startY);
    if (dist >= APPT_MANIP_THRESHOLD_PX) m.moved = true;

    const staffId = resolveStaffIdFromPointer(clientX, clientY) || m.origin.staffId;
    const originTrack = document.querySelector(`[data-schedule-track][data-staff-id="${m.mode === "resize" ? m.origin.staffId : staffId}"]`);
    if (!originTrack) return;
    const params = trackParamsFromEl(originTrack);
    if (Number.isNaN(params.openMin) || Number.isNaN(params.closeMin)) return;

    if (m.mode === "move") {
      const newStart = pointerToSnappedStartMin(originTrack, clientX, clientY, params);
      if (newStart == null) return;
      const maxStart = params.closeMin - m.origin.durationMin;
      const clampedStart = Math.min(Math.max(newStart, params.openMin), Math.max(params.openMin, maxStart));
      m.preview = { startMin: clampedStart, durationMin: m.origin.durationMin, staffId };
    } else {
      const rect = originTrack.getBoundingClientRect();
      let endMin;
      if (params.orientation === "vertical") {
        const py = clientY - rect.top;
        const slotEndIndex = Math.max(1, Math.ceil(py / ROW_H));
        endMin = params.openMin + slotEndIndex * params.interval;
      } else {
        const px = clientX - rect.left;
        const slotEndIndex = Math.max(1, Math.ceil(px / SLOT_PX));
        endMin = params.openMin + slotEndIndex * params.interval;
      }
      endMin = Math.min(params.closeMin, Math.max(endMin, m.origin.startMin + params.interval));
      const durationMin = clampDuration(endMin - m.origin.startMin, params.interval);
      m.preview = { startMin: m.origin.startMin, durationMin, staffId: m.origin.staffId };
    }
    setApptManip({
      bookingId: m.bookingId,
      booking: m.booking,
      mode: m.mode,
      preview: { ...m.preview },
    });
  }, [trackParamsFromEl]);

  const finishApptManip = useCallback(() => {
    const m = apptManipRef.current;
    apptManipRef.current = null;
    setApptManip(null);
    if (!m) return;
    if (!m.moved) {
      onSelectBooking(m.booking);
      return;
    }
    const unchanged =
      m.origin.startMin === m.preview.startMin
      && m.origin.durationMin === m.preview.durationMin
      && m.origin.staffId === m.preview.staffId;
    if (unchanged) return;

    if (isPastEmptySlot({ scheduleDate: date, slotMin: m.preview.startMin, timezone })) {
      toast.error("Cannot move appointment to the past");
      return;
    }
    const targetEffective = effectiveByStaff[m.preview.staffId];
    if (targetEffective && targetEffective.is_working === false) {
      toast.error("Selected staff is not on duty this day");
      return;
    }

    const meta = describeScheduleChange(m.origin, m.preview, staffById);
    const conflicts = findLocalScheduleConflicts(bookings, {
      staffId: m.preview.staffId,
      startMin: m.preview.startMin,
      durationMin: m.preview.durationMin,
      excludeBookingId: m.bookingId,
    });
    setPendingConfirm({
      booking: m.booking,
      bookingId: m.bookingId,
      mode: m.mode,
      origin: m.origin,
      proposed: m.preview,
      meta,
      scheduleDate: date,
      conflicts,
    });
  }, [bookings, date, onSelectBooking, staffById, timezone, effectiveByStaff]);

  const onManipulateStart = useCallback((e, booking, mode) => {
    if (!canDragResize || !canManipulateAppointment(booking, canManage)) return;
    e.preventDefault();
    e.stopPropagation();
    const originStaffId = booking.performer_id
      || (booking.performers || []).find((p) => p.staff_id)?.staff_id
      || staff.find((s) => bookingAssignedToStaff(booking, s.id))?.id;
    if (!originStaffId) return;
    const startMin = bookingStartMin(booking.scheduled_at);
    const durationMin = booking.duration_min || 30;
    apptManipRef.current = {
      booking,
      bookingId: booking.id,
      mode,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origin: { startMin, durationMin, staffId: originStaffId },
      preview: { startMin, durationMin, staffId: originStaffId },
    };
    setApptManip({
      bookingId: booking.id,
      booking,
      mode,
      preview: { startMin, durationMin, staffId: originStaffId },
    });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [canDragResize, canManage, staff]);

  const confirmScheduleChange = useCallback(async (withOverlapOverride = false) => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      const { booking, proposed, mode, origin } = pendingConfirm;
      const scheduled_at = buildScheduledAtIso(date, proposed.startMin);
      const payload = {
        scheduled_at,
        duration_min: proposed.durationMin,
        performer_id: proposed.staffId,
        duration_source: DURATION_SOURCES.MANUAL_OVERRIDE,
        schedule_change_source: mode === "resize" ? "schedule_resize" : "schedule_drag",
      };
      if (origin.staffId !== proposed.staffId) {
        payload.performers = [{ staff_id: proposed.staffId, performer_type: "primary" }];
      }
      if (withOverlapOverride) payload.overlap_override = true;
      await api.put(`/bookings/${booking.id}`, payload);
      toast.success("Appointment updated");
      setPendingConfirm(null);
      load();
    } catch (e) {
      const conflict = parseScheduleConflict(e);
      if (conflict) {
        setPendingConfirm((p) => (p ? { ...p, conflicts: conflict.conflicts || p.conflicts || [] } : p));
        if (withOverlapOverride) {
          const detail = e?.response?.data?.detail;
          toast.error(typeof detail === "object" ? (detail.message || "Could not save") : (detail || "Could not save"));
        }
      } else {
        const detail = e?.response?.data?.detail;
        toast.error(typeof detail === "object" ? (detail.message || "Could not save") : (detail || "Could not save"));
      }
    } finally {
      setConfirmBusy(false);
    }
  }, [pendingConfirm, date, load]);

  useEffect(() => {
    const onApptPointerUp = () => {
      if (apptManipRef.current) finishApptManip();
    };
    const onApptPointerMove = (e) => {
      if (!apptManipRef.current || (e.buttons & 1) === 0) return;
      updateApptManipPreview(e.clientX, e.clientY);
    };
    window.addEventListener("pointerup", onApptPointerUp);
    window.addEventListener("pointercancel", onApptPointerUp);
    window.addEventListener("pointermove", onApptPointerMove);
    return () => {
      window.removeEventListener("pointerup", onApptPointerUp);
      window.removeEventListener("pointercancel", onApptPointerUp);
      window.removeEventListener("pointermove", onApptPointerMove);
    };
  }, [finishApptManip, updateApptManipPreview]);

  const onSlotPointerDown = useCallback(
    (e, { staffId, slotMin, slotEnd }) => {
      if (apptManipRef.current) return;
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
  const tooltipContainer = isFullscreen ? shellRef.current : undefined;
  const searchMatchCount = useMemo(
    () => countSearchMatches(bookings, searchQuery),
    [bookings, searchQuery],
  );

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
                  canDragResize={canDragResize}
                  apptManip={apptManip}
                  onManipulateStart={onManipulateStart}
                  dragPreview={dragPreview}
                  onSlotPointerDown={onSlotPointerDown}
                  onSlotPointerEnter={onSlotPointerEnter}
                  patientHighlight={patientHighlight}
                  onHighlightPatient={onHighlightPatient}
                  searchQuery={searchQuery}
                  tooltipContainer={tooltipContainer}
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
                canDragResize={canDragResize}
                apptManip={apptManip}
                onManipulateStart={onManipulateStart}
                dragPreview={dragPreview}
                onSlotPointerDown={onSlotPointerDown}
                onSlotPointerEnter={onSlotPointerEnter}
                patientHighlight={patientHighlight}
                onHighlightPatient={onHighlightPatient}
                searchQuery={searchQuery}
                tooltipContainer={tooltipContainer}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const shellClass = isFullscreen
    ? "fixed inset-0 z-[70] bg-[#FDFBF7] flex flex-col p-3 sm:p-4 overflow-hidden relative"
    : "";

  return (
    <TooltipProvider delayDuration={280} skipDelayDuration={80}>
    <div
      ref={shellRef}
      className={shellClass}
      data-testid="bookings-schedule-view"
      data-schedule-fullscreen={isFullscreen ? "true" : "false"}
    >
      <div className={`flex flex-wrap items-center gap-2 sm:gap-3 mb-4 ${isFullscreen ? "shrink-0" : ""}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => shiftDay(-1)} className="bl-icon-btn" data-testid="schedule-prev-day">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="font-display text-lg text-[var(--bl-text)] min-w-[140px] text-center" data-testid="schedule-date-label">
            {dateLabel}
          </div>
          {refreshing && (
            <span className="text-xs text-[#A89F8B]" data-testid="schedule-updating">
              Updating…
            </span>
          )}
          <button type="button" onClick={() => shiftDay(1)} className="bl-icon-btn" data-testid="schedule-next-day">
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button type="button" onClick={() => onDateChange(clinicNow.dateStr)} className="bl-btn-secondary text-sm" data-testid="schedule-today">
              Today
            </button>
          )}
        </div>

        {isFullscreen && (
          <div className="flex items-center gap-2 flex-1 min-w-[12rem] flex-wrap w-full sm:w-auto sm:flex-initial">
            <SearchInput
              className="flex-1 min-w-[12rem] max-w-md"
              inputClassName="text-sm py-2"
              placeholder="Search patient, phone, treatment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="schedule-patient-search"
            />
            {onStatusFilterChange && (
              <select
                className="bl-input text-sm w-auto min-w-[9.5rem] max-w-[13rem] py-2 h-auto"
                value={statusFilter || ""}
                onChange={(e) => onStatusFilterChange(e.target.value)}
                data-testid="schedule-status-filter"
              >
                {SCHEDULE_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <div className="bl-segmented" data-testid="schedule-orientation-toggle">
            <button
              type="button"
              className={`bl-segmented-item text-xs ${orientation === "horizontal" ? "active" : ""}`}
              onClick={() => setLayout("horizontal")}
              data-testid="schedule-orientation-horizontal"
            >
              Horizontal
            </button>
            <button
              type="button"
              className={`bl-segmented-item text-xs ${orientation === "vertical" ? "active" : ""}`}
              onClick={() => setLayout("vertical")}
              data-testid="schedule-orientation-vertical"
            >
              Vertical
            </button>
          </div>

          <button
            type="button"
            className="bl-btn-secondary text-xs inline-flex items-center gap-1.5"
            onClick={isFullscreen ? exitFullscreen : enterFullscreen}
            data-testid={isFullscreen ? "schedule-exit-fullscreen" : "schedule-enter-fullscreen"}
            title={isFullscreen ? "Exit full screen" : "View full screen schedule"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {patientHighlight && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] ${isFullscreen ? "shrink-0" : ""}`}
          data-testid="schedule-patient-highlight-banner"
        >
          <div className="text-sm text-[#1E3A8A]">
            <span className="font-medium">{patientHighlightBannerText(patientHighlight)}</span>
            {patientHighlight.hiddenCount > 0 && (
              <span className="block text-xs text-[#3B82F6] mt-0.5">
                Some bookings may be hidden by the current status filter.
              </span>
            )}
          </div>
          <button
            type="button"
            className="bl-btn-ghost text-xs shrink-0"
            onClick={clearPatientHighlight}
            data-testid="schedule-clear-patient-highlight"
          >
            Clear highlight
          </button>
        </div>
      )}

      {isFullscreen && searchQuery.trim() && (
        <p className="text-xs text-[#5C6C62] mb-2 shrink-0" data-testid="schedule-search-hint">
          {searchMatchCount} appointment{searchMatchCount === 1 ? "" : "s"} match your search
        </p>
      )}

      <p className={`text-xs text-[#A89F8B] mb-3 ${isFullscreen ? "shrink-0" : ""}`}>
        Click an open slot to book · drag across slots to block a range · click a block for details
      </p>

      <div className={`${isFullscreen ? "flex flex-1 min-h-0 relative" : ""}`}>
        <div className={`${isFullscreen ? "flex-1 min-h-0 min-w-0 flex flex-col" : ""}`}>
        {initialLoading && bookings.length === 0 && staff.length === 0 ? (
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
          <div className={`bl-card overflow-hidden ${isFullscreen ? "h-full flex flex-col flex-1 min-h-0" : ""}`}>
            <div className={isFullscreen ? "flex-1 min-h-0 overflow-auto" : ""}>
              {orientation === "vertical" ? renderVertical() : renderHorizontal()}
            </div>

            {unassigned.length > 0 && (
              <div className="border-t border-[#EAE6D7] px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-[#B14A2C] mb-2">
                  Unassigned ({unassigned.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {unassigned.map((b) => {
                    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate: date, searchQuery });
                    return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBooking(b)}
                      className={`text-left px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-[#F8F5EC] ${highlight.patientHighlightMatch ? "ring-2 ring-[#1D4ED8] ring-offset-1 shadow-[0_0_0_3px_rgba(29,78,216,0.22)]" : ""} ${highlight.searchHighlightMatch ? "ring-1 ring-[#52796F]/70" : ""} ${highlight.patientHighlightDimmed ? "opacity-40 saturate-50" : ""}`}
                      style={{ borderColor: "#EAE6D7", background: highlight.patientHighlightMatch ? "#EFF6FF" : "#FFF8F5" }}
                      data-testid={`schedule-unassigned-${b.id}`}
                      data-patient-highlight-match={highlight.patientHighlightMatch ? "true" : undefined}
                    >
                      <div className="font-medium">{b.patient_name}</div>
                      <div className="text-xs text-[#5C6C62]">
                        {new Date(b.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {b.treatment}
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {isFullscreen && (
          <>
            <ScheduleUtilityDrawer
              open={!!activeUtility}
              utilityId={activeUtility}
              onClose={() => setActiveUtility(null)}
              scheduleDate={date}
            />
            <ScheduleFullscreenUtilityRail
              access={utilityAccess}
              activeId={activeUtility}
              onSelect={setActiveUtility}
            />
          </>
        )}
      </div>

      {!isFullscreen && <ScheduleLegend />}

      <div
        ref={modalPortalRef}
        className={isFullscreen ? "fixed inset-0 z-[120] pointer-events-none [&>*]:pointer-events-auto" : "hidden"}
        data-testid="schedule-modal-portal"
        aria-hidden={!isFullscreen}
      />

      <ScheduleMoveConfirmModal
        pending={pendingConfirm}
        conflicts={pendingConfirm?.conflicts || []}
        canOverrideConflict={canOverrideConflict}
        busy={confirmBusy}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const hasConflict = (pendingConfirm?.conflicts || []).length > 0;
          confirmScheduleChange(hasConflict && canOverrideConflict);
        }}
      />
    </div>
    </TooltipProvider>
  );
}

export { toDateStr as scheduleDateStr };
