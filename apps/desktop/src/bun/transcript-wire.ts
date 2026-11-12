import type { Snapshot } from "../shared/rpc-schema";
import type {
  OpenState,
  RuntimeEvent,
  RuntimeViewState,
} from "../shared/runtime-contract";
import type { Transcript } from "../shared/transcript";
import type { WireTranscript } from "../shared/transcript-wire";

/** Keep SDK projections intact; only the RPC packet omits repeated payloads. */
export function packTranscript(transcript: Transcript): WireTranscript {
  const tools = { ...transcript.tools };
  const toolResultRefs: Record<string, string> = Object.create(null);
  for (const record of transcript.records) {
    if (record.kind !== "message" || record.message.role !== "toolResult")
      continue;
    const message = record.message;
    const id = message.toolCallId;
    if (Object.hasOwn(toolResultRefs, id)) continue;
    const state = tools[id];
    const result = state?.result;
    if (!result || typeof result !== "object" || Array.isArray(result))
      continue;
    const payload = result as Record<string, unknown>;
    // Live/extension output can differ from persistence: never replace it by ID alone.
    if (
      !Bun.deepEquals(payload.content, message.content) ||
      !Bun.deepEquals(payload.details, message.details)
    )
      continue;
    const { content: _content, details: _details, ...metadata } = payload;
    tools[id] = { ...state, result: metadata };
    toolResultRefs[id] = record.id;
  }
  return Object.keys(toolResultRefs).length
    ? { ...transcript, tools, toolResultRefs }
    : transcript;
}

export function packSnapshot(snapshot: Snapshot): Snapshot {
  const transcript = packTranscript(snapshot.transcript);
  return transcript === snapshot.transcript
    ? snapshot
    : { ...snapshot, transcript };
}

export function packRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  return "snapshot" in event
    ? { ...event, snapshot: packSnapshot(event.snapshot) }
    : event;
}

export function packOpenState(state: OpenState): OpenState {
  return state.state === "ready"
    ? { ...state, snapshot: packSnapshot(state.snapshot) }
    : state;
}

export function packRuntimeState(state: RuntimeViewState): RuntimeViewState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.snapshot
        ? { ...session, snapshot: packSnapshot(session.snapshot) }
        : session,
    ),
  };
}
