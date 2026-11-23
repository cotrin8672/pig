import { GripVertical } from "lucide-react";
import { type PointerEvent, type RefObject, useEffect, useState } from "react";
import { useT } from "./i18n";
import {
  movePane,
  type PaneDropSide,
  type PaneNode,
  type PaneRect,
  paneDropAt,
  paneGeometry,
} from "./pane-layout";
import { Keycap } from "./primitives/Keycap";

export type PaneDrag = {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  /** Pointer in workspace pixels, for the ghost. */
  x: number;
  y: number;
  active: boolean;
  drop?: { target: number; side: PaneDropSide };
};
export type PaneLabel = { project: string; title: string };

export const paneRect = (bounds: PaneRect) => ({
  left: `${bounds.x * 100}%`,
  top: `${bounds.y * 100}%`,
  width: `${bounds.width * 100}%`,
  height: `${bounds.height * 100}%`,
});

/** Drag a pane by its winbar; dropping hands the move to `onDrop`. Escape cancels. */
export function usePaneDrag(
  tree: PaneNode,
  workspace: RefObject<HTMLElement | null>,
  onDrop: (id: number, target: number, side: PaneDropSide) => void,
) {
  const [drag, setDrag] = useState<PaneDrag | null>(null);
  const dragging = drag?.active ? drag : null;

  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);

  function track(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const box = workspace.current?.getBoundingClientRect();
    if (!box) return;
    if (
      !drag.active &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4
    )
      return;
    const drop = paneDropAt(
      tree,
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
    );
    setDrag({
      ...drag,
      active: true,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      drop: drop && drop.target !== drag.id ? drop : undefined,
    });
  }

  const winbarProps = (id: number, enabled: boolean) =>
    enabled
      ? {
          "data-draggable": true,
          onPointerDown(event: PointerEvent<HTMLElement>) {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              id,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              x: 0,
              y: 0,
              active: false,
            });
          },
          onPointerMove: track,
          onPointerUp() {
            if (dragging?.drop)
              onDrop(dragging.id, dragging.drop.target, dragging.drop.side);
            setDrag(null);
          },
          onPointerCancel: () => setDrag(null),
          onLostPointerCapture: () => setDrag(null),
        }
      : {};

  return { dragging, winbarProps };
}

/** The layout after the drop, drawn over the panes; the moving pane is accented. */
export function PaneDropOverlay({
  tree,
  drag,
  label,
}: {
  tree: PaneNode;
  drag: PaneDrag;
  label: (id: number) => PaneLabel;
}) {
  const t = useT();
  const { drop } = drag;
  const result = drop ? movePane(tree, drag.id, drop.target, drop.side) : tree;
  const hint = !drop
    ? t.paneDropPrompt
    : drop.side === "center"
      ? t.paneDropSwap(label(drop.target).title)
      : t.paneDropPlace(label(drop.target).title, drop.side);
  return (
    <div className="pane-drop-layout" aria-hidden="true">
      {paneGeometry(result).panes.map(({ id, bounds }) => {
        const { project, title } = label(id);
        return (
          <div
            key={id}
            className="pane-drop-slot"
            data-moving={id === drag.id}
            data-target={id === drop?.target}
            style={paneRect(bounds)}
          >
            <span className="pane-drop-slot-title">
              {project} / {title}
            </span>
            {id === drag.id && (
              <span className="pane-drop-slot-hint">{hint}</span>
            )}
          </div>
        );
      })}
      <div className="pane-drag-ghost" style={{ left: drag.x, top: drag.y }}>
        <GripVertical size={12} aria-hidden="true" />
        {label(drag.id).title}
        <Keycap>Esc</Keycap>
      </div>
    </div>
  );
}

export function PaneDragGrip() {
  return (
    <GripVertical className="pane-drag-grip" size={12} aria-hidden="true" />
  );
}
