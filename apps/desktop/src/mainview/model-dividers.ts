import type { ModelInfo } from "../shared/rpc-schema";
import type { TranscriptRecord } from "../shared/transcript";

type Model = Readonly<Pick<ModelInfo, "provider" | "id">>;

export function modelDividers(records: TranscriptRecord[]) {
  const changes = new Map<string, { from: Model; to: Model }>();
  let previous: Model | undefined;
  let userId: string | undefined;
  let answered = false;
  for (const record of records) {
    if (record.kind !== "message") continue;
    const { message } = record;
    if (message.role === "user") {
      userId = record.id;
      answered = false;
    } else if (message.role === "assistant") {
      const { provider, model: id } = message;
      // Most assistant steps use the same model. Do not allocate a Model for
      // every saved step on each publication; this is not a history cache.
      if (!previous || previous.provider !== provider || previous.id !== id) {
        const model = { provider, id };
        // Picker changes are intent; only an actual response commits a change.
        if (!answered && previous)
          changes.set(userId ?? record.id, { from: previous, to: model });
        previous = model;
      }
      answered = true;
    }
  }
  return changes;
}
