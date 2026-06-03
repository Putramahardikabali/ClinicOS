import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Edit2, X, Download, Upload, FileSpreadsheet, MoreHorizontal, History, Boxes, Settings2 } from "lucide-react";
import { InventorySettingsTab } from "@/pages/admin/settingsTabs";
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

const PRODUCT_TYPES = [
  "Injectable",
  "Treatment product",
  "Consumable",
  "Machine consumable",
  "Clinic supply",
  "Retail product",
  "Other",
];

const UNITS = [
  "pcs",
  "box",
  "bottle",
  "vial",
  "syringe",
  "ml",
  "g",
  "pack",
  "unit",
  "other",
];

const STOCK_STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "in", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
];

const fmtIDR = (n) => (Number(n) > 0 ? `Rp ${Number(n).toLocaleString("id-ID")}` : "—");

const DEFAULT_FORM = {
  product_code: "",
  name: "",
  brand: "",
  category: "Default",
  product_type: "Consumable",
  sale_price_idr: "",
  cost_price_idr: "",
  pos_enabled: true,
  track_stock: true,
  current_stock: 0,
  minimum_stock: 0,
  unit: "pcs",
  notes: "",
  active: true,
};

function normalizeForm(initial) {
  if (!initial) return { ...DEFAULT_FORM };
  return {
    ...DEFAULT_FORM,
    ...initial,
    product_code: initial.product_code || initial.key || "",
    category: initial.category || "Default",
    sale_price_idr: initial.sale_price_idr ? String(initial.sale_price_idr) : "",
    cost_price_idr: initial.cost_price_idr ? String(initial.cost_price_idr) : "",
    pos_enabled: initial.pos_enabled !== false,
    track_stock: initial.track_stock !== false,
    current_stock: Number(initial.current_stock) || 0,
    minimum_stock: Number(initial.minimum_stock) || 0,
    unit: initial.unit || "pcs",
    notes: initial.notes || "",
  };
}

function categoryExists(name, list) {
  const n = (name || "").trim().toLowerCase();
  return list.some((c) => c.trim().toLowerCase() === n);
}

function stockStatus(p) {
  const cur = Number(p.current_stock) || 0;
  const min = Number(p.minimum_stock) || 0;
  if (cur === 0) return { label: "Out of stock", key: "out" };
  if (cur <= min) return { label: "Low stock", key: "low" };
  return { label: "In stock", key: "in" };
}

function stockStatusChipClass(key) {
  if (key === "out") return "text-[#B14A2C] bg-[#FAE5DC] border border-[#F0C4B8]";
  if (key === "low") return "text-[#8A6A1F] bg-[#FFF8E7] border border-[#E8D9A0]";
  return "success";
}

