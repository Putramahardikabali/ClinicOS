import api from "@/lib/api";
import { isTimeBlockBooking } from "@/components/bookings/scheduleBookingIndicators";

export function patientDisplayName(patient) {
  return (
    patient?.full_name
    || `${patient?.first_name || ""} ${patient?.last_name || ""}`.trim()
    || patient?.patient_name
    || "Unknown"
  );
}

export function patientInitials(patient) {
  const name = patientDisplayName(patient);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

export function serviceCountLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return n === 1 ? "1 service" : `${n} services`;
}

export function resolvePatientSearchPrimaryAction(bookingCount) {
  const n = Number(bookingCount) || 0;
  if (n === 0) return { key: "book", label: "Book Appointment" };
  if (n === 1) return { key: "modify", label: "Modify Appointment" };
  return { key: "highlight", label: "Highlight bookings" };
}

function isHighlightableDayBooking(booking, date) {
  if (!booking?.patient_id || isTimeBlockBooking(booking)) return false;
  const day = (booking.scheduled_at || "").slice(0, 10);
  return !date || !day || day === date;
}

export async function fetchPatientBookingsForDate(patientId, date) {
  if (!patientId || !date) return [];
  try {
    const r = await api.get("/bookings", {
      params: { date, patient_id: patientId, appointments_only: true },
    });
    return (r.data || []).filter((b) => isHighlightableDayBooking(b, date));
  } catch {
    return [];
  }
}

export async function enrichPatientsWithTodayBookings(patients, date) {
  if (!patients?.length || !date) {
    return (patients || []).map((p) => ({ ...p, todayBookings: [], todayBookingCount: 0 }));
  }
  const enriched = await Promise.all(
    patients.map(async (patient) => {
      const todayBookings = await fetchPatientBookingsForDate(patient.id, date);
      return {
        ...patient,
        todayBookings,
        todayBookingCount: todayBookings.length,
      };
    }),
  );
  return enriched;
}

export async function searchPatients(query, { pageSize = 10 } = {}) {
  const q = (query || "").trim();
  if (!q) return [];
  const r = await api.get("/patients", {
    params: { q, page: 1, page_size: pageSize },
  });
  const data = r.data || {};
  return data.items || (Array.isArray(data) ? data : []);
}
