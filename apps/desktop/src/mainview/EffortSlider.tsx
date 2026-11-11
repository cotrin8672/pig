import { Brain } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { effortLabels } from "../shared/effort";
import type { Effort } from "../shared/rpc-schema";
import { useT } from "./i18n";

// Drag/keyboard effort slider; commits only on release so drags don't spam saves.
export function EffortSlider({
  levels,
  value,
  disabled,
  onCommit,
}: {
  levels: readonly Effort[];
  value: Effort;
  disabled?: boolean;
  onCommit: (level: Effort) => Promise<unknown>;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [dragging, setDragging] = useState(false);
  const revision = useRef(0);
  const confirmed = useRef(value);
  confirmed.current = value;
  useEffect(() => setDraft(value), [value]);
  if (levels.length < 2) return null;
  const index = Math.max(0, levels.indexOf(draft));
  const progress = index / (levels.length - 1);
  function commit(level: Effort) {
    if (disabled || level === value) return;
    // On failure the parent keeps the old value; restore the thumb to it.
    const current = ++revision.current;
    void onCommit(level).catch(() => {
      if (revision.current === current) setDraft(confirmed.current);
    });
  }
  return (
    <div className="model-reasoning">
      <label htmlFor={id} title={t["Reasoning effort"]}>
        <Brain size={12} aria-hidden="true" />
        <span className="sr-only">{t["Reasoning effort"]}</span>
      </label>
      <div
        className="effort-slider"
        data-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
        style={
          {
            "--effort-position": `calc(${progress * 100}% + ${7 - progress * 14}px)`,
          } as React.CSSProperties
        }
      >
        <div className="effort-track" aria-hidden="true">
          <span className="effort-fill" />
        </div>
        <span className="effort-thumb" aria-hidden="true" />
        <div className="effort-ticks" aria-hidden="true">
          {levels.map((level, stop) => (
            <span
              key={level}
              title={effortLabels[level]}
              style={{ left: `${(stop / (levels.length - 1)) * 100}%` }}
              data-filled={stop <= index}
            />
          ))}
        </div>
        <input
          id={id}
          className="effort-range"
          type="range"
          min={0}
          max={levels.length - 1}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={t["Reasoning effort"]}
          aria-valuetext={effortLabels[draft]}
          title={effortLabels[draft]}
          onChange={(event) => setDraft(levels[Number(event.target.value)])}
          onPointerDown={(event) => {
            if (event.button === 0) {
              setDragging(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerUp={(event) => {
            setDragging(false);
            commit(levels[Number(event.currentTarget.value)]);
          }}
          onLostPointerCapture={() => setDragging(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
            }
            if (event.key !== "Escape") event.stopPropagation();
          }}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              commit(levels[Number(event.currentTarget.value)]);
          }}
          onPointerCancel={() => {
            setDragging(false);
            setDraft(value);
          }}
        />
      </div>
      <output className="effort-value" htmlFor={id}>
        {effortLabels[draft]}
      </output>
    </div>
  );
}
