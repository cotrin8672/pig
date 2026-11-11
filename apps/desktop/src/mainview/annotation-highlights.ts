import { useEffect, useRef } from "react";

// DOM ranges are transient UI state, never part of the saved draft or agent prompt.
const ranges = new Map<string, Range>();
const bound = new Map<string, Range>();
const saved = "pig-annotation-saved";
const active = "pig-annotation-active";
const supported = () => typeof CSS !== "undefined" && "highlights" in CSS;

export function rememberAnnotationRange(id: string, range: Range) {
  if (supported()) ranges.set(id, range.cloneRange());
}

function paint() {
  if (!supported()) return;
  const connected = [...bound.values()].filter(
    (range) => range.startContainer.isConnected && !range.collapsed,
  );
  if (connected.length) CSS.highlights.set(saved, new Highlight(...connected));
  else CSS.highlights.delete(saved);
}

/** Bind a draft card to its exact source selection, without wrapping Markdown DOM. */
export function useAnnotationHighlight(id: string) {
  const card = useRef<HTMLLIElement>(null);
  const range = ranges.get(id);
  useEffect(() => {
    const element = card.current;
    if (!range || !element || !supported()) return;
    ranges.set(id, range);
    bound.set(id, range);
    paint();
    const emphasize = () => {
      if (!range.startContainer.isConnected || range.collapsed) return;
      const highlight = new Highlight(range);
      highlight.priority = 1;
      CSS.highlights.set(active, highlight);
    };
    const soften = () => {
      // Another card may already have taken focus.
      if (CSS.highlights.get(active)?.has(range)) CSS.highlights.delete(active);
    };
    const clickSource = (event: MouseEvent) => {
      if (
        !range.startContainer.isConnected ||
        range.collapsed ||
        !document.getSelection()?.isCollapsed ||
        !(event.target instanceof Element) ||
        event.target.closest("a, button, input, textarea, summary") ||
        !event.target.closest("article.message.assistant")
      )
        return;
      const hit = [...range.getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      );
      if (!hit) return;
      element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      element.focus({ preventScroll: true });
    };
    element.addEventListener("mouseenter", emphasize);
    element.addEventListener("mouseleave", soften);
    element.addEventListener("focusin", emphasize);
    element.addEventListener("focusout", soften);
    document.addEventListener("click", clickSource);
    return () => {
      element.removeEventListener("mouseenter", emphasize);
      element.removeEventListener("mouseleave", soften);
      element.removeEventListener("focusin", emphasize);
      element.removeEventListener("focusout", soften);
      document.removeEventListener("click", clickSource);
      soften();
      ranges.delete(id);
      bound.delete(id);
      paint();
    };
  }, [id, range]);
  return card;
}
