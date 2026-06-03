import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { giftCardRedemptionIdr, INCOME_PAYMENT_METHOD_KEYS } from "@/lib/closingGiftCards";
import { fmtIDR, parseIdr } from "@/lib/posUtils";

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bl-card p-3">
      <div className="text-xs text-[#5C6C62]">{label}</div>
      <div className="font-display text-lg mt-1">{value}</div>
      {sub && <div className="text-xs text-[#8A9A86] mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-[#EAE6D7] last:border-0">
      <span className="text-[#5C6C62]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

const METHOD_LABELS = {
  cash: "Cash",
  card: "Card",
  qris: "QRIS",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export default function ClosingTodayTab() {
  const { user } = useAuth();
  const canClose = hasPermission(user, "closing.create");
  const canReopen = hasPermission(user, "closing.reopen");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actualCashInput, setActualCashInput] = useState("");
  const [notes, setNotes] = useState("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/closing/preview", { params: { date } });
      setPreview(r.data);
      if (r.data?.is_closed) {
        setActualCashInput(
          r.data.actual_cash_counted_idr != null
            ? String(r.data.actual_cash_counted_idr)
            : "",
        );
        setNotes(r.data.closing_notes || "");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load preview");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const expectedCash = preview?.expected_cash_idr ?? preview?.income_payment_methods?.cash ?? preview?.payment_methods?.cash ?? 0;
  const actualCash = parseIdr(actualCashInput);
  const cashDiff = useMemo(() => {
    if (actualCashInput.trim() === "") return null;
    return actualCash - expectedCash;
  }, [actualCash, actualCashInput, expectedCash]);

  const closeDay = async () => {
    if (!window.confirm(`Close business day ${date}? Paid transactions will be locked.`)) return;
    setBusy(true);
    try {
      const payload = { date, notes: notes.trim() };
      if (actualCashInput.trim() !== "") {
        payload.actual_cash_counted_idr = actualCash;
      }
      await api.post("/closing/close", payload);
      toast.success("Day closed");
      loadPreview();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not close day");
    } finally {
      setBusy(false);
    }
  };

  const reopenDay = async () => {
    const reason = window.prompt("Reason for reopening (optional):") ?? "";
    if (!window.confirm(`Reopen ${date}?`)) return;
    setBusy(true);
    try {
      await api.post("/closing/reopen", { date, reason });
      toast.success("Day reopened");
      setActualCashInput("");
      setNotes("");
      loadPreview();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reopen");
    } finally {
      setBusy(false);
    }
  };

  const pm = preview?.payment_methods || {};
  const bd = preview?.breakdown || {};
  const refunds = preview?.refunds || {};
  const pos = preview?.pos || {};
  const inv = preview?.invoices || {};
  const txs = preview?.transactions || [];

  return (
    <div className="space-y-6" data-testid="closing-today-tab">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-eyebrow block mb-1">Business date</label>
          <input
            type="date"
            className="bl-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="closing-date-input"
          />
        </div>
        <button type="button" className="bl-btn-ghost text-sm" onClick={loadPreview}>
          Refresh
        </button>
        {canReopen && preview?.is_closed && (
          <button type="button" className="bl-btn-ghost text-sm" disabled={busy} onClick={reopenDay}>
            Reopen day
          </button>
        )}
      </div>

      {preview?.is_closed && (
        <div className="bl-card p-3 bg-[#EDF3EF] text-sm text-[#2D5A3D]">
          This day is closed. Included POS sales and paid invoices are locked until the day is reopened.
        </div>
      )}

      {loading && <p className="text-sm text-[#5C6C62]">Loading preview…</p>}

      {preview && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <SummaryCard label="Money collected" value={fmtIDR(preview.money_collected_idr ?? preview.total_collected_idr)} sub="Cash, card, QRIS, bank" />
            <SummaryCard label="Gift card redemptions" value={fmtIDR(preview.gift_card_redemptions_idr)} sub="Not cash income" />
            <SummaryCard label="Outstanding liability" value={fmtIDR(preview.outstanding_gift_card_liability_idr)} sub="Active card balances" />
            <SummaryCard label="Expected cash" value={fmtIDR(expectedCash)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bl-card p-4">
              <div className="label-eyebrow mb-2">Sales breakdown</div>
              <Row label="Product sales" value={fmtIDR(bd.product_sales_idr ?? pos.product_sales_idr)} />
              <Row label="Package sales" value={fmtIDR(bd.package_sales_idr ?? pos.package_sales_idr)} />
              <Row label="Service sales" value={fmtIDR(bd.service_sales_idr ?? pos.service_sales_idr)} />
              <Row label="Custom sales" value={fmtIDR(bd.custom_sales_idr ?? pos.custom_sales_idr)} />
              <Row label="Gift card sales (issued)" value={fmtIDR(bd.gift_card_sales_idr ?? pos.gift_card_sales_idr)} />
              <Row
                label="Sales paid with gift card"
                value={fmtIDR(bd.gift_card_redemption_settled_idr ?? preview.gift_card_redemption_settled_idr)}
              />
              <Row
                label="Gift card redemptions"
                value={fmtIDR(bd.gift_card_redemptions_idr ?? preview.gift_card_redemptions_idr)}
              />
              <Row label="Refunds / adjustments" value={fmtIDR(bd.refunds_idr ?? refunds.total_idr ?? 0)} />
              <Row label="Store credit payments" value={fmtIDR(bd.store_credit_payments_idr ?? preview.store_credit_payments_idr ?? 0)} />
              <Row label="Wallet credits issued" value={fmtIDR(bd.wallet_credits_issued_idr ?? preview.wallet?.wallet_credits_issued_idr ?? 0)} />
              <Row label="Refunds to wallet" value={fmtIDR(bd.refunds_to_wallet_idr ?? preview.wallet?.refunds_to_wallet_idr ?? 0)} />
              <Row label="Gift card → wallet" value={fmtIDR(bd.gift_card_to_wallet_idr ?? preview.wallet?.gift_card_to_wallet_idr ?? 0)} />
              <Row label="Outstanding wallet liability" value={fmtIDR(preview.outstanding_wallet_liability_idr ?? 0)} />
              <Row label="Treatment invoices" value={fmtIDR(bd.treatment_invoice_payments_idr ?? inv.treatment_payments_idr)} />
            </div>
            <div className="bl-card p-4">
              <div className="label-eyebrow mb-2">Income (money collected)</div>
              {INCOME_PAYMENT_METHOD_KEYS.map((k) =>
                (pm[k] || 0) > 0 ? (
                  <Row key={k} label={METHOD_LABELS[k] || k} value={fmtIDR(pm[k])} />
                ) : null,
              )}
              {giftCardRedemptionIdr(preview) > 0 && (
                <Row label="Gift card redemptions" value={fmtIDR(giftCardRedemptionIdr(preview))} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bl-card p-4">
              <div className="label-eyebrow mb-2">POS (paid)</div>
              <Row label="Count" value={String(pos.transaction_count || 0)} />
              <Row label="Money collected" value={fmtIDR(pos.money_collected_idr ?? pos.total_collected_idr)} />
              <Row label="Gift card sales" value={fmtIDR(pos.gift_card_sales_idr)} />
            </div>
            <div className="bl-card p-4">
              <div className="label-eyebrow mb-2">Invoices (paid)</div>
              <Row label="Count" value={String(inv.transaction_count || 0)} />
              <Row label="Money collected" value={fmtIDR(inv.money_collected_idr ?? inv.total_collected_idr)} />
              <Row label="Treatment lines" value={fmtIDR(inv.treatment_payments_idr)} />
            </div>
          </div>

          <div className="bl-card p-4 space-y-3">
            <div className="label-eyebrow">Cash reconciliation</div>
            <Row label="Expected cash" value={fmtIDR(expectedCash)} />
            <div>
              <label className="text-xs text-[#5C6C62] block mb-1">Actual cash counted</label>
              <input
                type="text"
                className="bl-input w-full font-mono"
                placeholder="0"
                value={actualCashInput}
                onChange={(e) => setActualCashInput(e.target.value)}
                disabled={preview.is_closed && !canReopen}
                data-testid="closing-actual-cash"
              />
            </div>
            {cashDiff != null && <Row label="Difference" value={fmtIDR(cashDiff)} />}
            <textarea
              className="bl-input w-full min-h-[72px] text-sm"
              placeholder="Closing notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={preview.is_closed && !canReopen}
            />
            {canClose && !preview.is_closed && (
              <button type="button" className="bl-btn-primary w-full sm:w-auto" disabled={busy} onClick={closeDay} data-testid="closing-close-day">
                {busy ? "Closing…" : "Close day"}
              </button>
            )}
          </div>

          <div className="bl-card p-4 overflow-x-auto">
            <div className="label-eyebrow mb-2">Transactions</div>
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-left text-[#5C6C62] border-b border-[#EAE6D7]">
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Ref</th>
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Pay</th>
                  <th className="py-2 text-right">Cash/card</th>
                  <th className="py-2 text-right">GC redeem</th>
                </tr>
              </thead>
              <tbody>
                {txs.slice(0, 50).map((tx) => (
                  <tr key={`${tx.source}-${tx.id}`} className="border-b border-[#EAE6D7]">
                    <td className="py-1.5 capitalize">{tx.source}</td>
                    <td className="py-1.5">{tx.reference}</td>
                    <td className="py-1.5">{tx.customer_display}</td>
                    <td className="py-1.5 capitalize">{tx.payment_method}</td>
                    <td className="py-1.5 text-right font-mono">{fmtIDR(tx.money_collected_idr ?? tx.amount_idr)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtIDR(tx.gift_card_redemption_idr || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
