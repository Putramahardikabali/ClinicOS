import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { X } from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";

export const CUSTOM_PRODUCT_ID = "__custom_product__";

function formatOption(p) {
  const stock = Number(p.current_stock) || 0;
  const unit = p.unit || "pcs";
  const parts = [p.name];
  if (p.brand) parts.push(p.brand);
  if (p.product_code) parts.push(p.product_code);
  return {
    label: parts.filter(Boolean).join(" · "),
    stockLine: `Stock: ${stock} ${unit}`,
    stock,
    unit,
  };
}

export default function ProductUsageSelector({
  value,
  onChange,
  disabled = false,
  testId = "product-usage-selector",
  allowCustom = false,
  hideQuantityFields = false,
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const isCustom = value?.is_custom || value?.product_id === CUSTOM_PRODUCT_ID;
  const selected = !isCustom ? value?.product || null : null;
  const customName = value?.custom_name || "";

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const r = await api.get("/products-catalog", {
        params: { active_only: true, q: q || undefined, page: 1, page_size: 20 },
      });
      const items = Array.isArray(r.data) ? r.data : r.data?.items || [];
      setOptions(items);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => load(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query, open, load]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayLabel = useMemo(() => {
    if (isCustom) return customName || "Custom product";
    if (!selected) return "";
    return formatOption(selected).label;
  }, [isCustom, customName, selected]);

  const pick = (p) => {
    onChange?.({
      product: p,
      product_id: p.id,
      is_custom: false,
      custom_name: "",
      quantity_used: value?.quantity_used ?? "1",
      dose_notes: value?.dose_notes ?? "",
    });
    setQuery("");
    setOpen(false);
  };

  const pickCustom = () => {
    onChange?.({
      product: null,
      product_id: CUSTOM_PRODUCT_ID,
      is_custom: true,
      custom_name: query.trim() || "",
      quantity_used: value?.quantity_used ?? "1",
      dose_notes: value?.dose_notes ?? "",
    });
    setOpen(false);
  };

  const clear = () => {
    onChange?.({
      product: null,
      product_id: "",
      is_custom: false,
      custom_name: "",
      quantity_used: "",
      dose_notes: "",
    });
    setQuery("");
  };

  const hasSelection = Boolean(selected || isCustom);

  return (
    <div ref={wrapRef} className="space-y-2" data-testid={testId}>
      <div className="relative">
        {hasSelection ? (
          <div className="bl-input flex items-center justify-between gap-2 min-h-[42px]">
            <div className="min-w-0">
              <div className="font-medium text-[#2D3A33] truncate">{displayLabel}</div>
              {selected && (
                <div className="text-xs text-[#5C6C62]">{formatOption(selected).stockLine}</div>
              )}
              {isCustom && (
                <div className="text-xs text-[#5C6C62]">Custom product (no inventory link)</div>
              )}
            </div>
            {!disabled && (
              <button type="button" onClick={clear} className="text-[#5C6C62] hover:text-[#B14A2C] shrink-0" aria-label="Clear product">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <>
            <SearchInput
              placeholder="Search product name, code, brand…"
              value={query}
              disabled={disabled}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              data-testid={`${testId}-search`}
            />
          </>
        )}
        {open && !hasSelection && (
          <div className="absolute z-20 mt-1 w-full bl-card border border-[#EAE6D7] shadow-lg max-h-60 overflow-y-auto">
            {loading && <div className="px-4 py-3 text-sm text-[#5C6C62]">Searching…</div>}
            {!loading && options.length === 0 && !allowCustom && (
              <div className="px-4 py-3 text-sm text-[#5C6C62]">No products found</div>
            )}
            {!loading && options.map((p) => {
              const fmt = formatOption(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-4 py-2.5 hover:bg-[#F8F5EC] border-b border-[#EAE6D7] last:border-0"
                  onClick={() => pick(p)}
                  data-testid={`${testId}-option-${p.id}`}
                >
                  <div className="font-medium text-[#2D3A33] text-sm">{p.name}</div>
                  <div className="text-xs text-[#5C6C62] mt-0.5">
                    {[p.brand, p.category, p.product_code].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-xs text-[#5C6C62] mt-0.5">{fmt.stockLine}</div>
                </button>
              );
            })}
            {allowCustom && !loading && (
              <button
                type="button"
                className="w-full text-left px-4 py-3 hover:bg-[#F8F5EC] text-sm font-medium"
                style={{ color: "var(--bl-primary)" }}
                onClick={pickCustom}
                data-testid={`${testId}-add-custom`}
              >
                Add custom product
                {query.trim() ? ` “${query.trim()}”` : ""}
              </button>
            )}
          </div>
        )}
      </div>

      {isCustom && (
        <input
          className="bl-input"
          placeholder="Custom product name"
          disabled={disabled}
          value={customName}
          onChange={(e) => onChange?.({ ...value, custom_name: e.target.value, is_custom: true, product_id: CUSTOM_PRODUCT_ID })}
          data-testid={`${testId}-custom-name`}
        />
      )}

      {selected && !hideQuantityFields && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label-eyebrow block mb-1">Qty used</label>
            <input
              className="bl-input"
              type="number"
              min="0.01"
              step="any"
              disabled={disabled}
              value={value?.quantity_used ?? "1"}
              onChange={(e) => onChange?.({ ...value, quantity_used: e.target.value })}
              data-testid={`${testId}-qty`}
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Dose notes</label>
            <input
              className="bl-input"
              placeholder="Optional"
              disabled={disabled}
              value={value?.dose_notes ?? ""}
              onChange={(e) => onChange?.({ ...value, dose_notes: e.target.value })}
              data-testid={`${testId}-dose-notes`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function productUsageSummary(usage) {
  if (!usage) return "—";
  const qty = Number(usage.quantity_used);
  const unit = usage.unit_snapshot || "pcs";
  const name = usage.product_name_snapshot || usage.product_used || "Product";
  if (!Number.isFinite(qty)) return name;
  return `${name} (${qty} ${unit})`;
}

/** Product name only (qty shown in separate column). */
export function productUsageName(usage, fallbackText = "") {
  if (usage?.product_name_snapshot) return usage.product_name_snapshot;
  if (fallbackText) return fallbackText;
  return "—";
}
