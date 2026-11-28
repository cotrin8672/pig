import type { CSSProperties } from "react";
import { clampPercent } from "../shared/provider-usage";
import "./usage-meter.css";

/** The fill shows quota; the outline recedes from the right as time runs out. */
export function UsageMeter({
  quotaPercent,
  timePercent,
  tone = "normal",
  label,
  className,
}: {
  quotaPercent: number;
  timePercent?: number;
  tone?: "normal" | "warning" | "critical";
  /** Include both values when they aren't already conveyed by the surrounding UI. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={className ? `usage-meter ${className}` : "usage-meter"}
      data-tone={tone}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={
        {
          "--usage-quota": `${clampPercent(quotaPercent)}%`,
          "--usage-time": `${clampPercent(timePercent ?? 0)}%`,
        } as CSSProperties
      }
    >
      <span className="usage-meter-fill" />
      {timePercent !== undefined && <span className="usage-meter-frame" />}
    </span>
  );
}
