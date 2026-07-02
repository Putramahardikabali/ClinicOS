export const WAITLIST_STATUSES = [
  { key: "", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "contacted", label: "Contacted" },
  { key: "slot_offered", label: "Slot offered" },
  { key: "booked", label: "Booked" },
  { key: "cancelled", label: "Cancelled" },
  { key: "expired", label: "Expired" },
];

export const ACTIVE_WAITLIST_STATUSES = new Set(["waiting", "contacted", "slot_offered"]);

export const WAITLIST_PRIORITIES = [
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
  { key: "vip", label: "VIP" },
];

export const WAITLIST_TIME_TYPES = [
  { key: "anytime", label: "Anytime" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
  { key: "specific", label: "Specific time" },
];

export const WAITLIST_SOURCES = [
  { key: "", label: "—" },
  { key: "walk_in", label: "Walk-in" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone call" },
  { key: "instagram", label: "Instagram" },
  { key: "other", label: "Other" },
];

export const CANCEL_REASONS = [
  { key: "patient_no_longer_interested", label: "Patient no longer interested" },
  { key: "no_response", label: "No response" },
  { key: "duplicate", label: "Duplicate" },
  { key: "other", label: "Other" },
];

export const DATE_PRESETS = [
  { key: "schedule", label: "Schedule date" },
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveWaitlistDateRange(preset, scheduleDate) {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: toYmd(now), to: toYmd(now) };
    case "last7": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toYmd(from), to: toYmd(now) };
    }
    case "last30": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toYmd(from), to: toYmd(now) };
    }
    case "schedule":
    default:
      return { from: scheduleDate || toYmd(now), to: scheduleDate || toYmd(now) };
  }
}

export function waitlistStatusChip(status) {
  if (status === "booked") return "success";
  if (status === "contacted" || status === "slot_offered") return "info";
  if (status === "cancelled" || status === "expired") return "warning";
  return "";
}

export function waitlistPriorityChip(priority) {
  if (priority === "vip") return "success";
  if (priority === "high") return "warning";
  return "";
}

export function waitlistDisplayName(entry) {
  return entry?.display_name || entry?.patient_name || entry?.new_patient_name || "—";
}

export function waitlistDisplayPhone(entry) {
  return entry?.display_phone || entry?.patient_phone || entry?.new_patient_phone || "";
}

export function waitlistPreferredTimeLabel(entry) {
  const type = entry?.preferred_time_type || "anytime";
  if (type === "specific" && entry?.preferred_time) return entry.preferred_time;
  const match = WAITLIST_TIME_TYPES.find((t) => t.key === type);
  return match?.label || "Anytime";
}

export function buildWaitlistBookingPrefill(entry, scheduleDate) {
  const desiredDate = entry?.desired_date || scheduleDate;
  const prefill = {
    scheduled_date: desiredDate,
    treatment: entry?.treatment_name_snapshot || "",
    notes: entry?.notes || "",
    waiting_list_id: entry?.id,
  };
  if (entry?.preferred_staff_id) {
    prefill.performer_id = entry.preferred_staff_id;
  }
  if (entry?.preferred_time_type === "specific" && entry?.preferred_time) {
    prefill.scheduled_time = entry.preferred_time;
  }
  if (entry?.patient_id) {
    prefill.patient_id = entry.patient_id;
    prefill.patient_name = entry.patient_name || waitlistDisplayName(entry);
    prefill.patient_phone = entry.patient_phone || waitlistDisplayPhone(entry);
    prefill.patient_email = entry.patient_email || entry.new_patient_email || "";
    prefill._patientRecord = {
      id: entry.patient_id,
      full_name: prefill.patient_name,
      phone: prefill.patient_phone,
      email: prefill.patient_email,
    };
  } else {
    prefill.is_new_patient = true;
    prefill.patient_name = entry?.new_patient_name || "";
    prefill.patient_phone = entry?.new_patient_phone || "";
    prefill.patient_email = entry?.new_patient_email || "";
  }
  return prefill;
}

export function isActiveWaitlistEntry(entry) {
  return ACTIVE_WAITLIST_STATUSES.has(entry?.status);
}
