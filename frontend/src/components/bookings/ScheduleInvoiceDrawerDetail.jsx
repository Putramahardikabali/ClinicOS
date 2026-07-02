import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { formatIdr } from "@/lib/clinic";
import { hasPermission, useAuth } from "@/lib/auth";
import InvoiceCheckoutPanel from "@/components/invoices/InvoiceCheckoutPanel";
import { resolveLineQuantity, lineGrossIdr } from "@/lib/invoiceLineQuantity";
import { buildInvoicePaymentPreview } from "@/lib/invoicePaymentPreview";
import { resolveGiftCardRedemption } from "@/lib/giftCardRedemption";
import { isCashPayment } from "@/lib/paymentAmountQuickFill";
import { toast } from "sonner";

const fmtIDR = (n) => formatIdr(n);

function statusChipClass(status) {
  if (status === "paid") return "success";
  if (status === "partial") return "info";
  return "warning";
}

function lineDisplayAmount(it) {
  if (it.paid_by === "package") return 0;
  return lineGrossIdr(it);
}

export function ScheduleInvoiceDrawerDetail({
  invoiceId,
  onBack,
  onPaymentSuccess,
  visitId,
  canCreateInvoice = false,
}) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "billing.edit") || hasPermission(user, "billing.create");
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const canRedeemPrepaid = hasPermission(user, "prepaid.redeem");
  const canUseWallet = hasPermission(user, "wallet.use");
  const canVoidPayment = hasPermission(user, "payments.void") || hasPermission(user, "billing.edit");
  const canRecordRefund = hasPermission(user, "refunds.create");

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [resolvedId, setResolvedId] = useState(invoiceId);
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmount, setGiftCardAmount] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [selectedPrepaidId, setSelectedPrepaidId] = useState("");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [giftLookup, setGiftLookup] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");

  const applyInvoice = useCallback((inv) => {
    setInvoice(inv);
    setDiscountType(inv.discount_type || "none");
    setDiscountValue(inv.discount_value || 0);
    setDiscountReason(inv.discount_reason || "");
    setNotes(inv.notes || "");
    setPaymentMethod(inv.payment_method || "cash");
    setPaymentReference(inv.payment_reference || "");
    setAmountReceived("");
    setSelectedCampaignId(inv.campaign_id || "");
  }, []);

  useEffect(() => {
    setResolvedId(invoiceId);
  }, [invoiceId]);

  const load = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const r = await api.get(`/invoices/${resolvedId}`);
      applyInvoice(r.data);
    } catch {
      toast.error("Invoice not found");
      onBack?.();
    } finally {
      setLoading(false);
    }
  }, [resolvedId, applyInvoice, onBack]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!invoice?.patient_id || !canUseWallet) {
      setWalletBalance(0);
      return undefined;
    }
    api.get("/wallet/balance", { params: { patient_id: invoice.patient_id } })
      .then((r) => setWalletBalance(Number(r.data?.balance_idr) || 0))
      .catch(() => setWalletBalance(0));
    return undefined;
  }, [invoice?.patient_id, canUseWallet]);

  const items = useMemo(
    () => (invoice?.items || []).map((it) => ({ ...it, quantity: resolveLineQuantity(it) })),
    [invoice?.items],
  );

  const preview = useMemo(
    () => buildInvoicePaymentPreview({
      items,
      discountType,
      discountValue,
      amountReceived,
      prepaidAmount,
      amountPaid: invoice?.amount_paid,
    }),
    [items, discountType, discountValue, amountReceived, prepaidAmount, invoice?.amount_paid],
  );

  const giftRedemption = useMemo(
    () => resolveGiftCardRedemption({
      card: giftLookup?.card,
      lineItems: items,
      patientId: invoice?.patient_id,
      amountDue: preview.outstanding,
      userEnteredAmount: giftCardAmount,
    }),
    [giftLookup, items, invoice?.patient_id, preview.outstanding, giftCardAmount],
  );

  const appliedCampaign = useMemo(() => {
    if (!invoice?.campaign_id) return null;
    return campaigns.find((c) => c.id === invoice.campaign_id) || {
      id: invoice.campaign_id,
      name: invoice.campaign_name_snapshot,
      code: invoice.campaign_code_snapshot,
      discount_type: invoice.discount_type_snapshot,
      discount_value: invoice.discount_value_snapshot,
      applies_to: invoice.applies_to_snapshot,
      eligible_summary_snapshot: invoice.eligible_summary_snapshot,
      start_date: null,
      end_date: null,
    };
  }, [invoice, campaigns]);

  const savePayment = async (markPaid = false) => {
    if (!invoice?.id) return;
    const gcApplied = giftRedemption.standaloneRedeem
      ? 0
      : parseInt(String(giftCardAmount).replace(/\D/g, ""), 10) || 0;
    if (paymentMethod === "gift_card") {
      if (!giftCardCode.trim()) {
        toast.error("Enter gift card code");
        return;
      }
      if (giftRedemption.validationError) {
        toast.error(giftRedemption.validationError);
        return;
      }
      if (!giftRedemption.canSubmit) {
        if (giftRedemption.showAmountInput) toast.error("Enter amount to redeem");
        return;
      }
    }
    const received = parseInt(String(amountReceived).replace(/\D/g, ""), 10) || 0;
    const prepaidApply = parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0;
    if (!markPaid && paymentMethod !== "gift_card" && paymentMethod !== "store_credit") {
      if (received <= 0 && prepaidApply <= 0) {
        toast.error("Enter amount received or apply prepaid");
        return;
      }
      if (prepaidApply > preview.outstanding) {
        toast.error("Prepaid cannot exceed balance due");
        return;
      }
      if (!isCashPayment(paymentMethod) && received > preview.cashDueAfterPrepaid) {
        toast.error("Amount cannot exceed balance due for this payment method");
        return;
      }
    }
    setBusy(true);
    try {
      const r = await api.put(`/invoices/${invoice.id}/payment`, {
        amount_paid: paymentMethod === "gift_card" ? undefined : (markPaid ? undefined : received),
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        notes,
        mark_paid: markPaid,
        gift_card_code: (paymentMethod === "gift_card" || gcApplied > 0 || giftRedemption.standaloneRedeem)
          && giftCardCode.trim()
          ? giftCardCode.trim()
          : undefined,
        gift_card_amount_idr: gcApplied > 0 ? gcApplied : undefined,
        wallet_amount_idr: (() => {
          const w = parseInt(String(walletAmount).replace(/\D/g, ""), 10) || 0;
          return w > 0 ? w : (paymentMethod === "store_credit" ? preview.outstanding : undefined);
        })(),
        prepaid_id: prepaidApply > 0 && selectedPrepaidId ? selectedPrepaidId : undefined,
        prepaid_amount_idr: prepaidApply > 0 ? prepaidApply : undefined,
      });
      applyInvoice(r.data);
      setSelectedPrepaidId("");
      setPrepaidAmount("");
      toast.success(markPaid ? "Marked as paid" : "Payment updated");
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const createInvoiceFromVisit = async () => {
    if (!visitId || !canCreateInvoice) return;
    setCreateBusy(true);
    try {
      const r = await api.post(`/invoices/visit/${visitId}`);
      setResolvedId(r.data.id);
      applyInvoice(r.data);
      toast.success("Invoice created");
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create invoice");
    } finally {
      setCreateBusy(false);
    }
  };

  if (!resolvedId && !visitId) {
    return (
      <div className="p-6 text-sm text-[#5C6C62]">
        <button type="button" onClick={onBack} className="text-[#52796F] hover:underline inline-flex items-center gap-1 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        Invoice not available.
      </div>
    );
  }

  if (!resolvedId && visitId && canCreateInvoice) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="schedule-invoice-create-prompt">
        <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 flex items-center gap-2">
          <button type="button" onClick={onBack} className="text-sm text-[#52796F] hover:text-[#2D3A33] inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to invoices
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-6 text-center space-y-4">
          <p className="text-sm text-[#5C6C62]">This appointment has no invoice yet.</p>
          <button
            type="button"
            className="bl-btn-primary"
            disabled={createBusy}
            onClick={createInvoiceFromVisit}
            data-testid="schedule-invoice-create"
          >
            {createBusy ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !invoice) {
    return (
      <div className="p-6 text-sm text-[#5C6C62]" data-testid="schedule-invoice-detail-loading">
        Loading invoice…
      </div>
    );
  }

  const readOnly = !canEdit || invoice.payment_status === "cancelled";
  const closed = invoice.payment_status === "paid";
  const closingLocked = invoice.closing_locked;
  const readOnlyPayment = readOnly || closingLocked;
  const paymentStatus = invoice.payment_status || preview.status;
  const createdLabel = (invoice.created_at || "").slice(0, 16).replace("T", " ");

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="schedule-invoice-detail">
      <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 space-y-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-[#52796F] hover:text-[#2D3A33] inline-flex items-center gap-1"
          data-testid="schedule-invoice-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        <div className="flex items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-[#2D3A33] truncate">{invoice.invoice_number}</h2>
            <p className="text-sm text-[#5C6C62] truncate">
              {invoice.patient?.full_name || invoice.patient_name || "Patient"}
            </p>
            <p className="text-xs text-[#A89F8B] mt-0.5">{createdLabel}</p>
          </div>
          <span className={`bl-chip shrink-0 ${statusChipClass(paymentStatus)}`}>
            {paymentStatus}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-4">
        <div className="rounded-lg border border-[#EAE6D7] bg-white overflow-hidden">
          <div className="px-3 py-2 bg-[#F8F5EC] text-xs uppercase tracking-widest text-[#5C6C62]">
            Line items
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[#5C6C62]">No line items.</p>
          ) : (
            <ul className="divide-y divide-[#EAE6D7]">
              {items.map((it) => (
                <li key={it.id} className="px-3 py-2.5 text-sm flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[#2D3A33] truncate">{it.name}</div>
                    <div className="text-xs text-[#5C6C62]">
                      {resolveLineQuantity(it)} × {fmtIDR(it.unit_price_idr ?? it.price_idr ?? 0)}
                      {it.paid_by === "package" && " · Package"}
                    </div>
                  </div>
                  <span className="font-mono shrink-0">{fmtIDR(lineDisplayAmount(it))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[#EAE6D7] bg-white p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Subtotal</span>
            <span className="font-mono">{fmtIDR(preview.subtotal)}</span>
          </div>
          {preview.discountAmount > 0 && (
            <div className="flex justify-between text-[#B14A2C]">
              <span>Discount{invoice.campaign_name_snapshot ? ` (${invoice.campaign_name_snapshot})` : ""}</span>
              <span className="font-mono">−{fmtIDR(preview.discountAmount)}</span>
            </div>
          )}
          {(invoice.prepaid_payment_total_idr || 0) > 0 && (
            <div className="flex justify-between text-[#52796F]">
              <span>Prepaid applied</span>
              <span className="font-mono">−{fmtIDR(invoice.prepaid_payment_total_idr)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium pt-1 border-t border-[#EAE6D7]">
            <span>Total</span>
            <span className="font-mono">{fmtIDR(preview.total)}</span>
          </div>
          <div className="flex justify-between text-[#52796F]">
            <span>Amount paid</span>
            <span className="font-mono">{fmtIDR(preview.alreadyPaid)}</span>
          </div>
          <div className="flex justify-between font-display text-base text-[#2D3A33] pt-1">
            <span>Balance</span>
            <span className="font-mono">{fmtIDR(closed ? 0 : preview.outstanding)}</span>
          </div>
        </div>

        <InvoiceCheckoutPanel
          compact
          invoice={{ ...invoice, items }}
          preview={preview}
          appliedCampaign={appliedCampaign}
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onCampaignSelect={setSelectedCampaignId}
          onApplyCampaign={() => {}}
          campaignBusy={false}
          discountType={discountType}
          discountValue={discountValue}
          discountReason={discountReason}
          onDiscountTypeChange={() => {}}
          onDiscountValueChange={() => {}}
          onDiscountReasonChange={() => {}}
          onClearAdjustments={() => {}}
          paymentMethod={paymentMethod}
          paymentReference={paymentReference}
          amountReceived={amountReceived}
          notes={notes}
          onPaymentMethodChange={(v) => {
            setPaymentMethod(v);
            if (v !== "gift_card") setGiftLookup(null);
          }}
          onPaymentReferenceChange={setPaymentReference}
          onAmountReceivedChange={setAmountReceived}
          onNotesChange={setNotes}
          giftCardCode={giftCardCode}
          giftCardAmount={giftCardAmount}
          walletAmount={walletAmount}
          walletBalance={walletBalance}
          giftLookup={giftLookup}
          onGiftCardCodeChange={setGiftCardCode}
          onGiftCardAmountChange={setGiftCardAmount}
          onGiftLookup={setGiftLookup}
          onWalletAmountChange={setWalletAmount}
          canRedeemGiftCard={canRedeemGiftCard}
          canRedeemPrepaid={canRedeemPrepaid}
          selectedPrepaidId={selectedPrepaidId}
          onSelectedPrepaidIdChange={setSelectedPrepaidId}
          prepaidAmount={prepaidAmount}
          onPrepaidAmountChange={setPrepaidAmount}
          prepaidAppliedPreview={parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0}
          canUseWallet={canUseWallet}
          canVoidPayment={canVoidPayment}
          canRecordRefund={canRecordRefund}
          canEdit={canEdit}
          readOnly={readOnly}
          readOnlyPayment={readOnlyPayment}
          closed={closed}
          closingLocked={closingLocked}
          busy={busy}
          onSaveInvoice={() => {}}
          onSavePayment={() => savePayment(false)}
          onMarkPaid={() => savePayment(true)}
          onVoidPayment={async (paymentId) => {
            const reason = window.prompt("Void reason (required):");
            if (!reason || reason.trim().length < 3) return;
            setBusy(true);
            try {
              const r = await api.post(`/invoices/${invoice.id}/payments/${paymentId}/void`, { reason: reason.trim() });
              applyInvoice(r.data);
              toast.success("Payment voided");
              onPaymentSuccess?.(r.data);
            } catch (e) {
              toast.error(e?.response?.data?.detail || "Could not void payment");
            } finally {
              setBusy(false);
            }
          }}
          onRecordRefund={() => {}}
          onCloseVisit={() => {}}
        />

        {!canEdit && (
          <p className="text-xs text-[#5C6C62]">View only — you do not have permission to collect payment.</p>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[#EAE6D7] bg-[#FAFAF7]">
        <a
          href={`/invoices/${invoice.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#52796F] hover:underline"
          data-testid="schedule-invoice-open-full"
        >
          Open full invoice page
        </a>
      </div>
    </div>
  );
}
