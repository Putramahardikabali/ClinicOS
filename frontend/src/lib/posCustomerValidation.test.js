import { isPosCustomerReady, posCustomerValidationMessage } from "./posCustomerValidation";

describe("posCustomerValidation", () => {
  test("isPosCustomerReady allows walk-in without patient", () => {
    expect(isPosCustomerReady({ walkIn: true, selectedPatient: null })).toBe(true);
  });

  test("isPosCustomerReady requires patient when walk-in off", () => {
    expect(isPosCustomerReady({ walkIn: false, selectedPatient: null })).toBe(false);
    expect(isPosCustomerReady({ walkIn: false, selectedPatient: { id: "p1" } })).toBe(true);
  });

  test("posCustomerValidationMessage for registered patient mode", () => {
    expect(
      posCustomerValidationMessage({ walkIn: false, selectedPatient: null }),
    ).toBe("Select a patient.");
  });

  test("posCustomerValidationMessage for walk-in name", () => {
    expect(
      posCustomerValidationMessage({ walkIn: true, selectedPatient: null, customerName: "" }),
    ).toBe("Enter walk-in customer name");
  });
});
