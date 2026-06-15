import {
  buildQuickFillAmounts,
  fmtIDR,
  isCashPayment,
} from "@/lib/paymentAmountQuickFill";

export default function PaymentAmountQuickFill({
  balanceDue,
  paymentMethod,
  onSelectAmount,
  onClear,
  disabled = false,
  testIdPrefix = "payment-quick",
}) {
  const amounts = buildQuickFillAmounts(balanceDue, paymentMethod);
  const showExactLabel = !isCashPayment(paymentMethod) && amounts.length === 1;

  if (!amounts.length && !onClear) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid={`${testIdPrefix}-chips`}>
      {amounts.map((amount) => (
        <button
          key={amount}
          type="button"
          disabled={disabled}
          onClick={() => onSelectAmount(amount)}
          className="bl-chip text-xs font-mono hover:bg-[#EDF3EF] disabled:opacity-50"
          data-testid={`${testIdPrefix}-${amount}`}
        >
          {showExactLabel ? "Pay full balance" : fmtIDR(amount)}
        </button>
      ))}
      {onClear && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="bl-chip text-xs text-[#5C6C62] hover:bg-[#F3F1EB] disabled:opacity-50"
          data-testid={`${testIdPrefix}-clear`}
        >
          Clear
        </button>
      )}
    </div>
  );
}
