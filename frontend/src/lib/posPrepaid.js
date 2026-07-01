import { parseIdr } from "@/lib/posUtils";

export const PREPAID_TYPE_OPTIONS = [
  { v: "credit", label: "Prepaid Credit" },
  { v: "treatment", label: "Prepaid Treatment" },
];

/**
 * Build cart line + metadata from POS prepaid draft.
 * @returns {{ line: object } | { error: string }}
 */
export function buildPrepaidCartLine(draft) {
  const ptype = draft.prepaidType || "credit";
  const unitPrice = parseIdr(draft.prepaidUnitPrice || draft.prepaidValue);
  const meta = {
    prepaid_type: ptype,
    amount_idr: unitPrice,
    expiry_date: draft.prepaidExpiry?.trim() || undefined,
    notes: draft.prepaidNotes?.trim() || undefined,
    campaign_id: draft.prepaidCampaignId?.trim() || undefined,
    campaign_name_snapshot: draft.prepaidCampaignName?.trim() || undefined,
  };

  if (ptype === "credit") {
    if (!unitPrice) {
      return { error: "Enter prepaid amount" };
    }
    return {
      line: {
        key: crypto.randomUUID(),
        item_type: "prepaid",
        name_snapshot: "Prepaid purchase (Credit)",
        qty: "1",
        unit_price: String(unitPrice),
        discount: "0",
        metadata: meta,
        prepaid_locked_price: true,
      },
    };
  }

  const t = draft.selectedPrepaidTreatment;
  if (!t) {
    return { error: "Select a treatment" };
  }
  const qty = parseInt(draft.prepaidQuantity, 10) || 1;
  if (!unitPrice) {
    return { error: "Enter promo / locked price" };
  }
  meta.treatment_catalog_id = t.id;
  meta.treatment_name_snapshot = t.name;
  meta.quantity = qty;
  return {
    line: {
      key: crypto.randomUUID(),
      item_type: "prepaid",
      treatment_catalog_id: t.id,
      name_snapshot: `Prepaid purchase (${t.name})`,
      qty: String(qty),
      unit_price: String(unitPrice),
      discount: "0",
      metadata: meta,
      prepaid_locked_price: true,
    },
  };
}

export function prepaidItemsFromSale(sale) {
  return (sale?.items || []).filter((it) => it.item_type === "prepaid");
}

export function describePrepaidSaleItem(item) {
  const meta = item?.metadata || {};
  const ptype = meta.prepaid_type || "credit";
  return {
    code: item?.prepaid_code || "—",
    prepaidType: ptype,
    typeLabel: ptype === "treatment" ? "Prepaid Treatment" : "Prepaid Credit",
    amountIdr: parseIdr(meta.amount_idr || item.unit_price || item.total),
    treatmentName: meta.treatment_name_snapshot,
    expiryDate: meta.expiry_date,
  };
}
