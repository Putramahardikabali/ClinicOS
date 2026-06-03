import { parseIdr } from "@/lib/posUtils";

export const GIFT_CARD_TYPE_OPTIONS = [
  { v: "value_credit", label: "Value / Credit" },
  { v: "treatment", label: "Treatment" },
  { v: "package", label: "Package" },
];

/**
 * Build cart line + metadata from POS gift card draft.
 * @returns {{ line: object } | { error: string }}
 */
export function buildGiftCardCartLine(draft) {
  const gcType = draft.giftCardType || "value_credit";
  const unitPrice = parseIdr(draft.giftUnitPrice || draft.giftValue);
  const meta = {
    gift_card_type: gcType,
    recipient_name: draft.recipientName?.trim() || undefined,
    recipient_phone: draft.recipientPhone?.trim() || undefined,
    recipient_email: draft.recipientEmail?.trim() || undefined,
    message: draft.giftMessage?.trim() || undefined,
    expiry_date: draft.giftExpiry?.trim() || undefined,
    notes: draft.giftNotes?.trim() || undefined,
  };

  if (gcType === "value_credit") {
    if (!unitPrice) {
      return { error: "Enter gift card amount / value" };
    }
    meta.value_idr = unitPrice;
    return {
      line: {
        key: crypto.randomUUID(),
        item_type: "gift_card",
        name_snapshot: "Gift Card (Value / Credit)",
        qty: "1",
        unit_price: String(unitPrice),
        discount: "0",
        metadata: meta,
        gift_card_locked_price: true,
      },
    };
  }

  if (gcType === "treatment") {
    const t = draft.selectedGiftTreatment;
    if (!t) {
      return { error: "Select a treatment" };
    }
    const catalogPrice = parseIdr(t.price_idr);
    const price = unitPrice || catalogPrice;
    if (!price) {
      return { error: "Enter gift card price" };
    }
    meta.treatment_catalog_id = t.id;
    meta.treatment_name_snapshot = t.name;
    meta.value_idr = price;
    meta.catalog_price_idr = catalogPrice || undefined;
    return {
      line: {
        key: crypto.randomUUID(),
        item_type: "gift_card",
        treatment_catalog_id: t.id,
        name_snapshot: `Gift Card · ${t.name}`,
        qty: "1",
        unit_price: String(price),
        discount: "0",
        metadata: meta,
        gift_card_locked_price: !catalogPrice,
        catalog_price_idr: catalogPrice,
      },
    };
  }

  if (gcType === "package") {
    const p = draft.selectedGiftPackage;
    if (!p) {
      return { error: "Select a package" };
    }
    const catalogPrice = parseIdr(p.price_idr);
    const price = unitPrice || catalogPrice;
    if (!price) {
      return { error: "Enter gift card price" };
    }
    meta.package_catalog_id = p.id;
    meta.package_name_snapshot = p.name;
    meta.value_idr = price;
    meta.catalog_price_idr = catalogPrice || undefined;
    return {
      line: {
        key: crypto.randomUUID(),
        item_type: "gift_card",
        package_catalog_id: p.id,
        name_snapshot: `Gift Card · ${p.name}`,
        qty: "1",
        unit_price: String(price),
        discount: "0",
        metadata: meta,
        gift_card_locked_price: !catalogPrice,
        catalog_price_idr: catalogPrice,
      },
    };
  }

  return { error: "Invalid gift card type" };
}
