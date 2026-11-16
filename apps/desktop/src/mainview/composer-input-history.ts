import { parseAnnotations } from "../shared/annotations";
import { splitAttachmentPaths } from "../shared/attachments";
import type { DraftContent } from "../shared/runtime-contract";
import { RESUME_REQUEST_PREFIX } from "../shared/runtime-contract";
import type { TranscriptRecord } from "../shared/transcript";

export type EditorText = Pick<DraftContent, "text" | "pastes">;
export type EditorEdit = EditorText & { start: number; end: number };
export type EditGroup = "typing" | "composition" | "edit";
const sameText = (a: EditorText, b: EditorText) =>
  a.text === b.text &&
  (a.pastes === b.pastes ||
    (a.pastes.length === b.pastes.length &&
      a.pastes.every(
        (paste, index) =>
          paste.id === b.pastes[index].id &&
          paste.marker === b.pastes[index].marker &&
          paste.text === b.pastes[index].text,
      )));

/** Read on demand, not on every streamed token or keystroke. */
export function composerHistory(records: readonly TranscriptRecord[]) {
  return records.flatMap((record) => {
    if (
      record.kind !== "message" ||
      record.message.role !== "user" ||
      record.requestId?.startsWith(RESUME_REQUEST_PREFIX)
    )
      return [];
    const content = record.message.content;
    const text =
      typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    const body = splitAttachmentPaths(parseAnnotations(text).body).body;
    return body.trim() ? [body] : [];
  });
}

/** Text-only editing never replaces current image/file/annotation attachments. */
export class ComposerInputHistory {
  private past: EditorEdit[] = [];
  private future: EditorEdit[] = [];
  private group?: EditGroup;
  private editedAt = 0;
  private browsing?: {
    entries: string[];
    index: number;
    draft: EditorEdit;
  };
  constructor(public current: EditorEdit) {}

  breakGroup() {
    this.group = undefined;
  }

  select(start: number, end: number) {
    if (start !== this.current.start || end !== this.current.end)
      this.group = undefined;
    this.current = { ...this.current, start, end };
  }

  record(next: EditorEdit, group?: EditGroup, now = Date.now()) {
    if (sameText(this.current, next)) {
      this.select(next.start, next.end);
      return;
    }
    // A send/remote clear starts a fresh draft, unlike deleting text by hand.
    if (!next.text && !group) {
      this.past = [];
    } else if (
      !group ||
      group === "edit" ||
      group !== this.group ||
      (group !== "composition" && now - this.editedAt > 1000)
    ) {
      this.past.push(this.current);
      if (this.past.length > 100) this.past.shift();
    }
    this.future = [];
    this.current = next;
    this.group = group;
    this.editedAt = now;
    this.browsing = undefined;
  }

  undo(redo = false) {
    const from = redo ? this.future : this.past;
    const to = redo ? this.past : this.future;
    const next = from.pop();
    if (!next) return;
    to.push(this.current);
    this.current = next;
    this.group = undefined;
    this.browsing = undefined;
    return next;
  }

  recall(direction: -1 | 1, entries: () => string[]) {
    let browsing = this.browsing;
    if (!browsing) {
      if (direction === 1) return;
      const history = entries();
      if (!history.length) return;
      browsing = {
        entries: history,
        index: history.length,
        draft: this.current,
      };
    }
    const index = Math.max(
      0,
      Math.min(browsing.entries.length, browsing.index + direction),
    );
    if (index === browsing.index) return;
    const next =
      index === browsing.entries.length
        ? browsing.draft
        : { text: browsing.entries[index], pastes: [], start: 0, end: 0 };
    this.record(next, "edit");
    this.browsing =
      index === browsing.entries.length ? undefined : { ...browsing, index };
    return next;
  }
}
