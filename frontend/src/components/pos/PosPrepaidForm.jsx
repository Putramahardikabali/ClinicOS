import { useEffect } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { PREPAID_TYPE_OPTIONS } from "@/lib/posPrepaid";
import { fmtIDR } from "@/lib/posUtils";
import PosSearchCombobox from "@/components/pos/PosSearchCombobox";

export default function PosPrepaidForm({ draft, onDraftChange }) {
  const { user } = useAuth();
  const canOverridePrice = hasPermission(user, "pos.override_price");
  const patchDraft = (patch) => onDraftChange({ ...draft, ...patch });

  const ptype = draft.prepaidType || "credit";
  const catalogPrice =
    ptype === "treatment" ? parseInt(draft.selectedPrepaidTreatment?.price_idr, 10) || 0 : 0;
  const priceLocked = ptype === "treatment" && catalogPrice > 0 && !canOverridePrice;

  useEffect(() => {
    const q = draft.prepaidTreatmentQuery;
    if (ptype !== "treatment" || !q?.trim()) {
      if (draft.prepaidTreatmentOptions?.length) patchDraft({ prepaidTreatmentOptions: [] });
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/pos/treatments", { params: { q, page: 1, page_size: 15 } });
        patchDraft({ prepaidTreatmentOptions: r.data?.items || [] });
      } catch {
        patchDraft({ prepaidTreatmentOptions: [] });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.prepaidTreatmentQuery, ptype]);

  const onTypeChange = (nextType) => {
    onDraftChange({
      ...draft,
      prepaidType: nextType,
      prepaidValue: "",
      prepaidUnitPrice: "",
      prepaidQuantity: "1",
      selectedPrepaidTreatment: null,
      prepaidTreatmentQuery: "",
      prepaidTreatmentOptions: [],
    });
  };

  const priceLabel = ptype === "credit" ? "Prepaid amount (IDR) *" : "Promo / locked price (IDR) *";
  const priceValue = ptype === "credit" ? draft.prepaidValue : draft.prepaidUnitPrice;

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#5C6C62]">
        Prepaid is money or treatment credit paid in advance. It is recognized as revenue only when used.
      </p>
      <div>
        <label className="label-eyebrow block mb-1">Prepaid type</label>
        <select
          className="bl-input"
          value={ptype}
          onChange={(e) => onTypeChange(e.target.value)}
          data-testid="pos-prepaid-type"
        >
          {PREPAID_TYPE_OPTIONS.map((g) => (
            <option key={g.v} value={g.v}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {ptype === "treatment" && (
        draft.selectedPrepaidTreatment ? (
          <div className="bl-input py-3" data-testid="pos-selected-prepaid-treatment">
            <div className="font-medium">{draft.selectedPrepaidTreatment.name}</div>
            <div className="text-xs text-[#5C6C62] mt-0.5">
              {draft.selectedPrepaidTreatment.duration_min || "—"} min ·{" "}
              {fmtIDR(draft.selectedPrepaidTreatment.price_idr)}
            </div>
            <button
              type="button"
              className="text-xs mt-2 text-[var(--bl-primary)] font-medium"
              onClick={() =>
                patchDraft({
                  selectedPrepaidTreatment: null,
                  prepaidTreatmentQuery: "",
                  prepaidUnitPrice: "",
                })
              }
            >
              Change
            </button>
          </div>
        ) : (
          <PosSearchCombobox
            value={draft.prepaidTreatmentQuery}
            onValueChange={(v) => {
              patchDraft({ prepaidTreatmentQuery: v, ...(v.trim() ? {} : { prepaidTreatmentOptions: [] }) });
            }}
            options={draft.prepaidTreatmentOptions || []}
            onSelect={(t) => {
              patchDraft({
                selectedPrepaidTreatment: t,
                prepaidTreatmentQuery: "",
                prepaidTreatmentOptions: [],
                prepaidUnitPrice: String(t.price_idr || ""),
              });
            }}
            getOptionKey={(t) => t.id}
            placeholder="Search treatment…"
            listAriaLabel="Treatments for prepaid"
            emptyMessage="No treatments found"
            testId="pos-prepaid-treatment-search"
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

      {ptype === "treatment" && (
        <div>
          <label className="label-eyebrow block mb-1">Session count</label>
          <input
            className="bl-input font-mono"
            type="number"
            min="1"
            value={draft.prepaidQuantity || "1"}
            onChange={(e) => patchDraft({ prepaidQuantity: e.target.value })}
            data-testid="pos-prepaid-quantity"
          />
        </div>
      )}

      <div>
        <label className="label-eyebrow block mb-1">{priceLabel}</label>
        <input
          className="bl-input font-mono"
          placeholder="IDR"
          value={priceValue || ""}
          readOnly={priceLocked}
          onChange={(e) => {
            if (ptype === "credit") {
              patchDraft({ prepaidValue: e.target.value });
            } else {
              patchDraft({ prepaidUnitPrice: e.target.value });
            }
          }}
          data-testid="pos-prepaid-value"
        />
        {priceLocked && catalogPrice > 0 && (
          <p className="text-xs text-[#5C6C62] mt-1">Catalog price: {fmtIDR(catalogPrice)}</p>
        )}
      </div>

      <div>
        <label className="label-eyebrow block mb-1">Expiry date (optional)</label>
        <input
          className="bl-input"
          type="date"
          value={draft.prepaidExpiry || ""}
          onChange={(e) => patchDraft({ prepaidExpiry: e.target.value })}
          data-testid="pos-prepaid-expiry"
        />
      </div>
      <input
        className="bl-input"
        placeholder="Campaign / promo source (optional)"
        value={draft.prepaidCampaignName || ""}
        onChange={(e) => patchDraft({ prepaidCampaignName: e.target.value })}
      />
      <input
        className="bl-input"
        placeholder="Notes (optional)"
        value={draft.prepaidNotes || ""}
        onChange={(e) => patchDraft({ prepaidNotes: e.target.value })}
        data-testid="pos-prepaid-notes"
      />
    </div>
  );
}
