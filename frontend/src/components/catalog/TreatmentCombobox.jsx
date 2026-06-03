import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function treatmentMetaLine(t) {
  if (!t) return "";
  const code = (t.service_code || t.key || "—").trim();
  const duration = Number(t.duration_min) || 0;
  const category = (t.category || "—").trim();
  return `${code} · ${duration} min · ${category}`;
}

function treatmentSearchValue(t) {
  return [t.name, t.service_code, t.key, t.category].filter(Boolean).join(" ").toLowerCase();
}

export default function TreatmentCombobox({
  value,
  onChange,
  treatments = [],
  loading = false,
  error = false,
  placeholder = "Search treatments…",
  excludeIds = [],
  allowClear = true,
  disabled = false,
  className = "",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => treatments.find((t) => t.id === value || t.key === value) || null,
    [treatments, value],
  );

  const excludeSet = useMemo(() => new Set(excludeIds.filter(Boolean)), [excludeIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return treatments;
    return treatments.filter((t) => treatmentSearchValue(t).includes(q));
  }, [treatments, query]);

  const handleSelect = (treatment) => {
    if (!treatment) return;
    if (excludeSet.has(treatment.id)) return;
    onChange(treatment.id, treatment);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange("", null);
    setQuery("");
  };

  if (loading) {
    return (
      <div className={cn("bl-input text-sm text-[#5C6C62]", className)} data-testid={testId}>
        Loading treatments…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("bl-input text-sm text-[#B14A2C]", className)} data-testid={testId}>
        Could not load treatments. Please try again.
      </div>
    );
  }

  if (!treatments.length) {
    return (
      <div className={cn("bl-input text-sm text-[#5C6C62]", className)} data-testid={testId}>
        No treatments found. Add treatments first.
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "bl-input w-full min-h-[42px] flex items-center justify-between gap-2 text-left",
            !selected && "text-[#5C6C62]",
            className,
          )}
          data-testid={testId}
        >
          <span className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block text-sm text-[#2D3A33] truncate">{selected.name}</span>
                <span className="block text-xs text-[#5C6C62] truncate">{treatmentMetaLine(selected)}</span>
              </>
            ) : (
              <span className="text-sm">{placeholder}</span>
            )}
          </span>
          <span className="inline-flex items-center gap-0.5 shrink-0 text-[#5C6C62]">
            {allowClear && value && (
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
                aria-label="Clear treatment"
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleClear(e);
                }}
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronsUpDown className="w-4 h-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[60] w-[var(--radix-popover-trigger-width)] p-0 border-[#EAE6D7] bg-white shadow-lg"
        align="start"
      >
        <Command shouldFilter={false} className="bg-white">
          <CommandInput
            placeholder="Search by name, code, or category…"
            value={query}
            onValueChange={setQuery}
            className="h-10"
          />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="py-4 text-xs text-[#5C6C62]">
              {query.trim() ? "No matching treatments." : "No treatments found."}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((t) => {
                const isSelected = value === t.id;
                const isExcluded = excludeSet.has(t.id) && !isSelected;
                return (
                  <CommandItem
                    key={t.id}
                    value={t.id}
                    disabled={isExcluded}
                    onSelect={() => handleSelect(t)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 py-2.5 cursor-pointer",
                      isExcluded && "opacity-40 cursor-not-allowed",
                    )}
                    data-testid={testId ? `${testId}-option-${t.id}` : undefined}
                  >
                    <div className="flex w-full items-start gap-2">
                      <Check
                        className={cn(
                          "w-4 h-4 mt-0.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[#2D3A33]">{t.name}</div>
                        <div className="text-xs text-[#5C6C62]">{treatmentMetaLine(t)}</div>
                        {isExcluded && (
                          <div className="text-[10px] text-[#8A9A86] mt-0.5">Already added to this package</div>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
