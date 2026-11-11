import { ChevronDown, ListEnd, Paperclip, PencilLine, X } from "lucide-react";
import { useRef, useState } from "react";
import { unfoldPastes } from "../shared/paste";
import type { DraftContent } from "../shared/runtime-contract";
import { useT } from "./i18n";
import { showError } from "./store";

type QueueItem = { id: string; content: DraftContent };

/** Waiting input stays beside the editor, not in the agent's conversation. */
export function MessageQueue({
  items,
  onEdit,
  onDelete,
}: {
  items: QueueItem[];
  onEdit(id: string): Promise<void> | void;
  onDelete(id: string): Promise<void> | void;
}) {
  const t = useT();
  const summary = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string>();
  if (!items.length) return null;
  async function act(id: string, edit: boolean) {
    setBusy(id);
    try {
      await (edit ? onEdit(id) : onDelete(id));
      if (!edit) summary.current?.focus();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(undefined);
    }
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
      <ol>
        {items.map(({ id, content }, index) => {
          const text = unfoldPastes(content.text, content.pastes);
          const attachments =
            content.images.length +
            (content.files?.length ?? 0) +
            (content.annotations?.length ?? 0);
          return (
            <li key={id} aria-busy={busy === id || undefined}>
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
                <button
                  type="button"
                  className="message-queue-action"
                  title={t["Edit queued message"]}
                  aria-label={t["Edit queued message"]}
                  disabled={!!busy}
                  onClick={() => void act(id, true)}
                >
                  <PencilLine size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="message-queue-action"
                  title={t["Delete queued message"]}
                  aria-label={t["Delete queued message"]}
                  disabled={!!busy}
                  onClick={() => void act(id, false)}
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
