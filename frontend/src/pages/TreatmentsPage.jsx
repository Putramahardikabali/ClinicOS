import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { toast } from "sonner";
import { Plus, Edit2, ToggleLeft, ToggleRight, X, UserCheck, Stethoscope, Heart, Download, Upload, FileSpreadsheet, HelpCircle, MoreHorizontal } from "lucide-react";
import { SearchFieldBar } from "@/components/ui/SearchInput";
import { API_BASE } from "@/lib/api";
import CatalogPagination from "@/components/CatalogPagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SIZE = 20;
const CREATE_CATEGORY = "__create_new__";

const PERFORMER_LABEL = {
  doctor: { label: "Doctor", icon: Stethoscope, color: "#2C5A77" },
  therapist: { label: "Therapist", icon: Heart, color: "#9B2C5A" },
  nurse: { label: "Nurse", icon: Heart, color: "#6B3A8A" },
  either: { label: "Either", icon: UserCheck, color: "#5C6C62" },
};

const EXCEL_IMPORT_HELP =
  "Re-importing the same Excel file updates existing rows matched by Service Code or Service Name. Performer roles and consent are set in the app after import.";
const TAX_GROUPS = ["", "VAT"];

const DEFAULT_FORM = {
  service_code: "",
  name: "",
  category: "",
  service_type: "None",
  active: true,
  tax_group: "",
  duration_min: 30,
  performer_type: "therapist",
  allowed_performer_roles: ["therapist"],
  allow_multiple_performers: false,
  requires_assistant: false,
  price_idr: 0,
  slots_per_session: 1,
  description: "",
  consent_required: false,
};

function clinicTaxIncludedDefault(settings) {
  const s = settings || {};
  if (s.catalog_defaults?.tax_included != null) return Boolean(s.catalog_defaults.tax_included);
  if (s.form_config?.tax_included_default != null) return Boolean(s.form_config.tax_included_default);
  if (s.tax_included_default != null) return Boolean(s.tax_included_default);
  return false;
}

function requiredPerformerRoles(performerType) {
  if (performerType === "doctor") return ["doctor"];
  if (performerType === "nurse") return ["nurse"];
  if (performerType === "either") return ["doctor", "therapist", "nurse"];
  return ["therapist"];
}

function mergePerformerRoles(performerType, roles = []) {
  const required = requiredPerformerRoles(performerType);
  return [...new Set([...roles, ...required])];
}

function normalizeForm(initial, taxIncludedDefault = false) {
  if (!initial) {
    return {
      ...DEFAULT_FORM,
      tax_included: taxIncludedDefault,
      allowed_performer_roles: requiredPerformerRoles("therapist"),
    };
  }
  const performerType = initial.performer_type || "therapist";
  const baseRoles = initial.allowed_performer_roles?.length
    ? initial.allowed_performer_roles
    : requiredPerformerRoles(performerType);
  return {
    ...DEFAULT_FORM,
    ...initial,
    service_code: initial.service_code || initial.key || "",
    service_type: initial.service_type || "None",
    tax_included: initial.tax_included ?? taxIncludedDefault,
    tax_group: initial.tax_group || "",
    allowed_performer_roles: mergePerformerRoles(performerType, baseRoles),
    allow_multiple_performers: Boolean(initial.allow_multiple_performers),
    requires_assistant: Boolean(initial.requires_assistant),
    consent_required: Boolean(initial.consent_required),
  };
}

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function formatCatalogPrice(n) {
  if (n == null || n === "" || Number(n) === 0) return "Not set";
  return fmtIDR(n);
}

function categoryExists(name, options) {
  const n = (name || "").trim().toLowerCase();
  return options.some((c) => c.trim().toLowerCase() === n);
}

function ExcelImportHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg text-[#5C6C62] hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
        aria-label="Excel import help"
        aria-expanded={open}
        data-testid="treatments-excel-help"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close help" onClick={() => setOpen(false)} />
          <div role="tooltip" className="absolute right-0 top-full mt-2 z-20 w-72 bl-card p-3 text-xs text-[#5C6C62] shadow-lg leading-relaxed" data-testid="treatments-excel-help-tooltip">
            {EXCEL_IMPORT_HELP}
          </div>
        </>
      )}
    </div>
  );
}

