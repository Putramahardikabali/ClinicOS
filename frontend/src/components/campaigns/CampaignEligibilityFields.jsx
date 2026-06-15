import CampaignMultiSelect from "@/components/campaigns/CampaignMultiSelect";
import { APPLIES_TO_OPTIONS } from "@/lib/campaignUi";

export default function CampaignEligibilityFields({
  form,
  setForm,
  treatments,
  packages,
  categoryCounts,
  readOnly = false,
}) {
  const applies = form.applies_to;

  return (
    <div className="space-y-3">
      <div>
        <label className="label-eyebrow block mb-1.5">Applies to</label>
        <select
          className="bl-input"
          value={form.applies_to}
          onChange={(e) => setForm({ ...form, applies_to: e.target.value })}
          disabled={readOnly}
          data-testid="campaign-applies-to"
        >
          {APPLIES_TO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {applies === "selected_treatments" && (
        <CampaignMultiSelect
          label="Select treatments"
          items={treatments}
          selectedIds={form.eligible_treatment_ids}
          onChange={(ids) => setForm({ ...form, eligible_treatment_ids: ids })}
          getId={(t) => t.id}
          getLabel={(t) => t.name}
          getMeta={(t) => t.category || undefined}
          categoryFilter={(t) => t.category}
          testId="campaign-eligible-treatments"
          disabled={readOnly}
        />
      )}

      {applies === "selected_categories" && (
        <CampaignMultiSelect
          label="Select treatment categories"
          items={categoryCounts}
          selectedIds={form.eligible_treatment_category_ids}
          onChange={(ids) => setForm({ ...form, eligible_treatment_category_ids: ids })}
          getId={(c) => c.id}
          getLabel={(c) => c.name}
          getMeta={(c) => `${c.count} treatment${c.count === 1 ? "" : "s"}`}
          testId="campaign-eligible-categories"
          disabled={readOnly}
        />
      )}

      {applies === "selected_packages" && (
        <CampaignMultiSelect
          label="Select packages"
          items={packages}
          selectedIds={form.eligible_package_ids}
          onChange={(ids) => setForm({ ...form, eligible_package_ids: ids })}
          getId={(p) => p.id}
          getLabel={(p) => p.name}
          testId="campaign-eligible-packages"
          disabled={readOnly}
        />
      )}
    </div>
  );
}
