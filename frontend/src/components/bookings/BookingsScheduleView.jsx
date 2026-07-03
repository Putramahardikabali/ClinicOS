import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight, Layers, Menu } from "lucide-react";
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
import { canCloseUtilityDrawer } from "@/lib/scheduleMainModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppointmentWorkspace } from "@/lib/appointmentWorkspaceContext";
import WorkspaceMoreMenu from "@/components/bookings/WorkspaceMoreMenu";
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
import StaffRequestOverrideModal from "@/components/bookings/StaffRequestOverrideModal";
import {
  needsStaffRequestOverride,
  parseStaffRequestConflict,
  requestedStaffName,
  staffRequestWarningMessage,
} from "@/lib/staffRequest";
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
import ScheduleFitControls from "@/components/bookings/ScheduleFitControls";
import SchedulePatientSearch from "@/components/bookings/SchedulePatientSearch";
import { patientDisplayName } from "@/components/bookings/schedulePatientLookup";
import {
  adjustManualScale,
  applyFitModeToState,
  buildScheduleCssVars,
  buildScheduleMetrics,
  computeFitMetrics,
  DEFAULT_SCALE_STATE,
  loadScheduleScaleState,
  saveScheduleScaleState,
  SCHEDULE_FIT_MODES,
  ScheduleMetricsProvider,
  useScheduleMetrics,
  resolveTimeLabelStep,
  shouldShowVerticalTimeLabel,
  verticalSlotStyle,
} from "@/lib/scheduleScale";
import { toast } from "sonner";
import { confirmPastBookingProceed } from "@/lib/pastBookingPolicy";
import ScheduleTrackInteractionLayer from "@/components/bookings/ScheduleTrackInteractionLayer";
import { logScheduleInteractionDebug } from "@/components/bookings/scheduleInteraction";

const DEFAULT_HOURS = { open: "09:00", close: "20:00" };

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

