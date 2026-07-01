export const APPOINTMENT_STATUS_OPTIONS = [
  { value: "booked", label: "Booked" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked In" },
  { value: "treatment_started", label: "Treatment Started" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

export const STATUS_CHIP_COLORS = {
  booked: "info",
  confirmed: "success",
  checked_in: "success",
  treatment_started: "info",
  completed: "success",
  closed: "success",
  cancelled: "",
  no_show: "",
  pending_payment: "info",
};

export const SENSITIVE_STATUSES = new Set(["cancelled", "no_show", "closed"]);
export const REASON_STATUSES = new Set(["cancelled", "no_show"]);

export function statusLabel(status) {
  return APPOINTMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label
    || (status || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function paymentStatusLabel(status) {
  if (!status) return "—";
  return String(status).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** FO appointment modal — which footer actions to show per state. */
export function resolveBookingDetailActions(booking, opts = {}) {
  const {
    block = false,
    canManage = false,
    canCreateInvoice = false,
    editing = false,
  } = opts;

  const rawStatus = (booking?.status || "booked").toLowerCase();
  const displayStatus = booking?.display_status || rawStatus;
  const hasVisit = !!booking?.visit_id;
  const hasInvoice = !!booking?.invoice?.id;
  const invoicePaid = hasInvoice && ["paid", "settled"].includes(String(booking.invoice.payment_status || "").toLowerCase());

  const editable = canManage && !block && !["cancelled", "completed", "no_show"].includes(rawStatus);

  return {
    displayStatus,
    rawStatus,
    showEdit: editable && !editing,
    showConfirm: canManage && !block && rawStatus === "booked" && !hasVisit,
    showCheckIn: canManage && !block && rawStatus === "confirmed" && !hasVisit,
    showStartVisit:
      canManage && !block && !hasVisit && ["booked", "confirmed", "checked_in"].includes(rawStatus) && !editing,
    showOpenVisit: !block && hasVisit,
    showShowInvoice: !block && hasInvoice,
    showCreateInvoice: !block && hasVisit && !hasInvoice && canCreateInvoice,
    showCancel:
      canManage && !block && !["cancelled", "completed", "no_show"].includes(rawStatus),
    showNoShow: canManage && !block && rawStatus === "checked_in" && !hasVisit,
    showRebook: canManage && !block && ["cancelled", "no_show"].includes(rawStatus),
    showAddNote: !block && !editing,
    invoicePaid,
    hasInvoice,
  };
}