function FieldHint({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[#8A9A86] hover:text-[#5C6C62]"
        aria-label="More info"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10" aria-label="Close" onClick={() => setOpen(false)} />
          <span className="absolute left-0 bottom-full mb-1 z-20 w-56 bl-card p-2 text-xs text-[#5C6C62] shadow-lg leading-relaxed">{text}</span>
        </>
      )}
    </span>
  );
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

function EditorModal({ initial, onClose, onSaved, categoryOptions = [], taxIncludedDefault = false }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(() => normalizeForm(initial, taxIncludedDefault));
  const [busy, setBusy] = useState(false);
  const lockedPerformerRoles = requiredPerformerRoles(form.performer_type);
  const initialCategory = (initial?.category || "").trim();
  const [creatingCategory, setCreatingCategory] = useState(() => {
    if (!initialCategory) return false;
    return !categoryOptions.some((c) => c.trim().toLowerCase() === initialCategory.toLowerCase());
  });
  const [newCategory, setNewCategory] = useState(() => {
    if (!initialCategory) return "";
    const inList = categoryOptions.some((c) => c.trim().toLowerCase() === initialCategory.toLowerCase());
    return inList ? "" : initialCategory;
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const dropdownCategories = useMemo(() => {
    const setCats = new Set(categoryOptions.filter(Boolean));
    const cur = (initial?.category || form.category || "").trim();
    if (cur) setCats.add(cur);
    return [...setCats].sort((a, b) => a.localeCompare(b));
  }, [categoryOptions, initial?.category, form.category]);

  const categorySelectValue = creatingCategory
    ? CREATE_CATEGORY
    : (form.category || "");

  const handleCategorySelect = (value) => {
    if (value === CREATE_CATEGORY) {
      setCreatingCategory(true);
      setNewCategory("");
      return;
    }
    setCreatingCategory(false);
    setNewCategory("");
    set({ category: value });
  };

  const submit = async (e) => {
    e.preventDefault();
    let category = form.category?.trim() || "";
    if (creatingCategory) {
      category = newCategory.trim();
      if (!category) {
        toast.error("Enter a category name");
        return;
      }
      if (categoryExists(category, dropdownCategories)) {
        toast.error("That category already exists — select it from the list");
        return;
      }
    }
    if (!category) {
      toast.error("Select a category");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        service_code: form.service_code.trim(),
        name: form.name.trim(),
        category,
        duration_min: form.duration_min,
        active: form.active,
        tax_included: form.tax_included,
        tax_group: form.tax_group || "",
        performer_type: form.performer_type,
        allowed_performer_roles: form.allowed_performer_roles,
        allow_multiple_performers: form.allow_multiple_performers,
        requires_assistant: form.requires_assistant,
        consent_required: form.consent_required,
        price_idr: form.price_idr,
        description: form.description,
        slots_per_session: form.slots_per_session,
      };
      if (!editing) payload.service_type = "None";
      if (editing) await api.put(`/treatments-catalog/${initial.id}`, payload);
      else await api.post("/treatments-catalog", payload);
      toast.success(editing ? "Treatment updated" : "Treatment added");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="treatment-editor">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col">
        <div className="p-6 pb-0 flex items-center justify-between shrink-0">
          <h3 className="font-display text-xl text-[#2D3A33]">{editing ? "Edit treatment" : "New treatment"}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="treatment-editor-close"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 mt-4" data-testid="treatment-editor-form">
          <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4">
            <div className="space-y-3">
              <div className="label-eyebrow text-[#5C6C62]">Basic details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Service code</label>
                  <input className="bl-input font-mono" value={form.service_code} onChange={e => set({ service_code: e.target.value })} placeholder="e.g. 09097" data-testid="treatment-service-code" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Treatment name</label>
                  <input className="bl-input" value={form.name} onChange={e => set({ name: e.target.value })} required data-testid="treatment-name" />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Category</label>
                <select
                  className="bl-input"
                  value={categorySelectValue}
                  onChange={(e) => handleCategorySelect(e.target.value)}
                  data-testid="treatment-category"
                >
                  <option value="">Select category…</option>
                  {dropdownCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value={CREATE_CATEGORY}>+ Create new category</option>
                </select>
                {creatingCategory && (
                  <input
                    className="bl-input mt-2"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="New category name"
                    data-testid="treatment-category-new"
                  />
                )}
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Duration (minutes)</label>
                <input type="number" min="5" step="5" className="bl-input" value={form.duration_min} onChange={e => set({ duration_min: Number(e.target.value) })} required data-testid="treatment-duration" />
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Booking &amp; visibility</div>
              <div>
                <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} data-testid="treatment-active" />
                  Online booking
                </label>
                <p className="text-xs text-[#5C6C62] mt-1">Visible on the public booking page.</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                <input type="checkbox" checked={form.tax_included} onChange={e => set({ tax_included: e.target.checked })} data-testid="treatment-tax-included" />
                Price includes tax
              </label>
              <div>
                <label className="label-eyebrow block mb-1.5">Tax group</label>
                <select className="bl-input" value={form.tax_group} onChange={e => set({ tax_group: e.target.value })} data-testid="treatment-tax-group">
                  <option value="">None</option>
                  {TAX_GROUPS.filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Performer rules</div>
              <div>
                <label className="label-eyebrow block mb-1.5">Default performer type</label>
                <select className="bl-input" value={form.performer_type} onChange={e => {
                  const pt = e.target.value;
                  set({
                    performer_type: pt,
                    allowed_performer_roles: mergePerformerRoles(pt, form.allowed_performer_roles),
                  });
                }} data-testid="treatment-performer-type">
                  <option value="doctor">Doctor</option>
                  <option value="therapist">Therapist</option>
                  <option value="nurse">Nurse</option>
                  <option value="either">Any clinical role</option>
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Who can perform this treatment?</label>
                <div className="flex flex-wrap gap-3 text-sm">
                  {["doctor", "therapist", "nurse"].map((role) => {
                    const checked = (form.allowed_performer_roles || []).includes(role);
                    const locked = lockedPerformerRoles.includes(role) && checked;
                    return (
                    <label key={role} className={`flex items-center gap-1.5 ${locked ? "opacity-80" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        title={locked ? "Change default performer type to uncheck this role" : undefined}
                        onChange={(e) => {
                          const cur = new Set(form.allowed_performer_roles || []);
                          if (e.target.checked) {
                            cur.add(role);
                          } else if (lockedPerformerRoles.includes(role)) {
                            return;
                          } else {
                            cur.delete(role);
                          }
                          set({ allowed_performer_roles: [...cur] });
                        }}
                      />
                      {PERFORMER_LABEL[role]?.label || role}
                    </label>
                    );
                  })}
                </div>
                <p className="text-xs text-[#5C6C62] mt-2">Default performer is used for quick booking. Allowed roles control who can be assigned.</p>
              </div>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.allow_multiple_performers} onChange={(e) => set({ allow_multiple_performers: e.target.checked })} />
                  <span className="text-[#2D3A33]">Allow more than one performer</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.requires_assistant} onChange={(e) => set({ requires_assistant: e.target.checked })} />
                  <span className="text-[#2D3A33]">Assistant required</span>
                </label>
                <p className="text-xs text-[#5C6C62]">Use this for doctor + nurse or therapist + nurse treatments.</p>
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Consent</div>
              <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                <input type="checkbox" checked={form.consent_required} onChange={(e) => set({ consent_required: e.target.checked })} data-testid="treatment-consent-required" />
                Consent required before treatment
                <FieldHint text="When enabled, this treatment will require a consent form before the visit can be completed." />
              </label>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Pricing</div>
              <div>
                <label className="label-eyebrow block mb-1.5">Price (IDR)</label>
                <input type="number" min="0" step="1" className="bl-input font-mono" value={form.price_idr} onChange={e => set({ price_idr: Number(e.target.value) })} required data-testid="treatment-price" />
                <div className="text-xs text-[#5C6C62] mt-1">Leave 0 to show “Price on consultation” online.</div>
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Description</div>
              <textarea className="bl-input min-h-[60px]" value={form.description} onChange={e => set({ description: e.target.value })} placeholder="Internal notes for staff" data-testid="treatment-description" />
            </div>
          </div>

          <div className="shrink-0 p-6 pt-4 border-t border-[#EAE6D7] bg-white rounded-b-3xl">
            <button type="submit" disabled={busy} className="bl-btn-primary w-full disabled:opacity-50" data-testid="treatment-save">{busy ? "Saving…" : editing ? "Update treatment" : "Add treatment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TreatmentRowActions({ treatment, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="inline-flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onEdit(treatment)}
        className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 hover:bg-[#F3F1EB] border border-transparent hover:border-[#EAE6D7]"
        data-testid={`treatment-edit-${treatment.id}`}
      >
        <Edit2 className="w-3.5 h-3.5" /> Edit
      </button>
      <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="p-1.5 rounded-lg text-[#5C6C62] hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
            aria-label="More actions"
            data-testid={`treatment-menu-${treatment.id}`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {!confirmDelete ? (
            <DropdownMenuItem
              className="text-[#B14A2C] focus:text-[#B14A2C] cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                setConfirmDelete(true);
              }}
            >
              Delete…
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="text-[#B14A2C] focus:text-[#B14A2C] font-medium cursor-pointer"
              onSelect={() => onDelete(treatment)}
            >
              Confirm delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function TreatmentsPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const taxIncludedDefault = clinicTaxIncludedDefault(settings);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [categoryFacets, setCategoryFacets] = useState([]);
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

  const load = useCallback((qq, cat, pg) => {
    setLoading(true);
    const params = { page: pg, page_size: PAGE_SIZE };
    if (qq) params.q = qq;
    if (cat && cat !== "all") params.category = cat;
    return api.get("/treatments-catalog", { params })
      .then(r => {
        const data = r.data || {};
        setRows(data.items || []);
        setTotal(data.total ?? 0);
        setPages(data.pages ?? 1);
        setPage(data.page ?? pg);
        if (Array.isArray(data.facets)) setCategoryFacets(data.facets);
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

  const setFilterAndReset = (cat) => {
    setFilter(cat);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      await downloadFile("/treatments-catalog/export?format=xlsx", "treatments.xlsx");
      toast.success("Treatments exported");
    } catch (e) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleTemplate = async () => {
    try {
      await downloadFile("/treatments-catalog/import-template?format=xlsx", "treatments-import-template.xlsx");
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
      const r = await api.post("/treatments-catalog/import", fd, {
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

  const toggleActive = async (t) => {
    await api.put(`/treatments-catalog/${t.id}`, { active: !t.active });
    load(q, filter, page);
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}" from the catalog? This cannot be undone. Treatments already used in visits or invoices may still appear in historical records.`)) return;
    await api.delete(`/treatments-catalog/${t.id}`);
    toast.success("Treatment deleted");
    load(q, filter, page);
  };

  const categoryFilters = categoryFacets.length
    ? categoryFacets
    : [...new Set(rows.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const emptyMessage = q || filter !== "all"
    ? "No treatments match your search or filter."
    : "No treatments in this category yet.";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="treatments-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Catalog</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Treatments</h1>
          <p className="mt-2 text-sm text-[#5C6C62] max-w-xl">Manage treatments, pricing, booking availability, performer roles, and consent requirements.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <ExcelImportHelp />
            <button type="button" onClick={handleExport} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="export-treatments-button">
              <Download className="w-4 h-4" /> Export Excel
            </button>
            <button type="button" onClick={handleTemplate} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="treatments-template-button">
              <FileSpreadsheet className="w-4 h-4" /> Excel Template
            </button>
            <label className={`bl-btn-ghost inline-flex items-center gap-2 cursor-pointer ${importBusy ? "opacity-50 pointer-events-none" : ""}`} data-testid="import-treatments-button">
              <Upload className="w-4 h-4" /> {importBusy ? "Importing…" : "Import Excel"}
              <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleImport} disabled={importBusy} />
            </label>
            <button onClick={() => setEditing({})} className="bl-btn-primary inline-flex items-center gap-2" data-testid="add-treatment-button"><Plus className="w-4 h-4" /> New treatment</button>
            {["super_admin", "manager"].includes(user?.role) && (
              <Link to="/consent-templates" className="bl-btn-ghost text-sm">Manage consent templates</Link>
            )}
          </div>
        )}
      </div>

      <SearchFieldBar
        className="mt-6 bl-card p-4"
        placeholder="Search all treatments by name, code, category…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        data-testid="treatments-search-input"
        trailing={loading ? <span className="text-xs text-[#5C6C62] shrink-0">Loading…</span> : null}
      />

      <div className="mt-6 flex gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit max-w-full overflow-x-auto" data-testid="treatments-filter">
        <button onClick={() => setFilterAndReset("all")} className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap" style={filter === "all" ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid="filter-all">All</button>
        {categoryFilters.map(c => (
          <button key={c} onClick={() => setFilterAndReset(c)} className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap" style={filter === c ? { background: "white", color: "#2D3A33" } : { color: "#5C6C62" }} data-testid={`filter-${c}`}>{c}</button>
        ))}
      </div>

      <div className="mt-5 bl-card overflow-hidden" data-testid="treatments-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Treatment</th>
                <th className="px-5 py-3">Performed by</th>
                <th className="px-5 py-3 text-right">Length</th>
                <th className="px-5 py-3 text-right">Price</th>
                <th className="px-5 py-3">Online</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-10 text-center text-[#5C6C62] text-sm">Loading treatments…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-[#5C6C62] text-sm">{emptyMessage}</td></tr>
              )}
              {!loading && rows.map(t => {
                const perf = PERFORMER_LABEL[t.performer_type] || PERFORMER_LABEL.therapist;
                const PerfIcon = perf.icon;
                return (
                  <tr key={t.id} className="border-t border-[#EAE6D7]" style={{ opacity: t.active ? 1 : 0.55 }} data-testid={`treatment-row-${t.id}`}>
                    <td className="px-5 py-3 text-xs font-mono text-[#5C6C62] whitespace-nowrap">{t.service_code || t.key}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[#2D3A33]">{t.name}</div>
                      {t.description && <div className="text-xs text-[#5C6C62] mt-0.5 line-clamp-1 max-w-xs">{t.description}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: perf.color }} data-testid={`treatment-performer-${t.id}`}>
                        <PerfIcon className="w-3.5 h-3.5" /> {perf.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-[#2D3A33] whitespace-nowrap">{t.duration_min} min</td>
                    <td className="px-5 py-3 text-right text-sm font-medium text-[#2D3A33] whitespace-nowrap">{formatCatalogPrice(t.price_idr)}</td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => toggleActive(t)}
                          className="inline-flex items-center gap-1.5"
                          title={t.active ? "Visible in public booking" : "Hidden from public booking"}
                          data-testid={`treatment-toggle-${t.id}`}
                        >
                          <span className={`bl-chip text-[10px] py-0.5 ${t.active ? "success" : ""}`}>
                            {t.active ? "Online" : "Hidden"}
                          </span>
                          {t.active ? (
                            <ToggleRight className="w-4 h-4 shrink-0" style={{ color: "var(--bl-primary)" }} />
                          ) : (
                            <ToggleLeft className="w-4 h-4 shrink-0 text-[#A89F8B]" />
                          )}
                        </button>
                      ) : (
                        <span
                          className={`bl-chip text-[10px] ${t.active ? "success" : ""}`}
                          title={t.active ? "Visible in public booking" : "Hidden from public booking"}
                        >
                          {t.active ? "Online" : "Hidden"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {canManage && (
                        <TreatmentRowActions
                          treatment={t}
                          onEdit={setEditing}
                          onDelete={remove}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
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
        label="treatment"
        testIdPrefix="treatments"
      />

      {editing !== null && (
        <EditorModal
          initial={editing.id ? editing : null}
          categoryOptions={categoryFilters}
          taxIncludedDefault={taxIncludedDefault}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(q, filter, page); }}
        />
      )}
    </div>
  );
}
