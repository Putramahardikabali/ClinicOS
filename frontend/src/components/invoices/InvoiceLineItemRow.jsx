import { Package, Pencil, Trash2 } from "lucide-react";
import InvoiceItemPerformers from "@/components/invoices/InvoiceItemPerformers";
import { invoiceStaffSummary } from "@/components/invoices/invoiceStaffSummary";
import { formatQuantityDisplay, parseQuantityInput } from "@/lib/invoiceLineQuantity";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function InvoiceLineItemRow({
  item,
  idx,
  readOnly,
  performers,
  editing,
  onEdit,
  onEditStaff,
  onCancelEdit,
  onUpdate,
  onRemove,
  onPerformersChange,
  lineDisplayAmount,
  lineServiceValue,
  eligibleOptions,
  packagePick,
  onPackagePickChange,
  onPayWithPackage,
  packageBusy,
}) {
  const isEditing = editing?.idx === idx;
  const editMode = isEditing ? editing.mode : null;
  const staff = invoiceStaffSummary(item);
  const qty = formatQuantityDisplay(item);
  const unitPrice = Number(item.unit_price_idr) || 0;
  const total = lineDisplayAmount(item);
  const isPackage = item.paid_by === "package";
  const canModify = !readOnly && !isPackage;

  const typeLabel =
    item.item_type === "treatment"
      ? "Treatment"
      : item.item_type === "product"
        ? "Product"
        : item.item_type === "package"
          ? "Package"
          : "Custom";

  if (isEditing && editMode === "item") {
    return (
      <div
        className="rounded-xl border border-[#C5D9CE] bg-[#FDFBF7] p-4 space-y-4"
        data-testid={`invoice-line-edit-${item.id || idx}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-widest text-[#5C6C62]">Editing item</span>
          <button type="button" className="text-sm text-[#52796F] hover:underline" onClick={onCancelEdit}>
            Done
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label-eyebrow block mb-1">Name</label>
            <input
              className="bl-input text-sm"
              value={item.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              readOnly={item.item_type !== "custom"}
              disabled={item.item_type !== "custom"}
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Unit price (IDR)</label>
            <input
              type="number"
              min="0"
              className="bl-input text-sm font-mono"
              value={item.unit_price_idr}
              onChange={(e) => onUpdate({ unit_price_idr: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Quantity</label>
            <input
              type="text"
              inputMode="decimal"
              className="bl-input text-sm font-mono"
              value={qty}
              data-testid={`invoice-line-qty-${item.id || idx}`}
              onChange={(e) => onUpdate({ quantity: parseQuantityInput(e.target.value) })}
            />
          </div>
        </div>
        <div>
          <label className="label-eyebrow block mb-1">
            Assigned staff{item.item_type === "treatment" ? " *" : ""}
          </label>
          <InvoiceItemPerformers
            item={item}
            staff={performers}
            readOnly={false}
            onPerformersChange={onPerformersChange}
          />
        </div>
        {eligibleOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid={`pay-with-package-${item.id}`}>
            <select
              className="bl-input text-sm w-auto min-w-[200px]"
              value={packagePick || ""}
              onChange={(e) => onPackagePickChange(e.target.value)}
            >
              <option value="">Use package…</option>
              {eligibleOptions.map((p) => {
                const comp = p.eligible_component;
                const val = comp?.id ? `${p.id}:${comp.id}` : p.id;
                const compName = comp?.treatment_name_snapshot;
                const rem = comp?.remaining_quantity ?? p.remaining_sessions;
                return (
                  <option key={val} value={val}>
                    {p.package_name_snapshot}{compName ? ` · ${compName}` : ""} ({rem} left)
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              disabled={packageBusy || !packagePick}
              onClick={onPayWithPackage}
              className="bl-btn-ghost text-sm disabled:opacity-50"
            >
              {packageBusy ? "Applying…" : "Confirm use session"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-[#EAE6D7] bg-white overflow-hidden"
      data-testid={`invoice-line-${item.id || idx}`}
    >
      <div className="hidden md:grid md:grid-cols-[minmax(0,2fr)_auto_auto_auto_minmax(0,1.2fr)_auto] md:gap-3 md:items-center md:px-4 md:py-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-[#2D3A33] truncate">{item.name || "—"}</div>
          <div className="text-xs text-[#5C6C62] mt-0.5">{typeLabel}</div>
          {isPackage && (
            <span className="bl-chip success text-[10px] inline-flex items-center gap-1 mt-1">
              <Package className="w-3 h-3" /> Package
            </span>
          )}
        </div>
        <div className="text-[#5C6C62] font-mono text-right">{qty}</div>
        <div className="text-[#5C6C62] font-mono text-right whitespace-nowrap">
          {isPackage ? (
            <span className="line-through text-xs">{fmtIDR(unitPrice)}</span>
          ) : (
            fmtIDR(unitPrice)
          )}
        </div>
        <div className="font-medium font-mono text-right whitespace-nowrap">
          {isPackage ? (
            <span className="text-[#52796F]">{fmtIDR(0)}</span>
          ) : (
            fmtIDR(total)
          )}
        </div>
        <div className="text-xs text-[#5C6C62] min-w-0">
          {staff.primaryLine && <div className="truncate">{staff.primaryLine}</div>}
          {staff.additionalLine && (
            <div className="truncate text-[#A89F8B]">+ {staff.additionalLine}</div>
          )}
          {!staff.hasStaff && <span>—</span>}
        </div>
        <div className="flex items-center justify-end gap-1">
          {canModify && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="p-2 text-[#52796F] hover:bg-[#F3F1EB] rounded-lg"
                aria-label="Edit item"
                data-testid={`invoice-line-edit-btn-${item.id || idx}`}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="p-2 text-[#B14A2C] hover:bg-[#FDF0EB] rounded-lg"
                aria-label="Delete item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="md:hidden p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-[#2D3A33]">{item.name || "—"}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5">{typeLabel}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-medium font-mono">{isPackage ? fmtIDR(0) : fmtIDR(total)}</div>
            <div className="text-xs text-[#5C6C62] font-mono">{qty} × {fmtIDR(unitPrice)}</div>
          </div>
        </div>
        {isPackage && (
          <span className="bl-chip success text-xs inline-flex items-center gap-1">
            <Package className="w-3.5 h-3.5" /> Paid by package · service {fmtIDR(lineServiceValue(item))}
          </span>
        )}
        <div className="text-xs text-[#5C6C62]">
          {staff.primaryLine && <div>{staff.primaryLine}</div>}
          {staff.additionalLine && <div>Additional: {staff.additionalLine}</div>}
          {!staff.hasStaff && <span>—</span>}
        </div>
        {canModify && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onEdit} className="bl-btn-ghost text-sm flex-1 min-w-[5rem]">
              Edit
            </button>
            {item.item_type === "treatment" && (
              <button type="button" onClick={onEditStaff} className="bl-btn-ghost text-sm flex-1 min-w-[5rem]">
                Edit staff
              </button>
            )}
            <button type="button" onClick={onRemove} className="bl-btn-ghost text-sm text-[#B14A2C]">
              Delete
            </button>
          </div>
        )}
      </div>

      {isEditing && editMode === "staff" && (
        <div className="border-t border-[#EAE6D7] px-4 py-3 bg-[#FDFBF7] space-y-2">
          <div className="flex items-center justify-between">
            <span className="label-eyebrow">Edit assigned staff</span>
            <button type="button" className="text-xs text-[#52796F] hover:underline" onClick={onCancelEdit}>
              Done
            </button>
          </div>
          <InvoiceItemPerformers
            item={item}
            staff={performers}
            readOnly={false}
            onPerformersChange={onPerformersChange}
          />
        </div>
      )}

      {!isEditing && canModify && item.item_type === "treatment" && (
        <div className="hidden md:block border-t border-[#EAE6D7] px-4 py-2 bg-[#FDFBF7]/50">
          <button
            type="button"
            className="text-xs text-[#52796F] hover:underline"
            onClick={onEditStaff}
          >
            Edit staff
          </button>
        </div>
      )}

      {isPackage && (
        <div className="hidden md:block border-t border-[#EAE6D7] px-4 py-2 text-xs text-[#5C6C62]">
          Service value {fmtIDR(lineServiceValue(item))} · due {fmtIDR(0)}
        </div>
      )}
    </div>
  );
}
