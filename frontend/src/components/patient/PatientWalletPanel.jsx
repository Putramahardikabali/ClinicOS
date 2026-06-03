import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { fmtIDR, fmtDate } from "@/lib/patientProfile";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";

const TYPE_LABELS = {
  credit: "Credit",
  debit: "Debit",
  adjustment: "Adjustment",
  refund_to_credit: "Refund to wallet",
  gift_card_redeem: "Gift card → wallet",
  overpayment: "Overpayment",
  payment_use: "Payment used",
  reversal: "Reversal",
};

export default function PatientWalletPanel({ patientId }) {
  const { user } = useAuth();
  const canAdjust = hasPermission(user, "wallet.adjust");
  const canExport = hasPermission(user, "wallet.export");

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [w, tx] = await Promise.all([
        api.get(`/patients/${patientId}/wallet`),
        api.get(`/patients/${patientId}/wallet/transactions`, { params: { page: 1, page_size: 100 } }),
      ]);
      setWallet(w.data?.wallet || w.data);
      setTransactions(tx.data?.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load wallet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) load();
  }, [patientId]);

  const adjust = async () => {
    const amountStr = window.prompt("Credit amount (IDR):");
    if (!amountStr) return;
    const amount = parseInt(String(amountStr).replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) return;
    const reason = window.prompt("Reason (required, min 3 characters):");
    if (!reason || reason.trim().length < 3) {
      window.alert("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/patients/${patientId}/wallet/adjust`, {
        amount_idr: amount,
        reason: reason.trim(),
      });
      toast.success("Wallet credited");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust wallet");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const r = await api.get("/wallet/report/export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `wallet-${patientId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Export failed");
    }
  };

  const refLink = (tx) => {
    const rt = tx.reference_type;
    const rid = tx.reference_id;
    if (!rid) return null;
    if (rt === "invoice") return `/invoices/${rid}`;
    if (rt === "pos_sale") return `/pos?sale=${rid}`;
    if (rt === "gift_card") return `/gift-cards/${rid}`;
    return null;
  };

  if (loading) return <p className="text-sm text-[#5C6C62]">Loading wallet…</p>;

  const balance = Number(wallet?.balance ?? wallet?.balance_idr ?? 0);

  return (
    <div className="space-y-4" data-testid="patient-wallet-panel">
      <div className="bl-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="label-eyebrow">Store credit balance</div>
          <p className="font-display text-2xl font-mono">{fmtIDR(balance)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdjust && (
            <button type="button" className="bl-btn-primary text-sm inline-flex items-center gap-1" disabled={busy} onClick={adjust}>
              <Plus className="w-4 h-4" /> Add credit
            </button>
          )}
          {canExport && (
            <button type="button" className="bl-btn-ghost text-sm inline-flex items-center gap-1" onClick={exportCsv}>
              <Download className="w-4 h-4" /> Export
            </button>
          )}
        </div>
      </div>

      <div className="bl-card overflow-hidden">
        <div className="px-4 py-3 border-b font-medium text-sm">Transaction history</div>
        {transactions.length === 0 ? (
          <p className="p-6 text-sm text-[#5C6C62] text-center">No wallet transactions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#5C6C62] border-b bg-[#FAFAF8]">
                <th className="py-2 px-4">Date</th>
                <th className="py-2 px-4">Type</th>
                <th className="py-2 px-4 text-right">Amount</th>
                <th className="py-2 px-4 text-right">Balance</th>
                <th className="py-2 px-4">Reference</th>
                <th className="py-2 px-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const href = refLink(tx);
                const isDebit = ["payment_use", "debit"].includes(tx.transaction_type);
                return (
                  <tr key={tx.id} className="border-b border-[#EAE6D7]">
                    <td className="py-2 px-4 whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                    <td className="py-2 px-4">{TYPE_LABELS[tx.transaction_type] || tx.transaction_type}</td>
                    <td className={`py-2 px-4 text-right font-mono ${isDebit ? "text-[#B14A2C]" : "text-[#2D6A4F]"}`}>
                      {isDebit ? "−" : "+"}{fmtIDR(tx.amount_idr)}
                    </td>
                    <td className="py-2 px-4 text-right font-mono">{fmtIDR(tx.balance_after)}</td>
                    <td className="py-2 px-4">
                      {href ? (
                        <Link to={href} className="text-[#2D6A4F] hover:underline">
                          {tx.reference_type} #{String(tx.reference_id).slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-[#5C6C62]">{tx.reference_type || "—"}</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-[#5C6C62] max-w-[200px] truncate">{tx.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
