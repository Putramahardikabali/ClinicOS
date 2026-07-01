import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";
import { finishModalSuccess } from "@/lib/modalSubmit";
import AppModal from "@/components/ui/AppModal";
import PatientLabelsRow from "@/components/patient/PatientLabelsRow";

export default function ManagePatientLabelsModal({ patientId, patientName, open, onClose, onUpdated }) {
  const { user } = useAuth();
  const canAssign = hasPermission(user, "patient_labels.assign") || ["super_admin", "manager"].includes(user?.role);
  const canRemove = hasPermission(user, "patient_labels.remove") || canAssign;

  const [assignments, setAssignments] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [notes, setNotes] = useState("");

  const reloadLabels = async () => {
    if (!patientId) return;
    const [a, c] = await Promise.all([
      api.get(`/patients/${patientId}/labels`),
      api.get("/patient-labels"),
    ]);
    setAssignments(a.data || []);
    setCatalog(c.data || []);
  };

  useEffect(() => {
    if (!open || !patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const [a, c] = await Promise.all([
          api.get(`/patients/${patientId}/labels`),
          api.get("/patient-labels"),
        ]);
        if (!cancelled) {
          setAssignments(a.data || []);
          setCatalog(c.data || []);
        }
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Could not load labels");
      }
    })();
    return () => { cancelled = true; };
  }, [open, patientId]);

  if (!open) return null;

  const selectedLabel = catalog.find((l) => l.id === selectedLabelId);
  const isBlacklist = (selectedLabel?.system_key || "").toLowerCase() === "blacklist";

  const assign = async () => {
    if (!selectedLabelId) {
      toast.error("Select a label");
      return;
    }
    if (isBlacklist && !notes.trim()) {
      toast.error("Reason for blacklist is required");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/patients/${patientId}/labels`, { label_id: selectedLabelId, notes: notes.trim() || undefined });
      setSelectedLabelId("");
      setNotes("");
      await reloadLabels();
      finishModalSuccess({
        message: "Label assigned",
        onSuccess: onUpdated,
        onClose,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not assign label");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (assignmentId) => {
    if (!window.confirm("Remove this label from the patient?")) return;
    setBusy(true);
    try {
      await api.delete(`/patients/${patientId}/labels/${assignmentId}`);
      toast.success("Label removed");
      await reloadLabels();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove label");
    } finally {
      setBusy(false);
    }
  };

  const assignedIds = new Set(assignments.map((a) => a.label_id));
  const hasUnsavedChanges = !!selectedLabelId || !!notes.trim();

  return (
    <AppModal
      open={open}
      onClose={onClose}
      hasUnsavedChanges={hasUnsavedChanges}
      align="center"
      testId="manage-patient-labels-modal-overlay"
    >
      <div className="bl-card p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto" data-testid="manage-patient-labels-modal">
        <div className="flex justify-between items-start gap-2 mb-4">
          <div>
            <div className="label-eyebrow">Manage labels</div>
            <p className="font-medium text-[#2D3A33]">{patientName || "Patient"}</p>
          </div>
          <button type="button" className="text-sm text-[#5C6C62]" onClick={onClose}>Close</button>
        </div>

        <div className="space-y-3 mb-5">
          <p className="label-eyebrow">Current labels</p>
          {assignments.length === 0 ? (
            <p className="text-sm text-[#5C6C62]">No labels assigned.</p>
          ) : (
            <ul className="space-y-2">
              {assignments.map((a) => (
                <li key={a.id} className="rounded-lg border border-[#EAE6D7] p-3 text-sm">
                  <div className="flex justify-between gap-2 items-start">
                    <PatientLabelsRow labels={[a.label]} />
                    {canRemove && (
                      <button type="button" className="text-xs text-[#B14A2C]" disabled={busy} onClick={() => remove(a.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                  {a.notes && <p className="text-xs text-[#5C6C62] mt-2">Reason: {a.notes}</p>}
                  <p className="text-xs text-[#8A9A86] mt-1">
                    {a.assigned_by_name_snapshot || "—"} · {a.assigned_at ? new Date(a.assigned_at).toLocaleString() : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canAssign && (
          <div className="space-y-3 border-t border-[#EAE6D7] pt-4">
            <p className="label-eyebrow">Add label</p>
            <select className="bl-input text-sm" value={selectedLabelId} onChange={(e) => setSelectedLabelId(e.target.value)}>
              <option value="">Select label</option>
              {catalog.filter((l) => l.active !== false && !assignedIds.has(l.id)).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {isBlacklist && (
              <textarea
                className="bl-input min-h-[72px] text-sm"
                placeholder="Reason for blacklist (required)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="blacklist-reason-input"
              />
            )}
            {!isBlacklist && selectedLabelId && (
              <input
                className="bl-input text-sm"
                placeholder="Note (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
            <button type="button" className="bl-btn-primary text-sm" disabled={busy} onClick={assign}>
              Assign label
            </button>
          </div>
        )}
      </div>
    </AppModal>
  );
}
