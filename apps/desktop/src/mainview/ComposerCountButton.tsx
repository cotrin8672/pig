import type { LucideIcon } from "lucide-react";
import type { ComponentPropsWithRef } from "react";
import "./primitives/button.css";
import "./composer-count-button.css";

export function ComposerCountButton({
  icon: Icon,
  count,
  warning,
  live,
  ...button
}: Omit<ComponentPropsWithRef<"button">, "children" | "className" | "type"> & {
  icon: LucideIcon;
  count: number | string;
  "aria-label": string;
  warning?: boolean;
  live?: boolean;
}) {
  return (
    <button
      {...button}
      className="session-indicator"
      type="button"
      data-warning={warning}
      data-live={live}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{count}</span>
    </button>
  );
}
