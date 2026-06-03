/** Daily closing — gift card sales vs redemption display helpers. */

export const INCOME_PAYMENT_METHOD_KEYS = ["cash", "card", "qris", "bank_transfer", "other"];

export function giftCardRedemptionIdr(preview) {
  if (!preview) return 0;
  return (
    preview.redemption_payment_methods?.gift_card
    ?? preview.gift_card_redemptions_idr
    ?? preview.payment_methods?.gift_card
    ?? 0
  );
}
