import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * One hover popover per chart (docs/ui-guidelines.md「ツールチップ」): moving
 * between targets keeps it open, glides it to the new target and cross-fades
 * only the content. Render the panel with `ui-tooltip ui-tooltip-follow` and
 * its content in `<div key={String(active)} className="ui-tooltip-swap">`.
 * A short close delay lets the pointer cross gaps and into the panel; Escape,
 * scrolling and resizing close it.
 */
export function useFollowTip<K extends string | number>(
  side: "top" | "bottom",
) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<() => DOMRect>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [active, setActive] = useState<K | null>(null);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setActive(null);
  }, []);
  const keep = useCallback(() => clearTimeout(timer.current), []);
  const leave = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(close, 150);
  }, [close]);
  /** `target` is read at layout time, so it may describe a point (a slice). */
  const open = useCallback((key: K, target: () => DOMRect) => {
    clearTimeout(timer.current);
    anchor.current = target;
    setActive(key);
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", dismiss);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [close]);
  useLayoutEffect(() => {
    const popup = panel.current;
    const target = anchor.current;
    if (active === null || !popup || !target) return;
    if (!popup.matches(":popover-open")) popup.showPopover();
    const box = target();
    // Both chart anchors are points: the column's top centre or a slice midpoint.
    const point = new DOMRect(box.left + box.width / 2, box.top);
    let current = true;
    void computePosition({ getBoundingClientRect: () => point }, popup, {
      strategy: "fixed",
      placement: side,
      middleware: [
        offset(8),
        side === "top" && flip({ padding: 8 }),
        shift({ padding: 8, crossAxis: true }),
      ],
    }).then(({ x, y, placement }) => {
      if (!current) return;
      popup.style.left = `${x}px`;
      popup.style.top = `${y}px`;
      popup.dataset.side = placement;
    });
    return () => {
      current = false;
    };
  }, [active, side]);
  return {
    active,
    open,
    leave,
    close,
    describedBy: (key: K) => (active === key ? id : undefined),
    panelProps: {
      ref: panel,
      id,
      role: "tooltip",
      popover: "manual" as const,
      onPointerEnter: keep,
      onPointerLeave: leave,
    },
  };
}
