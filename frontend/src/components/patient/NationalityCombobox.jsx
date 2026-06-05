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
import { NATIONALITIES, findNationalityByCode, nationalitySearchText } from "@/lib/nationalities";

export default function NationalityCombobox({
  value = "",
  onChange,
  placeholder = "Search nationality…",
  allowClear = true,
  disabled = false,
  className = "",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => findNationalityByCode(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NATIONALITIES;
    return NATIONALITIES.filter((c) => nationalitySearchText(c).includes(q));
  }, [query]);

  const handleSelect = (country) => {
    if (!country) return;
    onChange(country.code, country);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange("", null);
    setQuery("");
  };

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
          <span className="min-w-0 flex-1 text-sm truncate text-[#2D3A33]">
            {selected ? selected.name : placeholder}
          </span>
          <span className="inline-flex items-center gap-0.5 shrink-0 text-[#5C6C62]">
            {allowClear && value && (
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
                aria-label="Clear nationality"
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
            placeholder="Type to search, e.g. Aus for Australia…"
            value={query}
            onValueChange={setQuery}
            className="h-10"
          />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="py-4 text-xs text-[#5C6C62]">
              {query.trim() ? "No matching nationalities." : "No nationalities found."}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((c) => {
                const isSelected = value === c.code;
                return (
                  <CommandItem
                    key={c.code}
                    value={c.code}
                    onSelect={() => handleSelect(c)}
                    className="flex items-center gap-2 py-2.5 cursor-pointer"
                    data-testid={testId ? `${testId}-option-${c.code}` : undefined}
                  >
                    <Check
                      className={cn("w-4 h-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="text-sm text-[#2D3A33]">{c.name}</span>
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
