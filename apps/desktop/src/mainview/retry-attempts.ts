import type { TranscriptRecord } from "../shared/transcript";

/**
 * Failed assistant attempts the SDK retried, numbered per retry sequence
 * (steering input delivered with a retry does not restart it). The SDK
 * keeps a retried attempt in history and omits it from model context with a
 * `context_edit` whose replacement is null; the final failure is not omitted.
 */
export function retriedAttempts(records: readonly TranscriptRecord[]) {
  const omitted = new Set<string>();
  for (const record of records) {
    if (record.kind !== "session-entry" || record.entryType !== "context_edit")
      continue;
    const edit = record.data as { targetId?: unknown; replacement?: unknown };
    if (typeof edit?.targetId === "string" && edit.replacement === null)
      omitted.add(edit.targetId);
  }
  const attempts = new Map<string, number>();
  if (!omitted.size) return attempts;
  let count = 0;
  for (const record of records) {
    if (record.kind !== "message" || record.message.role !== "assistant")
      continue;
    if (
      record.message.stopReason === "error" &&
      record.entryId &&
      omitted.has(record.entryId)
    )
      attempts.set(record.id, ++count);
    else count = 0;
  }
  return attempts;
}
