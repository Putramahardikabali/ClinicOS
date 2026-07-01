export const fmtIDR = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

/** Primary POS checkout methods (gift card redemption is a secondary store-credit action). */
export const POS_PRIMARY_PAYMENT_METHODS = [
  { v: "cash", label: "Cash" },
  { v: "card", label: "Card" },
  { v: "bank_transfer", label: "Bank transfer" },
  { v: "qris", label: "QRIS" },
  { v: "other", label: "Other" },
];

export const PAYMENT_METHODS = [
  ...POS_PRIMARY_PAYMENT_METHODS,
  { v: "gift_card", label: "Gift Card" },
];

export const ITEM_TABS = [
  { id: "product", label: "Product" },
  { id: "package", label: "Package" },
  { id: "gift_card", label: "Gift Card" },
  { id: "prepaid", label: "Prepaid" },
  { id: "service", label: "Service" },
  { id: "custom", label: "Custom" },
];

export const TYPE_LABELS = {
  product: "Product",
  package: "Package",
  gift_card: "Gift Card",
  prepaid: "Prepaid",
  service: "Service",
  custom: "Custom",
};

export const TYPE_BADGE_CLASS = {
  product: "bg-[#EDF3EF] text-[#2D5A3D]",
  package: "bg-[#F3EDE8] text-[#6B4E3D]",
  gift_card: "bg-[#F8F0E8] text-[#8B5A2B]",
  prepaid: "bg-[#EDE8F3] text-[#4A3D6B]",
  service: "bg-[#E8EEF3] text-[#2D4A5A]",
  custom: "bg-[#F0F0EB] text-[#5C6C62]",
};

export function parseIdr(value) {
  return parseInt(String(value ?? "").replace(/\D/g, ""), 10) || 0;
}

export function lineTotal(ln) {
  const qty = parseFloat(ln.qty) || 0;
  const price = parseIdr(ln.unit_price);
  const disc = parseInt(ln.discount, 10) || 0;
  return Math.max(0, Math.round(qty * price) - disc);
}

export function computeInvoiceDiscount(subtotal, discountType, discountValue) {
  const sub = Math.max(0, subtotal);
  if (discountType === "percentage") {
    return Math.min(sub, Math.round(sub * (parseFloat(discountValue) || 0) / 100));
  }
  if (discountType === "fixed") {
    return Math.min(sub, parseIdr(discountValue));
  }
  return 0;
}

export function receiptCustomerLabel(sale) {
  return sale?.patient_name_snapshot || sale?.customer_name || "Walk-in";
}

export function receiptPhone(sale, patient) {
  return (
    sale?.customer_phone
    || patient?.phone
    || sale?.patient_phone
    || ""
  ).trim();
}
