import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Text input with a left search icon (single icon, correct padding).
 * Use everywhere instead of hand-rolled icon + input pairs.
 */
export default function SearchInput({
  className,
  inputClassName,
  showIcon = true,
  useBlInput = true,
  iconClassName,
  type = "search",
  ...props
}) {
  return (
    <div className={cn("relative w-full", className)}>
      {showIcon && (
        <Search
          className={cn("bl-search-icon", iconClassName)}
          aria-hidden
        />
      )}
      <input
        type={type}
        className={cn(
          useBlInput && "bl-input w-full",
          showIcon && "bl-input--with-search-icon",
          !useBlInput && showIcon && "w-full",
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}

/** bl-card row with search input + optional trailing (loading, counts). */
export function SearchFieldBar({ className, trailing, inputClassName, ...inputProps }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <SearchInput
        className="flex-1 min-w-0"
        inputClassName={cn(
          "border-0 shadow-none focus:shadow-none",
          inputClassName,
        )}
        {...inputProps}
      />
      {trailing}
    </div>
  );
}
