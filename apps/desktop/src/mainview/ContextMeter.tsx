import type { ContextSummary } from "../shared/context";
import type { Settings } from "../shared/settings";
import { type TipContent, useTooltip } from "./Tooltip";

/** Heading + detail line when usage is known; otherwise the plain title. */
export const contextTip = ({
  title,
  heading,
  detail,
}: ContextSummary): TipContent =>
  heading && detail
    ? { tier: "detail", label: heading, description: detail }
    : { tier: "label", label: title };

export function ContextMeter({
  summary,
  mode,
  action,
}: {
  summary: ContextSummary;
  mode: Settings["contextDisplay"];
  action?: TipContent["action"];
}) {
  const percent = summary.percent ?? (mode === "used" ? 0 : 100);
  const title = summary.title;
  const tooltip = useTooltip();
  return (
    <span
      className="context-indicator"
      role="img"
      aria-label={title}
      {...tooltip({ ...contextTip(summary), action, side: "top" })}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.2"
        />
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          pathLength="100"
          opacity={percent ? 1 : 0}
          strokeDasharray={`${percent} 100`}
          strokeLinecap="round"
          transform="rotate(-90 7 7)"
        />
      </svg>
      <span aria-hidden="true">{percent}%</span>
    </span>
  );
}
