import {
  type ContentBase,
  contentBase,
  encodeContentAppend,
} from "../shared/content-append";
import type { RuntimeEvent, SessionAddress } from "../shared/runtime-contract";
import {
  type RecordPayloadRef,
  type RuntimeWireEvent,
  type SnapshotDeltaEvent,
  snapshotAddressKey,
} from "../shared/snapshot-delta";
import { recordEnvelope, type TranscriptRecord } from "../shared/transcript";
import { packRuntimeEvent } from "./transcript-wire";

type Base = {
  revision: string;
  seq: number;
  entries: Set<string>;
  records: Map<string, ContentBase>;
  tools: Map<string, ContentBase>;
};

/** Retain IDs and the latest live text only, never saved bodies or SDK objects.
 * Full RPC/reconnect replies stay self-contained and reset the streaming base. */
export function createRuntimeDeltaEncoder() {
  const bases = new Map<string, Base>();
  const encode = (event: RuntimeEvent): RuntimeWireEvent => {
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
    if (previous && snapshot.snapshotSeq <= previous.seq) return packed;
    const base: Base = {
      revision,
      seq: snapshot.snapshotSeq,
      entries: new Set(
        snapshot.transcript.records.filter(eligible).map((record) => record.id),
      ),
      records: new Map(),
      tools: new Map(),
    };
    for (const record of snapshot.transcript.records) {
      if (
        record.entryId ||
        record.kind !== "message" ||
        record.message.role !== "assistant"
      )
        continue;
      const content = contentBase(record.message.content);
      if (content) base.records.set(record.id, content);
    }
    for (const [id, tool] of Object.entries(snapshot.transcript.tools)) {
      if (tool.status !== "running") continue;
      const content = contentBase(
        (tool.result as { content?: unknown } | undefined)?.content,
      );
      if (content) base.tools.set(id, content);
    }
    bases.set(key, base);
    if (event.type !== "snapshot" || previous?.revision !== revision)
      return packed;
    let referenced = false;
    const appends: NonNullable<SnapshotDeltaEvent["appends"]> = {
      baseSeq: previous.seq,
      records: Object.create(null),
      tools: Object.create(null),
    };
    const records = snapshot.transcript.records.map((record) => {
      if (!eligible(record) || !previous.entries.has(record.id)) {
        if (
          !record.entryId &&
          record.kind === "message" &&
          record.message.role === "assistant"
        ) {
          const encoded = encodeContentAppend(
            record.message.content,
            previous.records.get(record.id),
          );
          if (encoded) {
            appends.records[record.id] = encoded.appends;
            return {
              ...record,
              message: { ...record.message, content: encoded.content },
            };
          }
        }
        return record;
      }
      referenced = true;
      return {
        ...recordEnvelope(record),
        entryId: record.id,
        payloadRef: record.id,
      } as RecordPayloadRef;
    });
    const tools = { ...snapshot.transcript.tools };
    for (const [id, tool] of Object.entries(tools)) {
      if (tool.status !== "running") continue;
      const result = tool.result as { content?: unknown[] } | undefined;
      if (!Array.isArray(result?.content)) continue;
      const encoded = encodeContentAppend(
        result.content,
        previous.tools.get(id),
      );
      if (!encoded) continue;
      appends.tools[id] = encoded.appends;
      tools[id] = { ...tool, result: { ...result, content: encoded.content } };
    }
    const appended =
      Object.keys(appends.records).length > 0 ||
      Object.keys(appends.tools).length > 0;
    return referenced || appended
      ? {
          type: "snapshotDelta",
          ...(appended ? { appends } : {}),
          snapshot: {
            ...snapshot,
            transcript: { ...snapshot.transcript, records, tools },
          },
        }
      : packed;
  };
  return Object.assign(encode, {
    reset(address?: SessionAddress) {
      if (address) bases.delete(snapshotAddressKey(address));
      else bases.clear();
    },
  });
}
