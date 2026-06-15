import {
  buildQuickFillAmounts,
  computeChangeDue,
  isCashPayment,
  roundUpTo,
} from "./paymentAmountQuickFill";

describe("paymentAmountQuickFill", () => {
  test("roundUpTo nearest step", () => {
    expect(roundUpTo(350_000, 50_000)).toBe(350_000);
    expect(roundUpTo(351_000, 50_000)).toBe(400_000);
    expect(roundUpTo(2_850_000, 100_000)).toBe(2_900_000);
  });

  test("cash quick fill includes rounded amounts", () => {
    expect(buildQuickFillAmounts(350_000, "cash")).toEqual([350_000, 400_000, 500_000]);
    expect(buildQuickFillAmounts(2_850_000, "cash")).toEqual([2_850_000, 2_900_000, 3_000_000]);
  });

  test("large cash amounts may skip duplicate 500k round", () => {
    const amounts = buildQuickFillAmounts(14_000_000, "cash");
    expect(amounts[0]).toBe(14_000_000);
    expect(amounts).not.toContain(14_000_000 + 1);
  });

  test("non-cash only exact balance", () => {
    expect(buildQuickFillAmounts(350_000, "qris")).toEqual([350_000]);
    expect(buildQuickFillAmounts(350_000, "card")).toEqual([350_000]);
  });

  test("isCashPayment", () => {
    expect(isCashPayment("cash")).toBe(true);
    expect(isCashPayment("qris")).toBe(false);
  });

  test("computeChangeDue", () => {
    expect(computeChangeDue(500_000, 350_000)).toBe(150_000);
    expect(computeChangeDue(350_000, 350_000)).toBe(0);
  });
});
