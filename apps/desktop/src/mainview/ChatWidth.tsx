import { useRef, useState } from "react";
import { clampChatWidth, DEFAULT_CHAT_WIDTH } from "../shared/chat-width";
import { useT } from "./i18n";
import { updateUiPreferences } from "./rpc";
import { useStore } from "./store";

export function useChatWidth() {
  const width = useStore(
    (s) => s.bootstrap.desktop.chatWidth ?? DEFAULT_CHAT_WIDTH,
  );
  return {
    width,
    setWidth: (value: number) =>
      updateUiPreferences({ chatWidth: clampChatWidth(value) }),
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
  const drag = useRef<{
    x: number;
    width: number;
    max: number;
    side: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className={`chat-width-guides ${dragging ? "is-dragging" : ""}`}>
      {([-1, 1] as const).map((side) => (
        <button
          key={side}
          type="button"
          className={`chat-width-handle ${side === -1 ? "left" : "right"}`}
          aria-label={t.resizeEdge(side === -1)}
          title={
            t["Drag to resize · Arrow keys to adjust · Double-click to reset"]
          }
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const guide = event.currentTarget.parentElement;
            const shell = guide?.parentElement;
            if (!guide || !shell) return;
            drag.current = {
              x: event.clientX,
              width: guide.getBoundingClientRect().width,
              max: Math.max(480, shell.clientWidth - 48),
              side,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start)
              onChange(
                clampChatWidth(
                  Math.min(
                    start.max,
                    start.width + (event.clientX - start.x) * 2 * start.side,
                  ),
                ),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
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
