import { expect, it } from "bun:test";
import { fauxAssistantMessage, type ImageContent } from "@earendil-works/pi-ai";
import {
  type Conversation,
  Harness,
  type StorageWrite,
} from "@earendil-works/pi-durable";
import type { PromptParams } from "../shared/runtime-contract";
import {
  ctx,
  eventually,
  nativeFixture,
  sqliteFixture,
} from "./durable-receipts-fixture";
import {
  DURABLE_SEND_LIMITS,
  DurableReceiptDoc,
  DurableSendReceipts,
  durableReceiptKey,
} from "./durable-send-receipts";

const prompt = (c: Conversation, requestId = "one"): PromptParams => ({
  hostId: "host-before-restart",
  sessionId: String(c.id),
  epoch: 1,
  requestId,
  text: "hello",
  draftRevision: 2,
});
const image = (data: string, mimeType = "image/png"): ImageContent => ({
  type: "image",
  data,
  mimeType,
});
const hasReceipt = (batches: readonly (readonly StorageWrite[])[]) =>
  batches.some((batch) =>
    batch.some(
      (write) =>
        write.type === "document.create" &&
        write.record.kind === DurableReceiptDoc.definition.kind,
    ),
  );

it("durable duplicate ACK survives real close/reopen, stale transports and read-only lookup without scheduler", async () => {
  const disk = await sqliteFixture();
  const f = await nativeFixture(await disk.open());
  let reopened: Harness | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage("answer")]);
    const p = prompt(f.conversation);
    const receipts = new DurableSendReceipts(f.harness);
    const [first, duplicate] = await Promise.all([
      receipts.send(f.conversation, p, ctx),
      receipts.send(
        f.conversation,
        { ...p, epoch: 999, hostId: "another", draftRevision: 999 },
        ctx,
      ),
    ]);
    expect(first).toEqual({ disposition: "started" });
    expect(duplicate).toEqual(first);
    const saved = await f.harness.snapshot(
      DurableReceiptDoc,
      durableReceiptKey(f.conversation, p.requestId),
      ctx,
    );
    expect(saved?.admission?.submissionId).toBeGreaterThan(0);
    expect(
      Number(
        (
          await f.storage.submissionByRequest(
            f.conversation.id,
            p.requestId,
            ctx,
          )
        )?.id,
      ),
    ).toBe(Number(saved?.admission?.submissionId));
    await f.conversation.waitForIdle(ctx);
    expect(receipts.pending(f.conversation)).toBe(false);
    const original = await receipts.lookup(f.conversation, p, ctx);
    await f.harness.close(ctx);
    const storage = await disk.open();
    let writes = 0;
    const commit = storage.commit.bind(storage);
    storage.commit = (...args) => {
      writes++;
      return commit(...args);
    };
    reopened = await Harness.open(
      storage,
      { ...f.options, readOnly: true },
      ctx,
    );
    const c = await reopened.conversation(f.conversation.id, ctx);
    if (!c) throw new Error("native conversation missing after reopen");
    const fresh = new DurableSendReceipts(reopened);
    expect(await fresh.lookup(c, p, ctx)).toEqual(original);
    const newTransport = { ...p, hostId: "restarted", epoch: 100 };
    expect(await fresh.lookup(c, newTransport, ctx)).toEqual({
      ...original,
      hostId: "restarted",
      epoch: 100,
    });
    expect(
      await fresh.lookup(c, { ...p, requestId: "not-there" }, ctx),
    ).toMatchObject({ state: "unknown", reason: "not-found" });
    expect((await reopened.inspect(ctx)).scheduling).toBe("paused");
    expect(writes).toBe(0);
    await expect(
      fresh.send(c, { ...p, text: "changed after restart" }, ctx),
    ).rejects.toThrow("REQUEST_ID_CONFLICT");
    expect(writes).toBe(0);
  } finally {
    await (reopened ?? f.harness).close(ctx);
    await disk.remove();
  }
});

