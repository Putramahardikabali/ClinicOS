import { Link } from "react-router-dom";
import { CheckCircle2, Printer } from "lucide-react";
import GiftCardPaymentFields from "@/components/giftcards/GiftCardPaymentFields";
import PaymentAmountQuickFill from "@/components/payments/PaymentAmountQuickFill";
import { computeChangeDue, isCashPayment } from "@/lib/paymentAmountQuickFill";
import { campaignAppliesToSummary, campaignDateRangeLabel, campaignDiscountLabel } from "@/lib/campaignUi";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "qris", label: "QRIS" },
  { value: "gift_card", label: "Gift Card" },
  { value: "store_credit", label: "Store Credit" },
  { value: "package", label: "Package" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
];

export default function InvoiceCheckoutPanel({
  invoice,
  preview,
  appliedCampaign,
  campaigns,
  selectedCampaignId,
  onCampaignSelect,
  onApplyCampaign,
  campaignBusy,
  discountType,
  discountValue,
  discountReason,
  onDiscountTypeChange,
  onDiscountValueChange,
  onDiscountReasonChange,
  onClearAdjustments,
  paymentMethod,
  paymentReference,
  amountReceived,
  notes,
  onPaymentMethodChange,
  onPaymentReferenceChange,
  onAmountReceivedChange,
  onNotesChange,
  giftCardCode,
  giftCardAmount,
  walletAmount,
  walletBalance,
  giftLookup,
  onGiftCardCodeChange,
  onGiftCardAmountChange,
  onGiftLookup,
  onWalletAmountChange,
  canRedeemGiftCard,
  canUseWallet,
  canVoidPayment,
  canRecordRefund,
  canEdit,
  readOnly,
  readOnlyPayment,
  closed,
  closingLocked,
  busy,
  onSaveInvoice,
  onSavePayment,
  onMarkPaid,
  onVoidPayment,
  onRecordRefund,
  onCloseVisit,
}) {
  const hasCampaignDiscount = Boolean(invoice?.campaign_id && preview.discountAmount > 0);
  const hasManualDiscount = discountType !== "none" && preview.discountAmount > 0 && !invoice?.campaign_id;

  const paymentStatus = invoice?.payment_status || "unpaid";
  const isPaid = paymentStatus === "paid" || closed;
  const isPartial = paymentStatus === "partial";
  const isUnpaid = paymentStatus === "unpaid" || (!isPaid && !isPartial);

  const receivedNum = parseInt(String(amountReceived).replace(/\D/g, ""), 10) || 0;
  const canCollect = receivedNum > 0 || paymentMethod === "gift_card" || paymentMethod === "store_credit";

  return (
    <div className="space-y-4" data-testid="invoice-checkout-panel">
      <div className="bl-card p-5 space-y-3">
        <div className="font-display text-lg text-[#2D3A33]">Summary</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Subtotal</span>
            <span className="font-mono">{fmtIDR(preview.subtotal)}</span>
          </div>
          {preview.packageCovered > 0 && (
            <div className="flex justify-between text-[#5C6C62]">
              <span>Package covered</span>
              <span className="font-mono">{fmtIDR(preview.packageCovered)}</span>
            </div>
          )}
          {hasCampaignDiscount && (
            <div className="flex justify-between text-[#B14A2C]">
              <span>Campaign discount</span>
              <span className="font-mono">−{fmtIDR(preview.discountAmount)}</span>
            </div>
          )}
          {hasManualDiscount && preview.discountAmount > 0 && (
            <div className="flex justify-between text-[#B14A2C]">
              <span>Manual discount</span>
              <span className="font-mono">−{fmtIDR(preview.discountAmount)}</span>
            </div>
          )}
          {preview.alreadyPaid > 0 && (
            <div className="flex justify-between text-[#52796F]">
              <span>Already paid</span>
              <span className="font-mono">−{fmtIDR(preview.alreadyPaid)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between items-baseline pt-3 border-t border-[#EAE6D7]">
          <span className="font-display text-xl text-[#2D3A33]">Total due</span>
          <span className="font-display text-2xl text-[#2D3A33] font-mono" data-testid="invoice-total">
            {fmtIDR(isPaid ? 0 : preview.outstanding)}
          </span>
        </div>
        {!isPaid && preview.outstanding !== preview.total && (
          <div className="text-xs text-[#5C6C62] text-right">
            Invoice total: {fmtIDR(preview.total)}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="bl-card p-5 space-y-4">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">Promotions & discount</div>
            <p className="text-xs text-[#5C6C62] mt-1">
              Campaign applies predefined active promotions. Manual discount is for special adjustments.
            </p>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Campaign</label>
            <select
              className="bl-input text-sm"
              disabled={campaignBusy}
              value={selectedCampaignId}
              onChange={(e) => onCampaignSelect(e.target.value)}
              data-testid="invoice-campaign-select"
            >
              <option value="">{campaigns.length ? "Select active campaign" : "No active campaigns"}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.code ? ` (${c.code})` : ""} · {campaignDiscountLabel(c)} · {campaignAppliesToSummary(c)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bl-btn-ghost text-sm mt-2"
              disabled={campaignBusy || (!selectedCampaignId && !invoice?.campaign_id)}
              onClick={() => onApplyCampaign(selectedCampaignId || null)}
              data-testid="invoice-apply-campaign"
            >
              {campaignBusy ? "Applying…" : selectedCampaignId ? "Apply campaign" : "Clear campaign"}
            </button>
          </div>

          {appliedCampaign && (
            <div className="text-sm text-[#5C6C62] rounded-lg bg-[#F8F5EC] p-3 space-y-1" data-testid="invoice-campaign-details">
              <div className="font-medium text-[#2D3A33]">{appliedCampaign.name}</div>
              <div className="text-xs">{campaignDiscountLabel(appliedCampaign)}</div>
              <div className="text-xs">Applies to: {campaignAppliesToSummary(appliedCampaign)}</div>
              <div className="text-xs">{campaignDateRangeLabel(appliedCampaign)}</div>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-[#EAE6D7]">
              <label className="label-eyebrow block">Manual discount</label>
              <select
                className="bl-input text-sm"
                value={discountType}
                onChange={(e) => onDiscountTypeChange(e.target.value)}
              >
                <option value="none">None</option>
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount (IDR)</option>
              </select>
              {discountType !== "none" && (
                <>
                  <input
                    type="number"
                    min="0"
                    className="bl-input font-mono text-sm"
                    value={discountValue}
                    onChange={(e) => onDiscountValueChange(Number(e.target.value))}
                  />
                  <input
                    className="bl-input text-sm"
                    placeholder="Reason (required if discount applied)"
                    value={discountReason}
                    onChange={(e) => onDiscountReasonChange(e.target.value)}
                    data-testid="discount-reason"
                  />
                </>
              )}
            </div>

          {(invoice?.campaign_id || discountType !== "none") && (
            <button
              type="button"
              className="text-sm text-[#5C6C62] hover:text-[#B14A2C] underline-offset-2 hover:underline"
              onClick={onClearAdjustments}
              disabled={campaignBusy || busy}
            >
              Clear adjustments
            </button>
          )}
        </div>
      )}

      <div className="bl-card p-5 space-y-4">
        <div className="font-display text-lg text-[#2D3A33]">Payment</div>

        {closingLocked && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Included in a closed daily closing. Reopen the closing or record a refund.
          </p>
        )}

        {(invoice.payments || []).length > 0 && (
          <div className="rounded-lg border border-[#EAE6D7] p-3 space-y-2" data-testid="invoice-payment-history">
            <p className="label-eyebrow">Payment history</p>
            {(invoice.payments || []).map((p) => (
              <div key={p.id} className="flex justify-between gap-2 text-sm">
                <div>
                  <span className="capitalize">{p.method || "—"}</span>
                  {" · "}
                  <span className="font-mono">{fmtIDR(p.amount_idr)}</span>
                  {p.voided && <span className="text-[#B14A2C] ml-1">(voided)</span>}
                  <div className="text-xs text-[#5C6C62]">
                    {p.created_at ? new Date(p.created_at).toLocaleString() : ""}
                  </div>
                </div>
                {canVoidPayment && !p.voided && !closingLocked && (
                  <button type="button" className="text-xs text-[#B14A2C]" onClick={() => onVoidPayment(p.id)}>
                    Void
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {(invoice.refunds || []).length > 0 && (
          <div className="rounded-lg border border-[#EAE6D7] p-3 space-y-1">
            <p className="label-eyebrow">Refunds</p>
            {invoice.refunds.map((r) => (
              <div key={r.id} className="text-sm flex justify-between">
                <span className="font-mono">{fmtIDR(r.amount_idr)}</span>
                <span className="text-xs text-[#5C6C62] capitalize">{r.method}</span>
              </div>
            ))}
          </div>
        )}

        {!readOnlyPayment && !isPaid && (
          <>
            <div>
              <label className="label-eyebrow block mb-1.5">Payment method</label>
              <select
                className="bl-input text-sm"
                value={paymentMethod}
                onChange={(e) => onPaymentMethodChange(e.target.value)}
                data-testid="invoice-payment-method"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {paymentMethod === "gift_card" && canRedeemGiftCard && (
              <GiftCardPaymentFields
                amountDue={preview.outstanding}
                lineItems={invoice.items || []}
                patientId={invoice?.patient_id}
                giftCardCode={giftCardCode}
                onGiftCardCodeChange={onGiftCardCodeChange}
                giftCardAmount={giftCardAmount}
                onGiftCardAmountChange={onGiftCardAmountChange}
                onLookup={onGiftLookup}
                lookup={giftLookup}
                loading={busy}
                disabled={closed}
                testIdPrefix="invoice-gift"
              />
            )}

            {paymentMethod === "store_credit" && canUseWallet && invoice?.patient_id && (
              <div className="text-sm space-y-2 rounded-lg border border-[#EAE6D7] p-3">
                <div className="flex justify-between">
                  <span className="text-[#5C6C62]">Wallet balance</span>
                  <span className="font-mono">{fmtIDR(walletBalance)}</span>
                </div>
                <input
                  className="bl-input font-mono text-sm"
                  placeholder={`Max ${Math.min(walletBalance, preview.outstanding).toLocaleString("id-ID")}`}
                  value={walletAmount}
                  onChange={(e) => onWalletAmountChange(e.target.value.replace(/\D/g, ""))}
                  data-testid="invoice-wallet-amount"
                />
              </div>
            )}

            <div>
              <label className="label-eyebrow block mb-1.5">Reference</label>
              <input
                className="bl-input text-sm"
                placeholder="Optional"
                value={paymentReference}
                onChange={(e) => onPaymentReferenceChange(e.target.value)}
              />
            </div>

            {paymentMethod !== "gift_card" && paymentMethod !== "store_credit" && (
              <div>
                <label className="label-eyebrow block mb-1.5">Amount received</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="bl-input font-mono text-sm"
                  value={amountReceived}
                  onChange={(e) => onAmountReceivedChange(e.target.value.replace(/\D/g, ""))}
                  data-testid="invoice-amount-received"
                />
                <PaymentAmountQuickFill
                  balanceDue={preview.outstanding}
                  paymentMethod={paymentMethod}
                  disabled={busy}
                  onSelectAmount={(amount) => onAmountReceivedChange(String(amount))}
                  onClear={() => onAmountReceivedChange("")}
                  testIdPrefix="invoice-payment-quick"
                />
              </div>
            )}

            <div className="text-sm space-y-1 rounded-lg bg-[#F8F5EC]/80 p-3">
              <div className="flex justify-between">
                <span className="text-[#5C6C62]">Balance due</span>
                <span className="font-mono font-medium">{fmtIDR(preview.outstanding)}</span>
              </div>
              {isCashPayment(paymentMethod) && computeChangeDue(amountReceived, preview.outstanding) > 0 && (
                <div className="flex justify-between text-[#52796F]" data-testid="invoice-change-due">
                  <span>Change</span>
                  <span className="font-mono font-medium">
                    {fmtIDR(computeChangeDue(amountReceived, preview.outstanding))}
                  </span>
                </div>
              )}
              {preview.remaining > 0 && preview.remaining < preview.outstanding && (
                <div className="flex justify-between text-[#5C6C62]">
                  <span>Remaining after payment</span>
                  <span className="font-mono">{fmtIDR(preview.remaining)}</span>
                </div>
              )}
            </div>

            <div>
              <label className="label-eyebrow block mb-1.5">Payment notes</label>
              <textarea
                className="bl-input min-h-[64px] text-sm"
                placeholder="Optional"
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
              />
            </div>
          </>
        )}

        {isPaid && (
          <div className="flex items-center gap-2 text-[#52796F] bg-[#EDF3EF] rounded-lg p-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-medium">Paid</div>
              <div className="text-sm text-[#5C6C62]">
                {fmtIDR(invoice.amount_paid || preview.total)} received
              </div>
            </div>
          </div>
        )}
      </div>

      {canEdit && invoice.payment_status !== "cancelled" && (
        <div className="bl-card p-5 space-y-2" data-testid="invoice-actions">
          {isUnpaid && (
            <>
              <button
                type="button"
                disabled={busy || readOnlyPayment || !canCollect}
                onClick={() => onSavePayment(false)}
                className="bl-btn-primary w-full disabled:opacity-50"
                data-testid="invoice-collect-payment"
              >
                Collect payment
              </button>
              <button
                type="button"
                disabled={busy || readOnlyPayment}
                onClick={onSaveInvoice}
                className="bl-btn-ghost w-full disabled:opacity-50"
              >
                Save changes
              </button>
            </>
          )}

          {isPartial && (
            <>
              <button
                type="button"
                disabled={busy || readOnlyPayment}
                onClick={() => onSavePayment(false)}
                className="bl-btn-primary w-full disabled:opacity-50"
              >
                Update payment
              </button>
              {!closingLocked && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onMarkPaid}
                  className="bl-btn-ghost w-full inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  data-testid="mark-paid-button"
                >
                  <CheckCircle2 className="w-4 h-4" /> Mark as paid
                </button>
              )}
              <button
                type="button"
                disabled={busy || readOnlyPayment}
                onClick={onSaveInvoice}
                className="bl-btn-ghost w-full text-sm disabled:opacity-50"
              >
                Save changes
              </button>
            </>
          )}

          {isPaid && (
            <>
              <Link
                to={`/print/invoice/${invoice.id}`}
                target="_blank"
                className="bl-btn-primary w-full inline-flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" /> Print receipt
              </Link>
              {canRecordRefund && (invoice.amount_paid || 0) > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onRecordRefund}
                  className="bl-btn-ghost w-full text-sm"
                  data-testid="invoice-record-refund"
                >
                  Record refund
                </button>
              )}
              {invoice.visit?.status !== "completed" && (
                <button type="button" onClick={onCloseVisit} className="bl-btn-ghost w-full text-sm">
                  Close treatment session
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
