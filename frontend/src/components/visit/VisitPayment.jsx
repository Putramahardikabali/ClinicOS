import { useEffect, useState } from "react";

import { Link } from "react-router-dom";

import api from "@/lib/api";

import { useAuth } from "@/lib/auth";

import { toast } from "sonner";

import { CreditCard, CheckCircle2, ExternalLink } from "lucide-react";



const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");



export default function VisitPayment({ visit, onSaved }) {

  const { user } = useAuth();

  const canPay = ["super_admin", "fo"].includes(user?.role);

  const canView = ["super_admin", "fo", "manager", "doctor", "therapist"].includes(user?.role);

  const [invoice, setInvoice] = useState(null);

  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);



  const loadInvoice = async () => {

    setLoading(true);

    try {

      const r = await api.get(`/invoices/visit/${visit.id}`);

      setInvoice(r.data);

    } catch {

      setInvoice(null);

    } finally {

      setLoading(false);

    }

  };



  useEffect(() => {

    if (canView) loadInvoice();

  }, [visit.id, canView]);



  const openInvoice = async () => {

    setBusy(true);

    try {

      const r = await api.post(`/invoices/visit/${visit.id}`);

      setInvoice(r.data);

      toast.success("Invoice opened");

    } catch (e) {

      toast.error(e?.response?.data?.detail || "Failed to open invoice");

    } finally {

      setBusy(false);

    }

  };



  if (!canView) return null;



  if (loading) {

    return <div className="bl-card p-5 text-sm text-[#5C6C62]">Loading billing…</div>;

  }



  const paid = invoice?.payment_status === "paid";

  const partial = invoice?.payment_status === "partial";



  if (!canPay) {

    return (

      <div className="bl-card p-5 text-sm text-[#5C6C62]" data-testid="visit-payment-readonly">

        {!invoice ? (

          <p>No invoice yet — front office will create one at checkout.</p>

        ) : paid ? (

          <div className="flex items-center gap-2 text-[#52796F]">

            <CheckCircle2 className="w-5 h-5" /> Paid {fmtIDR(invoice.amount_paid)} · {invoice.payment_method || "—"}

          </div>

        ) : (

          <p>

            Payment {partial ? "partially collected" : "pending"} — balance {fmtIDR(invoice.remaining_balance)}.

          </p>

        )}

      </div>

    );

  }



  return (

    <div className="space-y-5" data-testid="visit-payment-panel">

      <div className="bl-card p-5">

        <div className="flex items-center gap-2 mb-4">

          <CreditCard className="w-5 h-5" style={{ color: "var(--bl-primary)" }} />

          <div className="font-display text-lg text-[#2D3A33]">Invoice & checkout</div>

          {invoice && (

            <span className={`bl-chip ml-auto ${paid ? "success" : partial ? "info" : "warning"}`}>

              {invoice.payment_status}

            </span>

          )}

        </div>



        {!invoice ? (

          <>

            <p className="text-sm text-[#5C6C62] mb-4">

              Create an invoice for this visit. Line items are separate from clinical treatment records — add services, packages, and products at checkout.

            </p>

            <button type="button" disabled={busy} onClick={openInvoice} className="bl-btn-primary disabled:opacity-50" data-testid="create-invoice-button">

              Create invoice

            </button>

          </>

        ) : (

          <>

            <div className="text-sm space-y-2 mb-4">

              <div className="flex justify-between">

                <span className="text-[#5C6C62]">Invoice</span>

                <span className="font-mono text-xs">{invoice.invoice_number}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-[#5C6C62]">Total</span>

                <span className="font-medium">{fmtIDR(invoice.total_amount)}</span>

              </div>

              <div className="flex justify-between">

                <span className="text-[#5C6C62]">Paid / balance</span>

                <span>{fmtIDR(invoice.amount_paid)} / {fmtIDR(invoice.remaining_balance)}</span>

              </div>

              {(invoice.items || []).slice(0, 4).map((it) => (

                <div key={it.id} className="flex justify-between text-[#5C6C62] border-t border-[#EAE6D7] pt-2">

                  <span>{it.name} × {it.quantity}</span>

                  <span>{fmtIDR(it.line_total_idr)}</span>

                </div>

              ))}

              {(invoice.items || []).length > 4 && (

                <div className="text-xs text-[#5C6C62]">+ {(invoice.items || []).length - 4} more items</div>

              )}

            </div>



            <div className="flex flex-wrap gap-2">

              <Link to={`/invoices/${invoice.id}`} className="bl-btn-primary inline-flex items-center gap-2 text-sm" data-testid="open-invoice-link">

                <ExternalLink className="w-4 h-4" /> Open invoice

              </Link>

              {paid && (

                <Link to={`/print/invoice/${invoice.id}`} target="_blank" className="bl-btn-ghost text-sm">

                  Print invoice

                </Link>

              )}

            </div>

          </>

        )}

      </div>

    </div>

  );

}


