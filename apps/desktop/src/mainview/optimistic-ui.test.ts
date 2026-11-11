import { expect, test } from "bun:test";
import type { ModelSelection, Snapshot } from "../shared/rpc-schema";
import type {
  DraftSyncParams,
  PromptAccepted,
} from "../shared/runtime-contract";
import { emptyTranscript } from "../shared/transcript";
import { newerSnapshot } from "./chat-snapshot";
import { DraftStore, emptyContent } from "./draft-store";
import { modelDividers } from "./model-dividers";
import { OptimisticValue } from "./optimistic-value";
import { SelectionController } from "./selection-controller";
import { SendController } from "./send-controller";

const address = { hostId: "host", sessionId: "chat", epoch: 1 };
const model = (id: string): ModelSelection => ({
  model: { provider: "p", id, name: id },
  effort: "off",
  effortLevels: ["off"],
});
const snapshot = (id: string): Snapshot => ({
  ...model(id),
  address,
  info: { id: "chat", cwd: "project", title: "Chat", modified: 0 },
  snapshotSeq: 1,
  transcript: emptyTranscript(),
});
const syncDraft = async (params: DraftSyncParams) => ({
  applied: true,
  draft: { ...params.content, revision: params.expectedRevision + 1 },
});

test("model selection is immediate, session-owned, and late responses cannot replace the latest intent", async () => {
  const published: [string, ModelSelection][] = [];
  const errors: unknown[] = [];
  const controller = new SelectionController(
    (owner, value) => published.push([owner.sessionId, value]),
    (error) => errors.push(error),
  );
  const first = Promise.withResolvers<ModelSelection>();
  const second = Promise.withResolvers<ModelSelection>();
  const requests: string[] = [];
  const a = controller.change(address, model("A"), model("B"), () => {
    requests.push("B");
    return first.promise;
  });
  const b = controller.change(address, model("B"), model("C"), () => {
    requests.push("C");
    return second.promise;
  });
  await controller.change(
    { ...address, sessionId: "other" },
    model("X"),
    model("Y"),
    async () => model("Y"),
  );
  expect(controller.overlay(snapshot("A")).model?.id).toBe("C");
  first.resolve(model("B"));
  await a;
  expect(requests).toEqual(["B", "C"]);
  expect(controller.overlay(snapshot("B")).model?.id).toBe("C");
  expect(
    published
      .filter(([id]) => id === "chat")
      .map(([, value]) => value.model?.id),
  ).toEqual(["B", "C"]);
  second.resolve(model("C"));
  await b;
  await controller.flush(address);
  expect(published.at(-1)?.[1].model?.id).toBe("C");
  expect(errors).toEqual([]);
});

test("model rollback uses the last confirmed selection and never republishes old transcript fields", async () => {
  const values: ModelSelection[] = [];
  const controller = new SelectionController(
    (_, value) => values.push(value),
    () => {},
  );
  const gate = Promise.withResolvers<ModelSelection>();
  const task = controller.change(
    address,
    snapshot("A"),
    { ...snapshot("B"), effort: "high" },
    () => gate.promise,
  );
  controller.overlay(snapshot("C"));
  gate.reject(new Error("failed"));
  await task;
  expect(values.at(-1)?.model?.id).toBe("C");
  expect(values.every((value) => !("transcript" in value))).toBe(true);
  expect(
    controller.overlay({ ...snapshot("X"), address: { ...address, epoch: 2 } })
      .model?.id,
  ).toBe("X");
});

test("a selection handed to a replacement epoch cannot be overwritten by its obsolete request", async () => {
  const values: ModelSelection[] = [];
  const errors: unknown[] = [];
  const controller = new SelectionController(
    (_, value) => values.push(value),
    (error) => errors.push(error),
  );
  const gate = Promise.withResolvers<ModelSelection>();
  const pending = controller.change(
    address,
    model("A"),
    model("B"),
    () => gate.promise,
  );
  expect(controller.take(address)?.model?.id).toBe("B");
  gate.reject(new Error("STALE_SESSION_ADDRESS"));
  await pending;
  expect(values.map((value) => value.model?.id)).toEqual(["B"]);
  expect(errors).toEqual([]);
});

test("repeated preference failures roll back to confirmed data, not an earlier optimistic edit", async () => {
  const published: string[] = [];
  const errors: unknown[] = [];
  const queue = new OptimisticValue<string>((error) => errors.push(error));
  const gate = Promise.withResolvers<string>();
  const a = queue.change(
    "name",
    "original",
    "first",
    (value) => published.push(value),
    () => gate.promise,
  );
  const b = queue.change(
    "name",
    "first",
    "second",
    (value) => published.push(value),
    async () => {
      throw new Error("second failed");
    },
  );
  gate.reject(new Error("first failed"));
  await Promise.all([a, b]);
  expect(published).toEqual(["first", "second", "original"]);
  expect(errors).toHaveLength(2);
});

