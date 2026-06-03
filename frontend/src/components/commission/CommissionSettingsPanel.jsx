import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Trash2, Power } from "lucide-react";

const ITEM_TYPES = [
  { value: "all", label: "All item types" },
  { value: "treatment", label: "Treatment" },
  { value: "package", label: "Package" },
  { value: "product", label: "Product" },
  { value: "custom", label: "Custom" },
];

const ROLE_LABELS = { doctor: "Doctor", therapist: "Therapist", nurse: "Nurse" };
const BASIS_LABELS = { paid: "net paid amount", net: "net amount", gross: "gross amount" };
const TRIGGER_LABELS = {
  invoice_paid: "Invoice paid",
  visit_completed: "Visit completed",
  both: "Invoice paid + visit completed",
  manual: "Manual only",
};

const emptyForm = () => ({
  rule_name: "",
  is_active: true,
  priority: 0,
  applies_to_role: "",
  applies_to_staff: "",
  applies_to_treatment: "",
  applies_to_category: "",
  applies_to_item_type: "all",
  commission_type: "percentage",
  commission_value: 10,
  calculation_basis: "paid",
  trigger: "invoice_paid",
  start_date: "",
  end_date: "",
  exclude_discounted_items: false,
  exclude_package_items: false,
  requires_approval: true,
  notes: "",
});

function buildRulePreview(form, staff, treatments) {
  const matchParts = [];
  if (form.applies_to_staff) {
    const s = staff.find((x) => x.id === form.applies_to_staff);
    matchParts.push(s ? s.name : "Selected staff");
  } else if (form.applies_to_role) {
    matchParts.push(ROLE_LABELS[form.applies_to_role] || form.applies_to_role);
  }
  const itemType = ITEM_TYPES.find((o) => o.value === form.applies_to_item_type);
  if (itemType && itemType.value !== "all") matchParts.push(`${itemType.label} items`);
  else matchParts.push("Any item type");
  if (form.applies_to_treatment) {
    const t = treatments.find((x) => (x.id || x.key) === form.applies_to_treatment);
    matchParts.push(t ? t.name : "Specific treatment");
  } else if (form.applies_to_category) {
    matchParts.push(form.applies_to_category);
  } else if (!form.applies_to_staff && !form.applies_to_role) {
    matchParts.push("Any treatment");
  }

  let commissionLine = "No commission";
  if (form.commission_type === "percentage") {
    commissionLine = `${form.commission_value || 0}% of ${BASIS_LABELS[form.calculation_basis] || form.calculation_basis}`;
  } else if (form.commission_type === "fixed_amount") {
    commissionLine = `Rp ${Number(form.commission_value || 0).toLocaleString("id-ID")} fixed per match`;
  }

  return {
    applies: matchParts.filter(Boolean).join(" · ") || "All performers · Any item",
    commission: commissionLine,
    trigger: TRIGGER_LABELS[form.trigger] || form.trigger,
    active: form.is_active !== false,
  };
}

function FormSection({ title, children }) {
  return (
    <div className="space-y-3 pt-1 border-t border-[#EAE6D7] first:border-0 first:pt-0">
      <div className="label-eyebrow text-[#5C6C62]">{title}</div>
      {children}
    </div>
  );
}

