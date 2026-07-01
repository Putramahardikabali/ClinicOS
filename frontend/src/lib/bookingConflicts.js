/** Parse schedule conflict responses from booking API. */

export function parseScheduleConflict(error) {
  const detail = error?.response?.data?.detail;
  if (!detail) return null;
  if (typeof detail === "object" && detail.code === "schedule_conflict") {
    return detail;
  }
  if (typeof detail === "string" && detail.toLowerCase().includes("already")) {
    return { code: "schedule_conflict", message: detail, conflicts: [] };
  }
  return null;
}

export function formatConflictTime(conflict) {
  if (!conflict?.scheduled_at) return "";
  const start = new Date(conflict.scheduled_at);
  const end = conflict.scheduled_end_at ? new Date(conflict.scheduled_end_at) : null;
  const t0 = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (end) {
    const t1 = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${t0} – ${t1}`;
  }
  const dur = conflict.duration_min || 30;
  return `${t0} (${dur} min)`;
}