function resolveBookingCardHighlight(booking, { patientHighlight, scheduleDate }) {
  const patientMatch = patientHighlight && bookingMatchesPatientHighlight(booking, patientHighlight, scheduleDate);
  const dimmed = patientHighlight && !patientMatch && !isTimeBlock(booking);
  return {
    patientHighlightMatch: patientMatch,
    patientHighlightDimmed: dimmed,
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
  onHighlightPatient,
  tooltipContainer = null,
}) {
  const { slotPx, rowH, slotHeight, slotWidth, compact } = useScheduleMetrics();
  const vSlot = slotHeight ?? rowH;
  const hSlot = slotWidth ?? slotPx;
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

  const spanGap = compact ? 1 : 2;
  const minSpan = compact ? 2 : (orientation === "vertical" ? vSlot - spanGap : hSlot - spanGap);
  const baseSpan = orientation === "vertical"
    ? Math.max((dur / interval) * vSlot - spanGap, minSpan)
    : Math.max((dur / interval) * hSlot - spanGap, minSpan);
  const baseOffset = orientation === "vertical"
    ? ((start - openMin) / interval) * vSlot
    : ((start - openMin) / interval) * hSlot;
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
          width: Math.max(baseSpan / colCount - spanGap, hSlot / colCount - spanGap),
          zIndex: ghost ? 25 : 10,
        };

  const cardStyle = {
    background: st.bg,
    borderColor: st.border,
    color: st.text,
    borderLeftWidth: block ? undefined : 3,
  };

  const cardClasses = `relative w-full h-full min-h-0 rounded-md border text-left overflow-hidden transition hover:shadow-sm hover:ring-1 hover:ring-[#2D3A33]/10 hover:brightness-[0.98] ${compact ? "px-1 py-0" : "px-2 py-1"} ${block ? "border-dashed" : "border-solid"} ${ghost ? "opacity-75 ring-2 ring-[#52796F]/45 shadow-md" : ""} ${patientHighlightMatch ? "ring-2 ring-[#1D4ED8] ring-offset-1 shadow-[0_0_0_3px_rgba(29,78,216,0.22)] z-20" : ""} ${patientHighlightDimmed ? "opacity-40 saturate-50" : ""} ${canManipulate ? "cursor-grab active:cursor-grabbing" : "cursor-pointer active:scale-[0.99]"}`;

  const hasIndicatorIcons = !block && (visibleIcons.length > 0 || iconOverflow > 0);
  const hasBottomBadges = hasIndicatorIcons || overtime || showOverlapBadge;
  const iconStripClass =
    orientation === "vertical"
      ? (canManipulate ? "bottom-2 right-0.5" : "bottom-0.5 right-0.5")
      : (canManipulate ? "bottom-0.5 right-2" : "bottom-0.5 right-0.5");

  const cardBody = (
    <>
      <div className={`min-w-0 overflow-hidden ${hasBottomBadges ? (compact ? "pb-2" : "pb-3.5") : ""}`}>
        <div className={`${compact ? "text-[8px]" : "text-xs"} font-semibold truncate leading-tight`}>{label}</div>
        {!compact && <div className="text-[10px] truncate opacity-85 leading-tight">{sub}</div>}
        {!compact && <div className="text-[10px] opacity-70 mt-0.5 leading-tight">{timeLabel} · {dur}m</div>}
      </div>
      {hasBottomBadges && (
        <div
          className={`absolute flex items-center justify-end gap-0.5 max-w-[72%] pointer-events-none ${iconStripClass}`}
          data-testid={`schedule-block-icons-${booking.id}`}
          aria-hidden
        >
          {hasIndicatorIcons && visibleIcons.map((key) => {
            const def = INDICATOR_DEFS[key];
            if (!def) return null;
            const Icon = def.Icon;
            return (
              <span
                key={key}
                className="inline-flex items-center justify-center rounded-sm bg-white/55 p-px"
                title={def.title}
                data-testid={`schedule-icon-${key}-${booking.id}`}
              >
                <Icon className="w-2.5 h-2.5" strokeWidth={2.25} />
              </span>
            );
          })}
          {hasIndicatorIcons && iconOverflow > 0 && (
            <span
              className="text-[8px] font-semibold opacity-85 leading-none px-0.5"
              title={`${iconOverflow} more indicator${iconOverflow === 1 ? "" : "s"}`}
              data-testid={`schedule-icon-overflow-${booking.id}`}
            >
              +{iconOverflow}
            </span>
          )}
          {overtime && <OvertimeBadge className="shrink-0 scale-[0.72] origin-bottom-right" />}
          {showOverlapBadge && (
            <span
              className="inline-flex items-center justify-center rounded-sm bg-amber-100/80 text-amber-800 p-px shrink-0"
              title="Overlapping appointment"
              data-testid={`schedule-overlap-${booking.id}`}
            >
              <Layers className="w-2.5 h-2.5" strokeWidth={2.25} />
            </span>
          )}
        </div>
      )}
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
      className={cardClasses}
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
      className="absolute z-10 pointer-events-auto"
      style={positionStyle}
      data-patient-highlight-match={patientHighlightMatch ? "true" : undefined}
      data-schedule-block-wrap=""
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
  orientation,
  highlighted,
}) {
  const { compact } = useScheduleMetrics();
  const slotStyle = orientation === "vertical" ? verticalSlotStyle(compact) : { height: "100%", minHeight: 0 };
  const edge =
    orientation === "vertical"
      ? "border-b border-[#F0EDE4] w-full h-full"
      : "border-r border-[#F0EDE4] h-full w-full min-h-0";
  const highlightCls = highlighted ? "bg-[#D4E8E0]/60 ring-1 ring-inset ring-[#52796F]/35" : "";
  const base = `pointer-events-none select-none ${edge}`;

  if (state.kind === "available") {
    return <div className={`${base} bg-transparent ${highlightCls}`} style={slotStyle} aria-hidden />;
  }
  if (state.kind === "overtime") {
    return <div className={`${base} bg-[#F3F1EB]/40`} style={slotStyle} aria-hidden />;
  }
  if (state.kind === "past" && state.clickable) {
    return <div className={`${base} bg-[#F3F1EB]/30 ${highlightCls}`} style={slotStyle} aria-hidden />;
  }
  if (state.kind === "past") {
    return <div className={`${base} bg-[#F3F1EB]/25`} style={slotStyle} aria-hidden />;
  }
  return <div className={`${base} bg-[#F3F1EB]/25`} style={slotStyle} aria-hidden />;
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
  canBookSlots,
  canCreateOvertime,
  canDragResize,
  apptManip,
  onManipulateStart,
  dragPreview,
  canScheduleInteract,
  onTrackPointerDownHit,
  onTrackPointerMoveHit,
  onTrackPointerUpHit,
  patientHighlight,
  onHighlightPatient,
  tooltipContainer = null,
}) {
  const { slotHeight, slotWidth, staffColW } = useScheduleMetrics();
  const trackRef = useRef(null);
  const vSlot = slotHeight;
  const hSlot = slotWidth;
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
    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate });
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
        style={{ width: staffColW }}
      >
        <div className="text-sm font-semibold text-[#2D3A33] truncate leading-snug">{staff.name}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#A89F8B] mt-0.5">{formatStaffRole(staff.role)}</div>
      </div>
      <div
        ref={trackRef}
        className="relative flex-1 overflow-hidden"
        style={{ height: "var(--schedule-slot-height)", minWidth: gridWidth }}
        data-schedule-track=""
        data-staff-id={staff.id}
        data-open-min={openMin}
        data-close-min={closeMin}
        data-interval={interval}
        data-orientation="horizontal"
        data-slot-px={hSlot}
        data-row-h={vSlot}
      >
        <div
          className="absolute inset-0 grid pointer-events-none z-[1]"
          style={{ gridTemplateColumns: `repeat(${slotCount}, var(--schedule-slot-width))` }}
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
              canBookSlots,
              canCreateOvertime,
              staffName: staff.name,
              timeStr,
            });
            return (
              <ScheduleSlotCell
                key={i}
                state={state}
                orientation="horizontal"
                highlighted={slotInDragPreview(slotMin, dragPreview, interval) && dragPreview?.staffId === staff.id}
              />
            );
          })}
        </div>
        <ScheduleTrackInteractionLayer
          trackRef={trackRef}
          enabled={canScheduleInteract}
          onPointerDownHit={onTrackPointerDownHit}
          onPointerMoveHit={onTrackPointerMoveHit}
          onPointerUpHit={onTrackPointerUpHit}
        />
        {visibleBookings.map((b) => renderBooking(b))}
        {dragPreview?.staffId === staff.id && (
          <div
            className="absolute top-0 bottom-0 z-[8] pointer-events-none rounded-sm border border-[#52796F]/35 bg-[#C5DDD4]/40"
            style={{
              left: ((dragPreview.startMin - openMin) / interval) * hSlot,
              width: ((dragPreview.endMinExclusive - dragPreview.startMin) / interval) * hSlot,
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
  canBookSlots,
  canCreateOvertime,
  canDragResize,
  apptManip,
  onManipulateStart,
  dragPreview,
  canScheduleInteract,
  onTrackPointerDownHit,
  onTrackPointerMoveHit,
  onTrackPointerUpHit,
  patientHighlight,
  onHighlightPatient,
  tooltipContainer = null,
}) {
  const { slotHeight, slotWidth, staffColW } = useScheduleMetrics();
  const trackRef = useRef(null);
  const vSlot = slotHeight;
  const hSlot = slotWidth;
  const rowBookings = bookings.filter(
    (b) =>
      bookingAssignedToStaff(b, staff.id) &&
      b.status !== "cancelled" &&
      b.status !== "no_show",
  );
  const overlapLayout = useMemo(() => layoutOverlappingBookings(rowBookings), [rowBookings]);
  const slotCount = (closeMin - openMin) / interval;
  const trackHeight = slotCount * vSlot;

  const renderBooking = (b) => {
    const manipulable = canDragResize && canManipulateAppointment(b, canManage);
    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate });
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
      ref={trackRef}
      className="shrink-0 border-r border-[#EAE6D7] relative"
      style={{ width: staffColW, height: trackHeight }}
      data-testid={`schedule-col-${staff.id}`}
      data-schedule-track=""
      data-staff-id={staff.id}
      data-open-min={openMin}
      data-close-min={closeMin}
      data-interval={interval}
      data-orientation="vertical"
      data-slot-px={hSlot}
      data-row-h={vSlot}
    >
      <div className="absolute inset-0 pointer-events-none z-[1]">
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
            canBookSlots,
            canCreateOvertime,
            staffName: staff.name,
            timeStr,
          });
          return (
            <div
              key={i}
              className="absolute left-0 right-0"
              style={{ top: `calc(${i} * var(--schedule-slot-height))`, height: "var(--schedule-slot-height)" }}
            >
              <ScheduleSlotCell
                state={state}
                orientation="vertical"
                highlighted={slotInDragPreview(slotMin, dragPreview, interval) && dragPreview?.staffId === staff.id}
              />
            </div>
          );
        })}
      </div>
      <ScheduleTrackInteractionLayer
        trackRef={trackRef}
        enabled={canScheduleInteract}
        onPointerDownHit={onTrackPointerDownHit}
        onPointerMoveHit={onTrackPointerMoveHit}
        onPointerUpHit={onTrackPointerUpHit}
      />
      {visibleBookings.map((b) => renderBooking(b))}
      {dragPreview?.staffId === staff.id && (
        <div
          className="absolute left-0 right-0 z-[8] pointer-events-none rounded-sm border border-[#52796F]/35 bg-[#C5DDD4]/40"
          style={{
            top: ((dragPreview.startMin - openMin) / interval) * vSlot,
            height: ((dragPreview.endMinExclusive - dragPreview.startMin) / interval) * vSlot,
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
  const { slotHeight, slotWidth } = useScheduleMetrics();
  const vSlot = slotHeight;
  const hSlot = slotWidth;
  const offset = ((nowMin - openMin) / interval) * (orientation === "vertical" ? vSlot : hSlot);
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
  canWhatsgo = false,
  canCreatePatient = false,
  reloadAt = 0,
  modalPortalRef,
  highlightApiRef,
  onHighlightActivated,
  onBookPatient,
  onModifyBooking,
  onOpenPatientProfile,
  onCreatePatient,
  onNewAppointment,
  onBlockTime,
  onShowListView,
  onCopyPublicLink,
  clinicSlug,
  canBookSlots,
  appointmentContext = null,
  onInvoicePaymentSuccess,
  onCreateAppointmentFromWaitlist,
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
  const {
    isAppointmentWorkspace,
    isBrowserFullscreen,
    toggleNavigationDrawer,
    toggleBrowserFullscreen,
  } = useAppointmentWorkspace();
  const [scaleState, setScaleState] = useState(() => loadScheduleScaleState());
  const gridViewportRef = useRef(null);
  const [activeUtility, setActiveUtility] = useState(null);
  const [invoiceDrawerInit, setInvoiceDrawerInit] = useState(null);
  const [sessionsDrawerInit, setSessionsDrawerInit] = useState(null);
  const utilityCloseGuardRef = useRef(null);
  const [patientHighlight, setPatientHighlight] = useState(null);
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const lastDragMovedRef = useRef(false);
  const [dragPreview, setDragPreview] = useState(null);
  const apptManipRef = useRef(null);
  const [apptManip, setApptManip] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [pendingStaffRequestOverride, setPendingStaffRequestOverride] = useState(null);
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
  const canScheduleBook = canBookSlots ?? canManage;
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

  const activatePatientHighlightById = useCallback(async (patientId, patientName) => {
    if (!patientId) return;
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

  const activatePatientHighlight = useCallback(async (booking) => {
    if (!isHighlightableBooking(booking)) {
      toast.error("This appointment has no linked patient to highlight.");
      return;
    }
    await activatePatientHighlightById(booking.patient_id, booking.patient_name || "Patient");
  }, [activatePatientHighlightById]);

  const activatePatientHighlightFromPatient = useCallback(async (patient) => {
    if (!patient?.id) return;
    await activatePatientHighlightById(patient.id, patientDisplayName(patient));
  }, [activatePatientHighlightById]);

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
    if (!isAppointmentWorkspace) {
      setActiveUtility(null);
      setInvoiceDrawerInit(null);
      setSessionsDrawerInit(null);
    }
  }, [isAppointmentWorkspace]);

  const handleUtilitySelect = useCallback((id) => {
    setActiveUtility((prev) => {
      const next = prev === id ? null : id;
      if (next === "invoices" && appointmentContext) {
        setInvoiceDrawerInit({
          invoiceId: appointmentContext.invoice?.id || null,
          visitId: appointmentContext.visit_id || null,
        });
      } else if (next !== "invoices") {
        setInvoiceDrawerInit(null);
      }
      if (next === "sessions" && appointmentContext) {
        setSessionsDrawerInit({
          visitId: appointmentContext.visit_id || null,
          patientId: appointmentContext.patient_id || null,
          bookingId: appointmentContext.id || null,
        });
      } else if (next !== "sessions") {
        setSessionsDrawerInit(null);
      }
      return next;
    });
  }, [appointmentContext]);

  const closeUtilityDrawer = useCallback(() => {
    if (!canCloseUtilityDrawer(utilityCloseGuardRef)) return false;
    setActiveUtility(null);
    setInvoiceDrawerInit(null);
    setSessionsDrawerInit(null);
    return true;
  }, []);

  const closeDrawerBeforeMainModal = useCallback(() => {
    if (!activeUtility) return true;
    return closeUtilityDrawer();
  }, [activeUtility, closeUtilityDrawer]);

  const handleCreateAppointmentFromWaitlist = useCallback((entry) => {
    if (!closeDrawerBeforeMainModal()) return;
    onCreateAppointmentFromWaitlist?.(entry);
  }, [closeDrawerBeforeMainModal, onCreateAppointmentFromWaitlist]);

  const handleInvoicePaymentSuccess = useCallback(() => {
    onInvoicePaymentSuccess?.();
    load({ silent: true });
  }, [onInvoicePaymentSuccess, load]);

  const utilityAccess = useMemo(
    () => resolveScheduleUtilityAccess(user, clinic),
    [user, clinic],
  );

  useEffect(() => {
    if (!isAppointmentWorkspace || !activeUtility) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeUtilityDrawer();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isAppointmentWorkspace, activeUtility, closeUtilityDrawer]);

  const { openMin, closeMin, interval, closed, closedReason, slotCount } = useMemo(() => {
    const dk = dayKey(date);
    const hours = clinic?.operating_hours || {};
    const dayH = hours[dk] || DEFAULT_HOURS;
    const closedDate = (clinic?.closed_dates || []).find((d) => d.date === date);
    const iv = Math.max(5, Number(clinic?.booking_slot_interval) || 30);
    let o = hhmmToMin(dayH.open) ?? hhmmToMin(DEFAULT_HOURS.open);
    let c = hhmmToMin(dayH.close) ?? hhmmToMin(DEFAULT_HOURS.close);
    if (o == null || c == null || o >= c) {
      return { openMin: 540, closeMin: 1200, interval: iv, closed: true, closedReason: "Clinic closed", slotCount: 0 };
    }
    if (closedDate) {
      return { openMin: o, closeMin: c, interval: iv, closed: true, closedReason: closedDate.reason || "Clinic closed", slotCount: 0 };
    }
    const slots = (c - o) / iv;
    return {
      openMin: o,
      closeMin: c,
      interval: iv,
      closed: false,
      closedReason: "",
      slotCount: slots,
    };
  }, [clinic, date]);

  const metrics = useMemo(
    () => buildScheduleMetrics(scaleState, isAppointmentWorkspace),
    [scaleState, isAppointmentWorkspace],
  );

  const scheduleCssVars = useMemo(() => buildScheduleCssVars(metrics), [metrics]);

  const gridWidth = useMemo(
    () => slotCount * (metrics.slotWidth ?? metrics.slotPx),
    [slotCount, metrics.slotWidth, metrics.slotPx],
  );
  const verticalTimeLabelStep = useMemo(
    () => resolveTimeLabelStep(interval, metrics.slotHeight ?? metrics.rowH),
    [interval, metrics.slotHeight, metrics.rowH],
  );
  const hourMarks = useMemo(() => {
    if (closed || !slotCount) return [];
    const slotW = metrics.slotWidth ?? metrics.slotPx;
    const marks = [];
    for (let m = openMin; m < closeMin; m += 60) {
      if (m >= openMin && m < closeMin) {
        marks.push({ min: m, left: ((m - openMin) / interval) * slotW });
      }
    }
    return marks;
  }, [openMin, closeMin, interval, metrics.slotWidth, metrics.slotPx, closed, slotCount]);

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

  const persistScale = useCallback((next) => {
    setScaleState(next);
    saveScheduleScaleState(next);
  }, []);

  const measureFitMetrics = useCallback(() => {
    const el = gridViewportRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return computeFitMetrics({
      orientation,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      slotCount,
      staffCount: flatStaff.length,
      staffGroupCount: staffGroups.length,
    });
  }, [orientation, slotCount, flatStaff.length, staffGroups.length]);

  const fitStateChanged = useCallback((prev, next) => (
    prev.slotHeightPx === next.slotHeightPx
    && prev.slotWidthPx === next.slotWidthPx
    && prev.staffColPx === next.staffColPx
    && prev.rowHRatio === next.rowHRatio
    && prev.slotPxRatio === next.slotPxRatio
    && prev.staffColRatio === next.staffColRatio
  ), []);

  const applyFitMode = useCallback((mode) => {
    if (mode === SCHEDULE_FIT_MODES.default) {
      persistScale({ ...DEFAULT_SCALE_STATE });
      gridViewportRef.current?.scrollTo({ top: 0, left: 0 });
      return;
    }
    const fitMetrics = measureFitMetrics();
    if (!fitMetrics) return;
    persistScale(applyFitModeToState(mode, fitMetrics, scaleState));
    requestAnimationFrame(() => {
      gridViewportRef.current?.scrollTo({ top: 0, left: 0 });
    });
  }, [measureFitMetrics, persistScale, scaleState]);

  const adjustScale = useCallback((axis, delta) => {
    persistScale(adjustManualScale(scaleState, axis, delta, metrics));
  }, [persistScale, scaleState, metrics]);

  useEffect(() => {
    if (!isAppointmentWorkspace || closed || workingStaff.length === 0) return undefined;
    if ([SCHEDULE_FIT_MODES.default, SCHEDULE_FIT_MODES.manual].includes(scaleState.fitMode)) {
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      const fitMetrics = measureFitMetrics();
      if (!fitMetrics) return;
      setScaleState((prev) => {
        const next = applyFitModeToState(prev.fitMode, fitMetrics, prev);
        if (fitStateChanged(prev, next)) return prev;
        saveScheduleScaleState(next);
        return next;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [
    isAppointmentWorkspace,
    orientation,
    slotCount,
    flatStaff.length,
    date,
    scaleState.fitMode,
    closed,
    workingStaff.length,
    activeUtility,
    measureFitMetrics,
    fitStateChanged,
  ]);

  useEffect(() => {
    if (!isAppointmentWorkspace) return undefined;
    if ([SCHEDULE_FIT_MODES.default, SCHEDULE_FIT_MODES.manual].includes(scaleState.fitMode)) {
      return undefined;
    }
    const onResize = () => {
      const fitMetrics = measureFitMetrics();
      if (!fitMetrics) return;
      setScaleState((prev) => {
        const next = applyFitModeToState(prev.fitMode, fitMetrics, prev);
        if (fitStateChanged(prev, next)) return prev;
        saveScheduleScaleState(next);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    const el = gridViewportRef.current;
    let observer;
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => onResize());
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [isAppointmentWorkspace, scaleState.fitMode, activeUtility, measureFitMetrics, fitStateChanged]);

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
    if (!canScheduleBook) return;
    if (!closeDrawerBeforeMainModal()) return;
    onEmptySlot({ scheduled_date: date, scheduled_time: partial.scheduled_time, performer_id: partial.performer_id });
  }, [canScheduleBook, closeDrawerBeforeMainModal, date, onEmptySlot]);

  const handleOvertimeClick = useCallback((partial) => {
    if (!closeDrawerBeforeMainModal()) return;
    const slotMin = hhmmToMin(partial.scheduled_time);
    if (slotMin == null) return;
    onOvertimeSlot({
      scheduled_date: date,
      scheduled_time: partial.scheduled_time,
      performer_id: partial.performer_id,
      staff: partial.staff,
      effective: partial.effective,
    });
  }, [closeDrawerBeforeMainModal, date, onOvertimeSlot]);

  const handleSlotClick = useCallback(({ staffId, timeStr, state }) => {
    if (!canScheduleBook || !state?.clickable) return;
    if (lastDragMovedRef.current) {
      lastDragMovedRef.current = false;
      return;
    }
    if (state.kind === "overtime") {
      const staffMember = staffById[staffId];
      handleOvertimeClick({
        scheduled_time: timeStr,
        performer_id: staffId,
        staff: staffMember,
        effective: effectiveByStaff[staffId],
      });
      return;
    }
    if (state.kind === "available" || state.kind === "past") {
      handleEmptyClick({ scheduled_time: timeStr, performer_id: staffId });
    }
  }, [canScheduleBook, staffById, effectiveByStaff, handleEmptyClick, handleOvertimeClick]);

  const isSlotValidForDrag = useCallback(
    (staffId, slotMin, slotEnd) => {
      const occupied = slotOverlapsBooking(bookings, staffId, slotMin, slotEnd);
      const staffMember = staffById[staffId];
      return isSlotSelectableForDrag({
        scheduleDate: date,
        slotMin,
        slotEnd,
        timezone,
        effective: effectiveByStaff[staffId],
        occupied,
        canManage,
        canBookSlots: canScheduleBook,
        canCreateOvertime,
        staffName: staffMember?.name || "",
        timeStr: minToHhmm(slotMin),
      });
    },
    [bookings, date, timezone, effectiveByStaff, canManage, canScheduleBook, canCreateOvertime, staffById],
  );

  const resolveHitSlotState = useCallback(
    (hit) => {
      if (!hit) return null;
      const { staffId, slotMin, slotEnd, timeStr } = hit;
      const occupied = slotOverlapsBooking(bookings, staffId, slotMin, slotEnd);
      const staffMember = staffById[staffId];
      return resolveEmptySlotState({
        scheduleDate: date,
        slotMin,
        slotEnd,
        timezone,
        effective: effectiveByStaff[staffId],
        occupied,
        canManage,
        canBookSlots: canScheduleBook,
        canCreateOvertime,
        staffName: staffMember?.name || "",
        timeStr: timeStr || minToHhmm(slotMin),
      });
    },
    [bookings, date, timezone, effectiveByStaff, canManage, canScheduleBook, canCreateOvertime, staffById],
  );

  const finishDrag = useCallback(
    (upHit) => {
      if (apptManipRef.current) return;
      const d = dragRef.current;
      const preview = dragPreviewRef.current;
      const moved = Boolean(d?.moved);
      lastDragMovedRef.current = moved;
      dragRef.current = null;
      dragPreviewRef.current = null;
      setDragPreview(null);
      if (!d) return;

      if (moved && preview && preview.staffId === d.staffId) {
        const { startMin, endMinExclusive } = preview;
        if (isDragRangeSelection(moved, startMin, endMinExclusive, interval)) {
          if (!closeDrawerBeforeMainModal()) return;
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
      }

      if (!moved) {
        const hit = upHit || {
          staffId: d.staffId,
          slotMin: d.anchorMin,
          slotEnd: d.anchorMin + interval,
          timeStr: minToHhmm(d.anchorMin),
          slotIndex: Math.floor((d.anchorMin - openMin) / interval),
          localX: 0,
          localY: 0,
        };
        const state = resolveHitSlotState(hit);
        logScheduleInteractionDebug({
          phase: "click",
          x: hit.localX,
          y: hit.localY,
          staffId: hit.staffId,
          time: hit.timeStr,
          slotIndex: hit.slotIndex,
          isPast: state?.kind === "past",
          isBlocked: Boolean(state && !state.clickable),
          canClick: Boolean(state?.clickable),
        });
        handleSlotClick({ staffId: hit.staffId, timeStr: hit.timeStr, state });
      }
    },
    [date, interval, onRangeSelect, openMin, resolveHitSlotState, handleSlotClick, closeDrawerBeforeMainModal],
  );

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

  const onTrackPointerDownHit = useCallback(
    (e, hit) => {
      if (apptManipRef.current) return;
      if (!canScheduleBook || !hit) return;
      const state = resolveHitSlotState(hit);
      const canDrag = isSlotValidForDrag(hit.staffId, hit.slotMin, hit.slotEnd);
      const canClick = Boolean(state?.clickable);
      if (!canDrag && !canClick) return;
      dragRef.current = {
        staffId: hit.staffId,
        anchorMin: hit.slotMin,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        canDrag,
      };
      if (canDrag) {
        updateDragPreview({ staffId: hit.staffId, startMin: hit.slotMin, endMinExclusive: hit.slotEnd });
      }
    },
    [canScheduleBook, resolveHitSlotState, isSlotValidForDrag, updateDragPreview],
  );

  const onTrackPointerMoveHit = useCallback(
    (e, hit) => {
      if (!dragRef.current?.canDrag || !hit) return;
      expandDragToSlot(hit.staffId, hit.slotMin, hit.slotEnd, e.clientX, e.clientY);
    },
    [expandDragToSlot],
  );

  const onTrackPointerUpHit = useCallback(
    (_e, hit) => {
      finishDrag(hit);
    },
    [finishDrag],
  );

  const trackParamsFromEl = useCallback((trackEl) => ({
    openMin: Number(trackEl.getAttribute("data-open-min")),
    closeMin: Number(trackEl.getAttribute("data-close-min")),
    interval: Number(trackEl.getAttribute("data-interval")),
    orientation: trackEl.getAttribute("data-orientation") || orientation,
    slotPx: Number(trackEl.getAttribute("data-slot-px")) || metrics.slotWidth || metrics.slotPx,
    rowH: Number(trackEl.getAttribute("data-row-h")) || metrics.slotHeight || metrics.rowH,
  }), [orientation, metrics.slotWidth, metrics.slotPx, metrics.slotHeight, metrics.rowH]);

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
        const slotEndIndex = Math.max(1, Math.ceil(py / params.rowH));
        endMin = params.openMin + slotEndIndex * params.interval;
      } else {
        const px = clientX - rect.left;
        const slotEndIndex = Math.max(1, Math.ceil(px / params.slotPx));
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
      if (!closeDrawerBeforeMainModal()) return;
      onSelectBooking(m.booking);
      return;
    }
    const unchanged =
      m.origin.startMin === m.preview.startMin
      && m.origin.durationMin === m.preview.durationMin
      && m.origin.staffId === m.preview.staffId;
    if (unchanged) return;

    const isPastTime = isPastEmptySlot({ scheduleDate: date, slotMin: m.preview.startMin, timezone });
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
      isPastTime,
    });
  }, [bookings, date, onSelectBooking, staffById, timezone, effectiveByStaff, closeDrawerBeforeMainModal]);

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

  const confirmScheduleChange = useCallback(async (withOverlapOverride = false, staffRequestOverride = false) => {
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
      if (staffRequestOverride) payload.staff_request_override = true;
      if (pendingConfirm.isPastTime) {
        if (!payload.past_booking_acknowledged) {
          if (!(await confirmPastBookingProceed())) {
            setConfirmBusy(false);
            return;
          }
          payload.past_booking_acknowledged = true;
        }
      }
      await api.put(`/bookings/${booking.id}`, payload);
      toast.success("Appointment updated");
      setPendingConfirm(null);
      setPendingStaffRequestOverride(null);
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
        const staffConflict = parseStaffRequestConflict(e);
        if (staffConflict) {
          setPendingStaffRequestOverride({
            conflict: staffConflict,
            withOverlapOverride,
          });
        } else {
          const detail = e?.response?.data?.detail;
          toast.error(typeof detail === "object" ? (detail.message || "Could not save") : (detail || "Could not save"));
        }
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

  const setLayout = (next) => {
    setOrientation(next);
    saveScheduleOrientation(next);
  };

  const hasWorkingStaff = workingStaff.length > 0;
  const { staffColW, timeColW } = metrics;
  const slotHeight = metrics.slotHeight ?? metrics.rowH;
  const trackHeight = slotCount * slotHeight;
  const compactGrid = metrics.compact;
  const showNow = isToday && clinicNow.minutes >= openMin && clinicNow.minutes < closeMin;

  const gridScrollClass = "flex-1 min-h-0 overflow-y-auto overflow-x-auto";
  const tooltipContainer = shellRef.current;
  const overlayPortalContainer = isBrowserFullscreen
    ? (document.fullscreenElement || shellRef.current)
    : shellRef.current;

  const handleSelectBooking = useCallback((booking) => {
    if (!closeDrawerBeforeMainModal()) return;
    onSelectBooking?.(booking);
  }, [closeDrawerBeforeMainModal, onSelectBooking]);

  const handleSearchBookPatient = useCallback((patient) => {
    if (!closeDrawerBeforeMainModal()) return;
    onBookPatient?.(patient, date);
  }, [closeDrawerBeforeMainModal, onBookPatient, date]);

  const handleSearchModifyBooking = useCallback((booking) => {
    if (!booking) return;
    if (!closeDrawerBeforeMainModal()) return;
    onModifyBooking?.(booking);
  }, [closeDrawerBeforeMainModal, onModifyBooking]);

  const handleToolbarNewAppointment = useCallback(() => {
    if (!closeDrawerBeforeMainModal()) return;
    onNewAppointment?.();
  }, [closeDrawerBeforeMainModal, onNewAppointment]);

  const handleToolbarBlockTime = useCallback(() => {
    if (!closeDrawerBeforeMainModal()) return;
    onBlockTime?.();
  }, [closeDrawerBeforeMainModal, onBlockTime]);

  const handleSearchHighlightPatient = useCallback((patient) => {
    activatePatientHighlightFromPatient(patient);
  }, [activatePatientHighlightFromPatient]);

  const renderHorizontal = () => (
    <div
      ref={gridViewportRef}
      className={gridScrollClass}
      style={scheduleCssVars}
      data-testid="schedule-horizontal"
    >
      <div style={{ minWidth: staffColW + gridWidth }}>
        <div className="flex border-b border-[#EAE6D7] bg-[#F8F5EC] sticky top-0 z-20 pointer-events-none">
          <div className="shrink-0 px-3 py-2 text-xs uppercase tracking-widest text-[#5C6C62] sticky left-0 z-30 bg-[#F8F5EC]" style={{ width: staffColW }}>
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
            <div className="absolute top-8 bottom-0 z-[5] pointer-events-none" style={{ left: staffColW }}>
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
                  onSelectBooking={handleSelectBooking}
                  onOvertimeSlot={handleOvertimeClick}
                  effective={effectiveByStaff[s.id]}
                  canManage={canManage}
                  canBookSlots={canScheduleBook}
                  canCreateOvertime={canCreateOvertime}
                  canDragResize={canDragResize}
                  apptManip={apptManip}
                  onManipulateStart={onManipulateStart}
                  dragPreview={dragPreview}
                  canScheduleInteract={canScheduleBook}
                  onTrackPointerDownHit={onTrackPointerDownHit}
                  onTrackPointerMoveHit={onTrackPointerMoveHit}
                  onTrackPointerUpHit={onTrackPointerUpHit}
                  patientHighlight={patientHighlight}
                  onHighlightPatient={onHighlightPatient}
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
    <div
      ref={gridViewportRef}
      className={gridScrollClass}
      style={scheduleCssVars}
      data-testid="schedule-vertical"
    >
      <div style={{ minWidth: timeColW + flatStaff.length * staffColW }}>
        {/* Sticky header: time corner + staff names */}
        <div className="flex sticky top-0 z-30 border-b border-[#EAE6D7] bg-[#F8F5EC] pointer-events-none">
          <div
            className="sticky left-0 z-40 shrink-0 bg-[#F8F5EC] border-r border-[#EAE6D7]"
            style={{ width: timeColW }}
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
                  style={{ width: staffColW * group.members.length }}
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
                  style={{ width: staffColW }}
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
            className="sticky left-0 z-20 shrink-0 bg-[#F8F5EC] border-r border-[#EAE6D7] pointer-events-none"
            style={{ width: timeColW }}
          >
            {Array.from({ length: slotCount }, (_, i) => {
              const slotMin = openMin + i * interval;
              const showLabel = shouldShowVerticalTimeLabel(slotMin, openMin, verticalTimeLabelStep);
              return (
                <div
                  key={slotMin}
                  className={`px-1 text-[#5C6C62] border-b border-[#F0EDE4] overflow-hidden ${compactGrid ? "text-[8px] leading-none" : "text-[10px] flex items-center px-2"}`}
                  style={verticalSlotStyle(compactGrid)}
                >
                  {showLabel ? minutesToTimeLabel(slotMin) : ""}
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
                onSelectBooking={handleSelectBooking}
                onOvertimeSlot={handleOvertimeClick}
                effective={effectiveByStaff[s.id]}
                canManage={canManage}
                canBookSlots={canScheduleBook}
                canCreateOvertime={canCreateOvertime}
                canDragResize={canDragResize}
                apptManip={apptManip}
                onManipulateStart={onManipulateStart}
                dragPreview={dragPreview}
                canScheduleInteract={canScheduleBook}
                onTrackPointerDownHit={onTrackPointerDownHit}
                onTrackPointerMoveHit={onTrackPointerMoveHit}
                onTrackPointerUpHit={onTrackPointerUpHit}
                patientHighlight={patientHighlight}
                onHighlightPatient={onHighlightPatient}
                tooltipContainer={tooltipContainer}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const shellClass = "flex flex-col flex-1 min-h-0 h-full bg-[#FDFBF7] relative p-3 sm:p-4";

  return (
    <TooltipProvider delayDuration={280} skipDelayDuration={80}>
    <ScheduleMetricsProvider value={metrics}>
    <div
      ref={shellRef}
      className={shellClass}
      data-testid="bookings-schedule-view"
      data-appointment-workspace="true"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 shrink-0">
        <button
          type="button"
          className="bl-icon-btn"
          onClick={toggleNavigationDrawer}
          aria-label="Open navigation menu"
          data-testid="appointment-nav-menu"
        >
          <Menu className="w-5 h-5" />
        </button>
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

        <div className="flex items-center gap-2 flex-1 min-w-[12rem] flex-wrap w-full sm:w-auto sm:flex-initial">
          <SchedulePatientSearch
            date={date}
            canManage={canManage}
            canWhatsgo={canWhatsgo}
            canCreatePatient={canCreatePatient}
            portalContainer={overlayPortalContainer}
            onHighlightPatient={handleSearchHighlightPatient}
            onBookPatient={handleSearchBookPatient}
            onModifyBooking={handleSearchModifyBooking}
            onOpenPatientProfile={onOpenPatientProfile}
            onCreatePatient={onCreatePatient}
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

          <ScheduleFitControls
            fitMode={scaleState.fitMode}
            orientation={orientation}
            menuContainer={overlayPortalContainer}
            onFitHeight={() => applyFitMode(SCHEDULE_FIT_MODES.fitHeight)}
            onFitWidth={() => applyFitMode(SCHEDULE_FIT_MODES.fitWidth)}
            onFitScreen={() => applyFitMode(SCHEDULE_FIT_MODES.fitScreen)}
            onReset={() => applyFitMode(SCHEDULE_FIT_MODES.default)}
            onAdjustRowH={(delta) => adjustScale("rowH", delta)}
            onAdjustSlotPx={(delta) => adjustScale("slotPx", delta)}
            onAdjustStaffCol={(delta) => adjustScale("staffCol", delta)}
          />

          <WorkspaceMoreMenu
            canManage={canManage}
            clinicSlug={clinicSlug}
            viewMode="schedule"
            onNewAppointment={onNewAppointment ? handleToolbarNewAppointment : undefined}
            onBlockTime={onBlockTime ? handleToolbarBlockTime : undefined}
            onShowListView={onShowListView}
            onCopyPublicLink={onCopyPublicLink}
            onBrowserFullscreen={() => toggleBrowserFullscreen(shellRef.current)}
            isBrowserFullscreen={isBrowserFullscreen}
            container={overlayPortalContainer}
          />
        </div>
      </div>

      {patientHighlight && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] shrink-0"
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

      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col relative">
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
          <div className="bl-card overflow-hidden h-full flex flex-col flex-1 min-h-0">
              {orientation === "vertical" ? renderVertical() : renderHorizontal()}

            {unassigned.length > 0 && (
              <div className="border-t border-[#EAE6D7] px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-[#B14A2C] mb-2">
                  Unassigned ({unassigned.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {unassigned.map((b) => {
                    const highlight = resolveBookingCardHighlight(b, { patientHighlight, scheduleDate: date });
                    return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectBooking(b)}
                      className={`text-left px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-[#F8F5EC] ${highlight.patientHighlightMatch ? "ring-2 ring-[#1D4ED8] ring-offset-1 shadow-[0_0_0_3px_rgba(29,78,216,0.22)]" : ""} ${highlight.patientHighlightDimmed ? "opacity-40 saturate-50" : ""}`}
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
        <ScheduleUtilityDrawer
          open={!!activeUtility}
          utilityId={activeUtility}
          onClose={closeUtilityDrawer}
          scheduleDate={date}
          invoiceInit={activeUtility === "invoices" ? invoiceDrawerInit : null}
          sessionsInit={activeUtility === "sessions" ? sessionsDrawerInit : null}
          onPaymentSuccess={handleInvoicePaymentSuccess}
          onCreateAppointmentFromWaitlist={handleCreateAppointmentFromWaitlist}
          closeGuardRef={utilityCloseGuardRef}
        />
        </div>

        <ScheduleFullscreenUtilityRail
          access={utilityAccess}
          activeId={activeUtility}
          onSelect={handleUtilitySelect}
        />
      </div>

      <div
        ref={modalPortalRef}
        className={isBrowserFullscreen ? "fixed inset-0 z-[120] pointer-events-none [&>*]:pointer-events-auto" : "hidden"}
        data-testid="schedule-modal-portal"
        aria-hidden={!isBrowserFullscreen}
      />

      <ScheduleMoveConfirmModal
        pending={pendingConfirm}
        conflicts={pendingConfirm?.conflicts || []}
        canOverrideConflict={canOverrideConflict}
        busy={confirmBusy}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const hasConflict = (pendingConfirm?.conflicts || []).length > 0;
          const withOverlap = hasConflict && canOverrideConflict;
          const staffChanging = pendingConfirm?.origin?.staffId !== pendingConfirm?.proposed?.staffId;
          if (staffChanging && needsStaffRequestOverride(pendingConfirm.booking, pendingConfirm.proposed.staffId)) {
            setPendingStaffRequestOverride({ withOverlapOverride: withOverlap });
            return;
          }
          confirmScheduleChange(withOverlap, false);
        }}
      />
      <StaffRequestOverrideModal
        open={!!pendingStaffRequestOverride}
        staffName={
          pendingStaffRequestOverride?.conflict?.requested_staff_name
          || requestedStaffName(pendingConfirm?.booking, staff)
        }
        message={
          pendingStaffRequestOverride?.conflict
            ? staffRequestWarningMessage(pendingStaffRequestOverride.conflict, pendingConfirm?.booking, staff)
            : ""
        }
        busy={confirmBusy}
        onCancel={() => setPendingStaffRequestOverride(null)}
        onContinue={() => {
          confirmScheduleChange(!!pendingStaffRequestOverride?.withOverlapOverride, true);
        }}
      />
    </div>
    </ScheduleMetricsProvider>
    </TooltipProvider>
  );
}

export { toDateStr as scheduleDateStr };
