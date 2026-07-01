import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ConsentStatusBadge, { consentSummary } from "@/components/consent/ConsentStatusBadge";
import api from "@/lib/api";
import { REALTIME_TOPICS } from "@/lib/realtimeEvents";
import { debounce } from "@/lib/realtimeEvents";
import { useRealtimeInvalidation, useVisibilityPolling } from "@/lib/realtimeEventsContext";
import {
  buildBookingPerformers,
  filterEligibleStaff,
  serviceAllowsMultiple,
  formatPerformerBadge,
  additionalRowsFromBooking,
  validatePerformerAvailability,
  CLINICAL_PERFORMER_ROLES,
} from "@/lib/performerUtils";
import AdditionalPerformersEditor, { validateAdditionalPerformers } from "@/components/bookings/AdditionalPerformersEditor";
import { useClinic } from "@/lib/clinic";
import { useSettings } from "@/lib/settings";
import { openWhatsgoChatSafe } from "@/lib/whatsgo";
import PatientLabelsRow from "@/components/patient/PatientLabelsRow";
import ManagePatientLabelsModal from "@/components/patient/ManagePatientLabelsModal";
import PatientBlacklistBanner from "@/components/patient/PatientBlacklistBanner";
import BookingMessagingMenu from "@/components/bookings/BookingMessagingMenu";
import {
  APPOINTMENT_STATUS_OPTIONS,
  REASON_STATUSES,
  SENSITIVE_STATUSES,
  paymentStatusLabel,
  resolveBookingDetailActions,
  statusLabel,
} from "@/lib/bookingDetailStatuses";
import { isBlacklisted, blacklistReason } from "@/lib/patientLabelDisplay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarDays, Clock, Phone, MessageCircle, Copy, CheckCircle2, X, Plus,
  ArrowRight, ExternalLink, LayoutList, CalendarRange, Edit2, Ban,
  ChevronDown, MoreHorizontal, Receipt, CalendarClock, Stethoscope, Highlighter,
} from "lucide-react";
import BookingsScheduleView, { scheduleDateStr } from "@/components/bookings/BookingsScheduleView";
import { SCHEDULE_STATUS_FILTER_OPTIONS, filterBookingsByScheduleStatus, resolveApiStatusFilter } from "@/components/bookings/scheduleStatusFilter";
import { isHighlightableBooking } from "@/components/bookings/schedulePatientHighlight";
import { BookingModalPortal } from "@/components/bookings/BookingModalPortal";
import { hhmmToMin } from "@/components/bookings/scheduleUtils";
import OutsideWorkingHoursModal from "@/components/bookings/OutsideWorkingHoursModal";
import OvertimeBadge from "@/components/bookings/OvertimeBadge";
import { formatBookingListDate } from "@/components/bookings/scheduleUtils";
import { useAuth, hasPermission } from "@/lib/auth";
import { evaluateNewBookingSubmit } from "@/lib/bookingSubmitValidation";
import BookingGiftCardSection from "@/components/bookings/BookingGiftCardSection";
import {
  applyGiftCardToBookingForm,
  clearGiftCardFromBookingForm,
  evaluateGiftCardBookingConstraints,
  isGiftCardServiceLocked,
} from "@/lib/bookingGiftCard";
import AppointmentDurationFields from "@/components/bookings/AppointmentDurationFields";
import ConflictOverrideModal from "@/components/bookings/ConflictOverrideModal";
import {
  DURATION_SOURCES,
  durationFromStartEnd,
  endTimeFromStartDuration,
} from "@/lib/bookingDuration";
import { parseScheduleConflict } from "@/lib/bookingConflicts";

function newBookingDurationDefaults(initial) {
  const dragRange = !!(initial?.fromDragRange && initial?.scheduled_time && initial?.scheduled_end_time);
  const start = initial?.scheduled_time || "";
  const durationMin = dragRange
    ? durationFromStartEnd(initial.scheduled_time, initial.scheduled_end_time, initial?.duration_min || 30)
    : (initial?.duration_min || 30);
  return {
    scheduled_end_time: dragRange
      ? initial.scheduled_end_time
      : (start ? endTimeFromStartDuration(start, durationMin) : ""),
    duration_source: dragRange ? DURATION_SOURCES.DRAG_SELECTION : DURATION_SOURCES.TREATMENT_DEFAULT,
    treatment_default_duration_minutes: null,
    manualDurationLocked: dragRange,
    duration_min: durationMin,
  };
}

function appendBookingDurationMetadata(body, form) {
  if (form.duration_source) body.duration_source = form.duration_source;
  if (form.duration_override_reason) body.duration_override_reason = form.duration_override_reason;
  if (form.treatment_default_duration_minutes != null) {
    body.treatment_default_duration_minutes = form.treatment_default_duration_minutes;
  }
}

async function postBookingWithConflict(api, body) {
  try {
    return await api.post("/bookings", body);
  } catch (e) {
    const conflict = parseScheduleConflict(e);
    if (conflict) throw Object.assign(e, { scheduleConflict: conflict });
    throw e;
  }
}

async function putBookingWithConflict(api, bookingId, body) {
  try {
    return await api.put(`/bookings/${bookingId}`, body);
  } catch (e) {
    const conflict = parseScheduleConflict(e);
    if (conflict) throw Object.assign(e, { scheduleConflict: conflict });
    throw e;
  }
}

const STATUS_COLORS = {
  booked:      { label: "Booked",      cls: "info"    },
  confirmed:   { label: "Confirmed",   cls: "success" },
  checked_in:  { label: "Checked in",  cls: "success" },
  completed:   { label: "Completed",   cls: "success" },
  cancelled:   { label: "Cancelled",   cls: "" },
  no_show:     { label: "No show",     cls: "" },
  blocked:     { label: "Blocked time",  cls: "" },
  pending_payment: { label: "Pending payment", cls: "info" },
  payment_expired: { label: "Payment expired", cls: "" },
  payment_failed:  { label: "Payment failed",  cls: "" },
};

const BLOCK_REASON_PRESETS = ["Lunch Break", "Meeting", "Training", "Break", "Other"];
const BLOCK_DURATIONS = [15, 30, 45, 60, 90, 120];

function blockDurationFromTimes(start, end, fallback = 30) {
  const sm = hhmmToMin(start);
  const em = hhmmToMin(end);
  if (sm == null || em == null || em <= sm) return fallback;
  return em - sm;
}

function isTimeBlock(b) {
  return b?.status === "blocked" || b?.booking_type === "block";
}

function SlotActionModal({ initial, staff, onBook, onBlock, onClose }) {
  const performer = staff?.find(s => s.id === initial?.performer_id);
  const startTime = initial?.selected_start_time || initial?.scheduled_time || "";
  const endTime = initial?.selected_end_time || initial?.scheduled_end_time || "";
  const rangeLabel = initial?.selected_range_label
    || (startTime && endTime ? `${startTime} – ${endTime}` : startTime);
  const fromRange = !!(initial?.fromDragRange && startTime && endTime);

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} data-testid="slot-action-modal">
      <div className="bl-card max-w-sm w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-xl text-[#2D3A33]">{fromRange ? "Selected time range" : "This time slot"}</h3>
        <p className="text-sm text-[#5C6C62]">
          {performer?.name || "Staff"}
          {rangeLabel ? ` · ${rangeLabel}` : ""}
        </p>
        {fromRange && (
          <p className="text-xs text-[#52796F] bg-[#EDF3EF] rounded-lg px-3 py-2" data-testid="slot-action-range-hint">
            Appointment will use the selected time range. You can adjust duration in the booking form.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2">
          <button type="button" onClick={onBook} className="bl-btn-primary w-full inline-flex items-center justify-center gap-2" data-testid="slot-action-book">
            <Plus className="w-4 h-4" /> New appointment
          </button>
          <button type="button" onClick={onBlock} className="bl-btn-secondary w-full inline-flex items-center justify-center gap-2" data-testid="slot-action-block">
            <Ban className="w-4 h-4" /> Block time
          </button>
        </div>
        <button type="button" onClick={onClose} className="w-full text-sm text-[#5C6C62] hover:underline">Cancel</button>
      </div>
    </div>
  );
}