test("a rejected optimistic message disappears and restores text and attachments without losing newer edits", async () => {
  const drafts = new DraftStore();
  const gate = Promise.withResolvers<PromptAccepted>();
  drafts.edit(address, () => ({
    ...emptyContent(),
    text: "sent",
    images: [
      {
        id: "old",
        image: { type: "image", mimeType: "image/png", data: "old" },
      },
    ],
  }));
  const sends = new SendController(
    drafts,
    {
      syncDraft,
      prompt: () => gate.promise,
      getPromptReceipt: async (key) => ({
        ...key,
        state: "rejected",
        code: "AUTH",
        message: "No auth",
      }),
    },
    () => {},
  );
  const sending = sends.send(address);
  expect(drafts.read(address).content).toEqual(emptyContent());
  expect(sends.optimistic(address)[0].content?.text).toBe("sent");
  drafts.edit(address, () => ({
    ...emptyContent(),
    text: "new typing",
    images: [
      {
        id: "new",
        image: { type: "image", mimeType: "image/png", data: "new" },
      },
    ],
  }));
  gate.reject(new Error("lost reply"));
  await sending;
  expect(sends.optimistic(address)).toEqual([]);
  expect(drafts.read(address).content.text).toBe("sent\n\nnew typing");
  expect(drafts.read(address).content.images.map((item) => item.id)).toEqual([
    "old",
    "new",
  ]);
  await sends.lookup(address);
  expect(drafts.read(address).content.text).toBe("sent\n\nnew typing");
});

test("multiple sends can be in flight; an old acknowledgement cannot clear a newer draft", async () => {
  const drafts = new DraftStore();
  const requests: string[] = [];
  const gates = [
    Promise.withResolvers<PromptAccepted>(),
    Promise.withResolvers<PromptAccepted>(),
  ];
  const sends = new SendController(
    drafts,
    {
      syncDraft,
      prompt: (params) => {
        requests.push(params.text);
        return gates[requests.length - 1].promise;
      },
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
  );
  drafts.edit(address, () => ({ ...emptyContent(), text: "first" }));
  const first = sends.send(address);
  while (requests.length < 1) await Bun.sleep(0);
  drafts.edit(address, () => ({ ...emptyContent(), text: "second" }));
  const second = sends.send(address);
  while (requests.length < 2) await Bun.sleep(0);
  drafts.edit(address, () => ({ ...emptyContent(), text: "third draft" }));
  const current = sends.read(address)?.key.requestId;
  gates[1].resolve({ disposition: "queued" });
  await second;
  gates[0].resolve({ disposition: "started" });
  await first;
  expect(requests).toEqual(["first", "second"]);
  expect(sends.read(address)?.key.requestId).toBe(current);
  expect(drafts.read(address).content.text).toBe("third draft");
});

test("every pending send follows replacement epochs, including an older rejection after a newer acceptance", async () => {
  const drafts = new DraftStore();
  const gates = [
    Promise.withResolvers<PromptAccepted>(),
    Promise.withResolvers<PromptAccepted>(),
  ];
  const ids: string[] = [];
  const sends = new SendController(
    drafts,
    {
      syncDraft,
      prompt: (params) => {
        ids.push(params.requestId);
        return gates[ids.length - 1].promise;
      },
      getPromptReceipt: async (key) => ({
        ...key,
        state: "rejected",
        code: "AUTH",
        message: "Rejected",
      }),
    },
    () => {},
  );
  drafts.edit(address, () => ({ ...emptyContent(), text: "first" }));
  const first = sends.send(address);
  while (ids.length < 1) await Bun.sleep(0);
  drafts.edit(address, () => ({ ...emptyContent(), text: "second" }));
  const second = sends.send(address);
  while (ids.length < 2) await Bun.sleep(0);
  const next = { ...address, epoch: 2 },
    latest = { ...address, epoch: 3 };
  drafts.transfer(address, next);
  sends.transfer(address, next);
  drafts.transfer(next, latest);
  sends.transfer(next, latest);
  drafts.edit(latest, () => ({ ...emptyContent(), text: "newer draft" }));
  gates[1].resolve({ disposition: "started" });
  await second;
  gates[0].reject(new Error("lost response"));
  await first;
  expect(sends.read(latest)?.key.requestId).toBe(ids[1]);
  expect(sends.read(latest)?.state).toBe("accepted");
  expect(drafts.read(latest).content.text).toBe("first\n\nnewer draft");
  await sends.wait(latest);
});

test("resending an edited historical message leaves the current composer draft untouched", async () => {
  const drafts = new DraftStore();
  drafts.edit(address, () => ({ ...emptyContent(), text: "current draft" }));
  const sends = new SendController(
    drafts,
    {
      syncDraft,
      prompt: async () => ({ disposition: "started" }),
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
  );
  await sends.send(address, { ...emptyContent(), text: "edited history" });
  expect(drafts.read(address).content.text).toBe("current draft");
});

test("ordinary streaming snapshots reuse the cached catalog, but new epochs cannot inherit project models", () => {
  const current = {
    ...snapshot("A"),
    modelCatalog: [{ provider: "project", id: "only", name: "Project model" }],
  };
  const next = { ...snapshot("A"), snapshotSeq: 2 };
  expect(newerSnapshot(current, next).modelCatalog).toBe(current.modelCatalog);
  expect(
    newerSnapshot(current, { ...next, address: { ...address, epoch: 2 } })
      .modelCatalog,
  ).toBeUndefined();
});

test("model dividers show real persisted changes, not initialization or repeated selection", () => {
  const records = ["A", "A", "B", "C"].map((modelId, index) => ({
    id: String(index),
    parentId: null,
    branchId: "root",
    order: index,
    kind: "session-entry" as const,
    entryType: "model_change",
    data: { provider: "p", modelId },
  }));
  expect([...modelDividers(records)]).toEqual([
    ["2", "p/A → p/B"],
    ["3", "p/B → p/C"],
  ]);
});
