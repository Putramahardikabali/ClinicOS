import PatientLabelBadge from "@/components/patient/PatientLabelBadge";

export default function PatientLabelsRow({ labels = [], size = "sm", className = "" }) {
  if (!labels?.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} data-testid="patient-labels-row">
      {labels.map((lb) => (
        <PatientLabelBadge key={lb.assignment_id || lb.label_id || lb.name} label={lb} size={size} />
      ))}
    </div>
  );
}
