import { expect, test } from "bun:test";
import { ComposerBridge } from "../bun/composer-bridge";
import type { DraftSyncParams, PromptParams } from "../shared/runtime-contract";
import { DraftStore, emptyContent } from "./draft-store";
import { SendController } from "./send-controller";

const address = { hostId: "host", sessionId: "session", epoch: 1 };
const content = (text: string) => ({ ...emptyContent(), text });
function fixture(events = true, mirrorBudgetMs?: number) {
  const store = new DraftStore(mirrorBudgetMs);
  const host = new ComposerBridge((event) => {
    if (events && event.type === "draft")
      store.receive(event.address, event.draft, event.imageRefs);
  });
  return { store, host };
}

test.each([
  true,
  false,
])("a lost background draft ACK cannot block the next send (host echo: %s)", async (events) => {
  const { store, host } = fixture(events, 20);
  store.edit(address, () => content("send despite lost ACK"));
  const started = Promise.withResolvers<void>();
  const background = store.flush(address, async (params) => {
    host.sync(params);
    started.resolve();
    return new Promise(() => {});
  });
  const mirrored = events
    ? expect(background).resolves.toMatchObject({ dirty: false, revision: 1 })
    : expect(background).rejects.toThrow("Draft sync timed out");
  await started.promise;
  const prompts: PromptParams[] = [];
  const sends = new SendController(
    store,
    {
      syncDraft: async (params) => host.sync(params),
      prompt: async (params) => {
        prompts.push(params);
        host.consume(address, params.draftRevision, () => {});
        return { disposition: "started" };
      },
      getPromptReceipt: async (key) => ({
        ...key,
        state: "unknown",
        reason: "not-found",
      }),
    },
    () => {},
  );
  await sends.send(address);
  await mirrored;
  expect(prompts.map(({ text }) => text)).toEqual(["send despite lost ACK"]);
  expect(sends.read(address)?.state).toBe("accepted");
}, 1_000);

test.each([
  { text: "", events: true },
  { text: "", events: false },
  { text: "next message", events: true },
  { text: "next message", events: false },
])("post-send consumption is not a conflict: %j", async ({ text, events }) => {
  const { store, host } = fixture(events);
  store.edit(address, () => content("sent message"));
  const captured = store.read(address);
  store.clearForSend(address, captured.version);
  const sent = await store.flush(
    address,
    async (params) => host.sync(params),
    captured,
    "send-id",
  );
  if (text) store.edit(address, () => content(text));
  const started = Promise.withResolvers<void>();
  const deliver = Promise.withResolvers<void>();
  let calls = 0;
  const background = store.flush(address, async (params) => {
    if (++calls === 1) {
      started.resolve();
      await deliver.promise;
    }
    return host.sync(params);
  });
  await started.promise;
  host.consume(address, sent.revision, () => {});
  deliver.resolve();
  await background;
  expect(store.read(address).content.text).toBe(text);
  expect(store.read(address).dirty).toBe(false);
  expect(host.read(address).text).toBe(text);
  expect(calls).toBe(text ? 2 : 1);
});

test("a background retry mirrors the latest text, paste and images, not its stale capture", async () => {
  const { store, host } = fixture();
  store.edit(address, () => content("sent"));
  const sent = await store.flush(address, async (params) => host.sync(params));
  store.edit(address, () => content("old next draft"));
  const latest = {
    text: "[paste #1 14 chars]",
    pastes: [
      { id: "p", marker: "[paste #1 14 chars]", text: "new next draft" },
    ],
    images: [
      {
        id: "i",
        image: { type: "image" as const, mimeType: "image/png", data: "YWJj" },
      },
    ],
  };
  const inputs: DraftSyncParams[] = [];
  await store.flush(address, async (params) => {
    inputs.push(params);
    if (inputs.length === 1) {
      host.consume(address, sent.revision, () => {});
      store.edit(address, () => latest);
    }
    return host.sync(params);
  });
  expect(inputs).toHaveLength(2);
  expect(inputs[1].content).toEqual(latest);
  expect(store.read(address).content).toEqual(latest);
  expect(store.read(address).dirty).toBe(false);
  expect(host.read(address)).toMatchObject(latest);
});

test("a queued background mirror skips a clean draft instead of reporting a stale target", async () => {
  const { store, host } = fixture();
  store.edit(address, () => content("first"));
  const target = store.read(address);
  const first = store.flush(address, async (params) => {
    store.edit(address, () => content("newer acknowledged text"));
    return host.sync({ ...params, content: store.read(address).content });
  });
  const second = store.flush(
    address,
    async () => {
      throw new Error("clean draft must not be mirrored again");
    },
    target,
  );
  await first;
  await second;
  expect(store.read(address).dirty).toBe(false);
  expect(host.read(address).text).toBe("newer acknowledged text");
});

test("an older queued mirror uses newer unsynced input", async () => {
  const { store, host } = fixture();
  store.edit(address, () => content("old capture"));
  const target = store.read(address);
  store.edit(address, () => content("latest input"));
  await store.flush(address, async (params) => host.sync(params), target);
  expect(host.read(address).text).toBe("latest input");
  expect(store.read(address).dirty).toBe(false);
});

