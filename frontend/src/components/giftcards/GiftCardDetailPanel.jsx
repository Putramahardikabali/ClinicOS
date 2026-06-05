import { Link } from "react-router-dom";
import {
  Copy, ExternalLink, History, Printer, X,
} from "lucide-react";
import { toast } from "sonner";
import { fmtIDR } from "@/lib/posUtils";
import { formatGiftCardRemaining } from "@/lib/giftCardDisplay";
import { GIFT_CARD_TYPE_LABELS, STATUS_LABELS } from "@/lib/giftCards";

function DetailRow({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-[#EAE6D7] last:border-0">
      <span className="text-[#5C6C62] shrink-0">{label}</span>
      <span className="text-right font-medium text-[#2D3A33]">{children}</span>
    </div>
  );
}

export default function GiftCardDetailPanel({
  detail,
  loading,
  clinicName,
  canManage,
  canReleaseReservation = false,
  onClose,
  onCancel,
  onReleaseReservation,
  onShowRedemptions,
  onPrint,
}) {
  const copyCode = () => {
    if (!detail?.code) return;
    navigator.clipboard.writeText(detail.code).then(
      () => toast.success("Code copied"),
      () => toast.error("Could not copy"),
    );
  };

  const canCancel =
    canManage
    && detail
    && ["active", "partially_redeemed"].includes((detail.status || "").toLowerCase());

  return (
    <div
      className="fixed inset-0 z-50 bg-[#2D3A33]/40 flex justify-end"
      onClick={onClose}
      data-testid="gift-card-detail-overlay"
    >
      <div
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#EAE6D7] p-4 flex items-start justify-between gap-2 z-10">
          <div className="min-w-0">
            <p className="label-eyebrow">Gift card</p>
            <h2 className="font-display text-xl font-mono truncate">{detail?.code || "…"}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB] shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 space-y-4">
          {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}

          {detail && !loading && (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="bl-btn-ghost text-sm inline-flex items-center gap-1.5" onClick={copyCode}>
                  <Copy className="w-4 h-4" /> Copy code
                </button>
                <button
                  type="button"
                  className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
                  onClick={onPrint}
                  data-testid="gift-card-print-btn"
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button
                  type="button"
                  className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
                  onClick={onShowRedemptions}
                >
                  <History className="w-4 h-4" /> Redemptions
                </button>
              </div>

              <div className="bl-card p-4 space-y-0">
                <DetailRow label="Type">{GIFT_CARD_TYPE_LABELS[detail.gift_card_type] || detail.gift_card_type}</DetailRow>
                <DetailRow label="Status">
                  <span className="capitalize">{STATUS_LABELS[detail.status] || detail.status}</span>
                </DetailRow>
                <DetailRow label="Original value">{fmtIDR(detail.original_value ?? detail.initial_value_idr)}</DetailRow>
                <DetailRow label="Remaining">{formatGiftCardRemaining(detail)}</DetailRow>
                <DetailRow label="Expiry">{(detail.expiry_date || detail.expires_at || "—").slice(0, 10)}</DetailRow>
              </div>

              <div className="bl-card p-4">
                <p className="label-eyebrow mb-2">Purchaser</p>
                <p className="text-sm font-medium">{detail.purchaser_name || detail.customer_name_snapshot || "—"}</p>
                {detail.purchaser_phone && <p className="text-sm text-[#5C6C62]">{detail.purchaser_phone}</p>}
              </div>

              <div className="bl-card p-4">
                <p className="label-eyebrow mb-2">Recipient</p>
                <p className="text-sm font-medium">{detail.recipient_name || "—"}</p>
                {detail.recipient_phone && <p className="text-sm text-[#5C6C62]">{detail.recipient_phone}</p>}
                {detail.recipient_email && <p className="text-sm text-[#5C6C62]">{detail.recipient_email}</p>}
              </div>

              {detail.message && (
                <div className="bl-card p-4">
                  <p className="label-eyebrow mb-1">Message</p>
                  <p className="text-sm whitespace-pre-wrap">{detail.message}</p>
                </div>
              )}

              {detail.notes && (
                <div className="bl-card p-4">
                  <p className="label-eyebrow mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{detail.notes}</p>
                </div>
              )}

              {(detail.status === "reserved" || detail.reserved_booking_id) && (
                <div className="bl-card p-4 space-y-2" data-testid="gift-card-reserved-section">
                  <p className="label-eyebrow">Reserved for upcoming appointment</p>
                  {detail.reserved_booking ? (
                    <>
                      <p className="text-sm font-medium">{detail.reserved_booking.treatment || "Appointment"}</p>
                      {detail.reserved_booking.scheduled_at && (
                        <p className="text-xs text-[#5C6C62]">
                          {new Date(detail.reserved_booking.scheduled_at).toLocaleString()}
                          {detail.reserved_booking.patient_name
                            ? ` · ${detail.reserved_booking.patient_name}`
                            : ""}
                        </p>
                      )}
                    </>
                  ) : detail.reserved_booking_id ? (
                    <p className="text-sm font-mono text-[#5C6C62]">{detail.reserved_booking_id}</p>
                  ) : null}
                  {detail.reserved_booking_id && (
                    <Link
                      to="/bookings"
                      className="text-sm text-[var(--bl-primary)] font-medium inline-flex items-center gap-1 hover:underline"
                    >
                      View appointment
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  )}
                  {canReleaseReservation && onReleaseReservation && (
                    <button
                      type="button"
                      className="bl-btn-ghost text-sm w-full mt-1"
                      onClick={() => onReleaseReservation(detail.id)}
                      data-testid="gift-card-release-reservation"
                    >
                      Release reservation
                    </button>
                  )}
                </div>
              )}

              {(detail.redeemed_booking_id || detail.redeemed_invoice_id) && (
                <div className="bl-card p-4">
                  <p className="label-eyebrow mb-2">Redeemed via</p>
                  {detail.redeemed_booking_id && (
                    <p className="text-sm">Appointment: <span className="font-mono">{detail.redeemed_booking_id}</span></p>
                  )}
                  {detail.redeemed_invoice_id && (
                    <p className="text-sm mt-1">Invoice: <span className="font-mono">{detail.redeemed_invoice_id}</span></p>
                  )}
                  {detail.redeemed_patient_package_id && (
                    <p className="text-sm mt-1">Patient package: <span className="font-mono">{detail.redeemed_patient_package_id}</span></p>
                  )}
                </div>
              )}

              {(detail.issued_sale_id || detail.pos_sale_id) && (
                <div className="bl-card p-4">
                  <p className="label-eyebrow mb-2">Issued from POS sale</p>
                  <Link
                    to="/pos"
                    className="text-sm text-[var(--bl-primary)] font-medium inline-flex items-center gap-1 hover:underline"
                  >
                    {detail.issued_sale_number || detail.issued_sale_id}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  {detail.issued_sale_paid_at && (
                    <p className="text-xs text-[#5C6C62] mt-1">
                      Paid {new Date(detail.issued_sale_paid_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              <div id="gift-card-redemptions" className="bl-card p-4">
                <p className="label-eyebrow mb-2">Redemption history</p>
                {(detail.redemptions || []).length === 0 ? (
                  <p className="text-sm text-[#5C6C62]">No redemptions yet.</p>
                ) : (
                  <ul className="text-sm space-y-3 max-h-64 overflow-y-auto">
                    {detail.redemptions.map((r) => (
                      <li key={r.id} className="border-b border-[#EAE6D7] pb-2 last:border-0">
                        <div className="flex justify-between gap-2">
                          <span className="font-mono">{fmtIDR(r.amount_redeemed ?? r.amount_idr)}</span>
                          <span className="text-xs text-[#5C6C62] capitalize">
                            {r.reversed ? "Reversed" : (r.reference_type || "").replace("_", " ")}
                          </span>
                        </div>
                        <div className="text-xs text-[#5C6C62] mt-0.5">
                          {new Date(r.created_at || r.redeemed_at).toLocaleString()}
                          {" · "}balance after {fmtIDR(r.balance_after ?? r.balance_after_idr)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {canCancel && (
                <button
                  type="button"
                  className="bl-btn-ghost text-sm w-full text-[#B14A2C]"
                  onClick={() => onCancel(detail.id)}
                >
                  Cancel gift card
                </button>
              )}
            </>
          )}
        </div>


      </div>
    </div>
  );
}
