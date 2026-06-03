export const GIFT_CARD_TABS = [
  { id: "active", label: "Active" },
  { id: "redeemed", label: "Redeemed" },
  { id: "expired", label: "Expired" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

export const GIFT_CARD_TYPE_LABELS = {
  value_credit: "Value / Credit",
  treatment: "Treatment",
  package: "Package",
};

export const STATUS_LABELS = {
  active: "Active",
  reserved: "Reserved",
  partially_redeemed: "Partially redeemed",
  redeemed: "Redeemed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "partially_redeemed", label: "Partially redeemed" },
  { value: "redeemed", label: "Redeemed" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export const TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "value_credit", label: "Value / Credit" },
  { value: "treatment", label: "Treatment" },
  { value: "package", label: "Package" },
];

/** Build query params for list/export from filter state. */
export function giftCardListParams(filters, { page = 1, pageSize = 25 } = {}) {
  const p = { page, page_size: pageSize, tab: filters.tab || "all" };
  if (filters.q?.trim()) p.q = filters.q.trim();
  if (filters.status) p.status = filters.status;
  if (filters.gift_card_type) p.gift_card_type = filters.gift_card_type;
  if (filters.recipient_name?.trim()) p.recipient_name = filters.recipient_name.trim();
  if (filters.recipient_phone?.trim()) p.recipient_phone = filters.recipient_phone.trim();
  if (filters.purchaser_name?.trim()) p.purchaser_name = filters.purchaser_name.trim();
  if (filters.purchaser_phone?.trim()) p.purchaser_phone = filters.purchaser_phone.trim();
  if (filters.issued_from) p.issued_from = filters.issued_from;
  if (filters.issued_to) p.issued_to = filters.issued_to;
  if (filters.expiry_from) p.expiry_from = filters.expiry_from;
  if (filters.expiry_to) p.expiry_to = filters.expiry_to;
  return p;
}

export const EMPTY_GIFT_CARD_FILTERS = {
  tab: "active",
  q: "",
  status: "",
  gift_card_type: "",
  recipient_name: "",
  recipient_phone: "",
  purchaser_name: "",
  purchaser_phone: "",
  issued_from: "",
  issued_to: "",
  expiry_from: "",
  expiry_to: "",
};