test("identical rejected content across multiple revisions does not conflict with newer input", async () => {
  const { store, host } = fixture(false);
  host.setText(address, "same");
  host.setText(address, "same");
  store.edit(address, () => content("same"));
  let calls = 0;
  await store.flush(address, async (params) => {
    if (++calls === 1) store.edit(address, () => content("latest input"));
    return host.sync(params);
  });
  expect(calls).toBe(2);
  expect(store.read(address).content.text).toBe("latest input");
  expect(store.read(address).dirty).toBe(false);
  expect(host.read(address).text).toBe("latest input");
});

test("identical remote content is acknowledged even across multiple revisions", async () => {
  const { store, host } = fixture(false);
  store.edit(address, () => content("same"));
  host.setText(address, "same");
  host.setText(address, "same");
  let calls = 0;
  await store.flush(address, async (params) => {
    calls++;
    return host.sync(params);
  });
  expect(calls).toBe(1);
  expect(store.read(address).dirty).toBe(false);
  expect(store.read(address).revision).toBe(2);
});

test("an extension edit discovered by a rejected mirror CAS is retried silently", async () => {
  const { store, host } = fixture(false);
  store.edit(address, () => content("local"));
  host.setText(address, "extension");
  let calls = 0;
  await store.flush(address, async (params) => {
    calls++;
    return host.sync(params);
  });
  expect(calls).toBe(2);
  expect(store.read(address).content.text).toBe("local");
  expect(store.read(address).dirty).toBe(false);
  expect(host.read(address).text).toBe("local");
});

test("safe retries are bounded and do not claim a still-dirty draft was saved", async () => {
  const { store, host } = fixture();
  store.edit(address, () => content("first"));
  let calls = 0;
  await expect(
    store.flush(address, async (params) => {
      host.setText(address, params.content.text);
      store.edit(address, () => content(`newer ${++calls}`));
      return host.sync(params);
    }),
  ).rejects.toThrow("kept changing");
  expect(calls).toBe(2);
  expect(store.read(address).content.text).toBe("newer 2");
  expect(store.read(address).dirty).toBe(true);
});

test("a send rebases on a newer extension revision without sending or clearing its text", async () => {
  const { store, host } = fixture(false);
  store.edit(address, () => content("send me"));
  const inputs: DraftSyncParams[] = [];
  const prompts: string[] = [];
  const errors: string[] = [];
  const sends = new SendController(
    store,
    {
      syncDraft: async (params) => {
        inputs.push(params);
        if (inputs.length === 1) {
          host.setText(address, "earlier extension text");
          const rejected = host.sync(params);
          host.setText(address, "extension");
          store.receive(address, host.read(address));
          return rejected;
        }
        return host.sync(params);
      },
      prompt: async (params) => {
        prompts.push(params.text);
        host.consume(address, params.draftRevision, () => {});
        store.receive(address, host.read(address));
        return { disposition: "started" };
      },
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
    undefined,
    (error) => errors.push(error),
  );
  await sends.send(address);
  expect(inputs.map(({ expectedRevision }) => expectedRevision)).toEqual([
    0, 2,
  ]);
  expect(inputs[1].requestId).toBe(inputs[0].requestId);
  expect(prompts).toEqual(["send me"]);
  expect(errors).toEqual([]);
  expect(sends.read(address)?.state).toBe("accepted");
  expect(store.read(address).content.text).toBe("extension");
  await store.flush(address, async (params) => host.sync(params));
  expect(host.read(address).text).toBe("extension");
});

test.each([
  "consumed",
  "identical",
])("send retries %s revisions and still reserves its captured payload", async (scenario) => {
  const { store, host } = fixture(false);
  if (scenario === "consumed") {
    host.setText(address, "previous send");
    store.receive(address, host.read(address));
  } else {
    host.setText(address, "send me");
    host.setText(address, "send me");
  }
  store.edit(address, () => content("send me"));
  const inputs: DraftSyncParams[] = [];
  const reserved = new Map<string, string>();
  const prompts: PromptParams[] = [];
  const sends = new SendController(
    store,
    {
      syncDraft: async (params) => {
        inputs.push(params);
        if (inputs.length === 1 && scenario === "consumed")
          host.consume(address, params.expectedRevision, () => {});
        const result = host.sync(params);
        if (result.applied && params.requestId)
          reserved.set(params.requestId, params.content.text);
        if (inputs.length === 2)
          store.edit(address, () => content("next draft"));
        return result;
      },
      prompt: async (params) => {
        expect(reserved.get(params.requestId)).toBe("send me");
        prompts.push(params);
        return { disposition: "started" };
      },
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
  );
  await sends.send(address);
  expect(inputs).toHaveLength(2);
  expect(inputs[1].requestId).toBe(inputs[0].requestId);
  expect(inputs[1].content.text).toBe("send me");
  expect(prompts).toHaveLength(1);
  expect(prompts[0].text).toBe("send me");
  expect(prompts[0].draftRevision).toBe(3);
  expect(sends.read(address)?.state).toBe("accepted");
  expect(store.read(address).content.text).toBe("next draft");
});
