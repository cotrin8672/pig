/**
 * Edits of past messages outlive the bubble: navigation or a remounted
 * transcript must not lose text, and a failed resend reopens the editor.
 */
export type MessageEdit = { text: string; state: "editing" | "sending" };
const edits = new Map<string, MessageEdit>();
const listeners = new Set<() => void>();
let tick = 0;
export const editKey = (sessionId: string, entryId: string) =>
  JSON.stringify([sessionId, entryId]);
export const messageEdits = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getTick: () => tick,
  read: (key: string) => edits.get(key),
  set(key: string, edit: MessageEdit | undefined) {
    if (edit) edits.set(key, edit);
    else edits.delete(key);
    tick++;
    for (const listener of listeners) listener();
  },
};
