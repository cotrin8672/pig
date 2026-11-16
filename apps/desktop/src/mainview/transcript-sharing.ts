import {
  recordEnvelope,
  recordPayload,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";
import { transcriptIndex } from "../shared/transcript-index";
import { preserveTranscriptWireBase } from "../shared/transcript-wire";

function shallowEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
) {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  );
}

function sameEnvelope(a: TranscriptRecord, b: TranscriptRecord) {
  // Reuse the whole record only when every envelope field is unchanged.
  return shallowEqual(recordEnvelope(a), recordEnvelope(b));
}

/** Restore identities lost to IPC, without deep-comparing large output strings. */
export function shareTranscript(
  current: Transcript,
  incoming: Transcript,
): Transcript {
  if (
    !current.history ||
    current.history.revision !== incoming.history?.revision
  )
    return incoming;
  const previous = transcriptIndex(current.records);
  const tools = { ...incoming.tools };
  let changed = false;
  const records = incoming.records.map((record) => {
    const old = previous.get(record.id);
    if (
      !old?.entryId ||
      old.entryId !== record.entryId ||
      old.kind !== record.kind
    )
      return record;
    // Wire reuse already restored these identities; do not rebuild their metadata.
    if (
      old === record &&
      (record.kind !== "message" ||
        record.message.role !== "toolResult" ||
        incoming.tools[record.message.toolCallId] ===
          current.tools[record.message.toolCallId])
    )
      return old;
    const shared = sameEnvelope(old, record)
      ? old
      : ({ ...record, ...recordPayload(old) } as TranscriptRecord);
    changed ||= shared !== record;
    if (
      old.kind === "message" &&
      old.message.role === "toolResult" &&
      record.kind === "message" &&
      record.message.role === "toolResult"
    ) {
      const id = record.message.toolCallId;
      const state = tools[id];
      const result = state?.result;
      // Only canonical payload references may be substituted. An extension's
      // live output can legitimately differ from the persisted tool result.
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        "content" in result &&
        result.content === record.message.content &&
        (result as { details?: unknown }).details === record.message.details
      ) {
        const canonical = {
          ...result,
          content: old.message.content,
          ...(old.message.details !== undefined
            ? { details: old.message.details }
            : {}),
        };
        const prior = current.tools[id];
        const { result: _result, ...metadata } = state;
        const { result: _priorResult, ...priorMetadata } = prior ?? {};
        tools[id] =
          prior?.result &&
          typeof prior.result === "object" &&
          shallowEqual(metadata, priorMetadata) &&
          shallowEqual(canonical, prior.result as Record<string, unknown>)
            ? prior
            : { ...state, result: canonical };
        changed ||= tools[id] !== state;
      }
    }
    return shared;
  });
  return changed
    ? preserveTranscriptWireBase(incoming, { ...incoming, records, tools })
    : incoming;
}