it("fingerprints decoded ordered images/MIME/text/mode, not policy-normalized content or transport metadata", async () => {
  const f = await nativeFixture();
  try {
    f.faux.setResponses([fauxAssistantMessage("done")]);
    const p = {
      ...prompt(f.conversation),
      images: [image("YQ=="), image("Yg==", "image/jpeg")],
    };
    const receipts = new DurableSendReceipts(f.harness);
    expect(
      await receipts.send(
        f.conversation,
        p,
        ctx,
        "[images removed by host policy]",
      ),
    ).toEqual({ disposition: "started" });
    expect(
      await new DurableSendReceipts(f.harness).send(
        f.conversation,
        {
          ...p,
          epoch: 22,
          draftRevision: 99,
          images: [image("YQ"), image("Yg", "image/jpeg")],
        },
        ctx,
        "a later policy must not change an existing admission",
      ),
    ).toEqual({ disposition: "started" });
    for (const changed of [
      { ...p, text: "changed" },
      { ...p, images: [...p.images].reverse() },
      { ...p, images: [image("Yw=="), p.images[1]] },
      { ...p, images: [image("YQ==", "image/webp"), p.images[1]] },
      { ...p, whenBusy: "steer" as const },
      { ...p, whenBusy: "reject" as const },
    ])
      await expect(
        new DurableSendReceipts(f.harness).send(f.conversation, changed, ctx),
      ).rejects.toThrow("REQUEST_ID_CONFLICT");
    await f.conversation.waitForIdle(ctx);
    expect(
      (await f.conversation.context(ctx)).messages.some(
        (m) =>
          m.role === "user" && m.content === "[images removed by host policy]",
      ),
    ).toBe(true);
  } finally {
    await f.harness.close(ctx);
  }
});

it("rejects malformed/oversized requests before native writes", async () => {
  const f = await nativeFixture();
  try {
    const receipts = new DurableSendReceipts(f.harness);
    const p = prompt(f.conversation);
    let commits = 0;
    const commit = f.storage.commit.bind(f.storage);
    f.storage.commit = (...args) => {
      commits++;
      return commit(...args);
    };
    for (const bad of [
      { ...p, requestId: "" },
      { ...p, requestId: "x".repeat(257) },
      { ...p, epoch: NaN },
      { ...p, draftRevision: -1 },
      { ...p, text: " " },
      { ...p, text: "x".repeat(DURABLE_SEND_LIMITS.textBytes + 1) },
      { ...p, images: [image("@@")] },
      { ...p, images: [image("YQ=")] },
      { ...p, images: [image("YR==")] },
      { ...p, images: [image("YQ==", "text/plain")] },
      {
        ...p,
        images: Array.from({ length: DURABLE_SEND_LIMITS.images + 1 }, () =>
          image("YQ=="),
        ),
      },
    ])
      await expect(receipts.send(f.conversation, bad, ctx)).rejects.toThrow(
        "INVALID_PROMPT",
      );
    await expect(receipts.send(f.conversation, p, ctx, [])).rejects.toThrow(
      "INVALID_PROMPT",
    );
    expect(commits).toBe(0);
    expect(receipts.pending(f.conversation)).toBe(false);
  } finally {
    await f.harness.close(ctx);
  }
});

it("native fork inherits history but NOT its parent's session-scoped request ledger", async () => {
  const f = await nativeFixture();
  try {
    f.faux.setResponses([
      fauxAssistantMessage("parent"),
      fauxAssistantMessage("child"),
    ]);
    const receipts = new DurableSendReceipts(f.harness);
    const p = prompt(f.conversation);
    await receipts.send(f.conversation, p, ctx);
    await f.conversation.waitForIdle(ctx);
    const latest = (await f.conversation.entries({}, 1, undefined, ctx))
      .items[0];
    const child = await f.conversation.fork(
      latest.id,
      { ownership: { kind: "ownerless" } },
      ctx,
    );
    expect(
      await receipts.lookup(child, { ...p, sessionId: String(child.id) }, ctx),
    ).toMatchObject({ state: "unknown" });
    expect(
      await f.harness.snapshot(
        DurableReceiptDoc,
        durableReceiptKey(child, p.requestId),
        ctx,
      ),
    ).toBeUndefined();
    await receipts.send(
      child,
      { ...p, sessionId: String(child.id), text: "independent child payload" },
      ctx,
    );
    await child.waitForIdle(ctx);
    const parent = await f.harness.snapshot(
      DurableReceiptDoc,
      durableReceiptKey(f.conversation, p.requestId),
      ctx,
    );
    const fork = await f.harness.snapshot(
      DurableReceiptDoc,
      durableReceiptKey(child, p.requestId),
      ctx,
    );
    expect(fork?.admission?.submissionId).not.toBe(
      parent?.admission?.submissionId,
    );
  } finally {
    await f.harness.close(ctx);
  }
});

