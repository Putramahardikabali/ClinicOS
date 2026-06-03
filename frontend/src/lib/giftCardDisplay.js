import { fmtIDR } from "@/lib/posUtils";

/** Remaining column for Gift Cards table and detail panel. */
export function formatGiftCardRemaining(row) {
  const display = row?.remaining_display;
  if (display?.kind === "money") {
    return fmtIDR(display.amount_idr ?? row?.balance_value ?? row?.balance_idr ?? 0);
  }
  if (display?.label) return display.label;
  if (display?.text) return display.text;

  const gcType = row?.gift_card_type || "value_credit";
  const status = (row?.status || "").toLowerCase();
  if (gcType === "value_credit") {
    return fmtIDR(row?.balance_value ?? row?.balance_idr ?? 0);
  }
  const remaining = row?.remaining_redemptions;
  if (status === "redeemed" || remaining === 0) return "Redeemed";
  if (gcType === "treatment") return "1 treatment";
  if (gcType === "package") return "1 package";
  return "Available";
}

export function giftCardStatusLabel(status) {
  const s = (status || "").toLowerCase();
  if (s === "active") return "Active";
  if (s === "reserved") return "Reserved";
  if (s === "partially_redeemed") return "Partially redeemed";
  if (s === "redeemed") return "Redeemed";
  if (s === "expired") return "Expired";
  if (s === "cancelled") return "Cancelled";
  return status || "—";
}
