import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { fmtIDR, fmtDate, fmtDay } from "@/lib/patientProfile";
import {
  PREPAID_HELPER_COPY,
  prepaidStatusClass,
  prepaidStatusLabel,
} from "@/lib/prepaidDisplay";
import { toast } from "sonner";
import AppModal from "@/components/ui/AppModal";

export default function PatientPrepaidPanel({ patientId }) {
  const { user } = useAuth();
  const canRefund = hasPermission(user, "prepaid.refund");
  const canVoid = hasPermission(user, "prepaid.void");
  const canRedeem = hasPermission(user, "prepaid.redeem");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/patients/${patientId}/prepaid`);
      setRows(r.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load prepaid");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) load();
  }, [patientId]);

  const viewDetail = async (id) => {
    try {
      const r = await api.get(`/prepaid/${id}`);
      setDetail(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load details");
    }
  };

  const refund = async (row) => {
    const reason = window.prompt("Refund reason (required):");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post(`/prepaid/${row.id}/refund`, { reason: reason.trim() });
      toast.success("Prepaid refunded");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refund failed");
    } finally {
      setBusy(false);
    }
  };

  const voidPrepaid = async (row) => {
    const reason = window.prompt("Void reason (required):");
    if (!reason || reason.trim().length < 3) return;
    if (!window.confirm(`Void prepaid ${row.code}?`)) return;
    setBusy(true);
    try {
      await api.post(`/prepaid/${row.id}/void`, { reason: reason.trim() });
      toast.success("Prepaid voided");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Void failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-[#5C6C62]">Loading prepaid…</p>;

  return (
    <div className="space-y-4" data-testid="patient-prepaid-panel">
      <p className="text-sm text-[#5C6C62]">{PREPAID_HELPER_COPY}</p>

      {rows.length === 0 ? (
        <div className="bl-card p-8 text-center text-[#5C6C62] text-sm">No prepaid records for this patient.</div>
      ) : (
        <div className="bl-card table-card overflow-hidden">
          <table className="bl-data-table w-full min-w-[900px] text-sm">
            <thead className="bl-data-table-head">
              <tr>
                <th className="text-left p-3">Code</th>
                <th className="text-left p-3">Purchase date</th>
                <th className="text-left p-3">Type</th>
                <th className="text-right p-3">Original</th>
                <th className="text-right p-3">Remaining</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Expiry</th>
                <th className="text-left p-3">Campaign</th>
                <th className="text-left p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#EAE6D7]">
                  <td className="p-3 font-mono text-xs">{row.code}</td>
                  <td className="p-3">{fmtDay(row.purchased_at)}</td>
                  <td className="p-3">{row.prepaid_type_label || row.prepaid_type}</td>
                  <td className="p-3 text-right font-mono">{fmtIDR(row.original_amount_idr)}</td>
                  <td className="p-3 text-right font-mono">{fmtIDR(row.remaining_balance_idr)}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${prepaidStatusClass(row.status)}`}>
                      {prepaidStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="p-3">{row.expiry_date ? fmtDay(row.expiry_date) : "—"}</td>
                  <td className="p-3">{row.campaign_name_snapshot || "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="text-xs text-[var(--bl-primary)]" onClick={() => viewDetail(row.id)}>
                        View
                      </button>
                      {canRedeem && ["active", "partially_used"].includes(row.status) && row.remaining_balance_idr > 0 && (
                        <Link to="/invoices" className="text-xs text-[var(--bl-primary)]">
                          Redeem
                        </Link>
                      )}
                      {canRefund && ["active", "partially_used"].includes(row.status) && row.remaining_balance_idr > 0 && (
                        <button type="button" className="text-xs text-[#B14A2C]" disabled={busy} onClick={() => refund(row)}>
                          Refund
                        </button>
                      )}
                      {canVoid && row.status === "active" && row.remaining_balance_idr === row.original_amount_idr && (
                        <button type="button" className="text-xs text-[#B14A2C]" disabled={busy} onClick={() => voidPrepaid(row)}>
                          Void
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <AppModal open onClose={() => setDetail(null)} align="center" testId="prepaid-detail-modal">
          <div className="bl-card p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <div className="label-eyebrow">Prepaid details</div>
                <p className="font-mono font-medium">{detail.prepaid?.code}</p>
              </div>
              <button type="button" className="text-sm text-[#5C6C62]" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Type</dt><dd>{detail.prepaid?.prepaid_type_label}</dd></div>
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Status</dt><dd>{prepaidStatusLabel(detail.prepaid?.status)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Original</dt><dd className="font-mono">{fmtIDR(detail.prepaid?.original_amount_idr)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Remaining</dt><dd className="font-mono">{fmtIDR(detail.prepaid?.remaining_balance_idr)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Purchased</dt><dd>{fmtDate(detail.prepaid?.purchased_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#5C6C62]">Created by</dt><dd>{detail.prepaid?.created_by_name_snapshot || "—"}</dd></div>
              {detail.prepaid?.pos_sale_id && (
                <div className="flex justify-between">
                  <dt className="text-[#5C6C62]">POS sale</dt>
                  <dd><Link to={`/pos?sale=${detail.prepaid.pos_sale_id}`} className="text-[var(--bl-primary)]">View</Link></dd>
                </div>
              )}
              {detail.prepaid?.redeemed_invoice_id && (
                <div className="flex justify-between">
                  <dt className="text-[#5C6C62]">Invoice</dt>
                  <dd><Link to={`/invoices/${detail.prepaid.redeemed_invoice_id}`} className="text-[var(--bl-primary)]">View</Link></dd>
                </div>
              )}
            </dl>
            {(detail.redemptions || []).length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#EAE6D7]">
                <p className="label-eyebrow mb-2">Redemptions</p>
                <ul className="text-xs space-y-1">
                  {detail.redemptions.map((r) => (
                    <li key={r.id} className="flex justify-between">
                      <span>{fmtDate(r.created_at)} · {r.reference_type}</span>
                      <span className="font-mono">{fmtIDR(r.amount_redeemed_idr)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </AppModal>
      )}
    </div>
  );
}