it("ACK is admission, not model settlement; busy/reject is atomic and queued ACK remains original", async () => {
  const f = await nativeFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    f.faux.setResponses([
      async () => {
        entered.resolve();
        await release.promise;
        return fauxAssistantMessage("first");
      },
      fauxAssistantMessage("queued"),
    ]);
    const receipts = new DurableSendReceipts(f.harness);
    await receipts.send(f.conversation, prompt(f.conversation), ctx);
    await entered.promise;
    expect((await f.harness.inspect(ctx)).tasks.length).toBeGreaterThan(0);
    const queued = prompt(f.conversation, "queued");
    expect(await receipts.send(f.conversation, queued, ctx)).toEqual({
      disposition: "queued",
    });
    const rejected = {
      ...prompt(f.conversation, "reject"),
      whenBusy: "reject" as const,
    };
    await expect(
      receipts.send(f.conversation, rejected, ctx),
    ).rejects.toThrow();
    expect(receipts.pending(f.conversation, rejected)).toBe(false);
    expect(
      await f.harness.snapshot(
        DurableReceiptDoc,
        durableReceiptKey(f.conversation, "reject"),
        ctx,
      ),
    ).toBeUndefined();
    release.resolve();
    await f.conversation.waitForIdle(ctx);
    expect(
      await new DurableSendReceipts(f.harness).send(
        f.conversation,
        queued,
        ctx,
      ),
    ).toEqual({ disposition: "queued" });
  } finally {
    release.resolve();
    await f.harness.close(ctx);
  }
});

it("a native request without an app fingerprint cannot be falsely adopted", async () => {
  const f = await nativeFixture();
  try {
    f.faux.setResponses([fauxAssistantMessage("done")]);
    const p = prompt(f.conversation);
    await f.conversation.submit(
      { type: "input", requestId: p.requestId, content: p.text },
      ctx,
    );
    await expect(
      new DurableSendReceipts(f.harness).send(f.conversation, p, ctx),
    ).rejects.toThrow("REQUEST_ID_UNVERIFIED");
    await f.conversation.waitForIdle(ctx);
    expect(
      await f.harness.snapshot(
        DurableReceiptDoc,
        durableReceiptKey(f.conversation, p.requestId),
        ctx,
      ),
    ).toBeUndefined();
  } finally {
    await f.harness.close(ctx);
  }
});

for (const durable of [false, true])
  it(`atomic ${durable ? "committed-with-lost-ACK" : "failed-before-store"} send never returns a false rejected receipt or resends`, async () => {
    const disk = await sqliteFixture();
    const f = await nativeFixture(await disk.open());
    let reopened: Harness | undefined;
    try {
      f.faux.setResponses([fauxAssistantMessage("unused")]);
      const commit = f.storage.commit.bind(f.storage);
      let intercepted = 0;
      f.storage.commit = async (batches, receive, context) => {
        if (!hasReceipt(batches)) return commit(batches, receive, context);
        intercepted++;
        if (durable) await commit(batches, () => {}, context); // Store atomically, then lose the ACK before native adoption.
        throw new Error(
          durable ? "injected ACK lost" : "injected store failure",
        );
      };
      const receipts = new DurableSendReceipts(f.harness);
      const p = prompt(f.conversation);
      await expect(receipts.send(f.conversation, p, ctx)).rejects.toThrow();
      expect(await receipts.lookup(f.conversation, p, ctx)).toMatchObject({
        state: "pending",
      });
      await expect(receipts.send(f.conversation, p, ctx)).rejects.toThrow();
      expect(intercepted).toBe(1);
      await f.harness.closed;
      reopened = await Harness.open(
        await disk.open(),
        { ...f.options, readOnly: true },
        ctx,
      );
      const c = await reopened.conversation(f.conversation.id, ctx);
      if (!c) throw new Error("native conversation missing");
      const found = await new DurableSendReceipts(reopened).lookup(c, p, ctx);
      expect(found.state).toBe(durable ? "accepted" : "unknown");
      expect((await reopened.inspect(ctx)).scheduling).toBe("paused");
      expect((await c.entries({}, 100, undefined, ctx)).items.length).toBe(
        durable ? 1 : 0,
      );
    } finally {
      if (reopened) await reopened.close(ctx);
      else await f.harness.closed;
      await disk.remove();
    }
  });

it("two independent receipt objects serialize hash check/admission/doc in the same native commit", async () => {
  const f = await nativeFixture();
  try {
    f.faux.setResponses([fauxAssistantMessage("once")]);
    const p = prompt(f.conversation);
    const results = await Promise.allSettled([
      new DurableSendReceipts(f.harness).send(f.conversation, p, ctx),
      new DurableSendReceipts(f.harness).send(
        f.conversation,
        { ...p, text: "conflicting concurrent request" },
        ctx,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await f.conversation.waitForIdle(ctx);
    await eventually(
      async () =>
        (await f.conversation.entries({}, 100, undefined, ctx)).items.length ===
        2,
    );
  } finally {
    await f.harness.close(ctx);
  }
});