function productSecondaryLine(p) {
  const parts = [p.brand, p.category].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function formatLastUpdated(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
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

function ProductRowActions({ product, onEdit, onDelete, onHistory }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="inline-flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onHistory?.(product)}
        className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 hover:bg-[#F3F1EB] border border-transparent hover:border-[#EAE6D7]"
        data-testid={`product-history-${product.id}`}
      >
        <History className="w-3.5 h-3.5" /> History
      </button>
      <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="p-1.5 rounded-lg text-[#5C6C62] hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
            aria-label="More actions"
            data-testid={`product-menu-${product.id}`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onEdit(product)}>
            Edit…
          </DropdownMenuItem>
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
              onSelect={() => onDelete(product)}
            >
              Confirm delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StockMovementsModal({ product, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/products-catalog/${product.id}/stock-movements`, { params: { limit: 50 } });
        if (!cancelled) setRows(Array.isArray(r.data) ? r.data : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [product.id]);

  const fmtQty = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v > 0 ? `+${v}` : String(v);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" data-testid="stock-movements-modal">
      <div className="bl-card w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[#EAE6D7]">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">Stock movement history</div>
            <div className="text-sm text-[#5C6C62] mt-1">{product.name}</div>
          </div>
          <button type="button" onClick={onClose} className="text-[#5C6C62] hover:text-[#2D3A33]"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-[#5C6C62]">No stock movements yet.</p>}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-[#5C6C62] text-left">
                <tr>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Change</th>
                  <th className="pb-2 text-right">Stock</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t border-[#EAE6D7]">
                    <td className="py-2 text-[#5C6C62] whitespace-nowrap">{formatLastUpdated(m.created_at)}</td>
                    <td className="py-2 capitalize">{String(m.movement_type || "").replace(/_/g, " ")}</td>
                    <td className={`py-2 text-right font-mono ${Number(m.quantity_change) < 0 ? "text-[#B14A2C]" : "text-[#2D6A4F]"}`}>{fmtQty(m.quantity_change)}</td>
                    <td className="py-2 text-right font-mono">{Number(m.new_stock)}</td>
                    <td className="py-2 text-[#5C6C62]">{m.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorModal({ initial, onClose, onSaved, categoryOptions = [] }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(() => normalizeForm(initial));
  const [busy, setBusy] = useState(false);
  const initialCategory = (initial?.category || form.category || "").trim();
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

  const categorySelectValue = creatingCategory ? CREATE_CATEGORY : (form.category || "");

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
        product_code: form.product_code.trim(),
        name: form.name.trim(),
        brand: form.brand.trim(),
        category,
        product_type: form.product_type,
        current_stock: Math.max(0, Number(form.current_stock) || 0),
        minimum_stock: Math.max(0, Number(form.minimum_stock) || 0),
        unit: form.unit || "pcs",
        notes: form.notes.trim(),
        active: form.active,
        sale_price_idr: form.sale_price_idr === "" ? null : Math.max(0, parseInt(String(form.sale_price_idr).replace(/\D/g, ""), 10) || 0),
        cost_price_idr: form.cost_price_idr === "" ? null : Math.max(0, parseInt(String(form.cost_price_idr).replace(/\D/g, ""), 10) || 0),
        pos_enabled: form.pos_enabled,
        track_stock: form.track_stock,
      };
      if (editing) await api.put(`/products-catalog/${initial.id}`, payload);
      else await api.post("/products-catalog", payload);
      toast.success(editing ? "Product updated" : "Product added");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="product-editor">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col">
        <div className="p-6 pb-0 flex items-center justify-between shrink-0">
          <h3 className="font-display text-xl text-[#2D3A33]">{editing ? "Edit product" : "New product"}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="product-editor-close"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 mt-4" data-testid="product-editor-form">
          <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4">
            <div className="space-y-3">
              <div className="label-eyebrow text-[#5C6C62]">Product details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Product code</label>
                  <input className="bl-input font-mono" value={form.product_code} onChange={e => set({ product_code: e.target.value })} placeholder="e.g. BLP00001" data-testid="product-code" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Product name</label>
                  <input className="bl-input" value={form.name} onChange={e => set({ name: e.target.value })} required data-testid="product-name" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Brand</label>
                  <input className="bl-input" value={form.brand} onChange={e => set({ brand: e.target.value })} data-testid="product-brand" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Product type</label>
                  <select className="bl-input" value={form.product_type} onChange={e => set({ product_type: e.target.value })} data-testid="product-type">
                    {PRODUCT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    {!PRODUCT_TYPES.includes(form.product_type) && form.product_type && (
                      <option value={form.product_type}>{form.product_type}</option>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Category</label>
                <select
                  className="bl-input"
                  value={categorySelectValue}
                  onChange={(e) => handleCategorySelect(e.target.value)}
                  data-testid="product-category"
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
                    data-testid="product-category-new"
                  />
                )}
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Retail / POS</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Sale price (IDR)</label>
                  <input
                    className="bl-input font-mono"
                    value={form.sale_price_idr}
                    onChange={(e) => set({ sale_price_idr: e.target.value })}
                    placeholder="Optional — for POS"
                    data-testid="product-sale-price"
                  />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Cost price (IDR)</label>
                  <input
                    className="bl-input font-mono"
                    value={form.cost_price_idr}
                    onChange={(e) => set({ cost_price_idr: e.target.value })}
                    placeholder="Optional"
                    data-testid="product-cost-price"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.pos_enabled} onChange={(e) => set({ pos_enabled: e.target.checked })} data-testid="product-pos-enabled" />
                  Available in POS
                </label>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.track_stock} onChange={(e) => set({ track_stock: e.target.checked })} data-testid="product-track-stock" />
                  Track stock
                </label>
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Stock</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Current stock</label>
                  <input type="number" min="0" step="1" className="bl-input font-mono" value={form.current_stock} onChange={e => set({ current_stock: Number(e.target.value) })} data-testid="product-current-stock" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Unit</label>
                  <select className="bl-input" value={form.unit} onChange={e => set({ unit: e.target.value })} data-testid="product-unit">
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    {!UNITS.includes(form.unit) && form.unit && (
                      <option value={form.unit}>{form.unit}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Minimum stock</label>
                  <input type="number" min="0" step="1" className="bl-input font-mono" value={form.minimum_stock} onChange={e => set({ minimum_stock: Number(e.target.value) })} data-testid="product-minimum-stock" />
                </div>
              </div>
              <p className="text-xs text-[#5C6C62]">Low stock when current stock is at or below the minimum. Out of stock when current stock is 0.</p>
            </div>

            <div className="space-y-3 pt-1 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Notes &amp; status</div>
              <div>
                <label className="label-eyebrow block mb-1.5">Notes</label>
                <textarea className="bl-input min-h-[72px]" value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Shelf location, supplier, handling notes…" data-testid="product-notes" />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} data-testid="product-active" />
                Active in clinic
              </label>
            </div>
          </div>

          <div className="shrink-0 p-6 pt-4 border-t border-[#EAE6D7] bg-white rounded-b-3xl">
            <button type="submit" disabled={busy} className="bl-btn-primary w-full disabled:opacity-50" data-testid="product-save">{busy ? "Saving…" : editing ? "Save changes" : "Add product"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const PRODUCT_PAGE_TABS = [
  { key: "catalog", label: "Product Catalog", icon: Boxes },
  { key: "inventory-settings", label: "Inventory Settings", icon: Settings2 },
];

export default function ProductsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl === "inventory-settings" ? "inventory-settings" : "catalog";
  const setActiveTab = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key === "catalog") next.delete("tab");
    else next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stockStatusFilter, setStockStatusFilter] = useState("all");
  const [categoryFacets, setCategoryFacets] = useState([]);
  const [editing, setEditing] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const canManage = hasPermission(user, "products.manage");
  const readOnly = user?.role === "fo";

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback((qq, cat, type, stockStatus, pg) => {
    setLoading(true);
    const params = { page: pg, page_size: PAGE_SIZE };
    if (qq) params.q = qq;
    if (cat && cat !== "all") params.category = cat;
    if (type && type !== "all") params.product_type = type;
    if (stockStatus && stockStatus !== "all") params.stock_status = stockStatus;
    return api.get("/products-catalog", { params })
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
    load(q, categoryFilter, typeFilter, stockStatusFilter, page);
  }, [q, categoryFilter, typeFilter, stockStatusFilter, page, load]);

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      await downloadFile("/products-catalog/export?format=xlsx", "products.xlsx");
      toast.success("Products exported");
    } catch (e) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleTemplate = async () => {
    try {
      await downloadFile("/products-catalog/import-template?format=xlsx", "products-import-template.xlsx");
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
      const r = await api.post("/products-catalog/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const { created, updated, errors, total: totalRows } = r.data || {};
      const errCount = (errors || []).length;
      if (errCount) {
        toast.warning(`Imported ${totalRows} rows: ${created} new, ${updated} updated, ${errCount} issue(s)`);
      } else {
        toast.success(`Imported ${totalRows} rows: ${created} new, ${updated} updated`);
      }
      load(q, categoryFilter, typeFilter, stockStatusFilter, 1);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const remove = async (p) => {
    await api.delete(`/products-catalog/${p.id}`);
    toast.success("Product deleted");
    load(q, categoryFilter, typeFilter, stockStatusFilter, page);
  };

  const categoryFilters = categoryFacets.length
    ? categoryFacets
    : [...new Set(rows.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const typeFilters = useMemo(() => {
    const fromRows = rows.map(p => p.product_type).filter(Boolean);
    return [...new Set([...PRODUCT_TYPES, ...fromRows])].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const categoryOptions = useMemo(
    () => [...new Set(["Default", ...categoryFilters])].sort((a, b) => a.localeCompare(b)),
    [categoryFilters],
  );

  const hasFilters = q || categoryFilter !== "all" || typeFilter !== "all" || stockStatusFilter !== "all";
  const emptyMessage = hasFilters
    ? "No products match your search or filters."
    : "No products yet. Add items to start tracking clinic inventory.";

  if (activeTab === "inventory-settings" && canManage) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="products-page">
        <div className="label-eyebrow">Inventory</div>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Products</h1>
        <p className="mt-2 text-sm text-[#5C6C62] max-w-xl">Product catalog and inventory configuration.</p>
        <div className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto pb-px -mx-1 px-1" data-testid="products-tabs">
          {PRODUCT_PAGE_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`}
                style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
                data-testid={`products-tab-${t.key}`}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-80" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="mt-7">
          <InventorySettingsTab />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="products-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Inventory</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Products</h1>
          <p className="mt-2 text-sm text-[#5C6C62] max-w-xl">
            Track clinic inventory — see what items are in stock, running low, or need restocking.
            {readOnly ? " You have read-only access." : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleExport} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="export-products-button">
              <Download className="w-4 h-4" /> Export Excel
            </button>
            <button type="button" onClick={handleTemplate} className="bl-btn-ghost inline-flex items-center gap-2" data-testid="products-template-button">
              <FileSpreadsheet className="w-4 h-4" /> Template
            </button>
            <label className={`bl-btn-ghost inline-flex items-center gap-2 cursor-pointer ${importBusy ? "opacity-50 pointer-events-none" : ""}`} data-testid="import-products-button">
              <Upload className="w-4 h-4" /> {importBusy ? "Importing…" : "Import Excel"}
              <input type="file" accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={handleImport} disabled={importBusy} />
            </label>
            <button type="button" onClick={() => setEditing({})} className="bl-btn-primary inline-flex items-center gap-2" data-testid="add-product-button"><Plus className="w-4 h-4" /> New product</button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-6 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto pb-px -mx-1 px-1" data-testid="products-tabs">
          {PRODUCT_PAGE_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`}
                style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
                data-testid={`products-tab-${t.key}`}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-80" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {readOnly && (
        <div className="mt-4 bl-card px-4 py-3 text-sm text-[#5C6C62]" data-testid="products-readonly-banner">
          View only — contact your clinic manager or owner to add or edit products.
        </div>
      )}

      <SearchFieldBar
        className="mt-6 bl-card p-4"
        placeholder="Search by name, code, brand, category, notes…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        data-testid="products-search-input"
        trailing={(
          <>
            {loading && <span className="text-xs text-[#5C6C62] shrink-0">Loading…</span>}
            {!loading && total > 0 && (
              <span className="text-xs text-[#5C6C62] shrink-0">{total} results</span>
            )}
          </>
        )}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3" data-testid="products-filter">
        <div>
          <label className="label-eyebrow block mb-1.5">Status</label>
          <select
            className="bl-input text-sm min-w-[160px]"
            value={stockStatusFilter}
            onChange={(e) => resetPage(setStockStatusFilter)(e.target.value)}
            data-testid="products-filter-status"
          >
            {STOCK_STATUS_FILTERS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-eyebrow block mb-1.5">Type</label>
          <select
            className="bl-input text-sm min-w-[180px]"
            value={typeFilter}
            onChange={(e) => resetPage(setTypeFilter)(e.target.value)}
            data-testid="products-filter-type"
          >
            <option value="all">All types</option>
            {typeFilters.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-eyebrow block mb-1.5">Category</label>
          <select
            className="bl-input text-sm min-w-[160px]"
            value={categoryFilter}
            onChange={(e) => resetPage(setCategoryFilter)(e.target.value)}
            data-testid="products-filter-category"
          >
            <option value="all">All categories</option>
            {categoryFilters.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 bl-card overflow-hidden" data-testid="products-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3 text-right hidden md:table-cell">Sale price</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3 text-right">Current Stock</th>
                <th className="px-5 py-3">Unit</th>
                <th className="px-5 py-3">Stock Status</th>
                <th className="px-5 py-3">Last Updated</th>
                {canManage && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canManage ? 9 : 8} className="py-10 text-center text-[#5C6C62] text-sm">Loading products…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={canManage ? 9 : 8} className="py-10 text-center text-[#5C6C62] text-sm">{emptyMessage}</td></tr>
              )}
              {!loading && rows.map(p => {
                const secondary = productSecondaryLine(p);
                const status = stockStatus(p);
                return (
                  <tr key={p.id} className="border-t border-[#EAE6D7]" style={{ opacity: p.active ? 1 : 0.55 }} data-testid={`product-row-${p.id}`}>
                    <td className="px-5 py-3 text-xs font-mono text-[#5C6C62] whitespace-nowrap">{p.product_code || p.key}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[#2D3A33]">{p.name}</div>
                      {secondary && <div className="text-xs text-[#5C6C62] mt-0.5">{secondary}</div>}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-mono text-[#5C6C62] whitespace-nowrap hidden md:table-cell">
                      {Number(p.sale_price_idr) > 0 ? fmtIDR(p.sale_price_idr) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-[#2D3A33] whitespace-nowrap">{p.product_type || "—"}</td>
                    <td className="px-5 py-3 text-right text-sm font-medium font-mono text-[#2D3A33] whitespace-nowrap">{Number(p.current_stock) || 0}</td>
                    <td className="px-5 py-3 text-sm text-[#5C6C62] whitespace-nowrap">{p.unit || "pcs"}</td>
                    <td className="px-5 py-3">
                      <span className={`bl-chip text-[10px] py-0.5 ${stockStatusChipClass(status.key)}`} data-testid={`product-stock-status-${p.id}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-[#5C6C62] whitespace-nowrap">{formatLastUpdated(p.stock_updated_at || p.updated_at || p.created_at)}</td>
                    {canManage && (
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <ProductRowActions product={p} onEdit={setEditing} onDelete={remove} onHistory={setHistoryProduct} />
                      </td>
                    )}
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
        label="product"
        testIdPrefix="products"
      />

      {historyProduct && (
        <StockMovementsModal product={historyProduct} onClose={() => setHistoryProduct(null)} />
      )}

      {editing !== null && (
        <EditorModal
          initial={editing.id ? editing : null}
          categoryOptions={categoryOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(q, categoryFilter, typeFilter, stockStatusFilter, page); }}
        />
      )}
    </div>
  );
}
