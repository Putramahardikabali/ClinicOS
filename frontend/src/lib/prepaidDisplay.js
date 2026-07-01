export const PREPAID_STATUS_LABELS = {
  active: "Active",
  partially_used: "Partially used",
  used: "Used",
  expired: "Expired",
  refunded: "Refunded",
  voided: "Voided",
};

export const PREPAID_HELPER_COPY =
  "Prepaid is money or treatment credit paid in advance. It is recognized as revenue only when used.";

export function prepaidStatusLabel(status) {
  return PREPAID_STATUS_LABELS[status] || status || "—";
}

export function prepaidStatusClass(status) {
  switch (status) {
    case "active":
      return "bg-[#EDF3EF] text-[#2D5A3D]";
    case "partially_used":
      return "bg-[#F3EDE8] text-[#6B4E3D]";
    case "used":
      return "bg-[#E8EEF3] text-[#2D4A5A]";
    case "expired":
      return "bg-[#F0F0EB] text-[#5C6C62]";
    case "refunded":
    case "voided":
      return "bg-[#F8E8E8] text-[#8B3A3A]";
    default:
      return "bg-[#F0F0EB] text-[#5C6C62]";
  }
}
