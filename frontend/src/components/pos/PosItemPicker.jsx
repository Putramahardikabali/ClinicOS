import { useEffect, useMemo } from "react";
import api from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";
import { hasPermission, useAuth } from "@/lib/auth";
import { ITEM_TABS, fmtIDR } from "@/lib/posUtils";
import PosSearchCombobox from "@/components/pos/PosSearchCombobox";

import PosGiftCardForm from "@/components/pos/PosGiftCardForm";

export function emptyDraft(tab = "product") {
  return {
    tab,
    productQuery: "",
    packageQuery: "",
    serviceQuery: "",
    productOptions: [],
    packageOptions: [],
    serviceOptions: [],
    selectedProduct: null,
    selectedPackage: null,
    selectedService: null,
    customName: "",
    customNotes: "",
    qty: "1",
    unitPrice: "",
    discount: "0",
    giftCardType: "value_credit",
    giftValue: "",
    giftUnitPrice: "",
    recipientName: "",
    recipientPhone: "",
    recipientEmail: "",
    giftMessage: "",
    giftExpiry: "",
    giftNotes: "",
    giftCardCode: "",
    giftTreatmentQuery: "",
    giftTreatmentOptions: [],
    selectedGiftTreatment: null,
    giftPackageQuery: "",
    giftPackageOptions: [],
    selectedGiftPackage: null,
  };
}

function productMetaLine(p) {
  const stock = Number(p.current_stock) || 0;
  const unit = p.unit || "pcs";
  const price =
    p.sale_price_idr > 0 ? fmtIDR(p.sale_price_idr) : "Price not set";
  return `Stock: ${stock} ${unit} · ${price}`;
}

