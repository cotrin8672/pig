import type { LiveState } from "@earendil-works/pi-durable";
import type { Snapshot, WireEvent } from "../shared/rpc-schema";

/** UI state also accepts failure details on hydrated snapshots when supplied. */
export type ChatSnapshot = Snapshot & {
  failure?: string;
  aborted?: boolean;
  live?: LiveState;
};

export function hydrateChatSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  const failure = snapshot.live?.runFailure;
  const compaction = snapshot.live?.compactionFailure;
  return {
    ...snapshot,
    failure:
      snapshot.failure ??
      (failure && failure.reason !== "aborted"
        ? (failure.detail ?? failure.reason)
        : undefined) ??
      compaction?.error,
    aborted: snapshot.aborted ?? failure?.reason === "aborted",
  };
}

export function applyChatEvent(
  snapshot: ChatSnapshot,
  event: WireEvent,
): ChatSnapshot {
  return {
    ...snapshot,
    transcript: event.transcript,
    failure: event.failure,
    aborted: event.aborted,
    // The event is authoritative, including recovery from a previous failure.
    live: undefined,
  };
}
