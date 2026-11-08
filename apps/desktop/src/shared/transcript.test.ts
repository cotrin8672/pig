import { describe, expect, test } from "bun:test";
import type { WireEvent } from "./rpc-schema";
import {
  emptyTranscript,
  hydrate,
  type Message,
  reduceTranscript,
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
});
