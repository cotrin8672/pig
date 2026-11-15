import { memo, useEffect, useRef, useState } from "react";
import { useT } from "./i18n";

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 90;
const VERB_MS = 2600;

function shuffle(list: readonly string[]) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The wait line under a live response. A braille spinner turns while the verb
 * changes every few seconds from a shuffled pool, so a long run never repeats a
 * word until every other word has had a turn. An extension that sets its own
 * working message keeps it instead.
 */
export const RunningIndicator = memo(function RunningIndicator({
  symbol,
  message,
}: {
  symbol?: string;
  message?: string;
}) {
  const t = useT();
  const [reduced] = useState(reducedMotion);
  const [frame, setFrame] = useState(0);
  const [verb, setVerb] = useState(t.workingVerbs[0]);
  const pool = useRef<string[]>([]);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setFrame((n) => (n + 1) % BRAILLE.length),
      FRAME_MS,
    );
    return () => clearInterval(timer);
  }, [reduced]);

  useEffect(() => {
    if (message) return;
    const verbs = t.workingVerbs;
    pool.current = shuffle(verbs);
    let index = 0;
    setVerb(pool.current[0]);
    const timer = setInterval(() => {
      index += 1;
      if (index >= pool.current.length) {
        pool.current = shuffle(verbs);
        index = 0;
      }
      setVerb(pool.current[index]);
    }, VERB_MS);
    return () => clearInterval(timer);
  }, [message, t.workingVerbs]);

  const text = message
    ? [symbol, message].filter(Boolean).join(" ")
    : `${verb}…`;
  return (
    <p className="muted running-line" role="status">
      <span className="running-glyph" aria-hidden="true">
        {reduced ? BRAILLE[0] : BRAILLE[frame]}
      </span>
      <span key={text} className="running-verb" aria-hidden="true">
        {text}
      </span>
      <span className="sr-status">{message ?? t["Working…"]}</span>
    </p>
  );
});
