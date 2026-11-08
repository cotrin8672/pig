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
