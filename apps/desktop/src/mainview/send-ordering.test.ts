import { expect, test } from "bun:test";
import type { ModelSelection } from "../shared/rpc-schema";
import type {
  DraftContent,
  DraftSyncParams,
  PromptAccepted,
  PromptParams,
  SendKey,
} from "../shared/runtime-contract";
import { AttachmentReads } from "./attachment-reads";
import { DraftStore, emptyContent } from "./draft-store";
import { editKey, messageEdits } from "./message-edits";
import { SelectionController } from "./selection-controller";
import { SendController } from "./send-controller";
import { SessionLane } from "./session-lane";

const address = { hostId: "host", sessionId: "chat", epoch: 1 };
const model = (id: string): ModelSelection => ({
  model: { provider: "p", id, name: id },
  effort: "off",
  effortLevels: ["off"],
});
const text = (value: string): DraftContent => ({
  ...emptyContent(),
  text: value,
});

function fixture(options: { slowSync?: Promise<void> } = {}) {
  const drafts = new DraftStore();
  const lane = new SessionLane();
  const log: string[] = [];
  const cancelled: SendKey[] = [];
  const responses: ReturnType<typeof Promise.withResolvers<PromptAccepted>>[] =
    [];
  const sends = new SendController(
    drafts,
    {
      syncDraft: async (params: DraftSyncParams) => {
        await options.slowSync;
        return {
          applied: true,
          draft: { ...params.content, revision: params.expectedRevision + 1 },
        };
      },
      prompt: (params: PromptParams) => {
        log.push(`prompt:${params.text}`);
        const response = Promise.withResolvers<PromptAccepted>();
        responses.push(response);
        return response.promise;
      },
      getPromptReceipt: async (key) =>
        ({
          ...key,
          state: cancelled.some((item) => item.requestId === key.requestId)
            ? "rejected"
            : "pending",
          code: "CANCELLED",
          message: "cancelled",
        }) as never,
      cancelPrompt: async (key) => {
        cancelled.push(key);
        return { ...key, state: "rejected", code: "CANCELLED", message: "x" };
      },
    },
    () => {},
    5_000,
    () => {},
    (owner, step) => lane.enqueue(owner, step),
  );
  const selections = new SelectionController(
    () => {},
    () => {},
    (owner, issue) => lane.enqueue(owner, issue),
  );
  return { drafts, lane, log, sends, selections, responses, cancelled };
}

test("a model change after a send never overtakes it, even while the send's draft ACK is slow", async () => {
  const ack = Promise.withResolvers<void>();
  const f = fixture({ slowSync: ack.promise });
  f.drafts.edit(address, () => text("first"));
  const sent = f.sends.send(address);
  const changed = f.selections.change(
    address,
    model("A"),
    model("B"),
    async () => {
      f.log.push("select:B");
      return model("B");
    },
  );
  await Bun.sleep(0);
  expect(f.log).toEqual([]);
  ack.resolve();
  await changed;
  expect(f.log).toEqual(["prompt:first", "select:B"]);
  f.responses[0].resolve({ disposition: "started" });
  await sent;
});

test("the lane only waits for RPCs to be issued, not for answers or running turns", async () => {
  const f = fixture();
  f.drafts.edit(address, () => text("one"));
  void f.sends.send(address);
  f.drafts.edit(address, () => text("two"));
  void f.sends.send(address);
  await f.lane.enqueue(address, () => {});
  expect(f.log).toEqual(["prompt:one", "prompt:two"]);
  expect(f.responses).toHaveLength(2);
});

test("Stop cancels sends that were never dispatched and returns them ahead of newer typing", async () => {
  const ack = Promise.withResolvers<void>();
  const f = fixture({ slowSync: ack.promise });
  const stopped = Promise.withResolvers<void>();
  f.drafts.edit(address, () => text("queued"));
  const sent = f.sends.send(address);
  f.drafts.edit(address, () => text("newer"));
  await Bun.sleep(0); // the draft CAS (which reserves the ID on the host) is in flight
  void f.sends.stop(address, () => stopped.promise);
  ack.resolve();
  stopped.resolve();
  await sent;
  expect(f.log).toEqual([]);
  // The reserved ID is withdrawn so it can never look pending or be replayed.
  expect(f.cancelled).toHaveLength(1);
  expect(f.sends.optimistic(address)).toEqual([]);
  expect(f.drafts.read(address).content.text).toBe("queued\n\nnewer");
});

