import { type ContentAppend, expandContentAppend } from "./content-append";
import type { Snapshot } from "./rpc-schema";
import type { RuntimeEvent, SessionAddress } from "./runtime-contract";
import {
  recordPayload,
  type Transcript,
  type TranscriptRecord,
} from "./transcript";
import { transcriptIndex } from "./transcript-index";
import {
  transcriptWireBase,
  unpackTranscript,
  type WireTranscript,
} from "./transcript-wire";

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
  /** Whole-record/tool references require the exact last publication, unlike
   * immutable persisted-body references, which only require the same revision. */
  reuse?: {
    baseSeq: number;
    /** Reuse all preceding wire tools except complete replacements, or supply
     * the exact surviving reference IDs when membership changed. */
    tools: string[] | "remaining";
    /** Unchanged wire order: its records are the UI's suffix, after any
     * explicitly prepended history. Only changed rows are transmitted. */
    recordCount?: number;
  };
  appends?: {
    baseSeq: number;
    records: Record<string, ContentAppend[]>;
    tools: Record<string, ContentAppend[]>;
  };
  snapshot: Omit<Snapshot, "transcript"> & {
    transcript: Omit<WireTranscript, "records"> & {
      records: (TranscriptRecord | RecordPayloadRef | string)[];
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
  const reuse = event.reuse;
  if (
    !reuse &&
    !appends &&
    !snapshot.transcript.records.some(
      (record) =>
        record && typeof record === "object" && "payloadRef" in record,
    )
  )
    return undefined;
  if (
    reuse &&
    (!Number.isSafeInteger(reuse.baseSeq) ||
      reuse.baseSeq !== current.snapshotSeq ||
      reuse.baseSeq >= snapshot.snapshotSeq ||
      (reuse.tools !== "remaining" &&
        (!Array.isArray(reuse.tools) ||
          reuse.tools.some((id) => typeof id !== "string" || !id) ||
          new Set(reuse.tools).size !== reuse.tools.length)))
  )
    return undefined;
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
  const previousWire = transcriptWireBase(current.transcript);
  if (previousWire.recordCount > current.transcript.records.length)
    return undefined;
  const tail = previousWire.recordCount
    ? current.transcript.records.slice(-previousWire.recordCount)
    : [];
  const tailIds = new Set(tail.map((record) => record.id));
  let wireRecords = snapshot.transcript.records;
  if (reuse?.recordCount !== undefined) {
    const count = reuse.recordCount;
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count !== previousWire.recordCount
    )
      return undefined;
    if (tailIds.size !== count) return undefined;
    const updates = new Map<string, (typeof wireRecords)[number]>();
    for (const record of wireRecords) {
      const id = typeof record === "string" ? record : record?.id;
      if (!tailIds.has(id) || updates.has(id)) return undefined;
      updates.set(id, record);
    }
    wireRecords = tail.map((record) => updates.get(record.id) ?? record.id);
  }
  const records: TranscriptRecord[] = [];
  const expandedRecords = new Set<string>();
  const recordIds = new Set<string>();
  for (const record of wireRecords) {
    const id = typeof record === "string" ? record : record?.id;
    if (typeof id !== "string" || !id || recordIds.has(id)) return undefined;
    recordIds.add(id);
    if (typeof record === "string") {
      const old = previous.get(record);
      if (
        !reuse ||
        !tailIds.has(record) ||
        !old?.entryId ||
        old.entryId !== old.id
      )
        return undefined;
      records.push(old);
      continue;
    }
    if (!record || typeof record !== "object" || Array.isArray(record))
      return undefined;
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
    const previousTools = new Set(previousWire.toolIds);
    const reusedTools =
      reuse?.tools === "remaining"
        ? previousWire.toolIds.filter((id) => !Object.hasOwn(tools, id))
        : (reuse?.tools ?? []);
    for (const id of reusedTools) {
      if (
        !previousTools.has(id) ||
        Object.hasOwn(tools, id) ||
        !Object.hasOwn(current.transcript.tools, id) ||
        current.transcript.tools[id].status === "running" ||
        Object.hasOwn(snapshot.transcript.toolResultRefs ?? {}, id)
      )
        return undefined;
      Object.defineProperty(tools, id, {
        value: current.transcript.tools[id],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
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
