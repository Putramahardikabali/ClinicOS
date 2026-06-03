import GiftCardPaymentFields from "@/components/giftcards/GiftCardPaymentFields";

export default function PosGiftCardPayment({
  total,
  lineItems,
  patientId,
  ...rest
}) {
  return (
    <div className="pt-2 border-t border-[#EAE6D7]" data-testid="pos-gift-card-payment">
      <span className="label-eyebrow block mb-2">Gift card</span>
      <GiftCardPaymentFields
        {...rest}
        amountDue={total}
        lineItems={lineItems}
        patientId={patientId}
        testIdPrefix="pos-gift"
      />
    </div>
  );
}