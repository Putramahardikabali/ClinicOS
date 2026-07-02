import { serializeItemPerformers } from "@/lib/performerUtils";
import { resolveLineQuantity } from "@/lib/invoiceLineQuantity";

export function mapInvoiceItemsForEdit(items = []) {
  return (items || []).map((it) => ({
    ...it,
    quantity: resolveLineQuantity(it),
  }));
}

export function emptyInvoiceItem(defaultPerformer) {
  return {
    item_type: "custom",
    catalog_id: null,
    name: "",
    unit_price_idr: 0,
    quantity: 1,
    performer_id: defaultPerformer?.performer_id || "",
    performer_name_snapshot: defaultPerformer?.performer_name_snapshot || "",
    performer_role_snapshot: defaultPerformer?.performer_role_snapshot || "",
  };
}

export function serializeInvoiceItems(items) {
  return items.map((it) => {
    const { line_total_idr, performer_name_snapshot, performer_role_snapshot, ...rest } = it;
    return serializeItemPerformers(rest);
  });
}

export function canEditInvoiceItems({ canEdit, paymentStatus, closingLocked }) {
  if (!canEdit) return false;
  if (paymentStatus === "cancelled" || paymentStatus === "paid") return false;
  if (closingLocked) return false;
  return paymentStatus === "unpaid" || paymentStatus === "partial";
}

export function invoiceItemsSnapshot(items) {
  return JSON.stringify(serializeInvoiceItems(items || []));
}
