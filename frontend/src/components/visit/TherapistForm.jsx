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
import { recordNoteStatus,
  canEditClinicalNote,
  requiresEditReason,
  templatesForRole,
  applyTemplateFields,
} from "@/lib/clinicalNotes";

const TherapistForm = forwardRef(function TherapistForm({ visit, onSaved, noteRole = "therapist", workflowMode = false }, ref) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const CONTRAINDICATIONS = settings?.form_config?.contraindications || [];
  const DEVICES = settings?.form_config?.devices || [];
  const roleLabel = noteRole === "nurse" ? "Nurse" : "Therapist";
  const templates = templatesForRole(settings?.form_config?.note_templates, noteRole, visit.visit_type);
  const record = visit.therapist_record;
  const status = recordNoteStatus(record, visit);
  const canOverride = user?.role === "super_admin" || user?.platform_admin;
  const canEditThisTab =
    canOverride
    || ["fo", "manager"].includes(user?.role)
    || user?.role === noteRole;
  const editable =
    canEditThisTab
    && (can(user, "edit_therapist") || user?.role === "nurse")
    && (canEditClinicalNote(user, visit, record) || canOverride);
  const [data, setData] = useState({
    concern_notes: "", body_concern: "", treatment_area: "",
    contraindication: [], device_used: "", treatment_parameter: "",
    intensity: "", duration: "", area_treated: "", therapist_notes: "",
    follow_up_recommendation: "", next_session_recommendation: "", signature: "",
  });
  const [busy, setBusy] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(null);

  useEffect(() => {
    if (record) {
      setData((d) => ({
        ...d,
        ...record,
        contraindication: record.contraindication || [],
      }));
    }
  }, [record]);

  const toggleC = (c) => {
    if (!editable || busy) return;
    setData((d) => ({
      ...d,
      contraindication: d.contraindication.includes(c) ? d.contraindication.filter(x => x !== c) : [...d.contraindication, c],
    }));
  };

  const doSave = async (submit, editReason, merge = {}) => {
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/therapist`, { ...data, ...merge, submit, edit_reason: editReason || undefined });
      toast.success(submit ? "Treatment record submitted" : "Saved");
      onSaved?.();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed";
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
      <p className="text-sm text-[#5C6C62] bl-card p-4 bg-[#F8F5EC] border-[#EAE6D7]">
        {noteRole === "nurse"
          ? "Document nurse notes for this visit. Assistant performers add separate notes in the section below."
          : "Document therapist assessment, contraindication checklist, and treatment details for this visit. Assistant performers add separate notes in the section below."}
      </p>

      {editable && templates.length > 0 && (
        <NoteTemplatePicker templates={templates} disabled={busy} onApply={applyTemplate} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Concern notes / Anamnesis</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[110px]" value={data.concern_notes} onChange={(e)=>setData({...data, concern_notes:e.target.value})} data-testid="therapist-concern" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Body concern / Diagnosis</label>
          <textarea disabled={!editable || busy} className="bl-input min-h-[110px]" value={data.body_concern} onChange={(e)=>setData({...data, body_concern:e.target.value})} data-testid="therapist-body-concern" />
        </div>
      </div>

      <div className="bl-card p-5">
        <div className="font-display text-base text-[#2D3A33]">Contraindication checklist</div>
        <p className="text-sm text-[#5C6C62] mt-1">Tick all that apply before proceeding.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CONTRAINDICATIONS.map((c) => {
            const on = data.contraindication.includes(c);
            return (
              <label key={c} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${on ? "bg-[#FBE7DF] border-[#F1C9B7]" : "bg-white border-[#EAE6D7] hover:bg-[#FBF8EF]"}`}>
                <input type="checkbox" checked={on} disabled={!editable || busy} onChange={()=>toggleC(c)} className="rounded" data-testid={`contraindication-${c.toLowerCase().replace(/[^a-z]/g,"")}`} />
                <span className="text-sm text-[#2D3A33]">{c}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Treatment area</label>
          <input disabled={!editable || busy} className="bl-input" value={data.treatment_area} onChange={(e)=>setData({...data, treatment_area:e.target.value})} data-testid="therapist-treatment-area" placeholder="e.g. Abdomen, Back, Thighs" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Device / Machine used</label>
          <select disabled={!editable || busy} className="bl-input" value={data.device_used} onChange={(e)=>setData({...data, device_used:e.target.value})} data-testid="therapist-device">
            <option value="">— Select device —</option>
            {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Area treated</label>
          <input disabled={!editable || busy} className="bl-input" value={data.area_treated} onChange={(e)=>setData({...data, area_treated:e.target.value})} data-testid="therapist-area-treated" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Treatment parameter</label>
          <input disabled={!editable || busy} className="bl-input" value={data.treatment_parameter} onChange={(e)=>setData({...data, treatment_parameter:e.target.value})} data-testid="therapist-parameter" placeholder="e.g. 3 MHz, 30 J/cm²" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Intensity / Level</label>
          <input disabled={!editable || busy} className="bl-input" value={data.intensity} onChange={(e)=>setData({...data, intensity:e.target.value})} data-testid="therapist-intensity" placeholder="e.g. Level 4" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Duration</label>
          <input disabled={!editable || busy} className="bl-input" value={data.duration} onChange={(e)=>setData({...data, duration:e.target.value})} data-testid="therapist-duration" placeholder="e.g. 30 min" />
        </div>
      </div>

      <div>
        <label className="label-eyebrow block mb-2">{user?.role === "nurse" ? "Nurse notes" : "Therapist notes"}</label>
        <textarea disabled={!editable || busy} className="bl-input min-h-[80px]" value={data.therapist_notes} onChange={(e)=>setData({...data, therapist_notes:e.target.value})} data-testid="therapist-notes" />
      </div>

      {!workflowMode && (
        <>
          <FollowUpFields data={data} setData={setData} editable={editable && !busy} prefix="therapist-" />
          <div>
            <label className="label-eyebrow block mb-2">Signature (TTD)</label>
            <SignaturePad value={data.signature} onChange={(s) => editable && setData({...data, signature: s})} testid="therapist-signature" />
          </div>
        </>
      )}

      <ClinicalNoteGuidance
        status={status}
        record={record}
        roleLabel={roleLabel}
        editable={editable}
        busy={busy}
        hideActions={workflowMode}
        onSaveDraft={() => save(false)}
        onSubmitLock={() => save(true)}
      />

      {!workflowMode && <PerformerNotesPanel visit={visit} onSaved={onSaved} roleFilter={noteRole} />}

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

export default TherapistForm;
