/** Billing cycles — keep in sync with backend saas.BILLING_CYCLES */
export const BILLING_CYCLES = [
  { key: "monthly", label: "Monthly", months: 1, discountPercent: 0 },
  { key: "semiannual", label: "6 months", months: 6, discountPercent: 5 },
  { key: "annual", label: "Annually", months: 12, discountPercent: 10 },
];

export const PLAN_ORDER = ["starter", "clinic", "complete"];

const DISCOUNT = {
  monthly: 1,
  semiannual: 0.95,
  annual: 0.9,
};

export function computePlanCharge(monthlyPriceIdr, cycleKey) {
  const cycle = BILLING_CYCLES.find((c) => c.key === cycleKey) || BILLING_CYCLES[0];
  const discount = DISCOUNT[cycle.key] ?? 1;
  const perMonth = Math.round(Number(monthlyPriceIdr || 0) * discount);
  const total = perMonth * cycle.months;
  return {
    cycle: cycle.key,
    label: cycle.label,
    months: cycle.months,
    perMonthIdr: perMonth,
    totalIdr: total,
    discountPercent: cycle.discountPercent,
  };
}

export function planRank(planKey) {
  const i = PLAN_ORDER.indexOf(planKey);
  return i === -1 ? 0 : i;
}

export function upgradePlanKeys(currentPlan) {
  const rank = planRank(currentPlan);
  return PLAN_ORDER.filter((_, i) => i > rank);
}

export function cycleLabel(key) {
  return BILLING_CYCLES.find((c) => c.key === key)?.label || key;
}

/** Primary billing CTA label from subscription state (UI copy only). */
export function primaryBillingActionLabel(sub, options = {}) {
  const status = sub?.status || "trial";
  if (status === "trial") return "Generate payment instructions";
  if (status === "expired" || status === "suspended") return "Reactivate subscription";
  if (status === "active" && sub?.expiry_date) {
    const ms = new Date(sub.expiry_date).getTime() - Date.now();
    const daysLeft = Math.ceil(ms / (1000 * 60 * 60 * 24));
    if (daysLeft <= 14) return "Renew subscription";
  }
  if (status === "active") return "Manage renewal";
  return options.fallback || "Generate payment instructions";
}
