import {
  CLINICAL_PERFORMER_ROLES,
  emptyAdditionalPerformerRow,
  itemPerformers,
  formatPerformerBadge,
  buildBookingPerformers,
  additionalRowsFromBooking,
  activeStaffForRole,
  staffOptionsForRow,
} from "@/lib/performerUtils";

const ROLE_LABELS = { doctor: "Doctor", therapist: "Therapist", nurse: "Nurse" };

export default function InvoiceItemPerformers({
  item,
  staff,
  readOnly,
  onPerformersChange,
}) {
  const performers = itemPerformers(item);
  const primaryId =
    performers.find((p) => (p.performer_type || "primary") === "primary")?.staff_id
    || item.performer_id
    || "";
  const assistants = additionalRowsFromBooking({ performers });
  const isTreatment = item.item_type === "treatment";

  const applyPerformers = (nextPrimaryId, nextAssistants) => {
    const built = buildBookingPerformers(nextPrimaryId, nextAssistants, staff);
    onPerformersChange(built);
  };

  const updateAssistantRow = (idx, patch) => {
    const next = assistants.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    applyPerformers(primaryId, next);
  };

  if (readOnly) {
    if (!performers.length) return <span className="text-xs text-[#A89F8B]">—</span>;
    return (
      <div className="space-y-0.5">
        {performers.map((p, i) => (
          <div key={i} className="text-xs text-[#5C6C62]">{formatPerformerBadge(p)}</div>
        ))}
      </div>
    );
  }

  if (!isTreatment) {
    return (
      <select
        className="bl-input text-sm"
        value={primaryId}
        onChange={(e) => applyPerformers(e.target.value, [])}
      >
        <option value="">None</option>
        {staff.filter((s) => CLINICAL_PERFORMER_ROLES.includes(s.role)).map((p) => (
          <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-2" data-testid={`invoice-item-performers-${item.id}`}>
      <div>
        <label className="label-eyebrow block mb-1">Primary performer *</label>
        <select
          className="bl-input text-sm"
          value={primaryId}
          onChange={(e) => applyPerformers(e.target.value, assistants)}
        >
          <option value="">Select performer…</option>
          {staff.filter((s) => CLINICAL_PERFORMER_ROLES.includes(s.role)).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
          ))}
        </select>
      </div>
      {assistants.map((row, idx) => {
        const role = row.staff_role || "nurse";
        const options = staffOptionsForRow({
          staff,
          role,
          primaryPerformerId: primaryId,
          rows: assistants,
          rowIndex: idx,
          availableIds: activeStaffForRole(staff, role).map((s) => s.id),
          slotReady: true,
        });
        return (
          <div key={idx} className="flex flex-wrap gap-2 items-end">
            <select
              className="bl-input w-28 text-sm"
              value={role}
              onChange={(e) => updateAssistantRow(idx, { staff_role: e.target.value, staff_id: "" })}
            >
              {CLINICAL_PERFORMER_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <select
              className="bl-input flex-1 min-w-[120px] text-sm"
              value={row.staff_id || ""}
              onChange={(e) => updateAssistantRow(idx, { staff_id: e.target.value })}
            >
              <option value="">Select staff…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              className="bl-input w-28 text-sm"
              value={row.performer_type || "assistant"}
              onChange={(e) => updateAssistantRow(idx, { performer_type: e.target.value })}
            >
              <option value="assistant">Assistant</option>
              <option value="secondary">Secondary</option>
            </select>
            <button
              type="button"
              className="text-xs text-[#B14A2C] px-2 py-2"
              onClick={() => applyPerformers(primaryId, assistants.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="text-xs text-[#52796F] underline"
        onClick={() => applyPerformers(primaryId, [...assistants, emptyAdditionalPerformerRow()])}
      >
        Add performer
      </button>
    </div>
  );
}
