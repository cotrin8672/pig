import { Check } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "../primitives/button.css";
import "./picker-option.css";

export function PickerOption({
  label,
  icon,
  detail,
  selected,
  highlighted,
  ...button
}: Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "className" | "type" | "role" | "aria-selected"
> & {
  label: ReactNode;
  icon?: ReactNode;
  detail?: ReactNode;
  selected: boolean;
  highlighted?: boolean;
}) {
  return (
    <button
      {...button}
      type="button"
      role="option"
      className="model-option"
      aria-selected={selected}
      data-highlighted={highlighted || undefined}
    >
      {icon}
      <span className="model-option-name">{label}</span>
      {detail && <span className="model-capabilities">{detail}</span>}
      <span className="model-selected-mark" aria-hidden="true">
        {selected && <Check size={13} />}
      </span>
    </button>
  );
}
