import {
  defaultRangeExtractor,
  observeElementOffset,
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  Fragment,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ThreadView } from "./thread-scroll";

export function VirtualTurns({
  keys,
  renderRow,
  thread,
  target,
  follow,
  inlineLimit = 0,
}: {
  keys: string[];
  renderRow: (index: number) => ReactElement;
  thread: RefObject<HTMLElement | null>;
  target?: string;
  follow?: Pick<ThreadView, "follow" | "reading">;
  inlineLimit?: number;
}) {
  // Keep row keys, measurements and selected text when a live chat reaches the limit.
  const [wasVirtual, setVirtual] = useState(keys.length > inlineLimit);
  const startedVirtual = useRef(wasVirtual);
  const virtual = wasVirtual || keys.length > inlineLimit;
  if (virtual && !wasVirtual) setVirtual(true);
  const [selection, pin] = useState<{ anchor: string; focus: string }>();
  const [extending, setExtending] = useState(false);
  const key = useCallback((index: number) => keys[index], [keys]);
  const anchor = selection ? keys.indexOf(selection.anchor) : -1;
  const focus = selection ? keys.indexOf(selection.focus) : -1;
  // The parent attaches its thread ref after children's layout effects on mount.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setScrollElement(thread.current);
  }, [thread]);
  const list = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollElement,
    observeElementOffset(instance, notify) {
      // Inline rows may already have restored their native viewport before we attach.
      if (instance.scrollElement)
        notify(instance.scrollElement.scrollTop, false);
      return observeElementOffset(instance, notify);
    },
    // Rounding every wrapped row accumulates enough error to drop tail following.
    measureElement: (row, entry) =>
      entry?.borderBoxSize[0]?.blockSize ?? row.getBoundingClientRect().height,
    estimateSize: () => 160,
    getItemKey: key,
    overscan: 5,
    anchorTo: virtual ? "end" : "start",
    followOnAppend: virtual,
    rangeExtractor(range) {
      const visible = defaultRangeExtractor(range);
      if (anchor < 0) return visible;
      const first = Math.min(
        anchor,
        focus < 0 ? anchor : focus,
        extending ? visible[0] : anchor,
      );
      const last = Math.max(
        anchor,
        focus,
        extending ? visible[visible.length - 1] : anchor,
      );
      const result: number[] = [];
      for (let i = first; i <= last && i < visible[0]; i++) result.push(i);
      result.push(...visible);
      for (
        let i = Math.max(first, visible[visible.length - 1] + 1);
        i <= last;
        i++
      )
        result.push(i);
      return result;
    },
  });
  list.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    virtual && item.end <= (instance.scrollOffset ?? 0);
  useLayoutEffect(() => {
    if (!scrollElement || !virtual) return;
    const old = scrollElement.style.overflowAnchor;
    scrollElement.style.overflowAnchor = "none";
    return () => {
      scrollElement.style.overflowAnchor = old;
    };
  }, [scrollElement, virtual]);
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const saved = startedVirtual.current && follow?.reading;
    let frame = 0;
    if (startedVirtual.current && follow?.follow) list.scrollToEnd();
    else if (saved) {
      let index = 0;
      while (
        index < list.options.count &&
        String(list.options.getItemKey(index)) !== saved.key
      )
        index++;
      if (index < list.options.count) {
        list.scrollToIndex(index, { align: "start" });
        frame = requestAnimationFrame(() => {
          const pos = list.getOffsetForIndex(index, "start");
          if (pos) list.scrollToOffset(pos[0] + saved.offset);
        });
      }
    }
    const remember = () => {
      if (!follow) return;
      const item = list.getVirtualItemForOffset(scrollElement.scrollTop);
      if (item)
        follow.reading = {
          key: String(item.key),
          offset: scrollElement.scrollTop - item.start,
        };
    };
    scrollElement.addEventListener("scroll", remember);
    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", remember);
    };
    // Restore on attachment only, not on every streamed update.
  }, [scrollElement, list, follow]);
  const targetIndex = target ? keys.indexOf(target) : -1;
  useLayoutEffect(() => {
    if (virtual && targetIndex >= 0 && scrollElement)
      list.scrollToIndex(targetIndex, { align: "center" });
  }, [targetIndex, list, scrollElement, virtual]);
  useEffect(() => {
    const root = thread.current;
    if (!root) return;
    let dragging = false;
    const row = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      return root.contains(el ?? null)
        ? el?.closest<HTMLElement>("[data-turn-key]")?.dataset.turnKey
        : undefined;
    };
    const sync = () => {
      const s = document.getSelection();
      if (!s || s.isCollapsed) {
        if (!dragging) pin(undefined);
        return;
      }
      const a = row(s.anchorNode),
        f = row(s.focusNode);
      if (a && f)
        pin((p) =>
          p?.anchor === a && p.focus === f ? p : { anchor: a, focus: f },
        );
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const a = row(e.target as Node);
      if (a) {
        dragging = true;
        setExtending(true);
        pin({ anchor: a, focus: a });
      }
    };
    const up = () => {
      dragging = false;
      setExtending(false);
      sync();
    };
    root.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("selectionchange", sync);
    return () => {
      root.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("selectionchange", sync);
    };
  }, [thread]);
  const items = virtual
    ? list.getVirtualItems()
    : keys.map((key, index) => ({ key, index, start: 0, end: 0 }));
  return (
    <div data-virtual-turns={virtual ? "" : undefined}>
      <div aria-hidden style={{ height: items[0]?.start ?? 0 }} />
      {items.map(({ index, key, start }, n) => (
        <Fragment key={key}>
          {n > 0 && items[n - 1].index + 1 !== index && (
            <div aria-hidden style={{ height: start - items[n - 1].end }} />
          )}
          <div
            data-index={index}
            data-turn-key={String(key)}
            ref={list.measureElement}
            style={{ display: "flow-root" }}
          >
            {renderRow(index)}
          </div>
        </Fragment>
      ))}
      {virtual && (
        <div
          aria-hidden
          style={{ height: list.getTotalSize() - (items.at(-1)?.end ?? 0) }}
        />
      )}
    </div>
  );
}
