import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import SignaturePad from "@/components/SignaturePad";

const CONTRAINDICATIONS = [
  "Pregnancy",
  "Breastfeeding",
  "Active skin infection",
  "Recent surgery",
  "Pacemaker / metal implant",
  "Keloid history",
  "Photosensitivity",
  "Active acne flare",
  "Anti-coagulant medication",
  "Open wound in treatment area",
];

const DEVICES = [
  "RF (Radio Frequency)",
  "HIFU",
  "Cryolipolysis",
  "Laser CO2",
  "IPL",
  "Microneedling",
  "Ultrasound",
  "Cavitation",
  "EMS",
  "LED Light",
  "Manual / Hands-on",
  "Other",
];

export default function TherapistForm({ visit, onSaved }) {
  const { user } = useAuth();
  const editable = can(user, "edit_therapist") && !(visit.therapist_record?.submitted);
  const [data, setData] = useState({
    concern_notes: "", body_concern: "", treatment_area: "",
    contraindication: [], device_used: "", treatment_parameter: "",
    intensity: "", duration: "", area_treated: "", therapist_notes: "", signature: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visit.therapist_record) setData((d) => ({ ...d, ...visit.therapist_record, contraindication: visit.therapist_record.contraindication || [] }));
  }, [visit.therapist_record?.updated_at]);

  const toggleC = (c) => {
    if (!editable) return;
    setData((d) => ({
      ...d,
      contraindication: d.contraindication.includes(c) ? d.contraindication.filter(x => x !== c) : [...d.contraindication, c],
    }));
  };

  const save = async (submit = false) => {
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/therapist`, { ...data, submit });
      toast.success(submit ? "Treatment record submitted" : "Saved");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-7">
      {visit.therapist_record?.submitted && (
        <div className="bl-chip success">Submitted on {new Date(visit.therapist_record.submitted_at).toLocaleString()} · By {visit.therapist_record.therapist_name}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Concern notes / Anamnesis</label>
          <textarea disabled={!editable} className="bl-input min-h-[110px]" value={data.concern_notes} onChange={(e)=>setData({...data, concern_notes:e.target.value})} data-testid="therapist-concern" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Body concern / Diagnosis</label>
          <textarea disabled={!editable} className="bl-input min-h-[110px]" value={data.body_concern} onChange={(e)=>setData({...data, body_concern:e.target.value})} data-testid="therapist-body-concern" />
        </div>
      </div>

      {/* Contraindication checklist */}
      <div className="bl-card p-5">
        <div className="font-display text-base text-[#2D3A33]">Contraindication checklist</div>
        <p className="text-sm text-[#5C6C62] mt-1">Tick all that apply before proceeding.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CONTRAINDICATIONS.map((c) => {
            const on = data.contraindication.includes(c);
            return (
              <label key={c} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${on ? "bg-[#FBE7DF] border-[#F1C9B7]" : "bg-white border-[#EAE6D7] hover:bg-[#FBF8EF]"}`}>
                <input type="checkbox" checked={on} disabled={!editable} onChange={()=>toggleC(c)} className="rounded" data-testid={`contraindication-${c.toLowerCase().replace(/[^a-z]/g,"")}`} />
                <span className="text-sm text-[#2D3A33]">{c}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Treatment area</label>
          <input disabled={!editable} className="bl-input" value={data.treatment_area} onChange={(e)=>setData({...data, treatment_area:e.target.value})} data-testid="therapist-treatment-area" placeholder="e.g. Abdomen, Back, Thighs" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Device / Machine used</label>
          <select disabled={!editable} className="bl-input" value={data.device_used} onChange={(e)=>setData({...data, device_used:e.target.value})} data-testid="therapist-device">
            <option value="">— Select device —</option>
            {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Area treated</label>
          <input disabled={!editable} className="bl-input" value={data.area_treated} onChange={(e)=>setData({...data, area_treated:e.target.value})} data-testid="therapist-area-treated" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="label-eyebrow block mb-2">Treatment parameter</label>
          <input disabled={!editable} className="bl-input" value={data.treatment_parameter} onChange={(e)=>setData({...data, treatment_parameter:e.target.value})} data-testid="therapist-parameter" placeholder="e.g. 3 MHz, 30 J/cm²" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Intensity / Level</label>
          <input disabled={!editable} className="bl-input" value={data.intensity} onChange={(e)=>setData({...data, intensity:e.target.value})} data-testid="therapist-intensity" placeholder="e.g. Level 4" />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">Duration</label>
          <input disabled={!editable} className="bl-input" value={data.duration} onChange={(e)=>setData({...data, duration:e.target.value})} data-testid="therapist-duration" placeholder="e.g. 30 min" />
        </div>
      </div>

      <div>
        <label className="label-eyebrow block mb-2">Therapist notes</label>
        <textarea disabled={!editable} className="bl-input min-h-[80px]" value={data.therapist_notes} onChange={(e)=>setData({...data, therapist_notes:e.target.value})} data-testid="therapist-notes" />
      </div>

      <div>
        <label className="label-eyebrow block mb-2">Therapist signature (TTD)</label>
        <SignaturePad value={data.signature} onChange={(s) => editable && setData({...data, signature: s})} testid="therapist-signature" />
      </div>

      {editable && (
        <div className="flex gap-3 pt-2 sticky bottom-0 bg-[#FDFBF7] py-3 border-t border-[#EAE6D7]">
          <button onClick={()=>save(false)} className="bl-btn-ghost" disabled={busy} data-testid="therapist-save">Save draft</button>
          <button onClick={()=>save(true)} className="bl-btn-primary" disabled={busy} data-testid="therapist-submit">Submit & lock</button>
        </div>
      )}
    </div>
  );
}