test("Stop before a queued send reaches the host needs no host withdrawal", async () => {
  const f = fixture();
  f.drafts.edit(address, () => text("local only"));
  const sent = f.sends.send(address);
  void f.sends.stop(address, async () => {});
  await sent;
  expect(f.log).toEqual([]);
  expect(f.cancelled).toEqual([]);
  expect(f.drafts.read(address).content.text).toBe("local only");
});

test("a send made while stopping is accepted immediately and dispatched after Stop finishes", async () => {
  const f = fixture();
  const stopped = Promise.withResolvers<void>();
  void f.sends.stop(address, () => stopped.promise);
  f.drafts.edit(address, () => text("after stop"));
  const sent = f.sends.send(address);
  await Bun.sleep(0);
  expect(f.drafts.read(address).content.text).toBe("");
  expect(f.sends.optimistic(address)[0].content?.text).toBe("after stop");
  expect(f.log).toEqual([]);
  stopped.resolve();
  await f.lane.enqueue(address, () => {});
  expect(f.log).toEqual(["prompt:after stop"]);
  f.responses[0].resolve({ disposition: "started" });
  await sent;
});

function readerFixture() {
  const readers: FileReader[] = [];
  const create = () => {
    const reader = {
      result: "",
      onload: null,
      onerror: null,
      onabort: null,
      readAsDataURL() {},
      abort() {},
    } as unknown as FileReader;
    readers.push(reader);
    return reader;
  };
  const finish = (index: number, data: string) => {
    Object.defineProperty(readers[index], "result", {
      value: `data:image/png;base64,${data}`,
      configurable: true,
    });
    readers[index].onload?.call(
      readers[index],
      {} as ProgressEvent<FileReader>,
    );
  };
  return { readers, create, finish };
}

test("attachments still loading travel with their message, never into the next draft", async () => {
  const f = fixture();
  const r = readerFixture();
  const reads = new AttachmentReads(f.drafts, () => {}, r.create);
  reads.start(address, new File(["x"], "a.png", { type: "image/png" }));
  f.drafts.edit(address, () => text("with image"));
  const sent = f.sends.send(address, undefined, reads.claim(address));
  f.drafts.edit(address, () => text("next"));
  expect(reads.read(address)).toHaveLength(0);
  await Bun.sleep(0);
  expect(f.log).toEqual([]);
  r.finish(0, "late");
  await f.lane.enqueue(address, () => {});
  expect(f.log).toEqual(["prompt:with image"]);
  expect(f.drafts.read(address).content.images).toHaveLength(0);
  expect(f.drafts.read(address).content.text).toBe("next");
  f.responses[0].resolve({ disposition: "started" });
  await sent;
});

test("a failed attachment fails its message and restores everything to the editor", async () => {
  const f = fixture();
  const r = readerFixture();
  const errors: string[] = [];
  const sends = new SendController(
    f.drafts,
    {
      syncDraft: async (params) => ({
        applied: true,
        draft: { ...params.content, revision: params.expectedRevision + 1 },
      }),
      prompt: async () => {
        throw new Error("must not send");
      },
      getPromptReceipt: async (key) => ({ ...key, state: "pending" }),
    },
    () => {},
    5_000,
    (message) => errors.push(message),
  );
  const reads = new AttachmentReads(f.drafts, () => {}, r.create);
  reads.startFile(address, new File(["x"], "notes.txt"), async () => {
    throw new Error("disk full");
  });
  f.drafts.edit(address, () => text("see file"));
  const sent = sends.send(address, undefined, reads.claim(address));
  r.finish(0, "body");
  await sent;
  expect(f.drafts.read(address).content.text).toBe("see file");
  expect(errors[0]).toContain("disk full");
  expect(sends.optimistic(address)).toEqual([]);
});

test("a past-message edit survives unmounting and reopens after a failed resend", () => {
  const key = editKey("chat", "entry");
  messageEdits.set(key, { text: "edited", state: "sending" });
  expect(messageEdits.read(key)).toEqual({ text: "edited", state: "sending" });
  messageEdits.set(key, { text: "edited", state: "editing" });
  expect(messageEdits.read(key)?.state).toBe("editing");
  messageEdits.set(key, undefined);
  expect(messageEdits.read(key)).toBeUndefined();
});
