import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, can } from "@/lib/auth";
import { toast } from "sonner";
import { ArrowLeft, Plus, Calendar, ImageIcon, Receipt } from "lucide-react";

export default function PatientDetailPage() {
  const { pid } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [patient, setPatient] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [users, setUsers] = useState([]);
  const [openVisit, setOpenVisit] = useState(false);
  const [vForm, setVForm] = useState({ visit_type:"doctor", assigned_to:"", chief_complaint:"" });

  const load = async () => {
    const [p, t, u] = await Promise.all([
      api.get(`/patients/${pid}`),
      api.get(`/patients/${pid}/timeline`),
      api.get(`/users`).catch(()=>({data:[]})),
    ]);
    setPatient(p.data); setTimeline(t.data); setUsers(u.data);
  };
  useEffect(() => { load(); }, [pid]);

  const createVisit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/visits", { patient_id: pid, ...vForm });
      toast.success("Visit created");
      setOpenVisit(false);
      nav(`/visits/${r.data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  if (!patient) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  const filteredAssignees = users.filter(u => vForm.visit_type === "doctor" ? u.role === "doctor" : u.role === "therapist");

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <Link to="/patients" className="inline-flex items-center gap-2 text-sm text-[#5C6C62] hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> All patients
      </Link>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="label-eyebrow">Patient profile</div>
              <h1 className="font-display text-4xl tracking-tight font-light mt-2 text-[#2D3A33]" data-testid="patient-name">{patient.full_name}</h1>
              <p className="mt-1 text-[#5C6C62]">{patient.gender ? `${patient.gender} · ` : ""}{patient.phone || "—"}{patient.email ? ` · ${patient.email}`:""}</p>
            </div>
            {can(user, "create_visit") && (
              <button onClick={()=>setOpenVisit(true)} className="bl-btn-primary inline-flex items-center gap-2" data-testid="new-visit-button">
                <Plus className="w-4 h-4" /> New visit
              </button>
            )}
          </div>

          <div className="mt-8">
            <div className="label-eyebrow mb-4">History timeline</div>
            <div className="space-y-4" data-testid="patient-timeline">
              {timeline.length === 0 && <div className="bl-card p-6 text-center text-[#5C6C62]">No visits yet for this patient.</div>}
              {timeline.map((v) => (
                <div key={v.id} className="bl-card p-5 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#F3F1EB] flex flex-col items-center justify-center shrink-0">
                    <span className="font-display text-lg text-[#2D3A33] leading-none">{new Date(v.visit_date || v.created_at).getDate()}</span>
                    <span className="text-[10px] uppercase tracking-widest text-[#5C6C62] mt-1">{new Date(v.visit_date || v.created_at).toLocaleString("en-US",{month:"short"})}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[#2D3A33] capitalize">{v.visit_type} visit</span>
                      <span className={`bl-chip ${v.status === "submitted" ? "warning" : v.status === "billed" ? "success" : "info"}`}>{v.status.replace("_"," ")}</span>
                    </div>
                    <div className="mt-1 text-sm text-[#5C6C62] line-clamp-2">
                      {v.clinical_record?.diagnosis || v.therapist_record?.body_concern || v.chief_complaint || "—"}
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-[#5C6C62]">
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3"/>{new Date(v.visit_date || v.created_at).toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-1"><ImageIcon className="w-3 h-3"/>{v.photo_count || 0} photos</span>
                      <span className="inline-flex items-center gap-1"><Receipt className="w-3 h-3"/>{v.billing?.payment_status || "no billing"}</span>
                    </div>
                  </div>
                  <Link to={`/visits/${v.id}`} className="bl-btn-ghost text-sm shrink-0" data-testid={`open-visit-${v.id}`}>Open visit</Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bl-card p-5">
            <div className="label-eyebrow mb-3">Patient info</div>
            <div className="space-y-2 text-sm">
              <div><span className="text-[#5C6C62]">DOB</span><div className="font-medium">{patient.date_of_birth || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Address</span><div className="font-medium">{patient.address || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Allergies</span><div className="font-medium">{patient.allergies || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Medical history</span><div className="font-medium whitespace-pre-wrap">{patient.medical_history || "—"}</div></div>
            </div>
          </div>
        </aside>
      </div>

      {openVisit && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={()=>setOpenVisit(false)}>
          <div className="bl-card max-w-md w-full p-7" onClick={(e)=>e.stopPropagation()}>
            <h2 className="font-display text-2xl text-[#2D3A33]">New visit</h2>
            <p className="text-sm text-[#5C6C62] mt-1">For {patient.full_name}</p>
            <form onSubmit={createVisit} className="mt-5 space-y-4" data-testid="new-visit-form">
              <div>
                <label className="label-eyebrow block mb-1">Visit type</label>
                <select className="bl-input" value={vForm.visit_type} onChange={e=>setVForm({...vForm, visit_type: e.target.value, assigned_to:""})}>
                  <option value="doctor">Doctor (face / injectable)</option>
                  <option value="therapist">Therapist (body / laser / facial)</option>
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Assign to</label>
                <select className="bl-input" value={vForm.assigned_to} onChange={e=>setVForm({...vForm,assigned_to:e.target.value})}>
                  <option value="">Unassigned</option>
                  {filteredAssignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Chief complaint</label>
                <textarea className="bl-input min-h-[80px]" value={vForm.chief_complaint} onChange={e=>setVForm({...vForm,chief_complaint:e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary" data-testid="visit-create-submit">Create visit</button>
                <button type="button" onClick={()=>setOpenVisit(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
