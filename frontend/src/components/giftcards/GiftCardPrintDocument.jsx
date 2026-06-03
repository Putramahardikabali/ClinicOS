import { fmtIDR } from "@/lib/posUtils";

const TYPE_LABELS = {
  value_credit: "Value / Credit",
  treatment: "Treatment",
  package: "Package",
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d;
  }
}

export default function GiftCardPrintDocument({ card, clinicName = "Clinic" }) {
  if (!card) return null;

  const isValue = card.gift_card_type === "value_credit";

  return (
    <article className="gift-card-print-doc mx-auto w-full max-w-md text-[#2D3A33] border-2 border-[#2D3A33] rounded-xl p-8 bg-white">
      <header className="text-center border-b border-[#EAE6D7] pb-6 mb-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#8A9A86]">Gift Card</p>
        <h1 className="font-display text-2xl font-semibold mt-2">{clinicName}</h1>
        <p className="text-xs text-[#5C6C62] mt-2">{TYPE_LABELS[card.gift_card_type] || card.gift_card_type}</p>
      </header>

      <div className="text-center mb-8">
        <p className="text-xs uppercase tracking-widest text-[#5C6C62] mb-2">Card code</p>
        <p className="font-mono text-3xl font-bold tracking-wider">{card.code}</p>
      </div>

      {isValue && (
        <div className="text-center mb-8 py-4 bg-[#F8F5EC] rounded-lg">
          <p className="text-xs uppercase text-[#5C6C62]">Value</p>
          <p className="font-display text-3xl mt-1">{fmtIDR(card.balance_value ?? card.balance_idr)}</p>
          {(card.original_value ?? card.initial_value_idr) !== (card.balance_value ?? card.balance_idr) && (
            <p className="text-xs text-[#5C6C62] mt-1">
              of {fmtIDR(card.original_value ?? card.initial_value_idr)} original
            </p>
          )}
        </div>
      )}

      {!isValue && (
        <div className="text-center mb-8 py-4 bg-[#F8F5EC] rounded-lg">
          <p className="text-xs uppercase text-[#5C6C62]">Entitlement</p>
          <p className="font-display text-lg mt-1">
            {card.treatment_name_snapshot || card.package_name_snapshot || TYPE_LABELS[card.gift_card_type]}
          </p>
        </div>
      )}

      {card.purchaser_name && (
        <p className="text-center text-sm text-[#5C6C62] mb-4">
          <span>From: </span>
          {card.purchaser_name}
          {card.purchaser_phone ? ` · ${card.purchaser_phone}` : ""}
        </p>
      )}

      {card.recipient_name && (
        <div className="text-center mb-4 text-sm">
          <p className="text-xs uppercase text-[#5C6C62] mb-1">Recipient</p>
          <p className="font-medium text-lg">{card.recipient_name}</p>
        </div>
      )}

      {card.message && (
        <blockquote className="text-center text-sm italic text-[#5C6C62] border-t border-[#EAE6D7] pt-4 mb-6">
          &ldquo;{card.message}&rdquo;
        </blockquote>
      )}

      {card.expiry_date && (
        <p className="text-center text-sm mb-6">
          <span className="text-[#5C6C62]">Expiry: </span>
          <span className="font-medium">{formatDate(card.expiry_date)}</span>
        </p>
      )}

      <footer className="text-center text-xs text-[#5C6C62] pt-6 border-t border-[#EAE6D7] space-y-2">
        <p>Please present this code to redeem.</p>
        <p>This gift card is valid only at this clinic.</p>
        {card.issued_at && (
          <p className="text-[10px] text-[#8A9A86] pt-2">Issued {formatDate(card.issued_at)}</p>
        )}
      </footer>
    </article>
  );
}
