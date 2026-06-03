import { useEffect, useState } from "react";
import api from "@/lib/api";
import { fmtIDR } from "@/lib/posUtils";

export default function PosWalletPayment({
  patientId,
  amount,
  onAmountChange,
  maxDue,
}) {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setBalance(0);
      return undefined;
    }
    setLoading(true);
    api
      .get("/wallet/balance", { params: { patient_id: patientId } })
      .then((r) => setBalance(Number(r.data?.balance_idr) || 0))
      .catch(() => setBalance(0))
      .finally(() => setLoading(false));
    return undefined;
  }, [patientId]);

  if (!patientId) {
    return (
      <p className="text-xs text-[#B45309] mt-2">
        Select a patient to use store credit from their wallet.
      </p>
    );
  }

  const cap = Math.min(balance, maxDue || balance);

  return (
    <div className="mt-3 space-y-2" data-testid="pos-wallet-payment">
      <div className="flex justify-between text-sm">
        <span className="text-[#5C6C62]">Wallet balance</span>
        <span className="font-mono">{loading ? "…" : fmtIDR(balance)}</span>
      </div>
      <label className="block text-xs text-[#5C6C62]">
        Amount to use from wallet
        <input
          type="text"
          inputMode="numeric"
          className="bl-input w-full mt-1 font-mono"
          value={amount || ""}
          onChange={(e) => onAmountChange?.(e.target.value.replace(/\D/g, ""))}
          placeholder={cap > 0 ? `Max ${cap.toLocaleString("id-ID")}` : "0"}
        />
      </label>
    </div>
  );
}
