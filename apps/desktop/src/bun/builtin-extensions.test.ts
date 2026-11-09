import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  configure,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type JsonObject,
  MemoryStorage,
  type Harness as NativeHarness,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import {
  createDelegationExtensions,
  createTodosExtension,
  type DelegationOptions,
  Delegations,
  reconcileDelegations,
  replaceTodos,
  Todos,
} from "./builtin-extensions";

const harnesses: NativeHarness[] = [],
  paths: string[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close(ctx);
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture(overrides: Partial<DelegationOptions> = {}) {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const root = await realpath(
    await mkdtemp(join(process.env.PI_SCRATCH_DIR, "builtins-")),
  );
  paths.push(root);
  await writeFile(join(root, "evidence.txt"), "evidence line one");
  const faux = fauxProvider({ tokensPerSecond: Infinity }),
    models = createModels();
  models.setProvider(faux.provider);
  const model = {
      provider: faux.getModel().provider,
      modelId: faux.getModel().id,
    },
    read = createReadTool();
  let forbiddenCalls = 0;
  const forbidden = defineExtension({
    name: "forbidden",
    tools: ["write", "edit", "bash", "powershell"].map((name) =>
      defineTool({
        name,
        description: "Forbidden fixture",
        parameters: { type: "object" },
        execute: async () => {
          forbiddenCalls++;
          return { output: [{ type: "text", text: "BAD" }] };
        },
      }),
    ),
  });
  const options: DelegationOptions = {
    readTool: read,
    profile: { id: "research", extensions: [] },
    model,
    cwd: root,
    maxTurns: 3,
    maxConcurrency: 1,
    maxDepth: 1,
    maxReturnChars: 256,
    inspectAgent: async (id, context) => {
      const child = await harness.conversation(id, context);
      if (!child) throw new Error("Missing child");
      return child.agent(context);
    },
    ...overrides,
  };
  const { extension, researchExtension } = createDelegationExtensions(options),
    todos = createTodosExtension();
  const registry = createRegistry();
  for (const ext of [
    forbidden,
    extension,
    researchExtension,
    todos,
    ...options.profile.extensions,
  ])
    registry.install(ext);
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry,
      settings: { extensions: [] },
      env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? root }),
    },
    ctx,
  );
  harnesses.push(harness);
  const parent = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: {
        extensions: [extension, forbidden, todos],
        model,
        cwd: root,
        instructions: "PARENT_PRIVATE_POLICY",
        maxTurns: 8,
      },
    },
    ctx,
  );
  return {
    root,
    faux,
    models,
    model,
    read,
    options,
    extension,
    researchExtension,
    todos,
    registry,
    harness,
    parent,
    forbiddenCalls: () => forbiddenCalls,
  };
}
const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Fixture wait timed out");
    await Bun.sleep(2);
  }
}

