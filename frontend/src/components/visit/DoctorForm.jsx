import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import SignaturePad from "@/components/SignaturePad";
import ClinicalNoteGuidance from "@/components/visit/ClinicalNoteGuidance";
import NoteTemplatePicker from "@/components/visit/NoteTemplatePicker";
import FollowUpFields from "@/components/visit/FollowUpFields";
import EditReasonDialog from "@/components/visit/EditReasonDialog";
import PerformerNotesPanel from "@/components/visit/PerformerNotesPanel";
import {
  recordNoteStatus,
  canEditClinicalNote,
  requiresEditReason,
  templatesForRole,
  applyTemplateFields,
} from "@/lib/clinicalNotes";

const DoctorForm = forwardRef(function DoctorForm({ visit, onSaved, workflowMode = false }, ref) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const FACE_SECTIONS = settings?.form_config?.face_sections || [];
  const templates = templatesForRole(settings?.form_config?.note_templates, "doctor", visit.visit_type);
  const record = visit.clinical_record;
  const status = recordNoteStatus(record, visit);
  const canOverride = user?.role === "super_admin" || user?.platform_admin;
  const editable = can(user, "edit_clinical") && (canEditClinicalNote(user, visit, record) || canOverride);
  const [data, setData] = useState({
    anamnesis: "", diagnosis: "", treatment_plan: "", therapy_notes: "",
    assessment: {},
    doctor_notes: "", follow_up_recommendation: "", next_session_recommendation: "",
    signature: "",
  });
  const [busy, setBusy] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(null);

  useEffect(() => {
    if (record) setData((d) => ({ ...d, ...record }));
  }, [record]);

  const setOpt = (sectionKey, subKey, val) => {
    setData((d) => ({
      ...d,
      assessment: {
        ...d.assessment,
        [sectionKey]: { ...(d.assessment?.[sectionKey] || {}), [subKey]: val },
      },
    }));
  };

  const buildPayload = (source, merge = {}) => {
    const merged = { ...source, ...merge };
    const { product_used: _pu, dosage: _d, area_treated: _at, ...clinicalPayload } = merged;
    return clinicalPayload;
  };

  const doSave = async (submit, editReason, merge = {}) => {
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/clinical`, {
        ...buildPayload(data, merge),
        submit,
        edit_reason: editReason || undefined,
      });
      toast.success(submit ? "Clinical record submitted" : "Saved");
      onSaved?.();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to save";
      if (detail.includes("Edit reason") && canOverride) {
        setPendingSubmit(submit);
        setEditDialog(true);
      } else {
        toast.error(detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const save = (submit) => {
    if (requiresEditReason(user, visit, record) && canOverride) {
      setPendingSubmit(submit);
      setEditDialog(true);
      return;
    }
    doSave(submit);
  };

  const applyTemplate = (t) => {
    setData((d) => applyTemplateFields(d, t.fields));
    toast.success(`Applied template: ${t.name}`);
  };

  useImperativeHandle(ref, () => ({
    saveDraft: (merge) => {
      if (requiresEditReason(user, visit, record) && canOverride) {
        setPendingSubmit(false);
        setEditDialog(true);
        return;
      }
      doSave(false, undefined, merge);
    },
    submitLock: (merge) => {
      if (requiresEditReason(user, visit, record) && canOverride) {
        setPendingSubmit(true);
        setEditDialog(true);
        return;
      }
      doSave(true, undefined, merge);
    },
    getData: () => data,
    isBusy: () => busy,
  }), [data, busy, user, visit, record]);

  return (
    <div className="space-y-7">
      {editable && templates.length > 0 && (
        <NoteTemplatePicker templates={templates} disabled={busy} onApply={applyTemplate} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Anamnesis</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[110px]" value={data.anamnesis} onChange={(e)=>setData({...data, anamnesis:e.target.value})} data-testid="doctor-anamnesis" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Diagnosis</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[110px]" value={data.diagnosis} onChange={(e)=>setData({...data, diagnosis:e.target.value})} data-testid="doctor-diagnosis" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Treatment Plan / Terapi</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[100px]" value={data.treatment_plan} onChange={(e)=>setData({...data, treatment_plan:e.target.value})} data-testid="doctor-treatment-plan" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Therapy Notes</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[100px]" value={data.therapy_notes} onChange={(e)=>setData({...data, therapy_notes:e.target.value})} data-testid="doctor-therapy-notes" />
        </div>
      </div>

      <div>
        <div className="label-eyebrow mb-3">Facial Assessment</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {FACE_SECTIONS.map((sec) => (
            <div key={sec.key} className="bl-card p-4">
              <div className="font-display text-base text-[#2D3A33]">{sec.label}</div>
              <div className="mt-3 space-y-2.5">
                {sec.subs.map((sub) => {
                  const cur = data.assessment?.[sec.key]?.[sub.key];
                  return (
                    <div key={sub.key}>
                      {sub.label && <div className="text-[11px] uppercase tracking-widest text-[#5C6C62] mb-1.5">{sub.label}</div>}
                      <div className="flex flex-wrap gap-1.5">
                        {sub.options.map((op) => (
                          <button
                            type="button"
                            key={op}
                            disabled={!editable || busy}
                            onClick={() => setOpt(sec.key, sub.key, op)}
                            className={`text-xs px-3 py-1.5 rounded-full border transition ${cur === op ? "text-white" : "bg-white text-[#5C6C62] border-[#EAE6D7] hover:border-[#8A9A86]"}`}
                            style={cur === op ? { background: "var(--bl-primary)", borderColor: "var(--bl-primary)" } : undefined}
                            data-testid={`doctor-${sec.key}-${sub.key}-${op.toLowerCase().replace(/[^a-z]/g,"")}`}
                          >
                            {op}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="label-eyebrow block mb-2">Doctor notes</label>
        <textarea disabled={!editable || busy} className="bl-input min-h-[80px]" value={data.doctor_notes} onChange={(e)=>setData({...data, doctor_notes:e.target.value})} data-testid="doctor-notes" />
      </div>

      {!workflowMode && (
        <>
          <FollowUpFields data={data} setData={setData} editable={editable && !busy} prefix="doctor-" />
          <div>
            <label className="label-eyebrow block mb-2">Doctor signature (TTD Dokter)</label>
            <SignaturePad value={data.signature} onChange={(s) => editable && setData({...data, signature: s})} testid="doctor-signature" />
          </div>
        </>
      )}

      <ClinicalNoteGuidance
        status={status}
        record={record}
        roleLabel="Doctor"
        editable={editable}
        busy={busy}
        hideActions={workflowMode}
        onSaveDraft={() => save(false)}
        onSubmitLock={() => save(true)}
      />

      {!workflowMode && <PerformerNotesPanel visit={visit} onSaved={onSaved} />}

      <EditReasonDialog
        open={editDialog}
        busy={busy}
        onCancel={() => { setEditDialog(false); setPendingSubmit(null); }}
        onConfirm={(reason) => {
          setEditDialog(false);
          doSave(pendingSubmit ?? false, reason);
          setPendingSubmit(null);
        }}
      />
    </div>
  );
});

export default DoctorForm;
