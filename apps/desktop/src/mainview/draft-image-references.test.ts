import { expect, test } from "bun:test";
import { ComposerBridge } from "../bun/composer-bridge";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import { createDraftMirror } from "./draft-mirror";
import { DraftStore } from "./draft-store";

const address = { hostId: "images", sessionId: "references", epoch: 1 };
const image = {
  id: "image",
  image: {
    type: "image" as const,
    mimeType: "image/png",
    data: "A".repeat(1024 * 1024),
  },
};

test("text mirrors with retained images have small requests, replies AND extension events", async () => {
  const store = new DraftStore();
  const events: ExtensionUIEvent[] = [];
  const bridge = new ComposerBridge((event) => {
    events.push(event);
    if (event.type === "draft")
      expect(store.receive(event.address, event.draft, event.imageRefs)).toBe(
        true,
      );
  });
  const mirror = createDraftMirror(async (params) => bridge.sync(params));
  store.edit(address, (content) => ({ ...content, images: [image] }));
  await store.flush(address, mirror);
  events.length = 0;
  for (let i = 0; i < 10; i++) {
    store.edit(address, (content) => ({ ...content, text: String(i) }));
    await store.flush(address, mirror);
  }
  expect(events).toHaveLength(10);
  expect(Buffer.byteLength(JSON.stringify(events))).toBeLessThan(5000);
  expect(store.read(address).content.images).toEqual([image]);
  expect(store.read(address).content.text).toBe("9");
  expect(store.read(address).conflict).toBeUndefined();
  // Neither event nor returned objects can mutate the host's retained images.
  const read = bridge.read(address);
  read.images[0].image.data = "changed";
  expect(bridge.read(address).images).toEqual([image]);
});

test("a missing base never clears local images; an authoritative read preserves conflicts", () => {
  const store = new DraftStore();
  store.edit(address, (content) => ({
    ...content,
    text: "local",
    images: [image],
  }));
  const compact = { text: "remote", pastes: [], images: [], revision: 2 };
  expect(
    store.receive(address, compact, { revision: 1, ids: [image.id] }),
  ).toBe(false);
  expect(store.read(address).content.images).toEqual([image]);
  expect(store.read(address).content.text).toBe("local");
  store.receive(address, { ...compact, images: [image] });
  expect(store.read(address).content.text).toBe("local");
  expect(store.read(address).conflict?.images).toEqual([image]);
});

test("image references use acknowledged host bytes, not same-ID unsynced edits", () => {
  const store = new DraftStore();
  store.receive(address, {
    text: "base",
    pastes: [],
    images: [image],
    revision: 1,
  });
  store.edit(address, (content) => ({
    ...content,
    images: [{ ...image, image: { ...image.image, data: "local edit" } }],
  }));
  expect(
    store.receive(
      address,
      { text: "extension edit", pastes: [], images: [], revision: 2 },
      { revision: 1, ids: [image.id] },
    ),
  ).toBe(true);
  expect(store.read(address).content.images[0].image.data).toBe("local edit");
  expect(store.read(address).conflict?.images).toEqual([image]);
});

test("revision gaps and missing IDs request recovery; old/retired events cannot roll back drafts", () => {
  const store = new DraftStore();
  store.receive(address, {
    text: "base",
    pastes: [],
    images: [image],
    revision: 1,
  });
  const compact = { text: "later", pastes: [], images: [], revision: 3 };
  expect(
    store.receive(address, compact, { revision: 2, ids: [image.id] }),
  ).toBe(false);
  expect(
    store.receive(
      address,
      { ...compact, revision: 2 },
      { revision: 1, ids: ["wrong"] },
    ),
  ).toBe(false);
  store.receive(address, { ...compact, images: [image] });
  expect(
    store.receive(
      address,
      { ...compact, revision: 2 },
      { revision: 1, ids: ["wrong"] },
    ),
  ).toBe(true);
  expect(store.read(address).content.text).toBe("later");
  store.retire(address);
  expect(
    store.receive(
      address,
      { ...compact, revision: 4 },
      { revision: 3, ids: [image.id] },
    ),
  ).toBe(true);
  expect(store.read(address).content.text).toBe("later");
});
