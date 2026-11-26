import { expect, test } from "bun:test";
import type { TranscriptRecord } from "../shared/transcript";
import { collectTurns } from "./turn-rail-model";

const row = (order: number, message: unknown) =>
  ({
    id: `r${order}`,
    entryId: `e${order}`,
    parentId: null,
    branchId: "b",
    order,
    kind: "message",
    message,
  }) as TranscriptRecord;

test("groups by user message and previews the last assistant text", () => {
  const turns = collectTurns([
    row(0, { role: "assistant", content: [{ type: "text", text: "orphan" }] }),
    row(1, { role: "user", content: "## First   question" }),
    row(2, { role: "assistant", content: [{ type: "text", text: "draft" }] }),
    row(3, { role: "assistant", content: [{ type: "toolCall", id: "t" }] }),
    row(4, {
      role: "assistant",
      content: [{ type: "text", text: "**final** `x`" }],
    }),
    row(5, { role: "user", content: [{ type: "image" }] }),
  ]);
  expect(turns).toEqual([
    {
      id: "r1",
      entryId: "e1",
      title: "First question",
      preview: "final x",
      branchEntryId: "e4",
    },
    { id: "r5", entryId: "e5", title: "", preview: "" },
  ]);
});
