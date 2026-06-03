import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useClinic } from "@/lib/clinic";
import { useAuth } from "@/lib/auth";
import { MessageCircle, Mail, Clock, Copy, Check, LifeBuoy, X } from "lucide-react";
import { toast } from "sonner";

function SupportContent({ onClose }) {
  const { clinic } = useClinic();
  const { user } = useAuth();
  const [support, setSupport] = useState(null);
  const [diag, setDiag] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get("/platform/support").then((r) => setSupport(r.data)).catch(() => {});
    api.get("/clinic/support-diagnostics").then((r) => setDiag(r.data)).catch(() => {});
  }, []);

  const wa = (support?.whatsapp || "").replace(/\D/g, "");
  const diagText = diag
    ? [
        `ClinicOS Support Info`,
        `Clinic: ${diag.clinic_name || "—"} (${diag.slug || "—"})`,
        `Plan: ${diag.plan || "—"} · Status: ${diag.status || "—"}`,
        `User: ${diag.user_email || user?.email} (${diag.user_role || user?.role})`,
        `Clinic ID: ${diag.clinic_id || "—"}`,
      ].join("\n")
    : "";

  const copyDiag = async () => {
    try {
      await navigator.clipboard.writeText(diagText);
      setCopied(true);
      toast.success("Diagnostic info copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-[#EAE6D7]">
        <div className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-[#52796F]" />
          <h2 className="font-display text-lg text-[#2D3A33]">Help & Support</h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" aria-label="Close">
            <X className="w-5 h-5 text-[#5C6C62]" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-sm text-[#5C6C62]">
          Need help with {clinic?.name || "your clinic"}? Reach our team or copy diagnostic info when reporting an issue.
        </p>
        {wa && (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noreferrer"
            className="bl-btn-primary w-full inline-flex items-center justify-center gap-2 text-sm"
            data-testid="help-whatsapp"
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp support
          </a>
        )}
        {support?.email && (
          <a href={`mailto:${support.email}`} className="flex items-center gap-3 p-3 rounded-xl border border-[#EAE6D7] text-sm text-[#2D3A33] hover:bg-[#F8F5EC]">
            <Mail className="w-4 h-4 text-[#52796F]" />
            <span>{support.email}</span>
          </a>
        )}
        {support?.hours && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[#F8F5EC] text-sm text-[#2D3A33]">
            <Clock className="w-4 h-4 text-[#52796F] mt-0.5 shrink-0" />
            <div>
              <div className="text-xs uppercase tracking-widest text-[#5C6C62] mb-1">Support hours</div>
              {support.hours}
            </div>
          </div>
        )}
        <div className="p-3 rounded-xl border border-[#EAE6D7]">
          <div className="text-xs uppercase tracking-widest text-[#5C6C62] mb-2">Diagnostic info</div>
          <pre className="text-xs text-[#5C6C62] whitespace-pre-wrap font-mono bg-[#F8F5EC] p-3 rounded-lg">{diagText || "Loading…"}</pre>
          <button type="button" onClick={copyDiag} className="mt-3 text-sm inline-flex items-center gap-1.5 text-[#52796F] hover:underline" data-testid="copy-diagnostics">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Copy for support ticket
          </button>
        </div>
        <Link to="/billing/plans" className="block text-center text-sm text-[#52796F] hover:underline" onClick={onClose}>
          Billing & plan →
        </Link>
      </div>
    </div>
  );
}

export function HelpDrawer({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="help-drawer">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close overlay" />
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full animate-in slide-in-from-right">
        <SupportContent onClose={onClose} />
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="p-6 md:p-10 max-w-lg mx-auto">
      <div className="bl-card overflow-hidden min-h-[480px] flex flex-col">
        <SupportContent />
      </div>
    </div>
  );
}
