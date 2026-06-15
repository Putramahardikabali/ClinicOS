import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ConsentStatusBadge, { consentSummary } from "@/components/consent/ConsentStatusBadge";
import api from "@/lib/api";
import { REALTIME_TOPICS } from "@/lib/realtimeEvents";
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
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarDays, Clock, Phone, MessageCircle, Copy, CheckCircle2, X, Plus,
  ArrowRight, ExternalLink, LayoutList, CalendarRange, Edit2, Ban,
  ChevronDown, MoreHorizontal, Receipt, CalendarClock, Stethoscope,
} from "lucide-react";
import BookingsScheduleView, { scheduleDateStr } from "@/components/bookings/BookingsScheduleView";
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

function isTimeBlock(b) {
  return b?.status === "blocked" || b?.booking_type === "block";
}

function SlotActionModal({ initial, staff, onBook, onBlock, onClose }) {
  const performer = staff?.find(s => s.id === initial?.performer_id);
  const timeLabel = initial?.scheduled_time || "";
  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} data-testid="slot-action-modal">
      <div className="bl-card max-w-sm w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-xl text-[#2D3A33]">This time slot</h3>
        <p className="text-sm text-[#5C6C62]">
          {performer?.name || "Staff"}
          {timeLabel ? ` · ${timeLabel}` : ""}
        </p>
        <div className="grid grid-cols-1 gap-2">
          <button type="button" onClick={onBook} className="bl-btn-primary w-full inline-flex items-center justify-center gap-2" data-testid="slot-action-book">
            <Plus className="w-4 h-4" /> New appointment
          </button>
          <button type="button" onClick={onBlock} className="bl-btn-ghost w-full inline-flex items-center justify-center gap-2 border border-[#EAE6D7]" data-testid="slot-action-block">
            <Ban className="w-4 h-4" /> Block time
          </button>
        </div>
        <button type="button" onClick={onClose} className="w-full text-sm text-[#5C6C62] hover:underline">Cancel</button>
      </div>
    </div>
  );
}

