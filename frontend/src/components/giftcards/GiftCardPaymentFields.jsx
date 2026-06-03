import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { fmtIDR, parseIdr } from "@/lib/posUtils";
import { toast } from "sonner";
import { formatGiftCardRemaining, giftCardStatusLabel } from "@/lib/giftCardDisplay";
import { GIFT_CARD_TYPE_LABELS } from "@/lib/giftCards";
import {
  isEntitlementCard,
  isValueCreditCard,
  resolveGiftCardRedemption,
} from "@/lib/giftCardRedemption";
import GiftCardPosBlockedMessage from "@/components/giftcards/GiftCardPosBlockedMessage";

/**
 * Gift card redemption fields for POS and invoice payment.
 * Value/credit: IDR amount input. Treatment/package: entitlement UI (no Rp 1 input).
 */
export default function GiftCardPaymentFields({
  amountDue,
  lineItems = [],
  patientId,
  giftCardCode,
  onGiftCardCodeChange,
  giftCardAmount,
  onGiftCardAmountChange,
  onLookup,
  lookup,
  loading,
  disabled,
  testIdPrefix = "gift-card",
}) {
  const [busy, setBusy] = useState(false);
  const due = Math.max(0, Number(amountDue) || 0);
  const card = lookup?.card;

  const redemption = useMemo(
    () => resolveGiftCardRedemption({
      card,
      lineItems,
      patientId,
      amountDue: due,
      userEnteredAmount: giftCardAmount,
    }),
    [card, lineItems, patientId, due, giftCardAmount],
  );

  useEffect(() => {
    if (!card || isValueCreditCard(card)) return;
    if (redemption.standaloneRedeem) {
      if (giftCardAmount !== "0" && giftCardAmount !== "") {
        onGiftCardAmountChange?.("0");
      }
      return;
    }
    const next = redemption.resolvedAmount > 0 ? String(redemption.resolvedAmount) : "";
    if (next && giftCardAmount !== next) {
      onGiftCardAmountChange?.(next);
    }
  }, [
    card,
    redemption.resolvedAmount,
    redemption.standaloneRedeem,
    giftCardAmount,
    onGiftCardAmountChange,
  ]);

  const lookupCard = async () => {
    const code = giftCardCode.trim();
    if (!code) {
      toast.error("Enter gift card code");
      return;
    }
    setBusy(true);
    try {
      const r = await api.get("/gift-cards/lookup", { params: { code } });
      const c = r.data?.card;
      if (c && isEntitlementCard(c)) {
        onLookup?.({ card: c, posBlocked: true });
        onGiftCardAmountChange?.("");
        return;
      }
      onLookup?.(r.data);
      if (c?.redeemable && isValueCreditCard(c)) {
        const bal = c.balance_value ?? c.balance_idr ?? 0;
        onGiftCardAmountChange?.(String(Math.min(bal, due)));
        toast.success(`Balance ${fmtIDR(bal)}`);
      } else if (c?.status === "cancelled") {
        toast.error("Gift card is cancelled");
      } else if (c) {
        toast.error(c?.status === "expired" ? "Gift card has expired" : "Gift card cannot be redeemed");
      }
    } catch (e) {
      onLookup?.(null);
      toast.error(e?.response?.data?.detail || "Gift card not found");
    } finally {
      setBusy(false);
    }
  };

  const posBlocked = lookup?.posBlocked && card && isEntitlementCard(card);
  const gcApplied = posBlocked ? 0 : (redemption.standaloneRedeem ? 0 : parseIdr(giftCardAmount));
  const afterGc = Math.max(0, due - gcApplied);

  if (posBlocked) {
    return (
      <div className="space-y-2" data-testid={`${testIdPrefix}-payment-fields`}>
        <GiftCardPosBlockedMessage
          card={card}
          onClear={() => {
            onGiftCardCodeChange?.("");
            onGiftCardAmountChange?.("");
            onLookup?.(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-payment-fields`}>
      <div className="flex gap-2">
        <input
          className="bl-input flex-1 font-mono uppercase"
          placeholder="GC-XXXX-XXXX"
          value={giftCardCode}
          disabled={disabled}
          onChange={(e) => onGiftCardCodeChange(e.target.value.toUpperCase())}
          data-testid={`${testIdPrefix}-code`}
        />
        <button
          type="button"
          className="bl-btn-ghost text-sm shrink-0"
          disabled={busy || loading || disabled}
          onClick={lookupCard}
        >
          Lookup
        </button>
      </div>

      {card && isValueCreditCard(card) && (
        <div>
          <label className="label-eyebrow block mb-1">Amount to redeem (IDR)</label>
          <input
            className="bl-input w-full font-mono"
            placeholder="0"
            value={giftCardAmount}
            disabled={disabled}
            onChange={(e) => onGiftCardAmountChange(e.target.value)}
            data-testid={`${testIdPrefix}-amount`}
          />
        </div>
      )}

      {card && !isValueCreditCard(card) && (
        <div
          className="rounded-lg border border-[#EAE6D7] bg-[#F8F5EC]/60 p-3 space-y-2 text-sm"
          data-testid={`${testIdPrefix}-entitlement-details`}
        >
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Type</span>
            <span>{GIFT_CARD_TYPE_LABELS[card.gift_card_type] || card.gift_card_type}</span>
          </div>
          {redemption.entitlementName && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C6C62]">
                {card.gift_card_type === "package" ? "Package" : "Treatment"}
              </span>
              <span className="text-right font-medium">{redemption.entitlementName}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Original value</span>
            <span className="font-mono">{fmtIDR(redemption.originalValue ?? card.original_value)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Remaining</span>
            <span>{formatGiftCardRemaining(card)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Status</span>
            <span>{giftCardStatusLabel(card.status)}</span>
          </div>
          {(card.expiry_date || card.expires_at) && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C6C62]">Expiry</span>
              <span>{String(card.expiry_date || card.expires_at).slice(0, 10)}</span>
            </div>
          )}
          {redemption.validationError && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2" role="alert">
              {redemption.validationError}
            </p>
          )}
          {redemption.canSubmit && redemption.confirmMessage && (
            <p className="text-xs text-[#2D5A3D] font-medium">{redemption.confirmMessage}</p>
          )}
        </div>
      )}

      {card && (
        <p className="text-xs text-[#5C6C62]">
          {card.code}
          {isValueCreditCard(card) ? (
            <>
              {" · "}
              balance {formatGiftCardRemaining(card)}
              {" · "}
              {card.status}
            </>
          ) : null}
        </p>
      )}

      {gcApplied > 0 && !redemption.standaloneRedeem && (
        <p className="text-xs text-[#2D5A3D]" data-testid={`${testIdPrefix}-redeem-summary`}>
          Redeeming {fmtIDR(gcApplied)}
          {afterGc > 0 ? ` · remaining due ${fmtIDR(afterGc)}` : " · covers amount due"}
        </p>
      )}
      {redemption.standaloneRedeem && redemption.canSubmit && (
        <p className="text-xs text-[#2D5A3D]" data-testid={`${testIdPrefix}-redeem-summary`}>
          Package will be assigned to the patient when you complete payment (no IDR amount from card).
        </p>
      )}
    </div>
  );
}
