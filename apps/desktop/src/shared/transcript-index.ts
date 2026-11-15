import type { TranscriptRecord } from "./transcript";

type RecordIndex = Pick<ReadonlyMap<string, TranscriptRecord>, "get">;
const indexes = new WeakMap<readonly TranscriptRecord[], RecordIndex>();

/** Records arrays are immutable. Values retain records, never earlier arrays. */
export function transcriptIndex(
  records: readonly TranscriptRecord[],
): RecordIndex {
  let index = indexes.get(records);
  if (!index) {
    index = new Map(records.map((record) => [record.id, record]));
    indexes.set(records, index);
  }
  return index;
}

/** A streaming tail must not rebuild the index of explicitly loaded history. */
export function indexTranscriptTail(
  records: readonly TranscriptRecord[],
  prefix: readonly TranscriptRecord[],
  tail: readonly TranscriptRecord[],
) {
  const older = transcriptIndex(prefix);
  const recent = transcriptIndex(tail);
  indexes.set(records, { get: (id) => recent.get(id) ?? older.get(id) });
}