function BlockTimeModal({ onClose, onSaved, initial = null, booking = null }) {
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
  const [form, setForm] = useState({
    scheduled_date: initial?.scheduled_date || booking?.scheduled_at?.slice(0, 10) || "",
    scheduled_time: initial?.scheduled_time || (dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : ""),
    performer_id: initial?.performer_id || booking?.performer_id || "",
    duration_min: booking?.duration_min || 30,
    notes: booking?.notes || "",
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
              <input type="time" className="bl-input" required value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} data-testid="block-time" />
            </div>
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
                  style={form.duration_min === d ? { borderColor: "var(--bl-primary)", background: "#EDF3EF" } : { borderColor: "#EAE6D7" }}
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

function WaPanel({ booking, templates, clinicName, onSent, onClose, automationActive = false, canSendViaProvider = false }) {
  const [tplKey, setTplKey] = useState(templates[0]?.key || "");
  const [sending, setSending] = useState(false);
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
              style={t.key === tplKey ? { borderColor: "var(--bl-primary)", background: "#EDF3EF", color: "#2D3A33" } : { borderColor: "#EAE6D7", color: "#5C6C62", background: "white" }}
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
  const [form, setForm] = useState({
    patient_id: "", patient_name: "", patient_phone: "", patient_email: "",
    booking_kind: "treatment",
    treatment_category: "",
    package_type: "",
    treatment: "", package_id: "", duration_min: 30, performer_type: "therapist",
    scheduled_date: "", scheduled_time: "",
    performer_id: "",
    assistant_performers: [],
    notes: "",
  });
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [customTime, setCustomTime] = useState(false);
  const [availablePerformers, setAvailablePerformers] = useState(null);
  const [loadingPerformers, setLoadingPerformers] = useState(false);
  const [suggestedPerformerId, setSuggestedPerformerId] = useState(null);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [additionalAvailByRole, setAdditionalAvailByRole] = useState({});
  const [appliedGiftCard, setAppliedGiftCard] = useState(null);

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
  const displayTotal = appliedCoupon ? appliedCoupon.total_idr : subtotalIdr;

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
    setAppliedCoupon(null);
    setCouponInput("");
    setForm(f => ({
      ...f,
      treatment: name,
      package_id: "",
      duration_min: t?.duration_min || 30,
      performer_type: t?.performer_type || "therapist",
      performer_id: keepSchedulePerformer() || (performerManuallyChanged ? f.performer_id : ""),
      assistant_performers: [],
    }));
  };

  const selectPackage = (id) => {
    const p = packages.find(x => x.id === id);
    setAppliedCoupon(null);
    setCouponInput("");
    setForm(f => ({
      ...f,
      package_id: id,
      treatment: p?.name || "",
      duration_min: p?.duration_min || 60,
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
    setAppliedCoupon(null);
    setCouponInput("");
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
    setForm(f => ({ ...f, patient_id: p.id, patient_name: patientDisplayName(p), patient_phone: p.phone || "", patient_email: p.email || "" }));
    setNewPatient(false);
    setStep("details");
  };

  const startNewPatient = () => {
    setForm(f => ({ ...f, patient_id: "", patient_name: "", patient_phone: "", patient_email: "" }));
    setNewPatient(true);
    setStep("details");
  };

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) {
      setAppliedCoupon(null);
      return;
    }
    if (!serviceSelected) {
      toast.error("Select a treatment or package first");
      return;
    }
    setCouponBusy(true);
    try {
      const r = await api.post("/bookings/validate-coupon", {
        code,
        subtotal_idr: subtotalIdr,
        booking_type: isPackage ? "package" : "treatment",
        treatment: form.treatment,
        package_id: isPackage ? form.package_id : null,
      });
      setAppliedCoupon(r.data);
      toast.success("Coupon applied");
    } catch (e) {
      setAppliedCoupon(null);
      toast.error(e?.response?.data?.detail || "Invalid coupon");
    } finally {
      setCouponBusy(false);
    }
  };

  const clearCoupon = () => {
    setCouponInput("");
    setAppliedCoupon(null);
  };

  const submit = async () => {
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
      // Combine date + time into ISO with seconds
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
        coupon_code: appliedCoupon?.coupon_code || null,
      };
      if (overtimeMeta) {
        body.is_overtime = true;
        body.overtime_reason = overtimeMeta.reason;
        body.overtime_note = overtimeMeta.note;
      }
      if (giftCardLocksService && appliedGiftCard?.gift_card_id) {
        body.gift_card_id = appliedGiftCard.gift_card_id;
      }
      await api.post("/bookings", body);
      toast.success(overtimeMeta ? "Overtime appointment created" : "Appointment created");
      onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create");
    } finally { setBusy(false); }
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
                  <div className="font-medium text-[#2D3A33]">{patientDisplayName(p)}</div>
                  <div className="text-xs text-[#5C6C62]">{p.phone || "—"} {p.email && `· ${p.email}`}{p.user_code && ` · ${p.user_code}`}</div>
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
            <button onClick={() => setStep("patient")} className="text-xs text-[#5C6C62] hover:text-[#2D3A33]">← Change patient</button>
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
                {customTime && (
                  <p className="text-xs text-[#A89F8B] mt-1">
                    {overtimeMeta
                      ? "Overtime appointment — availability rechecks when you change time or assigned staff."
                      : "Staff availability is still enforced on save."}
                  </p>
                )}
              </div>
            </div>

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
                <div className="label-eyebrow text-[#5C6C62]">Pricing</div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C6C62]">Subtotal</span>
                  <span className="text-[#2D3A33] font-medium">{fmtIDR(subtotalIdr)}</span>
                </div>
                {appliedCoupon && appliedCoupon.discount_idr > 0 && (
                  <div className="flex justify-between text-sm text-[#52796F]">
                    <span>Discount ({appliedCoupon.coupon_code})</span>
                    <span>− {fmtIDR(appliedCoupon.discount_idr)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-medium pt-2 border-t border-[#EAE6D7]">
                  <span className="text-[#2D3A33]">Total</span>
                  <span className="text-[#2D3A33]" data-testid="nb-total-price">{fmtIDR(displayTotal)}</span>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Coupon code</label>
                  <div className="flex gap-2">
                    <input
                      className="bl-input flex-1 font-mono uppercase"
                      placeholder="e.g. SUMMER20"
                      value={couponInput}
                      onChange={e => setCouponInput(e.target.value.toUpperCase())}
                      disabled={!serviceSelected}
                      data-testid="nb-coupon-input"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponBusy || !couponInput.trim() || !serviceSelected}
                      className="bl-btn-ghost whitespace-nowrap disabled:opacity-50"
                      data-testid="nb-coupon-apply"
                    >
                      {couponBusy ? "…" : "Apply"}
                    </button>
                    {appliedCoupon && (
                      <button type="button" onClick={clearCoupon} className="bl-btn-ghost text-sm" data-testid="nb-coupon-clear">
                        Clear
                      </button>
                    )}
                  </div>
                </div>
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
    performer_id: booking.performer_id || "",
    assistant_performers: additionalRowsFromBooking(booking),
    notes: booking.notes || "",
    coupon_code: booking.coupon_code || "",
  };
}

function BookingDetailPanel({ booking, onClose, canManage, onAdvance, onCancel, onWa, onSaved, onStartVisit, startVisitBusy, onEditBlock, startInEditMode = false }) {
  const block = isTimeBlock(booking);
  const editable = canManage && !["cancelled", "completed", "no_show"].includes(booking?.status);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => bookingToForm(booking));
  const [treatments, setTreatments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [staff, setStaff] = useState([]);
  const [availablePerformers, setAvailablePerformers] = useState(null);
  const [loadingPerformers, setLoadingPerformers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [additionalAvailByRole, setAdditionalAvailByRole] = useState({});
  const [consentForms, setConsentForms] = useState([]);

  useEffect(() => {
    const next = bookingToForm(booking, treatments, packages);
    setForm(next);
    setEditing(startInEditMode && canManage && !isTimeBlock(booking) && !["cancelled", "completed", "no_show"].includes(booking?.status));
    const code = booking?.coupon_code || "";
    setCouponInput(code);
    if (code && booking?.subtotal_idr != null) {
      setAppliedCoupon({
        coupon_code: code,
        subtotal_idr: booking.subtotal_idr,
        discount_idr: booking.discount_idr || 0,
        total_idr: booking.total_idr ?? booking.subtotal_idr,
      });
    } else {
      setAppliedCoupon(null);
    }
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
  const editTotal = appliedCoupon ? appliedCoupon.total_idr : subtotalIdr;

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
  const sc = STATUS_COLORS[booking.status] || { label: booking.status, cls: "" };
  const next = block ? null : NEXT_STATUS[booking.status];
  const blockLabel = booking.block_reason || booking.patient_name;
  const showStartVisitHint =
    canManage
    && !block
    && !booking.visit_id
    && ["booked", "confirmed", "checked_in"].includes(booking.status)
    && !editing;

  const clearCouponState = () => {
    setAppliedCoupon(null);
    setCouponInput("");
    setForm(f => ({ ...f, coupon_code: "" }));
  };

  const selectTreatment = (name) => {
    const t = treatments.find(x => x.name === name);
    clearCouponState();
    setForm(f => ({
      ...f,
      treatment: name,
      package_id: "",
      duration_min: t?.duration_min || f.duration_min,
      treatment_category: t?.category || f.treatment_category,
    }));
  };

  const selectPackage = (id) => {
    const p = packages.find(x => x.id === id);
    clearCouponState();
    setForm(f => ({
      ...f,
      package_id: id,
      treatment: p?.name || "",
      duration_min: p?.duration_min || f.duration_min,
      package_type: p?.package_type || f.package_type,
    }));
  };

  const switchBookingKind = (kind) => {
    clearCouponState();
    setForm(f => ({
      ...f,
      booking_kind: kind,
      treatment: "",
      package_id: "",
      treatment_category: "",
      package_type: "",
    }));
  };

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) {
      setAppliedCoupon(null);
      return;
    }
    if (!serviceSelected) {
      toast.error("Select a treatment or package first");
      return;
    }
    setCouponBusy(true);
    try {
      const r = await api.post("/bookings/validate-coupon", {
        code,
        subtotal_idr: subtotalIdr,
        booking_type: isPackage ? "package" : "treatment",
        treatment: form.treatment,
        package_id: isPackage ? form.package_id : null,
      });
      setAppliedCoupon(r.data);
      setForm(f => ({ ...f, coupon_code: r.data.coupon_code }));
      toast.success("Coupon applied");
    } catch (e) {
      setAppliedCoupon(null);
      toast.error(e?.response?.data?.detail || "Invalid coupon");
    } finally {
      setCouponBusy(false);
    }
  };

  const clearCoupon = () => clearCouponState();

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
        coupon_code: appliedCoupon?.coupon_code || null,
      };
      const r = await api.put(`/bookings/${booking.id}`, payload);
      toast.success("Appointment updated");
      onSaved?.(r.data);
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update appointment");
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
            <h3 className="font-display text-xl text-[#2D3A33] mt-1">{editing && !block ? "Edit appointment" : (block ? blockLabel : booking.patient_name)}</h3>
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
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Date</label>
                <input type="date" className="bl-input" value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} required data-testid="edit-booking-date" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Time</label>
                <input type="time" className="bl-input" value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} required data-testid="edit-booking-time" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Duration</label>
                <input type="number" min="5" step="5" className="bl-input" value={form.duration_min} onChange={e => setForm({ ...form, duration_min: Number(e.target.value) })} data-testid="edit-booking-duration" />
              </div>
            </div>
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
                <div className="label-eyebrow text-[#5C6C62]">Pricing</div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C6C62]">Subtotal</span>
                  <span className="text-[#2D3A33] font-medium">{fmtIDR(subtotalIdr)}</span>
                </div>
                {appliedCoupon && appliedCoupon.discount_idr > 0 && (
                  <div className="flex justify-between text-sm text-[#52796F]">
                    <span>Discount ({appliedCoupon.coupon_code})</span>
                    <span>− {fmtIDR(appliedCoupon.discount_idr)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-medium pt-2 border-t border-[#EAE6D7]">
                  <span className="text-[#2D3A33]">Total</span>
                  <span className="text-[#2D3A33]" data-testid="edit-booking-total">{fmtIDR(editTotal)}</span>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Coupon code</label>
                  <div className="flex gap-2">
                    <input
                      className="bl-input flex-1 font-mono uppercase"
                      placeholder="e.g. SUMMER20"
                      value={couponInput}
                      onChange={e => setCouponInput(e.target.value.toUpperCase())}
                      data-testid="edit-coupon-input"
                    />
                    <button type="button" onClick={applyCoupon} disabled={couponBusy || !couponInput.trim()} className="bl-btn-ghost whitespace-nowrap disabled:opacity-50" data-testid="edit-coupon-apply">
                      {couponBusy ? "…" : "Apply"}
                    </button>
                    {appliedCoupon && (
                      <button type="button" onClick={clearCoupon} className="bl-btn-ghost text-sm" data-testid="edit-coupon-clear">Clear</button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={save} disabled={busy} className="bl-btn-primary flex-1 disabled:opacity-50" data-testid="edit-booking-save">{busy ? "Saving…" : "Save changes"}</button>
              <button type="button" onClick={() => {
                const next = bookingToForm(booking, treatments, packages);
                setForm(next);
                setEditing(false);
                const code = booking?.coupon_code || "";
                setCouponInput(code);
                if (code && booking?.subtotal_idr != null) {
                  setAppliedCoupon({
                    coupon_code: code,
                    subtotal_idr: booking.subtotal_idr,
                    discount_idr: booking.discount_idr || 0,
                    total_idr: booking.total_idr ?? booking.subtotal_idr,
                  });
                } else {
                  setAppliedCoupon(null);
                }
              }} className="bl-btn-ghost" data-testid="edit-booking-cancel">Cancel</button>
            </div>
          </div>
        ) : (
          <>
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
                      <span>Discount{booking.coupon_code ? ` (${booking.coupon_code})` : ""}</span>
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className={`bl-chip ${sc.cls}`}>{sc.label}</span>
              {booking.is_overtime && !block && <OvertimeBadge />}
              {!block && (consentForms.length > 0 || selectedTreatment?.consent_required) && (
                <ConsentStatusBadge status={consentSummary(consentForms).status} />
              )}
              {!block && selectedTreatment?.consent_required && consentForms.length === 0 && (
                <span className="text-xs text-[#B14A2C]">Consent required</span>
              )}
            </div>
          </>
        )}

        {showStartVisitHint && (
          <div
            className="mt-5 p-4 rounded-xl border border-[#D4E4DC] bg-[#F5FAF7]"
            data-testid="booking-start-visit-hint"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-3 min-w-0 flex-1">
                <Stethoscope className="w-5 h-5 shrink-0 text-[#52796F] mt-0.5" strokeWidth={1.6} />
                <div className="text-sm text-[#2D3A33] leading-relaxed space-y-1">
                  <p>Ready for treatment? Start a treatment session to open the patient chart, add treatment details, and prepare billing.</p>
                  <p className="text-xs text-[#5C6C62]">A treatment session is the clinical record — separate from the appointment on the schedule.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onStartVisit(booking)}
                disabled={startVisitBusy}
                className="bl-btn-primary text-sm inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
                data-testid="start-visit-button"
              >
                {startVisitBusy ? "Starting…" : "Start treatment session"}
              </button>
            </div>
          </div>
        )}

        {!editing && (
          <div className="mt-5 flex flex-wrap gap-2">
            {editable && block && (
              <button type="button" onClick={() => onEditBlock?.(booking)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="edit-block-button">
                <Edit2 className="w-4 h-4" /> Edit block
              </button>
            )}
            {editable && !block && (
              <button type="button" onClick={() => setEditing(true)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="edit-booking-button">
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            )}
            {!block && (
              <button type="button" onClick={() => onWa(booking)} className="bl-btn-ghost text-sm inline-flex items-center gap-2">
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
            )}
            {booking.visit_id && (
              <Link
                to={`/visits/${booking.visit_id}?tab=consent`}
                className="bl-btn-ghost text-sm inline-flex items-center gap-2"
                data-testid="booking-consent-link"
              >
                Consent
              </Link>
            )}
            {booking.visit_id && (
              <Link
                to={`/visits/${booking.visit_id}`}
                className="bl-btn-primary text-sm inline-flex items-center gap-2"
                data-testid="open-visit-link"
              >
                Open patient chart <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {canManage && next && booking.status !== "checked_in" && !booking.visit_id && (
              <button type="button" onClick={() => onAdvance(booking)} className="bl-btn-ghost text-sm inline-flex items-center gap-2" data-testid="advance-booking-button">
                {next.label} <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {canManage && booking.status !== "cancelled" && booking.status !== "completed" && (
              <button type="button" onClick={() => onCancel(booking)} className="text-sm text-[#B14A2C] hover:underline">
                {block ? "Remove block" : "Cancel booking"}
              </button>
            )}
          </div>
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
  const clinicName = branding?.clinic_name || clinic?.name || "our clinic";
  const canCreateOvertime =
    ["super_admin", "manager"].includes(user?.role) ||
    hasPermission(user, "bookings.create_overtime");
  const canSendViaProvider = hasPermission(user, "messaging.send") || hasPermission(user, "messaging.manage");

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

  const refresh = useCallback(() => {
    if (viewMode === "list") {
      const params = { scope };
      if (statusFilter) params.status = statusFilter;
      api.get("/bookings", { params }).then(r => setBookings(r.data || []));
    }
    setReloadAt(Date.now());
  }, [scope, statusFilter, viewMode]);

  useEffect(() => { refresh(); }, [refresh]);

  useRealtimeInvalidation(REALTIME_TOPICS.BOOKINGS, refresh);
  useVisibilityPolling(refresh, 30000);
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
    refresh();
  };
  const cancel = async (b) => {
    const msg = isTimeBlock(b) ? "Remove this time block?" : "Cancel this booking?";
    if (!window.confirm(msg)) return;
    await api.delete(`/bookings/${b.id}`);
    toast.success(isTimeBlock(b) ? "Blocked time removed" : "Cancelled");
    refresh();
  };

  const startVisit = async (b) => {
    setStartVisitBusy(true);
    try {
      const r = await api.post(`/bookings/${b.id}/start-visit`);
      const visit = r.data?.visit;
      toast.success("Treatment session started — patient chart is open");
      setDetailBooking(r.data?.booking || b);
      refresh();
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
              <DropdownMenuContent align="end" className="min-w-[12rem] bg-white border-[#EAE6D7] text-[#2D3A33] shadow-lg">
                <DropdownMenuItem onClick={copyLink} className="cursor-pointer focus:bg-[#F8F5EC]" data-testid="copy-public-link">
                  <Copy className="w-4 h-4 mr-2 text-[#5C6C62]" />
                  Copy appointment link
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
                  <a href={`/book/${clinic.slug}`} target="_blank" rel="noreferrer" className="flex items-center w-full" data-testid="open-public-link">
                    <ExternalLink className="w-4 h-4 mr-2 text-[#5C6C62]" />
                    View public booking page
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between flex-wrap gap-3 rounded-xl border border-[#EAE6D7] bg-[#FAFAF7]/60 px-3 py-2.5">
        <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1" data-testid="view-mode-tabs">
          {VIEW_MODES.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setViewMode(t.key)}
                className="px-4 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
                style={viewMode === t.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }}
                data-testid={`view-${t.key}`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#5C6C62] hidden sm:inline">Status</span>
          <select
            className="bl-input w-auto min-w-[11.5rem] sm:min-w-[13.5rem] max-w-full py-2.5 pr-9 text-sm leading-normal h-auto align-middle"
            style={{ lineHeight: "1.35" }}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            data-testid="status-filter"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
            date={scheduleDate}
            onDateChange={setScheduleDate}
            statusFilter={statusFilter}
            reloadAt={reloadAt}
            canManage={canManage}
            canCreateOvertime={canCreateOvertime}
            onSelectBooking={setDetailBooking}
            onEmptySlot={(initial) => setSlotAction(initial)}
            onOvertimeSlot={(payload) => setOvertimeSlot(payload)}
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

      <div className="mt-5 bl-card overflow-hidden hidden lg:block" data-testid="bookings-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
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
                  <tr key={b.id} className="border-t border-[#EAE6D7] cursor-pointer hover:bg-[#FAFAF7]" data-testid={`booking-row-${b.id}`} onClick={() => setDetailBooking(b)}>
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

      {detailBooking && (
        <BookingDetailPanel
          booking={detailBooking}
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
          onWa={(b) => { setDetailBooking(null); setWaBooking(b); }}
          onSaved={(updated) => { setDetailBooking(updated); refresh(); }}
          onStartVisit={startVisit}
          startVisitBusy={startVisitBusy}
          onEditBlock={(b) => { setDetailBooking(null); setBlockEdit(b); setBlockInitial(null); setBlockOpen(true); }}
        />
      )}
      {slotAction && (
        <SlotActionModal
          initial={slotAction}
          staff={scheduleStaff}
          onClose={() => setSlotAction(null)}
          onBook={() => {
            setNewInitial(slotAction);
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
      {blockOpen && (
        <BlockTimeModal
          initial={blockInitial}
          booking={blockEdit}
          onClose={() => { setBlockOpen(false); setBlockInitial(null); setBlockEdit(null); }}
          onSaved={(updated) => {
            if (updated) setDetailBooking(updated);
            refresh();
          }}
        />
      )}
      {waBooking && <WaPanel booking={waBooking} templates={templates} clinicName={clinicName} automationActive={automationActive} canSendViaProvider={canSendViaProvider} onClose={() => setWaBooking(null)} onSent={() => { setWaBooking(null); refresh(); }} />}
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
      {newOpen && (
        <NewBookingModal
          initial={newInitial}
          overtimeMeta={overtimeMeta}
          onClose={() => { setNewOpen(false); setNewInitial(null); setOvertimeMeta(null); }}
          onCreated={() => { setNewOpen(false); setNewInitial(null); setOvertimeMeta(null); refresh(); }}
        />
      )}
    </div>
  );
}
