import { API_BASE } from "@/lib/api";

export const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
export const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");

export const COMMISSION_STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "earned", label: "Earned" },
  { value: "approved", label: "Approved" },
  { value: "paid_out", label: "Paid out" },
  { value: "cancelled", label: "Cancelled" },
];

export const DATE_BASIS_OPTIONS = [
  { value: "approved_at", label: "Approved date" },
  { value: "earned_at", label: "Earned date" },
  { value: "paid_out_at", label: "Paid out date" },
  { value: "invoice_paid_at", label: "Invoice paid date" },
];

export function defaultDateRange() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toStr(from), to: toStr(now) };
}

export function summarizeRows(rows) {
  const earned = rows.filter((r) => r.status === "earned").reduce((s, r) => s + Number(r.commission_amount || 0), 0);
  const approved = rows.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.commission_amount || 0), 0);
  const paidOut = rows.filter((r) => r.status === "paid_out").reduce((s, r) => s + Number(r.commission_amount || 0), 0);
  const remainingUnpaid = earned + approved;
  return { earned, approved, paidOut, remainingUnpaid };
}

export async function downloadCommissionExport(path, filename) {
  const token = localStorage.getItem("bl_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
