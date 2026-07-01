import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, Download, Upload, FileSpreadsheet } from "lucide-react";
import { SearchFieldBar } from "@/components/ui/SearchInput";
import { API_BASE } from "@/lib/api";
import CatalogPagination from "@/components/CatalogPagination";
import TreatmentCombobox from "@/components/catalog/TreatmentCombobox";

const PAGE_SIZE = 20;

const PACKAGE_TYPES = [
  { value: "series_package", label: "Series Package", hint: "Same treatment repeated across multiple sessions" },
  { value: "bundle_package", label: "Bundle Package", hint: "Multiple treatments usable across different sessions" },
  { value: "day_package", label: "Day Package", hint: "Multiple treatments intended for the same day" },
];

const PACKAGE_TYPE_TABS = [
  { key: "all", label: "All" },
  { key: "series_package", label: "Series Packages" },
  { key: "bundle_package", label: "Bundle Packages" },
  { key: "day_package", label: "Day Packages" },
];

const TYPE_LABEL = Object.fromEntries(PACKAGE_TYPES.map((t) => [t.value, t.label]));

const emptyComponent = (sortOrder = 0) => ({
  treatment_id: "",
  treatment_name_snapshot: "",
  quantity: 1,
  sort_order: sortOrder,
  is_required: true,
  notes: "",
});

const DEFAULT_FORM = {
  package_code: "",
  name: "",
  package_type: "series_package",
  is_active: true,
  active: true,
  online_booking: false,
  duration_min: 60,
  performer_type: "therapist",
  price_idr: 0,
  sessions_total: 6,
  validity_days: 365,
  redemption_rule: "flexible",
  unused_component_policy: "keep_remaining",
  description: "",
  series_treatment_id: "",
  components: [],
};

function normalizePackageType(raw) {
  const v = (raw || "").toLowerCase();
  if (v.includes("bundle")) return "bundle_package";
  if (v.includes("day")) return "day_package";
  if (v.includes("series") || v === "session") return "series_package";
  if (v === "bundle_package" || v === "day_package" || v === "series_package") return v;
  return raw || "series_package";
}

function normalizeForm(initial) {
  if (!initial) return { ...DEFAULT_FORM, components: [] };
  const ptype = normalizePackageType(initial.package_type);
  const comps = (initial.components || []).map((c, i) => ({
    ...emptyComponent(i),
    ...c,
    treatment_id: c.treatment_id || "",
  }));
  const seriesId = ptype === "series_package"
    ? (initial.series_treatment_id || comps[0]?.treatment_id || "")
    : "";
  return {
    ...DEFAULT_FORM,
    ...initial,
    package_type: ptype,
    package_code: initial.package_code || initial.key || "",
    validity_days: initial.validity_days ?? initial.valid_days ?? 365,
    is_active: initial.is_active ?? initial.active ?? true,
    active: initial.is_active ?? initial.active ?? true,
    redemption_rule: initial.redemption_rule || (ptype === "day_package" ? "same_day_only" : "flexible"),
    unused_component_policy: initial.unused_component_policy || (ptype === "day_package" ? "expire_after_first_use" : "keep_remaining"),
    series_treatment_id: seriesId,
    sessions_total: initial.sessions_total || comps[0]?.quantity || 6,
    components: ptype === "series_package" ? [] : (comps.length ? comps : [emptyComponent()]),
  };
}

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function formatCatalogPrice(n) {
  if (n == null || n === "" || Number(n) === 0) return "Not set";
  return fmtIDR(n);
}

async function fetchAllTreatments() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const r = await api.get("/treatments-catalog", { params: { page, page_size: 100 } });
    const data = r.data;
    if (Array.isArray(data)) return data;
    all.push(...(data.items || []));
    totalPages = data.pages || 1;
    page += 1;
  }
  return all;
}

function findTreatment(treatments, id) {
  if (!id) return null;
  return treatments.find((t) => t.id === id || t.key === id) || null;
}

function resolveTreatmentId(treatments, storedId) {
  if (!storedId) return "";
  return findTreatment(treatments, storedId)?.id || storedId;
}

function excludeTreatmentIds(components, currentIdx) {
  return (components || [])
    .map((c, i) => (i !== currentIdx ? c.treatment_id : null))
    .filter(Boolean);
}

