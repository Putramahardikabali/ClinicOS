import { giftCardRedemptionIdr, INCOME_PAYMENT_METHOD_KEYS } from "./closingGiftCards";

describe("closingGiftCards", () => {
  test("giftCardRedemptionIdr prefers redemption_payment_methods", () => {
    expect(
      giftCardRedemptionIdr({
        redemption_payment_methods: { gift_card: 50_000 },
        payment_methods: { cash: 100_000, gift_card: 99 },
        gift_card_redemptions_idr: 40_000,
      }),
    ).toBe(50_000);
  });

  test("income keys exclude gift card", () => {
    expect(INCOME_PAYMENT_METHOD_KEYS).not.toContain("gift_card");
  });
});
