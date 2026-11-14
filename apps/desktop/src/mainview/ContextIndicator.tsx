import { contextSummary } from "../shared/context";
import type { ContextUsage } from "../shared/rpc-schema";
import { useStore } from "./store";

export function ContextIndicator({ usage }: { usage?: ContextUsage | null }) {
  const { contextDisplay, language } = useStore((s) => s.settings);
  const summary = contextSummary(usage, contextDisplay, language);
  const percent = summary.percent ?? (contextDisplay === "used" ? 0 : 100);
  const title = summary.title;
  return (
    <span
      className="context-indicator"
      role="img"
      aria-label={title}
      title={title}
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
