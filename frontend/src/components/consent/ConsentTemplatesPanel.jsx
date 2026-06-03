import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Edit2, Trash2 } from "lucide-react";

const EMPTY = {
  name: "",
  treatment_id: "",
  title: "",
  body: "",
  sections: [{ heading: "Consent", content: "" }],
  validity_days: 365,
  requires_staff_signature: false,
  active: true,
};

/** Consent template manager — standalone page or embedded in Forms settings. */
export default function ConsentTemplatesPanel({ embedded = false }) {
  const { user } = useAuth();
  const canManage = hasPermission(user, "consent.manage") || ["super_admin", "manager"].includes(user?.role);

  const [templates, setTemplates] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    const [t, tr] = await Promise.all([
      api.get("/consent-templates"),
      api.get("/treatments-catalog", { params: { active_only: true } }),
    ]);
    setTemplates(t.data || []);
    setTreatments(tr.data?.items || tr.data || []);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  if (!canManage) {
    return <div className={embedded ? "text-sm text-[#5C6C62]" : "p-10 text-[#5C6C62]"}>You do not have permission to manage consent templates.</div>;
  }

  const openNew = () => {
    setEditId(null);
    setForm({ ...EMPTY, sections: [{ heading: "Consent", content: "" }] });
    setOpen(true);
  };

  const openEdit = (tpl) => {
    setEditId(tpl.id);
    setForm({
      name: tpl.name || "",
      treatment_id: tpl.treatment_id || "",
      title: tpl.title || "",
      body: tpl.body || "",
      sections: tpl.sections?.length ? tpl.sections : [{ heading: "Consent", content: tpl.body || "" }],
      validity_days: tpl.validity_days || 365,
      requires_staff_signature: Boolean(tpl.requires_staff_signature),
      active: tpl.active !== false,
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.treatment_id) {
      toast.error("Select a treatment");
      return;
    }
    const payload = {
      ...form,
      sections: form.sections.filter((s) => (s.heading || s.content || "").trim()),
    };
    try {
      if (editId) {
        await api.put(`/consent-templates/${editId}`, payload);
        toast.success("Template updated");
      } else {
        await api.post("/consent-templates", payload);
        toast.success("Template created");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const deactivate = async (id) => {
    if (!window.confirm("Deactivate this consent template?")) return;
    try {
      await api.delete(`/consent-templates/${id}`);
      toast.success("Template deactivated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not deactivate");
    }
  };

  const treatmentName = (id) => treatments.find((t) => t.id === id)?.name || "—";

  return (
    <div className={embedded ? "max-w-5xl" : "p-6 md:p-8 lg:p-10 max-w-5xl mx-auto"} data-testid="consent-templates-panel">
      {!embedded && (
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div>
            <div className="label-eyebrow">Compliance</div>
            <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Consent templates</h1>
            <p className="mt-2 text-[#5C6C62]">Treatment-based digital consent forms. Signed copies are stored as snapshots.</p>
          </div>
        </div>
      )}

      <div className={`flex items-end justify-between gap-4 flex-wrap ${embedded ? "mb-4" : ""}`}>
        {embedded && (
          <p className="text-sm text-[#5C6C62] max-w-2xl">
            Treatment-based digital consent forms. Signed copies are stored as snapshots.
          </p>
        )}
        <button type="button" onClick={openNew} className="bl-btn-primary inline-flex items-center gap-2 ml-auto" data-testid="consent-new-template">
          <Plus className="w-4 h-4" /> New template
        </button>
      </div>

      <div className={`${embedded ? "" : "mt-8"} bl-card overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Treatment</th>
              <th className="px-5 py-3">Version</th>
              <th className="px-5 py-3">Staff sig</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-[#5C6C62]">No templates yet</td></tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-[#EAE6D7]">
                <td className="px-5 py-3 font-medium">{t.name}</td>
                <td className="px-5 py-3">{t.treatment_name_snapshot || treatmentName(t.treatment_id)}</td>
                <td className="px-5 py-3">v{t.version || 1}</td>
                <td className="px-5 py-3">{t.requires_staff_signature ? "Yes" : "No"}</td>
                <td className="px-5 py-3"><span className="bl-chip">{t.active !== false ? "Active" : "Inactive"}</span></td>
                <td className="px-5 py-3 text-right space-x-2">
                  <button type="button" onClick={() => openEdit(t)} className="text-[#5C6C62] hover:text-[#2D3A33]"><Edit2 className="w-4 h-4 inline" /></button>
                  {t.active !== false && (
                    <button type="button" onClick={() => deactivate(t.id)} className="text-[#B14A2C]"><Trash2 className="w-4 h-4 inline" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="bl-card max-w-lg w-full p-7 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl text-[#2D3A33]">{editId ? "Edit template" : "New template"}</h2>
            <form onSubmit={save} className="mt-5 space-y-4">
              <div>
                <label className="label-eyebrow block mb-1">Template name</label>
                <input className="bl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Treatment</label>
                <select className="bl-input" value={form.treatment_id} onChange={(e) => setForm({ ...form, treatment_id: e.target.value })} required>
                  <option value="">Select treatment…</option>
                  {treatments.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Form title</label>
                <input className="bl-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.name || "Consent title"} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Body text</label>
                <textarea className="bl-input min-h-[120px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Full consent language…" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Section heading</label>
                <input
                  className="bl-input mb-2"
                  value={form.sections[0]?.heading || ""}
                  onChange={(e) => setForm({
                    ...form,
                    sections: [{ ...form.sections[0], heading: e.target.value, content: form.sections[0]?.content || form.body }],
                  })}
                />
                <textarea
                  className="bl-input min-h-[80px]"
                  value={form.sections[0]?.content || ""}
                  onChange={(e) => setForm({
                    ...form,
                    sections: [{ ...form.sections[0], content: e.target.value }],
                  })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1">Valid days after sign</label>
                  <input type="number" className="bl-input" min={1} value={form.validity_days || ""} onChange={(e) => setForm({ ...form, validity_days: Number(e.target.value) || null })} />
                </div>
                <label className="flex items-center gap-2 text-sm mt-6">
                  <input type="checkbox" checked={form.requires_staff_signature} onChange={(e) => setForm({ ...form, requires_staff_signature: e.target.checked })} />
                  Require staff signature
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary">Save template</button>
                <button type="button" onClick={() => setOpen(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
