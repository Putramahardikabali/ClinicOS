import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, can } from "@/lib/auth";
import { toast } from "sonner";
import { ArrowLeft, Plus, Calendar, Image as ImageIcon, Wallet, Receipt, TrendingUp } from "lucide-react";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function PatientDetailPage() {
  const { pid } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [patient, setPatient] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [openVisit, setOpenVisit] = useState(false);
  const [vForm, setVForm] = useState({ visit_type:"doctor", assigned_to:"", chief_complaint:"" });

  const load = async () => {
    const [p, t, u, s, tx] = await Promise.all([
      api.get(`/patients/${pid}`),
      api.get(`/patients/${pid}/timeline`),
      api.get(`/users`).catch(()=>({data:[]})),
      api.get(`/patients/${pid}/stats`).catch(()=>({data:null})),
      api.get(`/patients/${pid}/transactions`).catch(()=>({data:[]})),
    ]);
    setPatient(p.data); setTimeline(t.data); setUsers(u.data);
    setStats(s.data); setTransactions(tx.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [pid]);

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
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
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
                      <span className={`bl-chip ${v.status === "completed" ? "success" : "info"}`}>{v.status.replace("_"," ")}</span>
                    </div>
                    <div className="mt-1 text-sm text-[#5C6C62] line-clamp-2">
                      {v.clinical_record?.diagnosis || v.therapist_record?.body_concern || v.chief_complaint || "—"}
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-[#5C6C62]">
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3"/>{new Date(v.visit_date || v.created_at).toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-1"><ImageIcon className="w-3 h-3"/>{v.photo_count || 0} photos</span>
                    </div>
                  </div>
                  <Link to={`/visits/${v.id}`} className="bl-btn-ghost text-sm shrink-0" data-testid={`open-visit-${v.id}`}>Open visit</Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          {stats && (
            <div className="bl-card p-5" data-testid="patient-spend-summary">
              <div className="label-eyebrow mb-3 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Lifetime spend</div>
              <div className="font-display text-3xl text-[#2D3A33]" data-testid="patient-total-spent">{fmtIDR(stats.total_spent_idr)}</div>
              <div className="mt-1 text-xs text-[#5C6C62]">
                {stats.visits_total} visit{stats.visits_total !== 1 ? "s" : ""} · avg {fmtIDR(stats.avg_per_visit_idr)}/visit
              </div>
              <div className="mt-3 pt-3 border-t border-[#EAE6D7] grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[#5C6C62]">Items billed</div>
                  <div className="font-medium text-[#2D3A33] mt-0.5">{stats.treatment_items_total}</div>
                </div>
                <div>
                  <div className="text-[#5C6C62]">Last visit</div>
                  <div className="font-medium text-[#2D3A33] mt-0.5">{stats.last_visit_at ? new Date(stats.last_visit_at).toLocaleDateString() : "—"}</div>
                </div>
              </div>
            </div>
          )}

          <div className="bl-card p-5">
            <div className="label-eyebrow mb-3">Patient info</div>
            <div className="space-y-2 text-sm">
              <div><span className="text-[#5C6C62]">DOB</span><div className="font-medium">{patient.date_of_birth || patient.dob || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Address</span><div className="font-medium">{patient.address || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Allergies</span><div className="font-medium">{patient.allergies || "—"}</div></div>
              <div><span className="text-[#5C6C62]">Medical history</span><div className="font-medium whitespace-pre-wrap">{patient.medical_history || "—"}</div></div>
            </div>
          </div>
        </aside>
      </div>

      {/* Transactions list */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="label-eyebrow flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /> Transactions</div>
            <h2 className="font-display text-2xl text-[#2D3A33] mt-1">Treatment history</h2>
          </div>
        </div>
        <div className="bl-card overflow-hidden" data-testid="patient-transactions">
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-[#5C6C62] text-sm">No transactions recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Visit</th>
                    <th className="px-5 py-3">Items</th>
                    <th className="px-5 py-3 text-right">Subtotal</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.visit_id} className="border-t border-[#EAE6D7]" data-testid={`tx-row-${t.visit_id}`}>
                      <td className="px-5 py-3 text-sm text-[#2D3A33] whitespace-nowrap">{new Date(t.visit_date).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-sm">
                        <span className="capitalize text-[#2D3A33]">{t.visit_type}</span>
                        <span className={`ml-2 bl-chip ${t.status === "completed" ? "success" : "info"}`}>{t.status.replace("_", " ")}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#5C6C62]">
                        <ul className="space-y-0.5">
                          {t.items.map((it, i) => (
                            <li key={i}>· {it.name} <span className="text-[10px] uppercase tracking-wider text-[#A89F8B] ml-1">{it.category}</span></li>
                          ))}
                          {t.items.length === 0 && <span className="italic text-[#A89F8B]">no items</span>}
                        </ul>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-[#2D3A33]">{fmtIDR(t.subtotal_idr)}</td>
                      <td className="px-5 py-3 text-right"><Link to={`/visits/${t.visit_id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Open →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
