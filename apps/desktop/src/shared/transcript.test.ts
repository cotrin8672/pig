import { describe, expect, test } from "bun:test";
import type {
  ConversationId,
  EntryId,
  EntryRecord,
} from "@earendil-works/pi-durable";
import {
  durableTranscript,
  emptyTranscript,
  hydrate,
  type Message,
  reduceTranscript,
  responseStats,
} from "./transcript";

type Assistant = Extract<Message, { role: "assistant" }>;
const assistant = (text: string): Assistant => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test",
  stopReason: "stop",
  timestamp: 2,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
const user: Message = { role: "user", content: "Hello", timestamp: 1 };
const toolResult: Message = {
  role: "toolResult",
  toolCallId: "call1",
  toolName: "read",
  content: [{ type: "text", text: "contents" }],
  isError: false,
  timestamp: 3,
};

describe("Durable transcript", () => {
  const entries = (messages: Message[]): EntryRecord[] =>
    messages.map((message, index) => ({
      id: (index + 1) as EntryId,
      conversationId: 1 as ConversationId,
      kind: `pi.${message.role}`,
      model: [message],
    }));
  test("live partial is replaced by the committed answer without duplication", () => {
    const partial = durableTranscript(entries([user]), {
      run: {
        taskId: 1 as import("@earendil-works/pi-durable").TaskId,
        inputs: [],
        turns: 0,
      },
      generation: {
        attempt: 1,
        message: JSON.parse(JSON.stringify(assistant("H"))),
      },
    });
    expect(partial.running).toBe(true);
    expect(partial.turns).toHaveLength(2);
    expect(partial.current).toBe(1);
    const final = durableTranscript(entries([user, assistant("Hello")]), {});
    expect(final.running).toBe(false);
    expect(final.turns).toHaveLength(2);
    expect(final.current).toBeNull();
    expect(
      reduceTranscript(partial, { type: "snapshot", transcript: final }),
    ).toBe(final);
  });
  test("tool progress and committed results are keyed by call id", () => {
    const partial = durableTranscript(entries([user]), {
      tools: [
        { callId: "call1", name: "read", status: "running", output: "part" },
      ],
    });
    expect(partial.tools.call1.status).toBe("running");
    const final = durableTranscript(entries([user, toolResult]), {});
    expect(final.tools.call1).toMatchObject({
      status: "done",
      result: { content: toolResult.content },
    });
    expect(final.turns).toHaveLength(1);
    expect(
      durableTranscript(entries([{ ...toolResult, isError: true }]), {}).tools
        .call1.status,
    ).toBe("error");
    expect(emptyTranscript().running).toBe(false);
  });
  test("aggregates one response across tool turns", () => {
    const first: Assistant = {
      ...assistant("Looking"),
      content: [
        { type: "text", text: "Looking" },
        { type: "toolCall", id: "call1", name: "read", arguments: {} },
      ],
      timestamp: 1000,
      durationMs: 1000,
      usage: { ...assistant("").usage, output: 30, totalTokens: 100 },
    };
    const second: Assistant = {
      ...assistant("Done"),
      timestamp: 5000,
      durationMs: 2000,
      usage: { ...assistant("").usage, output: 60, totalTokens: 200 },
    };
    const turns = hydrate([
      { ...user, timestamp: 500 },
      first,
      toolResult,
      second,
    ]).turns;
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
});
