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
import type { WireTranscript } from "../shared/transcript-wire";
import { packRuntimeEvent } from "./transcript-wire";

type Base = {
  revision: string;
  seq: number;
  entries: Set<string>;
  recordIds: string[];
  envelopes: Map<string, ReturnType<typeof recordEnvelope>>;
  completedTools: Map<string, string>;
  toolIds: Set<string>;
  records: Map<string, ContentBase>;
  tools: Map<string, ContentBase>;
};
const oversizedMetadata = Symbol("oversized tool metadata");

/** Bounded exact wire metadata, never the persisted result's content/details.
 * Unusual/large extension metadata simply stays on the complete wire path. */
function toolSignature(
  tool: WireTranscript["tools"][string],
  resultRef: string | undefined,
) {
  if (tool.status === "running" || !resultRef) return undefined;
  let remaining = 4096;
  try {
    const signature = JSON.stringify([tool, resultRef], (key, value) => {
      remaining -= 8 + key.length;
      if (typeof value === "string") remaining -= value.length;
      else if (value && typeof value === "object") remaining -= 64;
      if (remaining < 0) throw oversizedMetadata;
      return value;
    });
    return signature.length <= 4096 ? signature : undefined;
  } catch {
    return undefined;
  }
}
function sameEnvelope(
  current: TranscriptRecord,
  previous: ReturnType<typeof recordEnvelope> | undefined,
) {
  if (!previous) return false;
  // SAFETY: only read own enumerable fields here; no field type is assumed.
  const left: Record<string, unknown> = current;
  const right = previous as Record<string, unknown>;
  let count = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;
    if (
      current.kind === "message"
        ? key === "message" || key === "details"
        : key === "data"
    )
      continue;
    if (!Object.hasOwn(right, key) || left[key] !== right[key]) return false;
    count++;
  }
  return count === Object.keys(right).length;
}

/** Retain bounded metadata, IDs and latest live text, never saved bodies or SDK objects.
 * Full RPC/reconnect replies stay self-contained and reset the streaming base. */
export function createRuntimeDeltaEncoder() {
  const bases = new Map<string, Base>();
  const encode = (event: RuntimeEvent): RuntimeWireEvent => {
    if (event.type === "suspended") {
      bases.delete(snapshotAddressKey(event.previous));
      return event;
    }
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
    const transcript = snapshot.transcript as WireTranscript;
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
      entries: new Set(),
      recordIds: [],
      envelopes: new Map(),
      completedTools: new Map(),
      toolIds: new Set(Object.keys(transcript.tools)),
      records: new Map(),
      tools: new Map(),
    };
    for (const record of snapshot.transcript.records) {
      base.recordIds.push(record.id);
      if (eligible(record)) {
        base.entries.add(record.id);
        const old =
          previous?.revision === revision
            ? previous.envelopes.get(record.id)
            : undefined;
        if (old && sameEnvelope(record, old)) {
          base.envelopes.set(record.id, old);
          continue;
        }
        const envelope = recordEnvelope(record);
        if (
          Object.values(envelope).every(
            (value) =>
              value === null ||
              ["string", "number", "boolean", "undefined"].includes(
                typeof value,
              ),
          )
        )
          base.envelopes.set(record.id, envelope);
      }
      if (
        record.entryId ||
        record.kind !== "message" ||
        record.message.role !== "assistant"
      )
        continue;
      const content = contentBase(record.message.content);
      if (content) base.records.set(record.id, content);
    }
    let signatureBytes = 0;
    for (const [id, tool] of Object.entries(transcript.tools)) {
      const resultRef = transcript.toolResultRefs?.[id];
      const signature =
        resultRef && base.entries.has(resultRef)
          ? toolSignature(tool, resultRef)
          : undefined;
      const bytes = signature ? 128 + (id.length + signature.length) * 2 : 0;
      if (signature && signatureBytes + bytes <= 512 * 1024) {
        base.completedTools.set(id, signature);
        signatureBytes += bytes;
      }
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
    let reusedRecords = false;
    const appends: NonNullable<SnapshotDeltaEvent["appends"]> = {
      baseSeq: previous.seq,
      records: Object.create(null),
      tools: Object.create(null),
    };
    const sameOrder =
      base.recordIds.length === previous.recordIds.length &&
      base.recordIds.every((id, index) => id === previous.recordIds[index]);
    const sameTools =
      base.toolIds.size === previous.toolIds.size &&
      [...base.toolIds].every((id) => previous.toolIds.has(id));
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
      if (
        base.envelopes.has(record.id) &&
        base.envelopes.get(record.id) === previous.envelopes.get(record.id)
      ) {
        reusedRecords = true;
        return record.id;
      }
      return {
        ...recordEnvelope(record),
        entryId: record.id,
        payloadRef: record.id,
      } as RecordPayloadRef;
    });
    const { toolResultRefs: _refs, ...plainTranscript } = transcript;
    const toolResultRefs = { ...transcript.toolResultRefs };
    const tools = { ...transcript.tools };
    const reusedTools: string[] = [];
    for (const [id, tool] of Object.entries(tools)) {
      const signature = base.completedTools.get(id);
      if (signature && signature === previous.completedTools.get(id)) {
        reusedTools.push(id);
        delete tools[id];
        delete toolResultRefs[id];
        continue;
      }
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
    return referenced || appended || reusedTools.length
      ? {
          type: "snapshotDelta",
          ...(reusedRecords || reusedTools.length
            ? {
                reuse: {
                  baseSeq: previous.seq,
                  tools: sameTools ? "remaining" : reusedTools,
                  ...(reusedRecords && sameOrder
                    ? { recordCount: previous.recordIds.length }
                    : {}),
                },
              }
            : {}),
          ...(appended ? { appends } : {}),
          snapshot: {
            ...snapshot,
            transcript: {
              ...plainTranscript,
              records:
                reusedRecords && sameOrder
                  ? records.filter((record) => typeof record !== "string")
                  : records,
              tools,
              ...(Object.keys(toolResultRefs).length ? { toolResultRefs } : {}),
            },
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
