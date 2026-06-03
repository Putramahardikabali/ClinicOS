import { useEffect, useState } from "react";
import api from "@/lib/api";
import { fmtIDR } from "@/lib/posUtils";

const METHOD_LABELS = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  qris: "QRIS",
  other: "Other",
};

export default function PosDayClosingSnippet() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api
      .get("/closing/preview", { params: { date: today } })
      .then((r) => setData(r.data))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const pm = data.payment_methods || {};
  const posCount = data.pos?.transaction_count || 0;

  return (
    <div className="bl-card p-4 text-sm" data-testid="pos-day-closing-snippet">
      <div className="label-eyebrow mb-2">Today&apos;s closing preview</div>
      <div className="font-display text-xl text-[#2D3A33]">{fmtIDR(data.total_collected_idr)}</div>
      <div className="text-xs text-[#5C6C62] mt-1">
        {posCount} POS sale{posCount === 1 ? "" : "s"} · {data.invoices?.transaction_count || 0} invoice
        {(data.invoices?.transaction_count || 0) === 1 ? "" : "s"}
        {data.is_closed && " · Day closed"}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {Object.entries(pm).map(([method, amount]) =>
          amount > 0 ? (
            <span key={method} className="px-2 py-1 rounded-lg bg-[#F8F5EC] text-xs">
              {METHOD_LABELS[method] || method}: {fmtIDR(amount)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
