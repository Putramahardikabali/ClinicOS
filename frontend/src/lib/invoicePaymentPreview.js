import { lineGrossIdr } from "@/lib/invoiceLineQuantity";

/** Compute invoice totals for checkout / drawer payment UI. */
export function buildInvoicePaymentPreview({
  items = [],
  discountType = "none",
  discountValue = 0,
  amountReceived = "",
  prepaidAmount = "",
  amountPaid = 0,
}) {
  const cashDue = (it) => {
    if (it.paid_by === "package") return 0;
    return lineGrossIdr(it);
  };
  const serviceValue = (it) => {
    if (it.original_treatment_value != null) return Number(it.original_treatment_value) || 0;
    return lineGrossIdr(it);
  };
  const subtotal = items.reduce((s, it) => s + cashDue(it), 0);
  const serviceSubtotal = items.reduce((s, it) => s + serviceValue(it), 0);
  const packageCovered = items
    .filter((it) => it.paid_by === "package")
    .reduce((s, it) => s + serviceValue(it), 0);
  let discountAmount = 0;
  if (discountType === "percentage") discountAmount = Math.round(subtotal * Number(discountValue || 0) / 100);
  else if (discountType === "fixed") discountAmount = Number(discountValue || 0);
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
  const total = subtotal - discountAmount;
  const alreadyPaid = Number(amountPaid || 0);
  const received = parseInt(String(amountReceived).replace(/\D/g, ""), 10) || 0;
  const prepaidApply = parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0;
  const outstanding = Math.max(0, total - alreadyPaid);
  const cashDueAfterPrepaid = Math.max(0, outstanding - prepaidApply);
  const hasPackageCovered = items.some((it) => it.paid_by === "package");
  let status = "unpaid";
  if (total === 0 && hasPackageCovered) status = "paid";
  else if (alreadyPaid + received + prepaidApply >= total && total > 0) status = "paid";
  else if (alreadyPaid + received + prepaidApply > 0) status = "partial";
  return {
    subtotal,
    serviceSubtotal,
    packageCovered,
    discountAmount,
    total,
    alreadyPaid,
    outstanding,
    cashDueAfterPrepaid,
    remaining: Math.max(0, cashDueAfterPrepaid - received),
    status,
  };
}
