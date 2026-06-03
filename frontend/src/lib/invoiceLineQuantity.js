const QTY_KEYS = ["quantity", "qty", "units", "amount", "session_count", "treatment_quantity"];

function lineUnitPrice(item) {
  if (!item) return 0;
  for (const key of ["unit_price_idr", "unit_price", "price_idr", "price"]) {
    const v = Number(item[key]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

export function resolveLineQuantity(item) {
  if (!item) return 1;
  for (const key of QTY_KEYS) {
    const v = Number(item[key]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const unit = lineUnitPrice(item);
  if (unit > 0) {
    for (const tk of ["original_treatment_value", "amount_charged", "line_total_idr"]) {
      if (item[tk] != null && item[tk] !== "") {
        const t = Number(item[tk]);
        if (Number.isFinite(t) && t > 0) return t / unit;
      }
    }
  }
  return 1;
}

/** String for controlled inputs — avoids blank number fields when quantity was missing in API payload. */
export function formatQuantityDisplay(item) {
  const q = resolveLineQuantity(item);
  if (!Number.isFinite(q) || q <= 0) return "1";
  return Number.isInteger(q) ? String(q) : String(q);
}

/** @deprecated use formatQuantityDisplay */
export function quantityInputValue(item) {
  return formatQuantityDisplay(item);
}

export function lineGrossIdr(item) {
  return Math.round(lineUnitPrice(item) * resolveLineQuantity(item));
}

export function parseQuantityInput(raw) {
  const v = parseFloat(String(raw ?? "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 1;
}
