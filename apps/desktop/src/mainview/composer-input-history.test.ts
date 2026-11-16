import { expect, test } from "bun:test";
import { withAnnotations } from "../shared/annotations";
import { withAttachmentPaths } from "../shared/attachments";
import { hydrate } from "../shared/transcript";
import {
  ComposerInputHistory,
  composerHistory,
  type EditorEdit,
} from "./composer-input-history";

const edit = (text: string): EditorEdit => ({
  text,
  pastes: [],
  start: text.length,
  end: text.length,
});

test("typing is grouped; newline, selection changes and pauses start undo steps", () => {
  const history = new ComposerInputHistory(edit(""));
  history.record(edit("a"), "typing", 0);
  history.record(edit("ab"), "typing", 100);
  history.record(edit("ab\n"), undefined, 200);
  history.record(edit("ab\nc"), "typing", 300);
  expect(history.undo()?.text).toBe("ab\n");
  expect(history.undo()?.text).toBe("ab");
  expect(history.undo()?.text).toBe("");
  expect(history.undo()).toBeUndefined();
  expect(history.undo(true)?.text).toBe("ab");
  expect(history.undo(true)?.text).toBe("ab\n");
  expect(history.undo(true)?.text).toBe("ab\nc");
  history.record(edit("ab\ncd"), "typing", 2000);
  expect(history.undo()?.text).toBe("ab\nc");
  history.select(0, 0);
  history.record(edit("Xab\nc"), "typing", 2100);
  expect(history.undo()).toMatchObject({ text: "ab\nc", start: 0, end: 0 });
});

test("delete-all can be undone, while a send clear starts a fresh draft", () => {
  const history = new ComposerInputHistory(edit("keep"));
  history.select(0, 4);
  history.record(edit(""), "edit");
  expect(history.undo()).toMatchObject({ text: "keep", start: 0, end: 4 });
  history.record(edit(""));
  expect(history.undo()).toBeUndefined();
});

test("editing after undo invalidates redo", () => {
  const history = new ComposerInputHistory(edit(""));
  history.record(edit("first"), "edit");
  history.undo();
  history.record(edit("second"), "edit");
  expect(history.undo(true)).toBeUndefined();
});

test("folded paste payloads are restored together with text and selection", () => {
  const history = new ComposerInputHistory(edit("before"));
  const pasted = {
    ...edit("before[paste #1 2000 chars]"),
    pastes: [
      { id: "paste", marker: "[paste #1 2000 chars]", text: "x".repeat(2000) },
    ],
  };
  history.record(pasted);
  expect(history.undo()?.text).toBe("before");
  expect(history.undo(true)).toEqual(pasted);
  history.record({ ...pasted, pastes: pasted.pastes.map((p) => ({ ...p })) });
  expect(history.undo()?.text).toBe("before");
});

test("IME updates form a single undo step", () => {
  const history = new ComposerInputHistory(edit(""));
  history.record(edit("に"), "composition", 0);
  history.record(edit("日本"), "composition", 100);
  history.record(edit("日本語"), "composition", 3000);
  expect(history.undo()?.text).toBe("");
  expect(history.undo(true)?.text).toBe("日本語");
  history.breakGroup();
  history.record(edit("日本語入力"), "composition", 3100);
  expect(history.undo()?.text).toBe("日本語");
});

test("message recall is lazy, frozen while browsing and restores the unsent draft", () => {
  const draft = { ...edit("unsent"), start: 0, end: 0 };
  const history = new ComposerInputHistory(draft);
  let reads = 0;
  const entries = () => {
    reads++;
    return ["first", "second"];
  };
  expect(history.recall(1, entries)).toBeUndefined();
  expect(reads).toBe(0);
  expect(history.recall(-1, entries)?.text).toBe("second");
  expect(history.recall(-1, entries)?.text).toBe("first");
  expect(history.recall(-1, entries)).toBeUndefined();
  expect(history.recall(1, entries)?.text).toBe("second");
  expect(history.recall(1, entries)).toEqual(draft);
  expect(reads).toBe(1);
  expect(history.recall(1, entries)).toBeUndefined();
});

test("an empty unsent draft and its undo history survive a round trip", () => {
  const history = new ComposerInputHistory(edit("initial"));
  history.record(edit(""), "edit");
  history.recall(-1, () => ["previous"]);
  expect(history.recall(1, () => [])?.text).toBe("");
  history.record(edit(""));
  expect(history.undo()?.text).toBe("previous");
  expect(history.undo()?.text).toBe("");
  expect(history.undo()?.text).toBe("initial");
});

test("editing a recalled message starts a new browse without losing the edit", () => {
  const history = new ComposerInputHistory(edit(""));
  history.recall(-1, () => ["old"]);
  history.record(edit("old edited"), "typing");
  history.recall(-1, () => ["old", "new"]);
  expect(history.recall(1, () => [])?.text).toBe("old edited");
});

test("equal consecutive prompts remain browsable without adding fake undo steps", () => {
  const history = new ComposerInputHistory(edit("draft"));
  const entries = () => ["same", "same"];
  expect(history.recall(-1, entries)?.text).toBe("same");
  expect(history.recall(-1, entries)?.text).toBe("same");
  expect(history.recall(1, entries)?.text).toBe("same");
  expect(history.recall(1, entries)?.text).toBe("draft");
  expect(history.undo()?.text).toBe("same");
  expect(history.undo()?.text).toBe("draft");
});

test("undo steps are bounded and isolated between editors", () => {
  const first = new ComposerInputHistory(edit(""));
  const second = new ComposerInputHistory(edit("other pane"));
  for (let i = 1; i <= 110; i++) first.record(edit(String(i)), "edit");
  let undos = 0;
  while (first.undo()) undos++;
  expect(undos).toBe(100);
  expect(second.undo()).toBeUndefined();
  expect(second.current.text).toBe("other pane");
});

test("recall includes only user text, without resume prompts or old attachments", () => {
  const transcript = hydrate([
    { role: "user", content: "first", timestamp: 1 },
    {
      role: "user",
      content: [
        { type: "text", text: "second" },
        { type: "image", data: "AA==", mimeType: "image/png" },
      ],
      timestamp: 2,
    },
    { role: "user", content: "continue", timestamp: 3 },
    {
      role: "user",
      content: withAttachmentPaths(
        withAnnotations("third", [{ quote: "quote", comment: "comment" }]),
        [`C:/pig/attachments/${"a".repeat(64)}.txt`],
      ),
      timestamp: 4,
    },
    { role: "user", content: "", timestamp: 5 },
    {
      role: "custom",
      customType: "notice",
      content: "not a prompt",
      display: true,
      timestamp: 6,
    },
  ]);
  transcript.records[2].requestId = "resume:internal";
  expect(composerHistory(transcript.records)).toEqual([
    "first",
    "second",
    "third",
  ]);
});
