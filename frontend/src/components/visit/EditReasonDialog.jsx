import { useState } from "react";

export default function EditReasonDialog({ open, onConfirm, onCancel, busy }) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bl-card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl text-[#2D3A33]">Edit locked note</h3>
        <p className="text-sm text-[#5C6C62]">This note is submitted or the visit is completed. Provide a reason for the audit log.</p>
        <textarea
          className="bl-input min-h-[90px] w-full"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for edit…"
          data-testid="edit-reason-input"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="bl-btn-ghost" disabled={busy}>Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            className="bl-btn-primary"
            disabled={busy || !reason.trim()}
            data-testid="edit-reason-confirm"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
