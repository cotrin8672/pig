import { afterEach, expect, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import { drafts, emptyContent } from "./draft-store";
import {
  openingDraftKey,
  openingSends,
  queueOpeningSelection,
  queueOpeningSend,
  restoreOpeningSends,
  takeOpeningOps,
  withdrawOpeningSend,
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

test("startup sends and model choices replay in click order; Stop returns only messages", () => {
  useStore.setState({
    openId: "a",
    pendingOpens: { a: { cwd: "project" } },
    newChatDrafts: {},
  });
  const model = (id: string) => ({
    model: { provider: "p", id, name: id },
    effort: "off" as const,
    effortLevels: [],
  });
  queueOpeningSend("a", { ...emptyContent(), text: "first" });
  queueOpeningSelection("a", model("B"));
  queueOpeningSend("a", { ...emptyContent(), text: "second" });
  expect(useStore.getState().pendingOpens.a.selection?.model?.id).toBe("B");
  expect(
    useStore
      .getState()
      .pendingOpens.a.queued?.map((op) =>
        op.kind === "send" ? op.content.text : op.selection.model?.id,
      ),
  ).toEqual(["first", "B", "second"]);
  restoreOpeningSends("a");
  expect(useStore.getState().newChatDrafts.project).toBe("first\n\nsecond");
  expect(takeOpeningOps("a").map((op) => op.kind)).toEqual(["select"]);
  expect(useStore.getState().pendingOpens.a.queued).toEqual([]);
});

test("startup retains delivery and deleting one queue entry preserves other sends and selections", () => {
  useStore.setState({ openId: "a", pendingOpens: { a: { cwd: "project" } } });
  queueOpeningSend("a", { ...emptyContent(), text: "normal" });
  queueOpeningSend("a", { ...emptyContent(), text: "later" }, "followUp");
  const [normal, queued] = openingSends(useStore.getState().pendingOpens.a);
  expect(normal.delivery).toBe("steer");
  expect(queued.delivery).toBe("followUp");
  expect(withdrawOpeningSend("a", queued.id)?.content.text).toBe("later");
  expect(
    openingSends(useStore.getState().pendingOpens.a).map((send) => send.id),
  ).toEqual([normal.id]);
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
  expect(openingSends(useStore.getState().pendingOpens.a)).toEqual([]);
  expect(openingDraftKey({ cwd: "project", id: "one" })).not.toBe(
    openingDraftKey({ cwd: "project", id: "two" }),
  );
});
