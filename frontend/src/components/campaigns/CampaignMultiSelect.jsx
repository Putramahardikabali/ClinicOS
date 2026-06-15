import { useMemo, useState } from "react";

export default function CampaignMultiSelect({
  label,
  items,
  selectedIds,
  onChange,
  getId = (item) => item.id,
  getLabel = (item) => item.name || item.label,
  getMeta,
  categoryFilter,
  testId,
  disabled = false,
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    if (!categoryFilter) return [];
    const set = new Set(items.map((i) => categoryFilter(i)).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items, categoryFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter && category !== "all" && categoryFilter(item) !== category) return false;
      if (!q) return true;
      return getLabel(item).toLowerCase().includes(q);
    });
  }, [items, search, category, categoryFilter, getLabel]);

  const selectedSet = useMemo(() => new Set(selectedIds || []), [selectedIds]);

  const toggle = (id) => {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange((selectedIds || []).filter((x) => x !== id));
    } else {
      onChange([...(selectedIds || []), id]);
    }
  };

  const selectVisible = () => {
    if (disabled) return;
    const next = new Set(selectedIds || []);
    filtered.forEach((item) => next.add(getId(item)));
    onChange([...next]);
  };

  const clearSelected = () => {
    if (disabled) return;
    onChange([]);
  };

  const count = (selectedIds || []).length;

  return (
    <div className="rounded-xl border border-[#EAE6D7] bg-[#FDFBF7]/50 p-3 space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label-eyebrow">{label}</label>
        <span className="text-xs text-[#5C6C62]">
          {count} selected
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="bl-input text-sm flex-1 min-w-[140px]"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
        />
        {categories.length > 0 && (
          <select
            className="bl-input text-sm w-auto"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={disabled}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="bl-chip text-xs" onClick={selectVisible} disabled={disabled || !filtered.length}>
          Select all visible
        </button>
        <button type="button" className="bl-chip text-xs text-[#5C6C62]" onClick={clearSelected} disabled={disabled || !count}>
          Clear selected
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1 border border-[#EAE6D7] rounded-lg bg-white p-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[#5C6C62] py-4 text-center">No items match your search.</p>
        )}
        {filtered.map((item) => {
          const id = getId(item);
          return (
            <label
              key={id}
              className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F8F5EC] cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selectedSet.has(id)}
                onChange={() => toggle(id)}
                disabled={disabled}
              />
              <span className="min-w-0">
                <span className="text-[#2D3A33]">{getLabel(item)}</span>
                {getMeta && (
                  <span className="block text-xs text-[#5C6C62]">{getMeta(item)}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
