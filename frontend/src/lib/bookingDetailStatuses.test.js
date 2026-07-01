import {
  APPOINTMENT_STATUS_SELECT_OPTIONS,
  resolvePrimaryBookingAction,
  resolveBookingDetailActions,
} from "./bookingDetailStatuses";

describe("bookingDetailStatuses", () => {
  it("excludes treatment_started from status dropdown options", () => {
    expect(APPOINTMENT_STATUS_SELECT_OPTIONS.some((o) => o.value === "treatment_started")).toBe(false);
  });

  it("shows Confirm for booked appointments", () => {
    const action = resolvePrimaryBookingAction(
      { status: "booked" },
      { canManage: true },
    );
    expect(action).toEqual(expect.objectContaining({ type: "confirm", label: "Confirm" }));
  });

  it("shows Check in for confirmed appointments", () => {
    const action = resolvePrimaryBookingAction(
      { status: "confirmed" },
      { canManage: true },
    );
    expect(action).toEqual(expect.objectContaining({ type: "check_in", label: "Check in" }));
  });

  it("shows Open treatment session when visit exists", () => {
    const action = resolvePrimaryBookingAction(
      { status: "checked_in", visit_id: "v1" },
      { canManage: true },
    );
    expect(action).toEqual(expect.objectContaining({ type: "open_visit", visitId: "v1" }));
  });

  it("shows Save changes when status draft differs", () => {
    const action = resolvePrimaryBookingAction(
      { status: "booked" },
      { canManage: true, statusDirty: true },
    );
    expect(action).toEqual(expect.objectContaining({ type: "save_status", label: "Save changes" }));
  });

  it("shows Rebook for cancelled when allowed", () => {
    const action = resolvePrimaryBookingAction(
      { status: "cancelled" },
      { canRebook: true },
    );
    expect(action).toEqual(expect.objectContaining({ type: "rebook" }));
  });

  it("secondary actions omit duplicate primary buttons", () => {
    const actions = resolveBookingDetailActions(
      { status: "booked" },
      { canManage: true, editing: false, onHighlightPatient: true },
    );
    expect(actions.showEdit).toBe(true);
    expect(actions.showCancel).toBe(true);
    expect(actions.showHighlight).toBe(true);
    expect(actions).not.toHaveProperty("showConfirm");
  });
});
