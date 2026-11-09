import { expect, test } from "bun:test";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { DraftContent, SessionAddress } from "../shared/runtime-contract";
import { ComposerBridge } from "./composer-bridge";

const a: SessionAddress = { hostId: "host", sessionId: "opaque-a", epoch: 1 };
const b: SessionAddress = { ...a, sessionId: "opaque-b" };
const image: DraftContent["images"][number] = {
  id: "image",
  image: { type: "image", mimeType: "image/png", data: "Zml4dHVyZQ==" },
};
function fixture() {
  const events: ExtensionUIEvent[] = [];
  return { bridge: new ComposerBridge((event) => events.push(event)), events };
}

test("CAS mirror is synchronous, server revision wins and returned objects cannot mutate it", () => {
  const { bridge, events } = fixture();
  expect(bridge.read(a)).toEqual({
    text: "",
    pastes: [],
    images: [],
    revision: 0,
  });
  const content: DraftContent = {
    text: "typed",
    pastes: [],
    images: [structuredClone(image)],
  };
  const applied = bridge.sync({ ...a, expectedRevision: 0, content });
  expect(applied.applied).toBe(true);
  expect(applied.draft.revision).toBe(1);
  content.text = "aliased";
  const firstImage = content.images[0];
  if (!firstImage) throw new Error("Missing image fixture");
  firstImage.image.data = "changed";
  applied.draft.text = "aliased result";
  bridge.setText(a, "extension edit");
  const stale = bridge.sync({
    ...a,
    expectedRevision: 1,
    content: { text: "late UI edit", pastes: [], images: [] },
  });
  expect(stale.applied).toBe(false);
  expect(stale.draft).toMatchObject({
    text: "extension edit",
    images: [image],
    revision: 2,
  });
  expect(bridge.read(b).revision).toBe(0);
  expect(events.filter((event) => event.type === "draft")).toHaveLength(2);
  const read = bridge.read(a);
  read.images.length = 0;
  expect(bridge.read(a).images).toEqual([image]);
});

test("paste folding shares Composer rules; setText reconciles markers and preserves images", () => {
  const { bridge } = fixture();
  bridge.sync({
    ...a,
    expectedRevision: 0,
    content: { text: "prefix ", pastes: [], images: [image] },
  });
  const long = "line\r\n".repeat(12);
  bridge.paste(a, long);
  const folded = bridge.read(a);
  expect(folded.pastes).toHaveLength(1);
  expect(folded.text).toContain("[paste #1 +13 lines]");
  expect(bridge.expandedText(a)).toBe(`prefix ${long.replace(/\r\n/g, "\n")}`);
  bridge.setText(a, `new ${folded.pastes[0]?.marker}`);
  expect(bridge.read(a).pastes).toHaveLength(1);
  expect(bridge.read(a).images).toEqual([image]);
  bridge.setText(a, "replace all");
  expect(bridge.read(a).pastes).toHaveLength(0);
  bridge.paste(a, " small\r\npaste");
  expect(bridge.expandedText(a)).toBe("replace all small\npaste");
  expect(bridge.read(a).images).toEqual([image]);
});

test("epoch transfer preserves inactive draft/images and retires stale addresses; remove is final", () => {
  const { bridge } = fixture();
  bridge.setText(a, "A");
  bridge.setText(b, "B");
  const next = { ...a, sessionId: "forked-opaque", epoch: 3 };
  bridge.transfer(a, next);
  expect(bridge.read(next)).toMatchObject({ text: "A", revision: 2 });
  expect(bridge.read(b).text).toBe("B");
  expect(() =>
    bridge.sync({
      ...a,
      expectedRevision: 1,
      content: { text: "late ACK", pastes: [], images: [] },
    }),
  ).toThrow("Stale");
  expect(() => bridge.setText(a, "late extension")).toThrow("Stale");
  expect(() =>
    bridge.transfer(next, { ...next, hostId: "wrong-host", epoch: 4 }),
  ).toThrow();
  bridge.remove(next);
  expect(() => bridge.read(next)).toThrow("Stale");
  expect(bridge.read(b).text).toBe("B");
});

test("invalid image/paste/revision rejected before draft changes", () => {
  const { bridge } = fixture();
  expect(() =>
    bridge.sync({
      ...a,
      expectedRevision: -1,
      content: { text: "", pastes: [], images: [] },
    }),
  ).toThrow();
  expect(() =>
    bridge.sync({
      ...a,
      expectedRevision: 0,
      content: {
        text: "",
        pastes: [{ id: "1", marker: "invalid", text: "x" }],
        images: [],
      },
    }),
  ).toThrow();
  expect(() =>
    bridge.sync({
      ...a,
      expectedRevision: 0,
      content: { text: "", pastes: [], images: [image, image] },
    }),
  ).toThrow();
  expect(bridge.read(a).revision).toBe(0);
});
