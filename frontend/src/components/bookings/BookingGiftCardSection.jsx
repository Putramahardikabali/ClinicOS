import { useState } from "react";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import SearchInput from "@/components/ui/SearchInput";
import { fmtIDR } from "@/lib/posUtils";
import { formatGiftCardRemaining, giftCardStatusLabel } from "@/lib/giftCardDisplay";
import { GIFT_CARD_TYPE_LABELS } from "@/lib/giftCards";
import {
  VALUE_CREDIT_BOOKING_MESSAGE,
  bookingGiftCardLookupParams,
  giftCardLookupToApplied,
  isGiftCardServiceLocked,
  normalizeGiftCardLookupError,
} from "@/lib/bookingGiftCard";

export {
  applyGiftCardToBookingForm,
  clearGiftCardFromBookingForm,
  isGiftCardServiceLocked,
} from "@/lib/bookingGiftCard";

function GiftCardResultCard({ data, error, informational }) {
  const card = data?.card;
  if (!card && !error) return null;
  const gcType = data?.gift_card_type || card?.gift_card_type;
  const name =
    data?.treatment_name
    || data?.package_name
    || card?.treatment_name_snapshot
    || card?.package_name_snapshot;

  return (
    <div
      className={`rounded-lg border p-3 text-sm space-y-2 ${
        error && !informational
          ? "border-red-200 bg-red-50"
          : informational
            ? "border-[#EAE6D7] bg-[#F8F5EC]/80"
            : "border-[#C5D9CB] bg-[#EDF3EF]/60"
      }`}
      data-testid="booking-gift-card-result"
    >
      {card && (
        <>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Code</span>
            <span className="font-mono font-medium">{card.code}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Type</span>
            <span>{GIFT_CARD_TYPE_LABELS[gcType] || gcType}</span>
          </div>
          {name && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C6C62]">{gcType === "package" ? "Package" : "Treatment"}</span>
              <span className="text-right font-medium">{name}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Value</span>
            <span className="font-mono">{fmtIDR(data?.face_value_idr ?? card.original_value)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Remaining</span>
            <span>{formatGiftCardRemaining(card)}</span>
          </div>
          {(card.expiry_date || card.expires_at) && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C6C62]">Expiry</span>
              <span>{String(card.expiry_date || card.expires_at).slice(0, 10)}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Status</span>
            <span>{giftCardStatusLabel(card.status)}</span>
          </div>
        </>
      )}
      {error && (
        <p
          className={`text-xs ${informational ? "text-[#2D3A33]" : "text-red-900"}`}
          role={informational ? "status" : "alert"}
          data-testid={informational ? "booking-gift-card-value-info" : "booking-gift-card-error"}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Redeem treatment/package gift cards when creating a staff booking.
 */
export default function BookingGiftCardSection({
  patientId,
  applied,
  onAppliedChange,
  disabled,
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [lookupPreview, setLookupPreview] = useState(null);

  const lookup = async () => {
    const c = code.trim();
    if (!c) {
      toast.error("Enter gift card code");
      return;
    }
    setBusy(true);
    setLookupPreview(null);
    try {
      const r = await api.get("/gift-cards/booking-lookup", {
        params: bookingGiftCardLookupParams(c, patientId),
      });
      const data = r.data;

      if (data.informational || data.gift_card_type === "value_credit") {
        setLookupPreview({
          ...data,
          informational: true,
          error: data.error || VALUE_CREDIT_BOOKING_MESSAGE,
        });
        return;
      }

      if (!data.valid) {
        const msg = normalizeGiftCardLookupError(data.error);
        if (msg) {
          setLookupPreview({ ...data, error: msg });
          toast.error(msg);
        }
        return;
      }

      const nextApplied = giftCardLookupToApplied(data);
      if (nextApplied) {
        onAppliedChange(nextApplied);
        toast.success(
          nextApplied.gift_card_type === "treatment"
            ? `Treatment gift card applied: ${nextApplied.treatment_name || "Treatment"}`
            : `Package gift card applied: ${nextApplied.package_name || "Package"}`,
        );
        setOpen(false);
        setCode("");
        setLookupPreview(null);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gift card not found");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    onAppliedChange(null);
    setCode("");
    setLookupPreview(null);
  };

  const locked = isGiftCardServiceLocked(applied);

  if (!open && !applied && !lookupPreview) {
    return (
      <button
        type="button"
        className="text-sm text-[var(--bl-primary)] font-medium inline-flex items-center gap-1.5"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="booking-gift-card-open"
      >
        <Gift className="w-4 h-4" />
        Redeem gift card
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[#EAE6D7] p-3 space-y-3 bg-[#F8F5EC]/40" data-testid="booking-gift-card-section">
      <div className="flex items-center justify-between gap-2">
        <span className="label-eyebrow">Gift card</span>
        {!applied && (
          <button
            type="button"
            className="text-xs text-[#5C6C62] hover:text-[#2D3A33]"
            onClick={() => {
              setOpen(false);
              setLookupPreview(null);
            }}
          >
            Hide
          </button>
        )}
      </div>

      {applied && locked ? (
        <div className="space-y-2" data-testid="booking-gift-card-applied">
          <div className="rounded-lg border border-[#C5D9CB] bg-[#EDF3EF] p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[#2D5A3D]">
                  {applied.gift_card_type === "treatment"
                    ? `Treatment gift card applied: ${applied.treatment_name || "Treatment"}`
                    : `Package gift card applied: ${applied.package_name || "Package"}`}
                </p>
                <p className="font-mono text-xs mt-1 text-[#5C6C62]">{applied.code}</p>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-[var(--bl-primary)] font-medium shrink-0"
                  data-testid="booking-gift-card-remove"
                >
                  Remove gift card
                </button>
              )}
            </div>
            <GiftCardResultCard data={{ card: applied.card, ...applied }} />
          </div>
          {applied.gift_card_type === "treatment" && (
            <p className="text-xs text-[#2D3A33]">
              Treatment is locked to this gift card. Pick date, time, and assigned provider below.
            </p>
          )}
          {applied.gift_card_type === "package" && !patientId && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2" role="alert">
              Select or create a patient before redeeming this package gift card.
            </p>
          )}
          {applied.gift_card_type === "package" && patientId && (
            <p className="text-xs text-[#2D3A33]">
              Package is locked to this gift card. The gift card stays reserved until the visit is completed;
              the patient package is created when the invoice is finalized.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <SearchInput
              className="flex-1"
              placeholder="GC-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={disabled || busy}
              data-testid="booking-gift-card-code"
            />
            <button
              type="button"
              className="bl-btn-ghost text-sm shrink-0"
              disabled={busy || disabled}
              onClick={lookup}
            >
              Lookup
            </button>
          </div>
          {lookupPreview && (
            <GiftCardResultCard
              data={lookupPreview}
              error={lookupPreview.error}
              informational={lookupPreview.informational}
            />
          )}
          <p className="text-xs text-[#5C6C62]">
            Treatment and package gift cards are redeemed here so availability can be checked.
            Value/credit cards are applied at invoice or via store credit on POS.
          </p>
        </>
      )}
    </div>
  );
}
