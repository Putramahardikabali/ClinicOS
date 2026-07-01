import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { fmtIDR, parseIdr } from "@/lib/posUtils";
import { prepaidStatusLabel } from "@/lib/prepaidDisplay";

/**
 * Apply patient prepaid balance to an invoice (liability redemption, not cash collected).
 */
export default function PrepaidPaymentFields({
  patientId,
  amountDue,
  selectedPrepaidId,
  onSelectedPrepaidIdChange,
  prepaidAmount,
  onPrepaidAmountChange,
  disabled,
  testIdPrefix = "invoice-prepaid",
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const due = Math.max(0, Number(amountDue) || 0);

  useEffect(() => {
    if (!patientId) {
      setOptions([]);
      return undefined;
    }
    setLoading(true);
    api.get(`/patients/${patientId}/prepaid/redeemable`)
      .then((r) => setOptions(r.data || []))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [patientId]);

  const selected = useMemo(
    () => options.find((o) => o.id === selectedPrepaidId) || null,
    [options, selectedPrepaidId],
  );

  const maxApply = selected
    ? Math.min(due, Number(selected.remaining_balance_idr) || 0)
    : 0;

  useEffect(() => {
    if (!selected || maxApply <= 0) return;
    const cur = parseIdr(prepaidAmount);
    if (!prepaidAmount || cur > maxApply) {
      onPrepaidAmountChange?.(String(maxApply));
    }
  }, [selected?.id, maxApply, prepaidAmount, onPrepaidAmountChange, selected]);

  if (!patientId) {
    return <p className="text-xs text-[#5C6C62]">Link a patient to apply prepaid.</p>;
  }

  if (loading) {
    return <p className="text-xs text-[#5C6C62]">Loading prepaid…</p>;
  }

  if (!options.length) {
    return <p className="text-xs text-[#5C6C62]">No active prepaid for this patient.</p>;
  }

  return (
    <div className="text-sm space-y-2 rounded-lg border border-[#EAE6D7] p-3" data-testid={`${testIdPrefix}-fields`}>
      <p className="text-xs text-[#5C6C62]">
        Applying prepaid recognizes revenue — it is not new cash collected.
      </p>
      <div>
        <label className="label-eyebrow block mb-1">Prepaid</label>
        <select
          className="bl-input text-sm"
          value={selectedPrepaidId || ""}
          disabled={disabled}
          onChange={(e) => {
            onSelectedPrepaidIdChange?.(e.target.value);
            onPrepaidAmountChange?.("");
          }}
          data-testid={`${testIdPrefix}-select`}
        >
          <option value="">Select prepaid</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {fmtIDR(o.remaining_balance_idr)} · {prepaidStatusLabel(o.status)}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <>
          <div className="flex justify-between text-xs text-[#5C6C62]">
            <span>Available balance</span>
            <span className="font-mono">{fmtIDR(selected.remaining_balance_idr)}</span>
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Amount to apply</label>
            <input
              className="bl-input font-mono text-sm"
              placeholder={`Max ${maxApply.toLocaleString("id-ID")}`}
              value={prepaidAmount}
              disabled={disabled}
              onChange={(e) => onPrepaidAmountChange?.(e.target.value.replace(/\D/g, ""))}
              data-testid={`${testIdPrefix}-amount`}
            />
          </div>
        </>
      )}
    </div>
  );
}
