export const fmtIDR = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

export function isCashPayment(method) {
  return String(method || "").toLowerCase() === "cash";
}

export function roundUpTo(amount, step) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value <= 0 || step <= 0) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Build quick-fill chip amounts for Amount Received.
 * Cash includes rounded-up suggestions; other methods show exact balance only.
 */
export function buildQuickFillAmounts(balanceDue, paymentMethod) {
  const due = Math.max(0, Math.round(Number(balanceDue) || 0));
  if (due <= 0) return [];

  const amounts = [due];
  if (!isCashPayment(paymentMethod)) return amounts;

  const steps = [50_000, 100_000, 500_000];

  for (const step of steps) {
    const rounded = roundUpTo(due, step);
    if (rounded !== due && !amounts.includes(rounded)) {
      amounts.push(rounded);
    }
  }
  return amounts;
}

export function computeChangeDue(amountReceived, balanceDue) {
  const received = Math.max(0, Math.round(Number(amountReceived) || 0));
  const due = Math.max(0, Math.round(Number(balanceDue) || 0));
  return Math.max(0, received - due);
}
