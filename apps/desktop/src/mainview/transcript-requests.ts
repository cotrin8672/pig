import type { TranscriptRecord } from "../shared/transcript";

// Frontend transcripts replace their records array for any envelope/body edit.
// Weak keys let old pages/branches go; values retain IDs, never records or bodies.
const indexes = new WeakMap<
  readonly TranscriptRecord[],
  {
    delivered: Set<string | undefined>;
    cancelled: Set<string | undefined>;
  }
>();

function index(records: readonly TranscriptRecord[]) {
  let result = indexes.get(records);
  if (!result) {
    result = { delivered: new Set(), cancelled: new Set() };
    for (const record of records) {
      const cancelled =
        record.kind === "message" &&
        record.message.role === "custom" &&
        record.message.customType === "Cancelled queued prompt";
      result[cancelled ? "cancelled" : "delivered"].add(record.requestId);
    }
    // A recovered entry can outlive a later successful delivery.
    for (const id of result.delivered) result.cancelled.delete(id);
    indexes.set(records, result);
  }
  return result;
}

/** Build only when a caller actually has an optimistic/unconfirmed send to check. */
export const transcriptRequestIds = (
  records: readonly TranscriptRecord[],
): ReadonlySet<string | undefined> => index(records).delivered;

export const cancelledRequestIds = (
  records: readonly TranscriptRecord[],
): ReadonlySet<string | undefined> => index(records).cancelled;
