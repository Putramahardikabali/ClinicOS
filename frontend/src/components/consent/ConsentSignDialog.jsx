import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";
import { toast } from "sonner";

export default function ConsentSignDialog({ form, onClose, onSigned, requireStaff = false }) {
  const [patientSig, setPatientSig] = useState("");
  const [staffSig, setStaffSig] = useState("");
  const [busy, setBusy] = useState(false);

  const snap = form?.template_snapshot || {};
  const needsStaff = requireStaff || snap.requires_staff_signature;

  const submit = async () => {
    if (!patientSig) {
      toast.error("Patient signature is required");
      return;
    }
    if (needsStaff && !staffSig) {
      toast.error("Staff signature is required");
      return;
    }
    setBusy(true);
    try {
      await onSigned({ patient_signature: patientSig, staff_signature: staffSig || undefined });
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save signature");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bl-card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-7" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl text-[#2D3A33]">{snap.title || form?.treatment_name_snapshot || "Consent form"}</h2>
        <p className="text-sm text-[#5C6C62] mt-1">{form?.treatment_name_snapshot}</p>

        <div className="mt-5 prose prose-sm max-w-none text-[#2D3A33]">
          {(snap.sections || []).length > 0 ? (
            snap.sections.map((sec, i) => (
              <div key={i} className="mb-4">
                {sec.heading && <h3 className="font-medium text-base">{sec.heading}</h3>}
                <p className="text-sm text-[#5C6C62] whitespace-pre-wrap mt-1">{sec.content}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#5C6C62] whitespace-pre-wrap">{snap.body || "Review and sign below."}</p>
          )}
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <div className="label-eyebrow mb-2">Patient signature</div>
            <SignaturePad value={patientSig} onChange={setPatientSig} testid="consent-patient-signature" />
          </div>
          {needsStaff && (
            <div>
              <div className="label-eyebrow mb-2">Staff / doctor signature</div>
              <SignaturePad value={staffSig} onChange={setStaffSig} testid="consent-staff-signature" />
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" disabled={busy} onClick={submit} className="bl-btn-primary" data-testid="consent-sign-submit">
            Confirm & sign
          </button>
          <button type="button" onClick={onClose} className="bl-btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}
