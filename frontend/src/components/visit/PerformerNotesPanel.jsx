import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  recordNoteStatus,
  canEditClinicalNote,
  requiresEditReason,
  templatesForRole,
  applyTemplateFields,
} from "@/lib/clinicalNotes";
import NoteStatusBadge from "@/components/visit/NoteStatusBadge";
import NoteTemplatePicker from "@/components/visit/NoteTemplatePicker";
import FollowUpFields from "@/components/visit/FollowUpFields";
import EditReasonDialog from "@/components/visit/EditReasonDialog";
import { useSettings } from "@/lib/settings";

export default function PerformerNotesPanel({ visit, onSaved, roleFilter = null }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const slots = (visit.performer_note_slots || []).filter((slot) => {
    if (!roleFilter) return true;
    return (slot.staff_role || "").toLowerCase() === roleFilter;
  });
  const notesByStaff = useMemo(() => {
    const m = {};
    for (const n of visit.performer_notes || []) m[n.staff_id] = n;
    return m;
  }, [visit.performer_notes]);

  if (!slots.length) return null;

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-[#EAE6D7]">
      <div>
        <div className="label-eyebrow">Additional staff</div>
        <h3 className="font-display text-lg text-[#2D3A33] mt-1">Per-staff notes</h3>
        <p className="text-sm text-[#5C6C62] mt-1">Assistant and secondary staff document their own session notes here.</p>
      </div>
      {slots.map((slot) => (
        <PerformerNoteCard
          key={slot.staff_id}
          visit={visit}
          slot={slot}
          note={notesByStaff[slot.staff_id]}
          user={user}
          templates={templatesForRole(settings?.form_config?.note_templates, slot.staff_role, visit.visit_type)}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function PerformerNoteCard({ visit, slot, note, user, templates, onSaved }) {
  const isOwn = user?.id === slot.staff_id;
  const canEdit = isOwn && canEditClinicalNote(user, visit, note);
  const canOverride = user?.role === "super_admin" || user?.platform_admin;
  const editable = canEdit || (canOverride && (recordNoteStatus(note, visit) !== "draft"));
  const [data, setData] = useState({
    content: "",
    follow_up_recommendation: "",
    next_session_recommendation: "",
  });
  const [busy, setBusy] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(null);
  const [editDialog, setEditDialog] = useState(false);

  useEffect(() => {
    if (note) {
      setData({
        content: note.content || "",
        follow_up_recommendation: note.follow_up_recommendation || "",
        next_session_recommendation: note.next_session_recommendation || "",
      });
    }
  }, [note]);

  const status = recordNoteStatus(note, visit);

  const doSave = async (submit, editReason) => {
    setBusy(true);
    try {
      await api.put(`/visits/${visit.id}/performer-notes/${slot.staff_id}`, {
        ...data,
        submit,
        edit_reason: editReason || undefined,
      });
      toast.success(submit ? "Staff note submitted" : "Saved");
      onSaved?.();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to save";
      if (detail.includes("Edit reason") && canOverride) {
        setPendingSubmit(submit);
        setEditDialog(true);
      } else {
        toast.error(detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const save = (submit) => {
    if (requiresEditReason(user, visit, note) && canOverride) {
      setPendingSubmit(submit);
      setEditDialog(true);
      return;
    }
    doSave(submit);
  };

  return (
    <div className="bl-card p-5 space-y-4" data-testid={`performer-note-${slot.staff_id}`}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <div className="font-medium text-[#2D3A33]">{slot.staff_name}</div>
          <div className="text-xs text-[#5C6C62] capitalize">{slot.staff_role} · {slot.performer_type}</div>
        </div>
        <NoteStatusBadge status={status} />
      </div>

      {editable && templates.length > 0 && (
        <NoteTemplatePicker
          templates={templates}
          disabled={busy}
          onApply={(t) => setData((d) => applyTemplateFields(d, { content: t.fields?.therapist_notes || t.fields?.doctor_notes || "" }))}
        />
      )}

      <div>
        <label className="label-eyebrow block mb-2">Session notes</label>
        <textarea
          disabled={!editable || busy}
          className="bl-input min-h-[100px] w-full"
          value={data.content}
          onChange={(e) => setData({ ...data, content: e.target.value })}
          data-testid={`performer-content-${slot.staff_id}`}
        />
      </div>

      <FollowUpFields data={data} setData={setData} editable={editable && !busy} prefix={`performer-${slot.staff_id}-`} />

      {note?.submitted_at && (
        <p className="text-xs text-[#5C6C62]">
          Submitted {new Date(note.submitted_at).toLocaleString()}
          {note.staff_name ? ` · ${note.staff_name}` : ""}
        </p>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => save(false)} className="bl-btn-ghost" disabled={busy}>Save draft</button>
          <button type="button" onClick={() => save(true)} className="bl-btn-primary" disabled={busy}>Submit note</button>
        </div>
      )}

      {!editable && !isOwn && (
        <p className="text-xs text-[#5C6C62]">View only — assigned staff can edit their note.</p>
      )}

      <EditReasonDialog
        open={editDialog}
        busy={busy}
        onCancel={() => { setEditDialog(false); setPendingSubmit(null); }}
        onConfirm={(reason) => {
          setEditDialog(false);
          doSave(pendingSubmit ?? false, reason);
          setPendingSubmit(null);
        }}
      />
    </div>
  );
}
