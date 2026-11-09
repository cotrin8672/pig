import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Extension, Tx } from "@earendil-works/pi-durable";
import { isolatedP0Env } from "../../scripts/durable-p0";
import { runCommand } from "./command-executor";
import type { WorkspaceRuntime } from "./workspace-runtime";

/** Parent process imports NO native runtime modules before the RTK child's isolated HOME. */
export async function runCompatibilityFixture(mode: string) {
  const scratch = process.env.PI_SCRATCH_DIR;
  assert(scratch && isAbsolute(scratch), "absolute PI_SCRATCH_DIR required");
  const root = await mkdtemp(join(scratch, "pig-compatibility-"));
  try {
    const result = await runCommand(
      process.execPath,
      [import.meta.path, mode],
      {
        cwd: root,
        env: isolatedP0Env(root),
        timeout: 25_000,
      },
    );
    assert.equal(
      result.exitCode,
      0,
      `${mode}\n${result.stdout}\n${result.stderr}`,
    );
    assert(result.stdout.includes(`PASS ${mode}`), result.stdout);
    assert(!result.stderr.includes("Unhandled"), result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fixtures() {
  const root = process.env.PIG_P0_ROOT;
  assert(
    root &&
      isAbsolute(root) &&
      process.env.HOME === root &&
      process.env.USERPROFILE === root,
    "isolated HOME required",
  );
  const [
    d,
    ai,
    { BACKGROUND_CONTEXT: ctx },
    compatibility,
    planning,
    approvals,
    meta,
    { openDurableStorage },
    { createDesktopTools },
    { createNativeImagePolicy },
    { createNativeToolPolicy },
    { createResourcesExtension },
    { UIRequestBroker },
    receipts,
  ] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/pi-ai"),
    import("@earendil-works/chord/context"),
    import("./application-compatibility"),
    import("./builtin-extensions"),
    import("./native-approvals"),
    import("./native-conversation-meta"),
    import("./durable-storage"),
    import("./shell-tools"),
    import("./image-policy"),
    import("./native-tool-policy"),
    import("./resources"),
    import("./ui-request-broker"),
    import("./durable-send-receipts"),
  ]);
  const identity = await meta.workspaceIdentity(root);
  let effects = 0,
    created = 0;
  const forbidden = () => {
    effects++;
    throw new Error("Metadata inspection invoked runtime code");
  };
  globalThis.fetch = Object.assign(forbidden, {
    preconnect: fetch.preconnect,
  }) as typeof fetch;
  // All factories construct actual app/native definitions; no filesystem tools are executed.
  function definitions() {
    const image = createNativeImagePolicy({ blockImages: forbidden });
    const native = createDesktopTools({
      shell: "powershell",
      shellProgram: "never-run",
      images: image.images,
    });
    const policy = createNativeToolPolicy({
      resolveOwner: forbidden,
      authorize: forbidden,
    });
    const approval = approvals.createNativeApprovals({
      harness: forbidden,
      broker: new UIRequestBroker(forbidden),
      resolveOwner: forbidden,
      planTool: forbidden,
    });
    const todos = planning.createTodosExtension();
    const read = native.tools.find((tool) => tool.name === "read");
    assert(read);
    const research = planning.createDelegationExtensions({
      readTool: read,
      model: { provider: "fixture", modelId: "none" },
      cwd: identity.cwd,
      profile: { id: "pig.research", extensions: [] },
      maxTurns: 8,
      maxConcurrency: 2,
      maxDepth: 1,
      maxReturnChars: 8000,
      inspectAgent: forbidden,
    });
    const allTools = [
      ...native.tools,
      ...(todos.tools ?? []),
      ...(research.extension.tools ?? []),
    ];
    const extensions = [
      native.extension,
      todos,
      research.extension,
      research.researchExtension,
      createResourcesExtension({ instructions: [], skills: [], prompts: [] }),
      d.defineExtension({
        name: "pig.reconcile",
        hooks: [d.hook(d.GenerationTask, { afterTools: forbidden })],
      }),
      approval.extension,
      image.extension(allTools),
      policy.extension(allTools),
    ];
    return { extensions };
  }
  async function open(
    id: string,
    options: {
      initialize?: boolean;
      opaque?: boolean;
      extra?: Extension[];
      admit?: boolean;
    } = {},
  ) {
    const { extensions } = definitions();
    extensions.push(...(options.extra ?? []));
    const storage = await openDurableStorage({
      dataRoot: identity.cwd,
      workspaceId: id,
    });
    const policy = compatibility.builtinRuntimeCompatibility({
      extensions,
      opaque: options.opaque ?? false,
      storage,
    });
    const registry = d.createRegistry();
    for (const extension of extensions) registry.install(extension);
    const callback = async (
      tx: Tx,
      record: import("@earendil-works/pi-durable").ConversationRecord,
    ) => {
      if (options.admit !== false) await policy.admit(tx);
      created++;
      await tx.doc(planning.Todos, record.id);
      await tx.doc(planning.Delegations, record.id);
      await tx.doc(approvals.NativeApprovals, record.id);
      Object.assign(await tx.doc(meta.PigConversationMeta, record.id), {
        workspaceKey: identity.key,
        canonicalCwd: identity.cwd,
        conversationId: record.id,
        profile: "default",
        title: "Fixture",
        createdAt: 1,
        modifiedAt: 1,
      });
    };
    const harness = await d.Harness.open(
      storage,
      {
        models: ai.createModels(),
        registry,
        settings: { extensions: [] },
        env: forbidden,
        conversationCreated: callback,
      },
      ctx,
    );
    const workspace = { harness, registry, identity };
    try {
      await harness.commit(
        async (tx) =>
          Object.assign(await tx.doc(meta.PigWorkspaceMeta), {
            workspaceKey: identity.key,
            canonicalCwd: identity.cwd,
          }),
        ctx,
      );
      if (options.initialize !== false) await policy.initialize(workspace);
    } catch (error) {
      await harness.close(ctx);
      throw error;
    }
    return {
      policy,
      registry,
      harness,
      workspace,
      extensions,
      storage,
      inspect: () => harness.inspect(ctx),
      resume: async () =>
        policy.validateResume(workspace, await harness.inspect(ctx)),
      pending: () => policy.pendingDependencies(workspace),
      create: () =>
        harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            agent: {
              extensions,
              tools: extensions.flatMap((extension) => extension.tools ?? []),
            },
          },
          ctx,
        ),
      async gate(next = definitions(), opaque = false) {
        const candidate = compatibility.builtinRuntimeCompatibility({
          extensions: next.extensions,
          opaque,
          storage,
        });
        return policy.checkCompatibility(
          {
            workspace: workspace as WorkspaceRuntime,
            current: { extensions, conversationCreated: callback },
            next: {
              extensions: next.extensions,
              conversationCreated: async () => {
                forbidden();
              },
            },
            inspection: await harness.inspect(ctx),
          },
          candidate,
        );
      },
      close: () => harness.close(ctx),
    };
  }
  return {
    d,
    ctx,
    compatibility,
    planning,
    approvals,
    meta,
    receipts,
    open,
    definitions,
    forbidden,
    effects: () => effects,
    created: () => created,
  };
}
async function known() {
  const f = await fixtures();
  let w = await f.open("known");
  const signature = w.policy.signature;
  try {
    const c = await w.create();
    assert.equal(await w.resume(), undefined);
    assert.equal(await w.gate(), undefined); // New execute/hook/render/wrap AND conversationCreated closures.
    assert.match((await w.gate(f.definitions(), true)) ?? "", /opaque/);
    const changed = f.definitions();
    const original = changed.extensions[0];
    assert(original);
    changed.extensions[0] = {
      ...original,
      tools: original.tools?.map((tool) => ({
        ...tool,
        replay: "safe" as const,
      })),
    };
    assert.match(
      (await w.gate(changed)) ?? "",
      /changed builtin definition metadata/,
    );
    const taskId = await c.commit(
      (tx) =>
        tx.createTask(
          f.d.GenerationTask,
          {},
          { ownership: { kind: "conversation" } },
        ),
      f.ctx,
    );
    assert.equal(await w.resume(), undefined);
    assert.equal((await w.inspect()).scheduling, "paused");
    assert.equal(
      (await w.harness.getTask(taskId, f.ctx))?.state.status,
      "pending",
    );
    await w.close();
    w = await f.open("known");
    assert.equal(w.policy.signature, signature);
    assert.deepEqual(
      await w.harness.snapshot(f.compatibility.BuiltinRuntimeManifest, f.ctx),
      { signature, opaque: false },
    );
    assert.equal((await w.inspect()).tasks.length, 1);
    assert.equal(await w.resume(), undefined);
    assert.equal((await w.inspect()).scheduling, "paused");
    assert.equal(f.effects(), 0);
  } finally {
    await w.close();
  }
}
async function manifests() {
  const f = await fixtures();
  const missing = await f.open("missing", { initialize: false, admit: false });
  try {
    await missing.create();
    assert.match((await missing.resume()) ?? "", /missing manifest/);
    assert.match((await missing.gate()) ?? "", /missing manifest/);
    assert.match((await missing.pending()) ?? "", /missing manifest/);
    await assert.rejects(
      missing.policy.initialize(missing.workspace),
      /preexisting conversations/,
    );
    assert.equal(
      await missing.harness.snapshot(
        f.compatibility.BuiltinRuntimeManifest,
        f.ctx,
      ),
      undefined,
    );
  } finally {
    await missing.close();
  }
  await assert.rejects(f.open("missing"), /preexisting conversations/);
  const unstamped = await f.open("unstamped", { initialize: false });
  try {
    await assert.rejects(unstamped.create(), /initialize before admission/);
    assert.equal(
      (
        await unstamped.harness.commit(
          (tx) => tx.scanConversations({}, 1),
          f.ctx,
        )
      ).items.length,
      0,
    );
    assert.equal(
      await unstamped.harness.snapshot(
        f.compatibility.BuiltinRuntimeManifest,
        f.ctx,
      ),
      undefined,
    );
  } finally {
    await unstamped.close();
  }
  for (const mode of ["changed", "opaque", "empty"] as const) {
    const w = await f.open(mode);
    try {
      await w.create();
      await w.harness.commit(async (tx) => {
        const manifest = await tx.doc(f.compatibility.BuiltinRuntimeManifest);
        if (mode === "changed") manifest.signature = "unknown-protocol";
        else if (mode === "opaque") manifest.opaque = true;
        else {
          delete manifest.signature;
          delete manifest.opaque;
        }
      }, f.ctx);
      assert.match((await w.resume()) ?? "", /manifest/);
      assert.match((await w.gate()) ?? "", /manifest/);
      assert.match((await w.pending()) ?? "", /manifest/);
      await assert.rejects(w.policy.initialize(w.workspace), /manifest/);
      await assert.rejects(w.create(), /manifest/);
    } finally {
      await w.close();
    }
    await assert.rejects(f.open(mode), /manifest/);
  }
  const external = f.d.defineExtension({
    name: "fixture.unselected",
    tools: [
      f.d.defineTool({
        name: "external",
        description: "Never called",
        parameters: {},
        execute: f.forbidden,
      }),
    ],
  });
  const opaque = await f.open("sticky", { opaque: true, extra: [external] });
  try {
    await opaque.create();
    assert.match((await opaque.pending()) ?? "", /opaque/);
  } finally {
    await opaque.close();
  }
  // Removing the unselected external registration cannot erase its persisted provenance.
  await assert.rejects(f.open("sticky"), /opaque manifest/);
  const saved = await f.open("poison-existing");
  try {
    await saved.create();
    const opaquePolicy = f.compatibility.builtinRuntimeCompatibility({
      extensions: saved.extensions,
      opaque: true,
      storage: saved.storage,
    });
    await opaquePolicy.initialize(saved.workspace);
    assert.match((await saved.pending()) ?? "", /opaque manifest/);
  } finally {
    await saved.close();
  }
  await assert.rejects(f.open("poison-existing"), /opaque manifest/);
  const docsOnly = await f.open("docs-only", { initialize: false });
  try {
    const Unknown = f.d.defineDoc({
      kind: "fixture.unknown",
      scope: "session",
      version: 1,
      initial: () => ({ value: true }),
      checkpointWhen: () => true,
    });
    await docsOnly.harness.commit(async (tx) => {
      await tx.doc(Unknown);
    }, f.ctx);
    await assert.rejects(
      docsOnly.policy.initialize(docsOnly.workspace),
      /preexisting documents/,
    );
  } finally {
    await docsOnly.close();
  }
  assert.equal(f.effects(), 0);
}
async function dependencies() {
  const f = await fixtures();
  const w = await f.open("dependencies");
  try {
    let last = await w.create();
    for (let i = 1; i < 101; i++) last = await w.create();
    assert.equal((await w.inspect()).tasks.length, 0);
    assert.equal(await w.pending(), undefined);
    await last.commit(async (tx) => {
      (await tx.doc(f.approvals.NativeApprovals, last.id)).requests.pending = {
        requestId: "pending",
        taskId: 999 as import("@earendil-works/pi-durable").TaskId,
        callId: "orphaned",
        toolName: "powershell",
        operationHash: "fixture",
        operationKind: "exec",
        policyRevision: 1,
        revision: 1,
        expiresAt: 1,
        description: "Persisted decision without live work",
        consumed: false,
        stage: "final-operation",
        state: "pending",
      };
    }, f.ctx);
    assert.equal(await w.resume(), undefined);
    assert.match((await w.pending()) ?? "", /pending approval dependency/); // Includes expired-but-unsettled decisions.
    for (const [state, consumed, blocked] of [
      ["denied", false, false],
      ["approved", false, true],
      ["approved", true, false],
    ] as const) {
      await last.commit(async (tx) => {
        const request = (await tx.doc(f.approvals.NativeApprovals, last.id))
          .requests.pending;
        assert(request);
        request.state = state;
        request.consumed = consumed;
      }, f.ctx);
      assert.equal(!!(await w.pending()), blocked);
    }
    await last.commit(async (tx) => {
      (await tx.doc(f.planning.Delegations, last.id)).runs.push({
        taskId: 999 as import("@earendil-works/pi-durable").TaskId,
        childId: last.id,
        requestId: "unresolved",
        task: "Research",
        profile: "pig.research",
        model: "fixture/none",
        outcome: "unknown",
        result: "Unresolved",
        truncated: false,
      });
    }, f.ctx);
    assert.match((await w.pending()) ?? "", /unresolved delegation/);
    await last.commit(async (tx) => {
      const run = (await tx.doc(f.planning.Delegations, last.id)).runs[0];
      assert(run);
      run.outcome = "interrupted";
    }, f.ctx);
    const Unknown = f.d.defineDoc({
      kind: "fixture.external-document",
      scope: "conversation",
      history: "latest",
      fork: "initial",
      version: 1,
      initial: () => ({ dependency: true }),
      checkpointWhen: () => true,
    });
    await last.commit(async (tx) => {
      await tx.doc(Unknown, last.id);
    }, f.ctx);
    assert.match((await w.pending()) ?? "", /unknown conversation document/);
    assert.match((await w.gate()) ?? "", /unknown conversation document/);
    assert.equal((await w.inspect()).scheduling, "paused");
    assert.equal(f.effects(), 0);
  } finally {
    await w.close();
  }
  const schema = await f.open("changed-schema");
  try {
    const c = await schema.create();
    // Change a known document's schema via PUBLIC typed migration, only as fixture setup.
    const NewTodos = f.d.defineDoc({
      ...f.planning.Todos.definition,
      scope: "conversation",
      history: "latest",
      fork: "current",
      version: 2,
      migrate: (value: import("./builtin-extensions").TodoState) => value,
    });
    await c.commit(async (tx) => {
      (await tx.doc(NewTodos, c.id)).revision++;
    }, f.ctx);
    assert.match((await schema.pending()) ?? "", /typed inspection failed/);
    assert.match((await schema.resume()) ?? "", /typed inspection failed/);
    assert.equal((await schema.inspect()).scheduling, "paused");
    assert.equal(f.effects(), 0);
  } finally {
    await schema.close();
  }
}
async function metadata() {
  const f = await fixtures();
  const w = await f.open("metadata");
  try {
    const c = await w.create();
    const optional = await w.harness.snapshot(f.d.UsageDoc, c.id, f.ctx);
    const before = await w.storage.scanDocuments(
      { scope: { kind: "conversation", conversationId: c.id }, at: "current" },
      100,
      undefined,
      f.ctx,
    );
    const created = f.created();
    await c.commit(async (tx) => {
      await tx.doc(f.receipts.DurableReceiptDoc, "fixture-key", {
        conversationId: c.id,
        requestId: "fixture",
      });
    }, f.ctx);
    for (let i = 0; i < 2; i++) {
      assert.equal(await w.resume(), undefined);
      assert.equal(await w.gate(), undefined);
      assert.equal(await w.pending(), undefined);
    }
    assert.deepEqual(
      await w.harness.snapshot(f.d.UsageDoc, c.id, f.ctx),
      optional,
    );
    assert.deepEqual(
      await w.storage.scanDocuments(
        {
          scope: { kind: "conversation", conversationId: c.id },
          at: "current",
        },
        100,
        undefined,
        f.ctx,
      ),
      before,
    );
    assert.equal(f.created(), created);
    assert.equal(f.effects(), 0);
    const opaque = f.compatibility.builtinRuntimeCompatibility({
      extensions: w.extensions,
      opaque: true,
      storage: w.storage,
    });
    assert.match(
      (await opaque.validateResume(w.workspace, await w.inspect())) ?? "",
      /opaque/,
    );
    assert.equal(f.created(), created);
    assert.equal(f.effects(), 0);
  } finally {
    await w.close();
  }
}
async function tasks() {
  const f = await fixtures();
  const w = await f.open("tasks");
  try {
    const c = await w.create();
    const parent = await c.commit(
      (tx) =>
        tx.createTask(
          f.d.GenerationTask,
          {},
          { ownership: { kind: "conversation" } },
        ),
      f.ctx,
    );
    await c.commit(
      (tx) =>
        tx.createTask(
          f.d.ToolTask,
          {
            kind: "nested",
            parent,
            parentCallId: "parent",
            key: "read",
            call: {
              type: "toolCall",
              id: "read",
              name: "read",
              arguments: { path: "not-read" },
            },
          },
          { ownership: { kind: "conversation" } },
        ),
      f.ctx,
    );
    const live = await w.inspect();
    const first = live.tasks[0];
    assert(first);
    assert.equal(await w.policy.validateResume(w.workspace, live), undefined);
    for (const state of [
      { kind: "blocked", reason: "task_too_old" },
      { kind: "pending", migrates: true },
    ] as const) {
      assert.match(
        (await w.policy.validateResume(w.workspace, {
          ...live,
          tasks: [{ ...first, state }],
        })) ?? "",
        /unknown\/blocked\/outdated task/,
      );
    }
    assert.match(
      (await w.policy.validateResume(w.workspace, {
        ...live,
        tasks: [
          {
            ...first,
            record: { ...first.record, version: 0 },
          },
        ],
      })) ?? "",
      /outdated task/,
    );
    const external = f.d.defineTask<null, { phase: "run" }, null>({
      name: "fixture.external-task",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: { run: f.forbidden },
      abort: f.forbidden,
    });
    // Persisted task without installed definition: blocked even though its version is 1.
    await c.commit(
      (tx) =>
        tx.createTask(external, null, { ownership: { kind: "conversation" } }),
      f.ctx,
    );
    assert.match((await w.resume()) ?? "", /unknown\/blocked\/outdated task/);
    assert.equal((await w.inspect()).scheduling, "paused");
    assert.equal(f.effects(), 0);
  } finally {
    await w.close();
  }
  const unknownTool = await f.open("unknown-tool");
  try {
    const c = await unknownTool.create();
    const parent = await c.commit(
      (tx) =>
        tx.createTask(
          f.d.GenerationTask,
          {},
          { ownership: { kind: "conversation" } },
        ),
      f.ctx,
    );
    await c.commit(
      (tx) =>
        tx.createTask(
          f.d.ToolTask,
          {
            kind: "nested",
            parent,
            parentCallId: "parent",
            key: "external",
            call: {
              type: "toolCall",
              id: "external",
              name: "external",
              arguments: {},
            },
          },
          { ownership: { kind: "conversation" } },
        ),
      f.ctx,
    );
    assert.match(
      (await unknownTool.resume()) ?? "",
      /unknown native tool call/,
    );
    assert.equal(f.effects(), 0);
  } finally {
    await unknownTool.close();
  }
}
if (import.meta.main) {
  const mode = process.argv[2];
  const cases: Record<string, () => Promise<void>> = {
    known,
    manifests,
    dependencies,
    metadata,
    tasks,
  };
  const run = mode && cases[mode];
  assert(run, "unknown fixture mode");
  await run();
  console.log(`PASS ${mode}`);
}
