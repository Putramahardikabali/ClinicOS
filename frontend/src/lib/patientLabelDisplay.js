export const SEVERITY_STYLES = {
  normal: { bg: "#F3F4F6", text: "#374151", border: "#D1D5DB" },
  warning: { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" },
  danger: { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
};

export function isBlacklisted(patient) {
  const labels = patient?.patient_labels || [];
  return labels.some(
    (lb) =>
      (lb.system_key || "").toLowerCase() === "blacklist"
      || (lb.name || "").trim().toLowerCase() === "blacklist",
  );
}

export function blacklistReason(patient) {
  const labels = patient?.patient_labels || [];
  const bl = labels.find(
    (lb) =>
      (lb.system_key || "").toLowerCase() === "blacklist"
      || (lb.name || "").trim().toLowerCase() === "blacklist",
  );
  return bl?.notes || "";
}

export function labelStyle(label) {
  const severity = label?.severity || "normal";
  if (label?.color) {
    const c = label.color;
    return { background: `${c}18`, color: c, border: `1px solid ${c}55` };
  }
  const s = SEVERITY_STYLES[severity] || SEVERITY_STYLES.normal;
  return { background: s.bg, color: s.text, border: `1px solid ${s.border}` };
}
