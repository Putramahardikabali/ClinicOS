import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { useClinic } from "@/lib/clinic";

const TIER_COLOR_PRESETS = ["#9CA3AF", "#F59E0B", "#7C3AED", "#06B6D4", "#10B981", "#EF4444", "#EC4899"];

const fmtIDRShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return "Rp " + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return "Rp " + (v / 1_000).toFixed(0) + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

function confirmAction(message, onConfirm) {
  if (window.confirm(message)) onConfirm();
}

export default function LoyaltyPage() {
  const { user } = useAuth();
  const { clinic, refresh } = useClinic();
  const canManage = hasPermission(user, "loyalty.manage") || user?.role === "super_admin" || user?.role === "manager";
  const canView = canManage || hasPermission(user, "loyalty.view");

  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (clinic?.loyalty_tiers) setTiers([...clinic.loyalty_tiers]);
  }, [clinic?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView) {
    return <div className="p-8 text-[#5C6C62]">You do not have permission to view loyalty settings.</div>;
  }

  if (!clinic) return <div className="p-8 text-[#5C6C62]">Loading…</div>;

  const update = (idx, field, value) => {
    setTiers((t) => t.map((x, i) => (i === idx ? { ...x, [field]: value } : x)));
  };
  const add = () => setTiers((t) => [...t, { name: "New tier", min_spend_idr: 0, benefit: "", color: TIER_COLOR_PRESETS[t.length % TIER_COLOR_PRESETS.length] }]);
  const remove = (idx) => confirmAction(`Remove tier "${tiers[idx]?.name}"?`, () => setTiers((t) => t.filter((_, i) => i !== idx)));

  const save = async () => {
    if (!canManage) return;
    for (const t of tiers) {
      if (!(t.name || "").trim()) { toast.error("All tiers need a name"); return; }
      const n = Number(t.min_spend_idr);
      if (!Number.isFinite(n) || n < 0) { toast.error(`${t.name}: minimum spend must be ≥ 0`); return; }
    }
    setBusy(true);
    try {
      await api.put("/clinics/me", { loyalty_tiers: tiers.map((t) => ({ ...t, min_spend_idr: Number(t.min_spend_idr) })) });
      toast.success("Loyalty tiers saved");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const sortedPreview = [...tiers].sort((a, b) => Number(a.min_spend_idr) - Number(b.min_spend_idr));

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto space-y-6" data-testid="loyalty-page">
      <div>
        <div className="label-eyebrow">Marketing</div>
        <h1 className="font-display text-3xl text-[#2D3A33]">Loyalty</h1>
        <p className="text-sm text-[#5C6C62] mt-1">
          Configure loyalty tiers based on patient lifetime spend.
        </p>
      </div>

      <div className="bl-card p-5" data-testid="loyalty-form">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Loyalty tiers</div>
        <p className="text-sm text-[#5C6C62] mb-4">
          Tiers are awarded automatically based on a patient&apos;s lifetime spend. A patient receives the highest tier they qualify for.
        </p>

        <div className="space-y-4" data-testid="tier-list">
          {tiers.length === 0 && <div className="text-sm text-[#5C6C62]">No tiers yet. Add one to get started.</div>}
          {tiers.map((t, idx) => (
            <div key={idx} className="rounded-xl border p-4 space-y-3" style={{ borderColor: t.color || "#EAE6D7", background: `${t.color || "#EAE6D7"}0A` }} data-testid={`tier-card-${idx}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="color"
                    className="w-10 h-10 rounded-lg border border-[#EAE6D7] cursor-pointer flex-shrink-0"
                    value={t.color || "#9CA3AF"}
                    onChange={(e) => update(idx, "color", e.target.value)}
                    disabled={!canManage}
                    data-testid={`tier-color-${idx}`}
                  />
                  <input
                    className="bl-input flex-1 font-display text-lg"
                    value={t.name}
                    placeholder="Tier name (e.g. Silver)"
                    onChange={(e) => update(idx, "name", e.target.value)}
                    disabled={!canManage}
                    data-testid={`tier-name-${idx}`}
                  />
                </div>
                {canManage && (
                  <button type="button" onClick={() => remove(idx)} className="text-[#B14A2C] p-2 hover:bg-[#FDF3F0] rounded-lg" data-testid={`tier-remove-${idx}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Minimum lifetime spend (IDR)</label>
                  <input type="number" min={0} step={100000} className="bl-input" value={t.min_spend_idr} onChange={(e) => update(idx, "min_spend_idr", e.target.value)} disabled={!canManage} data-testid={`tier-spend-${idx}`} />
                  <div className="text-xs text-[#5C6C62] mt-1">{fmtIDRShort(t.min_spend_idr)}</div>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Benefit description</label>
                  <input className="bl-input" value={t.benefit || ""} placeholder="e.g. 10% off + birthday gift" onChange={(e) => update(idx, "benefit", e.target.value)} disabled={!canManage} data-testid={`tier-benefit-${idx}`} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {canManage && (
          <button type="button" onClick={add} className="mt-4 bl-btn-ghost text-sm inline-flex items-center gap-1.5" data-testid="tier-add">
            <Plus className="w-4 h-4" /> Add tier
          </button>
        )}
      </div>

      {sortedPreview.length > 0 && (
        <div className="bl-card p-5 bg-[#FDFBF7]">
          <div className="font-display text-base text-[#2D3A33] mb-3">Preview (sorted by threshold)</div>
          <div className="flex flex-wrap gap-2">
            {sortedPreview.map((t, i) => (
              <div key={i} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}` }}>
                {t.name} <span className="opacity-70">≥ {fmtIDRShort(t.min_spend_idr)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && (
        <div className="flex justify-end sticky bottom-4">
          <button onClick={save} disabled={busy} className="bl-btn-primary disabled:opacity-50 shadow-lg" data-testid="loyalty-save">
            {busy ? "Saving…" : "Save loyalty tiers"}
          </button>
        </div>
      )}
    </div>
  );
}
