import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DraftContent,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  SendIntent,
  SendKey,
} from "../shared/runtime-contract";
import { DraftStore, emptyContent } from "./draft-store";
import { MessageQueue } from "./MessageQueue";
import { SendController } from "./send-controller";

const address = { hostId: "queue-host", sessionId: "s", epoch: 1 };
const content: DraftContent = {
  text: "later",
  pastes: [],
  images: [
    {
      id: "img",
      image: { type: "image", data: "secret-base64", mimeType: "image/png" },
    },
  ],
  files: [{ id: "file", name: "notes.txt", path: "/notes.txt" }],
};

function fixture() {
  const drafts = new DraftStore();
  const pending = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<PromptAccepted>>
  >();
  const receipts = new Map<string, PromptReceipt>();
  const prompts: PromptParams[] = [];
  const cancelled: SendKey[] = [];
  const syncs: string[] = [];
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (p) => {
        syncs.push(p.delivery ?? "none");
        return {
          applied: true,
          draft: { ...p.content, revision: p.expectedRevision + 1 },
        };
      },
      prompt: (p) => {
        prompts.push(p);
        const task = Promise.withResolvers<PromptAccepted>();
        pending.set(p.requestId, task);
        receipts.set(p.requestId, { ...p, state: "pending", stage: "queued" });
        return task.promise;
      },
      getPromptReceipt: async (key) =>
        receipts.get(key.requestId) ?? {
          ...key,
          state: "unknown",
          reason: "not-found",
        },
      cancelPrompt: async (key) => {
        cancelled.push(key);
        const receipt: PromptReceipt = {
          ...key,
          state: "rejected",
          code: "CANCELLED",
          message: "cancelled",
        };
        receipts.set(key.requestId, receipt);
        pending.get(key.requestId)?.reject(new Error("cancelled"));
        return receipt;
      },
    },
    () => {},
  );
  return { drafts, sends, prompts, pending, receipts, cancelled, syncs };
}

test("queue appears immediately outside conversation, forwards delivery through CAS and prompt, delete never restores it", async () => {
  const f = fixture();
  f.drafts.edit(address, () => content);
  const sending = f.sends.send(address, undefined, undefined, "followUp");
  expect(f.sends.queued(address)).toHaveLength(1);
  expect(f.sends.optimistic(address)).toHaveLength(0);
  await Bun.sleep(0);
  expect(f.syncs).toEqual(["followUp"]);
  expect(f.prompts[0].delivery).toBe("followUp");
  await f.sends.lookup(address);
  expect(f.sends.queued(address)).toHaveLength(1);
  expect(f.sends.retained()).toEqual([]);
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "new draft" }));
  expect(
    await f.sends.withdrawQueued(address, f.sends.queued(address)[0].key),
  ).toBe(true);
  await sending;
  expect(f.sends.queued(address)).toHaveLength(0);
  expect(f.drafts.read(address).content.text).toBe("new draft");
  expect(f.cancelled).toHaveLength(1);
});

test("editing withdraws exactly once and preserves newer text, images and files", async () => {
  const f = fixture();
  const sending = f.sends.send(address, content, undefined, "followUp");
  await Bun.sleep(0);
  f.drafts.edit(address, () => ({ ...emptyContent(), text: "newer" }));
  const key = f.sends.queued(address)[0].key;
  expect(await f.sends.withdrawQueued(address, key, true)).toBe(true);
  await sending;
  expect(await f.sends.withdrawQueued(address, key, true)).toBe(false);
  expect(f.drafts.read(address).content.text).toBe("later\n\nnewer");
  expect(f.drafts.read(address).content.images).toEqual(content.images);
  expect(f.drafts.read(address).content.files).toEqual(content.files);
});

test("deleting during file reads prevents any later dispatch", async () => {
  const f = fixture();
  const attachments =
    Promise.withResolvers<Pick<DraftContent, "images" | "files">>();
  f.drafts.edit(address, () => content);
  const sending = f.sends.send(
    address,
    undefined,
    attachments.promise,
    "followUp",
  );
  await Bun.sleep(0);
  await f.sends.withdrawQueued(address, f.sends.queued(address)[0].key);
  attachments.resolve({ images: [], files: [] });
  await sending;
  expect(f.prompts).toHaveLength(0);
  expect(f.drafts.read(address).content.text).toBe("");
});

