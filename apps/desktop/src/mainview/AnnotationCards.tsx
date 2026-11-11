import { X } from "lucide-react";
import { useState } from "react";
import type { DraftAnnotation } from "../shared/annotations";
import { useAnnotationHighlight } from "./annotation-highlights";
import { useT } from "./i18n";

type Card = Omit<DraftAnnotation, "id">;

function DraftCard({
  id,
  quote,
  comment,
  onRemove,
}: DraftAnnotation & { onRemove(id: string): void }) {
  const t = useT();
  const ref = useAnnotationHighlight(id);
  return (
    <li className="annotation-card" ref={ref} tabIndex={-1}>
      <blockquote title={quote}>{quote}</blockquote>
      {comment && <p title={comment}>{comment}</p>}
      <button
        type="button"
        className="annotation-remove"
        aria-label={t["Remove comment"]}
        title={t["Remove comment"]}
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

/** Annotations waiting above the composer, each removable before sending. */
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
        <DraftCard key={annotation.id} {...annotation} onRemove={onRemove} />
      ))}
    </ul>
  );
}
