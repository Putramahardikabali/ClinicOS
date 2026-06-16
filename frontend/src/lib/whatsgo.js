import api from "@/lib/api";
import { toast } from "sonner";

export const WHATSGO_NOT_CONNECTED_MSG = "Connect Whatsgo Integration first.";

export const WHATSGO_TEST_VARIABLES = [
  { key: "patient_name", label: "Patient name" },
  { key: "clinic_name", label: "Clinic name" },
  { key: "appointment_date", label: "Appointment date" },
  { key: "appointment_time", label: "Appointment time" },
  { key: "treatment_name", label: "Treatment name" },
  { key: "consent_form_link", label: "Consent form link" },
  { key: "package_remaining_sessions", label: "Package remaining sessions" },
  { key: "package_expiry_date", label: "Package expiry date" },
];

export async function syncPatientToWhatsgo(patientId) {
  const r = await api.post(`/messaging/whatsgo/patients/${patientId}/sync`);
  return r.data;
}

export async function openWhatsgoChat(patientId) {
  const r = await api.get(`/messaging/whatsgo/patients/${patientId}/open-chat`);
  const url = r.data?.open_conversation_url;
  if (!url) throw new Error("Whatsgo conversation URL not available");
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export async function openWhatsgoChatSafe(patientId) {
  try {
    return await openWhatsgoChat(patientId);
  } catch (e) {
    const detail = e?.response?.data?.detail || e?.message || "Could not open Whatsgo chat";
    toast.error(detail);
    throw e;
  }
}

export async function syncPatientToWhatsgoSafe(patientId) {
  try {
    const data = await syncPatientToWhatsgo(patientId);
    toast.success("Patient synced to Whatsgo");
    return data;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Sync failed");
    throw e;
  }
}

export function whatsgoLogInboxLink(log, inboxBase) {
  if (log.open_conversation_url) return log.open_conversation_url;
  if (!inboxBase) return "";
  if (log.provider_message_id || log.whatsgo_message_id) {
    const mid = log.provider_message_id || log.whatsgo_message_id;
    return `${inboxBase}/messages/${mid}`;
  }
  if (log.patient_id) return `${inboxBase}/contacts?external_patient_id=${log.patient_id}`;
  return inboxBase;
}
