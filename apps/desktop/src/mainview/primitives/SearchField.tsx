import { Search, X } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import "./search-field.css";

/**
 * Search icon + input in one field. `field` is a standalone box; `inline` sits
 * in a popover or toolbar that already draws the frame. `className` is for
 * placement only. Extra trailing actions (filters) go in `children`.
 */
export function SearchField({
  variant = "field",
  className,
  onClear,
  clearLabel,
  children,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "className" | "children"> & {
  variant?: "field" | "inline";
  className?: string;
  children?: ReactNode;
} & (
    | { onClear?: undefined; clearLabel?: undefined }
    | { onClear: () => void; clearLabel: string }
  )) {
  return (
    <div
      className={className ? `ui-search-field ${className}` : "ui-search-field"}
      data-variant={variant}
    >
      <Search size={variant === "field" ? 16 : 14} aria-hidden="true" />
      <input {...props} />
      {onClear && props.value ? (
        <button type="button" aria-label={clearLabel} onClick={onClear}>
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