test("renderer reload restores the queue and cancels on the host rather than hiding a live send locally", async () => {
  const f = fixture();
  const intent: SendIntent = {
    receipt: {
      ...address,
      requestId: "restored",
      state: "pending",
      stage: "queued",
    },
    delivery: "followUp",
    timestamp: 123,
    content,
    draftRevision: 1,
    hash: "hash",
    owner: { cwd: "/p", sessionFile: null, branchId: null },
  };
  f.sends.restore([intent]);
  expect(f.sends.queued(address)[0].timestamp).toBe(123);
  expect(await f.sends.withdrawQueued(address, intent.receipt)).toBe(true);
  expect(f.cancelled).toHaveLength(1);
  f.sends.restore([intent]);
  expect(f.sends.queued(address)).toHaveLength(0);
});

test("a queue item that has already started cannot be deleted or duplicated into the editor", async () => {
  const f = fixture();
  const sending = f.sends.send(address, content, undefined, "followUp");
  await Bun.sleep(0);
  const key = f.sends.queued(address)[0].key;
  const accepted: PromptReceipt = {
    ...key,
    state: "accepted",
    accepted: { disposition: "started" },
    acceptedAt: 1,
  };
  // Simulate acceptance racing with the cancel RPC, which must return the authoritative receipt.
  const race = new SendController(
    f.drafts,
    {
      syncDraft: async (p) => ({
        applied: true,
        draft: { ...p.content, revision: 1 },
      }),
      prompt: async () => ({ disposition: "started" }),
      getPromptReceipt: async () => accepted,
      cancelPrompt: async () => accepted,
    },
    () => {},
  );
  race.restore([
    {
      receipt: { ...key, state: "pending", stage: "queued" },
      delivery: "followUp",
      content,
      draftRevision: 1,
      hash: "h",
      owner: { cwd: "/p", sessionFile: null, branchId: null },
    },
  ]);
  expect(await race.withdrawQueued(address, key, true)).toBe(false);
  expect(f.drafts.read(address).content.text).toBe("");
  f.pending.get(key.requestId)?.resolve(accepted.accepted);
  await sending;
  expect(f.sends.queued(address)).toHaveLength(0);
});

test("a preflight failure racing deletion restores the message instead of losing it", async () => {
  const drafts = new DraftStore();
  const key = { ...address, requestId: "auth-failure" };
  const rejected: PromptReceipt = {
    ...key,
    state: "rejected",
    code: "AUTH",
    message: "Configure provider",
  };
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (p) => ({
        applied: true,
        draft: { ...p.content, revision: 1 },
      }),
      prompt: async () => ({ disposition: "started" }),
      getPromptReceipt: async () => rejected,
      cancelPrompt: async () => {
        await sends.lookup(address, key);
        return rejected;
      },
    },
    () => {},
  );
  sends.restore([
    {
      receipt: { ...key, state: "pending", stage: "queued" },
      delivery: "followUp",
      content,
      draftRevision: 1,
      hash: "h",
      owner: { cwd: "/p", sessionFile: null, branchId: null },
    },
  ]);
  await expect(sends.withdrawQueued(address, key)).rejects.toThrow(
    "Configure provider",
  );
  expect(drafts.read(address).content.text).toBe("later");
  expect(drafts.read(address).content.images).toEqual(content.images);
});

test("compact queue markup escapes content, offers edit/delete and never exposes image bytes", () => {
  const html = renderToStaticMarkup(
    <MessageQueue
      items={[
        { id: "one", content: { ...content, text: "<script>hello</script>" } },
      ]}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );
  expect(html).toContain("Send after response");
  expect(html).toContain("&lt;script&gt;hello&lt;/script&gt;");
  expect(html).toContain('aria-label="Edit queued message in composer"');
  expect(html).toContain('aria-label="Delete queued message"');
  expect(html).not.toContain("secret-base64");
  expect(
    renderToStaticMarkup(
      <MessageQueue items={[]} onEdit={() => {}} onDelete={() => {}} />,
    ),
  ).toBe("");
});

