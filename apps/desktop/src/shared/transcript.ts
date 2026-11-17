import type { Message as ModelMessage } from "@earendil-works/pi-ai";
import { IMPORTED_HISTORY_PROVIDER } from "./chat-history-import";
import type { WireEvent } from "./rpc-schema";
export type Message =
  | ModelMessage
  | {
      role: "custom";
      customType: string;
      content: unknown;
      display: boolean;
      details?: unknown;
      timestamp: number;
    };
export type TranscriptRecord = {
  id: string;
  entryId?: string;
  requestId?: string;
  parentId: string | null;
  branchId: string;
  order: number;
  rendererKey?: string;
} & (
  | {
      kind: "message";
      message: Message;
      customType?: string;
      details?: unknown;
      display?: boolean;
    }
  | { kind: "custom-entry"; customType: string; data: unknown }
  | { kind: "session-entry"; entryType: string; data: unknown }
);
/** Persisted bodies are immutable within a history revision; envelopes are not. */
export function recordEnvelope(record: TranscriptRecord) {
  if (record.kind === "message") {
    const { message: _message, details: _details, ...envelope } = record;
    return envelope;
  }
  const { data: _data, ...envelope } = record;
  return envelope;
}

export function recordPayload(record: TranscriptRecord) {
  return record.kind === "message"
    ? {
        message: record.message,
        ...(Object.hasOwn(record, "details")
          ? { details: record.details }
          : {}),
      }
    : { data: record.data };
}

export interface Transcript {
  /** Cursor is bound to the selected branch, not to a changing live leaf. */
  history?: { revision: string; before?: string };
  records: TranscriptRecord[];
  tools: Record<
    string,
    { status: "running" | "done" | "error"; result?: unknown }
  >;
  current: string | null;
  running: boolean;
  compaction?: { reason: "manual" | "threshold" | "overflow" };
  liveToEntry: Record<string, string>;
}
export const emptyTranscript = (): Transcript => ({
  records: [],
  tools: {},
  current: null,
  running: false,
  liveToEntry: {},
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
    else
      state.records.push({
        id: `history:${state.records.length}`,
        parentId: null,
        branchId: "root",
        order: state.records.length,
        kind: "message",
        message,
      });
  }
  return state;
}

export interface ResponseStats {
  imported?: boolean;
  /** Turn index of the prompting user message, if it is in the transcript. */
  userIndex?: number;
  stopReason: string;
  durationMs: number;
  endedAt: number;
  /** Request start of the last assistant message; identifies it for forking. */
  timestamp: number;
  tools: number;
  totalTokens: number;
  /** Breakdown of `totalTokens`, summed over the response's assistant messages. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Model requests (assistant messages) in the response. */
  requests: number;
  /** pi-ai's list-price estimate in USD; 0 when pricing is unknown. */
  cost: number;
  tokensPerSecond?: number;
  model: string;
  text: string;
}

/** Aggregates the assistant messages between the previous user turn and `end`. */
export function responseStats(
  turns: readonly { message: Message }[],
  end: number,
): ResponseStats | undefined {
  const last = turns[end]?.message;
  if (last?.role !== "assistant") return;
  const imported = last.provider === IMPORTED_HISTORY_PROVIDER;
  let userIndex: number | undefined;
  let tools = 0;
  let totalTokens = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let requests = 0;
  let cost = 0;
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
    if (message.provider !== IMPORTED_HISTORY_PROVIDER) {
      const usage = message.usage;
      totalTokens += usage.totalTokens;
      input += usage.input;
      output += usage.output;
      cacheRead += usage.cacheRead;
      cacheWrite += usage.cacheWrite;
      cost += usage.cost?.total ?? 0;
      requests++;
    }
    if (message.durationMs && message.provider !== IMPORTED_HISTORY_PROVIDER) {
      timedOutput += message.usage.output;
      timedMs += message.durationMs;
    }
    const parts: string[] = [];
    for (const block of message.content)
      if (block.type === "toolCall") tools++;
      else if (block.type === "text" && block.text.trim())
        parts.push(block.text);
    text.push(...parts.reverse());
  }
  const endedAt = last.timestamp + (last.durationMs ?? 0);
  return {
    ...(imported ? { imported: true } : {}),
    userIndex,
    stopReason: last.stopReason,
    durationMs: imported ? 0 : Math.max(0, endedAt - start),
    endedAt,
    timestamp: last.timestamp,
    tools,
    totalTokens,
    input,
    output,
    cacheRead,
    cacheWrite,
    requests,
    cost,
    tokensPerSecond: timedMs ? (timedOutput * 1000) / timedMs : undefined,
    model: last.model,
    text: text.reverse().join("\n\n"),
  };
}
