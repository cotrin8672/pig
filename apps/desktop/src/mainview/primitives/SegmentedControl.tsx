import { type ReactNode, useLayoutEffect, useRef } from "react";
import "./segmented-control.css";

export type Segment<T> = {
  value: T;
  label: ReactNode;
  id?: string;
  disabled?: boolean;
};

/** One choice out of a few, always visible. `className` is for placement only. */
export function SegmentedControl<T extends string | boolean>({
  options,
  value,
  onChange,
  className,
  ...name
}: {
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
} & ({ "aria-label": string } | { "aria-labelledby": string })) {
  const root = useRef<HTMLFieldSetElement>(null);
  const placed = useRef(false);
  // One highlight layer slides to the pressed option instead of reappearing.
  // Only a selection change slides; the first placement and resizes jump.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the selection changes.
  useLayoutEffect(() => {
    const field = root.current;
    if (!field) return;
    const place = (slide: boolean) => {
      const on = field.querySelector<HTMLElement>('[aria-pressed="true"]');
      const x = `${on?.offsetLeft ?? 0}px`,
        w = `${on?.offsetWidth ?? 0}px`;
      const { style } = field;
      if (
        style.getPropertyValue("--segment-x") === x &&
        style.getPropertyValue("--segment-w") === w
      )
        return;
      field.toggleAttribute("data-slide", slide);
      style.setProperty("--segment-x", x);
      style.setProperty("--segment-w", w);
    };
    place(placed.current);
    placed.current = true;
    const observer = new ResizeObserver(() => place(false));
    // Options can resize alone (fonts, labels) inside a full-width field.
    for (const node of [field, ...field.children]) observer.observe(node);
    return () => observer.disconnect();
  }, [value]);
  return (
    <fieldset
      {...name}
      ref={root}
      className={
        className ? `segmented-control ${className}` : "segmented-control"
      }
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          id={option.id}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
