import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import type {
  DraftSyncParams,
  PromptReceipt,
  SendIntent,
  SendKey,
} from "../shared/runtime-contract";
import { emptyTranscript, type TranscriptRecord } from "../shared/transcript";
import { DraftStore, emptyContent } from "./draft-store";
import { SendController } from "./send-controller";

const address = { hostId: "steering", sessionId: "chat", epoch: 1 };
const content = {
  text: "first",
  pastes: [],
  images: [
    {
      id: "image",
      image: { type: "image" as const, mimeType: "image/png", data: "YWJj" },
    },
  ],
  files: [{ id: "file", name: "notes", path: "/notes" }],
};
const key = { ...address, requestId: "first" };
const intent: SendIntent = {
  receipt: {
    ...key,
    state: "accepted",
    accepted: { disposition: "queued" },
    acceptedAt: 1,
  },
  content,
  delivery: "steer",
  hash: "hash",
  draftRevision: 1,
  owner: {
    cwd: "/project",
    sessionFile: "/project/chat.jsonl",
    branchId: null,
  },
};
function cancelled(requestId = key.requestId): TranscriptRecord {
  return {
    id: `recovered:${requestId}`,
    requestId,
    parentId: null,
    branchId: "root",
    order: 0,
    kind: "message",
    message: {
      role: "custom",
      customType: "Cancelled queued prompt",
      display: true,
      content: [{ type: "text", text: "not the original draft" }],
      timestamp: 1,
    },
  };
}
function snapshot(records: TranscriptRecord[] = [cancelled()]): Snapshot {
  return {
    address,
    snapshotSeq: 1,
    info: {
      id: address.sessionId,
      cwd: "/project",
      title: "Chat",
      modified: 1,
    },
    effort: "off",
    effortLevels: [],
    transcript: { ...emptyTranscript(), records },
  };
}
function fixture(sync?: (p: DraftSyncParams) => Promise<void>) {
  const drafts = new DraftStore();
  const notices: string[] = [];
  const errors: string[] = [];
  const acknowledged: SendKey[] = [];
  const transport = {
    syncDraft: async (p: DraftSyncParams) => {
      await sync?.(p);
      return {
        applied: true,
        draft: { ...p.content, revision: p.expectedRevision + 1 },
      };
    },
    prompt: async () => ({ disposition: "queued" as const }),
    getPromptReceipt: async (p: SendKey): Promise<PromptReceipt> => ({
      ...p,
      state: "unknown",
      reason: "not-found",
    }),
    acknowledgeRecovery: async (p: { key: SendKey }) => {
      acknowledged.push(p.key);
    },
  };
  const sends = new SendController(
    drafts,
    transport,
    () => {},
    10,
    (error) => errors.push(error),
    undefined,
    (kind) => notices.push(kind),
  );
  return { drafts, sends, notices, errors, acknowledged, transport };
}

test.each([
  "accepted",
  "pending",
  "unknown",
] as const)("cancelled %s steering returns the original text and attachments once, preserving newer typing", async (state) => {
  const f = fixture();
  f.sends.restore([
    {
      ...intent,
      receipt:
        state === "accepted"
          ? intent.receipt
          : state === "pending"
            ? { ...key, state, stage: "dispatched" }
            : { ...key, state, reason: "not-found" },
    },
  ]);
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "newer" }));
  f.sends.reconcile(snapshot());
  const restored = f.drafts.read(address).content;
  expect(restored.text).toBe("first\n\nnewer");
  expect(restored.images).toEqual(content.images);
  expect(restored.files).toEqual(content.files);
  expect(f.sends.pendingSteering(address, false)).toEqual([]);
  expect(f.sends.optimistic(address)).toEqual([]);
  f.sends.reconcile(snapshot());
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  expect(f.drafts.read(address).content).toEqual(restored);
  expect(f.notices.filter((kind) => kind === "restored")).toHaveLength(1);
  await Bun.sleep(0);
  expect(f.acknowledged).toMatchObject([key]);
});

