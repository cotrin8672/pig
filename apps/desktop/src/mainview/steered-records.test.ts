import { expect, test } from "bun:test";
import type { Message, TranscriptRecord } from "../shared/transcript";
import { isSteeredUser } from "./steered-records";

const at = (messages: Message[]): TranscriptRecord[] =>
  messages.map((message, order) => ({
    id: `r${order}`,
    parentId: null,
    branchId: "root",
    order,
    kind: "message",
    message,
  }));
const user = (text: string): Message => ({
  role: "user",
  content: text,
  timestamp: 1,
});
const assistant = (stopReason: string): Message =>
  ({
    role: "assistant",
    content: [],
    stopReason,
    timestamp: 1,
  }) as unknown as Message;
const toolResult = {
  role: "toolResult",
  toolCallId: "t1",
  content: [],
  isError: false,
  timestamp: 1,
} as unknown as Message;

test("a user message injected after a tool step is steering", () => {
  const records = at([
    user("run the tests"),
    assistant("toolUse"),
    toolResult,
    user("only greeting"),
    assistant("stop"),
  ]);
  expect(isSteeredUser(records, 3)).toBe(true);
});

test("prompts after a finished, failed or stopped response are new turns", () => {
  for (const stop of ["stop", "error", "aborted", "length"]) {
    const records = at([user("a"), assistant(stop), user("b")]);
    expect(isSteeredUser(records, 2)).toBe(false);
  }
  expect(isSteeredUser(at([user("first")]), 0)).toBe(false);
  expect(isSteeredUser(at([user("a"), user("b")]), 1)).toBe(false);
});

test("non-message records between the step and the steer are skipped", () => {
  const records: TranscriptRecord[] = [
    ...at([user("a"), assistant("toolUse")]),
    {
      id: "c",
      parentId: null,
      branchId: "root",
      order: 2,
      kind: "custom-entry",
      customType: "note",
      data: null,
    },
    ...at([user("b")]).map((r) => ({ ...r, id: "u", order: 3 })),
  ];
  expect(isSteeredUser(records, 3)).toBe(true);
  expect(isSteeredUser(records, 1)).toBe(false);
});
