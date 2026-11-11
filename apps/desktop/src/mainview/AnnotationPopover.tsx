import { MessageSquareQuote } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";

const highlightName = "pig-annotation";
const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS;

/** The selection must stay inside one agent response to become an annotation. */
function responseSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const owner = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest(
      "article.message.assistant",
    );
  const article = owner(range.startContainer);
  const quote = selection.toString().trim();
  if (!article || article !== owner(range.endContainer) || !quote) return;
  return { range: range.cloneRange(), quote };
}

type Target = { range: Range; quote: string; rect: DOMRect };
const measure = (range: Range) => {
  const rects = range.getClientRects();
  // Anchor on the first selected line, where the eye starts reading.
  return rects.length ? rects[0] : range.getBoundingClientRect();
};
const gap = 10;
const margin = 8;

/** Select text in an agent response, then attach a comment on it. */
export function AnnotationPopover({
  onAdd,
}: {
  onAdd(annotation: { quote: string; comment: string }, range: Range): void;
}) {
  const t = useT();
  const [target, setTarget] = useState<Target>();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const editingRef = useRef(false);
  editingRef.current = editing;
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const next = { width: element.offsetWidth, height: element.offsetHeight };
    if (next.width !== size.width || next.height !== size.height) setSize(next);
  });

  useEffect(() => {
    const update = () => {
      if (editingRef.current) return;
      const found = responseSelection();
      setTarget(found && { ...found, rect: measure(found.range) });
    };
    // Follow the anchor when the thread scrolls or the window resizes.
    const reposition = () =>
      setTarget(
        (current) =>
          current && {
            ...current,
            rect: measure(current.range),
          },
      );
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  // Focusing the comment field drops the native selection; paint the range instead.
  useEffect(() => {
    if (!supportsHighlights || !editing || !target) return;
    CSS.highlights.set(highlightName, new Highlight(target.range));
    return () => {
      CSS.highlights.delete(highlightName);
    };
  }, [editing, target]);

  useEffect(() => {
    if (!editing) return;
    const close = (event: PointerEvent) => {
      if ((event.target as Element).closest?.(".annotation-popover")) return;
      setEditing(false);
      setComment("");
      setTarget(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [editing]);

  function cancel() {
    setEditing(false);
    setComment("");
    setTarget(undefined);
  }
  function add() {
    if (!target) return;
    const { quote, range } = target;
    const text = comment.trim();
    cancel();
    document.getSelection()?.removeAllRanges();
    onAdd({ quote, comment: text }, range);
  }

  if (!target) return null;
  const { rect } = target;
  // Sit above the selection, like a speech bubble; flip below only when it would clip.
  const above = rect.top - gap - size.height >= margin;
  const center = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(margin, center - size.width / 2),
    window.innerWidth - size.width - margin,
  );
  const style: CSSProperties & Record<"--tail-x", string> = {
    left,
    ...(above
      ? { bottom: window.innerHeight - rect.top + gap }
      : { top: rect.bottom + gap }),
    "--tail-x": `${Math.min(Math.max(16, center - left), size.width - 16)}px`,
  };
  // Portaled: a filtered/transformed ancestor would otherwise re-anchor position: fixed.
  return createPortal(
    <div
      ref={panel}
      className="annotation-popover"
      data-editing={editing || undefined}
      data-side={above ? "above" : "below"}
      style={style}
    >
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the popover exists only to take this comment.
            autoFocus
            aria-label={t.Comment}
            placeholder={t["Comment on this passage…"]}
            value={comment}
            rows={3}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              } else if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                add();
              }
            }}
          />
          <div className="annotation-popover-actions">
            <button type="button" onClick={cancel}>
              {t.Cancel}
            </button>
            <button type="submit" className="primary">
              {t["Add comment"]}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          // Keep the selection alive until the click lands.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setEditing(true)}
        >
          <MessageSquareQuote size={16} aria-hidden />
          {t.Annotate}
        </button>
      )}
    </div>,
    document.body,
  );
}
