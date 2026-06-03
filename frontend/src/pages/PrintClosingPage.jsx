import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { useSettings } from "@/lib/settings";
import ClosingReportDocument from "@/components/closing/ClosingReportDocument";

export default function PrintClosingPage() {
  const { id } = useParams();
  const { branding } = useSettings();
  const [closing, setClosing] = useState(null);

  useEffect(() => {
    api.get(`/closing/${id}`).then((r) => setClosing(r.data)).catch(() => setClosing(null));
  }, [id]);

  if (!closing) return <div className="p-10">Loading…</div>;

  return (
    <div className="min-h-screen bg-white text-[#2D3A33]">
      <div className="no-print sticky top-0 bg-[#FDFBF7] border-b border-[#EAE6D7] p-4 flex items-center justify-between">
        <div className="font-display text-lg">Closing {closing.business_date}</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.close()} className="bl-btn-ghost text-sm">
            Close
          </button>
          <button type="button" onClick={() => window.print()} className="bl-btn-primary text-sm">
            Print / Save PDF
          </button>
        </div>
      </div>
      <ClosingReportDocument closing={closing} clinicName={branding?.clinic_name || "Clinic"} />
    </div>
  );
}
