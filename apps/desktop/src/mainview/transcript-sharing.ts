import {
  recordPayload,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";

function shallowEqual(a: object, b: object) {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  );
}

function sameEnvelope(a: TranscriptRecord, b: TranscriptRecord) {
  // Reuse the whole record only when every envelope field is unchanged.
  const {
    message: _am,
    data: _ad,
    details: _ax,
    ...left
  } = a as unknown as Record<string, unknown>;
  const {
    message: _bm,
    data: _bd,
    details: _bx,
    ...right
  } = b as unknown as Record<string, unknown>;
  return shallowEqual(left, right);
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
  const previous = new Map(
    current.records.map((record) => [record.id, record]),
  );
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
          shallowEqual(canonical, prior.result)
            ? prior
            : { ...state, result: canonical };
        changed ||= tools[id] !== state;
      }
    }
    return shared;
  });
  return changed ? { ...incoming, records, tools } : incoming;
}
