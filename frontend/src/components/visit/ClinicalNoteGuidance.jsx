import NoteStatusBadge from "@/components/visit/NoteStatusBadge";

export default function ClinicalNoteGuidance({
  status,
  record,
  roleLabel = "Doctor",
  editable,
  busy,
  onSaveDraft,
  onSubmitLock,
  hideActions = false,
}) {
  return (
    <>
      <div className="bl-card p-4 bg-[#F8F5EC] border-[#EAE6D7]">
        <div className="flex flex-wrap items-center gap-2">
          <NoteStatusBadge status={status} />
          {status === "draft" && (
            <span className="text-sm text-[#5C6C62]">Draft — you can edit and save until you submit.</span>
          )}
          {(status === "completed" || status === "locked") && record?.submitted_at && (
            <span className="text-sm text-[#5C6C62]">
              Submitted {new Date(record.submitted_at).toLocaleString()}
              {record.doctor_name || record.therapist_name
                ? ` · ${record.doctor_name || record.therapist_name}`
                : ""}
            </span>
          )}
        </div>
        {status === "locked" && (
          <p className="text-sm text-[#5C6C62] mt-2">
            This {roleLabel.toLowerCase()} note is locked. Editing requires owner permission and a documented reason.
          </p>
        )}
        {status === "draft" && editable && (
          <p className="text-sm text-[#5C6C62] mt-2">
            Use <strong>Save draft</strong> while documenting. <strong>Finish chart</strong> finalizes the note for this treatment session.
          </p>
        )}
      </div>

      {editable && !hideActions && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2 sticky bottom-16 lg:bottom-0 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 bg-[#FDFBF7] py-3 border-t border-[#EAE6D7] z-10">
          <button
            type="button"
            onClick={onSaveDraft}
            className="bl-btn-ghost flex-1 sm:flex-none"
            disabled={busy}
            data-testid={`${roleLabel.toLowerCase().replace(/\s+/g, "-")}-save`}
          >
            Save draft
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 sm:flex-none">
            <button
              type="button"
              onClick={onSubmitLock}
              className="bl-btn-primary flex-1 sm:flex-none"
              disabled={busy}
              data-testid={`${roleLabel.toLowerCase().replace(/\s+/g, "-")}-submit`}
            >
              Finish chart
            </button>
            <span className="text-xs text-[#5C6C62] sm:max-w-[220px]">
              Finalizes this note. Editing later may require a reason.
            </span>
          </div>
        </div>
      )}
    </>
  );
}
