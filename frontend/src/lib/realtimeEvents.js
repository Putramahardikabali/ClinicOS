/** Realtime event topic keys used for invalidation registration. */
export const REALTIME_TOPICS = {
  DASHBOARD: "dashboard",
  FRONT_DESK: "front-desk",
  BOOKINGS: "bookings",
  VISITS: "visits",
  MY_VISITS: "my-visits",
  INVOICES: "invoices",
  CLINICAL: "clinical",
};

const OPERATIONAL_ROLES = new Set(["super_admin", "fo", "manager", "accounting"]);
const CLINICAL_ROLES = new Set(["doctor", "therapist", "nurse"]);

export const VISIT_EVENT_TYPES = new Set([
  "visit_created",
  "visit_started",
  "visit_updated",
  "visit_submitted",
]);

export const BOOKING_EVENT_TYPES = new Set(["booking_created", "booking_updated"]);

export const INVOICE_EVENT_TYPES = new Set(["invoice_updated"]);

export function visitTopicKey(visitId) {
  return visitId ? `visit:${visitId}` : null;
}

export function isEventRelevantToUser(event, user) {
  if (!user || !event) return false;
  if (user.platform_admin) return false;
  const role = user.role;
  if (OPERATIONAL_ROLES.has(role)) return true;
  if (CLINICAL_ROLES.has(role)) {
    const ids = event.performer_ids || [];
    return Boolean(user.id && ids.includes(user.id));
  }
  return true;
}

export function topicsForEvent(event) {
  const topics = new Set();
  const type = event?.type || "";
  const refType = event?.reference_type || "";

  if (VISIT_EVENT_TYPES.has(type) || refType === "visit") {
    topics.add(REALTIME_TOPICS.VISITS);
    topics.add(REALTIME_TOPICS.MY_VISITS);
    topics.add(REALTIME_TOPICS.DASHBOARD);
    topics.add(REALTIME_TOPICS.FRONT_DESK);
    topics.add(REALTIME_TOPICS.CLINICAL);
    if (event.reference_id) {
      topics.add(visitTopicKey(event.reference_id));
    }
    if (type === "visit_submitted" || type === "visit_updated") {
      topics.add(REALTIME_TOPICS.INVOICES);
    }
  }

  if (BOOKING_EVENT_TYPES.has(type) || refType === "booking") {
    topics.add(REALTIME_TOPICS.BOOKINGS);
    topics.add(REALTIME_TOPICS.DASHBOARD);
    topics.add(REALTIME_TOPICS.FRONT_DESK);
  }

  if (INVOICE_EVENT_TYPES.has(type) || refType === "invoice") {
    topics.add(REALTIME_TOPICS.INVOICES);
    topics.add(REALTIME_TOPICS.FRONT_DESK);
    topics.add(REALTIME_TOPICS.DASHBOARD);
    const visitId = event?.payload?.visit_id;
    if (visitId) topics.add(visitTopicKey(visitId));
  }

  return [...topics];
}

export function toastForEvent(event, user) {
  if (!isEventRelevantToUser(event, user)) return null;
  const type = event.type;
  const msg = event?.payload?.message || "";

  if (type === "visit_started" || type === "visit_created") {
    if (CLINICAL_ROLES.has(user?.role)) {
      return { message: msg || "New visit assigned", level: "info" };
    }
  }
  if (type === "visit_submitted") {
    if (OPERATIONAL_ROLES.has(user?.role)) {
      const who = event?.payload?.staff_name;
      return {
        message: who ? `Visit submitted by ${who}` : (msg || "Visit submitted"),
        level: "success",
      };
    }
  }
  return null;
}

export function debounce(fn, waitMs = 750) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return debounced;
}
