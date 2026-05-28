import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, Clock, Layers, Users as UsersIcon, Banknote } from "lucide-react";

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

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function EditorModal({ initial, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(initial || { name: "", category: "facial", duration_min: 30, price_idr: 0, slots_per_session: 1, active: true, description: "" });
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
            <div>
              <label className="label-eyebrow block mb-1.5">Category</label>
              <select className="bl-input" value={form.category} onChange={e => setForm({...form, category: e.target.value})} data-testid="treatment-category">
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
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

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="treatments-grid">
        {filtered.length === 0 && <div className="col-span-full text-center text-[#5C6C62] py-12">No treatments in this category yet.</div>}
        {filtered.map(t => {
          const cc = CAT_COLORS[t.category] || CAT_COLORS.general;
          return (
            <div key={t.id} className="bl-card p-5 flex flex-col" data-testid={`treatment-card-${t.id}`} style={{ opacity: t.active ? 1 : 0.6 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="bl-chip" style={{ background: cc.bg, color: cc.fg, borderColor: "transparent" }}>{(CATEGORIES.find(c => c.key === t.category)?.label) || t.category}</span>
                  <h3 className="font-display text-xl text-[#2D3A33] mt-2">{t.name}</h3>
                  {t.description && <p className="text-sm text-[#5C6C62] mt-1 line-clamp-2">{t.description}</p>}
                </div>
                {canManage && (
                  <button onClick={() => toggleActive(t)} className="p-2 rounded-lg hover:bg-[#F3F1EB]" title={t.active ? "Active" : "Hidden"} data-testid={`treatment-toggle-${t.id}`}>
                    {t.active ? <ToggleRight className="w-5 h-5" style={{ color: "var(--bl-primary)" }} /> : <ToggleLeft className="w-5 h-5 text-[#A89F8B]" />}
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col items-center bg-[#F8F5EC] rounded-lg py-2">
                  <Clock className="w-3.5 h-3.5 text-[#5C6C62]" /><span className="mt-1 font-medium text-[#2D3A33]">{t.duration_min}m</span>
                </div>
                <div className="flex flex-col items-center bg-[#F8F5EC] rounded-lg py-2">
                  <UsersIcon className="w-3.5 h-3.5 text-[#5C6C62]" /><span className="mt-1 font-medium text-[#2D3A33]">{t.slots_per_session}×</span>
                </div>
                <div className="flex flex-col items-center bg-[#F8F5EC] rounded-lg py-2">
                  <Banknote className="w-3.5 h-3.5 text-[#5C6C62]" /><span className="mt-1 font-medium text-[#2D3A33] text-[11px]">{Math.round(t.price_idr / 1000)}k</span>
                </div>
              </div>

              <div className="mt-3 font-mono text-sm text-[#5C6C62]">{fmtIDR(t.price_idr)}</div>

              {canManage && (
                <div className="mt-4 pt-3 border-t border-[#EAE6D7] flex gap-2">
                  <button onClick={() => setEditing(t)} className="flex-1 text-xs px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1.5 hover:bg-[#F3F1EB]" data-testid={`treatment-edit-${t.id}`}>
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => remove(t)} className="text-xs px-3 py-2 rounded-lg text-[#B14A2C] hover:bg-[#FAE5DC]" data-testid={`treatment-delete-${t.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing !== null && <EditorModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
