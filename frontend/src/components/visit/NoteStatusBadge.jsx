import { NOTE_STATUS_CHIP, NOTE_STATUS_LABEL } from "@/lib/clinicalNotes";

export default function NoteStatusBadge({ status }) {
  const label = NOTE_STATUS_LABEL[status] || status;
  const cls = NOTE_STATUS_CHIP[status] || "";
  return (
    <span className={`bl-chip ${cls}`} data-testid={`note-status-${status}`}>
      {label}
    </span>
  );
}
