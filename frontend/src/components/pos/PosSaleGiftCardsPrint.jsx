import GiftCardPrintDocument from "@/components/giftcards/GiftCardPrintDocument";
import { buildGiftCardFromSaleItem, giftCardItemsFromSale } from "@/lib/posGiftCardSale";

export default function PosSaleGiftCardsPrint({ sale, clinicName = "Clinic" }) {
  const items = giftCardItemsFromSale(sale);
  if (!items.length) return null;

  return (
    <div className="pos-sale-gift-cards-print space-y-0">
      {items.map((it, idx) => (
        <div
          key={it.gift_card_id || it.id || `gc-${idx}`}
          className={idx > 0 ? "pos-gift-card-print-page" : "pos-gift-card-print-page-first"}
        >
          <GiftCardPrintDocument
            card={buildGiftCardFromSaleItem(it, sale)}
            clinicName={clinicName}
          />
        </div>
      ))}
    </div>
  );
}
