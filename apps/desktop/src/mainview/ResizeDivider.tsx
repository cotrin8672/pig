import { useRef, useState } from "react";
import { type PaneDivider, type PaneNode, resizePane } from "./pane-layout";

export function ResizeDivider({
  divider,
  tree,
  onChange,
}: {
  divider: PaneDivider;
  tree: PaneNode;
  onChange(tree: PaneNode): void;
}) {
  const { axis, bounds, position, path, index } = divider;
  const rows = axis === "rows";
  const drag = useRef<{ start: number; pixels: number; tree: PaneNode } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  function extent(element: HTMLElement) {
    const rect = element.parentElement?.getBoundingClientRect();
    return rect
      ? rows
        ? rect.height * bounds.height
        : rect.width * bounds.width
      : 0;
  }
  return (
    <hr
      className="pane-preview-divider"
      tabIndex={0}
      aria-label={
        rows ? "上下のpaneのサイズを調整" : "左右のpaneのサイズを調整"
      }
      aria-orientation={rows ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(position * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-axis={axis}
      data-dragging={dragging}
      style={
        rows
          ? {
              left: `${bounds.x * 100}%`,
              top: `${(bounds.y + bounds.height * position) * 100}%`,
              width: `${bounds.width * 100}%`,
            }
          : {
              left: `${(bounds.x + bounds.width * position) * 100}%`,
              top: `${bounds.y * 100}%`,
              height: `${bounds.height * 100}%`,
            }
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const pixels = extent(event.currentTarget);
        if (!pixels) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = {
          start: rows ? event.clientY : event.clientX,
          pixels,
          tree,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start)
          onChange(
            resizePane(
              start.tree,
              path,
              index,
              ((rows ? event.clientY : event.clientX) - start.start) /
                start.pixels,
              start.pixels,
            ),
          );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const direction = rows
          ? ["ArrowUp", "ArrowDown"]
          : ["ArrowLeft", "ArrowRight"];
        const pixels = extent(event.currentTarget);
        if (!direction.includes(event.key) || !pixels) return;
        event.preventDefault();
        onChange(
          resizePane(
            tree,
            path,
            index,
            ((event.key === direction[0] ? -1 : 1) *
              (event.shiftKey ? 40 : 10)) /
              pixels,
            pixels,
          ),
        );
      }}
    />
  );
}
