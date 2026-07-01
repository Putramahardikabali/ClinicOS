import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { fmtIDR } from "@/lib/posUtils";
import { Download, Eye, Printer } from "lucide-react";
import ClosingDetailModal from "@/components/closing/ClosingDetailModal";

function diffLabel(v) {
  if (v == null) return "—";
  const n = Number(v);
  if (n === 0) return fmtIDR(0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtIDR(n)}`;
}

export default function ClosingHistoryTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/closing/history", { params: { page, page_size: pageSize } });
      setItems(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load history");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async (closingId, businessDate) => {
    try {
      const r = await api.get(`/closing/${closingId}/export`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `closing-${businessDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed");
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4" data-testid="closing-history-tab">
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}

      <div className="bl-card table-card overflow-x-auto">
        <table className="bl-data-table w-full text-sm min-w-[800px]">
          <thead className="bl-data-table-head">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3 text-right">Total collected</th>
              <th className="p-3 text-right">Cash diff</th>
              <th className="p-3">Closed by</th>
              <th className="p-3">Closed at</th>
              <th className="p-3">Status</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="p-3 font-medium">{row.business_date}</td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.total_collected_idr)}</td>
                <td className="p-3 text-right font-mono">{diffLabel(row.cash_difference_idr)}</td>
                <td className="p-3">{row.closed_by_name_snapshot || "—"}</td>
                <td className="p-3 text-[#5C6C62]">
                  {row.closed_at ? new Date(row.closed_at).toLocaleString() : "—"}
                </td>
                <td className="p-3 capitalize">{row.status}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <button
                      type="button"
                      className="p-1.5 rounded hover:bg-[var(--bl-table-row-hover)]"
                      title="View detail"
                      onClick={() => setDetailId(row.id)}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded hover:bg-[var(--bl-table-row-hover)]"
                      title="Export CSV"
                      onClick={() => exportCsv(row.id, row.business_date)}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <Link
                      to={`/print/closing/${row.id}`}
                      target="_blank"
                      className="p-1.5 rounded hover:bg-[#EDF3EF] inline-flex"
                      title="Print / PDF"
                    >
                      <Printer className="w-4 h-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className="p-6 text-sm text-[#5C6C62] text-center">No closings recorded yet.</p>
        )}
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            className="bl-btn-ghost text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="text-sm text-[#5C6C62] self-center">
            Page {page} / {pages}
          </span>
          <button
            type="button"
            className="bl-btn-ghost text-sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {detailId && (
        <ClosingDetailModal
          closingId={detailId}
          onClose={() => setDetailId(null)}
          onExport={() => {
            const row = items.find((i) => i.id === detailId);
            if (row) exportCsv(row.id, row.business_date);
          }}
        />
      )}
    </div>
  );
}
