import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, UserCheck, Stethoscope, Heart } from "lucide-react";

const CATEGORIES = [
  { key: "facial",     label: "Facial" },
  { key: "injectable", label: "Injectable" },
  { key: "laser",      label: "Laser" },
  { key: "peel",       label: "Peel" },
  { key: "body",       label: "Body" },
  { key: "consult",    label: "Consultation" },
  { key: "general",    label: "Other" },
];
const CAT_COLORS = {
  facial:     { bg: "#FBF3DB", fg: "#8A6D1F" },
  injectable: { bg: "#F1DDE3", fg: "#9B2C5A" },
  laser:      { bg: "#E5EEF5", fg: "#2C5A77" },
  peel:       { bg: "#EFE3F1", fg: "#6B3A8A" },
  body:       { bg: "#E3F1E8", fg: "#2C7755" },
  consult:    { bg: "#F3F1EB", fg: "#5C6C62" },
  general:    { bg: "#F3F1EB", fg: "#5C6C62" },
};

const PERFORMER_LABEL = {
  doctor: { label: "Doctor", icon: Stethoscope, color: "#2C5A77" },
  therapist: { label: "Therapist", icon: Heart, color: "#9B2C5A" },
  either: { label: "Either", icon: UserCheck, color: "#5C6C62" },
};

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function EditorModal({ initial, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(initial || { name: "", category: "facial", performer_type: "therapist", duration_min: 30, price_idr: 0, slots_per_session: 1, active: true, description: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) await api.put(`/treatments-catalog/${initial.id}`, form);
      else await api.post("/treatments-catalog", form);
      toast.success(editing ? "Treatment updated" : "Treatment added");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="treatment-editor">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl text-[#2D3A33]">{editing ? "Edit treatment" : "New treatment"}</h3>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="treatment-editor-close"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="mt-4 space-y-3" data-testid="treatment-editor-form">
            <div>
              <label className="label-eyebrow block mb-1.5">Treatment name</label>
              <input className="bl-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required data-testid="treatment-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Category</label>
                <select className="bl-input" value={form.category} onChange={e => setForm({...form, category: e.target.value})} data-testid="treatment-category">
                  {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Performed by</label>
                <select className="bl-input" value={form.performer_type} onChange={e => setForm({...form, performer_type: e.target.value})} data-testid="treatment-performer-type">
                  <option value="doctor">Doctor</option>
                  <option value="therapist">Therapist</option>
                  <option value="either">Either</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Duration (min)</label>
                <input type="number" min="5" step="5" className="bl-input" value={form.duration_min} onChange={e => setForm({...form, duration_min: Number(e.target.value)})} required data-testid="treatment-duration" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Concurrent slots</label>
                <input type="number" min="1" max="10" className="bl-input" value={form.slots_per_session} onChange={e => setForm({...form, slots_per_session: Number(e.target.value)})} data-testid="treatment-slots" />
              </div>
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Price (IDR)</label>
              <input type="number" min="0" step="50000" className="bl-input font-mono" value={form.price_idr} onChange={e => setForm({...form, price_idr: Number(e.target.value)})} required data-testid="treatment-price" />
              <div className="text-xs text-[#5C6C62] mt-1">{fmtIDR(form.price_idr)}</div>
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Description (optional)</label>
              <textarea className="bl-input min-h-[60px]" value={form.description} onChange={e => setForm({...form, description: e.target.value})} data-testid="treatment-description" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => setForm({...form, active: e.target.checked})} data-testid="treatment-active" />
              Active (visible on public booking)
            </label>
            <button type="submit" disabled={busy} className="bl-btn-primary w-full mt-3 disabled:opacity-50" data-testid="treatment-save">{busy ? "Saving…" : editing ? "Update treatment" : "Add treatment"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function TreatmentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const canManage = ["super_admin", "fo", "manager"].includes(user?.role);

  const load = () => api.get("/treatments-catalog").then(r => setRows(r.data || []));
  useEffect(() => { load(); }, []);

  const toggleActive = async (t) => {
    await api.put(`/treatments-catalog/${t.id}`, { active: !t.active });
    load();
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    await api.delete(`/treatments-catalog/${t.id}`);
    toast.success("Deleted");
    load();
  };

  const filtered = filter === "all" ? rows : rows.filter(t => t.category === filter);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="treatments-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Catalog</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Treatments</h1>
          <p className="mt-2 text-[#5C6C62]">Manage menu items shown on public booking and used inside visits. Only Owner, FO, and Manager can edit.</p>
        </div>
        {canManage && (
          <button onClick={() => setEditing({})} className="bl-btn-primary inline-flex items-center gap-2" data-testid="add-treatment-button"><Plus className="w-4 h-4" /> New treatment</button>
        )}
      </div>

      <div className="mt-6 flex gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit overflow-x-auto" data-testid="treatments-filter">
        <button onClick={() => setFilter("all")} className="px-4 py-1.5 rounded-lg text-sm" style={filter === "all" ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="filter-all">All</button>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)} className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap" style={filter === c.key ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid={`filter-${c.key}`}>{c.label}</button>
        ))}
      </div>

      <div className="mt-5 bl-card overflow-hidden" data-testid="treatments-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-5 py-3">Treatment</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Performed by</th>
                <th className="px-5 py-3 text-right">Duration</th>
                <th className="px-5 py-3 text-right">Slots</th>
                <th className="px-5 py-3 text-right">Price</th>
                <th className="px-5 py-3">Active</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-[#5C6C62] text-sm">No treatments in this category yet.</td></tr>}
              {filtered.map(t => {
                const cc = CAT_COLORS[t.category] || CAT_COLORS.general;
                const perf = PERFORMER_LABEL[t.performer_type] || PERFORMER_LABEL.therapist;
                const PerfIcon = perf.icon;
                return (
                  <tr key={t.id} className="border-t border-[#EAE6D7]" style={{ opacity: t.active ? 1 : 0.55 }} data-testid={`treatment-row-${t.id}`}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[#2D3A33]">{t.name}</div>
                      {t.description && <div className="text-xs text-[#5C6C62] mt-0.5 line-clamp-1 max-w-xs">{t.description}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="bl-chip" style={{ background: cc.bg, color: cc.fg, borderColor: "transparent" }}>
                        {(CATEGORIES.find(c => c.key === t.category)?.label) || t.category}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: perf.color }} data-testid={`treatment-performer-${t.id}`}>
                        <PerfIcon className="w-3.5 h-3.5" /> {perf.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-[#2D3A33] whitespace-nowrap">{t.duration_min} min</td>
                    <td className="px-5 py-3 text-right text-sm text-[#2D3A33]">{t.slots_per_session}×</td>
                    <td className="px-5 py-3 text-right text-sm font-medium text-[#2D3A33] whitespace-nowrap">{fmtIDR(t.price_idr)}</td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <button onClick={() => toggleActive(t)} className="inline-flex items-center" title={t.active ? "Active" : "Hidden"} data-testid={`treatment-toggle-${t.id}`}>
                          {t.active ? <ToggleRight className="w-5 h-5" style={{ color: "var(--bl-primary)" }} /> : <ToggleLeft className="w-5 h-5 text-[#A89F8B]" />}
                        </button>
                      ) : (
                        <span className={`bl-chip ${t.active ? "success" : ""}`}>{t.active ? "Yes" : "No"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {canManage && (
                        <div className="inline-flex gap-1">
                          <button onClick={() => setEditing(t)} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 hover:bg-[#F3F1EB] border border-transparent hover:border-[#EAE6D7]" data-testid={`treatment-edit-${t.id}`}>
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => remove(t)} className="text-xs p-1.5 rounded-lg text-[#B14A2C] hover:bg-[#FAE5DC]" data-testid={`treatment-delete-${t.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && <EditorModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
