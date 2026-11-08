import { describe, expect, test } from "bun:test";
import type { WireEvent } from "./rpc-schema";
import {
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

const custom: Extract<Message, { role: "custom" }> = {
  role: "custom",
  customType: "notice",
  content: "Notice",
  display: true,
  timestamp: 4,
};

describe("transcript", () => {
  test("replaces partial snapshots and finalizes under one turn id", () => {
    const events: WireEvent[] = [
      { type: "agent_start" },
      { type: "message_start", message: user },
      { type: "message_end", message: user },
      { type: "message_start", message: assistant("") },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "H",
          partial: assistant("H"),
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "ello",
          partial: assistant("Hello"),
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "done",
          reason: "stop",
          message: assistant("Hello"),
        },
      },
      { type: "message_end", message: assistant("Final") },
      { type: "agent_end", messages: [], willRetry: false },
    ];
    let state = events.reduce(reduceTranscript, emptyTranscript());
    expect(state.turns).toHaveLength(2);
    expect(state.turns[1]).toEqual({ id: 1, message: assistant("Final") });
    expect(state.running).toBe(true);
    state = reduceTranscript(state, { type: "agent_settled", aborted: false });
    expect(state.running).toBe(false);
    expect(state).toEqual(hydrate([user, assistant("Final")]));
  });
  test("tracks tools by call id, skips nested events, hydrates results", () => {
    let state = hydrate([user, assistant("Tool")]);
    state = reduceTranscript(state, {
      type: "tool_execution_start",
      toolCallId: "call1",
      toolName: "read",
      args: { path: "a" },
    });
    expect(state.tools.call1.status).toBe("running");
    state = reduceTranscript(state, {
      type: "tool_execution_update",
      toolCallId: "call1",
      toolName: "read",
      args: {},
      partialResult: { content: [], details: "partial" },
    });
    expect(state.tools.call1.result).toEqual({
      content: [],
      details: "partial",
    });
    const nested = reduceTranscript(state, {
      type: "tool_execution_start",
      toolCallId: "nested",
      toolName: "read",
      args: {},
      parentToolCallId: "call1",
    });
    expect(nested).toBe(state);
    state = reduceTranscript(state, {
      type: "tool_execution_end",
      toolCallId: "call1",
      toolName: "read",
      result: { content: toolResult.content, details: undefined },
      isError: false,
    });
    expect(state).toEqual(hydrate([user, assistant("Tool"), toolResult]));
    state = reduceTranscript(state, {
      type: "tool_execution_end",
      toolCallId: "call1",
      toolName: "read",
      result: {},
      isError: true,
    });
    expect(state.tools.call1.status).toBe("error");
  });
  test("error update and message_end do not duplicate the assistant", () => {
    const error: Assistant = {
      ...assistant(""),
      stopReason: "error",
      errorMessage: "failed",
    };
    let state = reduceTranscript(emptyTranscript(), {
      type: "message_start",
      message: error,
    });
    state = reduceTranscript(state, {
      type: "message_update",
      assistantMessageEvent: { type: "error", reason: "error", error },
    });
    state = reduceTranscript(state, { type: "message_end", message: error });
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].message).toEqual(error);
  });
  test("hydrates mixed roles, excluding system and hidden custom messages", () => {
    const visible: Message[] = [
      user,
      assistant("Hello"),
      custom,
      {
        role: "bashExecution",
        command: "echo ok",
        output: "ok",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 5,
      },
      {
        role: "compactionSummary",
        summary: "Summary",
        tokensBefore: 100,
        timestamp: 6,
      },
      { role: "branchSummary", summary: "Branch", fromId: null, timestamp: 7 },
    ];
    const state = hydrate([
      { role: "system", content: "System", timestamp: 0 },
      ...visible,
      { ...custom, display: false },
      toolResult,
    ]);
    expect(state.turns.map((turn) => turn.message)).toEqual(visible);
    expect(state.tools.call1.status).toBe("done");
    expect(state.current).toBeNull();
  });
  test("custom start and end yield one turn and preserve a streaming assistant", () => {
    let state = reduceTranscript(emptyTranscript(), {
      type: "message_start",
      message: assistant(""),
    });
    const started = state;
    state = reduceTranscript(state, { type: "message_start", message: custom });
    expect(state).toBe(started);
    state = reduceTranscript(state, { type: "message_end", message: custom });
    expect(state.current).toBe(0);
    expect(state.turns).toHaveLength(2);
    state = reduceTranscript(state, {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hi",
        partial: assistant("Hi"),
      },
    });
    expect(state.turns[0].message).toEqual(assistant("Hi"));
    state = reduceTranscript(state, {
      type: "message_end",
      message: assistant("Final"),
    });
    expect(state.turns.map((turn) => turn.message)).toEqual([
      assistant("Final"),
      custom,
    ]);
    expect(state.current).toBeNull();
  });
  test("entry_appended converts visible custom entries without interrupting streaming", () => {
    let state = reduceTranscript(emptyTranscript(), {
      type: "message_start",
      message: assistant(""),
    });
    const event = {
      type: "entry_appended",
      entry: {
        type: "custom_message",
        id: "entry1",
        parentId: null,
        timestamp: new Date(custom.timestamp).toISOString(),
        customType: custom.customType,
        content: custom.content,
        display: true,
      },
    } satisfies Extract<WireEvent, { type: "entry_appended" }>;
    state = reduceTranscript(state, event);
    expect(state.turns[1].message).toEqual({ ...custom, details: undefined });
    expect(state.current).toBe(0);
    expect(
      reduceTranscript(state, {
        ...event,
        entry: { ...event.entry, display: false },
      }),
    ).toBe(state);
  });
  test("tool partial and final results replace rather than concatenate image content", () => {
    const image = {
      type: "image" as const,
      mimeType: "image/png",
      data: "aGVsbG8=",
    };
    const partial = {
      content: [{ type: "text", text: "partial" }, image],
      details: { progress: 1 },
    };
    let state = reduceTranscript(emptyTranscript(), {
      type: "tool_execution_update",
      toolCallId: "call1",
      toolName: "read",
      args: {},
      partialResult: partial,
    });
    expect(state.tools.call1.result).toEqual(partial);
    const final = { content: [image], details: { progress: 2 } };
    state = reduceTranscript(state, {
      type: "tool_execution_end",
      toolCallId: "call1",
      toolName: "read",
      result: final,
      isError: false,
    });
    expect(state.tools.call1.result).toEqual(final);
    expect(state.tools.call1.status).toBe("done");
    const message: Message = {
      ...toolResult,
      content: [image],
      details: final.details,
    };
    expect(reduceTranscript(state, { type: "message_end", message })).toEqual(
      hydrate([message]),
    );
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
