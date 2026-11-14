import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript, type TranscriptRecord } from "../shared/transcript";
import { DraftStore, emptyContent } from "./draft-store";
import { SendController } from "./send-controller";
import { transcriptRequestIds } from "./transcript-requests";

const record = (id: string, requestId?: string): TranscriptRecord => ({
  id,
  entryId: id,
  requestId,
  parentId: null,
  branchId: "branch",
  order: 0,
  kind: "message",
  message: { role: "user", content: "Full body", timestamp: 1 },
});

test("request IDs are scanned once across consumers of the same immutable records array", () => {
  let visits = 0;
  const records = new Proxy([record("a", "request-a"), record("b")], {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  const ids = transcriptRequestIds(records);
  for (let i = 0; i < 100; i++) expect(transcriptRequestIds(records)).toBe(ids);
  expect([...ids]).toEqual(["request-a", undefined]);
  expect(visits).toBe(2);
});

test("request ID metadata changes/removals, prepend, branch, reorder and persistence use the new array", () => {
  const a = record("a", "old-request");
  const b = record("b", "request-b");
  const original = [a, b];
  const before = transcriptRequestIds(original);
  const { requestId: _, ...withoutRequest } = a;
  const cases: TranscriptRecord[][] = [
    [...original, record("appended", "new-request")],
    [record("prepended", "earlier-request"), ...original],
    [{ ...a, requestId: "updated-request" }, b],
    [withoutRequest, b],
    [b, a],
    [record("different-branch", "branch-request")],
    [{ ...a, id: "saved-a", entryId: "saved-a" }],
    [],
  ];
  for (const records of cases) {
    expect(transcriptRequestIds(records)).toEqual(
      new Set(records.map((item) => item.requestId)),
    );
    expect(transcriptRequestIds(records)).not.toBe(before);
  }
  expect([...before]).toEqual(["old-request", "request-b"]);
});

test("reconciliation reads no history without a matching accepted send, then releases the optimistic copy", async () => {
  const address = { hostId: "request-index", sessionId: "chat", epoch: 1 };
  const drafts = new DraftStore();
  drafts.edit(address, () => ({ ...emptyContent(), text: "Question" }));
  const sends = new SendController(drafts, {
    syncDraft: async (params) => ({
      applied: true,
      draft: { ...params.content, revision: params.expectedRevision + 1 },
    }),
    prompt: async () => ({ disposition: "started" }),
    getPromptReceipt: async (key) => ({
      ...key,
      state: "unknown",
      reason: "not-found",
    }),
  });
  let reads = 0;
  let records: TranscriptRecord[] = [];
  const transcript = {
    ...emptyTranscript(),
    get records() {
      reads++;
      return records;
    },
  };
  const snapshot: Snapshot = {
    address,
    snapshotSeq: 1,
    info: { id: address.sessionId, cwd: "project", title: "Chat", modified: 1 },
    transcript,
    effort: "off",
    effortLevels: [],
  };
  for (let i = 0; i < 100; i++) sends.reconcile(snapshot);
  expect(reads).toBe(0);
  await sends.send(address);
  expect(sends.optimistic(address)).toHaveLength(1);
  sends.reconcile({ ...snapshot, address: { ...address, epoch: 2 } });
  expect(reads).toBe(0);
  const key = sends.read(address)?.key;
  if (!key) throw new Error("missing send");
  records = [record("echo", key.requestId)];
  sends.reconcile(snapshot);
  expect(reads).toBe(1);
  expect(sends.optimistic(address)).toHaveLength(0);
  for (let i = 0; i < 100; i++) sends.reconcile(snapshot);
  expect(reads).toBe(1);
});
