import { labelStyle } from "@/lib/patientLabelDisplay";

export default function PatientLabelBadge({ label, size = "sm", className = "", title }) {
  if (!label?.name) return null;
  const base =
    size === "md"
      ? "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
      : "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const tip = title || label.notes || label.description || undefined;
  return (
    <span
      className={`${base} ${className}`}
      style={labelStyle(label)}
      title={tip}
      data-testid={`patient-label-${(label.system_key || label.name || "").toLowerCase()}`}
    >
      {label.name}
    </span>
  );
}
