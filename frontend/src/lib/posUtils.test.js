import { PAYMENT_METHODS, POS_PRIMARY_PAYMENT_METHODS } from "@/lib/posUtils";

describe("POS_PRIMARY_PAYMENT_METHODS", () => {
  it("does not include gift card as primary payment method", () => {
    const primary = POS_PRIMARY_PAYMENT_METHODS.map((m) => m.v);
    expect(primary).not.toContain("gift_card");
    expect(primary).toEqual(["cash", "card", "bank_transfer", "qris", "other"]);
  });

  it("keeps gift_card on full PAYMENT_METHODS for invoices", () => {
    const all = PAYMENT_METHODS.map((m) => m.v);
    expect(all).toContain("gift_card");
  });
});