test("a host-confirmed recovery removes an existing steering row without restoring its draft again", () => {
  const f = fixture();
  f.sends.restore([intent]);
  expect(f.sends.pendingSteering(address, true)).toHaveLength(1);
  f.drafts.receive(address, { ...content, revision: 2 });
  f.sends.restore([{ ...intent, recovered: true }]);
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  expect(f.sends.pendingSteering(address, true)).toEqual([]);
  expect(f.sends.optimistic(address)).toEqual([]);
  expect(f.drafts.read(address).content).toEqual(content);
  expect(f.notices).toEqual([]);
});

test("several cancelled inputs keep send order ahead of the newer draft", () => {
  const f = fixture();
  f.sends.restore([
    intent,
    {
      ...intent,
      content: { ...emptyContent(), text: "second" },
      receipt: { ...intent.receipt, requestId: "second" },
    },
  ]);
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "newer" }));
  f.sends.reconcile(snapshot([cancelled(), cancelled("second")]));
  expect(f.drafts.read(address).content.text).toBe("first\n\nsecond\n\nnewer");
  expect(f.notices).toEqual(["restored"]);
});

test("a cancelled record is not delivered history, but actual delivery wins over stale recovery", () => {
  const f = fixture();
  f.sends.restore([intent]);
  const delivered: TranscriptRecord = {
    ...cancelled(),
    id: "delivered",
    kind: "message",
    message: {
      role: "user",
      content: "transformed by an extension",
      timestamp: 2,
    },
  };
  f.sends.reconcile(snapshot([cancelled(), delivered]));
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  expect(f.sends.optimistic(address)).toEqual([]);
  expect(f.notices).toEqual([]);
});

test("recovery acknowledgement waits for persistence and prevents restoration on renderer reload", async () => {
  const saved = Promise.withResolvers<void>();
  const f = fixture(async () => saved.promise);
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  expect(f.acknowledged).toEqual([]);
  saved.resolve();
  await Bun.sleep(0);
  expect(f.acknowledged).toMatchObject([key]);
  const reload = fixture();
  reload.drafts.receive(address, {
    ...f.drafts.read(address).content,
    revision: 1,
  });
  reload.sends.restore([{ ...intent, recovered: true }]);
  reload.sends.reconcile(snapshot());
  expect(reload.drafts.read(address).content.text).toBe("first");
  expect(reload.notices).toEqual([]);
});

test("recovery finishing after the draft owner closes does not acknowledge it", async () => {
  const started = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  const f = fixture(async () => {
    started.resolve();
    await saved.promise;
  });
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  await started.promise;
  f.drafts.retire(address);
  saved.resolve();
  await Bun.sleep(0);
  expect(f.acknowledged).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.drafts.read(address).content).toMatchObject(content);
});

test("unknown input can follow an explicit transfer without acknowledging across owners", async () => {
  const f = fixture();
  f.sends.restore([
    { ...intent, receipt: { ...key, state: "unknown", reason: "not-found" } },
  ]);
  const next = { ...address, epoch: address.epoch + 1 };
  f.drafts.transfer(address, next);
  f.sends.transfer(address, next);
  await Bun.sleep(0);
  expect(f.drafts.read(next).content).toMatchObject(content);
  expect(f.acknowledged).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.notices).toEqual(["unknown"]);
});

test("a timed-out save of recovered steering is retried before acknowledgement", async () => {
  let attempts = 0;
  const f = fixture(async () => {
    if (++attempts === 1) throw new Error("Draft sync timed out");
  });
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  await Bun.sleep(0);
  expect(attempts).toBe(2);
  expect(f.drafts.read(address).content.text).toBe("first");
  expect(f.acknowledged).toMatchObject([key]);
  expect(f.errors).toEqual([]);
});

test("failed draft persistence retains recovery data and reports the error without acknowledging", async () => {
  const f = fixture(async () => {
    throw new Error("disk unavailable");
  });
  f.sends.restore([intent]);
  f.sends.reconcile(snapshot());
  await Bun.sleep(0);
  expect(f.drafts.read(address).content.text).toBe("first");
  expect(f.acknowledged).toEqual([]);
  expect(f.errors).toEqual(["Error: disk unavailable"]);
});

