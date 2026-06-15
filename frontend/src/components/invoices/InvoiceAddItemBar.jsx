import { Plus } from "lucide-react";

export default function InvoiceAddItemBar({
  readOnly,
  defaultPerformer,
  pickType,
  pickId,
  catalogOptions,
  busy,
  addMode,
  onSetAddMode,
  onPickTypeChange,
  onPickIdChange,
  onAddCatalog,
  onAddCustom,
}) {
  if (readOnly) return null;

  return (
    <div className="pt-4 border-t border-[#EAE6D7]" data-testid="invoice-add-item-bar">
      {defaultPerformer && addMode === null && (
        <p className="text-xs text-[#5C6C62] mb-3">
          Default staff from session: {defaultPerformer.performer_name_snapshot}
          {defaultPerformer.performer_role_snapshot
            ? ` (${defaultPerformer.performer_role_snapshot})`
            : ""}
        </p>
      )}

      {addMode === null && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSetAddMode("catalog")}
            className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
            data-testid="invoice-add-catalog-btn"
          >
            <Plus className="w-4 h-4" /> Add from catalog
          </button>
          <button
            type="button"
            onClick={onAddCustom}
            className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
            data-testid="invoice-add-custom-btn"
          >
            <Plus className="w-4 h-4" /> Add custom line
          </button>
        </div>
      )}

      {addMode === "catalog" && (
        <div className="rounded-xl border border-[#EAE6D7] bg-[#FDFBF7]/60 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[#2D3A33]">Add from catalog</span>
            <button type="button" className="text-xs text-[#5C6C62] hover:underline" onClick={() => onSetAddMode(null)}>
              Cancel
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="bl-input w-auto text-sm"
              value={pickType}
              onChange={(e) => onPickTypeChange(e.target.value)}
            >
              <option value="treatment">Treatment</option>
              <option value="package">Package</option>
              <option value="product">Product</option>
            </select>
            <select
              className="bl-input flex-1 min-w-[160px] text-sm"
              value={pickId}
              onChange={(e) => onPickIdChange(e.target.value)}
            >
              <option value="">Select item…</option>
              {catalogOptions.map((c) => (
                <option key={c.id || c.key} value={c.id || c.key}>{c.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!pickId || busy}
              onClick={onAddCatalog}
              className="bl-btn-primary text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
