import { useEffect, useState } from "react";
import "./snappy-motion.css";

/** One SVG for both states: the arc keeps its angle, closes into a ring, then
 * the check is drawn inside it. */
export function SpinnerCheck({ done }: { done: boolean }) {
  // Keep spinning while the ring closes (a full ring's rotation is invisible), then
  // stop: freezing mid-turn is what made the arc stutter.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!done) return;
    const id = setTimeout(() => setSettled(true), 200);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <svg
      className="snappy-spin-check"
      data-done={done || undefined}
      data-settled={settled || undefined}
      viewBox="0 0 16 16"
      width={16}
      height={16}
      role="img"
      aria-label={done ? "完了" : "処理中"}
    >
      <circle
        className="snappy-spin-arc"
        cx="8"
        cy="8"
        r="6.5"
        pathLength="100"
      />
      <path
        className="snappy-spin-tick"
        d="M5 8.2 7.1 10.3 11 6.1"
        pathLength="100"
      />
    </svg>
  );
}
