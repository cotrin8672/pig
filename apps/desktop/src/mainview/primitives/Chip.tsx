import type { ComponentPropsWithoutRef } from "react";
import "./chip.css";

/** Read-only metadata, not a button or a selectable filter. */
export function Chip({
  variant = "metadata",
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "className"> & {
  variant?: "metadata" | "tag" | "accent-tag";
}) {
  return (
    <span
      {...props}
      className={variant === "metadata" ? "chip ui-chip" : "provider-tag"}
      data-kind={variant === "accent-tag" ? "extension" : undefined}
    />
  );
}
