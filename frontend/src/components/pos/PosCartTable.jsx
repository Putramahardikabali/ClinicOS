import { Trash2 } from "lucide-react";
import PosItemTypeBadge from "@/components/pos/PosItemTypeBadge";
import { useAuth, hasPermission } from "@/lib/auth";
import { fmtIDR, lineTotal } from "@/lib/posUtils";

export default function PosCartTable({ cart, onUpdateLine, onRemoveLine }) {
  const { user } = useAuth();
  const canOverridePrice = hasPermission(user, "pos.override_price");
  if (!cart.length) {
    return <p className="text-sm text-[#5C6C62] py-2">Cart is empty — add items from the tabs above.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[520px]" data-testid="pos-cart-table">
        <thead>
          <tr className="text-left text-[#5C6C62] border-b border-[#EAE6D7] text-xs uppercase tracking-wide">
            <th className="py-2 pr-2 w-24">Type</th>
            <th className="py-2 pr-2">Item</th>
            <th className="py-2 pr-2 w-20">Qty</th>
            <th className="py-2 pr-2 w-28 text-right">Unit</th>
            <th className="py-2 pr-2 w-24 text-right">Total</th>
            <th className="py-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {cart.map((ln) => (
            <tr key={ln.key} className="border-b border-[#EAE6D7] last:border-0 align-middle" data-testid="pos-cart-line">
              <td className="py-2 pr-2">
                <PosItemTypeBadge type={ln.item_type} />
              </td>
              <td className="py-2 pr-2">
                <div className="font-medium text-[#2D3A33]">{ln.name_snapshot}</div>
                {ln.price_not_set && !String(ln.unit_price).trim() && (
                  <span className="text-[10px] text-[#B45309]">Set price</span>
                )}
              </td>
              <td className="py-2 pr-2">
                {ln.item_type === "gift_card" ? (
                  <span className="text-[#5C6C62]">1</span>
                ) : (
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    className="bl-input py-1 px-2 w-full font-mono text-sm"
                    value={ln.qty}
                    onChange={(e) => onUpdateLine(ln.key, { qty: e.target.value })}
                    data-testid={`pos-cart-qty-${ln.key}`}
                  />
                )}
              </td>
              <td className="py-2 pr-2">
                {ln.item_type === "gift_card" && ln.gift_card_locked_price && !canOverridePrice ? (
                  <span className="font-mono text-sm block text-right py-1.5">{fmtIDR(ln.unit_price)}</span>
                ) : (
                  <input
                    className="bl-input py-1 px-2 w-full font-mono text-sm text-right"
                    value={ln.unit_price}
                    onChange={(e) => onUpdateLine(ln.key, { unit_price: e.target.value, price_not_set: false })}
                    data-testid={`pos-cart-price-${ln.key}`}
                  />
                )}
              </td>
              <td className="py-2 pr-2 text-right font-mono whitespace-nowrap">{fmtIDR(lineTotal(ln))}</td>
              <td className="py-2 text-right">
                <button type="button" onClick={() => onRemoveLine(ln.key)} className="text-[#B14A2C] p-1" aria-label="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
