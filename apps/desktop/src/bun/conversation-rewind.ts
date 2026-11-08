import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Conversation, EntryRecord } from "@earendil-works/pi-durable";

/** Raw Durable history is immutable; replay our display cutoffs without altering ancestry. */
export function visibleHistory(entries: readonly EntryRecord[]): EntryRecord[] {
  let visible: EntryRecord[] = [];
  for (const entry of entries) {
    if (entry.kind === "pig.rewind") {
      const data = entry.data;
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        typeof data.before === "number"
      ) {
        const before = data.before;
        visible = visible.filter((item) => !item.model || item.id < before);
      }
    } else visible.push(entry);
  }
  return visible;
}

/**
 * Durable heads only move forward. A supported write starts a fresh context at
 * itself, carrying the resolved context at the retained entry (including edits
 * and compaction), rather than changing immutable history or creating a fork.
 * Application metadata and fork ancestry remain untouched.
 */
export async function rewindConversation(
  conversation: Conversation,
  entries: readonly EntryRecord[],
  timestamp: number,
) {
  const visible = visibleHistory(entries);
  const index = visible.findIndex((entry) =>
    entry.model?.some(
      (message) => message.role === "user" && message.timestamp === timestamp,
    ),
  );
  if (index < 0) throw new Error("Message not found.");
  await conversation.abort(context, { background: true });
  // Use the raw predecessor: it may itself be a previous rewind head. Looking
  // only at display entries can accidentally cross that head and revive a cut branch.
  const previous = [...entries]
    .reverse()
    .find((entry) => entry.id < visible[index].id);
  const messages = previous
    ? (await conversation.context(context, { at: previous.id })).messages
    : [];
  await conversation.submit(
    {
      type: "write",
      entry: {
        kind: "pig.rewind",
        head: "self",
        model: messages,
        data: { before: Number(visible[index].id) },
      },
    },
    context,
  );
}
