import type { Snapshot } from "./rpc-schema";
import type { RuntimeEvent, SessionAddress } from "./runtime-contract";
import type { Transcript, TranscriptRecord } from "./transcript";
import { unpackTranscript, type WireTranscript } from "./transcript-wire";

export type RecordPayloadRef = {
  payloadRef: string;
  id: string;
  entryId: string;
  kind: TranscriptRecord["kind"];
  parentId: string | null;
  branchId: string;
  order: number;
  requestId?: string;
  [key: string]: unknown;
};
export type SnapshotDeltaEvent = {
  type: "snapshotDelta";
  snapshot: Omit<Snapshot, "transcript"> & {
    transcript: Omit<WireTranscript, "records"> & {
      records: (TranscriptRecord | RecordPayloadRef)[];
    };
  };
};
export type RuntimeWireEvent = RuntimeEvent | SnapshotDeltaEvent;
export const snapshotAddressKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId, address.epoch]);

/** Missing bases never become partial transcripts. The caller fetches an
 * authoritative full snapshot while leaving the current UI/draft intact. */
export function expandSnapshotDelta(
  event: SnapshotDeltaEvent,
  current?: Snapshot,
): Snapshot | undefined {
  const { snapshot } = event;
  if (
    !current ||
    snapshotAddressKey(current.address) !==
      snapshotAddressKey(snapshot.address) ||
    !current.transcript.history ||
    current.transcript.history.revision !==
      snapshot.transcript.history?.revision
  )
    return undefined;
  const previous = new Map(
    current.transcript.records.map((record) => [record.id, record]),
  );
  const records: TranscriptRecord[] = [];
  for (const record of snapshot.transcript.records) {
    if (!("payloadRef" in record)) {
      records.push(record);
      continue;
    }
    const old = previous.get(record.payloadRef);
    if (
      !old ||
      old.id !== record.id ||
      old.entryId !== record.entryId ||
      old.kind !== record.kind ||
      "message" in record ||
      "data" in record ||
      "details" in record
    )
      return undefined;
    const { payloadRef: _ref, ...envelope } = record;
    records.push({ ...old, ...envelope } as TranscriptRecord);
  }
  try {
    const transcript: Transcript = unpackTranscript({
      ...snapshot.transcript,
      records,
    });
    return { ...snapshot, transcript };
  } catch {
    return undefined;
  }
}
