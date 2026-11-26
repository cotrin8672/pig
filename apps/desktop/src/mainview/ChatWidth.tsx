import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampChatWidth, DEFAULT_CHAT_WIDTH } from "../shared/chat-width";
import { useT } from "./i18n";
import { updateUiPreferences } from "./rpc";
import { useStore } from "./store";
import { frameTask } from "./thread-scroll";

type WidthDrag = {
  pointerId: number;
  x: number;
  width: number;
  max: number;
  side: number;
  next?: number;
  painted?: string;
};

const shells = new Set<HTMLDivElement>();
let activeDrag: WidthDrag | null = null;

export function registerChatShell(shell: HTMLDivElement | null) {
  if (!shell) return;
  shells.add(shell);
  // A background chat can finish opening while another pane is being dragged.
  if (activeDrag?.painted)
    shell.style.setProperty("--chat-width", activeDrag.painted);
  return () => {
    shells.delete(shell);
    shell.style.removeProperty("--chat-width");
  };
}

function dragWidth(drag: WidthDrag, x: number) {
  return clampChatWidth(
    Math.min(drag.max, drag.width + (x - drag.x) * 2 * drag.side),
  );
}

function clearPreview(drag: WidthDrag | null) {
  if (!drag || activeDrag !== drag) return;
  activeDrag = null;
  if (drag.painted)
    for (const shell of shells) shell.style.removeProperty("--chat-width");
}

export function useChatWidth() {
  const width = useStore(
    (s) => s.bootstrap.desktop.chatWidth ?? DEFAULT_CHAT_WIDTH,
  );
  return {
    width,
    setWidth: (value: number) => {
      const chatWidth = clampChatWidth(value);
      if (
        chatWidth !==
        (useStore.getState().bootstrap.desktop.chatWidth ?? DEFAULT_CHAT_WIDTH)
      )
        updateUiPreferences({ chatWidth });
    },
  };
}

export function ChatWidthHandles({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const t = useT();
  const drag = useRef<WidthDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(
    () =>
      frameTask(() => {
        const current = drag.current;
        if (current?.next === undefined) return;
        current.painted = `${current.next}px`;
        for (const shell of shells)
          shell.style.setProperty("--chat-width", current.painted);
      }),
    [],
  );
  useLayoutEffect(
    () => () => {
      preview.dispose();
      clearPreview(drag.current);
    },
    [preview],
  );
  const finish = (pointerId: number, x?: number) => {
    const current = drag.current;
    if (current?.pointerId !== pointerId) return;
    drag.current = null;
    preview.dispose();
    clearPreview(current);
    setDragging(false);
    if (x !== undefined && (current.next !== undefined || x !== current.x))
      onChange(dragWidth(current, x));
    else if (current.next !== undefined) onChange(current.next);
  };
  return (
    <div className={`chat-width-guides ${dragging ? "is-dragging" : ""}`}>
      {([-1, 1] as const).map((side) => (
        <button
          key={side}
          type="button"
          className={`chat-width-handle ${side === -1 ? "left" : "right"}`}
          aria-label={t.resizeEdge(side === -1)}
          aria-description={
            t["Drag to resize · Arrow keys to adjust · Double-click to reset"]
          }
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary || activeDrag) return;
            event.preventDefault();
            const guide = event.currentTarget.parentElement;
            const shell = guide?.parentElement;
            if (!guide || !shell) return;
            const current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width: guide.getBoundingClientRect().width,
              max: Math.max(480, shell.clientWidth - 48),
              side,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = current;
            activeDrag = current;
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (current?.pointerId !== event.pointerId) return;
            const next = dragWidth(current, event.clientX);
            if (next === current.next) return;
            current.next = next;
            preview.schedule();
          }}
          onPointerUp={(event) => finish(event.pointerId, event.clientX)}
          onLostPointerCapture={(event) => finish(event.pointerId)}
          onPointerCancel={(event) => finish(event.pointerId)}
          onDoubleClick={() => onChange(DEFAULT_CHAT_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "Home" || event.key === "Enter") {
              event.preventDefault();
              onChange(DEFAULT_CHAT_WIDTH);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              onChange(
                clampChatWidth(
                  width +
                    (event.key === "ArrowRight" ? 1 : -1) *
                      side *
                      (event.shiftKey ? 80 : 20),
                ),
              );
            }
          }}
        >
          <span />
        </button>
      ))}
    </div>
  );
}
