export const APPLIES_TO_OPTIONS = [
  { value: "all", label: "All treatments & packages" },
  { value: "selected_treatments", label: "Selected treatments" },
  { value: "selected_categories", label: "Selected categories" },
  { value: "selected_packages", label: "Selected packages" },
];

const LEGACY_APPLIES_TO = {
  treatments: "selected_treatments",
  categories: "selected_categories",
  packages: "selected_packages",
};

export function normalizeAppliesTo(value) {
  const raw = (value || "all").toLowerCase();
  return LEGACY_APPLIES_TO[raw] || raw;
}

export function campaignEligibleTreatmentIds(campaign) {
  return campaign?.eligible_treatment_ids || campaign?.treatment_ids || [];
}

export function campaignEligibleCategoryIds(campaign) {
  return campaign?.eligible_treatment_category_ids || campaign?.category_keys || [];
}

export function campaignEligiblePackageIds(campaign) {
  return campaign?.eligible_package_ids || campaign?.package_ids || [];
}

export function campaignAppliesToSummary(campaign) {
  if (!campaign) return "";
  if (campaign.applies_to_summary) return campaign.applies_to_summary;
  if (campaign.eligible_summary_snapshot) return campaign.eligible_summary_snapshot;
  const applies = normalizeAppliesTo(campaign.applies_to);
  if (applies === "all") return "All treatments & packages";
  if (applies === "selected_treatments") {
    const n = campaignEligibleTreatmentIds(campaign).length;
    return `${n} selected treatment${n === 1 ? "" : "s"}`;
  }
  if (applies === "selected_categories") {
    const n = campaignEligibleCategoryIds(campaign).length;
    return `${n} selected categor${n === 1 ? "y" : "ies"}`;
  }
  if (applies === "selected_packages") {
    const n = campaignEligiblePackageIds(campaign).length;
    return `${n} selected package${n === 1 ? "" : "s"}`;
  }
  return "All treatments & packages";
}

export function campaignDiscountLabel(campaign) {
  const dtype = (campaign?.discount_type || "percent").toLowerCase();
  const val = Number(campaign?.discount_value || campaign?.discount_value_snapshot || 0);
  if (dtype === "fixed") return `Rp ${val.toLocaleString("id-ID")} off`;
  return `${val}% off`;
}

export function campaignDateRangeLabel(campaign) {
  const from = (campaign?.start_date || campaign?.valid_from || "").slice(0, 10);
  const until = (campaign?.end_date || campaign?.valid_until || "").slice(0, 10);
  if (from && until) return `${from} → ${until}`;
  if (from) return `From ${from}`;
  if (until) return `Until ${until}`;
  return "No date limit";
}

export function emptyCampaignForm() {
  return {
    name: "",
    code: "",
    description: "",
    discount_type: "percent",
    discount_value: 10,
    max_discount_idr: "",
    min_invoice_amount_idr: 0,
    active: true,
    start_date: "",
    end_date: "",
    max_uses_total: "",
    applies_to: "all",
    eligible_treatment_ids: [],
    eligible_treatment_category_ids: [],
    eligible_package_ids: [],
  };
}

export function campaignToForm(c) {
  return {
    name: c.name || "",
    code: c.code || "",
    description: c.description || "",
    discount_type: c.discount_type || "percent",
    discount_value: c.discount_value ?? 10,
    max_discount_idr: c.max_discount_idr ?? "",
    min_invoice_amount_idr: c.min_invoice_amount_idr ?? c.min_subtotal_idr ?? 0,
    active: c.active !== false,
    start_date: (c.start_date || c.valid_from || "").slice(0, 10),
    end_date: (c.end_date || c.valid_until || "").slice(0, 10),
    max_uses_total: c.max_uses_total ?? c.max_uses ?? "",
    applies_to: normalizeAppliesTo(c.applies_to),
    eligible_treatment_ids: [...campaignEligibleTreatmentIds(c)],
    eligible_treatment_category_ids: [...campaignEligibleCategoryIds(c)],
    eligible_package_ids: [...campaignEligiblePackageIds(c)],
  };
}

export function formToCampaignPayload(form) {
  return {
    name: form.name.trim(),
    code: form.code.trim().toUpperCase() || null,
    description: form.description.trim(),
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value) || 0,
    max_discount_idr: form.max_discount_idr === "" ? null : Number(form.max_discount_idr),
    min_invoice_amount_idr: Number(form.min_invoice_amount_idr) || 0,
    active: form.active,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    max_uses_total: form.max_uses_total === "" ? null : Number(form.max_uses_total),
    applies_to: form.applies_to,
    eligible_treatment_ids: form.eligible_treatment_ids || [],
    eligible_treatment_category_ids: form.eligible_treatment_category_ids || [],
    eligible_package_ids: form.eligible_package_ids || [],
  };
}
