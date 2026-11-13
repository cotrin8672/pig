import type { RuntimeEvent } from "../shared/runtime-contract";
import {
  type RecordPayloadRef,
  type RuntimeWireEvent,
  snapshotAddressKey,
} from "../shared/snapshot-delta";
import type { TranscriptRecord } from "../shared/transcript";
import { packRuntimeEvent } from "./transcript-wire";

/** Cache only IDs/revisions, never transcript bodies. Full RPC/reconnect replies
 * stay self-contained. Every live metadata field and record order is still sent. */
export function createRuntimeDeltaEncoder() {
  const bases = new Map<string, { revision: string; entries: Set<string> }>();
  return (event: RuntimeEvent): RuntimeWireEvent => {
    if (event.type === "closed") {
      bases.delete(snapshotAddressKey(event.address));
      return event;
    }
    if (event.type === "opening") {
      if (event.previous) bases.delete(snapshotAddressKey(event.previous));
      return event;
    }
    if (event.type === "replaced")
      bases.delete(snapshotAddressKey(event.previous));
    const packed = packRuntimeEvent(event);
    if (!("snapshot" in packed)) return packed;
    const snapshot = packed.snapshot;
    const revision = snapshot.transcript.history?.revision;
    const key = snapshotAddressKey(snapshot.address);
    const previous = bases.get(key);
    const eligible = (record: TranscriptRecord) =>
      !!record.entryId && record.id === record.entryId;
    if (!revision) {
      bases.delete(key);
      return packed;
    }
    bases.set(key, {
      revision,
      entries: new Set(
        snapshot.transcript.records.filter(eligible).map((record) => record.id),
      ),
    });
    if (event.type !== "snapshot" || previous?.revision !== revision)
      return packed;
    let referenced = false;
    const records = snapshot.transcript.records.map((record) => {
      if (!eligible(record) || !previous.entries.has(record.id)) return record;
      const {
        message: _message,
        data: _data,
        details: _details,
        ...envelope
      } = record as unknown as Record<string, unknown>;
      referenced = true;
      return { ...envelope, payloadRef: record.id } as RecordPayloadRef;
    });
    return referenced
      ? {
          type: "snapshotDelta",
          snapshot: {
            ...snapshot,
            transcript: { ...snapshot.transcript, records },
          },
        }
      : packed;
  };
}
