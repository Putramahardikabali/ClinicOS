import { AlertTriangle } from "lucide-react";
import { blacklistReason } from "@/lib/patientLabelDisplay";

export default function PatientBlacklistBanner({ patient, className = "" }) {
  const reason = blacklistReason(patient);
  if (!patient?.is_blacklisted && !(patient?.patient_labels || []).some((l) => (l.system_key || "").toLowerCase() === "blacklist")) {
    return null;
  }
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 text-red-900 px-4 py-3 text-sm flex gap-3 ${className}`}
      data-testid="patient-blacklist-banner"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
      <div>
        <div className="font-medium">This patient is marked as Blacklist.</div>
        {reason ? <div className="mt-1 text-red-800/90">Reason: {reason}</div> : null}
        <div className="mt-1 text-xs text-red-700/80">Please review before proceeding.</div>
      </div>
    </div>
  );
}
