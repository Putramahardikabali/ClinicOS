import { parseIdr } from "@/lib/posUtils";
import { formatGiftCardRemaining } from "@/lib/giftCardDisplay";

export function getGiftCardType(card) {
  return (card?.gift_card_type || "value_credit").trim().toLowerCase();
}

export function isValueCreditCard(card) {
  return getGiftCardType(card) === "value_credit";
}

export function isEntitlementCard(card) {
  const t = getGiftCardType(card);
  return t === "treatment" || t === "package";
}

function lineItemType(item) {
  const t = (item?.item_type || "custom").toLowerCase();
  return t === "service" ? "treatment" : t;
}

function lineCatalogId(item) {
  const t = lineItemType(item);
  if (t === "treatment") {
    return item.treatment_catalog_id || item.catalog_id;
  }
  if (t === "package") {
    return item.package_catalog_id || item.catalog_id;
  }
  return item.catalog_id;
}

export function linePayableAmount(item) {
  if (item?.total != null) return Math.max(0, Number(item.total) || 0);
  if (item?.line_total_idr != null) return Math.max(0, Number(item.line_total_idr) || 0);
  if (item?.amount_charged != null) return Math.max(0, Number(item.amount_charged) || 0);
  const qty = parseFloat(item?.qty ?? item?.quantity ?? 1) || 1;
  const unit = parseInt(item?.unit_price ?? item?.unit_price_idr ?? 0, 10) || 0;
  const disc = parseInt(item?.discount ?? 0, 10) || 0;
  return Math.max(0, Math.round(unit * qty - disc));
}

/** Find cart/invoice line matching a treatment or package gift card. */
export function findMatchingEntitlementLine(card, lineItems = []) {
  const gcType = getGiftCardType(card);
  if (gcType === "treatment") {
    const tid = card.treatment_catalog_id;
    if (!tid) return null;
    return (lineItems || []).find(
      (it) => lineItemType(it) === "treatment" && lineCatalogId(it) === tid,
    ) || null;
  }
  if (gcType === "package") {
    const pid = card.package_catalog_id;
    if (!pid) return null;
    return (lineItems || []).find(
      (it) => lineItemType(it) === "package" && lineCatalogId(it) === pid,
    ) || null;
  }
  return null;
}

/**
 * Resolve redemption UI state for POS / invoice gift card payment.
 */
export function resolveGiftCardRedemption({
  card,
  lineItems = [],
  patientId,
  amountDue = 0,
  userEnteredAmount = "",
}) {
  const due = Math.max(0, Number(amountDue) || 0);
  if (!card) {
    return {
      mode: "none",
      showAmountInput: false,
      resolvedAmount: 0,
      canSubmit: false,
      validationError: null,
      standaloneRedeem: false,
    };
  }

  const gcType = getGiftCardType(card);

  if (gcType === "value_credit") {
    const bal = card.balance_value ?? card.balance_idr ?? 0;
    const entered = parseIdr(userEnteredAmount);
    let validationError = null;
    if (entered > 0 && entered > bal) {
      validationError = `Amount exceeds gift card balance (${bal.toLocaleString("id-ID")} IDR)`;
    } else if (entered > 0 && entered > due) {
      validationError = `Amount cannot exceed amount due`;
    }
    return {
      mode: "value_credit",
      showAmountInput: true,
      resolvedAmount: entered,
      canSubmit: entered > 0 && !validationError,
      validationError,
      standaloneRedeem: false,
      balanceLabel: formatGiftCardRemaining(card),
    };
  }

  const match = findMatchingEntitlementLine(card, lineItems);
  const original = card.original_value ?? card.initial_value_idr ?? 0;

  if (gcType === "treatment") {
    if (!match) {
      const name = card.treatment_name_snapshot || "this treatment";
      return {
        mode: "treatment",
        showAmountInput: false,
        resolvedAmount: 0,
        canSubmit: false,
        validationError: `This gift card is for ${name}. Add the matching treatment before redeeming.`,
        standaloneRedeem: false,
        entitlementName: card.treatment_name_snapshot,
        originalValue: original,
      };
    }
    const lineAmt = linePayableAmount(match);
    const resolved = due > 0 ? Math.min(lineAmt, due) : lineAmt;
    return {
      mode: "treatment",
      showAmountInput: false,
      resolvedAmount: resolved,
      canSubmit: resolved > 0,
      validationError: resolved > 0 ? null : "Matching treatment line has no payable amount",
      standaloneRedeem: false,
      entitlementName: card.treatment_name_snapshot || match.name_snapshot,
      originalValue: original,
      matchLine: match,
      confirmMessage: `Redeem treatment gift card — applies ${resolved.toLocaleString("id-ID")} IDR to this sale`,
    };
  }

  if (gcType === "package") {
    if (match) {
      const lineAmt = linePayableAmount(match);
      const resolved = due > 0 ? Math.min(lineAmt, due) : lineAmt;
      return {
        mode: "package",
        showAmountInput: false,
        resolvedAmount: resolved,
        canSubmit: resolved > 0,
        validationError: resolved > 0 ? null : "Matching package line has no payable amount",
        standaloneRedeem: false,
        entitlementName: card.package_name_snapshot || match.name_snapshot,
        originalValue: original,
        matchLine: match,
        confirmMessage: `Redeem package gift card — applies ${resolved.toLocaleString("id-ID")} IDR to this sale`,
      };
    }
    if (!patientId) {
      return {
        mode: "package",
        showAmountInput: false,
        resolvedAmount: 0,
        canSubmit: false,
        validationError: "Select a patient before redeeming a package gift card.",
        standaloneRedeem: false,
        entitlementName: card.package_name_snapshot,
        originalValue: original,
      };
    }
    return {
      mode: "package",
      showAmountInput: false,
      resolvedAmount: 0,
      canSubmit: true,
      validationError: null,
      standaloneRedeem: true,
      entitlementName: card.package_name_snapshot,
      originalValue: original,
      confirmMessage: "Redeem package gift card — creates patient package (no cash payment from card)",
    };
  }

  return {
    mode: "unknown",
    showAmountInput: false,
    resolvedAmount: 0,
    canSubmit: false,
    validationError: "Unsupported gift card type",
    standaloneRedeem: false,
  };
}
