import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can, hasPermission, ROLE_LABEL } from "@/lib/auth";
import { useClinic, hasFeature } from "@/lib/clinic";
import { useSettings } from "@/lib/settings";
import {
  visitClinicalPerformers,
  visitPerformerRoles,
  treatmentAllowedForVisitRoles,
} from "@/lib/visitUi";
import { Plus, Trash2 } from "lucide-react";
import ProductUsageSelector, { CUSTOM_PRODUCT_ID, productUsageName } from "@/components/visit/ProductUsageSelector";
import { bookedTreatmentLabel, bookedTreatmentReference, hasConfirmedBookedTreatment, performedTreatmentItems } from "@/lib/visitWorkflow";
import { primaryAndAdditionalPerformers } from "@/lib/visitUi";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function parseNum(val, fallback) {
  const n = parseFloat(String(val ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function emptyForm(units, performerId = "") {
  return {
    category: "all",
    name: "",
    product_used: "",
    productUsage: null,
    area_treated: "",
    quantity: "1",
    unit_type: units[0] || "session",
    notes: "",
    price: "0",
    performer_id: performerId,
  };
}

export default function TreatmentItems({ visit, onSaved, workflowMode = false }) {
  const { user } = useAuth();
  const { clinic, loading: clinicLoading } = useClinic();
  const { settings } = useSettings();
  const treatmentsEnabled = !clinicLoading && hasFeature(clinic, "emr");
  const UNITS = settings?.form_config?.treatment_units || ["session"];
  const editable = can(user, "add_treatment");
  const canSeePrice = Boolean(
    user && (
      user.platform_admin
      || user.role === "super_admin"
      || user.role === "fo"
      || user.role === "manager"
      || hasPermission(user, "billing.view")
    ),
  );
  const [catalog, setCatalog] = useState([]);
  const [categoryFacets, setCategoryFacets] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(() => emptyForm(UNITS));
  const [showTreatmentPicker, setShowTreatmentPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const bookedRef = bookedTreatmentReference(visit);
  const bookedLabel = bookedRef?.name || bookedTreatmentLabel(visit);
  const { primary, additional } = primaryAndAdditionalPerformers(visit);
  const performedItems = performedTreatmentItems(visit);
  const items = performedItems;
  const bookedAlreadyConfirmed = hasConfirmedBookedTreatment(visit);
  const inventoryDeductionEnabled = Boolean(clinic?.settings?.inventory_deduct_on_usage ?? clinic?.inventory_deduct_on_usage);
  const usageByTreatment = useMemo(() => {
    const map = new Map();
    for (const u of visit.product_usages || []) {
      if (u.status === "active" && u.treatment_item_id) map.set(u.treatment_item_id, u);
    }
    return map;
  }, [visit.product_usages]);
  const visitRoles = useMemo(() => visitPerformerRoles(visit), [visit]);
  const visitPerformers = useMemo(() => visitClinicalPerformers(visit), [visit]);
  const multiPerformer = visitPerformers.length > 1;

  const roleCatalog = useMemo(() => {
    return catalog.filter((t) => treatmentAllowedForVisitRoles(t, visitRoles));
  }, [catalog, visitRoles]);

  useEffect(() => {
    if (!treatmentsEnabled) {
      setCatalog([]);
      setCategoryFacets([]);
      setLoadingCatalog(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      try {
        const r = await api.get("/treatments-catalog", {
          params: { active_only: true, include_facets: true },
        });
        if (cancelled) return;
        const data = r.data;
        const items = Array.isArray(data) ? data : data?.items || [];
        const facets = Array.isArray(data) ? [] : data?.facets;
        setCatalog(items);
        setCategoryFacets(Array.isArray(facets) ? facets : []);
      } catch {
        if (!cancelled) {
          setCatalog([]);
          setCategoryFacets([]);
        }
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [treatmentsEnabled]);

  const categoryFilters = useMemo(() => {
    if (categoryFacets.length) {
      return categoryFacets.filter((c) => roleCatalog.some((t) => (t.category || "Other") === c));
    }
    return [...new Set(roleCatalog.map((t) => t.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [categoryFacets, roleCatalog]);

  const filteredCatalog = useMemo(() => {
    if (!form.category || form.category === "all") return roleCatalog;
    return roleCatalog.filter((t) => (t.category || "Other") === form.category);
  }, [roleCatalog, form.category]);

  const catalogByCategory = useMemo(() => {
    const map = new Map();
    for (const t of filteredCatalog) {
      const cat = t.category || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredCatalog]);

  const selectedTreatment = roleCatalog.find((t) => t.id === selectedId);

  const eligiblePerformersForTreatment = useMemo(() => {
    if (!selectedTreatment) return visitPerformers;
    const allowed = selectedTreatment.allowed_performer_roles;
    if (Array.isArray(allowed) && allowed.length) {
      return visitPerformers.filter((p) =>
        allowed.includes((p.staff_role_snapshot || "").toLowerCase()),
      );
    }
    return visitPerformers;
  }, [selectedTreatment, visitPerformers]);

  const onCategoryChange = (category) => {
    const t = roleCatalog.find((x) => x.id === selectedId);
    const clearTreatment =
      t && category !== "all" && (t.category || "Other") !== category;
    if (clearTreatment) setSelectedId("");
    setForm((f) => ({
      ...f,
      category,
      ...(clearTreatment ? { name: "", price: "0" } : {}),
    }));
  };

  const onSelectTreatment = (id) => {
    setSelectedId(id);
    const t = roleCatalog.find((x) => x.id === id);
    if (!t) {
      setForm((f) => ({ ...f, name: "", price: "0", performer_id: "" }));
      return;
    }
    let eligible = visitPerformers;
    if (Array.isArray(t.allowed_performer_roles) && t.allowed_performer_roles.length) {
      eligible = visitPerformers.filter((p) =>
        t.allowed_performer_roles.includes((p.staff_role_snapshot || "").toLowerCase()),
      );
    }
    const defaultPerformer = eligible.length === 1 ? eligible[0].staff_id : "";
    setForm((f) => ({
      ...f,
      name: t.name,
      category: t.category || "Other",
      price: String(Number(t.price_idr) || 0),
      performer_id: defaultPerformer || f.performer_id,
    }));
  };

  const resetForm = () => {
    setSelectedId("");
    setPickerMode(null);
    setShowTreatmentPicker(false);
    const defaultPid = visitPerformers.length === 1 ? visitPerformers[0].staff_id : "";
    setForm(emptyForm(UNITS, defaultPid));
  };

  const openPicker = (mode) => {
    setSelectedId("");
    const defaultPid = visitPerformers.length === 1 ? visitPerformers[0].staff_id : "";
    setForm(emptyForm(UNITS, defaultPid));
    setPickerMode(mode);
    setShowTreatmentPicker(true);
  };

  const confirmBooked = async () => {
    if (bookedAlreadyConfirmed) {
      toast.error("Booked treatment is already recorded as performed");
      return;
    }
    setConfirmBusy(true);
    try {
      await api.post(`/visits/${visit.id}/treatments/confirm-booked`);
      toast.success("Booked treatment recorded as performed");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to confirm treatment");
    } finally {
      setConfirmBusy(false);
    }
  };

  const qtyNum = parseNum(form.quantity, 1);
  const priceNum = parseNum(form.price, 0);
  const lineTotal = qtyNum * priceNum;

  const add = async (e) => {
    e.preventDefault();
    const treatmentName = form.name.trim() || bookedLabel.trim();
    if (!treatmentName) {
      toast.error(workflowMode ? "Booked treatment is missing — use Change treatment" : "Select a treatment from the catalog");
      return;
    }
    if (multiPerformer && !form.performer_id) {
      toast.error("Select which staff member performed this treatment");
      return;
    }
    const quantity = parseNum(form.quantity, NaN);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Enter a valid quantity greater than 0");
      return;
    }
    try {
      const category =
        form.category && form.category !== "all"
          ? form.category
          : selectedTreatment?.category || "Other";

      const pu = form.productUsage;
      const hasInventoryProduct = pu?.product_id && pu.product_id !== CUSTOM_PRODUCT_ID && !pu?.is_custom;
      const hasCustomProduct = pu?.is_custom || pu?.product_id === CUSTOM_PRODUCT_ID;
      const customName = (pu?.custom_name || "").trim();
      if (workflowMode && !showTreatmentPicker && !hasInventoryProduct && !hasCustomProduct && !form.product_used?.trim()) {
        toast.error("Select a product or add a custom product");
        return;
      }
      if (hasCustomProduct && !customName) {
        toast.error("Enter a custom product name");
        return;
      }
      const qtyUsed = hasInventoryProduct
        ? parseNum(workflowMode ? form.quantity : pu.quantity_used, NaN)
        : NaN;
      if (hasInventoryProduct && (!Number.isFinite(qtyUsed) || qtyUsed <= 0)) {
        toast.error("Enter a valid product quantity used");
        return;
      }

      const body = {
        category,
        name: treatmentName,
        product_used: hasInventoryProduct
          ? (pu.product?.name || "")
          : hasCustomProduct
            ? customName
            : (form.product_used || ""),
        area_treated: form.area_treated || "",
        quantity,
        unit_type: form.unit_type,
        notes: form.notes || "",
        price: parseNum(form.price, 0),
        performer_id: form.performer_id || undefined,
        source: pickerMode === "additional" ? "additional" : "manual",
        confirmed_by_staff: true,
      };
      if (hasInventoryProduct) {
        body.product_id = pu.product_id;
        body.quantity_used = qtyUsed;
        body.dose_notes = pu.dose_notes || "";
      }

      await api.post(`/visits/${visit.id}/treatments`, body);
      toast.success("Treatment added");
      resetForm();
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const del = async (id) => {
    try {
      await api.delete(`/visits/${visit.id}/treatments/${id}`);
      onSaved?.();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      {editable && (
        <form onSubmit={add} className="bl-card p-5" data-testid="treatment-form">
          {workflowMode ? (
            <>
              {bookedRef && (
                <div className="bl-card p-4 bg-[#F8F5EC] border-[#EAE6D7] mb-4" data-testid="booked-treatment-banner">
                  <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Booked treatment</div>
                  <div className="font-medium text-[#2D3A33] mt-1">{bookedRef.name}</div>
                  {bookedRef.durationMin != null && (
                    <div className="text-sm text-[#5C6C62] mt-2">Duration: {bookedRef.durationMin} min</div>
                  )}
                  {bookedRef.notes && (
                    <div className="text-sm text-[#5C6C62] mt-2">Booking note: {bookedRef.notes}</div>
                  )}
                  {primary && (
                    <div className="text-sm text-[#5C6C62] mt-2">
                      Assigned staff: {primary.staff_name_snapshot}
                      {primary.staff_role_snapshot ? ` (${ROLE_LABEL[primary.staff_role_snapshot] || primary.staff_role_snapshot})` : ""}
                    </div>
                  )}
                  {additional.length > 0 && (
                    <div className="text-sm text-[#5C6C62] mt-1">
                      Additional: {additional.map((p) => p.staff_name_snapshot).filter(Boolean).join(", ")}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      type="button"
                      className="bl-btn-primary text-sm"
                      onClick={confirmBooked}
                      disabled={confirmBusy || bookedAlreadyConfirmed || !editable}
                      data-testid="treatment-use-booked"
                    >
                      {bookedAlreadyConfirmed ? "Booked treatment confirmed" : "Use as performed treatment"}
                    </button>
                    <button
                      type="button"
                      className="bl-btn-secondary text-sm"
                      onClick={() => openPicker("change")}
                      data-testid="treatment-change-treatment"
                    >
                      Change treatment
                    </button>
                    <button
                      type="button"
                      className="bl-btn-secondary text-sm"
                      onClick={() => openPicker("additional")}
                      data-testid="treatment-add-additional"
                    >
                      Add additional treatment
                    </button>
                  </div>
                </div>
              )}
              {showTreatmentPicker && (
                <div className="mb-4">
                  <div className="font-display text-base text-[#2D3A33] mb-1">
                    {pickerMode === "additional" ? "Add additional treatment" : "Record performed treatment"}
                  </div>
                  <p className="text-sm text-[#5C6C62] mb-3">
                    {pickerMode === "additional"
                      ? "Select an extra treatment performed during this session."
                      : "Select the treatment actually performed. The booked treatment stays as reference only."}
                  </p>
                  <button
                    type="button"
                    className="text-sm text-[var(--bl-primary)] underline-offset-2 hover:underline"
                    onClick={() => {
                      setShowTreatmentPicker(false);
                      setPickerMode(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="font-display text-base text-[#2D3A33] mb-1">Add treatment item</div>
              <p className="text-sm text-[#5C6C62] mb-4">
                Add the treatment performed during this treatment session. Include area, quantity, product used, and notes if needed.
                {visitRoles.size > 0 && (
                  <> Only treatments allowed for {[...visitRoles].join(", ")} assigned staff on this treatment session are shown.</>
                )}
              </p>
            </>
          )}

          {(!workflowMode || showTreatmentPicker) && (loadingCatalog ? (
            <p className="text-sm text-[#5C6C62]">Loading treatments…</p>
          ) : catalog.length === 0 ? (
            <p className="text-sm text-[#5C6C62]">
              No active treatments in the catalog. Add treatments under <strong>Treatments</strong> in the sidebar first.
            </p>
          ) : roleCatalog.length === 0 ? (
            <p className="text-sm text-[#5C6C62]">
              No catalog treatments match the staff role(s) on this treatment session. Check treatment allowed roles in Admin → Treatments.
            </p>
          ) : (
            <>
            <div
              className="mb-4 flex gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit max-w-full overflow-x-auto"
              data-testid="treatment-category-filter"
            >
              <button
                type="button"
                onClick={() => onCategoryChange("all")}
                className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap"
                style={
                  form.category === "all"
                    ? { background: "white", color: "#2D3A33" }
                    : { color: "#5C6C62" }
                }
                data-testid="treatment-category-all"
              >
                All
              </button>
              {categoryFilters.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => onCategoryChange(c)}
                  className="px-4 py-1.5 rounded-lg text-sm whitespace-nowrap"
                  style={
                    form.category === c
                      ? { background: "white", color: "#2D3A33" }
                      : { color: "#5C6C62" }
                  }
                  data-testid={`treatment-category-${c}`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="md:col-span-2 lg:col-span-3">
                <label className="label-eyebrow block mb-1.5">Treatment</label>
                <select
                  className="bl-input"
                  required
                  value={selectedId}
                  onChange={(e) => onSelectTreatment(e.target.value)}
                  data-testid="treatment-catalog-select"
                >
                  <option value="">
                    {filteredCatalog.length === 0
                      ? "No treatments in this category"
                      : "Select treatment…"}
                  </option>
                  {form.category && form.category !== "all"
                    ? filteredCatalog.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{canSeePrice ? ` · ${fmtIDR(t.price_idr)}` : ""}
                        </option>
                      ))
                    : catalogByCategory.map(([cat, list]) => (
                        <optgroup key={cat} label={cat}>
                          {list.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}{canSeePrice ? ` · ${fmtIDR(t.price_idr)}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                </select>
                {selectedTreatment?.sub_category && (
                  <div className="text-xs text-[#5C6C62] mt-1.5">
                    Subcategory: {selectedTreatment.sub_category}
                  </div>
                )}
              </div>

              {multiPerformer && (
                <div className="md:col-span-2 lg:col-span-3">
                  <label className="label-eyebrow block mb-1.5">Performed by</label>
                  <select
                    className="bl-input"
                    required
                    value={form.performer_id}
                    onChange={(e) => setForm({ ...form, performer_id: e.target.value })}
                    data-testid="treatment-performer-select"
                  >
                    <option value="">Select assigned staff…</option>
                    {(selectedTreatment ? eligiblePerformersForTreatment : visitPerformers).map((p) => (
                      <option key={p.staff_id} value={p.staff_id}>
                        {p.staff_name_snapshot || p.staff_id}
                        {p.staff_role_snapshot ? ` (${ROLE_LABEL[p.staff_role_snapshot] || p.staff_role_snapshot})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label-eyebrow block mb-1.5">Area treated</label>
                <input
                  className="bl-input"
                  placeholder="e.g. forehead, full face"
                  value={form.area_treated}
                  onChange={(e) => setForm({ ...form, area_treated: e.target.value })}
                  data-testid="treatment-area"
                />
              </div>

              <div>
                <label className="label-eyebrow block mb-1.5">Quantity</label>
                <div className="flex gap-2">
                  <input
                    className="bl-input flex-1 min-w-[4rem]"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    data-testid="treatment-qty"
                  />
                  <select
                    className="bl-input w-28"
                    value={form.unit_type}
                    onChange={(e) => setForm({ ...form, unit_type: e.target.value })}
                    data-testid="treatment-unit"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTreatment && canSeePrice && (
                  <div className="text-xs text-[#5C6C62] mt-1.5">
                    Line total: {fmtIDR(lineTotal)} ({qtyNum} × {fmtIDR(priceNum)})
                  </div>
                )}
              </div>

              {canSeePrice && (
              <div>
                <label className="label-eyebrow block mb-1.5">Price per unit (IDR)</label>
                <input
                  className="bl-input font-mono"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  data-testid="treatment-price"
                />
                <div className="text-xs text-[#5C6C62] mt-1">{fmtIDR(priceNum)} each</div>
              </div>
              )}

              <div className="md:col-span-2">
                <label className="label-eyebrow block mb-1.5">Inventory product used (optional)</label>
                <ProductUsageSelector
                  value={form.productUsage}
                  onChange={(productUsage) => setForm({ ...form, productUsage })}
                  testId="treatment-product-usage"
                  allowCustom
                />
                {inventoryDeductionEnabled && form.productUsage?.product && !form.productUsage?.is_custom && (
                  <p className="text-xs text-[#5C6C62] mt-2" data-testid="treatment-stock-hint">
                    Stock will be deducted on save. Current stock:{" "}
                    {Number(form.productUsage.product.current_stock) || 0}{" "}
                    {form.productUsage.product.unit || "pcs"}
                    {Number(form.productUsage.quantity_used) > Number(form.productUsage.product.current_stock) && (
                      <span className="text-[#B14A2C] font-medium"> — insufficient stock</span>
                    )}
                  </p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="label-eyebrow block mb-1.5">Notes (optional)</label>
                <input
                  className="bl-input"
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  data-testid="treatment-notes"
                />
              </div>
            </div>

          {(roleCatalog.length > 0) && (
            <button type="submit" className="bl-btn-primary mt-4 inline-flex items-center gap-2" data-testid="treatment-add">
              <Plus className="w-4 h-4" />
              {workflowMode && pickerMode === "additional" ? "Add additional item" : "Add item"}
            </button>
          )}
            </>
          ))}
        </form>
      )}

      {editable && workflowMode && !bookedRef && (
        <div className="bl-card p-5">
          <p className="text-sm text-[#5C6C62] mb-3">
            No booked treatment on this visit. Record what was actually performed.
          </p>
          <button type="button" className="bl-btn-primary text-sm" onClick={() => openPicker("change")}>
            Record performed treatment
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="bl-card p-8 text-center text-[#5C6C62] md:hidden" data-testid="treatment-items-empty">
          {workflowMode ? "No performed treatments recorded yet" : "No treatment items added"}
        </div>
      )}

      <div className="md:hidden space-y-3" data-testid="treatment-items-mobile">
        {items.map((it) => {
          const usage = usageByTreatment.get(it.id);
          const treatmentName = it.name || bookedLabel || "—";
          const productLabel = productUsageName(usage, it.product_used);
          const qtyLabel = `${Number(it.quantity ?? 1)} ${it.unit_type || "session"}`;
          const lineTotal = Number(it.price || 0) * Number(it.quantity || 1);
          return (
            <div key={it.id} className="bl-card p-4 space-y-3" data-testid={`treatment-card-${it.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="label-eyebrow">Treatment</div>
                  <div className="font-medium text-[#2D3A33]">{treatmentName}</div>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => del(it.id)}
                    className="text-[#B14A2C] p-2 -mr-2 shrink-0"
                    aria-label="Delete item"
                    data-testid={`treatment-delete-${it.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="label-eyebrow text-[10px]">Product</div>
                  <div className="text-[#2D3A33]">{productLabel || "—"}</div>
                </div>
                <div>
                  <div className="label-eyebrow text-[10px]">Area</div>
                  <div className="text-[#5C6C62]">{it.area_treated || "—"}</div>
                </div>
                <div>
                  <div className="label-eyebrow text-[10px]">Qty</div>
                  <div className="text-[#5C6C62]">{qtyLabel}</div>
                </div>
                {canSeePrice && (
                  <div>
                    <div className="label-eyebrow text-[10px]">Total</div>
                    <div className="font-medium text-[#2D3A33]">{fmtIDR(lineTotal)}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block bl-card overflow-hidden rounded-xl" data-testid="treatment-items-table">
        {workflowMode && (
          <div className="px-5 py-3 border-b border-[#EAE6D7] bg-[#F8F5EC]">
            <div className="label-eyebrow">Performed treatments</div>
          </div>
        )}
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-[#F8F5EC]">
              <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                {workflowMode ? (
                  <>
                    <th className="px-5 py-3" data-testid="treatment-col-header">Treatment</th>
                    <th className="px-5 py-3">Product</th>
                    <th className="px-5 py-3">Area</th>
                    <th className="px-5 py-3">Qty</th>
                    {canSeePrice && <th className="px-5 py-3 text-right">Total</th>}
                    <th className="px-5 py-3 text-right">Actions</th>
                  </>
                ) : (
                  <>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Product</th>
                    <th className="px-5 py-3">Area</th>
                    <th className="px-5 py-3">Staff</th>
                    <th className="px-5 py-3">Qty</th>
                    {canSeePrice && <th className="px-5 py-3 text-right">Price</th>}
                    <th className="px-5 py-3"></th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      workflowMode
                        ? 4 + (canSeePrice ? 1 : 0) + 1
                        : 6 + (canSeePrice ? 1 : 0) + 1
                    }
                    className="text-center py-8 text-[#5C6C62]"
                  >
                    {workflowMode ? "No performed treatments recorded yet" : "No treatment items added"}
                  </td>
                </tr>
              )}
              {items.map((it) => {
                const usage = usageByTreatment.get(it.id);
                const treatmentName = it.name || bookedLabel || "—";
                const productLabel = productUsageName(usage, it.product_used);
                const qtyLabel = `${Number(it.quantity ?? 1)} ${it.unit_type || "session"}`;
                const lineTotal = Number(it.price || 0) * Number(it.quantity || 1);
                return (
                <tr key={it.id} className="border-t border-[#EAE6D7]" data-testid={`treatment-row-${it.id}`}>
                  {workflowMode ? (
                    <>
                      <td className="px-5 py-3 font-medium text-[#2D3A33]" data-testid={`treatment-row-treatment-${it.id}`}>
                        {treatmentName}
                        {it.source === "additional" && (
                          <span className="ml-2 bl-chip text-[10px]">Additional</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#2D3A33]" data-testid={`treatment-row-product-${it.id}`}>
                        {productLabel}
                        {usage?.dose_notes && (
                          <div className="text-xs text-[#5C6C62] mt-0.5">{usage.dose_notes}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#5C6C62]">{it.area_treated || "—"}</td>
                      <td className="px-5 py-3 text-[#5C6C62]">{qtyLabel}</td>
                      {canSeePrice && (
                        <td className="px-5 py-3 text-right font-medium">{fmtIDR(lineTotal)}</td>
                      )}
                      <td className="px-5 py-3 text-right">
                        {editable && (
                          <button
                            type="button"
                            onClick={() => del(it.id)}
                            className="text-[#B14A2C] hover:text-[#8a3a22]"
                            aria-label="Delete item"
                            data-testid={`treatment-delete-${it.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-3">
                        <span className="bl-chip">{it.category}</span>
                      </td>
                      <td className="px-5 py-3 font-medium">{it.name}</td>
                      <td className="px-5 py-3 font-medium text-[#2D3A33]">
                        {productUsageName(usage, it.product_used) || "—"}
                        {usage?.dose_notes && (
                          <div className="text-xs text-[#5C6C62] mt-0.5 font-normal">{usage.dose_notes}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#5C6C62]">{it.area_treated || "—"}</td>
                      <td className="px-5 py-3 text-[#5C6C62]">
                        {it.performer_name_snapshot
                          ? `${it.performer_name_snapshot}${it.performer_role_snapshot ? ` (${ROLE_LABEL[it.performer_role_snapshot] || it.performer_role_snapshot})` : ""}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-[#5C6C62]">{qtyLabel}</td>
                      {canSeePrice && (
                        <td className="px-5 py-3 text-right font-medium">{fmtIDR(lineTotal)}</td>
                      )}
                      <td className="px-5 py-3 text-right">
                        {editable && (
                          <button
                            type="button"
                            onClick={() => del(it.id)}
                            className="text-[#B14A2C] hover:text-[#8a3a22]"
                            data-testid={`treatment-delete-${it.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
