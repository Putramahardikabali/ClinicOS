import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";



/**

 * POS async search combobox — portal dropdown, outside click / Escape close.

 * Parent owns query, options, and API fetch; this handles layout and open state only.

 */

export default function PosSearchCombobox({

  value,

  onValueChange,

  options = [],

  onSelect,

  renderOption,

  getOptionKey,

  placeholder = "Search…",

  disabled = false,

  showSearchIcon = true,

  testId,

  className = "",

  inputClassName = "",

  listAriaLabel = "Search results",

  emptyMessage = "No results",

}) {

  const inputRef = useRef(null);

  const listRef = useRef(null);

  const listId = useId();

  const [open, setOpen] = useState(false);

  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });



  const updatePosition = useCallback(() => {

    const el = inputRef.current;

    if (!el) return;

    const rect = el.getBoundingClientRect();

    const gap = 4;

    const bottomPad = 24;

    const safeBottom = typeof window !== "undefined"

      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--pos-safe-bottom") || "0", 10) || 0

      : 0;

    const availableBelow = window.innerHeight - rect.bottom - gap - bottomPad - safeBottom;

    const maxHeight = Math.min(280, Math.max(120, availableBelow));

    setPos({

      top: rect.bottom + gap,

      left: rect.left,

      width: rect.width,

      maxHeight,

    });

  }, []);



  const close = useCallback(() => {

    setOpen(false);

  }, []);



  const openIfEligible = useCallback(() => {

    if (disabled) return;

    if (String(value || "").trim() && options.length > 0) {

      setOpen(true);

    }

  }, [disabled, value, options.length]);



  useEffect(() => {

    if (!String(value || "").trim() || options.length === 0) {

      setOpen(false);

    } else if (document.activeElement === inputRef.current) {

      setOpen(true);

    }

  }, [value, options.length]);



  useLayoutEffect(() => {

    if (!open) return undefined;

    updatePosition();

    window.addEventListener("resize", updatePosition);

    window.addEventListener("scroll", updatePosition, true);

    return () => {

      window.removeEventListener("resize", updatePosition);

      window.removeEventListener("scroll", updatePosition, true);

    };

  }, [open, updatePosition, options.length]);



  useEffect(() => {

    if (!open) return undefined;

    const onDocMouseDown = (e) => {

      const t = e.target;

      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;

      close();

    };

    const onKeyDown = (e) => {

      if (e.key === "Escape") {

        close();

        inputRef.current?.blur();

      }

    };

    document.addEventListener("mousedown", onDocMouseDown);

    document.addEventListener("keydown", onKeyDown);

    return () => {

      document.removeEventListener("mousedown", onDocMouseDown);

      document.removeEventListener("keydown", onKeyDown);

    };

  }, [open, close]);



  const handleSelect = (option) => {

    onSelect(option);

    close();

    inputRef.current?.blur();

  };



  const showList = open && !disabled && String(value || "").trim() && options.length > 0;



  const dropdown = showList

    ? createPortal(

        <div

          ref={listRef}

          id={listId}

          role="listbox"

          aria-label={listAriaLabel}

          className="fixed z-[200] rounded-xl border border-[#EAE6D7] bg-white shadow-lg overflow-y-auto overscroll-contain"

          style={{

            top: pos.top,

            left: pos.left,

            width: pos.width,

            maxHeight: pos.maxHeight,

          }}

          data-testid={testId ? `${testId}-list` : undefined}

        >

          {options.map((opt) => (

            <button

              key={getOptionKey(opt)}

              type="button"

              role="option"

              className="w-full text-left px-4 py-3 hover:bg-[#F8F5EC] active:bg-[#EDF3EF] border-b border-[#EAE6D7] last:border-0 min-h-[44px] touch-manipulation"

              onMouseDown={(e) => e.preventDefault()}

              onClick={() => handleSelect(opt)}

              data-testid={testId ? `${testId}-option-${getOptionKey(opt)}` : undefined}

            >

              {renderOption(opt)}

            </button>

          ))}

        </div>,

        document.body,

      )

    : null;



  return (

    <div className={cn("relative w-full", className)}>

      {showSearchIcon && (

        <Search

          className="bl-search-icon"

          aria-hidden

        />

      )}

      <input

        ref={inputRef}

        type="text"

        role="combobox"

        aria-expanded={showList}

        aria-controls={showList ? listId : undefined}

        aria-autocomplete="list"

        disabled={disabled}

        className={cn(

          "bl-input w-full",

          showSearchIcon && "bl-input--with-search-icon pr-3",

          inputClassName,

        )}

        placeholder={placeholder}

        value={value}

        onChange={(e) => {

          const next = e.target.value;

          onValueChange(next);

          if (!next.trim()) close();

          else if (options.length > 0) setOpen(true);

        }}

        onFocus={() => openIfEligible()}

        onBlur={() => {

          if (!String(value || "").trim()) close();

        }}

        data-testid={testId}

      />

      {dropdown}

      {open && !disabled && String(value || "").trim() && options.length === 0 && (

        <p className="mt-1 text-xs text-[#5C6C62] px-1">{emptyMessage}</p>

      )}

    </div>

  );

}

