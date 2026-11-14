import { expect, test } from "bun:test";
import type { Message, TranscriptRecord } from "../shared/transcript";
import { retriedAttempts } from "./retry-attempts";

let order = 0;
const base = (id: string) => ({
  id,
  entryId: id,
  parentId: null,
  branchId: "root",
  order: order++,
});
const message = (id: string, msg: Partial<Message>): TranscriptRecord => ({
  ...base(id),
  kind: "message",
  message: msg as Message,
});
const failed = (id: string) =>
  message(id, { role: "assistant", stopReason: "error", errorMessage: "x" });
const omit = (id: string, targetId: string, replacement: unknown = null) => ({
  ...base(id),
  kind: "session-entry" as const,
  entryType: "context_edit",
  data: { type: "context_edit", targetId, replacement },
});

test("numbers omitted failures per retry sequence and skips the final failure", () => {
  const attempts = retriedAttempts([
    message("u1", { role: "user" }),
    failed("a1"),
    omit("e1", "a1"),
    message("steer", { role: "user" }),
    failed("a2"),
    omit("e2", "a2"),
    failed("final"),
    message("u2", { role: "user" }),
    failed("b1"),
    omit("e3", "b1"),
    failed("edited"),
    omit("e4", "edited", { content: "kept" }),
  ]);
  expect([...attempts]).toEqual([
    ["a1", 1],
    ["a2", 2],
    ["b1", 1],
  ]);
});
