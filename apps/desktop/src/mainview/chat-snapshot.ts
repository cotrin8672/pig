import type { Snapshot, WireEvent } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";

export type ChatSnapshot = Snapshot;
export const addressKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId, address.epoch]);
export const sameAddress = (a: SessionAddress, b: SessionAddress) =>
  a.hostId === b.hostId && a.sessionId === b.sessionId && a.epoch === b.epoch;

export function hydrateChatSnapshot(snapshot: Snapshot): ChatSnapshot {
  return snapshot;
}

/** Publications are monotonic within one epoch, never across owners. */
export function applyChatEvent(
  snapshot: ChatSnapshot,
  event: WireEvent,
): ChatSnapshot {
  if (
    !sameAddress(snapshot.address, event.address) ||
    event.snapshotSeq <= snapshot.snapshotSeq
  )
    return snapshot;
  return {
    ...snapshot,
    snapshotSeq: event.snapshotSeq,
    transcript: event.transcript,
    failure: event.failure,
    aborted: event.aborted,
    sessionUI: event.sessionUI,
    configError: event.configError,
  };
}

export function newerSnapshot(
  current: Snapshot | undefined,
  incoming: Snapshot,
): Snapshot {
  if (!current) return incoming;
  if (current.address.hostId !== incoming.address.hostId) return current;
  if (incoming.address.epoch < current.address.epoch) return current;
  if (
    sameAddress(current.address, incoming.address) &&
    incoming.snapshotSeq <= current.snapshotSeq
  )
    return current;
  return incoming;
}
