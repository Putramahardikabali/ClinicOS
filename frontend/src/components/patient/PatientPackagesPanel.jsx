import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";
import { Package, RotateCcw, Ban } from "lucide-react";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");

const TABS = [
  { key: "active", label: "Active" },
  { key: "partially_used", label: "Partially used" },
  { key: "used_up", label: "Used up" },
  { key: "expired", label: "Expired" },
  { key: "history", label: "Usage history" },
];

const TYPE_LABELS = {
  series_package: "Series Package",
  bundle_package: "Bundle Package",
  day_package: "Day Package",
};

const fmtType = (t) => TYPE_LABELS[t] || t || "Package";

export default function PatientPackagesPanel({ patientId, compact = false }) {
  const { user } = useAuth();
  const canManage = ["super_admin", "manager"].includes(user?.role);

  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("active");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get(`/patients/${patientId}/patient-packages`);
    setRows(r.data || []);
  }, [patientId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const filtered = useMemo(() => {
    if (tab === "history") {
      return rows.flatMap((p) => (p.usage_history || []).map((u) => ({ ...u, package_name: p.package_name_snapshot })));
    }
    return rows.filter((p) => p.status === tab);
  }, [rows, tab]);

  const reverseUsage = async (usageId) => {
    if (!window.confirm("Reverse this usage and restore session balance?")) return;
    setBusy(true);
    try {
      await api.post(`/package-usage/${usageId}/reverse`);
      toast.success("Usage reversed");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reverse");
    } finally { setBusy(false); }
  };

  const cancelPackage = async (pkgId) => {
    if (!window.confirm("Cancel this patient package?")) return;
    setBusy(true);
    try {
      await api.post(`/patient-packages/${pkgId}/cancel`);
      toast.success("Package cancelled");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel");
    } finally { setBusy(false); }
  };

  const extendExpiry = async (pkg) => {
    const val = window.prompt("New expiry date (YYYY-MM-DD)", pkg.expiry_date || "");
    if (!val) return;
    setBusy(true);
    try {
      await api.put(`/patient-packages/${pkg.id}`, { expiry_date: val });
      toast.success("Expiry updated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally { setBusy(false); }
  };

  const adjustSessions = async (pkg) => {
    const val = window.prompt("New total sessions", String(pkg.total_sessions || 0));
    if (!val) return;
    setBusy(true);
    try {
      await api.put(`/patient-packages/${pkg.id}`, { total_sessions: Number(val) });
      toast.success("Sessions updated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally { setBusy(false); }
  };

  return (
    <div className={compact ? "" : "mt-10"} data-testid="patient-packages-panel">
      {!compact && (
        <div className="mb-4">
          <div className="label-eyebrow flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Packages</div>
          <h2 className="font-display text-2xl text-[#2D3A33] mt-1">Package balance</h2>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`bl-btn-ghost text-sm ${tab === t.key ? "ring-1 ring-[#2D3A33]" : ""}`}
          >
            {t.label}
            {t.key !== "history" && (
              <span className="ml-1 text-[#5C6C62]">({rows.filter((p) => p.status === t.key).length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="bl-card overflow-hidden">
        {tab === "history" ? (
          filtered.length === 0 ? (
            <p className="p-5 text-sm text-[#5C6C62]">No usage history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Package</th>
                    <th className="px-5 py-3">Treatment</th>
                    <th className="px-5 py-3">Sessions</th>
                    <th className="px-5 py-3">Status</th>
                    {canManage && <th className="px-5 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-t border-[#EAE6D7]">
                      <td className="px-5 py-3">{fmtDate(u.usage_date)}</td>
                      <td className="px-5 py-3">{u.package_name}</td>
                      <td className="px-5 py-3">{u.treatment_name_snapshot || "—"}</td>
                      <td className="px-5 py-3">{u.used_sessions_count}</td>
                      <td className="px-5 py-3"><span className="bl-chip">{u.status}</span></td>
                      {canManage && (
                        <td className="px-5 py-3 text-right">
                          {u.status === "active" && (
                            <button type="button" disabled={busy} onClick={() => reverseUsage(u.id)} className="text-xs text-[#B14A2C] inline-flex items-center gap-1">
                              <RotateCcw className="w-3.5 h-3.5" /> Reverse
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filtered.length === 0 ? (
          <p className="p-5 text-sm text-[#5C6C62]">No {tab.replace("_", " ")} packages.</p>
        ) : (
          <div className="divide-y divide-[#EAE6D7]">
            {filtered.map((p) => (
              <div key={p.id} className="p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-[#2D3A33]">{p.package_name_snapshot}</div>
                  <div className="text-xs text-[#5C6C62] mt-0.5">{fmtType(p.package_type_label || p.package_type)}</div>
                  <div className="text-sm text-[#5C6C62] mt-1">
                    {p.remaining_sessions} / {p.total_sessions} total sessions left · expires {fmtDate(p.expiry_date)}
                  </div>
                  {(p.components || []).length > 0 && (
                    <div className="mt-3 space-y-1">
                      {(p.components || []).map((c) => (
                        <div key={c.id} className="text-xs text-[#2D3A33] flex justify-between gap-4 max-w-md">
                          <span>{c.treatment_name_snapshot || "Treatment"}</span>
                          <span className="text-[#5C6C62] tabular-nums">
                            {c.remaining_quantity ?? c.remaining}/{c.total_quantity ?? c.total} left
                            {c.status && c.status !== "active" ? ` · ${c.status}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-[#5C6C62] mt-2">
                    Purchased {fmtDate(p.start_date)} · {fmtIDR(p.purchase_price_snapshot)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className={`bl-chip ${p.status === "active" ? "success" : p.status === "partially_used" ? "info" : "warning"}`}>{p.status?.replace("_", " ")}</span>
                  {canManage && ["active", "partially_used"].includes(p.status) && (
                    <>
                      <button type="button" disabled={busy} onClick={() => adjustSessions(p)} className="bl-btn-ghost text-xs">Adjust sessions</button>
                      <button type="button" disabled={busy} onClick={() => extendExpiry(p)} className="bl-btn-ghost text-xs">Extend expiry</button>
                      <button type="button" disabled={busy} onClick={() => cancelPackage(p.id)} className="bl-btn-ghost text-xs text-[#B14A2C] inline-flex items-center gap-1">
                        <Ban className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PatientPackageUsePanel({ patientId, visitId, appointmentId, onUsed }) {
  const { user } = useAuth();
  const canUse = hasPermission(user, "packages.use");
  const [packages, setPackages] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [pick, setPick] = useState({ pkgId: "", treatmentId: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    api.get(`/patients/${patientId}/patient-packages`).then((r) => {
      setPackages((r.data || []).filter((p) => p.status === "active" && p.remaining_sessions > 0));
    }).catch(() => {});
    api.get("/treatments-catalog").then((r) => {
      setTreatments(r.data?.items || r.data || []);
    }).catch(() => {});
  }, [patientId]);

  if (!canUse || !patientId) return null;
  if (packages.length === 0) return null;

  const useSession = async () => {
    if (!pick.pkgId) { toast.error("Select a package"); return; }
    const pkg = packages.find((p) => p.id === pick.pkgId);
    if (!window.confirm(`Use 1 session from "${pkg?.package_name_snapshot}"? Remaining after: ${(pkg?.remaining_sessions || 1) - 1}`)) return;
    setBusy(true);
    try {
      const treatment = treatments.find((t) => (t.id || t.key) === pick.treatmentId);
      await api.post(`/patient-packages/${pick.pkgId}/use`, {
        visit_id: visitId || undefined,
        appointment_id: appointmentId || undefined,
        treatment_id: pick.treatmentId || undefined,
        treatment_name: treatment?.name,
        used_sessions_count: 1,
        notes: pick.notes,
      });
      toast.success("Package session used");
      setPick({ pkgId: "", treatmentId: "", notes: "" });
      onUsed?.();
      const r = await api.get(`/patients/${patientId}/patient-packages`);
      setPackages((r.data || []).filter((p) => p.status === "active" && p.remaining_sessions > 0));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not use package");
    } finally { setBusy(false); }
  };

  return (
    <div className="bl-card p-5 space-y-3 border border-[#D4E8DC]" data-testid="invoice-package-use">
      <div className="font-display text-lg text-[#2D3A33]">Use package session</div>
      <p className="text-sm text-[#5C6C62]">Apply an active prepaid package session to this visit.</p>
      <select className="bl-input text-sm" value={pick.pkgId} onChange={(e) => setPick({ ...pick, pkgId: e.target.value })}>
        <option value="">Select package…</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>{p.package_name_snapshot} ({p.remaining_sessions} left)</option>
        ))}
      </select>
      <select className="bl-input text-sm" value={pick.treatmentId} onChange={(e) => setPick({ ...pick, treatmentId: e.target.value })}>
        <option value="">Treatment (optional)</option>
        {treatments.map((t) => (
          <option key={t.id || t.key} value={t.id || t.key}>{t.name}</option>
        ))}
      </select>
      <input className="bl-input text-sm" placeholder="Notes (optional)" value={pick.notes} onChange={(e) => setPick({ ...pick, notes: e.target.value })} />
      <button type="button" disabled={busy || !pick.pkgId} onClick={useSession} className="bl-btn-primary text-sm disabled:opacity-50">
        Confirm use session
      </button>
    </div>
  );
}
