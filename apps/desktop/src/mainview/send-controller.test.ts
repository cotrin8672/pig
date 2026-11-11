import { expect, test } from "bun:test";
import type {
  DraftSyncParams,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendIntent,
  SendKey,
} from "../shared/runtime-contract";
import { DraftStore, emptyContent } from "./draft-store";
import { isSendUnconfirmed, SendController } from "./send-controller";

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
  const delays: number[] = [];
  const sends = new SendController(
    drafts,
    { syncDraft, prompt, getPromptReceipt: receipt },
    (callback, delay) => {
      callbacks.push(callback);
      delays.push(delay);
    },
  );
  return { drafts, sends, callbacks, delays };
}
test("timeout checks receipt without retransmission; pending retains the complete optimistic message", async () => {
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
  expect(f.drafts.read(address).content.images).toHaveLength(0);
  expect(f.sends.optimistic(address)[0].content?.images).toHaveLength(1);
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
  "replacement unchanged",
])("pending receipt acceptance resolves internally and protects %s", async (scenario) => {
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
  expect(f.sends.read(address)?.message).toBeUndefined();
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  expect(f.sends.optimistic(address)[0].content?.text).toBe("Hello");
  expect(f.sends.optimistic(address)[0].content?.images).toHaveLength(1);
  expect(f.callbacks).toHaveLength(1);
  await f.sends.send(address);

  const next = { ...address, epoch: address.epoch + 1 };
  const replacement = scenario.startsWith("replacement");
  if (replacement) {
    f.drafts.transfer(address, next);
    f.sends.transfer(address, next);
    expect(isSendUnconfirmed(f.sends.read(next))).toBe(true);
  }
  const current = replacement ? next : address;
  const newer = scenario === "newer draft" || scenario === "replacement epoch";
  if (newer) {
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
  await f.sends.lookup(address);
  expect(f.sends.read(address)?.state).toBe("accepted");
  expect(f.sends.read(address)?.message).toBeUndefined();
  expect(f.drafts.read(current).content).toEqual(
    newer ? retained : emptyContent(),
  );
  if (replacement) {
    expect(f.sends.read(next)?.state).toBe("accepted");
    expect(f.sends.read(next)?.message).toBeUndefined();
    expect(isSendUnconfirmed(f.sends.read(next))).toBe(false);
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
test("unknown acceptance retains the draft without warnings, automatic retry or a confirmation gate", async () => {
  const ids: string[] = [];
  const f = fixture(
    async (params) => {
      ids.push(params.requestId);
      throw new Error("crashed");
    },
    async (key) => ({ ...key, state: "unknown", reason: "host-restarted" }),
  );
  await f.sends.send(address);
  await f.sends.lookup(address);
  expect(ids).toHaveLength(1);
  expect(f.sends.read(address)?.state).toBe("unknown");
  expect(f.sends.read(address)?.message).toBeUndefined();
  expect(isSendUnconfirmed(f.sends.read(address))).toBe(true);
  await f.sends.send(address);
  expect(ids).toHaveLength(1);
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "new message" }));
  await f.sends.send(address);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(f.sends.optimistic(address).map((send) => send.content?.text)).toEqual(
    ["Hello", "new message"],
  );
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
  expect(f.drafts.read(address).content.images).toHaveLength(0);
});
test("replacement during admission resolves internally and clears the unchanged sent draft", async () => {
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
  f.sends.transfer(address, next);
  finish(accepted);
  await result;
  expect(calls).toBe(1);
  expect(f.sends.read(next)?.state).toBe("accepted");
  expect(f.drafts.read(next).content).toEqual(emptyContent());
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

test("an indeterminate transferred send prevents branching but needs no confirmation for a new send", async () => {
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
  f.drafts.transfer(address, next);
  f.sends.transfer(address, next);
  expect(calls).toBe(1);
  expect(f.sends.read(next)?.state).toBe("unknown");
  expect(f.sends.read(next)?.message).toBeUndefined();
  expect(isSendUnconfirmed(f.sends.read(next))).toBe(true);
  expect(f.drafts.read(next).content.text).toBe("");
  f.drafts.edit(next, () => ({ ...emptyContent(), text: "next" }));
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

test.each([
  "local edit",
  "extension startup",
])("late transferred acceptance preserves %s made before ownership changed", async (scenario) => {
  let lookups = 0;
  const f = fixture(
    async () => {
      throw new Error("transport");
    },
    async (key) =>
      ++lookups === 1
        ? { ...key, state: "pending" }
        : { ...key, state: "accepted", accepted, acceptedAt: 1 },
  );
  await f.sends.send(address);
  const next = { ...address, epoch: 4 };
  if (scenario === "local edit")
    f.drafts.edit(address, (content) => ({ ...content, text: "newer" }));
  else
    f.drafts.receive(next, { ...emptyContent(), text: "newer", revision: 1 });
  f.drafts.transfer(address, next);
  f.sends.transfer(address, next);
  await f.sends.lookup(address);
  expect(f.sends.read(next)?.state).toBe("accepted");
  expect(f.drafts.read(next).content.text).toBe("newer");
});

test("a late rejection unlocks the replacement without dropping its draft", async () => {
  let lookups = 0;
  const f = fixture(
    async () => {
      throw new Error("transport");
    },
    async (key) =>
      ++lookups === 1
        ? { ...key, state: "pending" }
        : {
            ...key,
            state: "rejected",
            code: "AUTH",
            message: "Configure provider",
          },
  );
  await f.sends.send(address);
  const next = { ...address, epoch: 4 };
  f.drafts.transfer(address, next);
  f.sends.transfer(address, next);
  await f.sends.lookup(address);
  expect(isSendUnconfirmed(f.sends.read(next))).toBe(false);
  expect(f.sends.read(next)?.message).toBe("Configure provider");
  expect(f.drafts.read(next).content.text).toBe("Hello");
  expect(f.drafts.read(next).content.images).toHaveLength(1);
});

test("a retired owner's late acceptance cannot clear a new send's subsequent edits", async () => {
  let calls = 0;
  let lookups = 0;
  const f = fixture(
    async () => {
      if (++calls === 1) throw new Error("transport");
      return accepted;
    },
    async (key) =>
      ++lookups === 1
        ? { ...key, state: "pending" }
        : { ...key, state: "accepted", accepted, acceptedAt: 1 },
  );
  await f.sends.send(address);
  const next = { ...address, epoch: 4 };
  f.drafts.transfer(address, next);
  f.sends.transfer(address, next);
  f.drafts.edit(next, (content) => ({ ...content, text: "new request" }));
  await f.sends.send(next);
  const state = f.sends.read(next);
  f.drafts.edit(next, (content) => ({ ...content, text: "still typing" }));
  await f.sends.lookup(address);
  expect(f.sends.read(next)).toBe(state);
  expect(f.drafts.read(next).content.text).toBe("still typing");
  expect(calls).toBe(2);
});

test("the independent 1500ms check settles acceptance while prompt is still unresolved", async () => {
  let prompts = 0,
    lookups = 0;
  const prompt = Promise.withResolvers<PromptAccepted>();
  const f = fixture(
    async () => {
      prompts++;
      return prompt.promise;
    },
    async (key) => {
      lookups++;
      return { ...key, state: "accepted", accepted, acceptedAt: 1 };
    },
  );
  const send = f.sends.send(address);
  while (!f.callbacks.length) await Bun.sleep(0);
  expect(f.delays[0]).toBe(1500);
  expect(f.sends.retained()).toHaveLength(0);
  f.callbacks.shift()?.();
  while (f.sends.read(address)?.state !== "accepted") await Bun.sleep(0);
  expect({ prompts, lookups }).toEqual({ prompts: 1, lookups: 1 });
  expect(f.drafts.read(address).content).toEqual(emptyContent());
  // A late transport failure must not move a terminal acceptance back to checking.
  prompt.reject(new Error("late timeout"));
  await send;
  expect(f.sends.read(address)?.state).toBe("accepted");
});

test("a hung lookup has a finite UI budget and only one underlying request; late acceptance is monotone", async () => {
  const drafts = new DraftStore();
  drafts.edit(address, () => ({ ...emptyContent(), text: "one" }));
  const receipt = Promise.withResolvers<PromptReceipt>();
  let calls = 0;
  let key: SendKey | undefined;
  const sends = new SendController(
    drafts,
    {
      syncDraft,
      prompt: async () => {
        throw new Error("lost reply");
      },
      getPromptReceipt: async (input) => {
        calls++;
        key = input;
        return receipt.promise;
      },
    },
    () => {},
    5,
  );
  await sends.send(address);
  expect(sends.read(address)?.state).toBe("unknown");
  await Promise.all([sends.lookup(address), sends.lookup(address)]);
  expect(calls).toBe(1);
  receipt.resolve({
    ...(key as SendKey),
    state: "accepted",
    accepted,
    acceptedAt: 1,
  });
  await Bun.sleep(0);
  expect(sends.read(address)?.state).toBe("accepted");
  expect(drafts.read(address).content.text).toBe("");
});

test("Send fixes the text, paste and image order before an ACK; continuous edits do not extend its barrier", async () => {
  const drafts = new DraftStore();
  const original = {
    text: "[paste #1 3 chars]",
    pastes: [{ id: "p", marker: "[paste #1 3 chars]", text: "old" }],
    images: [
      {
        id: "first",
        image: { type: "image" as const, mimeType: "image/png", data: "YWJj" },
      },
    ],
  };
  drafts.edit(address, () => original);
  const ack = Promise.withResolvers<void>();
  const inputs: DraftSyncParams[] = [];
  const prompts: PromptParams[] = [];
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (input) => {
        inputs.push(input);
        await ack.promise;
        return syncDraft(input);
      },
      prompt: async (input) => {
        prompts.push(input);
        return accepted;
      },
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
  );
  const send = sends.send(address);
  while (!inputs.length) await Bun.sleep(0);
  drafts.edit(address, () => ({
    text: "next",
    pastes: [],
    images: [...original.images, { ...original.images[0], id: "next" }],
  }));
  ack.resolve();
  await send;
  expect(inputs).toHaveLength(1);
  expect(inputs[0].requestId).toBe(prompts[0].requestId);
  expect(prompts).toHaveLength(1);
  expect(prompts[0].text).toBe("old");
  expect(prompts[0].images).toEqual(original.images.map((item) => item.image));
  expect(drafts.read(address).content.text).toBe("next");
  expect(drafts.read(address).content.images).toHaveLength(2);
});

test("a lost preflight CAS ACK is checked independently and never dispatches prompt", async () => {
  const drafts = new DraftStore();
  drafts.edit(address, () => ({ ...emptyContent(), text: "not dispatched" }));
  let reserved: SendKey | undefined,
    prompts = 0,
    lookups = 0;
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (input) => {
        reserved = { ...address, requestId: input.requestId as string };
        throw new Error("CAS applied; ACK dropped");
      },
      prompt: async () => {
        prompts++;
        return accepted;
      },
      getPromptReceipt: async (key) => {
        lookups++;
        expect(key).toEqual(reserved as SendKey);
        return { ...key, state: "pending", stage: "prepared" };
      },
    },
    () => {},
  );
  await sends.send(address);
  expect({ prompts, lookups }).toEqual({ prompts: 0, lookups: 1 });
  expect(sends.read(address)?.state).toBe("unknown");
  expect(drafts.read(address).content.text).toBe("");
  expect(sends.optimistic(address)[0].content?.text).toBe("not dispatched");
});

test("checking an old unknown ID after a new send does not query or overwrite the current operation", async () => {
  const ids: string[] = [],
    lookedUp: string[] = [];
  const f = fixture(
    async (input) => {
      ids.push(input.requestId);
      if (ids.length === 1) throw new Error("lost reply");
      return accepted;
    },
    async (input) => {
      lookedUp.push(input.requestId);
      return { ...input, state: "unknown", reason: "not-found" };
    },
  );
  await f.sends.send(address);
  const old = f.sends.read(address) as NonNullable<
    ReturnType<typeof f.sends.read>
  >;
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "new operation" }));
  await f.sends.send(address);
  const current = f.sends.read(address);
  await f.sends.lookup(old.key, old.key);
  expect(lookedUp).toEqual([ids[0], ids[0]]);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(f.sends.read(address)).toBe(current);
  expect(f.sends.retained()[0].key.requestId).toBe(ids[0]);
});

