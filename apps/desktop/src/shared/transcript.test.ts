import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  emptyTranscript,
  hydrate,
  type Message,
  reduceTranscript,
  responseStats,
} from "./transcript";

const user: Message = { role: "user", content: "Hello", timestamp: 500 };
test("serializable custom messages survive hydration; tool results remain call-addressed", () => {
  const custom: Message = {
    role: "custom",
    customType: "fixture",
    content: { unknown: [1, 2] },
    details: { raw: true },
    display: true,
    timestamp: 1,
  };
  const state = hydrate([
    user,
    custom,
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [{ type: "text", text: "ok" }],
      isError: true,
      timestamp: 2,
    },
  ]);
  expect(state.records).toHaveLength(2);
  expect(state.records[1]).toMatchObject({ kind: "message", message: custom });
  expect(state.tools.call.status).toBe("error");
  expect(emptyTranscript()).toEqual({
    records: [],
    tools: {},
    current: null,
    running: false,
    liveToEntry: {},
  });
  expect(
    reduceTranscript(emptyTranscript(), {
      type: "snapshot",
      address: { hostId: "h", sessionId: "opaque", epoch: 1 },
      snapshotSeq: 1,
      transcript: state,
    }),
  ).toBe(state);
});
test("response statistics aggregate tool turns without treating custom data as assistant output", () => {
  const first = {
    ...fauxAssistantMessage("Looking"),
    timestamp: 1000,
    durationMs: 1000,
  };
  first.content.push({
    type: "toolCall",
    id: "call",
    name: "read",
    arguments: {},
  });
  first.usage = { ...first.usage, output: 30, totalTokens: 100 };
  const second = {
    ...fauxAssistantMessage("Done"),
    timestamp: 5000,
    durationMs: 2000,
  };
  second.usage = { ...second.usage, output: 60, totalTokens: 200 };
  const turns = [user, first, second].map((message) => ({ message }));
  expect(responseStats(turns, 0)).toBeUndefined();
  expect(responseStats(turns, 2)).toMatchObject({
    userIndex: 0,
    durationMs: 6500,
    tools: 1,
    totalTokens: 300,
    tokensPerSecond: 30,
    timestamp: 5000,
    text: "Looking\n\nDone",
  });
});

test("response copy text preserves message and block order, skipping empty text", () => {
  const first = fauxAssistantMessage("first");
  first.content.push(
    { type: "text", text: "  " },
    { type: "text", text: "second" },
  );
  const second = fauxAssistantMessage("third");
  second.content.push({ type: "text", text: "fourth" });
  expect(
    responseStats(
      [user, first, second].map((message) => ({ message })),
      2,
    )?.text,
  ).toBe("first\n\nsecond\n\nthird\n\nfourth");
});