function packageIncludesSummary(p) {
  const ptype = normalizePackageType(p.package_type);
  const components = p.components || [];
  if (ptype === "series_package") {
    const sessions = Number(p.sessions_total) || 0;
    const name = (components[0]?.treatment_name_snapshot || "").trim();
    if (name && sessions) return `${name} · ${sessions} session${sessions !== 1 ? "s" : ""}`;
    if (name) return name;
    if (sessions) return `${sessions} session${sessions !== 1 ? "s" : ""}`;
    return "—";
  }
  if (!components.length) return "—";
  return components
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => {
      const name = (c.treatment_name_snapshot || "Treatment").trim();
      const qty = Math.max(1, Number(c.quantity) || 1);
      return `${name} ×${qty}`;
    })
    .join(" + ");
}

async function downloadFile(path, filename) {
  const token = localStorage.getItem("bl_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function EditorModal({ initial, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(() => normalizeForm(initial));
  const [busy, setBusy] = useState(false);
  const [treatments, setTreatments] = useState([]);
  const [treatmentsLoading, setTreatmentsLoading] = useState(true);
  const [treatmentsError, setTreatmentsError] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    let cancelled = false;
    setTreatmentsLoading(true);
    setTreatmentsError(false);
    fetchAllTreatments()
      .then((rows) => {
        if (cancelled) return;
        setTreatments(rows);
        setForm((f) => {
          let next = { ...f };
          if (f.series_treatment_id) {
            next.series_treatment_id = resolveTreatmentId(rows, f.series_treatment_id);
          }
          if (f.components?.length) {
            next.components = f.components.map((c) => ({
              ...c,
              treatment_id: resolveTreatmentId(rows, c.treatment_id),
            }));
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setTreatments([]);
          setTreatmentsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setTreatmentsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const onTypeChange = (package_type) => {
    const patch = {
      package_type,
      redemption_rule: package_type === "day_package" ? "same_day_only" : "flexible",
      unused_component_policy: package_type === "day_package" ? "expire_after_first_use" : "keep_remaining",
    };
    if (package_type === "series_package") {
      patch.components = [];
    } else if (!(form.components || []).length) {
      patch.components = [emptyComponent()];
    }
    set(patch);
  };

  const updateComponent = (idx, patch) => {
    setForm((f) => ({
      ...f,
      components: (f.components || []).map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  };

  const addComponent = () => {
    setForm((f) => ({
      ...f,
      components: [...(f.components || []), emptyComponent((f.components || []).length)],
    }));
  };

  const removeComponent = (idx) => {
    setForm((f) => ({
      ...f,
      components: (f.components || []).filter((_, i) => i !== idx),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        package_code: form.package_code.trim(),
        name: form.name.trim(),
        package_type: form.package_type,
        is_active: form.is_active,
        active: form.is_active,
        online_booking: form.online_booking,
        duration_min: Number(form.duration_min) || 60,
        performer_type: form.performer_type,
        price_idr: form.price_idr,
        validity_days: Number(form.validity_days) || 365,
        redemption_rule: form.redemption_rule,
        unused_component_policy: form.unused_component_policy,
        description: form.description,
      };
      if (form.package_type === "series_package") {
        payload.series_treatment_id = form.series_treatment_id;
        payload.sessions_total = Number(form.sessions_total) || 1;
        if (!payload.series_treatment_id) {
          toast.error("Select the treatment included in this series");
          setBusy(false);
          return;
        }
      } else {
        payload.components = (form.components || [])
          .filter((c) => c.treatment_id)
          .map((c, i) => {
            const t = findTreatment(treatments, c.treatment_id);
            return {
              treatment_id: c.treatment_id,
              treatment_name_snapshot: t?.name || c.treatment_name_snapshot || "",
              quantity: Number(c.quantity) || 1,
              sort_order: i,
            };
          });
        if (!payload.components.length) {
          toast.error("Add at least one treatment component");
          setBusy(false);
          return;
        }
        const ids = payload.components.map((c) => c.treatment_id);
        if (new Set(ids).size !== ids.length) {
          toast.error("Each treatment can only appear once in this package");
          setBusy(false);
          return;
        }
      }
      if (editing) await api.put(`/packages-catalog/${initial.id}`, payload);
      else await api.post("/packages-catalog", payload);
      toast.success(editing ? "Package updated" : "Package added");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const isSeries = form.package_type === "series_package";
  const isBundle = form.package_type === "bundle_package";
  const isDay = form.package_type === "day_package";

  const componentBuilder = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="label-eyebrow text-[#5C6C62]">Included treatments</div>
        <button type="button" onClick={addComponent} className="bl-btn-ghost text-xs">+ Add component</button>
      </div>
      {(form.components || []).map((comp, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bl-card p-3 bg-[#FDFBF7]">
          <div className="sm:col-span-7">
            <label className="label-eyebrow block mb-1">Treatment</label>
            <TreatmentCombobox
              className="text-sm"
              value={comp.treatment_id}
              onChange={(id, t) => {
                updateComponent(idx, {
                  treatment_id: id,
                  treatment_name_snapshot: t?.name || "",
                });
              }}
              treatments={treatments}
              loading={treatmentsLoading}
              error={treatmentsError}
              excludeIds={excludeTreatmentIds(form.components, idx)}
              testId={`package-component-treatment-${idx}`}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="label-eyebrow block mb-1">Quantity</label>
            <input type="number" min="1" className="bl-input text-sm" value={comp.quantity} onChange={e => updateComponent(idx, { quantity: Number(e.target.value) })} />
          </div>
          {(form.components || []).length > 1 && (
            <button type="button" onClick={() => removeComponent(idx)} className="sm:col-span-2 text-[#B14A2C] text-xs pb-2">Remove</button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="package-editor">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col">
        <div className="p-6 pb-0 flex items-center justify-between shrink-0">
          <h3 className="font-display text-xl text-[#2D3A33]">{editing ? "Edit package" : "New package"}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="package-editor-close"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 mt-4" data-testid="package-editor-form">
          <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4">
            <div className="space-y-3">
              <div className="label-eyebrow text-[#5C6C62]">Package details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Package code</label>
                  <input className="bl-input font-mono" value={form.package_code} onChange={e => set({ package_code: e.target.value })} placeholder="e.g. AMP0001" data-testid="package-code" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Package name</label>
                  <input className="bl-input" value={form.name} onChange={e => set({ name: e.target.value })} required data-testid="package-name" />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Package type</label>
                <select className="bl-input" value={form.package_type} onChange={e => onTypeChange(e.target.value)} data-testid="package-type">
                  {PACKAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <div className="text-xs text-[#5C6C62] mt-1">{PACKAGE_TYPES.find(t => t.value === form.package_type)?.hint}</div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Default performer type</label>
                <select className="bl-input" value={form.performer_type} onChange={e => set({ performer_type: e.target.value })} data-testid="package-performer-type">
                  <option value="doctor">Doctor</option>
                  <option value="therapist">Therapist</option>
                  <option value="either">Either</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Status &amp; appointments</div>
              <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => set({ is_active: e.target.checked, active: e.target.checked })} data-testid="package-active" />
                Active in catalog
              </label>
              <div>
                <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                  <input type="checkbox" checked={form.online_booking} onChange={e => set({ online_booking: e.target.checked })} data-testid="package-online-booking" />
                  Online appointments
                </label>
                <p className="text-xs text-[#5C6C62] mt-1">Visible on the public appointment page.</p>
              </div>
            </div>

            {isSeries && (
              <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
                <div className="label-eyebrow text-[#5C6C62]">Series package</div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Treatment included</label>
                  <TreatmentCombobox
                    value={form.series_treatment_id}
                    onChange={(id) => set({ series_treatment_id: id })}
                    treatments={treatments}
                    loading={treatmentsLoading}
                    error={treatmentsError}
                    placeholder="Search treatments…"
                    testId="package-series-treatment"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Session count</label>
                    <input type="number" min="1" className="bl-input" value={form.sessions_total} onChange={e => set({ sessions_total: Number(e.target.value) })} data-testid="package-sessions" />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Session length (minutes)</label>
                    <input type="number" min="5" step="5" className="bl-input" value={form.duration_min} onChange={e => set({ duration_min: Number(e.target.value) })} required data-testid="package-duration" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Valid for (days)</label>
                    <input type="number" min="1" className="bl-input" value={form.validity_days} onChange={e => set({ validity_days: Number(e.target.value) })} data-testid="package-valid-days" />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Price (IDR)</label>
                    <input type="number" min="0" step="1" className="bl-input font-mono" value={form.price_idr} onChange={e => set({ price_idr: Number(e.target.value) })} required data-testid="package-price" />
                    <div className="text-xs text-[#5C6C62] mt-1">Leave 0 to show “Price on consultation” online.</div>
                  </div>
                </div>
              </div>
            )}

            {isBundle && (
              <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
                <div className="label-eyebrow text-[#5C6C62]">Bundle package</div>
                {componentBuilder}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Valid for (days)</label>
                    <input type="number" min="1" className="bl-input" value={form.validity_days} onChange={e => set({ validity_days: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Price (IDR)</label>
                    <input type="number" min="0" step="1" className="bl-input font-mono" value={form.price_idr} onChange={e => set({ price_idr: Number(e.target.value) })} required data-testid="package-price" />
                    <div className="text-xs text-[#5C6C62] mt-1">Leave 0 to show “Price on consultation” online.</div>
                  </div>
                </div>
              </div>
            )}

            {isDay && (
              <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
                <div className="label-eyebrow text-[#5C6C62]">Day package</div>
                {componentBuilder}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Redemption rule</label>
                    <select className="bl-input" value={form.redemption_rule} onChange={e => set({ redemption_rule: e.target.value })}>
                      <option value="same_day_only">Same day only</option>
                      <option value="flexible">Flexible</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Unused components</label>
                    <select className="bl-input" value={form.unused_component_policy} onChange={e => set({ unused_component_policy: e.target.value })}>
                      <option value="expire_after_first_use">Expire after first use day</option>
                      <option value="keep_remaining">Keep remaining</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Valid for (days)</label>
                    <input type="number" min="1" className="bl-input" value={form.validity_days} onChange={e => set({ validity_days: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Price (IDR)</label>
                    <input type="number" min="0" step="1" className="bl-input font-mono" value={form.price_idr} onChange={e => set({ price_idr: Number(e.target.value) })} required data-testid="package-price" />
                    <div className="text-xs text-[#5C6C62] mt-1">Leave 0 to show “Price on consultation” online.</div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Description</div>
              <textarea className="bl-input min-h-[60px]" value={form.description} onChange={e => set({ description: e.target.value })} placeholder="Short description shown online" data-testid="package-description" />
            </div>
          </div>

          <div className="shrink-0 p-6 pt-4 border-t border-[#EAE6D7] bg-white rounded-b-3xl">
            <button type="submit" disabled={busy} className="bl-btn-primary w-full disabled:opacity-50" data-testid="package-save">{busy ? "Saving…" : editing ? "Update package" : "Add package"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PackagesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const canManage = ["super_admin", "fo", "manager"].includes(user?.role);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback((qq, pkgType, pg) => {
    setLoading(true);
    const params = { page: pg, page_size: PAGE_SIZE };
    if (qq) params.q = qq;
    if (pkgType && pkgType !== "all") params.package_type = pkgType;
    return api.get("/packages-catalog", { params })
      .then(r => {
        const data = r.data || {};
        setRows(data.items || []);
        setTotal(data.total ?? 0);
        setPages(data.pages ?? 1);
        setPage(data.page ?? pg);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
        setPages(1);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(q, filter, page);
  }, [q, filter, page, load]);

  const setFilterAndReset = (pkgType) => {
    setFilter(pkgType);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      await downloadFile("/packages-catalog/export?format=xlsx", "packages.xlsx");
      toast.success("Packages exported");
    } catch (e) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleTemplate = async () => {
    try {
      await downloadFile("/packages-catalog/import-template?format=xlsx", "packages-import-template.xlsx");
      toast.success("Template downloaded");
    } catch (e) {
      toast.error(e.message || "Download failed");
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/packages-catalog/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const { created, updated, errors, total } = r.data || {};
      const errCount = (errors || []).length;
      if (errCount) {
        toast.warning(`Imported ${total} rows: ${created} new, ${updated} updated, ${errCount} issue(s)`);
      } else {
        toast.success(`Imported ${total} rows: ${created} new, ${updated} updated`);
      }
      load(q, filter, 1);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const toggleOnline = async (p) => {
    await api.put(`/packages-catalog/${p.id}`, { online_booking: !p.online_booking });
    load(q, filter, page);
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.name}" from the catalog?`)) return;
    await api.delete(`/packages-catalog/${p.id}`);
    toast.success("Package deleted");
    load(q, filter, page);
  };

  const emptyMessage = q || filter !== "all"
    ? "No packages match your search or filter."
    : "No packages yet.";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="packages-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Catalog</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Packages</h1>
          <p className="mt-2 text-sm text-[#5C6C62] max-w-xl">Manage treatment packages, pricing, validity, online appointment visibility, and included sessions.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleExport} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="export-packages-button">
              <Download className="w-4 h-4" /> Export Excel
            </button>
            <button type="button" onClick={handleTemplate} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="packages-template-button">
              <FileSpreadsheet className="w-4 h-4" /> Excel Template
            </button>
            <label className={`bl-btn-ghost inline-flex items-center gap-2 cursor-pointer ${importBusy ? "opacity-50 pointer-events-none" : ""}`} data-testid="import-packages-button">
              <Upload className="w-4 h-4" /> {importBusy ? "Importing…" : "Import Excel"}
              <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleImport} disabled={importBusy} />
            </label>
            <button onClick={() => setEditing({})} className="bl-btn-primary inline-flex items-center gap-2" data-testid="add-package-button"><Plus className="w-4 h-4" /> New package</button>
          </div>
        )}
      </div>

      <SearchFieldBar
        className="mt-6 bl-card p-4"
        placeholder="Search all packages by name, code, type…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        data-testid="packages-search-input"
        trailing={loading ? <span className="text-xs text-[#5C6C62] shrink-0">Loading…</span> : null}
      />

      <div className="mt-6 flex gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit max-w-full overflow-x-auto" data-testid="packages-filter">
        {PACKAGE_TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterAndReset(tab.key)}
            className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap"
            style={filter === tab.key ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }}
            data-testid={`filter-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-5 bl-card table-card overflow-hidden" data-testid="packages-table">
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full min-w-[800px]">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Package</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Includes</th>
                <th className="px-5 py-3 text-right">Price</th>
                <th className="px-5 py-3">Online</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-10 text-center text-[#5C6C62] text-sm">Loading packages…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-[#5C6C62] text-sm">{emptyMessage}</td></tr>
              )}
              {!loading && rows.map(p => (
                <tr key={p.id} className="border-t border-[#EAE6D7]" style={{ opacity: p.active !== false ? 1 : 0.55 }} data-testid={`package-row-${p.id}`}>
                  <td className="px-5 py-3 text-xs font-mono text-[#5C6C62] whitespace-nowrap">{p.package_code || p.key}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-[#2D3A33]">{p.name}</div>
                    {p.description && <div className="text-xs text-[#5C6C62] mt-0.5 line-clamp-1 max-w-xs">{p.description}</div>}
                  </td>
                  <td className="px-5 py-3 text-sm text-[#2D3A33] whitespace-nowrap">{TYPE_LABEL[normalizePackageType(p.package_type)] || p.package_type || "—"}</td>
                  <td className="px-5 py-3 text-sm text-[#5C6C62] max-w-xs">{packageIncludesSummary(p)}</td>
                  <td className="px-5 py-3 text-right text-sm font-medium text-[#2D3A33] whitespace-nowrap">{formatCatalogPrice(p.price_idr)}</td>
                  <td className="px-5 py-3">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => toggleOnline(p)}
                        className="inline-flex items-center gap-1.5"
                        title={p.online_booking ? "Visible on public appointment page" : "Hidden from public appointment page"}
                        data-testid={`package-toggle-${p.id}`}
                      >
                        <span className={`bl-chip text-[10px] py-0.5 ${p.online_booking ? "success" : ""}`}>
                          {p.online_booking ? "Online" : "Hidden"}
                        </span>
                        {p.online_booking ? (
                          <ToggleRight className="w-4 h-4 shrink-0" style={{ color: "var(--bl-primary)" }} />
                        ) : (
                          <ToggleLeft className="w-4 h-4 shrink-0 text-[#A89F8B]" />
                        )}
                      </button>
                    ) : (
                      <span
                        className={`bl-chip text-[10px] ${p.online_booking ? "success" : ""}`}
                        title={p.online_booking ? "Visible on public appointment page" : "Hidden from public appointment page"}
                      >
                        {p.online_booking ? "Online" : "Hidden"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {canManage && (
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => setEditing(p)} className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 hover:bg-[#F3F1EB] border border-transparent hover:border-[#EAE6D7]" data-testid={`package-edit-${p.id}`}>
                          <Edit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button type="button" onClick={() => remove(p)} className="text-xs p-1.5 rounded-lg text-[#B14A2C] hover:bg-[#FAE5DC]" data-testid={`package-delete-${p.id}`}>
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

      <CatalogPagination
        page={page}
        pages={pages}
        total={total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        loading={loading}
        label="package"
        testIdPrefix="packages"
      />

      {editing !== null && (
        <EditorModal
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(q, filter, page); }}
        />
      )}
    </div>
  );
}
