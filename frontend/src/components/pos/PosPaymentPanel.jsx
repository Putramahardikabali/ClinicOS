import { useState } from "react";

import { ShoppingCart } from "lucide-react";

import { POS_PRIMARY_PAYMENT_METHODS, fmtIDR, parseIdr } from "@/lib/posUtils";
import PaymentAmountQuickFill from "@/components/payments/PaymentAmountQuickFill";
import { computeChangeDue, isCashPayment } from "@/lib/paymentAmountQuickFill";

import PosGiftCardPayment from "@/components/pos/PosGiftCardPayment";
import PosWalletPayment from "@/components/pos/PosWalletPayment";



export default function PosPaymentPanel({

  canCreate,

  canRedeemGiftCard = true,

  busy,

  cartEmpty,

  subtotal,

  discountAmount,

  discountType,

  onDiscountTypeChange,

  discountValue,

  onDiscountValueChange,

  couponCode,

  onCouponCodeChange,

  tax,

  onTaxChange,

  total,

  amountPaid,

  onAmountPaidChange,

  balanceDue,

  cashDue = 0,

  paymentMethod,

  onPaymentMethodChange,

  onComplete,

  onSaveDraft,

  giftCardCode,

  onGiftCardCodeChange,

  giftCardAmount,

  onGiftCardAmountChange,

  giftLookup,

  onGiftLookup,

  giftLineItems,

  giftPatientId,

  canUseWallet = false,

  walletPatientId,

  walletAmount,

  onWalletAmountChange,

  walletApplied = 0,

  overpaymentToWallet = false,

  onOverpaymentToWalletChange,

}) {

  const [storeCreditOpen, setStoreCreditOpen] = useState(false);

  const [walletOpen, setWalletOpen] = useState(false);
  const fillBalance = Math.max(0, Number(cashDue) || 0);
  const paidAmount = amountPaid === "" ? 0 : parseIdr(amountPaid);
  const changeDue = isCashPayment(paymentMethod) ? computeChangeDue(paidAmount, fillBalance) : 0;



  return (

    <div className="bl-card p-5 sticky top-4 space-y-4" data-testid="pos-payment-panel">

      <div className="flex items-center gap-2">

        <ShoppingCart className="w-5 h-5" style={{ color: "var(--bl-primary)" }} />

        <span className="font-display text-lg">Payment</span>

      </div>



      <div className="text-sm space-y-2">

        <div className="flex justify-between">

          <span className="text-[#5C6C62]">Subtotal</span>

          <span className="font-mono">{fmtIDR(subtotal)}</span>

        </div>



        <div className="space-y-1.5">

          <span className="text-[#5C6C62] text-xs label-eyebrow">Invoice discount</span>

          <div className="flex gap-1">

            {[

              { id: "none", label: "None" },

              { id: "fixed", label: "Rp" },

              { id: "percentage", label: "%" },

            ].map((m) => (

              <button

                key={m.id}

                type="button"

                onClick={() => onDiscountTypeChange(m.id)}

                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${

                  discountType === m.id

                    ? "border-[var(--bl-primary)] bg-[var(--bl-primary-soft)] text-[var(--bl-text)]"

                    : "border-[#EAE6D7] text-[#5C6C62]"

                }`}

                data-testid={`pos-discount-${m.id}`}

              >

                {m.label}

              </button>

            ))}

          </div>

          {discountType !== "none" && (

            <input

              className="bl-input font-mono py-1"

              placeholder={discountType === "percentage" ? "Percent" : "Amount IDR"}

              value={discountValue}

              onChange={(e) => onDiscountValueChange(e.target.value)}

              data-testid="pos-discount-value"

            />

          )}

          {discountAmount > 0 && (

            <div className="flex justify-between text-[#B45309]">

              <span>Discount applied</span>

              <span className="font-mono">− {fmtIDR(discountAmount)}</span>

            </div>

          )}

        </div>



        <div className="flex justify-between items-center gap-2">

          <span className="text-[#5C6C62]">Tax</span>

          <input className="bl-input w-28 font-mono text-right py-1" value={tax} onChange={(e) => onTaxChange(e.target.value)} />

        </div>



        <div className="flex justify-between font-semibold text-lg pt-2 border-t border-[#EAE6D7]">

          <span>Total</span>

          <span className="font-mono">{fmtIDR(total)}</span>

        </div>



        <div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[#5C6C62]">Amount received</span>
            <input
              className="bl-input w-32 font-mono text-right py-1"
              placeholder={String(fillBalance || total)}
              value={amountPaid}
              onChange={(e) => onAmountPaidChange(e.target.value.replace(/\D/g, ""))}
              data-testid="pos-amount-paid"
            />
          </div>
          <PaymentAmountQuickFill
            balanceDue={fillBalance}
            paymentMethod={paymentMethod}
            onSelectAmount={(amount) => onAmountPaidChange(String(amount))}
            onClear={() => onAmountPaidChange("")}
            testIdPrefix="pos-payment-quick"
          />
        </div>

        <div className="flex justify-between text-[#5C6C62]">
          <span>Balance due</span>
          <span className="font-mono">{fmtIDR(balanceDue)}</span>
        </div>

        {changeDue > 0 && (
          <div className="flex justify-between text-[#52796F]" data-testid="pos-change-due">
            <span>Change due</span>
            <span className="font-mono">{fmtIDR(changeDue)}</span>
          </div>
        )}

      </div>



      <div>

        <span className="label-eyebrow block mb-2">Payment method</span>

        <div className="grid grid-cols-2 gap-1.5" data-testid="pos-primary-payment-methods">

          {POS_PRIMARY_PAYMENT_METHODS.map((m) => (

            <button

              key={m.v}

              type="button"

              onClick={() => onPaymentMethodChange(m.v)}

              className={`py-2 px-2 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${

                paymentMethod === m.v

                  ? "bg-[var(--bl-primary)] text-white border-[var(--bl-primary)]"

                  : "border-[#EAE6D7] text-[#5C6C62] hover:bg-[#F8F5EC]"

              }`}

              data-testid={`pos-pay-${m.v}`}

            >

              {m.label}

            </button>

          ))}

        </div>

      </div>



      {canRedeemGiftCard && onGiftCardCodeChange && (

        <div className="border-t border-[#EAE6D7] pt-3">

          <button

            type="button"

            className="text-xs font-medium text-[var(--bl-primary)] hover:underline"

            onClick={() => setStoreCreditOpen((v) => !v)}

            data-testid="pos-store-credit-toggle"

          >

            {storeCreditOpen ? "Hide store credit / value gift card" : "Apply Store Credit / Value Gift Card"}

          </button>

          {storeCreditOpen && (

            <div className="mt-2" data-testid="pos-store-credit-section">

              <PosGiftCardPayment

                total={total}

                lineItems={giftLineItems}

                patientId={giftPatientId}

                giftCardCode={giftCardCode || ""}

                onGiftCardCodeChange={onGiftCardCodeChange}

                giftCardAmount={giftCardAmount || ""}

                onGiftCardAmountChange={onGiftCardAmountChange}

                onLookup={onGiftLookup}

                lookup={giftLookup}

                loading={busy}

              />

            </div>

          )}

        </div>

      )}



      {canUseWallet && onWalletAmountChange && (

        <div className="border-t border-[#EAE6D7] pt-3">

          <button

            type="button"

            className="text-xs font-medium text-[var(--bl-primary)] hover:underline"

            onClick={() => setWalletOpen((v) => !v)}

            data-testid="pos-wallet-toggle"

          >

            {walletOpen ? "Hide patient wallet" : "Use Store Credit (patient wallet)"}

          </button>

          {walletOpen && (

            <div className="mt-2">

              <PosWalletPayment

                patientId={walletPatientId}

                amount={walletAmount}

                onAmountChange={onWalletAmountChange}

                maxDue={Math.max(0, total - (walletApplied || 0))}

              />

              {walletApplied > 0 && paidAmount > Math.max(0, total - walletApplied) && walletPatientId && (

                <label className="flex items-center gap-2 mt-2 text-xs text-[#5C6C62]">

                  <input

                    type="checkbox"

                    checked={overpaymentToWallet}

                    onChange={(e) => onOverpaymentToWalletChange?.(e.target.checked)}

                  />

                  Add excess payment to patient wallet

                </label>

              )}

            </div>

          )}

        </div>

      )}



      <div className="opacity-60 pointer-events-none" title="Coupons coming soon">

        <span className="label-eyebrow block mb-1">Coupon / voucher</span>

        <input

          className="bl-input text-sm"

          placeholder="Coming soon"

          value={couponCode}

          onChange={(e) => onCouponCodeChange(e.target.value)}

          disabled

        />

      </div>



      {canCreate ? (

        <div className="space-y-2 pt-1">

          <button

            type="button"

            disabled={busy || cartEmpty}

            onClick={onComplete}

            className="bl-btn-primary w-full"

            data-testid="pos-complete-sale"

          >

            {busy ? "Processing…" : "Complete sale"}

          </button>

          <button

            type="button"

            disabled={busy || cartEmpty}

            onClick={onSaveDraft}

            className="bl-btn-ghost w-full text-sm"

            data-testid="pos-save-draft"

          >

            Save draft

          </button>

        </div>

      ) : (

        <p className="text-sm text-[#5C6C62]">You do not have permission to complete sales.</p>

      )}

    </div>

  );

}


