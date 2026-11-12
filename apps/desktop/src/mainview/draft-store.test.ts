import { expect, test } from "bun:test";
import type {
  DraftState,
  DraftSyncParams,
  DraftSyncResult,
} from "../shared/runtime-contract";
import { DraftStore, emptyContent, expandedDraft } from "./draft-store";

const a = { hostId: "host", sessionId: "sdk-a", epoch: 1 };
const b = { ...a, sessionId: "sdk-b", epoch: 2 };
const content = (text: string) => ({ ...emptyContent(), text });
function mirror() {
  let remote: DraftState = { ...emptyContent(), revision: 0 };
  return async (params: DraftSyncParams): Promise<DraftSyncResult> => {
    if (params.expectedRevision !== remote.revision)
      return { applied: false, draft: remote };
    remote = { ...params.content, revision: remote.revision + 1 };
    return { applied: true, draft: remote };
  };
}
test("drafts, folded pastes and ordered images survive navigation by exact owner", async () => {
  const store = new DraftStore();
  const image = { type: "image" as const, mimeType: "image/png", data: "YWJj" };
  store.edit(a, () => ({
    text: "quote [paste #1 9 chars]",
    pastes: [{ id: "p", marker: "[paste #1 9 chars]", text: "long text" }],
    images: [{ id: "i", image }],
  }));
  store.edit(b, () => content("other session"));
  expect(expandedDraft(store.read(a).content)).toBe("quote long text");
  await store.flush(a, mirror());
  expect(store.read(a).dirty).toBe(false);
  expect(store.read(a).content.images[0].image).toEqual(image);
  expect(store.read(b).content.text).toBe("other session");
});
test("extension setText applies to inactive clean draft and does not erase images", () => {
  const store = new DraftStore();
  store.receive(b, {
    ...content("extension"),
    revision: 1,
    images: [
      { id: "i", image: { type: "image", mimeType: "image/png", data: "x" } },
    ],
  });
  expect(store.read(a).content.text).toBe("");
  expect(store.read(b).content.text).toBe("extension");
  expect(store.read(b).content.images).toHaveLength(1);
});
test("CAS conflict retains local and extension editor changes until explicit reconciliation", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("typing"));
  store.receive(a, { ...content("extension"), revision: 4 });
  expect(store.read(a).content.text).toBe("typing");
  expect(store.read(a).conflict?.text).toBe("extension");
  let calls = 0;
  await expect(
    store.flush(a, async () => {
      calls++;
      throw new Error("not reached");
    }),
  ).rejects.toThrow("Choose");
  expect(calls).toBe(0);
  store.resolve(a, "extension");
  expect(store.read(a).content.text).toBe("extension");
  expect(store.read(a).dirty).toBe(false);
});
test("CAS reject cannot silently overwrite local content", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("local"));
  await expect(
    store.flush(a, async () => ({
      applied: false,
      draft: { ...content("remote"), revision: 2 },
    })),
  ).rejects.toThrow("conflict");
  expect(store.read(a).content.text).toBe("local");
  expect(store.read(a).conflict?.text).toBe("remote");
});
test("one mirror flush captures its revision; edits during ACK remain for the next flush", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("first"));
  const seen: string[] = [];
  await store.flush(a, async (params) => {
    seen.push(params.content.text);
    const remote = { ...params.content, revision: params.expectedRevision + 1 };
    store.receive(a, remote);
    if (seen.length === 1) store.edit(a, () => content("second"));
    return { applied: true, draft: remote };
  });
  expect(seen).toEqual(["first"]);
  expect(store.read(a).conflict).toBeUndefined();
  expect(store.read(a).dirty).toBe(true);
  await store.flush(a, async (params) => {
    seen.push(params.content.text);
    return {
      applied: true,
      draft: { ...params.content, revision: params.expectedRevision + 1 },
    };
  });
  expect(seen).toEqual(["first", "second"]);
  expect(store.read(a).dirty).toBe(false);
});

test("a host consumption event advances CAS without conflicting with newer local input", () => {
  const store = new DraftStore();
  store.receive(a, { ...content("sent"), revision: 1 });
  store.edit(a, () => content("next draft"));
  store.receive(a, { ...emptyContent(), revision: 2, consumedRevision: 1 });
  expect(store.read(a).content.text).toBe("next draft");
  expect(store.read(a).conflict).toBeUndefined();
  expect(store.read(a).revision).toBe(2);
  expect(store.read(a).dirty).toBe(true);
});
test("late old-epoch ACK and accepted clear cannot mutate transferred draft", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("unsynced"));
  const version = store.read(a).version;
  const next = { ...a, epoch: 3 };
  store.transfer(a, next);
  store.receive(a, { ...emptyContent(), revision: 99 });
  expect(store.clearAccepted(a, version)).toBe(false);
  expect(store.read(next).content.text).toBe("unsynced");
  await expect(store.flush(a, mirror())).rejects.toThrow("replaced");
});
test("transfers release old payloads and conflicts, retaining only the destination draft", () => {
  const store = new DraftStore();
  let address = a;
  const previous = [];
  for (let i = 0; i < 20; i++) {
    const payload = {
      ...content(`draft ${i}`),
      pastes: [{ id: "paste", marker: "[paste]", text: "x".repeat(100_000) }],
      images: [
        {
          id: "image",
          image: {
            type: "image" as const,
            mimeType: "image/png",
            data: "x".repeat(100_000),
          },
        },
      ],
    };
    store.edit(address, () => payload);
    store.receive(address, { ...content("extension"), revision: i + 1 });
    const next = { ...address, epoch: address.epoch + 1 };
    store.transfer(address, next);
    expect(store.read(next).content).toBe(payload);
    expect(store.read(next).conflict?.text).toBe("extension");
    expect(store.read(address).content).toEqual(emptyContent());
    expect(store.read(address).conflict).toBeUndefined();
    expect(store.read(address).transferredVersion).toBe(
      store.read(next).version,
    );
    previous.push(address);
    store.resolve(next, "local");
    expect(store.clearAccepted(next, store.read(next).version)).toBe(true);
    address = next;
  }
  for (const owner of previous) {
    store.receive(owner, { ...content("late ACK"), revision: 100 });
    store.restoreSent(owner, content("late rejection"));
    expect(store.read(owner).content).toEqual(emptyContent());
  }
  expect(store.read(address).content).toEqual(emptyContent());
  expect(store.retained()).toEqual([]);
});

