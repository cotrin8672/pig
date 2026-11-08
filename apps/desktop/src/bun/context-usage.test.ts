import { expect, test } from "bun:test";
import { fauxAssistantMessage, type Message } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { projectedContextUsage } from "./context-usage";

function view(messages: Message[], head?: number) {
  const entries = messages.map(
    (message, i) =>
      ({
        id: i + 1,
        conversationId: 1,
        kind: "message",
        model: [message],
      }) as unknown as EntryRecord,
  );
  return {
    messages,
    entries,
    contributions: messages.map((m) => [m]),
    head:
      head === undefined
        ? undefined
        : ({
            id: head,
            conversationId: 1,
            kind: "pi.compaction",
            head: 1,
          } as EntryRecord),
  };
}
const user = (text: string): Message => ({
  role: "user",
  content: text,
  timestamp: 1,
});
const assistant = () => ({
  ...fauxAssistantMessage("answer"),
  usage: {
    ...fauxAssistantMessage("").usage,
    input: 90,
    output: 10,
    totalTokens: 100,
  },
});

test("context usage uses last valid projected assistant usage plus trailing estimates", () => {
  expect(projectedContextUsage(view([user("12345678")]), 1000)).toEqual({
    tokens: 2,
    contextWindow: 1000,
    percent: 0.2,
  });
  expect(
    projectedContextUsage(
      view([user("hello"), assistant(), user("12345678")]),
      1000,
    ),
  ).toEqual({ tokens: 102, contextWindow: 1000, percent: 10.2 });
  expect(projectedContextUsage(view([]), 0)).toBeNull();
});

test("compaction invalidates retained pre-compaction usage until a post-compaction response", () => {
  expect(
    projectedContextUsage(view([user("hello"), assistant()], 3), 1000),
  ).toEqual({ tokens: null, contextWindow: 1000, percent: null });
  expect(
    projectedContextUsage(
      view([user("hello"), assistant(), user("summary"), assistant()], 3),
      1000,
    )?.tokens,
  ).toBe(100);
  const failed = { ...assistant(), stopReason: "error" as const };
  expect(projectedContextUsage(view([failed], 0), 1000)?.tokens).toBeNull();
});

test("later context edits invalidate usage without counting lifetime history", () => {
  const projected = view([assistant(), user("12345678")]);
  projected.entries[1] = {
    ...projected.entries[1],
    edits: [{ target: projected.entries[0].id, action: "omit" }],
  } as EntryRecord;
  expect(projectedContextUsage(projected, 1000)?.tokens).toBeLessThan(100);
});
