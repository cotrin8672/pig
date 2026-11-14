import type { TranscriptRecord } from "../shared/transcript";

// Frontend transcripts replace their records array for any envelope/body edit.
// Weak keys let old pages/branches go; values retain IDs, never records or bodies.
const indexes = new WeakMap<
  readonly TranscriptRecord[],
  ReadonlySet<string | undefined>
>();

/** Build only when a caller actually has an optimistic/unconfirmed send to check. */
export function transcriptRequestIds(records: readonly TranscriptRecord[]) {
  let ids = indexes.get(records);
  if (!ids) {
    ids = new Set(records.map((record) => record.requestId));
    indexes.set(records, ids);
  }
  return ids;
}
