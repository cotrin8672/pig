import type { ComponentPropsWithoutRef } from "react";
import "./settings-card.css";

/** Groups related settings rows on one translucent card. */
export function SettingsCard({
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      {...props}
      className={className ? `settings-card ${className}` : "settings-card"}
    />
  );
}