test("TODO is a versioned planning document; tool and GUI CAS share it without creating tasks", async () => {
  const f = await fixture();
  expect(Todos.definition).toMatchObject({
    kind: "pig.todos",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
  });
  const items = [{ id: "a", title: "Review", state: "pending" }];
  await f.harness.commit((tx) => replaceTodos(tx, f.parent.id, 0, items), ctx);
  expect((await f.harness.inspect(ctx)).tasks).toHaveLength(0);
  await expect(
    f.harness.commit((tx) => replaceTodos(tx, f.parent.id, 0, []), ctx),
  ).rejects.toThrow("revision conflict");
  f.faux.setResponses([
    call("todos", {
      expectedRevision: 1,
      items: [{ ...items[0], state: "completed" }],
    }),
    fauxAssistantMessage("Checklist saved"),
  ]);
  expect(
    (
      await (
        await f.parent.submit({ type: "input", content: "plan" }, ctx)
      ).wait(ctx)
    ).status,
  ).toBe("done");
  expect(await f.harness.snapshot(Todos, f.parent.id, ctx)).toEqual({
    revision: 2,
    items: [{ ...items[0], state: "completed" }],
  });
  expect(
    (await f.harness.commit((tx) => tx.scanTasks({}, 100), ctx)).items.every(
      (task) => ["pi.generation", "pi.tool"].includes(task.kind),
    ),
  ).toBe(true);
  const entry = (await f.parent.entries({}, 1, undefined, ctx)).items[0];
  if (!entry) throw new Error("Missing answer");
  const fork = await f.parent.fork(
    entry.id,
    { ownership: { kind: "ownerless" } },
    ctx,
  );
  expect(await f.harness.snapshot(Todos, fork.id, ctx)).toEqual(
    await f.harness.snapshot(Todos, f.parent.id, ctx),
  );
  await expect(
    f.harness.commit(
      (tx) =>
        replaceTodos(tx, f.parent.id, 2, [
          { id: "a", title: "bad", state: "running" },
        ]),
      ctx,
    ),
  ).rejects.toThrow("Invalid TODO");
});
test("delegation has fresh context, explicit effective read-only set and saved bounded outcomes after graph removal", async () => {
  const f = await fixture();
  let childContext = "";
  f.faux.setResponses([
    call("delegate", { task: "Find evidence" }),
    async (transcript) => {
      childContext = JSON.stringify(transcript);
      return call("read", { path: "evidence.txt" });
    },
    fauxAssistantMessage(
      `Conclusion: found.\nEvidence: evidence.txt:1\nUnresolved: ${"x".repeat(600)}`,
    ),
    fauxAssistantMessage("Parent done"),
  ]);
  expect(
    (
      await (
        await f.parent.submit(
          { type: "input", content: "PARENT_PRIVATE_TRANSCRIPT" },
          ctx,
        )
      ).wait(ctx)
    ).status,
  ).toBe("done");
  expect(childContext).not.toContain("PARENT_PRIVATE_TRANSCRIPT");
  expect(childContext).not.toContain("PARENT_PRIVATE_POLICY");
  const doc = await f.harness.snapshot(Delegations, f.parent.id, ctx),
    run = doc?.runs[0];
  if (!run) throw new Error("Missing saved run");
  expect(run.outcome).toBe("success");
  expect(run.result.length).toBeLessThanOrEqual(256);
  expect(run.truncated).toBe(true);
  expect(run.result).toContain("Evidence: evidence.txt:1");
  const child = await f.harness.conversation(run.childId, ctx);
  if (!child) throw new Error("Missing child");
  const agent = await child.agent(ctx);
  expect(agent.tools.map((tool) => tool.name)).toEqual(["read"]);
  expect(agent.callable.map((tool) => tool.name)).toEqual(["read"]);
  expect(agent.deferred).toHaveLength(0);
  expect(agent.maxTurns).toBe(3);
  expect(agent.extensions.map((ext) => ext.name)).toEqual(["pig.research"]);
  expect(
    (
      await f.harness.commit(
        (tx) => tx.scanConversations({ ownerTaskId: run.taskId }, 5),
        ctx,
      )
    ).items,
  ).toHaveLength(1);
  expect(run.requestId).toBe(`delegate:${run.taskId}`);
  await f.harness.waitForIdle(ctx);
  expect((await f.harness.inspect(ctx)).tasks).toHaveLength(0);
  await f.harness.commit((tx) => reconcileDelegations(tx, f.parent.id), ctx);
  expect(
    (await f.harness.snapshot(Delegations, f.parent.id, ctx))?.runs[0]?.outcome,
  ).toBe("success");
  expect(f.forbiddenCalls()).toBe(0);
  expect(f.extension.tools?.[0]?.replay).toBe("unsafe");
  expect(f.read.replay).toBeUndefined();
});
test("unoffered shell/write/edit/delegate and nested write cannot execute in the child", async () => {
  const base = createReadTool();
  let nestedDenied = false;
  const read: ToolRegistration = {
    ...base,
    execute: async (args, api, context) => {
      const nested = await api.executeTool(
        "write",
        { path: "bad.txt", content: "no" },
        context,
      );
      nestedDenied = nested.isError;
      return base.execute(
        args as Parameters<typeof base.execute>[0],
        api,
        context,
      );
    },
  };
  const f = await fixture({ readTool: read, maxTurns: 5 });
  f.faux.setResponses([
    call("delegate", { task: "research" }),
    fauxAssistantMessage(
      [
        fauxToolCall("write", {}),
        fauxToolCall("edit", {}),
        fauxToolCall("bash", {}),
        fauxToolCall("powershell", {}),
        fauxToolCall("delegate", { task: "nested" }),
      ],
      { stopReason: "toolUse" },
    ),
    call("read", { path: "evidence.txt" }),
    fauxAssistantMessage(
      "Conclusion: no mutation. Evidence: evidence.txt:1. Unresolved: none.",
    ),
    fauxAssistantMessage("done"),
  ]);
  await (
    await f.parent.submit({ type: "input", content: "research" }, ctx)
  ).wait(ctx);
  expect(nestedDenied).toBe(true);
  expect(f.forbiddenCalls()).toBe(0);
  const run = (await f.harness.snapshot(Delegations, f.parent.id, ctx))
    ?.runs[0];
  if (!run) throw new Error("Missing child");
  const children = await f.harness.commit(
    (tx) => tx.scanConversations({ ownerConversationId: run.childId }, 10),
    ctx,
  );
  expect(children.items).toHaveLength(0);
});
test("turn limit is unresolved, never a synthetic successful research answer", async () => {
  const f = await fixture({ maxTurns: 1 });
  f.faux.setResponses([
    call("delegate", { task: "research" }),
    call("read", { path: "evidence.txt" }),
    fauxAssistantMessage("Parent done"),
  ]);
  await (
    await f.parent.submit({ type: "input", content: "research" }, ctx)
  ).wait(ctx);
  const run = (await f.harness.snapshot(Delegations, f.parent.id, ctx))
    ?.runs[0];
  expect(run?.outcome).toBe("error");
  expect(run?.result).toContain("turn_limit");
});
test("simultaneous invocations with the same native task identity reuse child and deterministic submission", async () => {
  const f = await fixture(),
    delegate = f.extension.tools?.[0];
  if (!delegate) throw new Error("Missing delegate");
  const twice = defineExtension({
    ...f.extension,
    tools: [
      {
        ...delegate,
        execute: async (args, api, context) => {
          const results = await Promise.all([
            delegate.execute(args, api, context),
            delegate.execute(args, api, context),
          ]);
          return results[0];
        },
      },
    ],
  });
  f.registry.install(twice);
  f.faux.setResponses([
    call("delegate", { task: "only once" }),
    fauxAssistantMessage(
      "Conclusion: once. Evidence: fixture. Unresolved: none.",
    ),
    fauxAssistantMessage("done"),
  ]);
  await (
    await f.parent.submit({ type: "input", content: "research" }, ctx)
  ).wait(ctx);
  const doc = await f.harness.snapshot(Delegations, f.parent.id, ctx);
  expect(doc?.runs).toHaveLength(1);
  const run = doc?.runs[0];
  if (!run) throw new Error("No saved run");
  expect(
    (
      await f.harness.commit(
        (tx) => tx.scanConversations({ ownerTaskId: run.taskId }, 10),
        ctx,
      )
    ).items,
  ).toHaveLength(1);
  const child = await f.harness.conversation(run.childId, ctx);
  if (!child) throw new Error("No child");
  expect(
    (await child.entries({}, 100, undefined, ctx)).items.filter(
      (entry) => entry.kind === "pi.user",
    ),
  ).toHaveLength(1);
  expect(
    (
      await f.harness.commit(
        (tx) => tx.submissionByRequest(run.childId, run.requestId),
        ctx,
      )
    )?.status,
  ).toBe("done");
});
test("concurrency is admitted atomically; parent cancellation propagates to the owned child and saved outcome", async () => {
  let entered = false,
    aborted = false;
  const read: ToolRegistration = {
    ...createReadTool(),
    execute: async (_args, _api, context) => {
      entered = true;
      if (!context.abortSignal)
        throw new Error("Expected cancellable native tool context");
      await new Promise<void>((resolve) => {
        context.abortSignal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
      throw new Error("cancelled read");
    },
  };
  const f = await fixture({ readTool: read });
  f.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("delegate", { task: "one" }),
        fauxToolCall("delegate", { task: "two" }),
      ],
      { stopReason: "toolUse" },
    ),
    call("read", { path: "evidence.txt" }),
  ]);
  const submission = await f.parent.submit(
    { type: "input", content: "research" },
    ctx,
  );
  await until(() => entered);
  expect(
    (await f.harness.snapshot(Delegations, f.parent.id, ctx))?.runs,
  ).toHaveLength(1);
  await until(async () =>
    JSON.stringify(
      (await f.parent.entries({}, 100, undefined, ctx)).items,
    ).includes("concurrency limit"),
  );
  const childId = (await f.harness.snapshot(Delegations, f.parent.id, ctx))
    ?.runs[0]?.childId;
  await f.parent.abort(ctx);
  expect(aborted).toBe(true);
  expect((await submission.wait(ctx)).status).toBe("unanswered");
  await f.harness.commit((tx) => reconcileDelegations(tx, f.parent.id), ctx);
  expect(
    (await f.harness.snapshot(Delegations, f.parent.id, ctx))?.runs[0]?.outcome,
  ).toBe("cancelled");
  if (!childId) throw new Error("Missing owned child");
  expect((await f.harness.inspect(ctx)).tasks).toHaveLength(0);
});
test("depth and invalid factory bounds fail closed before creating delegated work", async () => {
  const f = await fixture(),
    delegate = f.extension.tools?.[0];
  if (!delegate) throw new Error("Missing delegate");
  for (const override of [
    { maxTurns: 0 },
    { maxDepth: 0 },
    { maxConcurrency: 9 },
    { maxReturnChars: 255 },
  ])
    expect(() =>
      createDelegationExtensions({ ...f.options, ...override }),
    ).toThrow();
  const probe = defineExtension({
    name: "depth-probe",
    tools: [
      defineTool({
        name: "depth_probe",
        description: "Test depth",
        parameters: { type: "object" },
        execute: async (_args, api, context) => {
          const childId = await api.commit(async (tx) => {
            const child = await tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            });
            await configure(tx, child.id, { extensions: [], tools: [] });
            return child.id;
          }, context);
          return delegate.execute(
            { task: "too deep" },
            { ...api, conversationId: childId },
            context,
          );
        },
      }),
    ],
  });
  f.registry.install(probe);
  await f.parent.configure({ extensions: [probe] }, ctx);
  f.faux.setResponses([call("depth_probe", {}), fauxAssistantMessage("done")]);
  await (await f.parent.submit({ type: "input", content: "probe" }, ctx)).wait(
    ctx,
  );
  const toolResults = (await f.parent.entries({}, 100, undefined, ctx)).items
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "toolResult");
  expect(JSON.stringify(toolResults)).toContain("depth limit");
  expect(
    await f.harness.snapshot(Delegations, f.parent.id, ctx),
  ).toBeUndefined();
});

test("public native agent inspection rejects an ineffective wrapped read before child submission/provider use", async () => {
  const f = await fixture({
    readTool: { ...createReadTool(), callers: ["tools"] },
  });
  f.faux.setResponses([
    call("delegate", { task: "must not request child model" }),
    fauxAssistantMessage("Parent done"),
  ]);
  await (
    await f.parent.submit({ type: "input", content: "research" }, ctx)
  ).wait(ctx);
  const run = (await f.harness.snapshot(Delegations, f.parent.id, ctx))
    ?.runs[0];
  if (!run) throw new Error("Missing research record");
  expect(run.outcome).toBe("error");
  expect(run.result).toContain("Effective research agent violates");
  const child = await f.harness.conversation(run.childId, ctx);
  if (!child) throw new Error("Missing child");
  expect((await child.agent(ctx)).tools).toHaveLength(0);
  expect((await child.entries({}, 100, undefined, ctx)).items).toHaveLength(0);
  expect(
    await f.harness.commit(
      (tx) => tx.submissionByRequest(run.childId, run.requestId),
      ctx,
    ),
  ).toBeUndefined();
});
