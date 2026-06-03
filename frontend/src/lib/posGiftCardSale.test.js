import {
  describeGiftCardSaleItem,
  giftCardItemsFromSale,
  saleHasGiftCardItems,
} from "./posGiftCardSale";

describe("POS receipt gift card data", () => {
  const sale = {
    items: [
      {
        item_type: "gift_card",
        gift_card_code: "GC-ABCD-EFGH",
        unit_price: 200000,
        metadata: {
          gift_card_type: "value_credit",
          value_idr: 200000,
          recipient_name: "Jane Doe",
          expiry_date: "2099-06-15",
        },
      },
      { item_type: "product", name_snapshot: "Serum" },
    ],
  };

  test("saleHasGiftCardItems detects gift card lines", () => {
    expect(saleHasGiftCardItems(sale)).toBe(true);
    expect(saleHasGiftCardItems({ items: [{ item_type: "product" }] })).toBe(false);
  });

  test("describeGiftCardSaleItem exposes receipt fields", () => {
    const items = giftCardItemsFromSale(sale);
    expect(items).toHaveLength(1);
    const d = describeGiftCardSaleItem(items[0]);
    expect(d.code).toBe("GC-ABCD-EFGH");
    expect(d.type).toMatch(/Value/i);
    expect(d.valueIdr).toBe(200000);
    expect(d.recipientName).toBe("Jane Doe");
    expect(d.expiryDate).toBe("2099-06-15");
    expect(d.statusLabel).toBe("Active");
  });

  test("treatment gift card receipt shows Active status", () => {
    const pkgSale = {
      items: [{
        item_type: "gift_card",
        gift_card_code: "GC-TEST-1234",
        unit_price: 6000000,
        metadata: {
          gift_card_type: "package",
          value_idr: 6000000,
          package_name_snapshot: "Premium Package",
        },
      }],
    };
    const d = describeGiftCardSaleItem(giftCardItemsFromSale(pkgSale)[0]);
    expect(d.statusLabel).toBe("Active");
    expect(d.gcType).toBe("package");
  });
});
