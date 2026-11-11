import type { Snapshot, WireEvent } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import type { Transcript } from "../shared/transcript";

export type ChatSnapshot = Snapshot;
export const addressKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId, address.epoch]);
export const sameAddress = (a: SessionAddress, b: SessionAddress) =>
  a.hostId === b.hostId && a.sessionId === b.sessionId && a.epoch === b.epoch;

export function hydrateChatSnapshot(snapshot: Snapshot): ChatSnapshot {
  return snapshot;
}

/** Keep explicitly loaded history when the host publishes only its recent tail. */
function retainHistory(current: Transcript, incoming: Transcript): Transcript {
  if (
    !current.history ||
    current.history.revision !== incoming.history?.revision
  )
    return incoming;
  const first = incoming.records[0];
  if (!first) return incoming;
  const ids = new Set(current.records.map((record) => record.id));
  if (
    !incoming.records.some((record) => ids.has(record.id)) &&
    current.records.at(-1)?.entryId !== first.parentId
  )
    return incoming;
  const prefix = current.records.filter((record) => record.order < first.order);
  if (!prefix.length) return incoming;
  return {
    ...incoming,
    records: [...prefix, ...incoming.records],
    tools: { ...current.tools, ...incoming.tools },
    history: current.history,
  };
}

export function prependHistory(
  current: Snapshot,
  page: Transcript,
  before: string,
): Snapshot {
  if (
    !page.history ||
    page.history.revision !== current.transcript.history?.revision ||
    current.transcript.history.before !== before
  )
    return current;
  return {
    ...current,
    transcript: {
      ...current.transcript,
      records: [...page.records, ...current.transcript.records],
      tools: { ...page.tools, ...current.transcript.tools },
      history: page.history,
    },
  };
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
    transcript: retainHistory(snapshot.transcript, event.transcript),
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
  return sameAddress(current.address, incoming.address)
    ? {
        ...incoming,
        modelCatalog: incoming.modelCatalog ?? current.modelCatalog,
        transcript: retainHistory(current.transcript, incoming.transcript),
      }
    : incoming;
}
