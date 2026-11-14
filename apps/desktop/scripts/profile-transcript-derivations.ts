// Offline synthetic data only: no user sessions, extensions or credentials.
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { isVisibleRecord } from "../src/mainview/custom-data";
import { modelDividers } from "../src/mainview/model-dividers";
import { createResponseFooterIndex } from "../src/mainview/response-footers";
import { transcriptRequestIds } from "../src/mainview/transcript-requests";
import { createFinishedWorkIndex } from "../src/shared/tool-view";
import type { TranscriptRecord } from "../src/shared/transcript";

function originalModelDividers(records: TranscriptRecord[]) {
  type Model = { provider: string; id: string };
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

const iterations = 100;
for (const count of [100, 1000, 10000]) {
  const saved: TranscriptRecord[] = Array.from({ length: count }, (_, i) => ({
    id: `saved-${i}`,
    entryId: `saved-${i}`,
    requestId: `request-${Math.floor(i / 10)}`,
    parentId: i ? `saved-${i - 1}` : null,
    branchId: "synthetic",
    order: i,
    kind: "message",
    message:
      i % 10 === 0
        ? { role: "user", content: "Synthetic question", timestamp: i }
        : {
            ...fauxAssistantMessage("Synthetic answer. ".repeat(256)),
            model: Math.floor(i / 10) % 2 ? "model-a" : "model-b",
          },
  }));
  const live = (token: number): TranscriptRecord => ({
    id: "live",
    parentId: saved.at(-1)?.id ?? null,
    branchId: "synthetic",
    order: count,
    kind: "message",
    message: fauxAssistantMessage(`Streaming ${token}`),
  });
  const work = createFinishedWorkIndex(isVisibleRecord);
  const footers = createResponseFooterIndex();
  work(saved, true, "revision");
  footers(saved, true, "revision");
  const timings = new Map<string, number[]>();
  let checksum = 0;
  const measure = (name: string, run: () => unknown) => {
    const start = performance.now();
    const value = run();
    const elapsed = performance.now() - start;
    if (value instanceof Map || value instanceof Set) checksum += value.size;
    const samples = timings.get(name) ?? [];
    samples.push(elapsed);
    timings.set(name, samples);
  };
  for (let token = 0; token < iterations; token++) {
    // Match streaming: saved identities survive; the live suffix/array changes.
    const records = [...saved, live(token)];
    measure("model-dividers-original", () => originalModelDividers(records));
    measure("model-dividers", () => modelDividers(records));
    // Chat, Composer, optimistic bubbles, and reconciliation previously built
    // their own sets. New paths do not call the index at all without a send.
    measure("request-ids-four-consumers", () => {
      for (let i = 0; i < 4; i++)
        new Set(records.map((record) => record.requestId));
    });
    measure("request-id-index-four-consumers", () => {
      for (let i = 0; i < 4; i++) transcriptRequestIds(records);
    });
    measure("finished-work-index", () => work(records, true, "revision"));
    measure("response-footer-index", () => footers(records, true, "revision"));
  }
  console.info(
    JSON.stringify({
      savedRecords: count,
      iterations,
      checksum,
      scope: "Bun helper CPU only; not WebView, input latency or real symptoms",
      phases: Object.fromEntries(
        [...timings].map(([name, samples]) => {
          samples.sort((a, b) => a - b);
          return [
            name,
            {
              meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
              p50Ms: samples[Math.floor(samples.length * 0.5)],
              p95Ms: samples[Math.floor(samples.length * 0.95)],
            },
          ];
        }),
      ),
    }),
  );
}
