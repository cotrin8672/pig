import { type CSSProperties, useRef, useState } from "react";
import { clampSidebarWidth, SIDEBAR_WIDTH } from "../shared/desktop-state";
import { useT } from "./i18n";

/** Dragging this far below the minimum width collapses the sidebar. */
export const SIDEBAR_COLLAPSE_AT = SIDEBAR_WIDTH.min - 64;

/** Pane-style divider between the sidebar and the content area. */
export function SidebarResizer({
  width,
  onResize,
  onCommit,
  onCollapse,
  style,
}: {
  width: number;
  style?: CSSProperties;
  /** Live width while dragging; not persisted. */
  onResize(width: number): void;
  onCommit(width: number): void;
  onCollapse(): void;
}) {
  const t = useT();
  const drag = useRef<{ start: number; width: number; last: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const end = () => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    // Keep the last usable width, so reopening never starts at the minimum.
    if (current.last < SIDEBAR_COLLAPSE_AT) {
      onResize(current.width);
      onCollapse();
    } else onCommit(clampSidebarWidth(current.last));
  };
  return (
    <hr
      className="sidebar-resizer electrobun-webkit-app-region-no-drag"
      style={style}
      tabIndex={0}
      aria-label={t["Resize sidebar"]}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      data-dragging={dragging}
      data-collapsing={dragging && width <= SIDEBAR_WIDTH.min}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: event.clientX, width, last: width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        current.last = current.width + event.clientX - current.start;
        onResize(clampSidebarWidth(current.last));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onCommit(SIDEBAR_WIDTH.default)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step =
          (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 40 : 10);
        if (step < 0 && width <= SIDEBAR_WIDTH.min) onCollapse();
        else onCommit(clampSidebarWidth(width + step));
      }}
    />
  );
}
