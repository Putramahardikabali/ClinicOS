import { describe, it, expect } from "@jest/globals";
import {
  patientDisplayName,
  patientInitials,
  resolvePatientSearchPrimaryAction,
  serviceCountLabel,
} from "./schedulePatientLookup";

describe("schedulePatientLookup", () => {
  it("formats patient display name", () => {
    expect(patientDisplayName({ full_name: "Jane Doe" })).toBe("Jane Doe");
    expect(patientDisplayName({ first_name: "Jane", last_name: "Doe" })).toBe("Jane Doe");
  });

  it("builds initials", () => {
    expect(patientInitials({ full_name: "Jane Doe" })).toBe("JD");
    expect(patientInitials({ full_name: "X" })).toBe("X");
  });

  it("labels service counts", () => {
    expect(serviceCountLabel(0)).toBeNull();
    expect(serviceCountLabel(1)).toBe("1 service");
    expect(serviceCountLabel(2)).toBe("2 services");
  });

  it("resolves primary actions by booking count", () => {
    expect(resolvePatientSearchPrimaryAction(0)).toEqual({ key: "book", label: "Book Appointment" });
    expect(resolvePatientSearchPrimaryAction(1)).toEqual({ key: "modify", label: "Modify Appointment" });
    expect(resolvePatientSearchPrimaryAction(3)).toEqual({ key: "highlight", label: "Highlight bookings" });
  });
});