function BlockTimeModal({ onClose, onSaved, initial = null, booking = null, onBookTreatment }) {
  const isEdit = !!booking;
  const dt = booking ? new Date(booking.scheduled_at) : null;
  const pad = (n) => String(n).padStart(2, "0");
  const [staff, setStaff] = useState([]);
  const [preset, setPreset] = useState(() => {
    const r = booking?.block_reason || booking?.patient_name || "";
    return BLOCK_REASON_PRESETS.includes(r) ? r : (r ? "Other" : "Lunch Break");
  });
  const [customReason, setCustomReason] = useState(() => {
    const r = booking?.block_reason || booking?.patient_name || "";
    return BLOCK_REASON_PRESETS.includes(r) ? "" : r;
  });
  const [form, setForm] = useState(() => {
    const start = initial?.scheduled_time || (dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : "");
    const end = initial?.scheduled_end_time
      || (booking?.scheduled_at && booking?.duration_min
        ? (() => {
            const bdt = new Date(booking.scheduled_at);
            const endMin = bdt.getHours() * 60 + bdt.getMinutes() + Number(booking.duration_min || 30);
            return `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`;
          })()
        : "");
    const duration = booking?.duration_min
      || (start && end ? blockDurationFromTimes(start, end, initial?.duration_min || 30) : (initial?.duration_min || 30));
    return {
      scheduled_date: initial?.scheduled_date || booking?.scheduled_at?.slice(0, 10) || "",
      scheduled_time: start,
      scheduled_end_time: end,
      performer_id: initial?.performer_id || booking?.performer_id || "",
      duration_min: duration,
      notes: booking?.notes || "",
    };
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/users").then(r => {
      setStaff((r.data || []).filter(u => CLINICAL_PERFORMER_ROLES.includes(u.role) && u.active !== false));
    });
  }, []);

  const reason = preset === "Other" ? customReason.trim() : preset;

  const save = async (e) => {
    e.preventDefault();
    if (!reason) { toast.error("Enter a reason for the block"); return; }
    if (!form.scheduled_date || !form.scheduled_time) { toast.error("Pick date and time"); return; }
    if (!form.performer_id) { toast.error("Select assigned staff"); return; }
    setBusy(true);
    try {
      const scheduled_at = `${form.scheduled_date}T${form.scheduled_time}:00`;
      const body = {
        booking_type: "block",
        block_reason: reason,
        patient_name: reason,
        patient_phone: "—",
        treatment: "Blocked",
        duration_min: Number(form.duration_min) || 30,
        scheduled_at,
        performer_id: form.performer_id,
        notes: form.notes || "",
      };
      if (isEdit) {
        const r = await api.put(`/bookings/${booking.id}`, body);
        toast.success("Blocked time updated");
        onSaved?.(r.data);
      } else {
        await api.post("/bookings", body);
        toast.success("Time slot blocked");
        onSaved?.();
      }
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const performerName = staff.find(s => s.id === form.performer_id)?.name;

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="block-time-modal">
      <form onSubmit={save} className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-[#2D3A33]">{isEdit ? "Edit time block" : "Block time"}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-2 text-sm text-[#5C6C62]">Reserve this staff member&apos;s calendar for breaks, meetings, or other non-appointment time.</p>
        {initial?.fromDragRange && form.scheduled_time && form.scheduled_end_time && (
          <p className="mt-2 text-xs text-[#52796F] bg-[#EDF3EF] rounded-lg px-3 py-2" data-testid="block-drag-range-hint">
            Selected range: {form.scheduled_time} – {form.scheduled_end_time}
          </p>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label className="label-eyebrow block mb-1.5">Reason</label>
            <select className="bl-input" value={preset} onChange={e => setPreset(e.target.value)} data-testid="block-reason-preset">
              {BLOCK_REASON_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {preset === "Other" && (
              <input
                className="bl-input mt-2"
                placeholder="e.g. Team lunch, equipment setup…"
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                required
                data-testid="block-reason-custom"
              />
            )}
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Assigned staff</label>
            {initial?.performer_id && !isEdit ? (
              <div className="bl-input bg-[#F8F5EC] text-[#2D3A33]">{performerName || "Selected from schedule"}</div>
            ) : (
              <select className="bl-input" value={form.performer_id} onChange={e => setForm({ ...form, performer_id: e.target.value })} required data-testid="block-performer">
                <option value="">Select…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1.5">Date</label>
              <input type="date" className="bl-input" required value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} data-testid="block-date" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Start time</label>
              <input
                type="time"
                className="bl-input"
                required
                value={form.scheduled_time}
                onChange={(e) => {
                  const scheduled_time = e.target.value;
                  setForm((f) => ({
                    ...f,
                    scheduled_time,
                    duration_min: f.scheduled_end_time
                      ? blockDurationFromTimes(scheduled_time, f.scheduled_end_time, f.duration_min)
                      : f.duration_min,
                  }));
                }}
                data-testid="block-time"
              />
            </div>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">End time</label>
            <input
              type="time"
              className="bl-input"
              value={form.scheduled_end_time}
              onChange={(e) => {
                const scheduled_end_time = e.target.value;
                setForm((f) => ({
                  ...f,
                  scheduled_end_time,
                  duration_min: scheduled_end_time
                    ? blockDurationFromTimes(f.scheduled_time, scheduled_end_time, f.duration_min)
                    : f.duration_min,
                }));
              }}
              data-testid="block-end-time"
            />
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Duration</label>
            <div className="flex flex-wrap gap-2">
              {BLOCK_DURATIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm({ ...form, duration_min: d })}
                  className="px-3 py-1.5 rounded-lg border text-sm font-medium"
                  style={form.duration_min === d ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)" } : { borderColor: "var(--bl-border)" }}
                  data-testid={`block-duration-${d}`}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Notes (optional)</label>
            <textarea className="bl-input min-h-[72px]" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="block-notes" />
          </div>
        </div>

        {onBookTreatment && !isEdit && (
          <button
            type="button"
            onClick={() => onBookTreatment({
              scheduled_date: form.scheduled_date,
              scheduled_time: form.scheduled_time,
              performer_id: form.performer_id,
              ignoreDraggedEnd: true,
            })}
            className="mt-4 text-sm text-[#52796F] hover:underline"
            data-testid="block-book-treatment-instead"
          >
            Book treatment instead
          </button>
        )}

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={busy} className="bl-btn-primary flex-1 disabled:opacity-50" data-testid="block-save">
            {busy ? "Saving…" : isEdit ? "Save changes" : "Block time"}
          </button>
          <button type="button" onClick={onClose} className="bl-btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}

const NEXT_STATUS = {
  booked: { next: "confirmed", label: "Confirm" },
  confirmed: { next: "checked_in", label: "Check in" },
  checked_in: { next: "completed", label: "Mark complete" },
};

const SCOPE_TABS = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

function patientDisplayName(p) {
  return (p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`.trim()) || "Unknown";
}

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function formatBookingListTime(d, durationMin) {
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${time} · ${durationMin} min`;
}

function bookingPerformerLabel(b) {
  const performers = b.performers || [];
  if (performers.length) {
    const primary = performers.find((p) => p.performer_type === "primary") || performers[0];
    if (primary?.staff_name_snapshot) return primary.staff_name_snapshot;
    const names = performers.map((p) => p.staff_name_snapshot).filter(Boolean);
    if (names.length) return names.join(", ");
  }
  return b.performer_name_snapshot || b.performer_name || "Unassigned";
}

function BookingListCard({ booking, onOpen, onWa }) {
  const block = isTimeBlock(booking);
  const dt = new Date(booking.scheduled_at);
  const sc = STATUS_COLORS[booking.status] || { label: booking.status, cls: "" };
  const patientLabel = block ? (booking.block_reason || booking.patient_name) : booking.patient_name;
  const treatmentLabel = block ? "Blocked time" : (booking.treatment || "—");
  const providerLabel = bookingPerformerLabel(booking);

  return (
    <div className="bl-card p-4" data-testid={`booking-card-${booking.id}`}>
      <button
        type="button"
        onClick={() => onOpen(booking)}
        className="w-full text-left active:bg-[#FBF8EF] -m-1 p-1 rounded-xl"
        data-testid={`booking-card-body-${booking.id}`}
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#F3F1EB] flex flex-col items-center justify-center shrink-0">
            <span className="font-display text-base text-[#2D3A33] leading-none">{dt.getDate()}</span>
            <span className="text-[9px] text-[#5C6C62] uppercase mt-0.5">{dt.toLocaleDateString(undefined, { month: "short" })}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#2D3A33] truncate">{patientLabel}</div>
            <div className="text-xs text-[#5C6C62] mt-1">
              {formatBookingListDate(dt)} · {formatBookingListTime(dt, booking.duration_min || 30)}
            </div>
            <div className="text-xs text-[#5C6C62] mt-1 truncate">{treatmentLabel}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5 truncate">Staff: {providerLabel}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${sc.cls}`} data-testid={`booking-card-status-${booking.id}`}>
                {sc.label}
              </span>
              {booking.is_overtime && !block && <OvertimeBadge />}
            </div>
          </div>
        </div>
      </button>
      <div className="mt-3 pt-3 border-t border-[#EAE6D7] flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(booking); }}
          className="bl-btn-primary text-sm flex-1 min-w-[7rem]"
          data-testid={`booking-card-primary-${booking.id}`}
        >
          Open
        </button>
        {!block && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onWa(booking); }}
            className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
            data-testid={`booking-card-wa-${booking.id}`}
          >
            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
          </button>
        )}
      </div>
    </div>
  );
}

function BookingStepProgress({ current }) {
  const steps = [
    { key: "patient", label: "Patient" },
    { key: "service", label: "Service" },
    { key: "schedule", label: "Schedule" },
  ];
  const idx = steps.findIndex(s => s.key === current);
  return (
    <p className="text-xs text-[#A89F8B] mt-1" aria-hidden="true">
      {steps.map((s, i) => (
        <span key={s.key}>
          {i > 0 && <span className="mx-1.5">→</span>}
          <span style={i <= idx ? { color: "#5C6C62", fontWeight: i === idx ? 500 : 400 } : undefined}>{s.label}</span>
        </span>
      ))}
    </p>
  );
}

function renderTemplate(body, ctx) {
  return body
    .replaceAll("{patient_name}", ctx.patient_name || "")
    .replaceAll("{treatment}", ctx.treatment || "")
    .replaceAll("{date}", ctx.date || "")
    .replaceAll("{time}", ctx.time || "")
    .replaceAll("{clinic_name}", ctx.clinic_name || "");
}

function WaPanel({ booking, templates, clinicName, onSent, onClose, automationActive = false, canSendViaProvider = false, canWhatsgoSend = false }) {
  const [tplKey, setTplKey] = useState(templates[0]?.key || "");
  const [sending, setSending] = useState(false);
  const [openingWhatsgo, setOpeningWhatsgo] = useState(false);
  const tpl = templates.find(t => t.key === tplKey) || templates[0];
  const dt = booking ? new Date(booking.scheduled_at) : null;
  const ctx = {
    patient_name: booking?.patient_name,
    treatment: booking?.treatment,
    date: dt?.toLocaleDateString(),
    time: dt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    clinic_name: clinicName,
  };
  const [body, setBody] = useState(tpl ? renderTemplate(tpl.body, ctx) : "");

  useEffect(() => {
    if (!tpl) return;
    setBody(renderTemplate(tpl.body, ctx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplKey, booking?.id]);

  const copy = () => { navigator.clipboard.writeText(body); toast.success("Message copied"); };
  const markSent = async () => {
    await api.post(`/bookings/${booking.id}/wa-sent`, { template_key: tplKey });
    toast.success("Marked as sent");
    onSent();
  };
  const sendViaProvider = async () => {
    setSending(true);
    try {
      const typeMap = { confirmation: "booking_confirmation", reminder: "booking_reminder", follow_up: "follow_up" };
      await api.post("/messaging/send", {
        booking_id: booking.id,
        template_type: typeMap[tplKey] || "custom",
      });
      toast.success("Message sent via provider");
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };
  const waLink = `https://wa.me/${(booking.patient_phone || "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(body)}`;

  const openWhatsgo = async () => {
    if (!booking.patient_id) {
      toast.error("Patient ID required for Whatsgo chat");
      return;
    }
    setOpeningWhatsgo(true);
    try {
      await openWhatsgoChatSafe(booking.patient_id);
    } finally {
      setOpeningWhatsgo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="wa-panel">
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="label-eyebrow">WhatsApp message</div>
            <h3 className="font-display text-xl text-[#2D3A33] mt-1">{booking.patient_name}</h3>
            <div className="text-xs text-[#5C6C62] mt-0.5">{booking.patient_phone}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="wa-close"><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2" data-testid="wa-templates">
          {templates.map(t => (
            <button
              key={t.key}
              onClick={() => setTplKey(t.key)}
              className="text-left px-3 py-2 rounded-lg border text-xs font-medium"
              style={t.key === tplKey ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)", color: "var(--bl-text)" } : { borderColor: "var(--bl-border)", color: "var(--bl-muted-text)", background: "white" }}
              data-testid={`wa-tpl-${t.key}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <textarea
          className="bl-input min-h-[160px] mt-3 font-mono text-sm"
          value={body}
          onChange={e => setBody(e.target.value)}
          data-testid="wa-body"
        />

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={copy} className="bl-btn-ghost inline-flex items-center justify-center gap-2 text-sm" data-testid="wa-copy">
            <Copy className="w-4 h-4" /> Copy
          </button>
          <a href={waLink} target="_blank" rel="noreferrer" onClick={markSent} className="bl-btn-primary inline-flex items-center justify-center gap-2 text-sm" data-testid="wa-open">
            <MessageCircle className="w-4 h-4" /> Open WhatsApp
          </a>
        </div>
        {canWhatsgoSend && booking.patient_id && (
          <button
            type="button"
            onClick={openWhatsgo}
            disabled={openingWhatsgo}
            className="mt-3 w-full bl-btn-secondary text-sm inline-flex items-center justify-center gap-2"
            data-testid="wa-open-whatsgo"
          >
            <MessageCircle className="w-4 h-4" />
            {openingWhatsgo ? "Opening…" : "Open Whatsgo chat"}
          </button>
        )}
        {automationActive && canSendViaProvider && (
          <button
            type="button"
            onClick={sendViaProvider}
            disabled={sending}
            className="mt-3 w-full bl-btn-secondary text-sm"
            data-testid="wa-send-provider"
          >
            {sending ? "Sending…" : "Send via API provider"}
          </button>
        )}
        {!automationActive && (
          <p className="mt-3 text-xs text-[#5C6C62]">
            Automated send requires a connected WhatsApp API provider in Admin → Messaging. Copy or Open WhatsApp works without it.
          </p>
        )}
        <button onClick={markSent} className="mt-3 w-full text-center text-sm text-[#5C6C62] underline" data-testid="wa-mark-sent">
          Mark as sent without opening
        </button>

        {(booking.wa_history || []).length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#EAE6D7]" data-testid="wa-history">
            <div className="label-eyebrow">History</div>
            <ul className="mt-2 space-y-1 text-xs text-[#5C6C62]">
              {booking.wa_history.map((h, i) => (
                <li key={i}>{h.template_key} · {new Date(h.sent_at).toLocaleString()}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pick primary performer after availability refresh without overriding schedule/manual choice. */
function resolvePerformerAfterAvailability(
  currentId,
  list,
  suggestedId,
  preferredPerformerId,
  performerManuallyChanged,
  { isOvertime = false, eligibleIds = null } = {},
) {
  const ids = new Set((list || []).map((p) => p.id));
  const eligible = eligibleIds instanceof Set ? eligibleIds : new Set(eligibleIds || []);

  const keepIfEligible = (id) => id && eligible.has(id);

  if (isOvertime) {
    if (performerManuallyChanged && keepIfEligible(currentId)) return currentId;
    if (!performerManuallyChanged && keepIfEligible(preferredPerformerId)) return preferredPerformerId;
    if (keepIfEligible(currentId)) return currentId;
    if (ids.size && currentId && ids.has(currentId)) return currentId;
    if (ids.size && !currentId && suggestedId && ids.has(suggestedId)) return suggestedId;
    return currentId && keepIfEligible(currentId) ? currentId : "";
  }

  if (!ids.size) return "";

  if (performerManuallyChanged) {
    return currentId && ids.has(currentId) ? currentId : "";
  }

  const preferred = preferredPerformerId && ids.has(preferredPerformerId) ? preferredPerformerId : "";
  if (preferred) return preferred;

  if (currentId && ids.has(currentId)) return currentId;

  if (currentId && !ids.has(currentId)) return "";

  if (!preferredPerformerId && !currentId && suggestedId && ids.has(suggestedId)) {
    return suggestedId;
  }

  return currentId || "";
}

function NewBookingModal({ onClose, onCreated, initial = null, overtimeMeta = null }) {
  const { user } = useAuth();
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const schedulePrefill = !!(initial?.performer_id && initial?.scheduled_date && initial?.scheduled_time);
  const [preferredPerformerId] = useState(() => (schedulePrefill ? initial.performer_id : null));
  const [performerManuallyChanged, setPerformerManuallyChanged] = useState(false);
  const [treatments, setTreatments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [staff, setStaff] = useState([]);
  const [pSearch, setPSearch] = useState("");
  const [step, setStep] = useState("patient"); // patient -> details
  const [form, setForm] = useState(() => ({
    patient_id: "", patient_name: "", patient_phone: "", patient_email: "",
    booking_kind: "treatment",
    treatment_category: "",
    package_type: "",
    treatment: "", package_id: "", performer_type: "therapist",
    scheduled_date: "", scheduled_time: "",
    performer_id: "",
    assistant_performers: [],
    notes: "",
    ...newBookingDurationDefaults(initial),
  }));
  const [pendingConflict, setPendingConflict] = useState(null);
  const [pendingSubmitBody, setPendingSubmitBody] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [customTime, setCustomTime] = useState(false);
  const [availablePerformers, setAvailablePerformers] = useState(null);
  const [loadingPerformers, setLoadingPerformers] = useState(false);
  const [suggestedPerformerId, setSuggestedPerformerId] = useState(null);
  const [additionalAvailByRole, setAdditionalAvailByRole] = useState({});
  const [appliedGiftCard, setAppliedGiftCard] = useState(null);
  const [labelSettings, setLabelSettings] = useState({ blacklist_booking_policy: "require_confirmation" });
  const [selectedPatientRecord, setSelectedPatientRecord] = useState(null);

  useEffect(() => {
    api.get("/patient-labels/settings").then((r) => setLabelSettings(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/treatments-catalog", { params: { active_only: true } }).then(r => setTreatments(r.data || []));
    api.get("/packages-catalog", { params: { active_only: true } }).then(r => setPackages(r.data || []));
    api.get("/users").then(r => setStaff(r.data || []));
    if (initial?.scheduled_date) {
      setForm(f => ({
        ...f,
        scheduled_date: initial.scheduled_date,
        scheduled_time: initial.scheduled_time || "",
        performer_id: initial.performer_id || f.performer_id,
      }));
      if (initial.scheduled_time) setCustomTime(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoadingPatients(true);
    const q = pSearch.trim();
    const timer = setTimeout(() => {
      api.get("/patients", { params: q ? { q } : {} })
        .then(r => { if (!cancelled) setPatients(r.data || []); })
        .catch(() => { if (!cancelled) setPatients([]); })
        .finally(() => { if (!cancelled) setLoadingPatients(false); });
    }, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pSearch]);

  const isPackage = form.booking_kind === "package";
  const categories = Array.from(new Set(treatments.map(t => t.category)));
  const packageTypes = Array.from(new Set(packages.map(p => p.package_type).filter(Boolean)));
  const filteredTreatments = form.treatment_category ? treatments.filter(t => t.category === form.treatment_category) : treatments;
  const filteredPackages = form.package_type ? packages.filter(p => p.package_type === form.package_type) : packages;

  const selectedTreatment = !isPackage ? treatments.find(t => t.name === form.treatment) : null;
  const selectedPackage = isPackage ? packages.find(p => p.id === form.package_id || p.name === form.treatment) : null;
  const selectedService = selectedTreatment || selectedPackage;
  const serviceLabel = isPackage ? "package" : "treatment";
  const serviceSelected = isPackage ? !!form.package_id : !!form.treatment;
  const subtotalIdr = selectedService ? Number(selectedService.price_idr || 0) : 0;

  const eligibleStaff = useMemo(
    () => filterEligibleStaff(staff, selectedService),
    [staff, selectedService],
  );
  const allowMultiple = serviceAllowsMultiple(selectedService);

  const giftCardConstraint = useMemo(
    () =>
      evaluateGiftCardBookingConstraints({
        appliedGiftCard,
        form,
        serviceSelected,
        isPackage,
      }),
    [appliedGiftCard, form, serviceSelected, isPackage],
  );

  const giftCardLocksService = isGiftCardServiceLocked(appliedGiftCard);

  const submitState = useMemo(
    () =>
      evaluateNewBookingSubmit({
        busy,
        form,
        serviceSelected,
        isPackage,
        overtimeMeta,
        staff,
        eligibleStaff,
        availablePerformers,
        loadingPerformers,
        appliedGiftCard,
        giftCardConstraint,
      }),
    [
      busy,
      form,
      serviceSelected,
      isPackage,
      overtimeMeta,
      staff,
      eligibleStaff,
      availablePerformers,
      loadingPerformers,
      appliedGiftCard,
      giftCardConstraint,
    ],
  );

  // Reload slots whenever date, treatment, or performer changes
  useEffect(() => {
    if (!form.scheduled_date || !serviceSelected) { setSlots([]); return; }
    setLoadingSlots(true);
    api.get("/clinics/me").then(rc => {
      const cslug = rc.data?.slug;
      const params = { date: form.scheduled_date, duration: form.duration_min, treatment: form.treatment };
      if (form.performer_id) params.performer_id = form.performer_id;
      return api.get(`/public/clinics/${cslug}/availability`, { params });
    }).then(r => setSlots(r.data?.slots || [])).finally(() => setLoadingSlots(false));
  }, [form.scheduled_date, form.treatment, form.duration_min, form.performer_id, serviceSelected]);

  // Fetch available performers for the chosen slot (filters off-duty/on-leave/already booked)
  useEffect(() => {
    if (!form.scheduled_date || !serviceSelected || !form.scheduled_time) {
      setAvailablePerformers(null);
      return;
    }
    setLoadingPerformers(true);
    const params = {
      date: form.scheduled_date,
      time: form.scheduled_time,
      duration: form.duration_min,
      treatment: form.treatment,
      is_overtime: overtimeMeta ? true : undefined,
    };
    if (isPackage) {
      params.package_id = form.package_id;
      params.booking_type = "package";
    }
    api.get("/bookings/available-performers", { params })
      .then(r => {
        const list = r.data?.performers || [];
        const sug = r.data?.suggested_performer_id || null;
        setAvailablePerformers(list);
        setSuggestedPerformerId(sug);
        const eligibleIds = new Set(eligibleStaff.map((s) => s.id));
        setForm((f) => ({
          ...f,
          performer_id: resolvePerformerAfterAvailability(
            f.performer_id,
            list,
            sug,
            preferredPerformerId,
            performerManuallyChanged,
            { isOvertime: !!overtimeMeta, eligibleIds },
          ),
        }));
      })
      .catch(() => { setAvailablePerformers([]); setSuggestedPerformerId(null); })
      .finally(() => setLoadingPerformers(false));
  }, [
    form.scheduled_date,
    form.scheduled_time,
    form.treatment,
    form.duration_min,
    form.package_id,
    form.booking_kind,
    serviceSelected,
    isPackage,
    overtimeMeta,
    preferredPerformerId,
    performerManuallyChanged,
    eligibleStaff,
    overtimeMeta,
  ]);

  const keepSchedulePerformer = () =>
    preferredPerformerId && !performerManuallyChanged ? preferredPerformerId : "";

  const selectTreatment = (name) => {
    const t = treatments.find(x => x.name === name);
    const def = t?.duration_min || 30;
    setForm(f => ({
      ...f,
      treatment: name,
      package_id: "",
      duration_min: f.manualDurationLocked ? f.duration_min : def,
      treatment_default_duration_minutes: def,
      scheduled_end_time: f.manualDurationLocked
        ? f.scheduled_end_time
        : endTimeFromStartDuration(f.scheduled_time, def),
      duration_source: f.manualDurationLocked ? f.duration_source : DURATION_SOURCES.TREATMENT_DEFAULT,
      performer_type: t?.performer_type || "therapist",
      performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : ""),
      assistant_performers: [],
    }));
  };

  const selectPackage = (id) => {
    const p = packages.find(x => x.id === id);
    const def = p?.duration_min || 60;
    setForm(f => ({
      ...f,
      package_id: id,
      treatment: p?.name || "",
      duration_min: f.manualDurationLocked ? f.duration_min : def,
      treatment_default_duration_minutes: def,
      scheduled_end_time: f.manualDurationLocked
        ? f.scheduled_end_time
        : endTimeFromStartDuration(f.scheduled_time, def),
      duration_source: f.manualDurationLocked ? f.duration_source : DURATION_SOURCES.TREATMENT_DEFAULT,
      performer_type: p?.performer_type || "therapist",
      performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : ""),
      assistant_performers: [],
    }));
  };

  const applyGiftCard = (gc) => {
    if (!gc) {
      setAppliedGiftCard(null);
      setForm((f) => clearGiftCardFromBookingForm(f));
      return;
    }
    setAppliedGiftCard(gc);
    setForm((f) => applyGiftCardToBookingForm(f, gc, treatments, packages));
  };

  const switchBookingKind = (kind) => {
    if (giftCardLocksService) return;
    setForm(f => ({
      ...f,
      booking_kind: kind,
      treatment: "",
      package_id: "",
      treatment_category: "",
      package_type: "",
      performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : ""),
      assistant_performers: [],
    }));
  };

  const setPrimaryPerformer = (performerId, manual = false) => {
    if (manual) setPerformerManuallyChanged(true);
    setForm((f) => ({ ...f, performer_id: performerId }));
  };

  const selectPatient = (p) => {
    if (isBlacklisted(p)) {
      const policy = labelSettings.blacklist_booking_policy || "require_confirmation";
      const reason = blacklistReason(p);
      if (policy === "block") {
        toast.error("This patient is blacklisted. Appointment creation is blocked by clinic policy.");
        return;
      }
      if (policy === "require_confirmation") {
        const msg = `This patient is marked as Blacklist.${reason ? `\n\nReason: ${reason}` : ""}\n\nContinue booking anyway?`;
        if (!window.confirm(msg)) return;
      }
    }
    setSelectedPatientRecord(p);
    setForm(f => ({ ...f, patient_id: p.id, patient_name: patientDisplayName(p), patient_phone: p.phone || "", patient_email: p.email || "" }));
    setNewPatient(false);
    setStep("details");
  };

  const startNewPatient = () => {
    setSelectedPatientRecord(null);
    setForm(f => ({ ...f, patient_id: "", patient_name: "", patient_phone: "", patient_email: "" }));
    setNewPatient(true);
    setStep("details");
  };

  const submit = async (overlapOverride = false) => {
    if (!form.scheduled_date || !form.scheduled_time) { toast.error("Pick a date and time"); return; }
    const apErr = validateAdditionalPerformers(form.assistant_performers, form.performer_id);
    if (apErr) { toast.error(apErr); return; }
    if (!form.performer_id) {
      toast.error("Select a provider");
      return;
    }
    const availErr = validatePerformerAvailability(
      form.performer_id,
      form.assistant_performers,
      availablePerformers,
      additionalAvailByRole,
      { skipPrimary: !!overtimeMeta },
    );
    if (availErr) { toast.error(availErr); return; }
    if (availablePerformers !== null && availablePerformers.length > 0 && !form.performer_id) {
      toast.error("Select an available provider");
      return;
    }
    setBusy(true);
    try {
      const scheduled_at = `${form.scheduled_date}T${form.scheduled_time}:00`;
      const performers = buildBookingPerformers(form.performer_id, form.assistant_performers, staff);
      const body = {
        patient_id: form.patient_id || null,
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        patient_email: form.patient_email,
        treatment: form.treatment,
        duration_min: form.duration_min,
        scheduled_at,
        performer_id: form.performer_id || null,
        performers: performers.length ? performers : undefined,
        notes: form.notes,
        booking_type: isPackage ? "package" : "treatment",
        package_id: isPackage ? form.package_id : null,
      };
      appendBookingDurationMetadata(body, form);
      if (overlapOverride) body.overlap_override = true;
      if (overtimeMeta) {
        body.is_overtime = true;
        body.overtime_reason = overtimeMeta.reason;
        body.overtime_note = overtimeMeta.note;
      }
      if (giftCardLocksService && appliedGiftCard?.gift_card_id) {
        body.gift_card_id = appliedGiftCard.gift_card_id;
      }
      await postBookingWithConflict(api, body);
      toast.success(overtimeMeta ? "Overtime appointment created" : "Appointment created");
      setPendingConflict(null);
      setPendingSubmitBody(null);
      onCreated();
    } catch (e) {
      if (e.scheduleConflict) {
        setPendingConflict(e.scheduleConflict);
        const scheduled_at = `${form.scheduled_date}T${form.scheduled_time}:00`;
        const performers = buildBookingPerformers(form.performer_id, form.assistant_performers, staff);
        setPendingSubmitBody({
          patient_id: form.patient_id || null,
          patient_name: form.patient_name,
          patient_phone: form.patient_phone,
          patient_email: form.patient_email,
          treatment: form.treatment,
          duration_min: form.duration_min,
          scheduled_at,
          performer_id: form.performer_id || null,
          performers: performers.length ? performers : undefined,
          notes: form.notes,
          booking_type: isPackage ? "package" : "treatment",
          package_id: isPackage ? form.package_id : null,
          ...(overtimeMeta ? {
            is_overtime: true,
            overtime_reason: overtimeMeta.reason,
            overtime_note: overtimeMeta.note,
          } : {}),
          ...(giftCardLocksService && appliedGiftCard?.gift_card_id
            ? { gift_card_id: appliedGiftCard.gift_card_id }
            : {}),
        });
        return;
      }
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "object" ? (detail.message || "Failed to create") : (detail || "Failed to create"));
    } finally { setBusy(false); }
  };

  const continueAfterConflict = async () => {
    if (!pendingSubmitBody) return;
    setBusy(true);
    try {
      const body = { ...pendingSubmitBody, overlap_override: true };
      appendBookingDurationMetadata(body, form);
      await api.post("/bookings", body);
      toast.success(overtimeMeta ? "Overtime appointment created" : "Appointment created");
      setPendingConflict(null);
      setPendingSubmitBody(null);
      onCreated();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "object" ? (detail.message || "Failed to create") : (detail || "Failed to create"));
    } finally {
      setBusy(false);
    }
  };

  const visiblePatients = patients;

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="new-booking-modal">
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-[#2D3A33]">New appointment</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]"><X className="w-5 h-5" /></button>
        </div>

        {step === "patient" && (
          <div className="mt-5" data-testid="nb-step-patient">
            <p className="text-xs text-[#5C6C62]">Step 1 of 3 · Choose patient</p>
            <BookingStepProgress current="patient" />
            <label className="label-eyebrow block mb-1.5 mt-3">Choose patient</label>
            <input className="bl-input" placeholder="Search name, phone, email, or code…" value={pSearch} onChange={e => setPSearch(e.target.value)} data-testid="nb-patient-search" />
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#EAE6D7]" data-testid="nb-patient-list">
              {loadingPatients && <div className="text-sm text-[#5C6C62] py-6 text-center">Loading patients…</div>}
              {!loadingPatients && visiblePatients.length === 0 && (
                <div className="text-sm text-[#5C6C62] py-6 text-center">
                  {pSearch.trim() ? "No patients match your search." : "No patients yet — add one or use walk-in."}
                </div>
              )}
              {!loadingPatients && visiblePatients.map(p => (
                <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-4 py-2.5 border-b border-[#EAE6D7] last:border-b-0 hover:bg-[#F8F5EC]" data-testid={`nb-patient-${p.id}`}>
                  <div className="font-medium text-[#2D3A33] flex flex-wrap items-center gap-2">
                    {patientDisplayName(p)}
                    <PatientLabelsRow labels={p.patient_labels} />
                  </div>
                  <div className="text-xs text-[#5C6C62]">
                    {p.phone || "—"} {p.email && `· ${p.email}`}{p.user_code && ` · ${p.user_code}`}
                    {isBlacklisted(p) && <span className="text-red-700 font-medium"> · Blacklisted patient</span>}
                  </div>
                </button>
              ))}
            </div>
            <button onClick={startNewPatient} className="mt-3 w-full bl-btn-ghost text-sm" data-testid="nb-walk-in">+ Add walk-in or new patient</button>
          </div>
        )}

        {step === "details" && (
          <div className="mt-5 space-y-4" data-testid="nb-step-details">
            <div>
              <p className="text-xs text-[#5C6C62]">Step 2 of 3 · Appointment details</p>
              <BookingStepProgress current="service" />
            </div>
            <button onClick={() => { setSelectedPatientRecord(null); setStep("patient"); }} className="text-xs text-[#5C6C62] hover:text-[#2D3A33]">← Change patient</button>
            <PatientBlacklistBanner patient={selectedPatientRecord} className="mt-2" />
            <div className="bl-card p-3 text-sm flex items-center justify-between">
              <div>
                <div className="font-medium text-[#2D3A33]">{form.patient_name || "Walk-in"}</div>
                <div className="text-xs text-[#5C6C62]">{form.patient_phone || "—"}</div>
              </div>
              {newPatient && <span className="bl-chip">new</span>}
            </div>

            {newPatient && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Name</label>
                  <input className="bl-input" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} required data-testid="nb-patient-name" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Phone</label>
                  <input className="bl-input" value={form.patient_phone} onChange={e => setForm({...form, patient_phone: e.target.value})} required data-testid="nb-patient-phone" />
                </div>
              </div>
            )}
            {!newPatient && !String(form.patient_phone || "").trim() && (
              <div>
                <label className="label-eyebrow block mb-1.5">Phone (required for appointment)</label>
                <input
                  className="bl-input"
                  value={form.patient_phone}
                  onChange={(e) => setForm({ ...form, patient_phone: e.target.value })}
                  placeholder="Add patient phone"
                  required
                  data-testid="nb-patient-phone-existing"
                />
                <p className="text-xs text-[#5C6C62] mt-1">This patient has no phone on file. Enter one to continue.</p>
              </div>
            )}

            {canRedeemGiftCard && (
              <BookingGiftCardSection
                patientId={form.patient_id}
                applied={appliedGiftCard}
                onAppliedChange={applyGiftCard}
              />
            )}

            <div>
              <label className="label-eyebrow block mb-1.5">Service type</label>
              <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1">
                <button type="button" onClick={() => switchBookingKind("treatment")} disabled={giftCardLocksService} className="flex-1 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50" style={!isPackage ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="nb-kind-treatment">Treatment</button>
                <button type="button" onClick={() => switchBookingKind("package")} disabled={giftCardLocksService} className="flex-1 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50" style={isPackage ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="nb-kind-package">Package</button>
              </div>
            </div>

            {!isPackage ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Treatment category</label>
                  <select className="bl-input" value={form.treatment_category} disabled={giftCardLocksService} onChange={e => setForm(f => ({...form, treatment_category: e.target.value, treatment: "", performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : "")}))} data-testid="nb-category">
                    <option value="">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Treatment</label>
                  <select className="bl-input" value={form.treatment} disabled={giftCardLocksService} onChange={e => selectTreatment(e.target.value)} required data-testid="nb-treatment">
                    <option value="">Select treatment</option>
                    {filteredTreatments.map(t => <option key={t.id} value={t.name}>{t.name} · {t.duration_min}min</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Package type</label>
                  <select className="bl-input" value={form.package_type} disabled={giftCardLocksService} onChange={e => setForm(f => ({...form, package_type: e.target.value, package_id: "", treatment: "", performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : "")}))} data-testid="nb-package-type">
                    <option value="">All types</option>
                    {packageTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Package</label>
                  <select className="bl-input" value={form.package_id} disabled={giftCardLocksService} onChange={e => selectPackage(e.target.value)} required data-testid="nb-package">
                    <option value="">Pick a package…</option>
                    {filteredPackages.map(p => <option key={p.id} value={p.id}>{p.name} · Rp {Number(p.price_idr || 0).toLocaleString("id-ID")}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Date</label>
                <input type="date" className="bl-input" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} required data-testid="nb-date" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <label className="label-eyebrow">Start time</label>
                    {overtimeMeta && <OvertimeBadge />}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCustomTime(v => !v); setForm(f => ({ ...f, scheduled_time: "" })); }}
                    className="text-xs underline text-[#5C6C62] hover:text-[#2D3A33]"
                    data-testid="nb-custom-time-toggle"
                  >
                    {customTime ? "Use clinic slots" : "Custom time"}
                  </button>
                </div>
                {customTime ? (
                  <input
                    type="time"
                    step="60"
                    className="bl-input"
                    value={form.scheduled_time}
                    onChange={e => setForm({ ...form, scheduled_time: e.target.value })}
                    disabled={!serviceSelected || !form.scheduled_date}
                    required
                    data-testid="nb-time-custom"
                  />
                ) : (
                  <select className="bl-input" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} disabled={!serviceSelected || !form.scheduled_date} required data-testid="nb-time">
                    <option value="">{loadingSlots ? "Loading slots…" : (serviceSelected && form.scheduled_date ? "Pick a time…" : `Pick ${serviceLabel} & date first`)}</option>
                    {slots.filter(s => !s.past).map(s => (
                      <option key={s.time} value={s.label} disabled={!s.available}>{s.label} {s.available ? "" : "— booked"}</option>
                    ))}
                  </select>
                )}
                {customTime && overtimeMeta && (
                  <p className="text-xs text-[#A89F8B] mt-1">
                    Overtime appointment — availability rechecks when you change time or assigned staff.
                  </p>
                )}
              </div>
            </div>

            {serviceSelected && form.scheduled_date && form.scheduled_time && (
              <AppointmentDurationFields
                scheduledDate={form.scheduled_date}
                startTime={form.scheduled_time}
                endTime={form.scheduled_end_time}
                durationMin={form.duration_min}
                treatmentDefaultMin={form.treatment_default_duration_minutes ?? selectedService?.duration_min}
                durationSource={form.duration_source}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                testIdPrefix="nb-dur"
              />
            )}

            {overtimeMeta && (
              <p className="text-xs text-[#5C6C62] -mt-2" data-testid="nb-overtime-notice">
                Overtime appointment · {overtimeMeta.reason}
              </p>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                <label className="label-eyebrow">
                  Assigned staff
                  {selectedService && <span className="text-[#A89F8B] normal-case ml-1">· {selectedService.performer_type}</span>}
                </label>
                {(() => {
                  const slotChosen = !!(form.scheduled_date && form.scheduled_time);
                  if (!slotChosen || !suggestedPerformerId || loadingPerformers) return null;
                  const sug = availablePerformers?.find(p => p.id === suggestedPerformerId);
                  if (!sug) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setPrimaryPerformer(suggestedPerformerId, true)}
                      className="text-xs underline text-[#52796F] hover:text-[#2D3A33] flex items-center gap-1"
                      data-testid="nb-autopick"
                      title={`Least-busy ${sug.role} today (${sug.bookings_today} appointment${sug.bookings_today === 1 ? "" : "s"})`}
                    >
                      ✨ Auto-pick {sug.name}
                    </button>
                  );
                })()}
              </div>
              {(() => {
                const slotChosen = !!(form.scheduled_date && form.scheduled_time);
                const availableIds = new Set((availablePerformers || []).map((p) => p.id));
                let list =
                  slotChosen && availablePerformers !== null
                    ? eligibleStaff.filter((s) => availableIds.has(s.id))
                    : [];
                if (
                  overtimeMeta &&
                  form.performer_id &&
                  slotChosen &&
                  !availableIds.has(form.performer_id)
                ) {
                  const extra = eligibleStaff.find((s) => s.id === form.performer_id);
                  if (extra && !list.some((s) => s.id === extra.id)) {
                    list = [extra, ...list];
                  }
                }
                const optionIds = new Set(list.map((s) => s.id));
                const displayValue =
                  form.performer_id && optionIds.has(form.performer_id) ? form.performer_id : "";
                const disabled = !serviceSelected || !slotChosen || loadingPerformers;
                const hint = !serviceSelected || !form.scheduled_date
                  ? "Select treatment and date first."
                  : !form.scheduled_time
                    ? "Select a time to see available providers."
                    : loadingPerformers
                      ? "Checking availability…"
                      : (list.length === 0
                          ? "No provider is available for this time. Try another time or check staff schedule."
                          : null);
                return (
                  <>
                    <select
                      className="bl-input"
                      value={displayValue}
                      onChange={e => setPrimaryPerformer(e.target.value, true)}
                      disabled={disabled}
                      required={list.length > 0}
                      data-testid="nb-performer"
                    >
                      {list.length === 0 && <option value="">— No provider available —</option>}
                      {list.map(s => {
                        const ap = availablePerformers?.find(p => p.id === s.id);
                        const load = ap?.bookings_today ?? 0;
                        const isSuggested = s.id === suggestedPerformerId;
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.role}){isSuggested ? " ✨" : ""} · {load} today
                          </option>
                        );
                      })}
                    </select>
                    {hint && (
                      <div className="text-xs mt-1.5" style={{ color: list.length === 0 && slotChosen ? "#B14A2C" : "#A89F8B" }} data-testid="nb-performer-hint">
                        {hint}
                      </div>
                    )}
                    {slotChosen && !loadingPerformers && eligibleStaff.length > 0 && availablePerformers !== null && availablePerformers.length < eligibleStaff.length && (
                      <div className="text-[11px] text-[#A89F8B] mt-1">
                        {eligibleStaff.length - availablePerformers.length} {selectedTreatment?.performer_type || "staff"}(s) hidden — off-duty or already booked.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {allowMultiple && serviceSelected && (
              <AdditionalPerformersEditor
                rows={form.assistant_performers}
                onChange={(assistant_performers) => setForm((f) => ({ ...f, assistant_performers }))}
                onAvailabilityChange={setAdditionalAvailByRole}
                primaryPerformerId={form.performer_id}
                staff={staff}
                scheduledDate={form.scheduled_date}
                scheduledTime={form.scheduled_time}
                durationMin={form.duration_min}
                treatment={form.treatment}
                packageId={isPackage ? form.package_id : null}
                bookingType={isPackage ? "package" : "treatment"}
                testIdPrefix="nb"
              />
            )}

            {serviceSelected && (
              <div className="bl-card p-4 space-y-3" data-testid="nb-pricing">
                <div className="label-eyebrow text-[#5C6C62]">Estimated price</div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C6C62]">Subtotal</span>
                  <span className="text-[#2D3A33] font-medium" data-testid="nb-total-price">{fmtIDR(subtotalIdr)}</span>
                </div>
                <p className="text-xs text-[#5C6C62]">Campaign discounts are applied when creating the invoice.</p>
              </div>
            )}

            <div>
              <label className="label-eyebrow block mb-1.5">Notes (optional)</label>
              <textarea className="bl-input min-h-[60px]" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} data-testid="nb-notes" />
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex gap-3">
                <button
                  onClick={submit}
                  disabled={!submitState.canSubmit}
                  className="bl-btn-primary flex-1 disabled:opacity-50"
                  data-testid="new-booking-submit"
                >
                  {busy ? "Saving…" : "Create appointment"}
                </button>
                <button type="button" onClick={onClose} className="bl-btn-ghost shrink-0">Cancel</button>
              </div>
              {!submitState.canSubmit && submitState.disabledReason && (
                <p className="text-sm text-[#B14A2C]" data-testid="new-booking-disabled-reason">
                  {submitState.disabledReason}
                </p>
              )}
              {import.meta.env.DEV && (
                <details className="text-[10px] text-[#5C6C62] border border-[#EAE6D7] rounded-lg p-2" data-testid="new-booking-submit-debug">
                  <summary className="cursor-pointer font-medium">Submit debug (dev)</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(submitState.debug, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        )}
        {pendingConflict && (
          <ConflictOverrideModal
            conflict={pendingConflict}
            busy={busy}
            onCancel={() => { setPendingConflict(null); setPendingSubmitBody(null); }}
            onContinue={continueAfterConflict}
          />
        )}
      </div>
    </div>
  );
}

const VIEW_MODES = [
  { key: "schedule", label: "Schedule", icon: CalendarRange },
  { key: "list", label: "List", icon: LayoutList },
];

function bookingToForm(booking, treatments = [], packages = []) {
  const dt = new Date(booking.scheduled_at);
  const pad = (n) => String(n).padStart(2, "0");
  const isPackage = booking.booking_type === "package" || !!booking.package_id;
  const t = !isPackage ? treatments.find(x => x.name === booking.treatment) : null;
  const pkg = isPackage ? packages.find(x => x.id === booking.package_id || x.name === booking.treatment) : null;
  return {
    patient_name: booking.patient_name || "",
    patient_phone: booking.patient_phone || "",
    patient_email: booking.patient_email || "",
    booking_kind: isPackage ? "package" : "treatment",
    treatment: booking.treatment || "",
    package_id: booking.package_id || pkg?.id || "",
    treatment_category: t?.category || "",
    package_type: pkg?.package_type || "",
    duration_min: booking.duration_min || 30,
    scheduled_date: booking.scheduled_at.slice(0, 10),
    scheduled_time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    scheduled_end_time: endTimeFromStartDuration(
      `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      booking.duration_min || 30,
    ),
    duration_source: booking.duration_source || DURATION_SOURCES.TREATMENT_DEFAULT,
    treatment_default_duration_minutes: booking.treatment_default_duration_minutes ?? (t?.duration_min || pkg?.duration_min || null),
    manualDurationLocked: booking.duration_source === DURATION_SOURCES.MANUAL_OVERRIDE
      || booking.duration_source === DURATION_SOURCES.DRAG_SELECTION,
    performer_id: booking.performer_id || "",
    assistant_performers: additionalRowsFromBooking(booking),
    notes: booking.notes || "",
  };
}

function BookingDetailPanel({
  booking: initialBooking,
  onClose,
  canManage,
  user,
  onAdvance,
  onCancel,
  onSaved,
  onStartVisit,
  startVisitBusy,
  onEditBlock,
  startInEditMode = false,
  onHighlightPatient,
  onRebook,
  automationActive = false,
  canSendViaProvider = false,
  canWhatsgoSend = false,
}) {
  const navigate = useNavigate();
  const block = isTimeBlock(initialBooking);
  const [booking, setBooking] = useState(initialBooking);
  const editable = canManage && !["cancelled", "completed", "no_show"].includes(booking?.status);
  const canEditStatus = canManage && (hasPermission(user, "appointments.edit") || ["super_admin", "fo", "manager"].includes(user?.role));
  const canManageLabels = hasPermission(user, "patient_labels.assign") || hasPermission(user, "patient_labels.manage");
  const canCreateInvoice = hasPermission(user, "billing.create");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => bookingToForm(initialBooking));
  const [noteDraft, setNoteDraft] = useState(initialBooking?.notes || "");
  const [noteBusy, setNoteBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [treatments, setTreatments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [staff, setStaff] = useState([]);
  const [availablePerformers, setAvailablePerformers] = useState(null);
  const [loadingPerformers, setLoadingPerformers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingConflict, setPendingConflict] = useState(null);
  const [pendingEditPayload, setPendingEditPayload] = useState(null);
  const [additionalAvailByRole, setAdditionalAvailByRole] = useState({});
  const [consentForms, setConsentForms] = useState([]);
  const noteInputRef = useRef(null);

  useEffect(() => {
    if (!initialBooking?.id) return;
    api.get(`/bookings/${initialBooking.id}`)
      .then((r) => {
        setBooking(r.data);
        setNoteDraft(r.data.notes || "");
      })
      .catch(() => setBooking(initialBooking));
  }, [initialBooking?.id]);

  const refreshBooking = async () => {
    if (!booking?.id) return;
    const r = await api.get(`/bookings/${booking.id}`);
    setBooking(r.data);
    setNoteDraft(r.data.notes || "");
    onSaved?.(r.data);
  };

  const saveNote = async () => {
    setNoteBusy(true);
    try {
      const r = await api.put(`/bookings/${booking.id}`, { notes: noteDraft });
      setBooking((b) => ({ ...b, notes: r.data.notes }));
      toast.success("Booking note saved");
      onSaved?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save note");
    } finally {
      setNoteBusy(false);
    }
  };

  const changeStatus = async (newStatus) => {
    if (!canEditStatus || newStatus === (booking.display_status || booking.status)) return;
    let reason = "";
    if (REASON_STATUSES.has(newStatus)) {
      const ok = window.confirm(`Mark this appointment as ${statusLabel(newStatus)}?`);
      if (!ok) return;
      reason = window.prompt(`Reason for ${statusLabel(newStatus)} (required):`) || "";
      if (!reason.trim()) {
        toast.error("Reason is required");
        return;
      }
    } else if (SENSITIVE_STATUSES.has(newStatus)) {
      if (!window.confirm(`Change status to ${statusLabel(newStatus)}?`)) return;
      if (newStatus === "closed") {
        reason = window.prompt("Note for closing (optional):") || "";
      }
    }
    setStatusBusy(true);
    try {
      const r = await api.put(`/bookings/${booking.id}/status`, { status: newStatus, reason: reason || undefined });
      setBooking(r.data);
      toast.success("Status updated");
      onSaved?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update status");
    } finally {
      setStatusBusy(false);
    }
  };

  useEffect(() => {
    const next = bookingToForm(booking, treatments, packages);
    setForm(next);
    setEditing(startInEditMode && canManage && !isTimeBlock(booking) && !["cancelled", "completed", "no_show"].includes(booking?.status));
  }, [booking?.id, treatments, packages, startInEditMode, canManage]);

  useEffect(() => {
    api.get("/treatments-catalog", { params: { active_only: true } }).then(r => setTreatments(r.data || []));
    api.get("/packages-catalog", { params: { active_only: true } }).then(r => setPackages(r.data || []));
    api.get("/users").then(r => setStaff(r.data || []));
  }, []);

  useEffect(() => {
    if (!booking?.id || block) {
      setConsentForms([]);
      return;
    }
    api.get(`/bookings/${booking.id}/consent-forms`)
      .then((r) => setConsentForms(r.data || []))
      .catch(() => setConsentForms([]));
  }, [booking?.id, booking?.visit_id, block]);

  const isPackage = form.booking_kind === "package";
  const selectedTreatment = !isPackage ? treatments.find(t => t.name === form.treatment) : null;
  const selectedPackage = isPackage ? packages.find(p => p.id === form.package_id || p.name === form.treatment) : null;
  const selectedService = selectedTreatment || selectedPackage;
  const serviceSelected = isPackage ? !!form.package_id : !!form.treatment;
  const categories = Array.from(new Set(treatments.map(t => t.category)));
  const packageTypes = Array.from(new Set(packages.map(p => p.package_type).filter(Boolean)));
  const filteredTreatments = form.treatment_category
    ? treatments.filter(t => t.category === form.treatment_category)
    : treatments;
  const filteredPackages = form.package_type
    ? packages.filter(p => p.package_type === form.package_type)
    : packages;
  const subtotalIdr = selectedService ? Number(selectedService.price_idr || 0) : (booking?.subtotal_idr || 0);
  const viewSubtotal = booking?.subtotal_idr ?? subtotalIdr;
  const viewDiscount = booking?.discount_idr || 0;
  const viewTotal = booking?.total_idr ?? viewSubtotal;

  const eligibleStaff = filterEligibleStaff(staff, selectedService);
  const allowMultiple = serviceAllowsMultiple(selectedService);

  useEffect(() => {
    if (!editing || !form.scheduled_date || !serviceSelected || !form.scheduled_time) {
      setAvailablePerformers(null);
      return;
    }
    setLoadingPerformers(true);
    const params = {
      date: form.scheduled_date,
      time: form.scheduled_time,
      duration: form.duration_min,
      treatment: form.treatment,
    };
    if (isPackage) {
      params.package_id = form.package_id;
      params.booking_type = "package";
    }
    params.exclude_booking_id = booking.id;
    api.get("/bookings/available-performers", { params })
      .then(r => {
        const list = r.data?.performers || [];
        setAvailablePerformers(list);
        setForm((f) => {
          if (!f.performer_id || list.some((p) => p.id === f.performer_id)) return f;
          return { ...f, performer_id: "" };
        });
      })
      .catch(() => setAvailablePerformers([]))
      .finally(() => setLoadingPerformers(false));
  }, [editing, form.scheduled_date, form.scheduled_time, form.treatment, form.duration_min, form.package_id, form.booking_kind, serviceSelected, isPackage, booking.id]);

  if (!booking) return null;
  const dt = new Date(booking.scheduled_at);
  const displayStatus = booking.display_status || booking.status;
  const sc = STATUS_COLORS[displayStatus] || STATUS_COLORS[booking.status] || { label: booking.status, cls: "" };
  const actions = resolveBookingDetailActions(booking, {
    block,
    canManage,
    canCreateInvoice,
    editing,
  });
  const blockLabel = booking.block_reason || booking.patient_name;

  const selectTreatment = (name) => {
    const t = treatments.find(x => x.name === name);
    const def = t?.duration_min || 30;
    setForm(f => ({
      ...f,
      treatment: name,
      package_id: "",
      duration_min: f.manualDurationLocked ? f.duration_min : def,
      treatment_default_duration_minutes: def,
      scheduled_end_time: f.manualDurationLocked
        ? f.scheduled_end_time
        : endTimeFromStartDuration(f.scheduled_time, def),
      duration_source: f.manualDurationLocked ? f.duration_source : DURATION_SOURCES.TREATMENT_DEFAULT,
      treatment_category: t?.category || f.treatment_category,
    }));
  };

  const selectPackage = (id) => {
    const p = packages.find(x => x.id === id);
    const def = p?.duration_min || 60;
    setForm(f => ({
      ...f,
      package_id: id,
      treatment: p?.name || "",
      duration_min: f.manualDurationLocked ? f.duration_min : def,
      treatment_default_duration_minutes: def,
      scheduled_end_time: f.manualDurationLocked
        ? f.scheduled_end_time
        : endTimeFromStartDuration(f.scheduled_time, def),
      duration_source: f.manualDurationLocked ? f.duration_source : DURATION_SOURCES.TREATMENT_DEFAULT,
      package_type: p?.package_type || f.package_type,
    }));
  };

  const switchBookingKind = (kind) => {
    setForm(f => ({
      ...f,
      booking_kind: kind,
      treatment: "",
      package_id: "",
      treatment_category: "",
      package_type: "",
    }));
  };

  const save = async () => {
    if (!form.patient_name?.trim() || !form.patient_phone?.trim() || !serviceSelected || !form.scheduled_date || !form.scheduled_time) {
      toast.error(`Fill in patient, ${isPackage ? "package" : "treatment"}, date, and time`);
      return;
    }
    const apErr = validateAdditionalPerformers(form.assistant_performers, form.performer_id);
    if (apErr) { toast.error(apErr); return; }
    const availErr = validatePerformerAvailability(
      form.performer_id,
      form.assistant_performers,
      availablePerformers,
      additionalAvailByRole,
    );
    if (availErr) { toast.error(availErr); return; }
    setBusy(true);
    try {
      const scheduled_at = `${form.scheduled_date}T${form.scheduled_time}:00`;
      const performers = buildBookingPerformers(form.performer_id, form.assistant_performers, staff);
      const payload = {
        patient_name: form.patient_name.trim(),
        patient_phone: form.patient_phone.trim(),
        patient_email: form.patient_email?.trim() || "",
        treatment: form.treatment,
        duration_min: Number(form.duration_min) || 30,
        scheduled_at,
        performer_id: form.performer_id || null,
        performers: performers.length ? performers : undefined,
        notes: form.notes || "",
        booking_type: isPackage ? "package" : "treatment",
        package_id: isPackage ? form.package_id : null,
      };
      appendBookingDurationMetadata(payload, form);
      const r = await putBookingWithConflict(api, booking.id, payload);
      toast.success("Appointment updated");
      onSaved?.(r.data);
      setEditing(false);
      setPendingConflict(null);
    } catch (e) {
      if (e.scheduleConflict) {
        setPendingConflict(e.scheduleConflict);
        setPendingEditPayload(payload);
        return;
      }
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "object" ? (detail.message || "Failed to update appointment") : (detail || "Failed to update appointment"));
    } finally {
      setBusy(false);
    }
  };

  const continueEditAfterConflict = async () => {
    if (!pendingEditPayload) return;
    setBusy(true);
    try {
      const payload = { ...pendingEditPayload, overlap_override: true };
      appendBookingDurationMetadata(payload, form);
      const r = await api.put(`/bookings/${booking.id}`, payload);
      toast.success("Appointment updated");
      onSaved?.(r.data);
      setEditing(false);
      setPendingConflict(null);
      setPendingEditPayload(null);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "object" ? (detail.message || "Failed to update appointment") : (detail || "Failed to update appointment"));
    } finally {
      setBusy(false);
    }
  };

  const performerList = editing && availablePerformers !== null
    ? eligibleStaff.filter(s => availablePerformers.some(p => p.id === s.id))
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="booking-detail-panel">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label-eyebrow">{block ? "Blocked time" : "Appointment"}</div>
            <h3 className="font-display text-xl text-[#2D3A33] mt-1 flex flex-wrap items-center gap-2">
              {editing && !block ? "Edit appointment" : (block ? blockLabel : booking.patient_name)}
              {!editing && !block && <PatientLabelsRow labels={booking.patient_labels} size="sm" />}
            </h3>
            {!editing && (
              <div className="text-sm text-[#5C6C62] mt-1">
                {block ? (
                  <span className="bl-chip text-xs">Blocked · {booking.duration_min}m</span>
                ) : (
                  <>
                    {booking.treatment}
                    {(booking.booking_type === "package" || booking.package_id) && <span className="bl-chip ml-2 text-xs">Package</span>}
                  </>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="booking-detail-close"><X className="w-5 h-5" /></button>
        </div>

        {editing ? (
          <div className="mt-5 space-y-3" data-testid="booking-edit-form">
            <div>
              <label className="label-eyebrow block mb-1.5">Patient name</label>
              <input className="bl-input" value={form.patient_name} onChange={e => setForm({ ...form, patient_name: e.target.value })} required data-testid="edit-booking-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Phone</label>
                <input className="bl-input" value={form.patient_phone} onChange={e => setForm({ ...form, patient_phone: e.target.value })} required data-testid="edit-booking-phone" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Email</label>
                <input className="bl-input" type="email" value={form.patient_email} onChange={e => setForm({ ...form, patient_email: e.target.value })} data-testid="edit-booking-email" />
              </div>
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Service type</label>
              <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1">
                <button type="button" onClick={() => switchBookingKind("treatment")} className="flex-1 px-3 py-1.5 rounded-lg text-sm" style={!isPackage ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="edit-kind-treatment">Treatment</button>
                <button type="button" onClick={() => switchBookingKind("package")} className="flex-1 px-3 py-1.5 rounded-lg text-sm" style={isPackage ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="edit-kind-package">Package</button>
              </div>
            </div>
            {!isPackage ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Category</label>
                  <select className="bl-input" value={form.treatment_category || ""} onChange={e => setForm({ ...form, treatment_category: e.target.value, treatment: "" })} data-testid="edit-booking-category">
                    <option value="">All</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Treatment</label>
                  <select className="bl-input" value={form.treatment} onChange={e => selectTreatment(e.target.value)} required data-testid="edit-booking-treatment">
                    <option value="">Pick treatment…</option>
                    {(form.treatment_category ? filteredTreatments : treatments).map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Package type</label>
                  <select className="bl-input" value={form.package_type || ""} onChange={e => setForm({ ...form, package_type: e.target.value, package_id: "", treatment: "" })} data-testid="edit-booking-package-type">
                    <option value="">All</option>
                    {packageTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Package</label>
                  <select className="bl-input" value={form.package_id} onChange={e => selectPackage(e.target.value)} required data-testid="edit-booking-package">
                    <option value="">Pick package…</option>
                    {(form.package_type ? filteredPackages : packages).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Date</label>
                <input type="date" className="bl-input" value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} required data-testid="edit-booking-date" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Time</label>
                <input type="time" className="bl-input" value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} required data-testid="edit-booking-time" />
              </div>
            </div>
            {form.scheduled_date && form.scheduled_time && (
              <AppointmentDurationFields
                scheduledDate={form.scheduled_date}
                startTime={form.scheduled_time}
                endTime={form.scheduled_end_time}
                durationMin={form.duration_min}
                treatmentDefaultMin={form.treatment_default_duration_minutes ?? selectedService?.duration_min}
                durationSource={form.duration_source}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                testIdPrefix="edit-dur"
              />
            )}
            <div>
              <label className="label-eyebrow block mb-1.5">Assigned staff</label>
              <select
                className="bl-input"
                value={form.performer_id}
                onChange={e => setForm({ ...form, performer_id: e.target.value })}
                disabled={!serviceSelected || !form.scheduled_date || !form.scheduled_time || loadingPerformers}
                data-testid="edit-booking-performer"
              >
                <option value="">Unassigned</option>
                {performerList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                ))}
              </select>
              {loadingPerformers && <div className="text-xs text-[#5C6C62] mt-1">Checking availability…</div>}
            </div>
            {allowMultiple && serviceSelected && (
              <AdditionalPerformersEditor
                rows={form.assistant_performers || []}
                onChange={(assistant_performers) => setForm((f) => ({ ...f, assistant_performers }))}
                onAvailabilityChange={setAdditionalAvailByRole}
                primaryPerformerId={form.performer_id}
                staff={staff}
                scheduledDate={form.scheduled_date}
                scheduledTime={form.scheduled_time}
                durationMin={form.duration_min}
                treatment={form.treatment}
                packageId={isPackage ? form.package_id : null}
                bookingType={isPackage ? "package" : "treatment"}
                excludeBookingId={booking.id}
                testIdPrefix="edit"
              />
            )}
            <div>
              <label className="label-eyebrow block mb-1.5">Notes</label>
              <textarea className="bl-input min-h-[60px]" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="edit-booking-notes" />
            </div>
            {serviceSelected && (
              <div className="bl-card p-4 space-y-3" data-testid="edit-booking-pricing">
                <div className="label-eyebrow text-[#5C6C62]">Estimated price</div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C6C62]">Subtotal</span>
                  <span className="text-[#2D3A33] font-medium" data-testid="edit-booking-total">{fmtIDR(subtotalIdr)}</span>
                </div>
                <p className="text-xs text-[#5C6C62]">Campaign discounts are applied when creating the invoice.</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={save} disabled={busy} className="bl-btn-primary flex-1 disabled:opacity-50" data-testid="edit-booking-save">{busy ? "Saving…" : "Save changes"}</button>
              <button type="button" onClick={() => {
                const next = bookingToForm(booking, treatments, packages);
                setForm(next);
                setEditing(false);
              }} className="bl-btn-ghost" data-testid="edit-booking-cancel">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {!block && booking.is_blacklisted && (
              <PatientBlacklistBanner patient={booking.patient || booking} className="mt-4" />
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className={`bl-chip ${sc.cls}`} data-testid="booking-status-chip">
                {booking.display_status_label || sc.label}
              </span>
              {booking.payment_status && (
                <span className="bl-chip text-xs" data-testid="booking-payment-status-chip">
                  Payment: {paymentStatusLabel(booking.payment_status)}
                </span>
              )}
              {booking.invoice?.payment_status && (
                <span className="bl-chip text-xs">
                  Invoice: {paymentStatusLabel(booking.invoice.payment_status)}
                </span>
              )}
              {booking.is_overtime && !block && <OvertimeBadge />}
              {!block && (consentForms.length > 0 || selectedTreatment?.consent_required) && (
                <ConsentStatusBadge status={consentSummary(consentForms).status} />
              )}
              {!block && selectedTreatment?.consent_required && consentForms.length === 0 && (
                <span className="text-xs text-[#B14A2C]">Consent required</span>
              )}
            </div>

            {!block && canEditStatus && (
              <div className="mt-3">
                <label className="label-eyebrow block mb-1.5">Appointment status</label>
                <select
                  className="bl-input text-sm"
                  value={displayStatus}
                  disabled={statusBusy}
                  onChange={(e) => changeStatus(e.target.value)}
                  data-testid="booking-status-select"
                >
                  {APPOINTMENT_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 space-y-2 text-sm text-[#2D3A33]">
              <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#5C6C62]" /> {dt.toLocaleDateString()}</div>
              <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#5C6C62]" /> {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {booking.duration_min} min</div>
              {!block && (
                <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#5C6C62]" /> {booking.patient_phone}</div>
              )}
              {booking.is_overtime && !block && (
                <div className="bl-card p-3 mt-1 space-y-1 text-sm bg-[#F5E6D3]/25" data-testid="booking-overtime-detail">
                  <div className="flex items-center gap-2">
                    <OvertimeBadge />
                    <span className="font-medium text-[#6B5344]">{booking.overtime_reason}</span>
                  </div>
                  {booking.overtime_note && (
                    <p className="text-[#5C6C62]">{booking.overtime_note}</p>
                  )}
                </div>
              )}
              {block && booking.notes && (
                <div className="text-[#5C6C62]">{booking.notes}</div>
              )}
              {booking.performer_id && (
                <div className="text-[#5C6C62]">Staff: {staff.find(s => s.id === booking.performer_id)?.name || booking.performer_name_snapshot || "—"}</div>
              )}
              {(booking.performers || []).filter(p => p.performer_type !== "primary").length > 0 && (
                <div className="text-[#5C6C62]">
                  Additional: {(booking.performers || [])
                    .filter(p => p.performer_type !== "primary")
                    .map(formatPerformerBadge)
                    .join(", ")}
                </div>
              )}
              {(viewSubtotal > 0 || viewTotal > 0) && (
                <div className="bl-card p-3 mt-2 space-y-1.5" data-testid="booking-detail-pricing">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#5C6C62]">Subtotal</span>
                    <span>{fmtIDR(viewSubtotal)}</span>
                  </div>
                  {viewDiscount > 0 && (
                    <div className="flex justify-between text-sm text-[#52796F]">
                      <span>Legacy booking discount{booking.coupon_code ? ` (${booking.coupon_code})` : ""}</span>
                      <span>− {fmtIDR(viewDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-medium pt-1 border-t border-[#EAE6D7]">
                    <span>Total</span>
                    <span data-testid="booking-detail-total">{fmtIDR(viewTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {!block && (
              <div className="mt-4 space-y-2" data-testid="booking-note-section">
                <label className="label-eyebrow block">Booking note</label>
                <textarea
                  ref={noteInputRef}
                  className="bl-input min-h-[72px] text-sm"
                  placeholder="Operational note for staff (visible in treatment session)"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  data-testid="booking-note-input"
                />
                <button
                  type="button"
                  className="bl-btn-ghost text-xs"
                  disabled={noteBusy || noteDraft === (booking.notes || "")}
                  onClick={saveNote}
                  data-testid="booking-note-save"
                >
                  {noteBusy ? "Saving…" : "Save note"}
                </button>
              </div>
            )}

            {!block && booking.patient_id && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="label-eyebrow">Patient labels</div>
                  <PatientLabelsRow labels={booking.patient_labels} className="mt-1" />
                </div>
                {canManageLabels && (
                  <button type="button" className="bl-btn-ghost text-xs" onClick={() => setLabelsOpen(true)} data-testid="manage-labels-from-booking">
                    Manage labels
                  </button>
                )}
              </div>
            )}

            {!block && (
              <div className="mt-4">
                <div className="label-eyebrow mb-2">Messages</div>
                <BookingMessagingMenu
                  booking={booking}
                  automationActive={automationActive}
                  canSendViaProvider={canSendViaProvider}
                  canWhatsgoSend={canWhatsgoSend}
                  onSent={refreshBooking}
                  compact
                />
              </div>
            )}

          </>
        )}

        {!editing && (
          <div className="mt-5 flex flex-wrap gap-2" data-testid="booking-detail-actions">
            {actions.showShowInvoice && (
              <button type="button" onClick={() => navigate(`/invoices/${booking.invoice.id}`)} className="bl-btn-primary text-sm inline-flex items-center gap-2" data-testid="show-invoice-button">
                <Receipt className="w-4 h-4" /> Show invoice
              </button>
            )}
            {actions.showStartVisit && (
              <button type="button" onClick={() => onStartVisit(booking)} disabled={startVisitBusy} className="bl-btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50" data-testid="start-visit-button">
                <Stethoscope className="w-4 h-4" />
                {startVisitBusy ? "Starting…" : "Start treatment session"}
              </button>
            )}
            {actions.showOpenVisit && (
              <Link to={`/visits/${booking.visit_id}`} className={actions.showShowInvoice ? "bl-btn-secondary text-sm inline-flex items-center gap-2" : "bl-btn-primary text-sm inline-flex items-center gap-2"} data-testid="open-visit-link">
                <Stethoscope className="w-4 h-4" /> Open treatment session
              </Link>
            )}
            {actions.showCreateInvoice && (
              <button
                type="button"
                className="bl-btn-secondary text-sm inline-flex items-center gap-2"
                data-testid="create-invoice-button"
                onClick={async () => {
                  try {
                    const r = await api.post(`/invoices/visit/${booking.visit_id}`);
                    navigate(`/invoices/${r.data.id}`);
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Could not create invoice");
                  }
                }}
              >
                <Receipt className="w-4 h-4" /> Create invoice
              </button>
            )}
            {actions.showConfirm && (
              <button type="button" onClick={() => onAdvance(booking)} className="bl-btn-secondary text-sm inline-flex items-center gap-2" data-testid="advance-booking-button">
                Confirm <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {actions.showCheckIn && (
              <button type="button" onClick={() => onAdvance(booking)} className="bl-btn-secondary text-sm inline-flex items-center gap-2" data-testid="check-in-booking-button">
                Check in <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {editable && block && (
              <button type="button" onClick={() => onEditBlock?.(booking)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="edit-block-button">
                <Edit2 className="w-4 h-4" /> Edit block
              </button>
            )}
            {actions.showEdit && !block && (
              <button type="button" onClick={() => setEditing(true)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="edit-booking-button">
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            )}
            {!block && isHighlightableBooking(booking) && onHighlightPatient && (
              <button type="button" onClick={() => onHighlightPatient(booking)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="highlight-patient-button">
                <Highlighter className="w-4 h-4" /> Highlight Patient
              </button>
            )}
            {actions.showAddNote && (
              <button
                type="button"
                className="bl-btn-ghost text-sm"
                onClick={() => {
                  noteInputRef.current?.focus();
                  noteInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                data-testid="add-note-button"
              >
                Add note
              </button>
            )}
            {actions.showRebook && onRebook && (
              <button type="button" onClick={() => onRebook(booking)} className="bl-btn-secondary text-sm inline-flex items-center gap-2" data-testid="rebook-button">
                <CalendarClock className="w-4 h-4" /> Rebook
              </button>
            )}
            {booking.visit_id && (
              <Link to={`/visits/${booking.visit_id}?tab=consent`} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="booking-consent-link">
                Consent
              </Link>
            )}
            {actions.showNoShow && (
              <button type="button" onClick={() => changeStatus("no_show")} className="text-sm text-[#B14A2C] hover:underline" data-testid="no-show-button">
                Mark no show
              </button>
            )}
            {actions.showCancel && (
              <button type="button" onClick={() => onCancel(booking)} className="text-sm text-[#B14A2C] hover:underline">
                {block ? "Remove block" : "Cancel booking"}
              </button>
            )}
          </div>
        )}

        {booking.patient_id && (
          <ManagePatientLabelsModal
            patientId={booking.patient_id}
            patientName={booking.patient_name}
            open={labelsOpen}
            onClose={() => setLabelsOpen(false)}
            onUpdated={refreshBooking}
          />
        )}
        {pendingConflict && (
          <ConflictOverrideModal
            conflict={pendingConflict}
            busy={busy}
            onCancel={() => { setPendingConflict(null); setPendingEditPayload(null); }}
            onContinue={continueEditAfterConflict}
          />
        )}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const { branding } = useSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState("schedule");
  const [scheduleDate, setScheduleDate] = useState(() => scheduleDateStr(new Date()));
  const [scope, setScopeKey] = useState("today");
  const [statusFilter, setStatusFilter] = useState("");
  const [bookings, setBookings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [waBooking, setWaBooking] = useState(null);
  const [detailBooking, setDetailBooking] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newInitial, setNewInitial] = useState(null);
  const [slotAction, setSlotAction] = useState(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockInitial, setBlockInitial] = useState(null);
  const [blockEdit, setBlockEdit] = useState(null);
  const [scheduleStaff, setScheduleStaff] = useState([]);
  const [reloadAt, setReloadAt] = useState(0);
  const [startVisitBusy, setStartVisitBusy] = useState(false);
  const [detailStartEdit, setDetailStartEdit] = useState(false);
  const [overtimeSlot, setOvertimeSlot] = useState(null);
  const [overtimeMeta, setOvertimeMeta] = useState(null);
  const [automationActive, setAutomationActive] = useState(false);
  const scheduleModalPortalRef = useRef(null);
  const scheduleHighlightApiRef = useRef(null);
  const [scheduleFullscreen, setScheduleFullscreen] = useState(false);
  const onScheduleFullscreenChange = useCallback((fs) => setScheduleFullscreen(Boolean(fs)), []);
  const useScheduleModalPortal = viewMode === "schedule" && scheduleFullscreen;
  const clinicName = branding?.clinic_name || clinic?.name || "our clinic";
  const canCreateOvertime =
    ["super_admin", "manager"].includes(user?.role) ||
    hasPermission(user, "bookings.create_overtime");
  const canSendViaProvider = hasPermission(user, "messaging.send") || hasPermission(user, "messaging.manage");
  const canWhatsgoSend = canSendViaProvider;

  useEffect(() => {
    if (viewMode !== "schedule") {
      scheduleHighlightApiRef.current?.clearHighlight?.();
    }
  }, [viewMode]);

  const handleHighlightPatient = useCallback((booking) => {
    if (!isHighlightableBooking(booking)) return;
    scheduleHighlightApiRef.current?.highlightFromBooking?.(booking);
    setDetailBooking(null);
    setDetailStartEdit(false);
  }, []);

  const openBookingId = searchParams.get("open");
  useEffect(() => {
    if (!openBookingId) return;
    api.get(`/bookings/${openBookingId}`)
      .then(r => setDetailBooking(r.data))
      .catch(() => toast.error("Could not load appointment"))
      .finally(() => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("open");
          return next;
        }, { replace: true });
      });
  }, [openBookingId, setSearchParams]);

  const refreshList = useCallback(() => {
    const params = { scope };
    const apiStatus = resolveApiStatusFilter(statusFilter);
    if (apiStatus) params.status = apiStatus;
    return api.get("/bookings", { params }).then((r) => {
      let items = r.data || [];
      items = filterBookingsByScheduleStatus(items, statusFilter);
      setBookings(items);
    });
  }, [scope, statusFilter]);

  const bumpScheduleReload = useCallback(() => {
    setReloadAt(Date.now());
  }, []);

  const debouncedScheduleReload = useMemo(
    () => debounce(bumpScheduleReload, 750),
    [bumpScheduleReload],
  );

  const invalidateBookings = useCallback(() => {
    if (viewMode === "list") {
      refreshList();
    } else {
      debouncedScheduleReload();
    }
  }, [viewMode, refreshList, debouncedScheduleReload]);

  const invalidateBookingsNow = useCallback(() => {
    if (viewMode === "list") {
      refreshList();
    } else {
      bumpScheduleReload();
    }
  }, [viewMode, refreshList, bumpScheduleReload]);

  useEffect(() => {
    if (viewMode === "list") refreshList();
  }, [viewMode, refreshList]);

  useRealtimeInvalidation(REALTIME_TOPICS.BOOKINGS, invalidateBookings);
  useVisibilityPolling(invalidateBookings, 30000);
  useEffect(() => { api.get("/wa-templates").then(r => setTemplates(r.data || [])); }, []);
  useEffect(() => {
    api.get("/settings/messaging").then(r => setAutomationActive(!!r.data?.automation_active)).catch(() => {});
  }, []);
  useEffect(() => {
    if (viewMode !== "schedule") return;
    api.get("/users").then(r => {
      setScheduleStaff((r.data || []).filter(u => CLINICAL_PERFORMER_ROLES.includes(u.role) && u.active !== false));
    });
  }, [viewMode]);

  const advance = async (b) => {
    const next = NEXT_STATUS[b.status]?.next;
    if (!next) return;
    await api.put(`/bookings/${b.id}/status`, { status: next });
    toast.success(`Moved to ${next.replace("_", " ")}`);
    invalidateBookingsNow();
  };
  const cancel = async (b) => {
    const msg = isTimeBlock(b) ? "Remove this time block?" : "Cancel this booking?";
    if (!window.confirm(msg)) return;
    await api.delete(`/bookings/${b.id}`);
    toast.success(isTimeBlock(b) ? "Blocked time removed" : "Cancelled");
    invalidateBookingsNow();
  };

  const startVisit = async (b) => {
    setStartVisitBusy(true);
    try {
      const r = await api.post(`/bookings/${b.id}/start-visit`);
      const visit = r.data?.visit;
      toast.success("Treatment session started — patient chart is open");
      setDetailBooking(r.data?.booking || b);
      invalidateBookingsNow();
      if (visit?.id) navigate(`/visits/${visit.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start treatment session");
    } finally {
      setStartVisitBusy(false);
    }
  };

  const publicLink = clinic ? `${window.location.origin}/book/${clinic.slug}` : "";
  const copyLink = () => { navigator.clipboard.writeText(publicLink); toast.success("Public appointment link copied"); };

  const canManage = ["super_admin", "fo", "manager"].includes(user?.role);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="bookings-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Front desk</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Appointments</h1>
          <p className="mt-2 text-[#5C6C62] max-w-xl">Schedule patients, assign staff, and start a treatment session when they arrive.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <button onClick={() => { setNewInitial(null); setNewOpen(true); }} className="bl-btn-primary inline-flex items-center gap-2 text-sm" data-testid="new-booking-button">
                <Plus className="w-4 h-4" /> New appointment
              </button>
              <button
                onClick={() => { setBlockInitial({ scheduled_date: scheduleDate }); setBlockEdit(null); setBlockOpen(true); }}
                className="bl-btn-secondary inline-flex items-center gap-2 text-sm"
                data-testid="block-time-button"
              >
                <Ban className="w-4 h-4" /> Block time
              </button>
            </>
          )}
          {clinic?.slug && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="bl-btn-secondary text-sm inline-flex items-center gap-1.5" data-testid="bookings-more-menu">
                  More
                  <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem] bg-[var(--bl-surface)] border-[var(--bl-border)] text-[var(--bl-text)] shadow-lg">
                <DropdownMenuItem onClick={copyLink} className="cursor-pointer focus:bg-[var(--clinic-action-secondary-hover-bg)]" data-testid="copy-public-link">
                  <Copy className="w-4 h-4 mr-2 text-[var(--bl-muted-text)]" />
                  Copy appointment link
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer focus:bg-[var(--clinic-action-secondary-hover-bg)]">
                  <a href={`/book/${clinic.slug}`} target="_blank" rel="noreferrer" className="flex items-center w-full" data-testid="open-public-link">
                    <ExternalLink className="w-4 h-4 mr-2 text-[var(--bl-muted-text)]" />
                    View public booking page
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between flex-wrap gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--bl-border)", background: "color-mix(in srgb, var(--bl-background) 60%, var(--bl-surface))" }}>
        <div className="bl-segmented" data-testid="view-mode-tabs">
          {VIEW_MODES.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setViewMode(t.key)}
                className={`bl-segmented-item inline-flex items-center gap-1.5 ${viewMode === t.key ? "active" : ""}`}
                data-testid={`view-${t.key}`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--bl-muted-text)] hidden sm:inline">Status</span>
          <select
            className="bl-input w-auto min-w-[11.5rem] sm:min-w-[13.5rem] max-w-full py-2.5 pr-9 text-sm leading-normal h-auto align-middle"
            style={{ lineHeight: "1.35" }}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            data-testid="status-filter"
          >
            <option value="">All statuses</option>
            {SCHEDULE_STATUS_FILTER_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {viewMode === "list" && (
        <div className="mt-4 flex gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit" data-testid="scope-tabs">
          {SCOPE_TABS.map(t => (
            <button key={t.key} onClick={() => setScopeKey(t.key)} className="px-4 py-1.5 rounded-lg text-sm font-medium" style={scope === t.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }} data-testid={`scope-${t.key}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {viewMode === "schedule" ? (
        <div className="mt-5">
          <BookingsScheduleView
            clinic={clinic}
            user={user}
            date={scheduleDate}
            onDateChange={setScheduleDate}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            reloadAt={reloadAt}
            canManage={canManage}
            canCreateOvertime={canCreateOvertime}
            modalPortalRef={scheduleModalPortalRef}
            onFullscreenChange={onScheduleFullscreenChange}
            highlightApiRef={scheduleHighlightApiRef}
            onHighlightActivated={() => {
              setDetailBooking(null);
              setDetailStartEdit(false);
            }}
            onSelectBooking={setDetailBooking}
            onEmptySlot={(initial) => setSlotAction(initial)}
            onOvertimeSlot={(payload) => setOvertimeSlot(payload)}
            onRangeSelect={(payload) => setSlotAction(payload)}
          />
        </div>
      ) : (
      <>
      <div className="mt-5 space-y-3 lg:hidden" data-testid="bookings-cards">
        {bookings.length === 0 && (
          <div className="bl-card p-8 text-center text-[#5C6C62]" data-testid="bookings-empty">No appointments in this view.</div>
        )}
        {bookings.map((b) => (
          <BookingListCard
            key={b.id}
            booking={b}
            onOpen={(bk) => { setDetailStartEdit(false); setDetailBooking(bk); }}
            onWa={setWaBooking}
          />
        ))}
      </div>

      <div className="mt-5 bl-card table-card overflow-hidden hidden lg:block" data-testid="bookings-table">
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full min-w-[720px]">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Patient</th>
                <th className="px-5 py-3">Treatment</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-[#5C6C62]" data-testid="bookings-empty">No appointments in this view.</td></tr>
              )}
              {bookings.map(b => {
                const dt = new Date(b.scheduled_at);
                const sc = STATUS_COLORS[b.status] || { label: b.status, cls: "" };
                const next = NEXT_STATUS[b.status];
                return (
                  <tr key={b.id} className="cursor-pointer" data-testid={`booking-row-${b.id}`} onClick={() => setDetailBooking(b)}>
                    <td className="px-5 py-4 text-sm text-[#2D3A33] whitespace-nowrap">
                      <div className="font-medium">{formatBookingListDate(dt)}</div>
                      <div className="text-[#5C6C62] mt-0.5">{formatBookingListTime(dt, b.duration_min || 30)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-[#2D3A33]">{isTimeBlock(b) ? (b.block_reason || b.patient_name) : b.patient_name}</div>
                      {!isTimeBlock(b) && (
                        <div className="text-xs text-[#5C6C62] flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" /> {b.patient_phone}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-[#2D3A33]">{isTimeBlock(b) ? "Blocked time" : b.treatment}</td>
                    <td className="px-5 py-4 text-sm text-[#2D3A33] whitespace-nowrap">
                      {isTimeBlock(b) ? "—" : (b.total_idr != null ? fmtIDR(b.total_idr) : "—")}
                      {b.discount_idr > 0 && <div className="text-xs text-[#52796F] mt-0.5">−{fmtIDR(b.discount_idr)}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`bl-chip ${sc.cls}`} data-testid={`status-chip-${b.id}`}>{sc.label}</span>
                        {b.is_overtime && !isTimeBlock(b) && <OvertimeBadge />}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs uppercase tracking-wider text-[#5C6C62]">{b.source}</td>
                    <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => { setDetailStartEdit(false); setDetailBooking(b); }}
                          className="text-xs font-medium inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] text-[#2D3A33]"
                          data-testid={`open-booking-${b.id}`}
                        >
                          Open
                        </button>
                        {!isTimeBlock(b) && (
                          <button onClick={() => setWaBooking(b)} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB]" data-testid={`wa-button-${b.id}`}>
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </button>
                        )}
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="p-1.5 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB]" aria-label="More actions" data-testid={`booking-row-menu-${b.id}`}>
                                <MoreHorizontal className="w-4 h-4 text-[#5C6C62]" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[11rem] bg-white border-[#EAE6D7] shadow-lg">
                              <DropdownMenuItem onClick={() => setDetailBooking(b)} className="cursor-pointer focus:bg-[#F8F5EC]">
                                Open
                              </DropdownMenuItem>
                              {!isTimeBlock(b) && b.status !== "cancelled" && b.status !== "completed" && (
                                <DropdownMenuItem
                                  onClick={() => { setDetailStartEdit(true); setDetailBooking(b); }}
                                  className="cursor-pointer focus:bg-[#F8F5EC]"
                                >
                                  <CalendarClock className="w-4 h-4 mr-2 text-[#5C6C62]" />
                                  Reschedule
                                </DropdownMenuItem>
                              )}
                              {canManage && next && !isTimeBlock(b) && (
                                <DropdownMenuItem onClick={() => advance(b)} className="cursor-pointer focus:bg-[#F8F5EC]">
                                  {next.label}
                                </DropdownMenuItem>
                              )}
                              {!isTimeBlock(b) && b.visit_id && (
                                <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                                  <Link to={`/invoices/visit/${b.visit_id}`} className="flex items-center w-full" data-testid={`invoice-from-booking-${b.id}`}>
                                    <Receipt className="w-4 h-4 mr-2 text-[#5C6C62]" />
                                    Create invoice
                                  </Link>
                                </DropdownMenuItem>
                              )}
                              {!isTimeBlock(b) && !b.visit_id && ["booked", "confirmed", "checked_in"].includes(b.status) && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    toast.info("Start a treatment session from this appointment to create an invoice.");
                                    setDetailBooking(b);
                                  }}
                                  className="cursor-pointer focus:bg-[#F8F5EC]"
                                >
                                  <Receipt className="w-4 h-4 mr-2 text-[#5C6C62]" />
                                  Create invoice
                                </DropdownMenuItem>
                              )}
                              {b.status !== "cancelled" && b.status !== "completed" && (
                                <DropdownMenuItem onClick={() => cancel(b)} className="cursor-pointer text-[#B14A2C] focus:bg-[#FAE5DC]/30">
                                  {isTimeBlock(b) ? "Remove block" : "Cancel"}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      <BookingModalPortal active={!!detailBooking} fullscreen={useScheduleModalPortal} portalRef={scheduleModalPortalRef}>
        {detailBooking && (
        <BookingDetailPanel
          booking={detailBooking}
          user={user}
          startInEditMode={detailStartEdit}
          onClose={() => { setDetailBooking(null); setDetailStartEdit(false); }}
          canManage={canManage}
          onAdvance={async (b) => { await advance(b); setDetailBooking(null); }}
          onCancel={async (b) => {
            const msg = isTimeBlock(b) ? "Remove this time block?" : "Cancel this booking?";
            if (!window.confirm(msg)) return;
            await cancel(b);
            setDetailBooking(null);
          }}
          onSaved={(updated) => { setDetailBooking(updated); invalidateBookingsNow(); }}
          onStartVisit={startVisit}
          startVisitBusy={startVisitBusy}
          onEditBlock={(b) => { setDetailBooking(null); setBlockEdit(b); setBlockInitial(null); setBlockOpen(true); }}
          onHighlightPatient={viewMode === "schedule" ? handleHighlightPatient : undefined}
          onRebook={(b) => {
            setDetailBooking(null);
            setNewInitial({
              patient_name: b.patient_name,
              patient_phone: b.patient_phone,
              patient_email: b.patient_email,
              treatment: b.treatment,
              package_id: b.package_id,
              booking_kind: b.booking_type === "package" ? "package" : "treatment",
              performer_id: b.performer_id,
            });
            setNewOpen(true);
          }}
          automationActive={automationActive}
          canSendViaProvider={canSendViaProvider}
          canWhatsgoSend={canWhatsgoSend}
        />
        )}
      </BookingModalPortal>
      <BookingModalPortal active={!!slotAction} fullscreen={useScheduleModalPortal} portalRef={scheduleModalPortalRef}>
        {slotAction && (
        <SlotActionModal
          initial={slotAction}
          staff={scheduleStaff}
          onClose={() => setSlotAction(null)}
          onBook={() => {
            setNewInitial({
              ...slotAction,
            });
            setSlotAction(null);
            setNewOpen(true);
          }}
          onBlock={() => {
            setBlockInitial(slotAction);
            setBlockEdit(null);
            setSlotAction(null);
            setBlockOpen(true);
          }}
        />
        )}
      </BookingModalPortal>
      <BookingModalPortal active={blockOpen} fullscreen={useScheduleModalPortal} portalRef={scheduleModalPortalRef}>
        {blockOpen && (
        <BlockTimeModal
          initial={blockInitial}
          booking={blockEdit}
          onClose={() => { setBlockOpen(false); setBlockInitial(null); setBlockEdit(null); }}
          onBookTreatment={(payload) => {
            setBlockOpen(false);
            setBlockInitial(null);
            setBlockEdit(null);
            setNewInitial(payload);
            setNewOpen(true);
          }}
          onSaved={(updated) => {
            if (updated) setDetailBooking(updated);
            invalidateBookingsNow();
          }}
        />
        )}
      </BookingModalPortal>
      {waBooking && <WaPanel booking={waBooking} templates={templates} clinicName={clinicName} automationActive={automationActive} canSendViaProvider={canSendViaProvider} canWhatsgoSend={canSendViaProvider} onClose={() => setWaBooking(null)} onSent={() => { setWaBooking(null); invalidateBookingsNow(); }} />}
      <BookingModalPortal active={!!overtimeSlot} fullscreen={useScheduleModalPortal} portalRef={scheduleModalPortalRef}>
        {overtimeSlot && (
        <OutsideWorkingHoursModal
          slot={overtimeSlot}
          staffMember={overtimeSlot.staff}
          effective={overtimeSlot.effective}
          dateLabel={new Date(`${scheduleDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          estimatedDurationMin={overtimeSlot.estimatedDurationMin ?? null}
          serviceLabel={overtimeSlot.serviceLabel ?? null}
          onClose={() => setOvertimeSlot(null)}
          onContinue={({ reason, note }) => {
            setOvertimeMeta({ reason, note });
            setNewInitial({
              scheduled_date: scheduleDate,
              scheduled_time: overtimeSlot.scheduled_time,
              performer_id: overtimeSlot.performer_id,
            });
            setOvertimeSlot(null);
            setNewOpen(true);
          }}
        />
        )}
      </BookingModalPortal>
      <BookingModalPortal active={newOpen} fullscreen={useScheduleModalPortal} portalRef={scheduleModalPortalRef}>
        {newOpen && (
        <NewBookingModal
          initial={newInitial}
          overtimeMeta={overtimeMeta}
          onClose={() => { setNewOpen(false); setNewInitial(null); setOvertimeMeta(null); }}
          onCreated={() => { setNewOpen(false); setNewInitial(null); setOvertimeMeta(null); invalidateBookingsNow(); }}
        />
        )}
      </BookingModalPortal>
    </div>
  );
}
