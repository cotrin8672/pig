import type { ReactNode } from "react";
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
  return (
    <fieldset
      {...name}
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
