import {
  canEditInvoiceItems,
  invoiceItemsSnapshot,
  mapInvoiceItemsForEdit,
} from "./invoiceItemEditing";

describe("invoiceItemEditing", () => {
  test("canEditInvoiceItems allows unpaid and partial", () => {
    expect(canEditInvoiceItems({ canEdit: true, paymentStatus: "unpaid", closingLocked: false })).toBe(true);
    expect(canEditInvoiceItems({ canEdit: true, paymentStatus: "partial", closingLocked: false })).toBe(true);
  });

  test("canEditInvoiceItems blocks paid and closed", () => {
    expect(canEditInvoiceItems({ canEdit: true, paymentStatus: "paid", closingLocked: false })).toBe(false);
    expect(canEditInvoiceItems({ canEdit: true, paymentStatus: "unpaid", closingLocked: true })).toBe(false);
    expect(canEditInvoiceItems({ canEdit: false, paymentStatus: "unpaid", closingLocked: false })).toBe(false);
  });

  test("invoiceItemsSnapshot detects item changes", () => {
    const a = mapInvoiceItemsForEdit([{ id: "1", name: "A", unit_price_idr: 100, quantity: 1, item_type: "custom" }]);
    const b = mapInvoiceItemsForEdit([{ id: "1", name: "A", unit_price_idr: 200, quantity: 1, item_type: "custom" }]);
    expect(invoiceItemsSnapshot(a)).not.toBe(invoiceItemsSnapshot(b));
  });
});
