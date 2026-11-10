import { expect, test } from "bun:test";
import type {
  DraftSyncParams,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendKey,
} from "../shared/runtime-contract";
import { DraftStore, emptyContent } from "./draft-store";
import { SendController } from "./send-controller";

const address = { hostId: "h", sessionId: "opaque-sdk", epoch: 3 };
const accepted: PromptAccepted = { disposition: "started" };
const syncDraft = async (p: DraftSyncParams) => ({
  applied: true,
  draft: { ...p.content, revision: p.expectedRevision + 1 },
});
function fixture(
  prompt: (p: PromptParams) => Promise<PromptAccepted>,
  receipt: (key: SendKey) => Promise<PromptReceipt>,
) {
  const drafts = new DraftStore();
  drafts.edit(address, () => ({
    ...emptyContent(),
    text: "Hello",
    images: [
      { id: "img", image: { type: "image", data: "x", mimeType: "image/png" } },
    ],
  }));
  const callbacks: (() => void)[] = [];
  const sends = new SendController(
    drafts,
    { syncDraft, prompt, getPromptReceipt: receipt },
    (callback) => {
      callbacks.push(callback);
    },
  );
  return { drafts, sends, callbacks };
}
test("timeout checks receipt without retransmission; pending retains complete draft", async () => {
  let calls = 0;
  let key: SendKey | undefined;
  const f = fixture(
    async () => {
      calls++;
      throw new Error("600000ms timeout");
    },
    async (input) => {
      key = input;
      return { ...input, state: "pending" };
    },
  );
  await f.sends.send(address);
  expect(calls).toBe(1);
  expect(f.sends.read(address)?.state).toBe("checking");
  expect(f.drafts.read(address).content.images).toHaveLength(1);
  await f.sends.send(address);
  await f.sends.lookup(address);
  expect(calls).toBe(1);
  expect(key?.requestId).toBe(f.sends.read(address)?.key.requestId);
});
test("accepted lookup clears only unchanged revision and never resends model errors", async () => {
  let calls = 0;
  const f = fixture(
    async () => {
      calls++;
      throw new Error("transport");
    },
    async (key) => ({ ...key, state: "accepted", accepted, acceptedAt: 1 }),
  );
  await f.sends.send(address);
  expect(f.sends.read(address)?.state).toBe("accepted");
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  await f.sends.lookup(address);
  expect(calls).toBe(1);
});
test.each([
  "unchanged",
  "newer draft",
  "replacement epoch",
])("pending receipt acceptance clears obsolete warning and protects %s", async (scenario) => {
  let calls = 0;
  const keys: SendKey[] = [];
  const f = fixture(
    async () => {
      calls++;
      throw new Error("600000ms timeout");
    },
    async (key) => {
      keys.push(key);
      return keys.length === 1
        ? { ...key, state: "pending" }
        : { ...key, state: "accepted", accepted, acceptedAt: 1 };
    },
  );
  await f.sends.send(address);
  expect(f.sends.read(address)?.state).toBe("checking");
  expect(f.sends.read(address)?.message).toBe(
    "Checking acceptance — do not resend.",
  );
  expect(f.drafts.read(address).content.text).toBe("Hello");
  expect(f.drafts.read(address).content.images).toHaveLength(1);
  expect(f.callbacks).toHaveLength(1);
  await f.sends.send(address);

  const next = { ...address, epoch: address.epoch + 1 };
  if (scenario === "replacement epoch") {
    f.sends.transfer(address, next);
    f.drafts.transfer(address, next);
  }
  const current = scenario === "replacement epoch" ? next : address;
  if (scenario !== "unchanged") {
    f.drafts.edit(current, (content) => ({
      ...content,
      text: "newer",
      images: [
        {
          id: "new-image",
          image: { type: "image", data: "new", mimeType: "image/png" },
        },
      ],
    }));
  }
  const retained = f.drafts.read(current).content;
  const replacementState = f.sends.read(next);
  await f.sends.lookup(address);
  expect(f.sends.read(address)?.state).toBe("accepted");
  expect(f.sends.read(address)?.message).toBeUndefined();
  expect(f.drafts.read(current).content).toEqual(
    scenario === "unchanged" ? emptyContent() : retained,
  );
  if (scenario === "replacement epoch") {
    expect(f.sends.read(next)).toEqual(replacementState);
    expect(f.sends.read(next)?.state).toBe("unknown");
    expect(f.sends.read(next)?.message).toContain("ownership changed");
    await f.sends.send(next);
  }
  await f.sends.lookup(address);
  expect(calls).toBe(1);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toEqual(keys[0]);
});
test("preaccept rejection retains text and images, shows backend error", async () => {
  const f = fixture(
    async () => {
      throw new Error("preflight");
    },
    async (key) => ({
      ...key,
      state: "rejected",
      code: "AUTH",
      message: "Configure provider",
    }),
  );
  await f.sends.send(address);
  expect(f.sends.read(address)?.message).toBe("Configure provider");
  expect(f.drafts.read(address).content.text).toBe("Hello");
  expect(f.drafts.read(address).content.images).toHaveLength(1);
});
test("host restart unknown blocks send until user explicitly confirms a NEW request", async () => {
  const ids: string[] = [];
  const f = fixture(
    async (params) => {
      ids.push(params.requestId);
      throw new Error("crashed");
    },
    async (key) => ({ ...key, state: "unknown", reason: "host-restarted" }),
  );
  await f.sends.send(address);
  await f.sends.send(address);
  expect(ids).toHaveLength(1);
  expect(f.sends.read(address)?.state).toBe("unknown");
  f.sends.confirmNewSend(address);
  await f.sends.send(address);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(f.drafts.read(address).content.text).toBe("Hello");
});
test("late acceptance preserves edits made during pending prompt", async () => {
  let finish: (value: PromptAccepted) => void = () => {};
  let begun: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const f = fixture(
    async () => {
      begun();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async (key) => ({ ...key, state: "pending" }),
  );
  const result = f.sends.send(address);
  await started;
  f.drafts.edit(address, (content) => ({ ...content, text: "newer" }));
  finish(accepted);
  await result;
  expect(f.drafts.read(address).content.text).toBe("newer");
  expect(f.drafts.read(address).content.images).toHaveLength(1);
});
test("replacement during admission preserves next epoch draft, double click sends once", async () => {
  let finish: (value: PromptAccepted) => void = () => {};
  let begun: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  let calls = 0;
  const f = fixture(
    async () => {
      calls++;
      begun();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async (key) => ({ ...key, state: "pending" }),
  );
  const result = f.sends.send(address);
  await f.sends.send(address);
  await started;
  const next = { ...address, epoch: 4 };
  f.drafts.transfer(address, next);
  finish(accepted);
  await result;
  expect(calls).toBe(1);
  expect(f.drafts.read(next).content.text).toBe("Hello");
});
test("CAS mirror settles before prompt captures exact expanded paste and image order", async () => {
  const drafts = new DraftStore();
  drafts.edit(address, () => ({
    text: "[paste #1 8 chars]",
    pastes: [{ id: "p", marker: "[paste #1 8 chars]", text: "expanded" }],
    images: [
      { id: "1", image: { type: "image", data: "a", mimeType: "image/png" } },
      { id: "2", image: { type: "image", data: "b", mimeType: "image/png" } },
    ],
  }));
  const order: string[] = [];
  const sends = new SendController(drafts, {
    syncDraft: async (params) => {
      order.push("sync");
      return syncDraft(params);
    },
    prompt: async (params) => {
      order.push("prompt");
      expect(params.draftRevision).toBe(1);
      expect(params.text).toBe("expanded");
      expect(params.images?.map((i) => i.data)).toEqual(["a", "b"]);
      return { disposition: "queued" };
    },
    getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
  });
  await sends.send(address);
  expect(order.slice(0, 2)).toEqual(["sync", "prompt"]);
});

test("an indeterminate send transferred across epoch requires inspect-history confirmation", async () => {
  let calls = 0;
  const f = fixture(
    async () => {
      calls++;
      throw new Error("lost acceptance");
    },
    async (key) => ({ ...key, state: "pending" }),
  );
  await f.sends.send(address);
  const next = { ...address, epoch: 8 };
  f.sends.transfer(address, next);
  f.drafts.transfer(address, next);
  await f.sends.send(next);
  expect(calls).toBe(1);
  expect(f.sends.read(next)?.state).toBe("unknown");
  expect(f.drafts.read(next).content.text).toBe("Hello");
  f.sends.confirmNewSend(next);
  await f.sends.send(next);
  expect(calls).toBe(2);
});

test("accepted follow-ups allow the next message without waiting for response completion", async () => {
  const prompts: PromptParams[] = [];
  const f = fixture(
    async (params) => {
      prompts.push(params);
      return { disposition: "queued" };
    },
    async (key) => ({ ...key, state: "pending" }),
  );
  await f.sends.send(address);
  expect(f.sends.read(address)?.state).toBe("accepted");
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "One more thing" }));
  await f.sends.send(address);
  expect(prompts.map((prompt) => prompt.text)).toEqual([
    "Hello",
    "One more thing",
  ]);
  expect(prompts[0].requestId).not.toBe(prompts[1].requestId);
  expect(f.drafts.read(address).content.text).toBe("");
});
