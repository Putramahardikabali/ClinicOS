import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { fmtIDR } from "@/lib/posUtils";
import { Download, Eye, Printer } from "lucide-react";
import { toast } from "sonner";

export default function PosSalesHistoryTab({ onViewSale, onPrintSale }) {
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    status: "",
    payment_method: "",
    item_type: "",
    q: "",
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 25 };
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.status) params.status = filters.status;
      if (filters.payment_method) params.payment_method = filters.payment_method;
      if (filters.item_type) params.item_type = filters.item_type;
      if (filters.q.trim()) params.q = filters.q.trim();
      const r = await api.get("/pos/sales", { params });
      setData(r.data);
    } catch {
      setData({ items: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const params = {};
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.status) params.status = filters.status;
      if (filters.payment_method) params.payment_method = filters.payment_method;
      if (filters.item_type) params.item_type = filters.item_type;
      if (filters.q.trim()) params.q = filters.q.trim();
      const r = await api.get("/pos/sales/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pos-sales-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed");
    }
  };

  const pages = Math.max(1, Math.ceil((data.total || 0) / 25));

  return (
    <div className="space-y-4" data-testid="pos-sales-history">
      <div className="bl-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <input type="date" className="bl-input" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        <input type="date" className="bl-input" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        <select className="bl-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="draft">Draft</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="bl-input" value={filters.payment_method} onChange={(e) => setFilters({ ...filters, payment_method: e.target.value })}>
          <option value="">All payment methods</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="qris">QRIS</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="other">Other</option>
        </select>
        <select className="bl-input" value={filters.item_type} onChange={(e) => setFilters({ ...filters, item_type: e.target.value })}>
          <option value="">All item types</option>
          <option value="product">Product</option>
          <option value="package">Package</option>
          <option value="gift_card">Gift card</option>
          <option value="service">Service</option>
          <option value="custom">Custom</option>
        </select>
        <input className="bl-input" placeholder="Customer / sale # search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="bl-btn-primary text-sm" onClick={() => { setPage(1); load(); }}>
          Apply filters
        </button>
        <button type="button" className="bl-btn-ghost text-sm inline-flex items-center gap-1" onClick={exportCsv}>
          <Download className="w-4 h-4" /> Export Excel (CSV)
        </button>
      </div>

      <div className="bl-card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-xs text-[#5C6C62] border-b uppercase">
              <th className="p-3">Sale #</th>
              <th className="p-3">Date</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Items</th>
              <th className="p-3">Payment</th>
              <th className="p-3 text-right">Subtotal</th>
              <th className="p-3 text-right">Disc.</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Cashier</th>
              <th className="p-3">Status</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-[#5C6C62]">Loading…</td>
              </tr>
            )}
            {!loading && data.items.map((row) => (
              <tr key={row.id} className="border-b border-[#EAE6D7]">
                <td className="p-3 font-medium">{row.sale_number}</td>
                <td className="p-3 whitespace-nowrap">{row.date_display} {row.time_display}</td>
                <td className="p-3">{row.customer_display}</td>
                <td className="p-3 max-w-[180px] truncate text-[#5C6C62]">{row.items_summary}</td>
                <td className="p-3 capitalize">{row.payment_method || "—"}</td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.subtotal)}</td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.discount_total)}</td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.total)}</td>
                <td className="p-3">{row.cashier_name_snapshot || "—"}</td>
                <td className="p-3 capitalize">{row.status}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button type="button" className="p-1.5 rounded hover:bg-[#EDF3EF]" onClick={() => onViewSale(row.id)}>
                      <Eye className="w-4 h-4" />
                    </button>
                    {row.status === "paid" && (
                      <button type="button" className="p-1.5 rounded hover:bg-[#EDF3EF]" onClick={() => onPrintSale(row.id)}>
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-[#5C6C62]">{data.total} sales</span>
        <div className="flex gap-2">
          <button type="button" className="bl-btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} / {pages}
          </span>
          <button type="button" className="bl-btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
