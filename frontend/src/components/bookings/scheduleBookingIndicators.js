import {
  AlertTriangle,
  Award,
  Heart,
  Package,
  Repeat,
  Sparkles,
} from "lucide-react";

/** Soft schedule card colors — keys match backend display_status. */
export const SCHEDULE_STATUS_COLORS = {
  booked: { bg: "#E8E0F4", border: "#9B7EC8", text: "#5C3D8A", label: "Booked" },
  confirmed: { bg: "#E3F1E8", border: "#52796F", text: "#2C7755", label: "Confirmed" },
  checked_in: { bg: "#D4EDE0", border: "#2C7755", text: "#1F4D3A", label: "Checked in" },
  closed: { bg: "#E8E6E0", border: "#8A8578", text: "#4A4843", label: "Closed" },
  unavailable: { bg: "#EDEAE4", border: "#B8B0A4", text: "#6B6560", label: "Unavailable" },
  block_out: { bg: "#F5E6D3", border: "#C4A574", text: "#6B5344", label: "Block out" },
  treatment_started: { bg: "#D6E8F5", border: "#5A8FB8", text: "#2C5275", label: "Treatment started" },
  completed: { bg: "#F3F1EB", border: "#A89F8B", text: "#5C6C62", label: "Completed" },
  cancelled: { bg: "#F0EBEB", border: "#C4A8A8", text: "#6B5555", label: "Cancelled" },
  no_show: { bg: "#F5E8E8", border: "#C98888", text: "#7A4545", label: "No show" },
};

export const INDICATOR_PRIORITY = [
  "profile_alert",
  "specific_staff_request",
  "package_use",
  "loyalty",
  "new_patient",
  "recurring_patient",
];

export const INDICATOR_DEFS = {
  profile_alert: { key: "profile_alert", Icon: AlertTriangle, title: "Profile alert" },
  specific_staff_request: { key: "specific_staff_request", Icon: Heart, title: "Patient requested this staff" },
  package_use: { key: "package_use", Icon: Package, title: "Package" },
  loyalty: { key: "loyalty", Icon: Award, title: "Loyalty" },
  new_patient: { key: "new_patient", Icon: Sparkles, title: "New patient" },
  recurring_patient: { key: "recurring_patient", Icon: Repeat, title: "Returning" },
};

const MAX_CARD_ICONS = 3;

export function isTimeBlockBooking(booking) {
  return booking?.status === "blocked" || booking?.booking_type === "block";
}

export function resolveScheduleDisplayStatus(booking) {
  if (isTimeBlockBooking(booking)) return "block_out";
  const meta = booking?.schedule_meta;
  if (meta?.display_status) return meta.display_status;
  const st = (booking?.status || "booked").toLowerCase();
  if (st === "cancelled") return "cancelled";
  if (st === "no_show") return "no_show";
  if (st === "pending_payment" || st === "payment_expired" || st === "payment_failed") return "unavailable";
  if (st === "completed") return "completed";
  if (st === "checked_in") return "checked_in";
  if (st === "confirmed") return "confirmed";
  return "booked";
}

export function resolveScheduleCardColors(booking) {
  const key = resolveScheduleDisplayStatus(booking);
  return SCHEDULE_STATUS_COLORS[key] || SCHEDULE_STATUS_COLORS.booked;
}

function indicatorActive(booking, meta, key) {
  if (!meta) return false;
  switch (key) {
    case "profile_alert":
      return !!meta.profile_alert?.active;
    case "specific_staff_request":
      return !!booking?.specific_staff_requested;
    case "package_use":
      return !!meta.package_use?.active;
    case "loyalty":
      return !!meta.loyalty?.active;
    case "new_patient":
      return !!meta.new_patient;
    case "recurring_patient":
      return !!meta.recurring_patient && !meta.new_patient;
    default:
      return false;
  }
}

export function collectActiveIndicators(booking) {
  const meta = booking?.schedule_meta;
  if (!meta || isTimeBlockBooking(booking)) return [];
  return INDICATOR_PRIORITY.filter((key) => indicatorActive(booking, meta, key));
}

