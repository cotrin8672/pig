import {
  ChevronDown,
  GripVertical,
  ListEnd,
  LoaderCircle,
  Paperclip,
  PencilLine,
  SendHorizontal,
  X,
} from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { unfoldPastes } from "../shared/paste";
import type { DraftContent } from "../shared/runtime-contract";
import { useT } from "./i18n";
import { showError } from "./store";

type QueueItem = {
  id: string;
  content: DraftContent;
  /** SDK input has started: it can no longer be moved or sent early. */
  locked?: boolean;
};
type Action = (id: string) => unknown;

/** Waiting input stays beside the editor, not in the agent's conversation. */
export function MessageQueue({
  items,
  onEdit,
  onDelete,
  onMove,
  onSteer,
}: {
  items: QueueItem[];
  onEdit: Action;
  onDelete: Action;
  /** Receives the full new order of the queue. */
  onMove?(ids: string[]): unknown;
  onSteer?: Action;
}) {
  const t = useT();
  const summary = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [busy, setBusy] = useState<string>();
  const [drag, setDrag] = useState<{ id: string; over?: number }>();
  if (!items.length) return null;
  // A started head cannot be passed; everything after it can move.
  const first = items.findIndex((item) => !item.locked);
  async function act(id: string, action: Action, refocus = false) {
    setBusy(id);
    try {
      await action(id);
      if (refocus) summary.current?.focus();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(undefined);
    }
  }
  function move(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id);
    if (!onMove || from < 0 || first < 0 || to < first || to === from) return;
    const ids = items.map((item) => item.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    void Promise.resolve()
      .then(() => onMove(ids))
      .catch(showError);
  }
  function keyMove(event: KeyboardEvent, index: number, id: string) {
    if (!event.altKey) return;
    const step =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const to = index + step;
    if (!step || to < first || to >= items.length) return;
    event.preventDefault();
    move(id, to);
    // Focus follows the moved row once it re-renders.
    requestAnimationFrame(() =>
      list.current
        ?.querySelectorAll<HTMLElement>(".message-queue-grip")
        [to - first]?.focus(),
    );
  }
  return (
    <details className="message-queue" open>
      <summary ref={summary}>
        <ListEnd size={14} aria-hidden="true" />
        <span>{t["Send after response"]}</span>
        <span className="message-queue-count" aria-live="polite">
          {items.length}
        </span>
        <ChevronDown
          className="message-queue-chevron"
          size={14}
          aria-hidden="true"
        />
      </summary>
      <ol ref={list}>
        {items.map(({ id, content, locked }, index) => {
          const text = unfoldPastes(content.text, content.pastes);
          const attachments =
            content.images.length +
            (content.files?.length ?? 0) +
            (content.annotations?.length ?? 0);
          const movable = !!onMove && !locked && items.length - first > 1;
          return (
            <li
              key={id}
              aria-busy={busy === id || undefined}
              data-dragging={drag?.id === id || undefined}
              data-drop={
                drag && drag.id !== id && drag.over === index
                  ? index > items.findIndex((item) => item.id === drag.id)
                    ? "after"
                    : "before"
                  : undefined
              }
              draggable={movable}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", text);
                setDrag({ id });
              }}
              onDragOver={(event) => {
                if (!drag || index < first) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (drag.over !== index) setDrag({ ...drag, over: index });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag) move(drag.id, index);
                setDrag(undefined);
              }}
              onDragEnd={() => setDrag(undefined)}
            >
              {onMove && (
                <span className="message-queue-handle">
                  {locked && (
                    <LoaderCircle
                      size={14}
                      className="spinner message-queue-started"
                      role="img"
                      aria-label={t["Already sending"]}
                    />
                  )}
                  {movable && (
                    <button
                      type="button"
                      className="message-queue-grip"
                      title={t["Reorder queued message"]}
                      aria-label={`${index + 1}. ${t["Reorder queued message"]}`}
                      disabled={!!busy}
                      onKeyDown={(event) => keyMove(event, index, id)}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </button>
                  )}
                </span>
              )}
              <span className="message-queue-index" aria-hidden="true">
                {index + 1}
              </span>
              <p title={text}>{text || t.Message}</p>
              {attachments > 0 && (
                <span className="message-queue-attachments">
                  <Paperclip size={12} aria-hidden="true" />
                  {attachments}
                </span>
              )}
              <div className="message-queue-actions">
                {onSteer && (
                  <button
                    type="button"
                    className="message-queue-action"
                    title={t["Steer with queued message"]}
                    aria-label={t["Steer with queued message"]}
                    disabled={!!busy || locked}
                    onClick={() => void act(id, onSteer, true)}
                  >
                    <SendHorizontal size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="message-queue-action"
                  title={t["Edit queued message"]}
                  aria-label={t["Edit queued message"]}
                  disabled={!!busy}
                  onClick={() => void act(id, onEdit)}
                >
                  <PencilLine size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="message-queue-action"
                  title={t["Delete queued message"]}
                  aria-label={t["Delete queued message"]}
                  disabled={!!busy}
                  onClick={() => void act(id, onDelete, true)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
