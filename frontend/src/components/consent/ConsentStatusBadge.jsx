const STATUS_STYLE = {
  not_sent: { label: "Not prepared", cls: "warning" },
  draft: { label: "Not prepared", cls: "warning" },
  pending: { label: "Pending signature", cls: "info" },
  signed: { label: "Signed", cls: "success" },
  expired: { label: "Expired", cls: "warning" },
  cancelled: { label: "Cancelled", cls: "warning" },
};

export default function ConsentStatusBadge({ status, compact = false }) {
  const s = STATUS_STYLE[status] || { label: status || "—", cls: "info" };
  return (
    <span className={`bl-chip ${s.cls} ${compact ? "text-[10px]" : ""}`} data-testid={`consent-status-${status}`}>
      {s.label}
    </span>
  );
}

export function consentSummary(forms = []) {
  if (!forms?.length) return { status: "not_sent", label: "No consent" };
  if (forms.some((f) => f.status === "signed")) {
    const signed = forms.filter((f) => f.status === "signed");
    return { status: "signed", label: `${signed.length} signed`, forms };
  }
  if (forms.some((f) => f.status === "pending")) {
    return { status: "pending", label: "Pending signature", forms };
  }
  if (forms.some((f) => f.status === "expired")) {
    return { status: "expired", label: "Expired", forms };
  }
  const active = forms.find((f) => !["cancelled"].includes(f.status));
  return { status: active?.status || "not_sent", label: active?.treatment_name_snapshot || "Consent needed", forms };
}
