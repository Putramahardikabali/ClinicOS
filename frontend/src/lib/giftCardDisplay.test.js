import { describe, expect, it } from "vitest";
import { formatGiftCardRemaining } from "@/lib/giftCardDisplay";

describe("formatGiftCardRemaining", () => {
  it("shows Rp balance for value credit", () => {
    const text = formatGiftCardRemaining({
      gift_card_type: "value_credit",
      balance_value: 50_000,
      remaining_display: { kind: "money", amount_idr: 50_000 },
    });
    expect(text).toMatch(/50/);
  });

  it("shows 1 treatment for active treatment card", () => {
    expect(
      formatGiftCardRemaining({
        gift_card_type: "treatment",
        status: "active",
        remaining_display: { kind: "text", label: "1 treatment" },
      }),
    ).toBe("1 treatment");
  });

  it("shows 1 package for active package card", () => {
    expect(
      formatGiftCardRemaining({
        gift_card_type: "package",
        status: "active",
        remaining_display: { kind: "text", label: "1 package" },
      }),
    ).toBe("1 package");
  });

  it("shows Redeemed when entitlement is used", () => {
    expect(
      formatGiftCardRemaining({
        gift_card_type: "package",
        status: "redeemed",
        remaining_display: { kind: "text", label: "Redeemed" },
      }),
    ).toBe("Redeemed");
  });
});
