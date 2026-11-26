import { useLayoutEffect, useRef, useState } from "react";
import { type PaneDivider, type PaneNode, resizePane } from "./pane-layout";
import { frameTask } from "./thread-scroll";

type DividerDrag = {
  pointerId: number;
  start: number;
  latest?: number;
  pixels: number;
  tree: PaneNode;
  frame: ReturnType<typeof frameTask>;
};

export function ResizeDivider({
  divider,
  tree,
  onPreview,
  onChange,
}: {
  divider: PaneDivider;
  tree: PaneNode;
  onPreview?(tree: PaneNode, from: PaneNode): void;
  onChange(tree: PaneNode, from?: PaneNode): void;
}) {
  const { axis, bounds, position, path, index } = divider;
  const rows = axis === "rows";
  const drag = useRef<DividerDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => () => drag.current?.frame.dispose(), []);
  function extent(element: HTMLElement) {
    const rect = element.parentElement?.getBoundingClientRect();
    return rect
      ? rows
        ? rect.height * bounds.height
        : rect.width * bounds.width
      : 0;
  }
  const resize = (current: DividerDrag, at: number) =>
    resizePane(
      current.tree,
      path,
      index,
      (at - current.start) / current.pixels,
      current.pixels,
    );
  const finish = (pointerId: number, at?: number) => {
    const current = drag.current;
    if (current?.pointerId !== pointerId) return;
    current.frame.dispose();
    drag.current = null;
    setDragging(false);
    const latest = at ?? current.latest;
    if (
      latest !== undefined &&
      (current.latest !== undefined || latest !== current.start)
    )
      onChange(resize(current, latest), current.tree);
  };
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
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        const pixels = extent(event.currentTarget);
        if (!pixels) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = {
          pointerId: event.pointerId,
          start: rows ? event.clientY : event.clientX,
          pixels,
          tree,
          frame: frameTask(() => {
            const current = drag.current;
            if (current?.latest === undefined) return;
            const next = resize(current, current.latest);
            if (onPreview) onPreview(next, current.tree);
            else onChange(next);
          }),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId !== event.pointerId) return;
        const latest = rows ? event.clientY : event.clientX;
        if (latest === current.latest) return;
        current.latest = latest;
        current.frame.schedule();
      }}
      onPointerUp={(event) =>
        finish(event.pointerId, rows ? event.clientY : event.clientX)
      }
      onLostPointerCapture={(event) => finish(event.pointerId)}
      onPointerCancel={(event) => finish(event.pointerId)}
      onKeyDown={(event) => {
        const direction = rows
          ? ["ArrowUp", "ArrowDown"]
          : ["ArrowLeft", "ArrowRight"];
        const pixels = extent(event.currentTarget);
        if (!direction.includes(event.key) || !pixels || drag.current) return;
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
