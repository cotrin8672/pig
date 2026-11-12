import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "./i18n";
import { usePicker } from "./Picker";

export function FontPicker({
  label,
  value,
  fonts,
  onChange,
}: {
  label: string;
  value: string;
  fonts: string[];
  onChange: (family: string) => void;
}) {
  const t = useT();
  const { ref, close } = usePicker();
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const options = ["", ...fonts].filter((family) =>
    (family || t["System default"])
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (open)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  function select(family: string) {
    onChange(family);
    close();
  }
  return (
    <details
      className="picker font-picker"
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
      onToggle={() => {
        const isOpen = !!ref.current?.open;
        setOpen(isOpen);
        if (isOpen) {
          setQuery("");
          setActive(Math.max(0, ["", ...fonts].indexOf(value)));
          search.current?.focus();
        }
      }}
    >
      <summary
        className="picker-trigger"
        aria-label={`${label}: ${value || t["System default"]}`}
      >
        <span>{value || t["System default"]}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="picker-panel font-picker-panel">
        <div className="settings-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-label={`${label}: ${t["Search fonts"]}`}
            placeholder={t["Search fonts"]}
            aria-expanded={open}
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={
              options[active] !== undefined ? `${id}-${active}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActive((index) =>
                  Math.max(0, Math.min(options.length - 1, index + direction)),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (options[active] !== undefined) select(options[active]);
              }
            }}
          />
        </div>
        <div
          id={id}
          ref={list}
          role="listbox"
          aria-label={label}
          className="font-picker-list"
        >
          {options.map((family, index) => (
            <button
              key={family}
              id={`${id}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={family === value}
              data-active={index === active}
              onClick={() => select(family)}
            >
              <span>{family || t["System default"]}</span>
              {family === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
        {options.length === 0 && (
          <p className="settings-empty" role="status">
            {t["No matching fonts"]}
          </p>
        )}
      </div>
    </details>
  );
}
