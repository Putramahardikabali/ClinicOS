import { useEffect, useMemo, useState } from "react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import CampaignEligibilityFields from "@/components/campaigns/CampaignEligibilityFields";
import {
  campaignAppliesToSummary,
  campaignDateRangeLabel,
  campaignDiscountLabel,
  campaignToForm,
  emptyCampaignForm,
  formToCampaignPayload,
} from "@/lib/campaignUi";

const fmtIDRShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return "Rp " + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return "Rp " + (v / 1_000).toFixed(0) + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

function confirmAction(message, onConfirm) {
  if (window.confirm(message)) onConfirm();
}

export default function CampaignsPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const canManage = hasPermission(user, "campaigns.manage") || hasPermission(user, "coupons.manage");
  const canView = canManage || hasPermission(user, "campaigns.view");

  const [rows, setRows] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyCampaignForm);

  const categoryCounts = useMemo(() => {
    const cats = settings?.form_config?.treatment_categories || [];
    const fromSettings = cats.map((name) => ({
      id: name,
      name,
      count: treatments.filter((t) => t.category === name).length,
    }));
    const known = new Set(fromSettings.map((c) => c.id));
    treatments.forEach((t) => {
      const cat = t.category || "Other";
      if (!known.has(cat)) {
        fromSettings.push({ id: cat, name: cat, count: 1 });
        known.add(cat);
      }
    });
    return fromSettings.sort((a, b) => a.name.localeCompare(b.name));
  }, [settings, treatments]);

  const load = () => api.get("/campaigns").then((r) => setRows(r.data || [])).catch(() => setRows([]));

  useEffect(() => {
    if (!canView) return;
    load();
    api.get("/treatments-catalog").then((r) => setTreatments(r.data?.items || r.data || [])).catch(() => setTreatments([]));
    api.get("/packages-catalog").then((r) => setPackages(r.data || [])).catch(() => setPackages([]));
  }, [canView]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyCampaignForm());
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm(campaignToForm(c));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    if (!form.name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    setBusy(true);
    try {
      const body = formToCampaignPayload(form);
      if (editingId) {
        await api.put(`/campaigns/${editingId}`, body);
        toast.success("Campaign updated");
      } else {
        await api.post("/campaigns", body);
        toast.success("Campaign created");
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save campaign");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c) => {
    if (!canManage) return;
    await api.put(`/campaigns/${c.id}`, { active: !c.active });
    load();
  };

  const remove = async (c) => {
    if (!canManage) return;
    await api.delete(`/campaigns/${c.id}`);
    toast.success("Campaign deleted");
    if (editingId === c.id) resetForm();
    load();
  };

  if (!canView) {
    return (
      <div className="p-8 text-[#5C6C62]">
        You do not have permission to view campaigns.
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-6" data-testid="campaigns-page">
      <div>
        <div className="label-eyebrow">Marketing</div>
        <h1 className="font-display text-3xl text-[#2D3A33]">Campaigns</h1>
        <p className="text-sm text-[#5C6C62] mt-1">
          Promotions applied at invoice time. Staff select active campaigns when billing.
        </p>
      </div>

      {canManage && (
        <div className="bl-card p-5 space-y-5">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">{editingId ? "Edit campaign" : "New campaign"}</div>
            {!editingId && (
              <p className="text-sm text-[#5C6C62] mt-1">Create a promotion for front office to apply during checkout.</p>
            )}
          </div>

          <form onSubmit={save} className="space-y-5" data-testid="campaign-create-form">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Campaign basics</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Campaign name</label>
                  <input className="bl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="campaign-name-input" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Internal code (optional)</label>
                  <input className="bl-input font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="campaign-code-input" />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Description</label>
                <textarea className="bl-input min-h-[60px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="campaign-description-input" />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="campaign-active-toggle" />
                Active
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Start date</label>
                  <input type="date" className="bl-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} data-testid="campaign-start-date" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">End date</label>
                  <input type="date" className="bl-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} data-testid="campaign-end-date" />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-[#EAE6D7]">
              <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Discount</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Type</label>
                  <select className="bl-input" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} data-testid="campaign-type-select">
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed amount (IDR)</option>
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Value</label>
                  <input type="number" min="0" className="bl-input" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })} required data-testid="campaign-value-input" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Max discount (IDR)</label>
                  <input type="number" min="0" className="bl-input" value={form.max_discount_idr} onChange={(e) => setForm({ ...form, max_discount_idr: e.target.value })} placeholder="Optional" data-testid="campaign-max-discount-input" />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Min. invoice amount (IDR)</label>
                <input type="number" min="0" className="bl-input max-w-xs" value={form.min_invoice_amount_idr} onChange={(e) => setForm({ ...form, min_invoice_amount_idr: Number(e.target.value) })} data-testid="campaign-min-invoice-input" />
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-[#EAE6D7]">
              <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Applies to</div>
              <CampaignEligibilityFields
                form={form}
                setForm={setForm}
                treatments={treatments}
                packages={packages}
                categoryCounts={categoryCounts}
              />
            </div>

            <div className="space-y-3 pt-2 border-t border-[#EAE6D7]">
              <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Usage limits</div>
              <div>
                <label className="label-eyebrow block mb-1.5">Max uses (total)</label>
                <input type="number" min="1" className="bl-input max-w-xs" value={form.max_uses_total} onChange={(e) => setForm({ ...form, max_uses_total: e.target.value })} placeholder="Unlimited" data-testid="campaign-max-uses-input" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button type="submit" disabled={busy} className="bl-btn-primary" data-testid="campaign-create-submit">
                {busy ? "Saving…" : editingId ? "Save campaign" : "Add campaign"}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="bl-btn-ghost">Cancel edit</button>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="bl-card table-card overflow-hidden">
        <table className="bl-data-table w-full">
          <thead className="bl-data-table-head">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Applies to</th>
              <th className="px-4 py-3">Valid dates</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#5C6C62]">No campaigns yet.</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  {c.code && <div className="text-xs font-mono text-[#5C6C62]">{c.code}</div>}
                </td>
                <td className="px-4 py-3 text-sm">{campaignDiscountLabel(c)}</td>
                <td className="px-4 py-3 text-xs text-[#5C6C62]">{campaignAppliesToSummary(c)}</td>
                <td className="px-4 py-3 text-xs text-[#5C6C62] whitespace-nowrap">{campaignDateRangeLabel(c)}</td>
                <td className="px-4 py-3 text-xs capitalize text-[#5C6C62]">{c.status || (c.active ? "active" : "inactive")}</td>
                <td className="px-4 py-3 text-right">
                  {canManage && (
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => toggleActive(c)} className={`bl-chip ${c.active ? "success" : ""}`} data-testid={`campaign-toggle-${c.id}`}>
                        {c.active ? "Active" : "Inactive"}
                      </button>
                      <button type="button" onClick={() => startEdit(c)} className="text-xs px-2 py-1 rounded hover:bg-[#F3F1EB] inline-flex items-center gap-1" data-testid={`campaign-edit-${c.id}`}>
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button type="button" onClick={() => confirmAction(`Delete campaign "${c.name}"?`, () => remove(c))} className="p-1.5 text-[#B14A2C] hover:bg-[#FDF0EB] rounded" aria-label="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