export function selectCardIcons(booking) {
  const active = collectActiveIndicators(booking);
  const visible = active.slice(0, MAX_CARD_ICONS);
  const overflow = Math.max(0, active.length - visible.length);
  return { visible, overflow, all: active };
}

export function formatCardIndicatorLabels(booking) {
  return collectActiveIndicators(booking).map((key) => INDICATOR_DEFS[key]?.title || key);
}

export function formatStatusLabel(booking) {
  const colors = resolveScheduleCardColors(booking);
  return colors.label;
}

function formatTimeRange(booking) {
  if (!booking?.scheduled_at) return "";
  const start = new Date(booking.scheduled_at);
  const dur = booking.duration_min || 30;
  const end = new Date(start.getTime() + dur * 60000);
  const fmt = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)} (${dur}m)`;
}

function formatCheckIn(meta) {
  const raw = meta?.checked_in_at;
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return raw;
  }
}

export function buildSchedulePreviewLines(booking) {
  if (isTimeBlockBooking(booking)) {
    return [
      { label: "Blocked", value: booking.block_reason || booking.patient_name || "—" },
      { label: "Time", value: formatTimeRange(booking) },
    ];
  }

  const meta = booking.schedule_meta || {};
  const lines = [
    { label: "Patient", value: booking.patient_name || "—", strong: true },
    { label: "Time", value: formatTimeRange(booking) },
    { label: "Treatment", value: booking.treatment || "—" },
    {
      label: "Staff",
      value: (meta.staff_assigned || []).join(", ") || "—",
    },
    { label: "Status", value: formatStatusLabel(booking) },
  ];

  const checkIn = formatCheckIn(meta);
  if (checkIn) lines.push({ label: "Checked in", value: checkIn });

  if (booking.specific_staff_requested) {
    const requestedName = (booking.requested_staff_name_snapshot || meta.specific_staff_request?.label || "").trim();
    lines.push({
      label: "Patient requested this staff",
      value: requestedName ? `Requested staff: ${requestedName}` : "Yes",
    });
  }
  if (meta.profile_alert?.active) {
    lines.push({ label: "Alert", value: meta.profile_alert.label || "Profile alert" });
  }
  if (meta.blacklist?.active) {
    lines.push({
      label: "Patient label",
      value: meta.blacklist.reason
        ? `Blacklist — ${meta.blacklist.reason}`
        : "Blacklist",
    });
  }
  if (meta.loyalty?.active) {
    lines.push({ label: "Loyalty", value: meta.loyalty.tier_name || "Member" });
  }
  if (meta.new_patient) {
    lines.push({ label: "Patient type", value: "New patient" });
  } else if (meta.recurring_patient) {
    lines.push({ label: "Patient type", value: "Returning patient" });
  }
  if (meta.package_use?.active) {
    lines.push({ label: "Package", value: meta.package_use.label || "Package session" });
  }
  if (meta.note_preview || booking.notes) {
    lines.push({ label: "Booking note", value: meta.note_preview || (booking.notes || "").slice(0, 160) });
  }
  if (booking.patient_phone) {
    lines.splice(1, 0, { label: "Phone", value: booking.patient_phone });
  }
  const labels = meta.patient_labels || booking.patient_labels || [];
  if (labels.length) {
    lines.push({ label: "Labels", value: labels.map((l) => l.name).join(", ") });
  }
  if (meta.payment_status || booking.payment_status) {
    lines.push({ label: "Payment", value: meta.payment_status || booking.payment_status });
  }
  if (booking.invoice?.payment_status) {
    lines.push({ label: "Invoice", value: booking.invoice.payment_status });
  }

  const indicatorLabels = formatCardIndicatorLabels(booking);
  if (indicatorLabels.length) {
    lines.push({ label: "Indicators", value: indicatorLabels.join(" · ") });
  }

  return lines;
}

export function supportsHoverPreview() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
