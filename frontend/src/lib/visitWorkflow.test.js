import {
  WORKFLOW_STEPS,
  getVisibleWorkflowSteps,
  buildWorkflowStepStatuses,
  computeStepStatus,
  bookedTreatmentLabel,
  clinicalNotesStepLabel,
  buildVisitClinicalAlerts,
  primaryVisitNoteRole,
  canEditPerformedTreatments,
} from "@/lib/visitWorkflow";

const doctorUser = { role: "doctor", permissions: ["edit_clinical"] };
const therapistUser = { role: "therapist", permissions: ["edit_therapist"] };
const nurseUser = { role: "nurse", permissions: ["edit_therapist"] };
const managerUser = { role: "manager", permissions: [] };

const clinicFull = {
  features: ["emr", "photos", "mapping"],
};

function baseVisit(overrides = {}) {
  return {
    id: "v1",
    visit_type: "doctor",
    status: "in_progress",
    consent_required: true,
    consent_forms: [],
    photos: [],
    mappings: [],
    treatment_items: [],
    product_usages: [],
    performers: [{ staff_id: "s1", staff_role_snapshot: "doctor", performer_type: "primary" }],
    patient: { full_name: "Test Patient" },
    booking: { treatment: "Botox Forehead" },
    ...overrides,
  };
}

describe("visitWorkflow", () => {
  it("defines eight workflow steps", () => {
    expect(WORKFLOW_STEPS.map((s) => s.id)).toEqual([
      "overview",
      "consent",
      "photos_before",
      "clinical_notes",
      "mapping",
      "treatments",
      "photos_after",
      "final_review",
    ]);
  });

  it("filters steps by clinic features", () => {
    const visit = baseVisit();
    const steps = getVisibleWorkflowSteps(doctorUser, visit, { features: ["emr"] });
    expect(steps.some((s) => s.id === "photos_before")).toBe(false);
    expect(steps.some((s) => s.id === "mapping")).toBe(false);
    expect(steps.some((s) => s.id === "clinical_notes")).toBe(true);
  });

  it("shows clinical notes for doctor on doctor visit", () => {
    const visit = baseVisit();
    const steps = getVisibleWorkflowSteps(doctorUser, visit, clinicFull);
    expect(steps.some((s) => s.id === "clinical_notes")).toBe(true);
    expect(clinicalNotesStepLabel(visit)).toBe("Doctor notes");
  });

  it("shows therapist notes label for therapist visit", () => {
    const visit = baseVisit({
      visit_type: "therapist",
      performers: [{ staff_id: "s2", staff_role_snapshot: "therapist", performer_type: "primary" }],
    });
    expect(clinicalNotesStepLabel(visit)).toBe("Therapist notes");
    const steps = getVisibleWorkflowSteps(therapistUser, visit, clinicFull);
    expect(steps.some((s) => s.id === "clinical_notes")).toBe(true);
  });

  it("shows nurse notes label for nurse visit", () => {
    const visit = baseVisit({
      visit_type: "nurse",
      performers: [{ staff_id: "s3", staff_role_snapshot: "nurse", performer_type: "primary" }],
    });
    expect(clinicalNotesStepLabel(visit)).toBe("Nurse notes");
    const steps = getVisibleWorkflowSteps(nurseUser, visit, clinicFull);
    expect(steps.some((s) => s.id === "clinical_notes")).toBe(true);
  });

  it("computes consent warning when required and missing", () => {
    const visit = baseVisit({ consent_required: true, consent_forms: [] });
    expect(computeStepStatus("consent", visit, clinicFull)).toBe("warning");
  });

  it("computes photo step done when before photos exist", () => {
    const visit = baseVisit({
      photos: [{ id: "p1", photo_type: "before" }],
    });
    expect(computeStepStatus("photos_before", visit, clinicFull)).toBe("done");
    expect(computeStepStatus("photos_after", visit, clinicFull)).toBe("pending");
  });

  it("uses booked treatment label from booking", () => {
    const visit = baseVisit();
    expect(bookedTreatmentLabel(visit)).toBe("Botox Forehead");
  });

  it("buildWorkflowStepStatuses marks treatments done when items exist", () => {
    const visit = baseVisit({ treatment_items: [{ id: "t1", name: "Botox" }] });
    const steps = getVisibleWorkflowSteps(managerUser, visit, clinicFull);
    const statuses = buildWorkflowStepStatuses(steps, visit, clinicFull);
    expect(statuses.treatments).toBe("done");
  });

  it("clinical alerts exclude generic photos warning", () => {
    const visit = baseVisit({ photos: [] });
    const alerts = buildVisitClinicalAlerts(visit, { showBilling: false });
    expect(alerts.some((a) => /photo/i.test(a.label))).toBe(false);
  });

  it("clinical alerts include allergy when documented", () => {
    const visit = baseVisit({
      patient: { full_name: "Test", allergies: "Penicillin" },
    });
    const alerts = buildVisitClinicalAlerts(visit);
    expect(alerts.some((a) => a.key === "allergy")).toBe(true);
  });

  it("clinical alerts include unpaid when billing outstanding", () => {
    const visit = baseVisit({ status: "submitted", payment_status: "unpaid" });
    const alerts = buildVisitClinicalAlerts(visit, { showBilling: true });
    expect(alerts.some((a) => a.key === "unpaid")).toBe(true);
  });

  it("primaryVisitNoteRole returns doctor for doctor visit", () => {
    expect(primaryVisitNoteRole(baseVisit())).toBe("doctor");
  });

  it("primaryVisitNoteRole returns therapist for therapist visit", () => {
    const visit = baseVisit({
      visit_type: "therapist",
      performers: [{ staff_id: "s2", staff_role_snapshot: "therapist", performer_type: "primary" }],
    });
    expect(primaryVisitNoteRole(visit)).toBe("therapist");
  });

  it("canEditPerformedTreatments allows clinical roles and blocks completed visits", () => {
    const visit = baseVisit();
    expect(canEditPerformedTreatments({ role: "doctor" }, visit)).toBe(true);
    expect(canEditPerformedTreatments({ role: "therapist" }, visit)).toBe(true);
    expect(canEditPerformedTreatments({ role: "nurse" }, visit)).toBe(true);
    expect(canEditPerformedTreatments({ role: "doctor", permissions: ["clinical_records.edit"] }, visit)).toBe(true);
    expect(canEditPerformedTreatments(nurseUser, visit)).toBe(false);
    expect(canEditPerformedTreatments(managerUser, visit)).toBe(false);
    expect(canEditPerformedTreatments({ role: "doctor" }, { ...visit, status: "completed" })).toBe(false);
  });
});
