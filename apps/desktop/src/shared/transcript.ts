import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WireEvent } from "./rpc-schema";

export type Message = AgentSession["messages"][number];
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
  state: Transcript,
  event: WireEvent,
): Transcript {
  if ("parentToolCallId" in event && event.parentToolCallId) return state;
  const put = (message: Message, id = state.turns.length): Transcript => ({
    ...state,
    turns: state.turns.some((turn) => turn.id === id)
      ? state.turns.map((turn) => (turn.id === id ? { id, message } : turn))
      : [...state.turns, { id, message }],
  });
  switch (event.type) {
    case "agent_start":
      return { ...state, running: true };
    case "agent_settled":
      return { ...state, running: false, current: null };
    case "message_start":
      return event.message.role === "assistant"
        ? { ...put(event.message), current: state.turns.length }
        : state;
    case "message_update": {
      const update = event.assistantMessageEvent;
      const message =
        "partial" in update
          ? update.partial
          : update.type === "done"
            ? update.message
            : update.type === "error"
              ? update.error
              : null;
      if (!message) return state;
      const id = state.current ?? state.turns.length;
      return { ...put(message, id), current: id };
    }
    case "message_end": {
      const message = event.message;
      if (message.role === "assistant")
        return {
          ...put(message, state.current ?? state.turns.length),
          current: null,
        };
      if (message.role === "user") return put(message);
      if (
        (message.role === "custom" && message.display) ||
        message.role === "bashExecution" ||
        message.role === "compactionSummary" ||
        message.role === "branchSummary"
      )
        return put(message);
      if (message.role === "toolResult")
        return {
          ...state,
          tools: {
            ...state.tools,
            [message.toolCallId]: {
              status: message.isError ? "error" : "done",
              result: { content: message.content, details: message.details },
            },
          },
        };
      return state;
    }
    case "entry_appended": {
      const entry = event.entry;
      if (entry.type !== "custom_message" || !entry.display) return state;
      return put({
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: Date.parse(entry.timestamp),
      });
    }
    // shortcut: No snapshot reconciliation after compaction/branch navigation;
    // live compaction summaries only appear after reopening the chat.
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return {
        ...state,
        tools: {
          ...state.tools,
          [event.toolCallId]: {
            status:
              event.type === "tool_execution_end"
                ? event.isError
                  ? "error"
                  : "done"
                : "running",
            result:
              event.type === "tool_execution_end"
                ? event.result
                : event.type === "tool_execution_update"
                  ? event.partialResult
                  : undefined,
          },
        },
      };
    default:
      return state;
  }
}

export function hydrate(messages: Message[]): Transcript {
  return messages.reduce(
    (state, message) =>
      reduceTranscript(state, { type: "message_end", message }),
    emptyTranscript(),
  );
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