test("a late CAS conflict cannot reattach payloads to a transferred owner", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("local"));
  const response = Promise.withResolvers<DraftSyncResult>();
  const started = Promise.withResolvers<void>();
  const flush = store.flush(a, () => {
    started.resolve();
    return response.promise;
  });
  await started.promise;
  const next = { ...a, epoch: 2 };
  store.transfer(a, next);
  response.resolve({
    applied: false,
    draft: { ...content("remote payload"), revision: 99 },
  });
  await expect(flush).rejects.toThrow("conflict");
  expect(store.read(a).content).toEqual(emptyContent());
  expect(store.read(a).conflict).toBeUndefined();
  expect(store.read(next).content.text).toBe("local");
});

test("repeated transfers cannot overwrite newer edits or retire the current owner", () => {
  const store = new DraftStore();
  store.edit(a, () => content("original"));
  const next = { ...a, epoch: 2 };
  store.transfer(a, next);
  store.edit(next, () => content("newer"));
  store.transfer(a, next);
  store.transfer(next, next);
  expect(store.read(next).content.text).toBe("newer");
  expect(store.read(next).retired).toBeUndefined();
});

test("same-revision startup content invalidates the transferred version for late receipts", () => {
  const store = new DraftStore();
  store.receive(a, { ...content("old mirror"), revision: 0 });
  const next = { ...a, epoch: 2 };
  store.transfer(a, next);
  const version = store.read(next).version;
  expect(store.read(a).transferredVersion).toBe(version);
  store.receive(next, { ...content("startup text"), revision: 0 });
  expect(store.read(next).version).not.toBe(version);
  expect(store.clearAccepted(next, version)).toBe(false);
  expect(store.read(next).content.text).toBe("startup text");
});

test("acceptance only clears the exact unchanged local revision", () => {
  const store = new DraftStore();
  store.edit(a, () => content("send me"));
  const version = store.read(a).version;
  store.edit(a, () => content("new text"));
  expect(store.clearAccepted(a, version)).toBe(false);
  expect(store.clearAccepted(a, store.read(a).version)).toBe(true);
  expect(store.read(a).content).toEqual(emptyContent());
});

test("folded-paste expansion is single-pass like the Bun Composer mirror", () => {
  const content = {
    text: "[paste #1 18 chars]",
    images: [],
    pastes: [
      { id: "a", marker: "[paste #1 18 chars]", text: "[paste #2 6 chars]" },
      { id: "b", marker: "[paste #2 6 chars]", text: "secret" },
    ],
  };
  expect(expandedDraft(content)).toBe("[paste #2 6 chars]");
});

test("startup editor events racing replacement are retained, and orphaned drafts remain inspectable", () => {
  const store = new DraftStore();
  const next = { ...a, epoch: 7 };
  store.receive(a, { ...content("clean old"), revision: 1 });
  store.receive(next, { ...content("new startup text"), revision: 2 });
  store.transfer(a, next);
  expect(store.read(next).content.text).toBe("new startup text");
  expect(store.retained()).toHaveLength(0);
  store.retire(next);
  expect(store.retained()[0].draft.content.text).toBe("new startup text");
});

test("close/navigation flush captures the latest owner drafts and waits for their durable ACK", async () => {
  const store = new DraftStore();
  store.edit(a, () => content("typed before timer"));
  store.edit(b, () => content("other owner"));
  const ack = Promise.withResolvers<void>();
  const synced: DraftSyncParams[] = [];
  let finished = false;
  const barrier = store
    .flushAll(async (params) => {
      synced.push(params);
      await ack.promise;
      return {
        applied: true,
        draft: { ...params.content, revision: params.expectedRevision + 1 },
      };
    })
    .then(() => {
      finished = true;
    });
  await Bun.sleep(0);
  expect(synced.map((p) => p.content.text)).toEqual([
    "typed before timer",
    "other owner",
  ]);
  expect(finished).toBe(false);
  store.edit(a, () => content("edited after close request"));
  ack.resolve();
  await barrier;
  expect(finished).toBe(true);
  expect(store.read(a).content.text).toBe("edited after close request");
  expect(store.read(a).dirty).toBe(true);
  expect(store.read(b).dirty).toBe(false);
});