function reorderable() {
  const f = fixture();
  const calls: { requestIds?: string[]; steer?: string }[] = [];
  let order: string[] | Error = [];
  let steer = true;
  const sends = new SendController(
    f.drafts,
    {
      syncDraft: async (p) => ({
        applied: true,
        draft: { ...p.content, revision: p.expectedRevision + 1 },
      }),
      prompt: () => new Promise(() => {}),
      getPromptReceipt: async (key) => ({
        ...key,
        state: "pending",
        stage: "queued",
      }),
      reorderPrompts: async ({ requestIds }) => {
        calls.push({ requestIds });
        if (order instanceof Error) throw order;
        return order.length ? order : requestIds;
      },
      steerPrompt: async (key) => {
        calls.push({ steer: key.requestId });
        return steer;
      },
    },
    () => {},
  );
  const texts = () =>
    sends.queued(address).map((item) => item.content?.text ?? "");
  const ids = () => sends.queued(address).map((item) => item.key.requestId);
  return {
    sends,
    calls,
    texts,
    ids,
    hostOrder: (next: string[] | Error) => {
      order = next;
    },
    refuseSteer: () => {
      steer = false;
    },
  };
}
const message = (text: string): DraftContent => ({
  text,
  pastes: [],
  images: [],
});

test("reordering shows at once, adopts the host order, and rolls back when the host fails", async () => {
  const r = reorderable();
  for (const text of ["a", "b", "c"])
    void r.sends.send(address, message(text), undefined, "followUp");
  await Bun.sleep(0);
  const [a, b, c] = r.ids();
  const moving = r.sends.reorderQueued(address, [c, a, b]);
  expect(r.texts()).toEqual(["c", "a", "b"]);
  await moving;
  expect(r.calls[0].requestIds).toEqual([c, a, b]);
  // The host keeps a started head first, whatever the renderer asked.
  r.hostOrder([a, b, c]);
  await r.sends.reorderQueued(address, [b, c, a]);
  expect(r.texts()).toEqual(["a", "b", "c"]);
  r.hostOrder(new Error("offline"));
  await expect(r.sends.reorderQueued(address, [c, b, a])).rejects.toThrow(
    "offline",
  );
  expect(r.texts()).toEqual(["a", "b", "c"]);
});

test("steering a queued message moves it from the queue into the conversation", async () => {
  const r = reorderable();
  void r.sends.send(address, message("now"), undefined, "followUp");
  void r.sends.send(address, message("later"), undefined, "followUp");
  await Bun.sleep(0);
  const [now] = r.sends.queued(address);
  expect(await r.sends.steerQueued(address, now.key)).toBe(true);
  expect(r.texts()).toEqual(["later"]);
  const shown = r.sends.optimistic(address);
  expect(shown.map((item) => [item.content?.text, item.delivery])).toEqual([
    ["now", "steer"],
  ]);
  // Later status updates from the original send keep the promoted delivery.
  await r.sends.lookup(address, now.key);
  expect(r.sends.optimistic(address)[0].delivery).toBe("steer");
  r.refuseSteer();
  const [later] = r.sends.queued(address);
  expect(await r.sends.steerQueued(address, later.key)).toBe(false);
  expect(r.texts()).toEqual(["later"]);
});

test("queue rows offer reorder and steer only when wired, and a started row cannot move or steer", () => {
  const html = renderToStaticMarkup(
    <MessageQueue
      items={[
        { id: "head", content: message("first"), locked: true },
        { id: "one", content: message("second") },
        { id: "two", content: message("third") },
      ]}
      onEdit={() => {}}
      onDelete={() => {}}
      onMove={() => {}}
      onSteer={() => {}}
    />,
  );
  expect(html.match(/class="message-queue-grip"/g)).toHaveLength(2);
  expect(html.match(/class="message-queue-handle"/g)).toHaveLength(3);
  expect(
    html.match(/aria-label="Send now, without waiting \(steer\)"/g),
  ).toHaveLength(3);
  expect(html).toMatch(
    /aria-label="Send now, without waiting \(steer\)" disabled=""/,
  );
  const plain = renderToStaticMarkup(
    <MessageQueue
      items={[{ id: "one", content: message("only") }]}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );
  expect(plain).not.toContain("message-queue-grip");
  expect(plain).not.toContain("Send now");
});
