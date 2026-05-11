import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Link } from "react-router-dom";
import { useAuth, can } from "@/lib/auth";
import { toast } from "sonner";
import { Search, Plus, X } from "lucide-react";

export default function PatientsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name:"", gender:"female", date_of_birth:"", phone:"", email:"", address:"", medical_history:"", allergies:"", notes:"" });
  const [busy, setBusy] = useState(false);

  const load = (qq="") => api.get("/patients", { params: qq ? { q: qq } : {} }).then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/patients", form);
      toast.success("Patient created");
      setOpen(false);
      setForm({ full_name:"", gender:"female", date_of_birth:"", phone:"", email:"", address:"", medical_history:"", allergies:"", notes:"" });
      load(q);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Patient registry</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Patients</h1>
        </div>
        {can(user, "create_patient") && (
          <button onClick={() => setOpen(true)} className="bl-btn-primary inline-flex items-center gap-2" data-testid="new-patient-button">
            <Plus className="w-4 h-4" /> New patient
          </button>
        )}
      </div>

      <div className="mt-6 bl-card p-4 flex items-center gap-3">
        <Search className="w-4 h-4 text-[#5C6C62] ml-2" />
        <input
          className="bl-input border-0 shadow-none focus:shadow-none flex-1"
          style={{ borderColor:"transparent", boxShadow:"none" }}
          placeholder="Search by name, phone, email…"
          value={q}
          onChange={(e)=>{ setQ(e.target.value); load(e.target.value); }}
          data-testid="patients-search-input"
        />
      </div>

      {/* Mobile: card list */}
      <div className="mt-6 space-y-3 lg:hidden" data-testid="patients-cards">
        {items.length === 0 && <div className="bl-card p-8 text-center text-[#5C6C62]">No patients yet</div>}
        {items.map((p) => (
          <Link key={p.id} to={`/patients/${p.id}`} className="bl-card p-4 flex items-center gap-3 active:bg-[#FBF8EF]" data-testid={`patient-open-${p.id}`}>
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0" style={{ background: "var(--bl-primary)" }}>
              {p.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[#2D3A33] truncate">{p.full_name}</div>
              <div className="text-xs text-[#5C6C62] truncate">
                <span className="capitalize">{p.gender || "—"}</span> · {p.phone || "no phone"}
              </div>
            </div>
            <div className="text-[#5C6C62]">›</div>
          </Link>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-6 bl-card overflow-hidden hidden lg:block" data-testid="patients-table">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="bg-[#F8F5EC]">
            <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Gender</th>
              <th className="px-5 py-3">Phone</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-[#5C6C62]">No patients yet</td></tr>
            )}
            {items.map((p) => (
              <tr key={p.id} className="border-t border-[#EAE6D7] hover:bg-[#FBF8EF]">
                <td className="px-5 py-4 font-medium text-[#2D3A33]">{p.full_name}</td>
                <td className="px-5 py-4 text-[#5C6C62] capitalize">{p.gender || "—"}</td>
                <td className="px-5 py-4 text-[#5C6C62]">{p.phone || "—"}</td>
                <td className="px-5 py-4 text-[#5C6C62]">{p.email || "—"}</td>
                <td className="px-5 py-4 text-sm text-[#5C6C62]">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-4 text-right">
                  <Link to={`/patients/${p.id}`} className="text-sm text-[#8A9A86] hover:text-[#748470]" data-testid={`patient-open-${p.id}`}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="bl-card max-w-2xl w-full p-7 max-h-[90vh] overflow-y-auto" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#2D3A33]">New patient</h2>
              <button onClick={()=>setOpen(false)} className="p-2 rounded-lg hover:bg-[#F3F1EB]"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submit} className="mt-6 space-y-4" data-testid="new-patient-form">
              <div>
                <label className="label-eyebrow block mb-1">Full name</label>
                <input className="bl-input" required value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})} data-testid="patient-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Gender</label>
                  <select className="bl-input" value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Date of birth</label>
                  <input type="date" className="bl-input" value={form.date_of_birth} onChange={e=>setForm({...form,date_of_birth:e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Phone</label>
                  <input className="bl-input" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Email</label>
                  <input className="bl-input" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Address</label>
                <input className="bl-input" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Medical history</label>
                <textarea className="bl-input min-h-[80px]" value={form.medical_history} onChange={e=>setForm({...form,medical_history:e.target.value})} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Allergies</label>
                <input className="bl-input" value={form.allergies} onChange={e=>setForm({...form,allergies:e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary" disabled={busy} data-testid="patient-create-submit">{busy ? "Saving…" : "Create patient"}</button>
                <button type="button" onClick={()=>setOpen(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