export default function CommissionSettingsPanel() {
  const [rules, setRules] = useState([]);
  const [staff, setStaff] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    const [r, u, t] = await Promise.all([
      api.get("/commission-rules"),
      api.get("/users"),
      api.get("/treatments-catalog"),
    ]);
    setRules(r.data || []);
    setStaff((u.data || []).filter((x) => ["doctor", "therapist", "nurse"].includes(x.role)));
    const items = t.data?.items || t.data || [];
    setTreatments(items);
    const cats = [...new Set(items.map((x) => x.category).filter(Boolean))].sort();
    setCategories(cats);
  }, []);

  useEffect(() => { load().catch(() => toast.error("Could not load commission rules")); }, [load]);

  const preview = useMemo(() => buildRulePreview(form, staff, treatments), [form, staff, treatments]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const startEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      rule_name: rule.rule_name || "",
      is_active: rule.is_active !== false,
      priority: rule.priority || 0,
      applies_to_role: rule.applies_to_role || "",
      applies_to_staff: rule.applies_to_staff || "",
      applies_to_treatment: rule.applies_to_treatment || "",
      applies_to_category: rule.applies_to_category || "",
      applies_to_item_type: rule.applies_to_item_type || "all",
      commission_type: rule.commission_type || "percentage",
      commission_value: rule.commission_value || 0,
      calculation_basis: rule.calculation_basis || "paid",
      trigger: rule.trigger || "invoice_paid",
      start_date: rule.start_date || "",
      end_date: rule.end_date || "",
      exclude_discounted_items: !!rule.exclude_discounted_items,
      exclude_package_items: !!rule.exclude_package_items,
      requires_approval: rule.requires_approval !== false,
      notes: rule.notes || "",
    });
  };

  const payloadFromForm = () => ({
    ...form,
    priority: Number(form.priority) || 0,
    commission_value: Number(form.commission_value) || 0,
    applies_to_role: form.applies_to_role || null,
    applies_to_staff: form.applies_to_staff || null,
    applies_to_treatment: form.applies_to_treatment || null,
    applies_to_category: form.applies_to_category || null,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
  });

  const save = async (e) => {
    e.preventDefault();
    if (!form.rule_name.trim()) {
      toast.error("Rule name is required");
      return;
    }
    setBusy(true);
    try {
      const body = payloadFromForm();
      if (editingId) {
        await api.put(`/commission-rules/${editingId}`, body);
        toast.success("Rule updated");
      } else {
        await api.post("/commission-rules", body);
        toast.success("Rule created");
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (rule) => {
    await api.post(`/commission-rules/${rule.id}/deactivate`);
    toast.success("Rule deactivated");
    load();
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.rule_name}"? This cannot be undone.`)) return;
    await api.delete(`/commission-rules/${rule.id}`);
    toast.success("Rule deleted");
    if (editingId === rule.id) resetForm();
    load();
  };

  return (
    <div className="space-y-6 max-w-5xl" data-testid="commission-settings-panel">
      <p className="text-sm text-[#5C6C62]">
        Create commission rules based on performer, role, treatment, category, and invoice payment status.
      </p>

      <form onSubmit={save} className="bl-card p-5 space-y-5">
        <div className="font-display text-lg text-[#2D3A33]">{editingId ? "Edit rule" : "New rule"}</div>

        <FormSection title="Rule identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label-eyebrow block mb-1">Rule name</label>
              <input className="bl-input" value={form.rule_name} onChange={(e) => setForm({ ...form, rule_name: e.target.value })} required placeholder="e.g. Therapist treatment commission" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Priority (higher wins ties)</label>
              <input type="number" className="bl-input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </div>
          </div>
        </FormSection>

        <FormSection title="Match conditions">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1">Item type</label>
              <select className="bl-input" value={form.applies_to_item_type} onChange={(e) => setForm({ ...form, applies_to_item_type: e.target.value })}>
                {ITEM_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Role (optional)</label>
              <select className="bl-input" value={form.applies_to_role} onChange={(e) => setForm({ ...form, applies_to_role: e.target.value })}>
                <option value="">Any role</option>
                <option value="doctor">Doctor</option>
                <option value="therapist">Therapist</option>
                <option value="nurse">Nurse</option>
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Staff member (optional)</label>
              <select className="bl-input" value={form.applies_to_staff} onChange={(e) => setForm({ ...form, applies_to_staff: e.target.value })}>
                <option value="">Any staff</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Treatment (optional)</label>
              <select className="bl-input" value={form.applies_to_treatment} onChange={(e) => setForm({ ...form, applies_to_treatment: e.target.value })}>
                <option value="">Any treatment</option>
                {treatments.map((t) => <option key={t.id || t.key} value={t.id || t.key}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Category (optional)</label>
              <select className="bl-input" value={form.applies_to_category} onChange={(e) => setForm({ ...form, applies_to_category: e.target.value })}>
                <option value="">Any category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </FormSection>

        <FormSection title="Commission calculation">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1">Commission type</label>
              <select className="bl-input" value={form.commission_type} onChange={(e) => setForm({ ...form, commission_type: e.target.value })}>
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed amount (IDR)</option>
                <option value="none">None</option>
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Commission value</label>
              <input type="number" min="0" className="bl-input font-mono" value={form.commission_value} onChange={(e) => setForm({ ...form, commission_value: e.target.value })} />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Calculation basis</label>
              <select className="bl-input" value={form.calculation_basis} onChange={(e) => setForm({ ...form, calculation_basis: e.target.value })}>
                <option value="paid">Net paid amount</option>
                <option value="net">Net amount</option>
                <option value="gross">Gross amount</option>
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Trigger</label>
              <select className="bl-input" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
                <option value="invoice_paid">Invoice paid</option>
                <option value="visit_completed">Visit completed</option>
                <option value="both">Invoice paid + visit completed</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm pt-1">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.exclude_discounted_items} onChange={(e) => setForm({ ...form, exclude_discounted_items: e.target.checked })} />
              Exclude discounted items
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.exclude_package_items} onChange={(e) => setForm({ ...form, exclude_package_items: e.target.checked })} />
              Exclude package items
            </label>
          </div>
        </FormSection>

        <FormSection title="Validity & status">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1">Start date (optional)</label>
              <input type="date" className="bl-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">End date (optional)</label>
              <input type="date" className="bl-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active rule
          </label>
          <div>
            <label className="label-eyebrow block mb-1">Notes</label>
            <textarea className="bl-input min-h-[72px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes for managers" />
          </div>
        </FormSection>

        <div className="rounded-xl border border-[#EAE6D7] bg-[#FDFBF7] p-4 text-sm space-y-1.5" data-testid="commission-rule-preview">
          <div className="label-eyebrow text-[#5C6C62] mb-2">Rule preview</div>
          <div><span className="text-[#5C6C62]">Applies to:</span> {preview.applies}</div>
          <div><span className="text-[#5C6C62]">Commission:</span> {preview.commission}</div>
          <div><span className="text-[#5C6C62]">Trigger:</span> {preview.trigger}</div>
          <div><span className="text-[#5C6C62]">Status:</span> {preview.active ? "Active" : "Inactive"}</div>
        </div>

        <div className="flex flex-wrap gap-2 sticky bottom-4 bg-white/95 backdrop-blur pt-2">
          <button type="submit" disabled={busy} className="bl-btn-primary disabled:opacity-50 shadow-lg">
            {editingId ? "Update rule" : "Create rule"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="bl-btn-ghost">Cancel edit</button>
          )}
        </div>
      </form>

      <div className="bl-card overflow-hidden">
        <div className="p-5 border-b border-[#EAE6D7] font-display text-lg text-[#2D3A33]">Rules</div>
        {rules.length === 0 ? (
          <p className="p-5 text-sm text-[#5C6C62]">No commission rules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[#5C6C62] border-b border-[#EAE6D7] bg-[#F8F5EC]">
                  <th className="p-3">Name</th>
                  <th className="p-3">Match</th>
                  <th className="p-3">Rate</th>
                  <th className="p-3">Trigger</th>
                  <th className="p-3">Status</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-[#EAE6D7]">
                    <td className="p-3 font-medium">{r.rule_name}</td>
                    <td className="p-3 text-[#5C6C62]">
                      {[r.applies_to_staff && "staff", r.applies_to_role && r.applies_to_role, r.applies_to_treatment && "treatment", r.applies_to_category && r.applies_to_category, r.applies_to_item_type !== "all" && r.applies_to_item_type].filter(Boolean).join(" · ") || "Global"}
                    </td>
                    <td className="p-3 font-mono">
                      {r.commission_type === "percentage" ? `${r.commission_value}%` : r.commission_type === "fixed_amount" ? `Rp ${Number(r.commission_value).toLocaleString("id-ID")}` : "None"}
                      <span className="text-[#5C6C62] text-xs block">on {r.calculation_basis}</span>
                    </td>
                    <td className="p-3">{TRIGGER_LABELS[r.trigger] || r.trigger?.replace(/_/g, " ")}</td>
                    <td className="p-3">
                      <span className={`bl-chip ${r.is_active ? "success" : "warning"}`}>{r.is_active ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <button type="button" onClick={() => startEdit(r)} className="bl-btn-ghost text-xs px-2 py-1">Edit</button>
                        {r.is_active && (
                          <button type="button" onClick={() => deactivate(r)} className="p-2 text-[#5C6C62]" title="Deactivate">
                            <Power className="w-4 h-4" />
                          </button>
                        )}
                        <button type="button" onClick={() => remove(r)} className="p-2 text-[#B14A2C]" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
