import { useEffect } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { GIFT_CARD_TYPE_OPTIONS } from "@/lib/posGiftCard";
import { fmtIDR } from "@/lib/posUtils";
import PosSearchCombobox from "@/components/pos/PosSearchCombobox";

export default function PosGiftCardForm({ draft, onDraftChange }) {
  const { user } = useAuth();
  const canOverridePrice = hasPermission(user, "pos.override_price");
  const patchDraft = (patch) => onDraftChange({ ...draft, ...patch });

  const gcType = draft.giftCardType || "value_credit";
  const catalogPrice =
    gcType === "treatment"
      ? parseInt(draft.selectedGiftTreatment?.price_idr, 10) || 0
      : gcType === "package"
        ? parseInt(draft.selectedGiftPackage?.price_idr, 10) || 0
        : 0;
  const priceLocked = (gcType === "treatment" || gcType === "package") && catalogPrice > 0 && !canOverridePrice;

  useEffect(() => {
    const q = draft.giftTreatmentQuery;
    if (gcType !== "treatment" || !q?.trim()) {
      if (draft.giftTreatmentOptions?.length) patchDraft({ giftTreatmentOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/treatments", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ giftTreatmentOptions: r.data?.items || [] });
      } catch {
        patchDraft({ giftTreatmentOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.giftTreatmentQuery, gcType]);

  useEffect(() => {
    const q = draft.giftPackageQuery;
    if (gcType !== "package" || !q?.trim()) {
      if (draft.giftPackageOptions?.length) patchDraft({ giftPackageOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/packages", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ giftPackageOptions: r.data?.items || [] });
      } catch {
        patchDraft({ giftPackageOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.giftPackageQuery, gcType]);

  const onTypeChange = (nextType) => {
    onDraftChange({
      ...draft,
      giftCardType: nextType,
      giftValue: "",
      giftUnitPrice: "",
      selectedGiftTreatment: null,
      giftTreatmentQuery: "",
      giftTreatmentOptions: [],
      selectedGiftPackage: null,
      giftPackageQuery: "",
      giftPackageOptions: [],
    });
  };

  const priceLabel =
    gcType === "value_credit"
      ? "Amount / value (IDR) *"
      : "Price (IDR) *";

  const priceValue = gcType === "value_credit" ? draft.giftValue : draft.giftUnitPrice;

  return (
    <div className="space-y-3">
      <div>
        <label className="label-eyebrow block mb-1">Gift card type</label>
        <select
          className="bl-input"
          value={gcType}
          onChange={(e) => onTypeChange(e.target.value)}
          data-testid="pos-gift-card-type"
        >
          {GIFT_CARD_TYPE_OPTIONS.map((g) => (
            <option key={g.v} value={g.v}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {gcType === "treatment" && (
        draft.selectedGiftTreatment ? (
          <div className="bl-input py-3" data-testid="pos-selected-gift-treatment">
            <div className="font-medium">{draft.selectedGiftTreatment.name}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5">
              {draft.selectedGiftTreatment.duration_min || "—"} min ·{" "}
              {fmtIDR(draft.selectedGiftTreatment.price_idr)}
            </div>
            <button
              type="button"
              className="text-xs mt-2 text-[var(--bl-primary)] font-medium"
              onClick={() =>
                patchDraft({
                  selectedGiftTreatment: null,
                  giftTreatmentQuery: "",
                  giftUnitPrice: "",
                })
              }
            >
              Change
            </button>
          </div>
        ) : (
          <PosSearchCombobox
            value={draft.giftTreatmentQuery}
            onValueChange={(v) => {
              patchDraft({ giftTreatmentQuery: v, ...(v.trim() ? {} : { giftTreatmentOptions: [] }) });
            }}
            options={draft.giftTreatmentOptions || []}
            onSelect={(t) => {
              patchDraft({
                selectedGiftTreatment: t,
                giftTreatmentQuery: "",
                giftTreatmentOptions: [],
                giftUnitPrice: String(t.price_idr || ""),
              });
            }}
            getOptionKey={(t) => t.id}
            placeholder="Search treatment…"
            listAriaLabel="Treatments for gift card"
            emptyMessage="No treatments found"
            testId="pos-gift-treatment-search"
            renderOption={(t) => (
              <>
                <div className="font-medium text-sm text-[#2D3A33]">{t.name}</div>
                <div className="text-xs text-[#5C6C62] mt-0.5">
                  {t.duration_min || "—"} min · {fmtIDR(t.price_idr)}
                </div>
              </>
            )}
          />
        )
      )}

      {gcType === "package" && (
        draft.selectedGiftPackage ? (
          <div className="bl-input py-3" data-testid="pos-selected-gift-package">
            <div className="font-medium">{draft.selectedGiftPackage.name}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5">{fmtIDR(draft.selectedGiftPackage.price_idr)}</div>
            <button
              type="button"
              className="text-xs mt-2 text-[var(--bl-primary)] font-medium"
              onClick={() =>
                patchDraft({
                  selectedGiftPackage: null,
                  giftPackageQuery: "",
                  giftUnitPrice: "",
                })
              }
            >
              Change
            </button>
          </div>
        ) : (
          <PosSearchCombobox
            value={draft.giftPackageQuery}
            onValueChange={(v) => {
              patchDraft({ giftPackageQuery: v, ...(v.trim() ? {} : { giftPackageOptions: [] }) });
            }}
            options={draft.giftPackageOptions || []}
            onSelect={(p) => {
              patchDraft({
                selectedGiftPackage: p,
                giftPackageQuery: "",
                giftPackageOptions: [],
                giftUnitPrice: String(p.price_idr || ""),
              });
            }}
            getOptionKey={(p) => p.id}
            placeholder="Search package…"
            listAriaLabel="Packages for gift card"
            emptyMessage="No packages found"
            testId="pos-gift-package-search"
            renderOption={(p) => (
              <>
                <div className="font-medium text-sm text-[#2D3A33]">{p.name}</div>
                <div className="text-xs text-[#5C6C62] mt-0.5">{fmtIDR(p.price_idr)}</div>
              </>
            )}
          />
        )
      )}

      <div>
        <label className="label-eyebrow block mb-1">{priceLabel}</label>
        <input
          className="bl-input font-mono"
          placeholder="IDR"
          value={priceValue || ""}
          readOnly={priceLocked}
          onChange={(e) => {
            if (gcType === "value_credit") {
              patchDraft({ giftValue: e.target.value });
            } else {
              patchDraft({ giftUnitPrice: e.target.value });
            }
          }}
          data-testid="pos-gift-value"
        />
        {priceLocked && catalogPrice > 0 && (
          <p className="text-xs text-[#5C6C62] mt-1">Catalog price: {fmtIDR(catalogPrice)}</p>
        )}
        {canOverridePrice && gcType !== "value_credit" && catalogPrice > 0 && (
          <p className="text-xs text-[#5C6C62] mt-1">You may override the catalog price.</p>
        )}
      </div>

      <input
        className="bl-input"
        placeholder="Recipient name (optional)"
        value={draft.recipientName || ""}
        onChange={(e) => patchDraft({ recipientName: e.target.value })}
        data-testid="pos-gift-recipient-name"
      />
      <input
        className="bl-input"
        placeholder="Recipient phone (optional)"
        value={draft.recipientPhone || ""}
        onChange={(e) => patchDraft({ recipientPhone: e.target.value })}
      />
      <input
        className="bl-input"
        type="email"
        placeholder="Recipient email (optional)"
        value={draft.recipientEmail || ""}
        onChange={(e) => patchDraft({ recipientEmail: e.target.value })}
        data-testid="pos-gift-recipient-email"
      />
      <input
        className="bl-input"
        placeholder="Message (optional)"
        value={draft.giftMessage || ""}
        onChange={(e) => patchDraft({ giftMessage: e.target.value })}
      />
      <div>
        <label className="label-eyebrow block mb-1">Expiry date (optional)</label>
        <input
          className="bl-input"
          type="date"
          value={draft.giftExpiry || ""}
          onChange={(e) => patchDraft({ giftExpiry: e.target.value })}
          data-testid="pos-gift-expiry"
        />
      </div>
      <input
        className="bl-input"
        placeholder="Notes (optional)"
        value={draft.giftNotes || ""}
        onChange={(e) => patchDraft({ giftNotes: e.target.value })}
        data-testid="pos-gift-notes"
      />
    </div>
  );
}
