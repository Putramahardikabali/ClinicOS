import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Link } from "react-router-dom";

export default function BillingPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/visits/pending-billing").then(r=>setItems(r.data)); }, []);
  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <div className="label-eyebrow">Front office queue</div>
      <h1 className="font-display text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Pending billing</h1>
      <p className="mt-2 text-[#5C6C62]">Visits submitted by doctors and therapists, ready for billing.</p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="billing-queue">
        {items.length === 0 && <div className="bl-card p-8 text-center text-[#5C6C62] md:col-span-2">No pending visits</div>}
        {items.map(v => (
          <div key={v.id} className="bl-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-[#2D3A33]">{v.patient_name}</div>
                <div className="text-xs text-[#5C6C62] mt-0.5 capitalize">{v.visit_type} visit · {new Date(v.visit_date || v.created_at).toLocaleDateString()}</div>
              </div>
              <span className="bl-chip warning">submitted</span>
            </div>
            <Link to={`/visits/${v.id}`} className="bl-btn-primary mt-4 inline-block text-sm" data-testid={`bill-visit-${v.id}`}>Process billing →</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