test("restored unknown input returns to the composer once; late acceptance cannot resurrect the tray", async () => {
  const f = fixture();
  f.sends.restore([
    {
      ...intent,
      receipt: { ...key, state: "unknown", reason: "not-found" },
    },
  ]);
  await Bun.sleep(0);
  expect(f.notices).toEqual(["unknown"]);
  expect(f.sends.pendingSteering(address, false)).toEqual([]);
  expect(f.sends.optimistic(address)).toEqual([]);
  expect(f.drafts.read(address).content.text).toBe("first");
  expect(f.drafts.read(address).content.images).toEqual(content.images);
  expect(f.drafts.read(address).content.files).toEqual(content.files);
  await f.sends.lookup(address, key);
  expect(f.notices).toEqual(["unknown"]);
  f.transport.getPromptReceipt = async () => ({
    ...key,
    state: "pending",
    stage: "dispatched",
  });
  await f.sends.lookup(address, key);
  expect(f.sends.pendingSteering(address, false)).toEqual([]);
  f.transport.getPromptReceipt = async () => ({
    ...key,
    state: "accepted",
    accepted: { disposition: "queued" },
    acceptedAt: 1,
  });
  await f.sends.lookup(address, key);
  expect(f.sends.pendingSteering(address, true)).toEqual([]);
  expect(f.drafts.read(address).content).toEqual(emptyContent());
});

test("compaction and a lost status reply do not return admitted steering to the draft", async () => {
  const f = fixture();
  let calls = 0;
  f.transport.getPromptReceipt = () => {
    calls++;
    return new Promise(() => {});
  };
  f.sends.restore([
    {
      ...intent,
      receipt: { ...key, state: "pending", stage: "dispatched" },
    },
  ]);
  const current = snapshot([]);
  f.sends.reconcile({
    ...current,
    transcript: {
      ...current.transcript,
      running: true,
      compaction: { reason: "overflow" },
    },
  });
  await Promise.all([
    f.sends.lookup(address, key),
    f.sends.lookup(address, key),
  ]);
  expect(calls).toBe(1);
  expect(f.notices).toEqual([]);
  expect(f.sends.pendingSteering(address, true)).toMatchObject([{ content }]);
  expect(f.drafts.read(address).content).toEqual(emptyContent());
});

test("unknown recovery is acknowledged only after saving and is not duplicated on reload", async () => {
  const saved = Promise.withResolvers<void>();
  const f = fixture(async () => saved.promise);
  const unknown: SendIntent = {
    ...intent,
    receipt: { ...key, state: "unknown", reason: "host-restarted" },
  };
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "newer" }));
  f.sends.restore([unknown]);
  await Bun.sleep(0);
  expect(f.drafts.read(address).content.text).toBe("first\n\nnewer");
  expect(f.acknowledged).toEqual([]);
  f.sends.restore([unknown]);
  expect(f.drafts.read(address).content.text).toBe("first\n\nnewer");
  saved.resolve();
  await Bun.sleep(0);
  expect(f.acknowledged).toMatchObject([key]);
  const reload = fixture();
  reload.drafts.receive(address, {
    ...f.drafts.read(address).content,
    revision: 1,
  });
  reload.sends.restore([{ ...unknown, recovered: true }]);
  await Bun.sleep(0);
  expect(reload.drafts.read(address).content.text).toBe("first\n\nnewer");
  expect(reload.notices).toEqual([]);
});

test("a late acceptance reply cannot resurrect cancelled steering or remove the restored draft", async () => {
  const f = fixture();
  const response = Promise.withResolvers<{ disposition: "queued" }>();
  let started = false;
  f.transport.prompt = () => {
    started = true;
    return response.promise;
  };
  f.drafts.edit(address, () => content);
  const sending = f.sends.send(address);
  while (!started) await Bun.sleep(0);
  const requestId = f.sends.read(address)?.key.requestId;
  f.sends.reconcile(snapshot([cancelled(requestId)]));
  response.resolve({ disposition: "queued" });
  await sending;
  expect(f.sends.pendingSteering(address, false)).toEqual([]);
  expect(f.drafts.read(address).content.text).toBe("first");
  expect(f.notices).toEqual(["restored"]);
});

test("stale epochs and retired sends cannot restore input into a changed conversation", () => {
  const f = fixture();
  f.sends.restore([intent]);
  f.sends.reconcile({ ...snapshot(), address: { ...address, epoch: 2 } });
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  f.sends.retire(address);
  f.sends.reconcile(snapshot());
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  expect(f.notices).toEqual([]);
});
