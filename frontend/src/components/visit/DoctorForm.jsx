import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import SignaturePad from "@/components/SignaturePad";

export default function DoctorForm({ visit, onSaved }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const FACE_SECTIONS = settings?.form_config?.face_sections || [];
  const editable = can(user, "edit_clinical") && !(visit.clinical_record?.submitted);
  const [data, setData] = useState({
    anamnesis: "", diagnosis: "", treatment_plan: "", therapy_notes: "",
    assessment: {}, product_used: "", dosage: "", area_treated: "",
    doctor_notes: "", signature: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visit.clinical_record) setData((d) => ({ ...d, ...visit.clinical_record }));
  }, [visit.clinical_record?.updated_at]);

  const setOpt = (sectionKey, subKey, val) => {
    setData((d) => ({
      ...d,
      assessment: {
        ...d.assessment,
        [sectionKey]: { ...(d.assessment?.[sectionKey] || {}), [subKey]: val },
      },
    }));
  };

  const save = async (submit = false) => {
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/clinical`, { ...data, submit });
      toast.success(submit ? "Clinical record submitted" : "Saved");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-7">
      {visit.clinical_record?.submitted && (
        <div className="bl-chip success">Submitted on {new Date(visit.clinical_record.submitted_at).toLocaleString()} · By {visit.clinical_record.doctor_name}</div>
      )}

      {/* Free-text top */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Anamnesis</label>
          <textarea disabled={!editable} className="bl-input min-h-[110px]" value={data.anamnesis} onChange={(e)=>setData({...data, anamnesis:e.target.value})} data-testid="doctor-anamnesis" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Diagnosis</label>
          <textarea disabled={!editable} className="bl-input min-h-[110px]" value={data.diagnosis} onChange={(e)=>setData({...data, diagnosis:e.target.value})} data-testid="doctor-diagnosis" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Treatment Plan / Terapi</label>
          <textarea disabled={!editable} className="bl-input min-h-[100px]" value={data.treatment_plan} onChange={(e)=>setData({...data, treatment_plan:e.target.value})} data-testid="doctor-treatment-plan" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Therapy Notes</label>
          <textarea disabled={!editable} className="bl-input min-h-[100px]" value={data.therapy_notes} onChange={(e)=>setData({...data, therapy_notes:e.target.value})} data-testid="doctor-therapy-notes" />
        </div>
      </div>

      {/* Structured assessment */}
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
                            disabled={!editable}
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

      {/* Treatment details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Product used</label>
          <input disabled={!editable} className="bl-input" value={data.product_used} onChange={(e)=>setData({...data, product_used:e.target.value})} data-testid="doctor-product" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Dosage</label>
          <input disabled={!editable} className="bl-input" value={data.dosage} onChange={(e)=>setData({...data, dosage:e.target.value})} data-testid="doctor-dosage" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Area treated</label>
          <input disabled={!editable} className="bl-input" value={data.area_treated} onChange={(e)=>setData({...data, area_treated:e.target.value})} data-testid="doctor-area" />
        </div>
      </div>

      <div>
        <label className="label-eyebrow block mb-2">Doctor notes</label>
        <textarea disabled={!editable} className="bl-input min-h-[80px]" value={data.doctor_notes} onChange={(e)=>setData({...data, doctor_notes:e.target.value})} data-testid="doctor-notes" />
      </div>

      <div>
        <label className="label-eyebrow block mb-2">Doctor signature (TTD Dokter)</label>
        <SignaturePad value={data.signature} onChange={(s) => editable && setData({...data, signature: s})} testid="doctor-signature" />
      </div>

      {editable && (
        <div className="flex gap-3 pt-2 sticky bottom-0 bg-[#FDFBF7] py-3 border-t border-[#EAE6D7]">
          <button onClick={()=>save(false)} className="bl-btn-ghost" disabled={busy} data-testid="doctor-save">Save draft</button>
          <button onClick={()=>save(true)} className="bl-btn-primary" disabled={busy} data-testid="doctor-submit">Submit & lock</button>
        </div>
      )}
    </div>
  );
}
