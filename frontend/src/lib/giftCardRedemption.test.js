import { describe, expect, it } from "vitest";
import {
  findMatchingEntitlementLine,
  resolveGiftCardRedemption,
} from "@/lib/giftCardRedemption";

describe("resolveGiftCardRedemption", () => {
  const valueCard = {
    gift_card_type: "value_credit",
    balance_value: 100_000,
    status: "active",
    redeemable: true,
  };

  const treatmentCard = {
    gift_card_type: "treatment",
    treatment_catalog_id: "tr-1",
    treatment_name_snapshot: "Hydrafacial",
    original_value: 500_000,
    status: "active",
    redeemable: true,
    remaining_redemptions: 1,
  };

  const packageCard = {
    gift_card_type: "package",
    package_catalog_id: "pkg-1",
    package_name_snapshot: "Premium",
    original_value: 6_000_000,
    status: "active",
    redeemable: true,
    remaining_redemptions: 1,
  };

  it("value credit shows amount input", () => {
    const r = resolveGiftCardRedemption({
      card: valueCard,
      lineItems: [],
      amountDue: 50_000,
      userEnteredAmount: "30_000",
    });
    expect(r.showAmountInput).toBe(true);
    expect(r.resolvedAmount).toBe(30000);
  });

  it("treatment does not show amount input", () => {
    const r = resolveGiftCardRedemption({
      card: treatmentCard,
      lineItems: [],
      amountDue: 500_000,
      userEnteredAmount: "1",
    });
    expect(r.showAmountInput).toBe(false);
    expect(r.validationError).toMatch(/Hydrafacial/i);
    expect(r.canSubmit).toBe(false);
  });

  it("treatment applies line value not Rp 1", () => {
    const r = resolveGiftCardRedemption({
      card: treatmentCard,
      lineItems: [{
        item_type: "service",
        treatment_catalog_id: "tr-1",
        unit_price: 500_000,
        qty: 1,
        discount: 0,
      }],
      amountDue: 500_000,
      userEnteredAmount: "1",
    });
    expect(r.showAmountInput).toBe(false);
    expect(r.resolvedAmount).toBe(500_000);
    expect(r.resolvedAmount).not.toBe(1);
    expect(r.canSubmit).toBe(true);
  });

  it("package requires patient when no matching line", () => {
    const r = resolveGiftCardRedemption({
      card: packageCard,
      lineItems: [],
      patientId: null,
      amountDue: 0,
    });
    expect(r.showAmountInput).toBe(false);
    expect(r.validationError).toMatch(/patient/i);
  });

  it("package standalone redeem when patient selected", () => {
    const r = resolveGiftCardRedemption({
      card: packageCard,
      lineItems: [],
      patientId: "pat-1",
      amountDue: 100_000,
    });
    expect(r.standaloneRedeem).toBe(true);
    expect(r.resolvedAmount).toBe(0);
    expect(r.canSubmit).toBe(true);
  });

  it("package with matching line uses package value", () => {
    const r = resolveGiftCardRedemption({
      card: packageCard,
      lineItems: [{
        item_type: "package",
        package_catalog_id: "pkg-1",
        total: 6_000_000,
      }],
      amountDue: 6_000_000,
    });
    expect(r.resolvedAmount).toBe(6_000_000);
    expect(r.standaloneRedeem).toBe(false);
  });
});

describe("findMatchingEntitlementLine", () => {
  it("matches invoice treatment catalog_id", () => {
    const card = { gift_card_type: "treatment", treatment_catalog_id: "a" };
    const line = findMatchingEntitlementLine(card, [
      { item_type: "treatment", catalog_id: "a", line_total_idr: 200_000 },
    ]);
    expect(line).toBeTruthy();
  });
});
