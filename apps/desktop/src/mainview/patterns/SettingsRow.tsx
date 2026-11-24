import type { ReactNode } from "react";
import "./settings-card.css";

/** Setting name and description on the left, its control on the right. */
export function SettingsRow({
  label,
  setting,
  className,
  children,
}: {
  label: ReactNode;
  /** Search palette target id, see settings-search.ts. */
  setting?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={className ? `settings-row ${className}` : "settings-row"}
      data-setting={setting}
    >
      <div className="settings-label">{label}</div>
      {children}
    </div>
  );
}
