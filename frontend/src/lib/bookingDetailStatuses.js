export const APPOINTMENT_STATUS_OPTIONS = [
  { value: "booked", label: "Booked" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked In" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

/** Status values selectable in the appointment detail dropdown (excludes display-only states). */
export const APPOINTMENT_STATUS_SELECT_OPTIONS = APPOINTMENT_STATUS_OPTIONS;

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
  if (status === "treatment_started") return "Treatment in progress";
  return APPOINTMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label
    || (status || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function paymentStatusLabel(status) {
  if (!status) return "—";
  return String(status).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Primary footer action when the status dropdown has not been changed manually.
 */
export function resolvePrimaryBookingAction(booking, opts = {}) {
  const {
    block = false,
    canManage = false,
    canCreateInvoice = false,
    statusDirty = false,
    canRebook = false,
  } = opts;

  if (block) return null;

  if (statusDirty) {
    return { type: "save_status", label: "Save changes", testId: "save-status-button" };
  }

  const rawStatus = (booking?.status || "booked").toLowerCase();
  const hasVisit = !!booking?.visit_id;
  const hasInvoice = !!booking?.invoice?.id;

  if (["cancelled", "no_show"].includes(rawStatus)) {
    if (canRebook) {
      return { type: "rebook", label: "Rebook", testId: "rebook-button" };
    }
    return null;
  }

  if (!canManage) return null;

  if (rawStatus === "booked" && !hasVisit) {
    return { type: "confirm", label: "Confirm", testId: "advance-booking-button" };
  }

  if (rawStatus === "confirmed" && !hasVisit) {
    return { type: "check_in", label: "Check in", testId: "check-in-booking-button" };
  }

  if (hasVisit && ["checked_in", "treatment_started", "confirmed", "booked"].includes(rawStatus)) {
    return {
      type: "open_visit",
      label: "Open treatment session",
      visitId: booking.visit_id,
      testId: "open-visit-link",
    };
  }

  if (rawStatus === "checked_in" && !hasVisit) {
    return { type: "check_in", label: "Check in", testId: "check-in-booking-button" };
  }

  if (["completed", "closed"].includes(rawStatus)) {
    if (hasInvoice) {
      return {
        type: "show_invoice",
        label: "Show invoice",
        invoiceId: booking.invoice.id,
        testId: "show-invoice-button",
      };
    }
    if (hasVisit && canCreateInvoice) {
      return { type: "create_invoice", label: "Create invoice", testId: "create-invoice-button" };
    }
  }

  return null;
}

/** Secondary footer links for the appointment detail modal. */
export function resolveBookingDetailActions(booking, opts = {}) {
  const {
    block = false,
    canManage = false,
    editing = false,
    onHighlightPatient = false,
  } = opts;

  const rawStatus = (booking?.status || "booked").toLowerCase();

  const editable = canManage && !block && !["cancelled", "completed", "no_show"].includes(rawStatus);

  return {
    rawStatus,
    showEdit: editable && !editing && !block,
    showEditBlock: editable && block && !editing,
    showCancel:
      canManage && (block || !["cancelled", "completed", "no_show"].includes(rawStatus)),
    showHighlight:
      !block && !editing && onHighlightPatient && !["cancelled", "no_show"].includes(rawStatus),
    showRebook: canManage && !block && ["cancelled", "no_show"].includes(rawStatus),
    showConsent: !block && !!booking?.visit_id,
  };
}
