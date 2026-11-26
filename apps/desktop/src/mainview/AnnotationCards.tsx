import { Quote, X } from "lucide-react";
import { useState } from "react";
import type { DraftAnnotation } from "../shared/annotations";
import { useAnnotationHighlight } from "./annotation-highlights";
import { useT } from "./i18n";
import { clipTooltipText, useTooltip } from "./Tooltip";

type Card = Omit<DraftAnnotation, "id">;

function DraftChip({
  id,
  quote,
  comment,
  onRemove,
}: DraftAnnotation & { onRemove(id: string): void }) {
  const t = useT();
  const ref = useAnnotationHighlight(id);
  const tip = useTooltip();
  const summary = clipTooltipText(quote, 48);
  return (
    <li
      className="composer-annotation"
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can preview the quote and see its source highlight.
      tabIndex={0}
      {...tip(() => ({
        tier: "detail",
        side: "top",
        label: clipTooltipText(quote, 400),
        description: comment ? clipTooltipText(comment, 300) : undefined,
      }))}
    >
      <Quote size={13} aria-hidden="true" />
      <span className="composer-annotation-label">{summary}</span>
      <button
        type="button"
        className="annotation-remove"
        aria-label={`${t["Remove comment"]}: ${summary}`}
        onClick={() => onRemove(id)}
      >
        <X size={14} />
      </button>
    </li>
  );
}

/** A sent annotation: the quoted passage and its comment, clamped until clicked. */
export function AnnotationCard({ quote, comment }: Card) {
  const [open, setOpen] = useState(false);
  return (
    <li className="annotation-card">
      <button
        type="button"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen(!open)}
      >
        <blockquote>{quote}</blockquote>
        {comment && <p>{comment}</p>}
      </button>
    </li>
  );
}

/** Unsent quotes above the editor, each removable before sending. */
export function AnnotationDrafts({
  annotations,
  onRemove,
}: {
  annotations: DraftAnnotation[];
  onRemove(id: string): void;
}) {
  if (!annotations.length) return null;
  return (
    <ul className="composer-annotations">
      {annotations.map((annotation) => (
        <DraftChip key={annotation.id} {...annotation} onRemove={onRemove} />
      ))}
    </ul>
  );
}
