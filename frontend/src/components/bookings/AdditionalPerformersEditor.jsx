import { useEffect, useState } from "react";
import api from "@/lib/api";
import {
  CLINICAL_PERFORMER_ROLES,
  emptyAdditionalPerformerRow,
  pruneUnavailableAdditionalRows,
  staffOptionsForRow,
  validateAdditionalPerformers,
} from "@/lib/performerUtils";

const ROLE_LABELS = { doctor: "Doctor", therapist: "Therapist", nurse: "Nurse" };

export default function AdditionalPerformersEditor({
  rows,
  onChange,
  primaryPerformerId,
  staff,
  scheduledDate,
  scheduledTime,
  durationMin,
  treatment,
  packageId,
  bookingType,
  excludeBookingId,
  onAvailabilityChange,
  testIdPrefix = "ap",
}) {
  const [availByRole, setAvailByRole] = useState({});
  const [loadingAvail, setLoadingAvail] = useState(false);

  const slotReady = Boolean(scheduledDate && scheduledTime && (treatment || packageId));

  useEffect(() => {
    if (!slotReady) {
      setAvailByRole({});
      onAvailabilityChange?.({});
      return;
    }
    let cancelled = false;
    setLoadingAvail(true);
    const base = {
      date: scheduledDate,
      time: scheduledTime,
      duration: durationMin || 30,
      treatment: treatment || undefined,
      package_id: packageId || undefined,
      booking_type: bookingType || undefined,
      exclude_booking_id: excludeBookingId || undefined,
    };
    Promise.all(
      CLINICAL_PERFORMER_ROLES.map((role) =>
        api
          .get("/bookings/available-performers", { params: { ...base, role } })
          .then((r) => [role, r.data?.performers || []])
          .catch(() => [role, []])
      )
    )
      .then((entries) => {
        if (cancelled) return;
        const map = Object.fromEntries(entries);
        setAvailByRole(map);
        onAvailabilityChange?.(map);
      })
      .finally(() => {
        if (!cancelled) setLoadingAvail(false);
      });
    return () => { cancelled = true; };
  }, [
    slotReady,
    scheduledDate,
    scheduledTime,
    durationMin,
    treatment,
    packageId,
    bookingType,
    excludeBookingId,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  useEffect(() => {
    if (!slotReady || !rows.length) return;
    const pruned = pruneUnavailableAdditionalRows(rows, availByRole);
    if (pruned !== rows) onChange(pruned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availByRole, slotReady]);

  const updateRow = (idx, patch) => {
    const next = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRow = () => onChange([...rows, emptyAdditionalPerformerRow()]);

  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-additional-performers`}>
      <div className="flex items-center justify-between">
        <label className="label-eyebrow">Additional performers</label>
        <button type="button" className="text-xs text-[#52796F] underline" onClick={addRow}>
          Add performer
        </button>
      </div>
      {loadingAvail && slotReady && (
        <div className="text-xs text-[#5C6C62]">Checking staff availability…</div>
      )}
      {!slotReady && rows.length > 0 && (
        <div className="text-xs text-[#A89F8B]">Pick date and time to see available staff.</div>
      )}
      {rows.map((row, idx) => {
        const role = row.staff_role || "nurse";
        const options = staffOptionsForRow({
          staff,
          role,
          primaryPerformerId,
          rows,
          rowIndex: idx,
          availableIds: (availByRole[role] || []).map((p) => p.id),
          slotReady,
        });
        return (
          <div key={idx} className="flex flex-wrap gap-2 items-start" data-testid={`${testIdPrefix}-row-${idx}`}>
            <select
              className="bl-input w-32"
              value={role}
              onChange={(e) => updateRow(idx, { staff_role: e.target.value, staff_id: "" })}
              data-testid={`${testIdPrefix}-role-${idx}`}
            >
              {CLINICAL_PERFORMER_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
              ))}
            </select>
            <select
              className="bl-input flex-1 min-w-[140px]"
              value={row.staff_id || ""}
              onChange={(e) => updateRow(idx, { staff_id: e.target.value })}
              disabled={!slotReady || loadingAvail}
              data-testid={`${testIdPrefix}-staff-${idx}`}
            >
              <option value="">
                {!slotReady ? "Pick date & time…" : options.length ? "Select staff…" : "No staff available"}
              </option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              className="bl-input w-28"
              value={row.performer_type || "assistant"}
              onChange={(e) => updateRow(idx, { performer_type: e.target.value })}
              data-testid={`${testIdPrefix}-type-${idx}`}
            >
              <option value="assistant">Assistant</option>
              <option value="secondary">Secondary</option>
            </select>
            <button
              type="button"
              className="text-xs text-[#B14A2C] px-2 py-2"
              onClick={() => removeRow(idx)}
              data-testid={`${testIdPrefix}-remove-${idx}`}
            >
              Remove
            </button>
          </div>
        );
      })}
    </div>
  );
}

export { validateAdditionalPerformers };
