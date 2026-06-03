import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";

/** FO shortcut: create/open invoice for a visit then redirect to invoice editor. */
export default function InvoicesOpenVisitPage() {
  const { visitId } = useParams();
  const nav = useNavigate();

  useEffect(() => {
    api.post(`/invoices/visit/${visitId}`)
      .then((r) => nav(`/invoices/${r.data.id}`, { replace: true }))
      .catch((e) => {
        toast.error(e?.response?.data?.detail || "Could not open invoice");
        nav("/invoices");
      });
  }, [visitId, nav]);

  return <div className="p-10 text-[#5C6C62]">Opening invoice…</div>;
}
