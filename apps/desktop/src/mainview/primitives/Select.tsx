import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithRef } from "react";
import "./select.css";

/** `className` sizes and places the field; the chevron replaces the native icon. */
export function Select({
  className,
  ...props
}: ComponentPropsWithRef<"select">) {
  return (
    <div className={className ? `ui-select ${className}` : "ui-select"}>
      <select {...props} />
      <ChevronDown size={14} aria-hidden="true" />
    </div>
  );
}