test("same and fresh controllers both restore retired queued payloads without rolling back acceptance or replaying", async () => {
  let prompts = 0;
  const f = fixture(
    async () => {
      prompts++;
      return { disposition: "queued" };
    },
    async (key) => ({
      ...key,
      state: "accepted",
      accepted: { disposition: "queued" },
      acceptedAt: 1,
    }),
  );
  const original = f.drafts.read(address).content;
  await f.sends.send(address);
  const key = f.sends.read(address)?.key as SendKey;
  expect(f.sends.read(address)?.state).toBe("accepted");
  expect(f.sends.read(address)?.content).toEqual(original);
  f.drafts.retire(address);
  const intent: SendIntent = {
    receipt: {
      ...key,
      state: "accepted",
      accepted: { disposition: "queued" },
      acceptedAt: 1,
    },
    draftRevision: 1,
    content: original,
    hash: "a".repeat(64),
    owner: {
      cwd: "C:/project",
      sessionFile: "C:/project/session.jsonl",
      branchId: "leaf",
    },
  };
  f.sends.restore([intent]);
  const fresh = new SendController(
    f.drafts,
    {
      syncDraft,
      prompt: async () => {
        prompts++;
        throw new Error("No replay");
      },
      getPromptReceipt: async () => intent.receipt,
    },
    () => {},
  );
  fresh.restore([intent]);
  for (const sends of [f.sends, fresh]) {
    expect(sends.retained()).toHaveLength(1);
    expect(sends.retained()[0]).toMatchObject({
      state: "accepted",
      recoveredQueue: true,
      content: original,
    });
    await sends.lookup(key, key);
    expect(sends.read(address)?.state).toBe("accepted");
  }
  expect(prompts).toBe(1);
});
