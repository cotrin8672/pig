import { memo } from "react";
import { useT } from "./i18n";
import { TURN_SPINNERS, TurnSpinner } from "./primitives/TurnSpinner";

const variants = Object.keys(TURN_SPINNERS) as (keyof typeof TURN_SPINNERS)[];
const seed = Math.floor(Math.random() * 0x100000000);

// A remount (e.g. after compaction) must not reroll the current turn.
function variantFor(turnKey: string) {
  let hash = seed;
  for (let i = 0; i < turnKey.length; i++)
    hash = Math.imul(hash ^ turnKey.charCodeAt(i), 16777619);
  return variants[(hash >>> 0) % variants.length];
}

export const RunningIndicator = memo(function RunningIndicator({
  symbol,
  message,
  turnKey = "",
}: {
  symbol?: string;
  message?: string;
  turnKey?: string;
}) {
  const t = useT();
  return (
    <p className="muted running" role="status">
      {symbol || <TurnSpinner variant={variantFor(turnKey)} />}
      <span>{message ?? t["Working…"]}</span>
    </p>
  );
});