export default function PosItemPicker({
  activeTab,
  onTabChange,
  draft,
  onDraftChange,
  onAddToCart,
  packageRequiresPatient,
}) {
  const { user } = useAuth();
  const canAddGiftCardToPos =
    hasPermission(user, "pos.create") && hasPermission(user, "gift_cards.create");
  const visibleTabs = useMemo(
    () => ITEM_TABS.filter((t) => t.id !== "gift_card" || canAddGiftCardToPos),
    [canAddGiftCardToPos],
  );
  const patchDraft = (patch) => onDraftChange({ ...draft, ...patch });

  useEffect(() => {
    if (activeTab === "gift_card" && !canAddGiftCardToPos) {
      onTabChange("product");
    }
  }, [activeTab, canAddGiftCardToPos, onTabChange]);

  useEffect(() => {
    const q = draft.productQuery;
    if (activeTab !== "product" || !q?.trim()) {
      if (draft.productOptions.length) patchDraft({ productOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/products", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ productOptions: r.data?.items || [] });
      } catch {
        patchDraft({ productOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.productQuery, activeTab]);

  useEffect(() => {
    const q = draft.packageQuery;
    if (activeTab !== "package" || !q?.trim()) {
      if (draft.packageOptions.length) patchDraft({ packageOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/packages", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ packageOptions: r.data?.items || [] });
      } catch {
        patchDraft({ packageOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.packageQuery, activeTab]);

  useEffect(() => {
    const q = draft.serviceQuery;
    if (activeTab !== "service" || !q?.trim()) {
      if (draft.serviceOptions.length) patchDraft({ serviceOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/treatments", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ serviceOptions: r.data?.items || [] });
      } catch {
        patchDraft({ serviceOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.serviceQuery, activeTab]);

  const showQtyPrice = activeTab !== "gift_card";

  const renderForm = () => {
    if (activeTab === "product") {
      return draft.selectedProduct ? (
        <div className="bl-input flex justify-between items-start gap-2 py-3" data-testid="pos-selected-product">
          <div className="min-w-0">
            <div className="font-medium">{draft.selectedProduct.name}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5">{productMetaLine(draft.selectedProduct)}</div>
          </div>
          <button
            type="button"
            onClick={() => patchDraft({ selectedProduct: null, productQuery: "", productOptions: [] })}
            className="text-[#5C6C62] shrink-0 p-1"
            aria-label="Clear product"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <PosSearchCombobox
          value={draft.productQuery}
          onValueChange={(v) => {
            patchDraft({ productQuery: v, ...(v.trim() ? {} : { productOptions: [] }) });
          }}
          options={draft.productOptions}
          onSelect={(p) => {
            patchDraft({
              selectedProduct: p,
              productQuery: "",
              productOptions: [],
              unitPrice: p.sale_price_idr ? String(p.sale_price_idr) : "",
            });
          }}
          getOptionKey={(p) => p.id}
          placeholder="Search product name, code, brand…"
          listAriaLabel="Products"
          emptyMessage="No products found"
          testId="pos-product-search"
          renderOption={(p) => (
            <>
              <div className="font-medium text-sm text-[#2D3A33]">{p.name}</div>
              <div className="text-xs text-[#5C6C62] mt-0.5">{productMetaLine(p)}</div>
            </>
          )}
        />
      );
    }

    if (activeTab === "package") {
      return (
        <div className="space-y-2">
          {draft.selectedPackage ? (
            <div className="bl-input py-3" data-testid="pos-selected-package">
              <div className="font-medium">{draft.selectedPackage.name}</div>
              <div className="text-xs text-[#5C6C62] mt-0.5">
                {draft.selectedPackage.package_type} · {fmtIDR(draft.selectedPackage.price_idr)}
              </div>
              <button
                type="button"
                className="text-xs mt-2 text-[var(--bl-primary)] font-medium"
                onClick={() => patchDraft({ selectedPackage: null, packageQuery: "", packageOptions: [] })}
              >
                Change
              </button>
            </div>
          ) : (
            <PosSearchCombobox
              value={draft.packageQuery}
              onValueChange={(v) => {
                patchDraft({ packageQuery: v, ...(v.trim() ? {} : { packageOptions: [] }) });
              }}
              options={draft.packageOptions}
              onSelect={(p) => {
                patchDraft({
                  selectedPackage: p,
                  packageQuery: "",
                  packageOptions: [],
                  unitPrice: String(p.price_idr || ""),
                });
              }}
              getOptionKey={(p) => p.id}
              placeholder="Search packages…"
              listAriaLabel="Packages"
              emptyMessage="No packages found"
              testId="pos-package-search"
              renderOption={(p) => (
                <>
                  <div className="font-medium text-sm text-[#2D3A33]">{p.name}</div>
                  <div className="text-xs text-[#5C6C62] mt-0.5">
                    {p.package_type} · {fmtIDR(p.price_idr)}
                  </div>
                </>
              )}
            />
          )}
          {packageRequiresPatient && (
            <p className="text-xs text-[#B45309]">Select a patient — required for packages</p>
          )}
        </div>
      );
    }

    if (activeTab === "service") {
      return draft.selectedService ? (
        <div className="bl-input py-3" data-testid="pos-selected-service">
          <div className="font-medium">{draft.selectedService.name}</div>
          <div className="text-xs text-[#5C6C62] mt-0.5">
            {draft.selectedService.category || "—"} · {draft.selectedService.duration_min || "—"} min ·{" "}
            {fmtIDR(draft.selectedService.price_idr)}
          </div>
          <button
            type="button"
            className="text-xs mt-2 text-[var(--bl-primary)] font-medium"
            onClick={() => patchDraft({ selectedService: null, serviceQuery: "", serviceOptions: [] })}
          >
            Change
          </button>
        </div>
      ) : (
        <PosSearchCombobox
          value={draft.serviceQuery}
          onValueChange={(v) => {
            patchDraft({ serviceQuery: v, ...(v.trim() ? {} : { serviceOptions: [] }) });
          }}
          options={draft.serviceOptions}
          onSelect={(t) => {
            patchDraft({
              selectedService: t,
              serviceQuery: "",
              serviceOptions: [],
              unitPrice: String(t.price_idr || ""),
            });
          }}
          getOptionKey={(t) => t.id}
          placeholder="Search treatments…"
          listAriaLabel="Treatments"
          emptyMessage="No treatments found"
          testId="pos-service-search"
          renderOption={(t) => (
            <>
              <div className="font-medium text-sm text-[#2D3A33]">{t.name}</div>
              <div className="text-xs text-[#5C6C62] mt-0.5">
                {t.duration_min || "—"} min · {fmtIDR(t.price_idr)}
              </div>
            </>
          )}
        />
      );
    }

    if (activeTab === "gift_card") {
      return <PosGiftCardForm draft={draft} onDraftChange={onDraftChange} />;
    }

    return (
      <div className="space-y-3">
        <input
          className="bl-input"
          placeholder="Line name"
          value={draft.customName}
          onChange={(e) => patchDraft({ customName: e.target.value })}
          data-testid="pos-custom-name"
        />
        <input
          className="bl-input"
          placeholder="Notes (optional)"
          value={draft.customNotes}
          onChange={(e) => patchDraft({ customNotes: e.target.value })}
        />
      </div>
    );
  };

  return (
    <div className="bl-card p-4 sm:p-5 overflow-visible">
      <div className="flex flex-wrap gap-1.5 mb-4" role="tablist">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-[var(--bl-primary)] text-white shadow-sm"
                : "bg-[#F8F5EC] text-[#5C6C62] hover:bg-[#EAE6D7]"
            }`}
            data-testid={`pos-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {renderForm()}
      {showQtyPrice && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <label className="label-eyebrow block mb-1">Qty</label>
            <input
              className="bl-input py-1.5"
              type="number"
              min="0.01"
              step="any"
              value={draft.qty}
              onChange={(e) => patchDraft({ qty: e.target.value })}
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Unit price</label>
            <input
              className="bl-input font-mono py-1.5"
              value={draft.unitPrice}
              onChange={(e) => patchDraft({ unitPrice: e.target.value })}
              data-testid="pos-line-price"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1">Line disc.</label>
            <input
              className="bl-input font-mono py-1.5"
              value={draft.discount}
              onChange={(e) => patchDraft({ discount: e.target.value })}
            />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onAddToCart}
        className="bl-btn-secondary mt-4 w-full sm:w-auto text-sm inline-flex items-center justify-center gap-1.5"
        data-testid="pos-add-to-cart"
      >
        <Plus className="w-4 h-4" /> Add to cart
      </button>
    </div>
  );
}
