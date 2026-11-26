import {
  CircleHelp,
  GripVertical,
  ListEnd,
  Paperclip,
  PencilLine,
  SendHorizontal,
  X,
} from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { unfoldPastes } from "../shared/paste";
import type { DraftContent } from "../shared/runtime-contract";
import { useT } from "./i18n";
import { Spinner } from "./primitives/Spinner";
import { showError } from "./store";
import "./message-queue-arrival.css";

type QueueItem = {
  id: string;
  content: DraftContent;
  /** SDK input has started: it can no longer be moved or sent early. */
  locked?: boolean;
};
type Action = (id: string) => unknown;

const preview = (content: DraftContent) =>
  unfoldPastes(content.text, content.pastes);
const attachmentCount = (content: DraftContent) =>
  content.images.length +
  (content.files?.length ?? 0) +
  (content.annotations?.length ?? 0);

// A pending draft can move between the bubble and the two tray sections.
// Weak ownership keeps presentation state out of the send controller and history.
const presented = new WeakMap<DraftContent, Set<string>>();

export function usePendingArrival(ready = true) {
  const previous = useRef<Set<string> | undefined>(undefined);
  const current = new Set<string>();
  useLayoutEffect(() => {
    previous.current = ready ? current : undefined;
  });
  return (id: string, content: DraftContent) => (node: HTMLElement | null) => {
    if (!node) return;
    current.add(id);
    const ids = presented.get(content) ?? new Set<string>();
    const fresh = !ids.has(id) && previous.current && !previous.current.has(id);
    ids.add(id);
    presented.set(content, ids);
    if (!ready || !fresh) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    // Unlike a mount animation, this doesn't restart when a keyed row moves.
    const animation = node.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 120, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    const stop = () => animation.cancel();
    motion.addEventListener("change", stop, { once: true });
    const release = () => motion.removeEventListener("change", stop);
    void animation.finished.then(release, release);
  };
}

/**
 * Everything still waiting to reach the agent, in one compact tray on the
 * composer: steering (read at the next step boundary) first, then follow-ups
 * (sent after the response). Same one-line row for both; the leading icon tells
 * the timing. Waiting input stays beside the editor, not in the conversation.
 */
export function MessageQueue({
  items,
  steering = [],
  onEdit,
  onDelete,
  onMove,
  onSteer,
  onCheck,
}: {
  items: QueueItem[];
  /** Unread or unconfirmed input; neither can safely be withdrawn individually. */
  steering?: { id: string; content: DraftContent; unconfirmed?: boolean }[];
  onEdit: Action;
  onDelete: Action;
  /** Receives the full new order of the queue. */
  onMove?(ids: string[]): unknown;
  onSteer?: Action;
  onCheck?: Action;
}) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [busy, setBusy] = useState<string>();
  const [drag, setDrag] = useState<{ id: string; over?: number }>();
  const arrival = usePendingArrival();
  if (!items.length && !steering.length) return null;
  // A started head cannot be passed; everything after it can move.
  const first = items.findIndex((item) => !item.locked);
  async function act(id: string, action: Action, refocus = false) {
    setBusy(id);
    try {
      await action(id);
      if (refocus) root.current?.focus();
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
  const attachments = (content: DraftContent) => {
    const count = attachmentCount(content);
    return (
      count > 0 && (
        <span
          className="message-queue-attachments"
          role="img"
          aria-label={`${t.Attachments}: ${count}`}
        >
          <Paperclip size={12} aria-hidden="true" />
        </span>
      )
    );
  };
  return (
    <section
      ref={root}
      className="message-queue"
      data-ui-surface="card"
      aria-label={t["Waiting messages"]}
      tabIndex={-1}
    >
      <ol ref={list}>
        {steering.map(({ id, content, unconfirmed }) => {
          const text = preview(content);
          const Icon = unconfirmed ? CircleHelp : SendHorizontal;
          return (
            <li key={id} className="message-queue-steer">
              <div
                className="message-queue-row-content"
                ref={arrival(id, content)}
              >
                <span className="message-queue-handle">
                  <Icon
                    size={13}
                    className="message-queue-mode"
                    role="img"
                    aria-label={
                      unconfirmed
                        ? t["Send unconfirmed"]
                        : t["Steering pending"]
                    }
                  />
                </span>
                <p aria-description={text}>{text || t.Message}</p>
                {attachments(content)}
                {unconfirmed && (
                  <button
                    type="button"
                    className="message-queue-action message-queue-check"
                    aria-label={t["Check send status"]}
                    aria-description={t.sendUnconfirmed}
                    disabled={busy === id}
                    onClick={() => onCheck && void act(id, onCheck)}
                  >
                    {t["Send unconfirmed"]}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {items.map(({ id, content, locked }, index) => {
          const text = preview(content);
          const movable = !!onMove && !locked && items.length - first > 1;
          return (
            <li
              key={id}
              aria-busy={busy === id || undefined}
              data-group-start={
                (index === 0 && steering.length > 0) || undefined
              }
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
              <div
                className="message-queue-row-content"
                ref={arrival(id, content)}
              >
                <span className="message-queue-handle">
                  {locked ? (
                    <Spinner size={14} label={t["Already sending"]} />
                  ) : movable ? (
                    // The timing icon turns into the grip on hover/focus, in place.
                    <button
                      type="button"
                      className="message-queue-grip"
                      aria-label={`${index + 1}. ${t["Reorder queued message"]}`}
                      disabled={!!busy}
                      onKeyDown={(event) => keyMove(event, index, id)}
                    >
                      <ListEnd
                        size={13}
                        className="message-queue-grip-idle"
                        aria-hidden="true"
                      />
                      <GripVertical
                        size={14}
                        className="message-queue-grip-active"
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <ListEnd
                      size={13}
                      className="message-queue-mode"
                      role="img"
                      aria-label={t["Send after response"]}
                    />
                  )}
                </span>
                <p aria-description={text}>{text || t.Message}</p>
                {attachments(content)}
                <div className="message-queue-actions">
                  {onSteer && (
                    <button
                      type="button"
                      className="message-queue-action"
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
                    aria-label={t["Edit queued message"]}
                    disabled={!!busy}
                    onClick={() => void act(id, onEdit)}
                  >
                    <PencilLine size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="message-queue-action"
                    aria-label={t["Delete queued message"]}
                    disabled={!!busy}
                    onClick={() => void act(id, onDelete, true)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
