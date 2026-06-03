import { GIFT_CARD_TYPE_LABELS } from "@/lib/giftCards";
import { giftCardStatusLabel } from "@/lib/giftCardDisplay";
import { parseIdr } from "@/lib/posUtils";

export function giftCardItemsFromSale(sale) {
  return (sale?.items || []).filter((it) => it.item_type === "gift_card");
}

export function saleHasGiftCardItems(sale) {
  return giftCardItemsFromSale(sale).length > 0;
}

/** Display fields for POS receipt gift card section. */
export function describeGiftCardSaleItem(item) {
  const meta = item?.metadata || {};
  const gcType = meta.gift_card_type || "value_credit";
  const valueIdr =
    meta.value_idr != null
      ? Number(meta.value_idr)
      : parseIdr(item?.unit_price);
  const expiry = meta.expiry_date || meta.expires_at || null;
  return {
    code: item?.gift_card_code || meta.gift_card_code || "—",
    type: GIFT_CARD_TYPE_LABELS[gcType] || gcType,
    gcType,
    valueIdr,
    valueLabel:
      gcType === "value_credit"
        ? valueIdr
        : meta.treatment_name_snapshot || meta.package_name_snapshot || item?.name_snapshot,
    recipientName: meta.recipient_name?.trim() || null,
    expiryDate: expiry ? String(expiry).slice(0, 10) : null,
    message: meta.message?.trim() || null,
    statusLabel: giftCardStatusLabel("active"),
  };
}

/** Map paid POS line → GiftCardPrintDocument props. */
export function buildGiftCardFromSaleItem(item, sale) {
  const meta = item?.metadata || {};
  const gcType = meta.gift_card_type || "value_credit";
  const valueIdr =
    meta.value_idr != null
      ? Number(meta.value_idr)
      : parseIdr(item?.unit_price);
  return {
    code: item?.gift_card_code || meta.gift_card_code,
    gift_card_type: gcType,
    original_value: valueIdr,
    balance_value: gcType === "value_credit" ? valueIdr : 0,
    remaining_redemptions: gcType === "value_credit" ? 0 : 1,
    status: "active",
    recipient_name: meta.recipient_name?.trim() || undefined,
    recipient_phone: meta.recipient_phone?.trim() || undefined,
    message: meta.message?.trim() || undefined,
    expiry_date: meta.expiry_date || meta.expires_at || undefined,
    treatment_name_snapshot: meta.treatment_name_snapshot,
    package_name_snapshot: meta.package_name_snapshot,
    issued_at: sale?.paid_at || sale?.created_at,
  };
}
