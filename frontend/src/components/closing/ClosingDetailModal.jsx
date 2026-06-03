import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { X, Download, Printer } from "lucide-react";
import { fmtIDR } from "@/lib/posUtils";
import ClosingReportDocument from "@/components/closing/ClosingReportDocument";
import { printClosingReport } from "@/lib/closingPrint";

export default function ClosingDetailModal({ closingId, onClose, onExport }) {
  const { branding } = useSettings();
  const [closing, setClosing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!closingId) return undefined;
    setLoading(true);
    api
      .get(`/closing/${closingId}`)
      .then((r) => setClosing(r.data))
      .catch(() => setClosing(null))
      .finally(() => setLoading(false));
    return undefined;
  }, [closingId]);

  if (!closingId) return null;

  const clinicName = branding?.clinic_name || "Clinic";

  return (
    <div
      className="fixed inset-0 z-50 bg-[#2D3A33]/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="closing-detail-modal"
      >
        <div className="sticky top-0 bg-white border-b border-[#EAE6D7] p-4 flex justify-between items-start gap-3 z-10">
          <div>
            <div className="label-eyebrow">Daily closing</div>
            <h2 className="font-display text-xl">{closing?.business_date || "…"}</h2>
            {closing && (
              <p className="text-sm text-[#5C6C62] mt-1 capitalize">
                {closing.status}
                {closing.closed_at && ` · ${new Date(closing.closed_at).toLocaleString()}`}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {onExport && (
              <button type="button" className="p-2 rounded-lg hover:bg-[#F3F1EB]" title="Export" onClick={onExport}>
                <Download className="w-5 h-5" />
              </button>
            )}
            <Link
              to={`/print/closing/${closingId}`}
              target="_blank"
              className="p-2 rounded-lg hover:bg-[#F3F1EB]"
              title="Print"
            >
              <Printer className="w-5 h-5" />
            </Link>
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4">
          {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
          {!loading && !closing && <p className="text-sm text-[#B14A2C]">Closing not found</p>}
          {closing && (
            <>
              <div className="no-print">
                <ClosingReportDocument closing={closing} clinicName={clinicName} />
              </div>
              <div className="mt-4 flex gap-2 no-print">
                <button
                  type="button"
                  className="bl-btn-ghost text-sm"
                  onClick={() => {
                    requestAnimationFrame(() => printClosingReport());
                  }}
                >
                  Print from here
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {closing && (
        <div className="closing-report-print-area" style={{ display: "none" }} aria-hidden="true">
          <ClosingReportDocument closing={closing} clinicName={clinicName} />
        </div>
      )}
    </div>
  );
}
