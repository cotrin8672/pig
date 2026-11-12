import type { ModelInfo } from "../shared/rpc-schema";
import type { TranscriptRecord } from "../shared/transcript";

type Model = Pick<ModelInfo, "provider" | "id">;

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
      const model = { provider: message.provider, id: message.model };
      // Picker changes are intent; only an actual response commits a change.
      if (
        !answered &&
        previous &&
        (previous.provider !== model.provider || previous.id !== model.id)
      )
        changes.set(userId ?? record.id, { from: previous, to: model });
      previous = model;
      answered = true;
    }
  }
  return changes;
}
