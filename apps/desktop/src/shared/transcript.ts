import type { Message as ModelMessage } from "@earendil-works/pi-ai";
import type { EntryRecord, LiveState } from "@earendil-works/pi-durable";
import type { WireEvent } from "./rpc-schema";
export type Message = ModelMessage;
export interface Transcript {
  turns: { id: number; message: Message }[];
  tools: Record<
    string,
    { status: "running" | "done" | "error"; result?: unknown }
  >;
  current: number | null;
  running: boolean;
}
export const emptyTranscript = (): Transcript => ({
  turns: [],
  tools: {},
  current: null,
  running: false,
});

export function reduceTranscript(
  _state: Transcript,
  event: WireEvent,
): Transcript {
  return event.transcript;
}

export function hydrate(messages: Message[]): Transcript {
  const state = emptyTranscript();
  for (const message of messages) {
    if (message.role === "toolResult")
      state.tools[message.toolCallId] = {
        status: message.isError ? "error" : "done",
        result: { content: message.content },
      };
    else if (message.role === "user" || message.role === "assistant")
      state.turns.push({ id: state.turns.length, message });
  }
  return state;
}

/** Rebuild from committed history and the Durable live document, never from SDK events. */
export function durableTranscript(
  entries: readonly EntryRecord[],
  live: LiveState,
): Transcript {
  const state = hydrate(entries.flatMap((entry) => entry.model ?? []));
  state.running = !!live.run;
  if (live.generation?.message) {
    state.current = state.turns.length;
    state.turns.push({ id: state.current, message: live.generation.message });
  }
  for (const tool of live.tools ?? []) {
    if (tool.status !== "done")
      state.tools[tool.callId] = {
        status: "running",
        result: {
          content: [{ type: "text", text: tool.output ?? "" }],
          details: tool.details,
        },
      };
  }
  return state;
}

export interface ResponseStats {
  /** Turn index of the prompting user message, if it is in the transcript. */
  userIndex?: number;
  stopReason: string;
  durationMs: number;
  endedAt: number;
  /** Request start of the last assistant message; identifies it for forking. */
  timestamp: number;
  tools: number;
  totalTokens: number;
  tokensPerSecond?: number;
  model: string;
  text: string;
}

/** Aggregates the assistant messages between the previous user turn and `end`. */
export function responseStats(
  turns: Transcript["turns"],
  end: number,
): ResponseStats | undefined {
  const last = turns[end]?.message;
  if (last?.role !== "assistant") return;
  let userIndex: number | undefined;
  let tools = 0;
  let totalTokens = 0;
  let timedOutput = 0;
  let timedMs = 0;
  const text: string[] = [];
  let start = last.timestamp;
  for (let i = end; i >= 0; i--) {
    const message = turns[i].message;
    if (message.role === "user") {
      userIndex = i;
      start = message.timestamp;
      break;
    }
    if (message.role !== "assistant") continue;
    start = message.timestamp;
    totalTokens += message.usage.totalTokens;
    if (message.durationMs) {
      timedOutput += message.usage.output;
      timedMs += message.durationMs;
    }
    const parts: string[] = [];
    for (const block of message.content)
      if (block.type === "toolCall") tools++;
      else if (block.type === "text" && block.text.trim())
        parts.push(block.text);
    text.unshift(...parts);
  }
  const endedAt = last.timestamp + (last.durationMs ?? 0);
  return {
    userIndex,
    stopReason: last.stopReason,
    durationMs: Math.max(0, endedAt - start),
    endedAt,
    timestamp: last.timestamp,
    tools,
    totalTokens,
    tokensPerSecond: timedMs ? (timedOutput * 1000) / timedMs : undefined,
    model: last.model,
    text: text.join("\n\n"),
  };
}
