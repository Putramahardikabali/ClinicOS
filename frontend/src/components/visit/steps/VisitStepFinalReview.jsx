import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import SignaturePad from "@/components/SignaturePad";
import FollowUpFields from "@/components/visit/FollowUpFields";
import ConsentStatusBadge, { consentSummary } from "@/components/consent/ConsentStatusBadge";
import NoteStatusBadge from "@/components/visit/NoteStatusBadge";
import { recordNoteStatus, canEditClinicalNote, requiresEditReason } from "@/lib/clinicalNotes";
import EditReasonDialog from "@/components/visit/EditReasonDialog";
import { visitNoteTabRoles } from "@/lib/visitUi";
import { bookedTreatmentLabel, billingSummaryForReview, performedTreatmentItems, hasPerformedOrWaivedTreatment } from "@/lib/visitWorkflow";
import { productUsageName } from "@/components/visit/ProductUsageSelector";
import VisitReviewMedia from "@/components/visit/steps/VisitReviewMedia";

const VisitStepFinalReview = forwardRef(function VisitStepFinalReview(
  { visit, invoice, showBilling, clinicalRef, therapistRef, noteRole, onSaved },
  ref,
) {
  const { user } = useAuth();
  const visitRoles = visitNoteTabRoles(visit);
  const canOverride = user?.role === "super_admin" || user?.platform_admin;
  const showDoctor = visitRoles.has("doctor");
  const showTherapist = visitRoles.has("therapist");
  const showNurse = visitRoles.has("nurse");
  const therapistNoteRole = showNurse && !showTherapist ? "nurse" : "therapist";

  const cr = visit.clinical_record;
  const tr = visit.therapist_record;
  const doctorStatus = recordNoteStatus(cr, visit);
  const therapistStatus = recordNoteStatus(tr, visit);

  const doctorEditable = can(user, "edit_clinical") && (canEditClinicalNote(user, visit, cr) || canOverride);
  const therapistEditable =
    (can(user, "edit_therapist") || user?.role === "nurse")
    && (canEditClinicalNote(user, visit, tr) || canOverride);

  const [finalData, setFinalData] = useState({
    follow_up_recommendation: "",
    next_session_recommendation: "",
    signature: "",
  });
  const [busy, setBusy] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(null);
  const [treatmentDialog, setTreatmentDialog] = useState(false);
  const [noTreatmentReason, setNoTreatmentReason] = useState(visit.no_treatment_reason || "");

  useEffect(() => {
    const rec = showDoctor ? cr : tr;
    if (!rec) return;
    setFinalData({
      follow_up_recommendation: rec.follow_up_recommendation || "",
      next_session_recommendation: rec.next_session_recommendation || "",
      signature: rec.signature || "",
    });
  }, [cr, tr, showDoctor]);

  const consentInfo = consentSummary(visit.consent_forms || []);
  const billing = billingSummaryForReview(visit, invoice);
  const booked = bookedTreatmentLabel(visit);
  const performed = performedTreatmentItems(visit);

  const finalizeSubmit = async (editReason) => {
    const role = primaryFinalizeRole();
    if (role === "doctor") await saveDoctor(true, editReason);
    else if (role === "therapist") await saveTherapist(true, editReason);
    toast.success("Session record submitted");
    onSaved?.();
  };

  const submitLock = async () => {
    const role = primaryFinalizeRole();
    const record = role === "doctor" ? cr : tr;
    if (!hasPerformedOrWaivedTreatment(visit)) {
      setTreatmentDialog(true);
      return;
    }
    if (requiresEditReason(user, visit, record) && canOverride) {
      setPendingSubmit(true);
      setEditDialog(true);
      return;
    }
    setBusy(true);
    try {
      await finalizeSubmit();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const confirmNoTreatment = async () => {
    const reason = noTreatmentReason.trim();
    if (!reason) {
      toast.error("Please enter a reason");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/treatment-outcome`, {
        no_treatment_performed: true,
        no_treatment_reason: reason,
      });
      setTreatmentDialog(false);
      await finalizeSubmit();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const clinicalSummary = () => {
    if (showDoctor && cr) {
      const parts = [cr.diagnosis, cr.doctor_notes, cr.anamnesis].filter(Boolean);
      return parts[0] ? `${parts[0].slice(0, 120)}${parts[0].length > 120 ? "…" : ""}` : "—";
    }
    if ((showTherapist || showNurse) && tr) {
      const parts = [tr.therapist_notes, tr.concern_notes, tr.body_concern].filter(Boolean);
      return parts[0] ? `${parts[0].slice(0, 120)}${parts[0].length > 120 ? "…" : ""}` : "—";
    }
    return "—";
  };

  const saveDoctor = async (submit, editReason) => {
    const base = clinicalRef?.current?.getData?.() || cr || {};
    const { product_used: _pu, dosage: _d, area_treated: _at, ...clinicalPayload } = base;
    await api.put(`/visits/${visit.id}/clinical`, {
      ...clinicalPayload,
      ...finalData,
      submit,
      edit_reason: editReason || undefined,
    });
  };

  const saveTherapist = async (submit, editReason) => {
    const base = therapistRef?.current?.getData?.() || tr || {};
    await api.put(`/visits/${visit.id}/therapist`, {
      ...base,
      ...finalData,
      submit,
      edit_reason: editReason || undefined,
    });
  };

  const primaryFinalizeRole = () => {
    if (user?.role === "doctor" && showDoctor) return "doctor";
    if (user?.role === "therapist" && showTherapist) return "therapist";
    if (user?.role === "nurse" && showNurse) return "therapist";
    if (showDoctor) return "doctor";
    if (showTherapist || showNurse) return "therapist";
    return null;
  };

  const doSave = async (submit, editReason) => {
    const role = primaryFinalizeRole();
    if (role === "doctor") await saveDoctor(submit, editReason);
    else if (role === "therapist") await saveTherapist(submit, editReason);
    toast.success(submit ? "Session record submitted" : "Draft saved");
    onSaved?.();
  };

  const saveDraft = async () => {
    const role = primaryFinalizeRole();
    const record = role === "doctor" ? cr : tr;
    if (requiresEditReason(user, visit, record) && canOverride) {
      setPendingSubmit(false);
      setEditDialog(true);
      return;
    }
    setBusy(true);
    try {
      if (role === "doctor") await saveDoctor(false);
      else if (role === "therapist") await saveTherapist(false);
      toast.success("Draft saved");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const usageRows = performed.map((it) => {
    const usage = (visit.product_usages || []).find(
      (u) => u.treatment_item_id === it.id && u.status === "active",
    );
    return { it, usage };
  });

  useImperativeHandle(ref, () => ({
    saveDraft,
    submitLock,
    isBusy: () => busy,
  }), [busy, finalData, visit, cr, tr, clinicalRef, therapistRef]);

  const finalizeRole = primaryFinalizeRole();
  const editableFinalize = finalizeRole === "doctor" ? doctorEditable : therapistEditable;
  const roleLabel = finalizeRole === "doctor" ? "Doctor" : therapistNoteRole === "nurse" ? "Nurse" : "Therapist";
  const noteStatus = finalizeRole === "doctor" ? doctorStatus : therapistStatus;

  return (
    <div className="space-y-6" data-testid="visit-step-final-review">
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Treatment session summary</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-[#5C6C62]">Patient:</span> {visit.patient.full_name}</div>
          <div><span className="text-[#5C6C62]">Treatment session:</span> {visit.visit_type} · {new Date(visit.visit_date || visit.created_at).toLocaleDateString()}</div>
          <div><span className="text-[#5C6C62]">Treatment booked:</span> {booked || "—"}</div>
          <div><span className="text-[#5C6C62]">Treatment performed:</span> {visit.no_treatment_performed ? "None recorded" : performed.length ? performed.map((it) => it.name).join(", ") : "—"}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#5C6C62]">Consent:</span>
            <ConsentStatusBadge status={consentInfo.status} compact />
          </div>
          <div><span className="text-[#5C6C62]">Clinical notes:</span> {clinicalSummary()}</div>
          <div><span className="text-[#5C6C62]">Performed treatment lines:</span> {performed.length}</div>
          {showBilling && (
            <div>
              <span className="text-[#5C6C62]">Billing:</span>{" "}
              <span className={`bl-chip ${billing.chip}`}>{billing.label}</span>
            </div>
          )}
        </div>
      </div>

      {usageRows.length > 0 && (
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Treatment &amp; products</div>
          <ul className="text-sm space-y-2">
            {usageRows.map(({ it, usage }) => (
              <li key={it.id} className="border-b border-[#EAE6D7] pb-2 last:border-0">
                <span className="font-medium">{productUsageName(usage, it.product_used) || it.name}</span>
                {" · "}
                {Number(it.quantity ?? 1)} {it.unit_type || "session"}
                {it.area_treated ? ` · ${it.area_treated}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <VisitReviewMedia visit={visit} />

      <div className="bl-card p-5 pb-8">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="label-eyebrow">Final review</div>
          <NoteStatusBadge status={noteStatus} />
        </div>

        {editableFinalize && (
          <>
            <FollowUpFields
              data={finalData}
              setData={setFinalData}
              editable={!busy}
              prefix="final-"
            />
            <div className="mt-5">
              <label className="label-eyebrow block mb-2">{roleLabel} signature (TTD)</label>
              <SignaturePad
                value={finalData.signature}
                onChange={(s) => setFinalData((d) => ({ ...d, signature: s }))}
                testid="final-performer-signature"
              />
            </div>
          </>
        )}

        {!editableFinalize && (finalData.follow_up_recommendation || finalData.signature) && (
          <div className="text-sm space-y-3">
            {finalData.follow_up_recommendation && (
              <div>
                <div className="font-medium">After care</div>
                <p className="text-[#5C6C62] whitespace-pre-wrap">{finalData.follow_up_recommendation}</p>
              </div>
            )}
            {finalData.next_session_recommendation && (
              <div>
                <div className="font-medium">Next session</div>
                <p className="text-[#5C6C62] whitespace-pre-wrap">{finalData.next_session_recommendation}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <EditReasonDialog
        open={editDialog}
        busy={busy}
        onCancel={() => { setEditDialog(false); setPendingSubmit(null); }}
        onConfirm={async (reason) => {
          setEditDialog(false);
          setBusy(true);
          try {
            if (pendingSubmit) await finalizeSubmit(reason);
            else await doSave(false, reason);
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Failed to save");
          } finally {
            setBusy(false);
            setPendingSubmit(null);
          }
        }}
      />

      {treatmentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="treatment-outcome-dialog">
          <div className="bl-card p-6 max-w-md w-full space-y-4">
            <div className="font-display text-lg text-[#2D3A33]">No performed treatment recorded</div>
            <p className="text-sm text-[#5C6C62]">
              No performed treatment has been recorded. Please add the actual treatment performed before submitting.
            </p>
            <div>
              <label className="label-eyebrow block mb-2">Reason (required for no treatment performed)</label>
              <textarea
                className="bl-input min-h-[5rem] w-full"
                value={noTreatmentReason}
                onChange={(e) => setNoTreatmentReason(e.target.value)}
                placeholder="e.g. Patient cancelled procedure, consultation only"
                data-testid="no-treatment-reason"
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className="bl-btn-secondary" onClick={() => setTreatmentDialog(false)} disabled={busy}>
                Go back
              </button>
              <button type="button" className="bl-btn-primary" onClick={confirmNoTreatment} disabled={busy} data-testid="confirm-no-treatment">
                No treatment performed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default VisitStepFinalReview;
