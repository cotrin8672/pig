import { effortLabels } from "../shared/effort";
import type { Effort } from "../shared/rpc-schema";

/** Keep the widest supported label's width when the selected effort changes. */
export function EffortChip({
  levels,
  effort,
}: {
  levels: readonly Effort[];
  effort: Effort;
}) {
  if (levels.length < 2) return null;
  return (
    <span className="picker-effort-label">
      {levels.map((level) => (
        <span
          key={level}
          data-active={level === effort || undefined}
          aria-hidden={level !== effort || undefined}
        >
          {effortLabels[level]}
        </span>
      ))}
    </span>
  );
}
