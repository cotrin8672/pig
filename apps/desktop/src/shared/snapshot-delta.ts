import { type ContentAppend, expandContentAppend } from "./content-append";
import type { Snapshot } from "./rpc-schema";
import type { RuntimeEvent, SessionAddress } from "./runtime-contract";
import {
  recordPayload,
  type Transcript,
  type TranscriptRecord,
} from "./transcript";
import { transcriptIndex } from "./transcript-index";
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
  appends?: {
    baseSeq: number;
    records: Record<string, ContentAppend[]>;
    tools: Record<string, ContentAppend[]>;
  };
  snapshot: Omit<Snapshot, "transcript"> & {
    transcript: Omit<WireTranscript, "records"> & {
      records: (TranscriptRecord | RecordPayloadRef)[];
    };
  };
};
export type RuntimeWireEvent = RuntimeEvent | SnapshotDeltaEvent;
export const snapshotAddressKey = (address: SessionAddress) =>
  JSON.stringify([address.hostId, address.sessionId, address.epoch]);

function validAppendTable(table: unknown) {
  return (
    !!table &&
    typeof table === "object" &&
    !Array.isArray(table) &&
    Object.values(table).every(Array.isArray)
  );
}

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
  const appends = event.appends;
  if (
    appends &&
    (!Number.isSafeInteger(appends.baseSeq) ||
      appends.baseSeq !== current.snapshotSeq ||
      appends.baseSeq >= snapshot.snapshotSeq ||
      !validAppendTable(appends.records) ||
      !validAppendTable(appends.tools))
  )
    return undefined;
  const previous = transcriptIndex(current.transcript.records);
  const records: TranscriptRecord[] = [];
  const expandedRecords = new Set<string>();
  for (const record of snapshot.transcript.records) {
    if (!("payloadRef" in record)) {
      const patches =
        appends && Object.hasOwn(appends.records, record.id)
          ? appends.records[record.id]
          : undefined;
      if (!patches) {
        records.push(record);
        continue;
      }
      const old = previous.get(record.id);
      if (
        expandedRecords.has(record.id) ||
        record.entryId ||
        record.kind !== "message" ||
        record.message.role !== "assistant" ||
        old?.kind !== "message" ||
        old.message.role !== "assistant"
      )
        return undefined;
      const content = expandContentAppend(
        record.message.content,
        old.message.content,
        patches,
      );
      if (!content) return undefined;
      records.push({ ...record, message: { ...record.message, content } });
      expandedRecords.add(record.id);
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
    records.push({ ...envelope, ...recordPayload(old) } as TranscriptRecord);
  }
  if (appends && expandedRecords.size !== Object.keys(appends.records).length)
    return undefined;
  try {
    const tools = { ...snapshot.transcript.tools };
    for (const [id, patches] of Object.entries(appends?.tools ?? {})) {
      if (
        !Object.hasOwn(tools, id) ||
        !Object.hasOwn(current.transcript.tools, id) ||
        tools[id].status !== "running" ||
        current.transcript.tools[id].status !== "running" ||
        Object.hasOwn(snapshot.transcript.toolResultRefs ?? {}, id)
      )
        return undefined;
      const result = tools[id].result as { content?: unknown[] } | undefined;
      const old = current.transcript.tools[id].result as
        | { content?: unknown[] }
        | undefined;
      if (!Array.isArray(result?.content)) return undefined;
      const content = expandContentAppend(
        result.content,
        old?.content,
        patches,
      );
      if (!content) return undefined;
      tools[id] = { ...tools[id], result: { ...result, content } };
    }
    const transcript: Transcript = unpackTranscript({
      ...snapshot.transcript,
      records,
      tools,
    });
    return { ...snapshot, transcript };
  } catch {
    return undefined;
  }
}
