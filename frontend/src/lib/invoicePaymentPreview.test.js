import { buildInvoicePaymentPreview } from "./invoicePaymentPreview";

describe("buildInvoicePaymentPreview", () => {
  test("computes outstanding balance with discount and partial payment", () => {
    const preview = buildInvoicePaymentPreview({
      items: [{ unit_price_idr: 100000, quantity: 1 }],
      discountType: "fixed",
      discountValue: 10000,
      amountPaid: 50000,
      amountReceived: "",
      prepaidAmount: "",
    });
    expect(preview.subtotal).toBe(100000);
    expect(preview.discountAmount).toBe(10000);
    expect(preview.total).toBe(90000);
    expect(preview.outstanding).toBe(40000);
  });

  test("treats package-covered lines as zero cash due", () => {
    const preview = buildInvoicePaymentPreview({
      items: [
        { unit_price_idr: 200000, quantity: 1, paid_by: "package", original_treatment_value: 200000 },
      ],
      amountPaid: 0,
    });
    expect(preview.subtotal).toBe(0);
    expect(preview.packageCovered).toBe(200000);
    expect(preview.status).toBe("paid");
  });
});
