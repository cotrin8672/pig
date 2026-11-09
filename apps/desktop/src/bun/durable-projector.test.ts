import { expect, it, spyOn } from "bun:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  type ImageContent,
  type Message,
} from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  type Conversation,
  type ConversationWatch,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  hook,
  LiveDoc,
  runEndTask,
  UsageDoc,
} from "@earendil-works/pi-durable";
import { DurableProjector } from "./durable-projector";
import { ctx, eventually, nativeFixture } from "./durable-receipts-fixture";

async function append(c: Conversation, count: number, start = 0) {
  return c.commit(async (tx) => {
    const ids = [];
    for (let i = 0; i < count; i++)
      ids.push(
        (
          await tx.appendEntry(c.id, {
            kind: "test.history",
            data: { index: start + i },
          })
        ).id,
      );
    return ids;
  }, ctx);
}

it("materializes all earlier pages, caches dropped windows and reconnects with resume/gap filling", async () => {
  const f = await nativeFixture();
  const c = f.conversation;
  const handles: ConversationWatch[] = [];
  const watch = c.watch.bind(c);
  const watchSpy = spyOn(c, "watch").mockImplementation(
    async (context, window) => {
      const handle = await watch(context, window);
      handles.push(handle);
      return handle;
    },
  );
  const entriesSpy = spyOn(c, "entries");
  const projector = new DurableProjector(c, ctx);
  try {
    await append(c, 305);
    await projector.start();
    expect(projector.view?.entries).toHaveLength(50);
    expect(projector.snapshot().records).toHaveLength(305);
    expect(entriesSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    const firstIds = projector.snapshot().records.map((row) => row.id);
    const loads = entriesSpy.mock.calls.length;
    await projector.refresh();
    expect(entriesSpy.mock.calls).toHaveLength(loads);
    await handles[0].stop();
    await eventually(() => !!projector.failure);
    await append(c, 240, 305);
    await projector.refresh();
    expect(watchSpy.mock.calls[1][1]?.from).toBeGreaterThan(0);
    expect(projector.failure).toBeUndefined();
    expect(projector.snapshot().records).toHaveLength(545);
    expect(
      projector
        .snapshot()
        .records.slice(0, 305)
        .map((row) => row.id),
    ).toEqual(firstIds);
    expect(
      new Set(projector.snapshot().records.map((row) => row.id)).size,
    ).toBe(545);
    expect(
      entriesSpy.mock.calls
        .slice(loads)
        .some(([query]) => query.order === "ascending"),
    ).toBe(true);
    const detached = projector.snapshot();
    detached.records.length = 0;
    expect(projector.snapshot().records).toHaveLength(545);
    expect((await f.harness.inspect(ctx)).scheduling).toBe("paused");
  } finally {
    await projector.dispose();
    watchSpy.mockRestore();
    entriesSpy.mockRestore();
    await f.harness.close(ctx);
  }
});

it("coalesces a slow subscriber without losing overflow history; stops callbacks after disposal", async () => {
  const f = await nativeFixture();
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let slow = false;
  let callbacks = 0;
  const projector = new DurableProjector(f.conversation, ctx, {
    onChange: async () => {
      callbacks++;
      if (slow) {
        slow = false;
        entered.resolve();
        await release.promise;
      }
    },
  });
  try {
    await projector.start();
    slow = true;
    await append(f.conversation, 1);
    await entered.promise;
    await append(f.conversation, 250, 1);
    const refreshes = Array.from({ length: 25 }, () => projector.refresh());
    release.resolve();
    await Promise.all(refreshes);
    await eventually(() => projector.snapshot().records.length === 251);
    expect(callbacks).toBeLessThan(10);
    await projector.dispose();
    const frozen = projector.snapshot();
    const before = callbacks;
    await append(f.conversation, 1, 251);
    await Bun.sleep(15);
    await projector.refresh();
    expect(callbacks).toBe(before);
    expect(projector.snapshot()).toEqual(frozen);
  } finally {
    release.resolve();
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("disposal during a real native page read ignores its late completion and releases its watch", async () => {
  const f = await nativeFixture();
  await append(f.conversation, 120);
  const read = f.conversation.entries.bind(f.conversation);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const paging = spyOn(f.conversation, "entries").mockImplementation(
    async (...args) => {
      const page = await read(...args);
      entered.resolve();
      await release.promise;
      return page;
    },
  );
  let changes = 0;
  const projector = new DurableProjector(f.conversation, ctx, {
    onChange: () => {
      changes++;
    },
  });
  const starting = projector.start();
  try {
    await entered.promise;
    await projector.dispose();
    release.resolve();
    await starting;
    expect(changes).toBe(0);
    expect(projector.snapshot().records).toHaveLength(0);
    await append(f.conversation, 1);
    expect(changes).toBe(0);
  } finally {
    release.resolve();
    await starting;
    paging.mockRestore();
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("multi-message native entries have unique stable row IDs, truthful fork ancestry, and bounded custom fallback", async () => {
  const f = await nativeFixture();
  const picture = {
    type: "image",
    mimeType: "image/png",
    data: "YQ==",
  } satisfies ImageContent;
  const assistant = fauxAssistantMessage(
    [
      fauxThinking("reasoning"),
      { type: "text", text: "answer" },
      fauxToolCall("read_constant", {}, { id: "call-native" }),
    ],
    { stopReason: "toolUse" },
  );
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: "input" }, picture],
      timestamp: 1,
    },
    assistant,
    {
      role: "toolResult",
      toolCallId: "call-native",
      toolName: "read_constant",
      content: [{ type: "text", text: "result" }, picture],
      details: { nested: picture },
      isError: false,
      timestamp: 3,
    },
  ];
  const id = await f.conversation.commit(
    async (tx) =>
      (
        await tx.appendEntry(f.conversation.id, {
          kind: "vendor.multi",
          model: messages,
          data: { custom: "x".repeat(100_000), image: picture },
        })
      ).id,
    ctx,
  );
  const child = await f.conversation.fork(
    id,
    { ownership: { kind: "ownerless" } },
    ctx,
  );
  await append(f.conversation, 1, 999); // Not visible in the fork.
  const childIds = await append(child, 1);
  const projector = new DurableProjector(child, ctx, {
    imagePolicy: () => ({ type: "text", text: "[image blocked]" }),
  });
  try {
    await projector.start();
    const rows = projector.snapshot().records;
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.id)).size).toBe(5);
    expect(rows.slice(0, 4).every((r) => r.entryId === String(id))).toBe(true);
    expect(rows.every((r) => r.branchId === String(child.id))).toBe(true);
    expect(rows[4].parentId).toBe(String(id));
    expect(rows[4].entryId).toBe(String(childIds[0]));
    expect(rows[3]).toMatchObject({
      kind: "custom-entry",
      customType: "vendor.multi",
    });
    expect(JSON.stringify(rows[3]).length).toBeLessThan(40_000);
    expect(JSON.stringify(rows[3])).toContain("[truncated]");
    expect(JSON.stringify(rows)).toContain("reasoning");
    expect(JSON.stringify(rows)).not.toContain('"type":"image"');
    expect(projector.snapshot().tools["call-native"].status).toBe("done");
    const ids = rows.map((r) => r.id);
    await projector.refresh();
    expect(projector.snapshot().records.map((r) => r.id)).toEqual(ids);
    expect((await child.context(ctx)).messages[0]).toEqual(messages[0]); // DTO policy did not mutate native images.
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("real streaming partials retain identity and reconcile to their native generation's persisted row", async () => {
  const f = await nativeFixture();
  const streaming = fauxProvider({
    provider: "projector-stream",
    tokensPerSecond: 300,
    tokenSize: { min: 1, max: 1 },
  });
  f.models.setProvider(streaming.provider);
  await f.conversation.configure(
    {
      model: {
        provider: streaming.getModel().provider,
        modelId: streaming.getModel().id,
      },
    },
    ctx,
  );
  streaming.setResponses([
    fauxAssistantMessage("a".repeat(180), { timestamp: 12345 }),
  ]);
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    const submitted = await f.conversation.submit(
      { type: "input", content: "stream" },
      ctx,
    );
    await eventually(() => projector.snapshot().current !== null);
    const live = projector.snapshot().current;
    expect(projector.snapshot().running).toBe(true);
    await projector.refresh();
    expect(projector.snapshot().current).toBe(live);
    await submitted.wait(ctx);
    await f.conversation.waitForIdle(ctx);
    await eventually(() => !projector.snapshot().running);
    const final = projector.snapshot();
    expect(final.current).toBeNull();
    expect(final.liveToEntry[live as string]).toMatch(/^entry:\d+:message:0$/);
    expect(
      final.records.some((row) => row.id === final.liveToEntry[live as string]),
    ).toBe(true);
    expect(projector.failure).toBeUndefined();
    expect(projector.aborted).toBe(false);
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("maps actual running model/nested tool call IDs and keeps afterRun work busy after the answer", async () => {
  const f = await nativeFixture();
  const nestedEntered = Promise.withResolvers<void>();
  const nestedRelease = Promise.withResolvers<void>();
  const afterEntered = Promise.withResolvers<void>();
  const afterRelease = Promise.withResolvers<void>();
  const nested = defineTool({
    name: "constant",
    description: "in-memory constant",
    replay: "safe",
    parameters: { type: "object", properties: {} },
    execute: async (_args, api, context) => {
      api.output("nested progress");
      await api.details({ progress: 1 }, context);
      nestedEntered.resolve();
      await nestedRelease.promise;
      return { output: [{ type: "text", text: "constant" }] };
    },
  });
  const parent = defineTool({
    name: "parent",
    description: "in-memory parent",
    replay: "safe",
    parameters: { type: "object", properties: {} },
    execute: async (_args, api, context) => {
      api.output("parent progress");
      await api.executeTool(nested.name, {}, context, { key: "child" });
      return { output: [{ type: "text", text: "parent done" }] };
    },
  });
  const after = defineTask<null, { phase: "run" }, null>({
    name: "test.after",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, context) => {
        afterEntered.resolve();
        await afterRelease.promise;
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: null },
          }),
          context,
        );
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        context,
      );
    },
  });
  const extension = defineExtension({
    name: "projector_tools",
    tools: [parent, nested],
    tasks: [after],
    hooks: [
      hook(GenerationTask, {
        afterRun: () => ({ tasks: [runEndTask(after, null)] }),
      }),
    ],
  });
  f.registry.install(extension);
  await f.conversation.configure(
    { extensions: [extension], tools: [parent, nested] },
    ctx,
  );
  f.faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall(parent.name, {}, { id: "model-call" })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("answered"),
  ]);
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    const submission = await f.conversation.submit(
      { type: "input", content: "tools" },
      ctx,
    );
    await nestedEntered.promise;
    await eventually(
      () =>
        projector.snapshot().tools["model-call/child"]?.status === "running",
    );
    const tools = projector.snapshot().tools;
    expect(tools["model-call"].status).toBe("running");
    expect(JSON.stringify(tools["model-call/child"].result)).toContain(
      "nested progress",
    );
    nestedRelease.resolve();
    await submission.wait(ctx);
    await afterEntered.promise;
    await eventually(() => !!projector.view?.docs["pi.live"]?.run);
    await projector.refresh();
    expect(projector.snapshot().running).toBe(true);
    expect(projector.snapshot().tools["model-call"].status).toBe("done");
    afterRelease.resolve();
    await f.conversation.waitForIdle(ctx);
    await eventually(() => !projector.snapshot().running);
    expect(projector.failure).toBeUndefined();
  } finally {
    nestedRelease.resolve();
    afterRelease.resolve();
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("persisted native error/abort/interruption/turn-limit and compaction failures never become success when tasks disappear", async () => {
  const f = await nativeFixture();
  f.faux.setResponses([
    fauxAssistantMessage("failed response", {
      stopReason: "error",
      errorMessage: "faux failure",
    }),
  ]);
  const submission = await f.conversation.submit(
    { type: "input", content: "fail" },
    ctx,
  );
  await submission.wait(ctx);
  await f.conversation.waitForIdle(ctx);
  const nativeFailure = (
    await f.harness.snapshot(LiveDoc, f.conversation.id, ctx)
  )?.runFailure;
  if (!nativeFailure) throw new Error("native run failure missing");
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    expect(projector.failure).toContain("faux failure");
    expect(projector.snapshot().running).toBe(false);
    const persistedError = projector
      .snapshot()
      .records.find(
        (r) => r.kind === "message" && r.message.role === "assistant",
      );
    expect(persistedError).toMatchObject({
      kind: "message",
      message: { stopReason: "error" },
    });
    for (const reason of [
      "interrupted",
      "turn_limit",
      "orphaned",
      "restart_limit",
    ] as const) {
      // Real native committed documents, as recovered sessions expose them; not fake event-bus terminal events.
      await f.conversation.commit(async (tx) => {
        (await tx.doc(LiveDoc, f.conversation.id)).runFailure = {
          ...nativeFailure,
          reason,
          detail: "persisted terminal outcome",
        };
      }, ctx);
      await eventually(() => projector.failure?.startsWith(reason) ?? false);
      expect(projector.snapshot().running).toBe(false);
      expect(projector.aborted).toBe(false);
    }
    await f.conversation.commit(async (tx) => {
      (await tx.doc(LiveDoc, f.conversation.id)).runFailure = {
        ...nativeFailure,
        reason: "aborted",
      };
    }, ctx);
    await eventually(() => projector.aborted);
    // An abort isn't a model success, nor should a previous failed attempt mask its explicit native outcome.
    expect(projector.aborted).toBe(true);
    const compactionId = await f.conversation.compact(undefined, ctx);
    await f.harness.waitForTask(compactionId, ctx);
    await f.conversation.commit(async (tx) => {
      (await tx.doc(LiveDoc, f.conversation.id)).compactionFailure = {
        taskId: compactionId,
        trigger: "manual",
        error: "persisted compaction failure",
      };
    }, ctx);
    await eventually(
      () => projector.failure?.includes("Compaction failed") ?? false,
    );
    expect(projector.failure).toContain("persisted compaction failure");
    await projector.dispose();
    const reconnected = new DurableProjector(f.conversation, ctx);
    try {
      await reconnected.start();
      expect(reconnected.failure).toContain("Compaction failed");
      expect(reconnected.aborted).toBe(true);
    } finally {
      await reconnected.dispose();
    }
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("real native abort persists the interrupted partial and rehydrates aborted state without a task graph", async () => {
  const f = await nativeFixture();
  const streaming = fauxProvider({
    provider: "projector-abort",
    tokensPerSecond: 200,
    tokenSize: { min: 1, max: 1 },
  });
  f.models.setProvider(streaming.provider);
  await f.conversation.configure(
    {
      model: {
        provider: streaming.getModel().provider,
        modelId: streaming.getModel().id,
      },
    },
    ctx,
  );
  streaming.setResponses([fauxAssistantMessage("long output ".repeat(200))]);
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    await f.conversation.submit({ type: "input", content: "abort me" }, ctx);
    await eventually(() => projector.snapshot().current !== null);
    await f.conversation.abort(ctx);
    await eventually(() => projector.aborted && !projector.snapshot().running);
    expect(
      projector
        .snapshot()
        .records.some(
          (r) =>
            r.kind === "message" &&
            r.message.role === "assistant" &&
            r.message.stopReason === "aborted",
        ),
    ).toBe(true);
    const rehydrated = new DurableProjector(f.conversation, ctx);
    try {
      await rehydrated.start();
      expect(rehydrated.aborted).toBe(true);
      expect(rehydrated.snapshot().running).toBe(false);
    } finally {
      await rehydrated.dispose();
    }
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("contextUsage estimates native current context, not cumulative usage, and domain documents stay separately owned", async () => {
  const f = await nativeFixture();
  const Domain = defineDoc({
    kind: "vendor.domain",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ secret: "domain owner" }),
    checkpointWhen: () => true,
  });
  const a = fauxAssistantMessage("answer");
  a.usage.input = 20;
  a.usage.output = 5;
  a.usage.totalTokens = 25;
  await f.conversation.commit(async (tx) => {
    await tx.doc(Domain, f.conversation.id);
    (await tx.doc(UsageDoc, f.conversation.id)).models["faux/spend"] = {
      ...a.usage,
      totalTokens: 999_999,
    };
    await tx.appendEntry(f.conversation.id, {
      kind: "pi.assistant",
      model: [a],
    });
    await tx.appendEntry(f.conversation.id, {
      kind: "pi.user",
      model: [{ role: "user", content: "next", timestamp: 2 }],
    });
  }, ctx);
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    const tokens = estimateContextTokens(
      (await f.conversation.context(ctx)).messages,
    ).tokens;
    expect(await projector.contextUsage(1000)).toEqual({
      tokens,
      contextWindow: 1000,
      percent: (tokens / 1000) * 100,
    });
    expect(tokens).toBeLessThan(999_999);
    expect(await projector.contextUsage()).toBeNull();
    expect(projector.view?.docs[Domain.definition.kind]).toBeUndefined();
    expect(
      (await f.harness.snapshot(Domain, f.conversation.id, ctx))?.secret,
    ).toBe("domain owner");
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("late native watch attachment is stopped when disposed before start resolves", async () => {
  const f = await nativeFixture();
  const watch = f.conversation.watch.bind(f.conversation);
  const entered = Promise.withResolvers<ConversationWatch>();
  const release = Promise.withResolvers<void>();
  const attaching = spyOn(f.conversation, "watch").mockImplementation(
    async (...args) => {
      const handle = await watch(...args);
      entered.resolve(handle);
      await release.promise;
      return handle;
    },
  );
  let callbacks = 0;
  const projector = new DurableProjector(f.conversation, ctx, {
    onChange: () => {
      callbacks++;
    },
  });
  const starting = projector.start();
  try {
    const handle = await entered.promise;
    const disposal = projector.dispose();
    release.resolve();
    await Promise.all([starting, disposal]);
    expect((await handle.closed).kind).toBe("stopped");
    expect(callbacks).toBe(0);
  } finally {
    release.resolve();
    await starting;
    attaching.mockRestore();
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("reports native page/read and subscriber failures, retaining the last complete snapshot for retry", async () => {
  const f = await nativeFixture();
  await append(f.conversation, 130);
  const read = f.conversation.entries.bind(f.conversation);
  let failPage = true;
  const paging = spyOn(f.conversation, "entries").mockImplementation(
    async (...args) => {
      const page = await read(...args);
      if (failPage) {
        failPage = false;
        throw new Error("injected native page failure");
      }
      return page;
    },
  );
  const failures: unknown[] = [];
  let failListener = false;
  const projector = new DurableProjector(f.conversation, ctx, {
    onFailure: (error) => {
      failures.push(error);
    },
    onChange: () => {
      if (failListener) {
        failListener = false;
        throw new Error("injected subscriber failure");
      }
    },
  });
  try {
    await expect(projector.start()).rejects.toThrow(
      "injected native page failure",
    );
    expect(projector.failure).toContain("injected native page failure");
    expect(projector.snapshot().records).toHaveLength(0); // No truncated latest-window snapshot leaks out.
    await projector.refresh();
    expect(projector.snapshot().records).toHaveLength(130);
    expect(projector.failure).toBeUndefined();
    failListener = true;
    await expect(projector.refresh()).rejects.toThrow(
      "injected subscriber failure",
    );
    expect(projector.failure).toContain("injected subscriber failure");
    await projector.refresh();
    expect(projector.failure).toBeUndefined();
    expect(failures.length).toBeGreaterThanOrEqual(2);
  } finally {
    paging.mockRestore();
    await projector.dispose();
    await f.harness.close(ctx);
  }
});

it("prototype-shaped native call IDs and long custom keys remain serializable data", async () => {
  const f = await nativeFixture();
  await f.conversation.commit(async (tx) => {
    await tx.appendEntry(f.conversation.id, {
      kind: "vendor.keys",
      data: { [`${"key".repeat(100)}a`]: 1, [`${"key".repeat(100)}b`]: 2 },
      model: [
        {
          role: "toolResult",
          toolCallId: "__proto__",
          toolName: "constant",
          content: [{ type: "text", text: "ok" }],
          isError: false,
          timestamp: 1,
        },
      ],
    });
  }, ctx);
  const projector = new DurableProjector(f.conversation, ctx);
  try {
    await projector.start();
    const state = projector.snapshot();
    expect(Object.hasOwn(state.tools, "__proto__")).toBe(true);
    expect(state.tools.__proto__.status).toBe("done");
    expect(JSON.stringify(state.records)).toContain("[truncated keys]");
    expect(projector.failure).toBeUndefined();
  } finally {
    await projector.dispose();
    await f.harness.close(ctx);
  }
});
