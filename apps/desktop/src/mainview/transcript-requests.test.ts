import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import type { PromptAccepted } from "../shared/runtime-contract";
import { emptyTranscript, type TranscriptRecord } from "../shared/transcript";
import { DraftStore, emptyContent } from "./draft-store";
import { SendController } from "./send-controller";
import {
  cancelledRequestIds,
  transcriptRequestIds,
} from "./transcript-requests";

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

test("cancelled queue records never confirm delivery, and successful delivery wins over an old cancellation", () => {
  const cancelled: TranscriptRecord = {
    ...record("cancelled", "request-a"),
    kind: "message",
    message: {
      role: "custom",
      customType: "Cancelled queued prompt",
      display: true,
      content: "not delivered",
      timestamp: 1,
    },
  };
  expect(transcriptRequestIds([cancelled]).has("request-a")).toBe(false);
  expect(cancelledRequestIds([cancelled]).has("request-a")).toBe(true);
  for (const records of [
    [cancelled, record("delivered", "request-a")],
    [record("delivered", "request-a"), cancelled],
  ]) {
    expect(transcriptRequestIds(records).has("request-a")).toBe(true);
    expect(cancelledRequestIds(records).has("request-a")).toBe(false);
  }
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

test.each([
  "sending",
  "checking",
  "unknown",
] as const)("confirmed history resolves a %s send even when its receipt cannot be read", async (status) => {
  const address = { hostId: "lost-receipt", sessionId: "chat", epoch: 1 };
  const drafts = new DraftStore();
  drafts.edit(address, () => ({ ...emptyContent(), text: "日本語で答えて" }));
  const response = Promise.withResolvers<PromptAccepted>();
  let calls = 0;
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (params) => ({
        applied: true,
        draft: { ...params.content, revision: params.expectedRevision + 1 },
      }),
      prompt: () => {
        calls++;
        return response.promise;
      },
      getPromptReceipt: async (key) => {
        if (status === "unknown") throw new Error("Receipt disconnected");
        return { ...key, state: "pending" };
      },
    },
    () => {},
  );
  const sending = sends.send(address);
  while (!calls) await Bun.sleep(0);
  if (status !== "sending") {
    response.reject(new Error("Prompt response lost"));
    await sending;
    if (status === "unknown") {
      await sends.lookup(address);
      await sends.lookup(address);
      await sends.lookup(address);
    }
  }
  expect(sends.read(address)?.state).toBe(status);
  const key = sends.read(address)?.key;
  if (!key) throw new Error("missing send");
  const snapshot: Snapshot = {
    address,
    snapshotSeq: 2,
    info: { id: address.sessionId, cwd: "project", title: "Chat", modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript: {
      ...emptyTranscript(),
      records: [record("saved", key.requestId)],
    },
  };
  // Different requests/epochs cannot confirm this send.
  sends.reconcile({
    ...snapshot,
    transcript: { ...snapshot.transcript, records: [record("other", "other")] },
  });
  sends.reconcile({ ...snapshot, address: { ...address, epoch: 2 } });
  expect(sends.read(address)?.state).toBe(status);
  drafts.edit(address, () => ({ ...emptyContent(), text: "new draft" }));
  sends.reconcile(snapshot);
  expect(sends.read(address)?.state).toBe("accepted");
  expect(sends.optimistic(address)).toEqual([]);
  expect(sends.retained()).toEqual([]);
  expect(drafts.read(address).content.text).toBe("new draft");
  await sends.wait(address);
  // An obsolete RPC failure must not resurrect an already committed message.
  if (status === "sending") {
    response.reject(new Error("late disconnected response"));
    await sending;
  }
  expect(sends.read(address)?.state).toBe("accepted");
  expect(drafts.read(address).content.text).toBe("new draft");
  expect(calls).toBe(status === "unknown" ? 3 : 1);
});
