import { afterEach, expect, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import { drafts, emptyContent } from "./draft-store";
import {
  openingDraftKey,
  queueOpeningSend,
  removeOpeningSend,
  restoreOpeningSends,
} from "./opening-sends";
import { useStore } from "./store";

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));

test("startup sends retain captured content after navigation, and cancelling restores it before newer typing", () => {
  useStore.setState({
    openId: "a",
    pendingOpens: { a: { cwd: "project" } },
    newChatDrafts: {},
  });
  const content = { ...emptyContent(), text: "sent before ready" };
  queueOpeningSend("a", content);
  content.text = "changed after capture";
  useStore.setState({
    openId: "b",
    openingTarget: { cwd: "other" },
    newChatDrafts: { project: "newer typing" },
  });
  restoreOpeningSends("a");
  expect(useStore.getState().newChatDrafts.project).toBe(
    "sent before ready\n\nnewer typing",
  );
  expect(useStore.getState().openingTarget?.cwd).toBe("other");
});

test("existing startup send restoration preserves attachments and cannot overwrite another chat", () => {
  const address = {
    hostId: "opening-tests",
    sessionId: crypto.randomUUID(),
    epoch: 1,
  };
  const snapshot = {
    address,
    snapshotSeq: 1,
    info: { id: address.sessionId, cwd: "project", title: "Chat", modified: 1 },
    effort: "off" as const,
    effortLevels: [],
    transcript: emptyTranscript(),
  };
  useStore.setState({
    openId: "a",
    pendingOpens: { a: { cwd: "project", id: address.sessionId } },
    snapshots: { [address.sessionId]: snapshot },
  });
  queueOpeningSend("a", {
    ...emptyContent(),
    text: "sent",
    images: [
      {
        id: "i",
        image: { type: "image", mimeType: "image/png", data: "image" },
      },
    ],
  });
  drafts.edit(address, () => ({ ...emptyContent(), text: "newer" }));
  restoreOpeningSends("a");
  expect(drafts.read(address).content.text).toBe("sent\n\nnewer");
  expect(drafts.read(address).content.images).toHaveLength(1);
  const queued = useStore.getState().pendingOpens.a.queuedSends?.[0];
  if (!queued) throw new Error("Missing queued message");
  removeOpeningSend("a", queued.id);
  expect(useStore.getState().pendingOpens.a.queuedSends).toEqual([]);
  expect(openingDraftKey({ cwd: "project", id: "one" })).not.toBe(
    openingDraftKey({ cwd: "project", id: "two" }),
  );
});
