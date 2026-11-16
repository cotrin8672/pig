import { createModelCatalogCache } from "../shared/model-catalog-cache";
import type { Snapshot, WireEvent } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import type { Transcript, TranscriptRecord } from "../shared/transcript";
import {
  indexTranscriptTail,
  transcriptIndex,
} from "../shared/transcript-index";
import {
  preserveTranscriptWireBase,
  unpackTranscript,
} from "../shared/transcript-wire";
import { shareTranscript } from "./transcript-sharing";

export type ChatSnapshot = Snapshot & {
  /** A cold SDK generation must not remount the existing conversation/editor. */
  viewEpoch?: number;
};
export const addressKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId, address.epoch]);
export const chatViewKey = (snapshot: ChatSnapshot) =>
  addressKey({
    ...snapshot.address,
    epoch: snapshot.viewEpoch ?? snapshot.address.epoch,
  });
export const sameAddress = (a: SessionAddress, b: SessionAddress) =>
  a.hostId === b.hostId && a.sessionId === b.sessionId && a.epoch === b.epoch;

const shareModelCatalog = createModelCatalogCache();
export function hydrateChatSnapshot(snapshot: Snapshot): ChatSnapshot {
  const transcript = unpackTranscript(snapshot.transcript);
  const modelCatalog = snapshot.modelCatalog
    ? shareModelCatalog(snapshot.modelCatalog)
    : undefined;
  return transcript === snapshot.transcript &&
    modelCatalog === snapshot.modelCatalog
    ? snapshot
    : { ...snapshot, transcript, ...(modelCatalog ? { modelCatalog } : {}) };
}

/** Keep explicitly loaded history when the host publishes only its recent tail. */
const retainedPrefixes = new WeakMap<
  Transcript,
  { firstId: string; firstOrder: number; records: TranscriptRecord[] }
>();
function retainHistory(current: Transcript, incoming: Transcript): Transcript {
  if (
    !current.history ||
    current.history.revision !== incoming.history?.revision
  )
    return incoming;
  const first = incoming.records[0];
  if (!first) return incoming;
  const retained = retainedPrefixes.get(current);
  let prefix: TranscriptRecord[];
  if (retained?.firstId === first.id && retained.firstOrder === first.order)
    prefix = retained.records;
  else {
    const previous = transcriptIndex(current.records);
    if (
      !incoming.records.some((record) => previous.get(record.id)) &&
      current.records.at(-1)?.entryId !== first.parentId
    )
      return incoming;
    prefix = current.records.filter((record) => record.order < first.order);
  }
  if (!prefix.length) return incoming;
  const transcript = {
    ...incoming,
    records: [...prefix, ...incoming.records],
    tools: { ...current.tools, ...incoming.tools },
    history: current.history,
  };
  indexTranscriptTail(transcript.records, prefix, incoming.records);
  preserveTranscriptWireBase(incoming, transcript);
  retainedPrefixes.set(transcript, {
    firstId: first.id,
    firstOrder: first.order,
    records: prefix,
  });
  return transcript;
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
  page = unpackTranscript(page);
  return {
    ...current,
    transcript: preserveTranscriptWireBase(current.transcript, {
      ...current.transcript,
      records: [...page.records, ...current.transcript.records],
      tools: { ...page.tools, ...current.transcript.tools },
      history: page.history,
    }),
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
    transcript: retainHistory(
      snapshot.transcript,
      shareTranscript(snapshot.transcript, unpackTranscript(event.transcript)),
    ),
    failure: event.failure,
    aborted: event.aborted,
    retry: event.retry,
    sessionUI: event.sessionUI,
    configError: event.configError,
  };
}

export function newerSnapshot(
  current: ChatSnapshot | undefined,
  incoming: Snapshot,
): ChatSnapshot {
  if (!current) return hydrateChatSnapshot(incoming);
  if (current.address.hostId !== incoming.address.hostId) return current;
  if (incoming.address.epoch < current.address.epoch) return current;
  if (
    sameAddress(current.address, incoming.address) &&
    incoming.snapshotSeq <= current.snapshotSeq
  )
    return current;
  incoming = hydrateChatSnapshot(incoming);
  return sameAddress(current.address, incoming.address)
    ? {
        ...incoming,
        ...(current.viewEpoch !== undefined
          ? { viewEpoch: current.viewEpoch }
          : {}),
        modelCatalog: incoming.modelCatalog ?? current.modelCatalog,
        transcript: retainHistory(
          current.transcript,
          shareTranscript(current.transcript, incoming.transcript),
        ),
      }
    : incoming;
}
