import { describe, it, expect } from "vitest";
import { resolveLineQuantity, lineGrossIdr, formatQuantityDisplay } from "./invoiceLineQuantity";

describe("invoiceLineQuantity", () => {
  it("infers qty from original_treatment_value and unit price", () => {
    const it = { unit_price_idr: 350_000, original_treatment_value: 3_500_000 };
    expect(resolveLineQuantity(it)).toBe(10);
  });

  it("prefers explicit quantity", () => {
    const it = { unit_price_idr: 350_000, quantity: 3, original_treatment_value: 3_500_000 };
    expect(resolveLineQuantity(it)).toBe(3);
  });

  it("line total equals price times qty", () => {
    const it = { unit_price_idr: 350_000, quantity: 10 };
    expect(lineGrossIdr(it)).toBe(3_500_000);
  });

  it("quantity display is never empty for existing line", () => {
    const it = { unit_price_idr: 350_000, original_treatment_value: 3_500_000 };
    expect(formatQuantityDisplay(it)).toBe("10");
  });

  it("defaults missing qty to 1", () => {
    expect(resolveLineQuantity({ unit_price_idr: 100_000 })).toBe(1);
  });
});
