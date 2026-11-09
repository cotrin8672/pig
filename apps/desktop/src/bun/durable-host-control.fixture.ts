import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommandConversation,
  PigConfig,
} from "../../../../packages/config/src";
import { isolatedP0Env } from "../../scripts/durable-p0";
import type { DurableHostOptions } from "./durable-host";

export async function runHostControlFixture(mode: string): Promise<void> {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-host-control-"),
  );
  const rtk = Bun.which("rtk");
  assert(rtk, "Run tests under mise exec -- rtk proxy bun");
  const child = Bun.spawn(
    [rtk, "proxy", process.execPath, import.meta.path, mode],
    {
      cwd: root,
      env: isolatedP0Env(root),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timer = setTimeout(() => child.kill(), 25_000);
  try {
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert.equal(code, 0, `${out}\n${error}`);
    assert(out.includes(`PASS ${mode}`), out);
    assert(!error.includes("Unhandled"), error);
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
    await rm(root, { recursive: true, force: true });
  }
}

async function fixture(overrides: Partial<DurableHostOptions> = {}) {
  const root = process.env.PIG_P0_ROOT;
  assert(root && process.env.HOME === root && process.env.USERPROFILE === root);
  const [ai, d, { BACKGROUND_CONTEXT: ctx }, { DurableHost }] =
    await Promise.all([
      import("@earendil-works/pi-ai"),
      import("@earendil-works/pi-durable"),
      import("@earendil-works/chord/context"),
      import("./durable-host"),
    ]);
  const cwd = join(root, "project-a"),
    other = join(root, "project-b"),
    dataRoot = join(root, "data");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(other, { recursive: true }),
  ]);
  const providers = new Map<string, ReturnType<typeof ai.fauxProvider>>();
  const runtime: NonNullable<PigConfig["runtime"]> = {
    profiles: {
      main: {
        model: { provider: "fixture", modelId: "fake" },
        extensions: [],
        tools: [],
      },
    },
    defaultProfile: "main",
  };
  const events: unknown[] = [];
  const options: DurableHostOptions = {
    dataRoot,
    config: { apiVersion: 2, runtime },
    createModels: async (identity) => {
      const faux = ai.fauxProvider({
        provider: "fixture",
        models: [{ id: "fake", reasoning: true }],
        tokensPerSecond: Infinity,
      });
      providers.set(identity.key, faux);
      const models = ai.createModels();
      models.setProvider(faux.provider);
      return models;
    },
    settings: { retry: { enabled: false }, compaction: { enabled: false } },
    checkCompatibility: async () => undefined,
    emit: (event) => {
      events.push(event);
    },
    emitUI: (event) => {
      events.push(event);
    },
    ...overrides,
  };
  const host = new DurableHost(options);
  return { root, cwd, other, ctx, ai, d, host, options, events, providers };
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert(Date.now() < deadline, "condition timed out");
    await Bun.sleep(5);
  }
}

async function packageIdle() {
  const entered = Promise.withResolvers<void>(),
    approval = Promise.withResolvers<void>();
  let calls = 0;
  const f = await fixture({
    pendingDependencies: async () => {
      calls++;
      entered.resolve();
      await approval.promise;
      return undefined;
    },
    config: {
      apiVersion: 2,
      commands: [
        { id: "test.global", title: "Global", scope: "global", run: () => {} },
      ],
    },
  });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "a" });
    const b = await f.host.open({ cwd: f.other, openId: "b" });
    const workspace = await f.host.workspace(f.cwd);
    const descriptor = await f.host.describeCommands();
    const acquiring = f.host.acquirePackageMutationLease();
    // No await needed to seal all new admission, including config and controller command entry.
    await assert.rejects(
      f.host.open({ cwd: f.cwd, openId: "blocked" }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      f.host.rename(a.info, "blocked"),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      f.host.setModel({ ...a.address, provider: "fixture", id: "fake" }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      f.host.setEffort({ ...a.address, effort: "off" }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      async () =>
        f.host.prompt({
          ...a.address,
          requestId: "blocked",
          text: "blocked",
          draftRevision: 0,
        }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    assert.throws(
      () =>
        f.host.draft({
          ...a.address,
          expectedRevision: 0,
          content: { text: "blocked", pastes: [], images: [] },
        }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    assert.throws(
      () => f.host.abort(a.address),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    assert.throws(
      () => f.host.reload({ apiVersion: 2 }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      f.host.invokeCommand({
        generation: descriptor.generation,
        commandId: "test.global",
      }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(
      f.host.invokeSessionAction({
        ...a.address,
        generation: "old",
        adapterId: "none",
        commandId: "none",
      }),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    await assert.rejects(f.host.reconnectUI(), /PACKAGE_MUTATION_LEASE_ACTIVE/);
    await entered.promise;
    assert.equal(await f.host.workspace(f.cwd), workspace); // Existing native env/resource lookup is not admission.
    approval.resolve();
    const release = await acquiring;
    assert.equal(calls, 2); // Both initialized workspaces, not just active tab.
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /PACKAGE_MUTATION_LEASE_ACTIVE/,
    );
    assert.throws(() => f.host.reload(), /PACKAGE_MUTATION_LEASE_ACTIVE/);
    release();
    release();
    await f.host.rename(a.info, "normal");
    await f.host.invokeCommand({
      generation: descriptor.generation,
      commandId: "test.global",
    });
    assert.equal((await f.host.list(f.cwd))[0]?.title, "normal");
    assert.deepEqual(f.host.drafts.read(b.address), {
      text: "",
      images: [],
      pastes: [],
      revision: 0,
    });
    assert.equal((await workspace.harness.inspect(f.ctx)).tasks.length, 0);
  } finally {
    approval.resolve();
    await f.host.dispose();
  }
}

async function packageNativeWork() {
  const f = await fixture();
  const releaseModel = Promise.withResolvers<void>();
  let aborted = 0;
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "native" });
    const workspace = await f.host.workspace(f.cwd);
    const provider = f.providers.get(workspace.identity.key);
    assert(provider);
    provider.setResponses([
      async (_context, options) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            aborted++;
          },
          { once: true },
        );
        await releaseModel.promise;
        // Already-admitted native work may resolve the trusted workspace during/after a failed guard.
        assert.equal(await f.host.workspace(f.cwd), workspace);
        return f.ai.fauxAssistantMessage("first");
      },
      f.ai.fauxAssistantMessage("second"),
    ]);
    await f.host.prompt({
      ...a.address,
      requestId: "first",
      text: "first",
      draftRevision: 0,
    });
    await until(() => provider.state.callCount === 1);
    await f.host.prompt({
      ...a.address,
      requestId: "queued",
      text: "queued",
      draftRevision: f.host.drafts.read(a.address).revision,
    });
    assert((await workspace.harness.inspect(f.ctx)).submissions.length > 0);
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /live tasks or unsettled submissions/,
    );
    assert.equal(aborted, 0);
    assert.equal(
      (await f.host.reload({ apiVersion: 2, runtime: {} })).state,
      "pending",
    );
    releaseModel.resolve();
    await workspace.harness.waitForIdle(f.ctx);
    // Live graph can be empty while a kept queued submission still requires the original definitions.
    provider.setResponses([
      f.ai.fauxAssistantMessage("failed", {
        stopReason: "error",
        errorMessage: "faux failure",
      }),
    ]);
    const failed = await workspace.create();
    const first = await failed.submit(
      { type: "input", content: "fail", requestId: "fail" },
      f.ctx,
    );
    await failed.submit(
      {
        type: "input",
        content: "kept",
        requestId: "kept",
        whenBusy: "followUp",
      },
      f.ctx,
    );
    await first.wait(f.ctx);
    await failed.waitForIdle(f.ctx);
    const inspection = await workspace.harness.inspect(f.ctx);
    assert.equal(inspection.tasks.length, 0);
    assert(inspection.submissions.length > 0);
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /unsettled submissions/,
    );
    await failed.abort(f.ctx);
    const other = await f.host.workspace(f.other);
    const task = f.d.defineTask<null, { phase: "sleep" }, null>({
      name: "test.sleep",
      version: 1,
      initial: () => ({ phase: "sleep" }),
      phases: {
        sleep: async (_record, runtime, context) => {
          await runtime.commit(
            () => ({
              status: "sleeping",
              checkpoint: { phase: "sleep" },
              until: Date.now() + 60_000,
            }),
            context,
          );
        },
      },
      abort: async (_record, runtime, context) => {
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          context,
        );
      },
    });
    other.registry.install(
      f.d.defineExtension({ name: "sleep", tasks: [task] }),
    );
    const c = await other.create();
    const parent = await c.commit(
      (tx) =>
        tx.createTask(task, null, {
          ownership: { kind: "conversation" },
          background: true,
        }),
      f.ctx,
    );
    const child = await c.commit(
      (tx) =>
        tx.createTask(task, null, {
          ownership: { kind: "task", taskId: parent },
        }),
      f.ctx,
    );
    const owned = await other.harness.createConversation(
      { ownership: { kind: "task", taskId: parent } },
      f.ctx,
    );
    await owned.commit(
      (tx) =>
        tx.createTask(task, null, { ownership: { kind: "conversation" } }),
      f.ctx,
    );
    const waiting = f.d.defineTask<
      import("@earendil-works/pi-durable").TaskId,
      { phase: "wait" },
      null
    >({
      name: "test.waiting",
      version: 1,
      initial: () => ({ phase: "wait" }),
      phases: {
        wait: async (record, runtime, context) => {
          await runtime.commit(
            () => ({
              status: "waiting",
              checkpoint: { phase: "wait" },
              on: [record.input],
              policy: "allSettled",
            }),
            context,
          );
        },
      },
      abort: async (_record, runtime, context) => {
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          context,
        );
      },
    });
    other.registry.install(
      f.d.defineExtension({ name: "waiting", tasks: [waiting] }),
    );
    const waiter = await c.commit(
      (tx) =>
        tx.createTask(waiting, child, { ownership: { kind: "conversation" } }),
      f.ctx,
    );
    await until(async () =>
      (await other.harness.inspect(f.ctx)).tasks.some(
        (item) => item.record.id === waiter && item.state.kind === "waiting",
      ),
    );
    await assert.rejects(f.host.acquirePackageMutationLease(), /live tasks/);
    assert.equal(
      (await other.harness.getTask(child, f.ctx))?.abortRequested,
      false,
    );
    await other.harness.abortTask(parent, f.ctx);
    await other.harness.waitForTask(parent, f.ctx);
    await other.harness.abortTask(waiter, f.ctx);
    await other.harness.waitForTask(waiter, f.ctx);
    const release = await f.host.acquirePackageMutationLease();
    release();
    await other.harness.close(f.ctx);
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /WORKSPACE_FAILED|WORKSPACE_HARNESS_CLOSED/,
    );
  } finally {
    releaseModel.resolve();
    await f.host.dispose();
  }
}

async function commandPorts() {
  const f = await fixture();
  let global = 0,
    immediate = 0;
  let retained: CommandConversation | undefined;
  const observed: string[] = [];
  const Note = f.d.defineDoc({
    kind: "test.command-note",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ text: "initial" }),
    checkpointWhen: () => true,
  });
  const commands: NonNullable<PigConfig["commands"]> = [
    {
      id: "test.global",
      title: "Global",
      scope: "global",
      run: (ctx) => {
        assert.equal(ctx.conversation, undefined);
        global++;
      },
    },
    {
      id: "test.change",
      title: "Change",
      scope: "conversation",
      run: async (ctx) => {
        const c = ctx.conversation;
        assert(c);
        retained = c;
        assert.equal(await c.sources.snapshot(Note), undefined);
        const nativeId = c.sources.conversation().conversation.id;
        await c.controller.commit(async (tx) => {
          (await tx.doc(Note, nativeId)).text = "committed";
        });
        c.sources.subscribe(async () => {
          immediate++;
        });
        const initial = Promise.withResolvers<void>(),
          listening = Promise.withResolvers<void>(),
          recreated = Promise.withResolvers<void>();
        await c.sources.watchDocument(Note, async (state) => {
          observed.push(
            `${state.retired ? "retired:" : ""}${state.value.text}`,
          );
          if (observed.length === 1) {
            initial.resolve();
            await listening.promise;
          }
          if (state.value.text === "recreated") recreated.resolve();
        });
        await initial.promise;
        await c.controller.commit((tx) => tx.retireDoc(Note, nativeId));
        await c.controller.commit(async (tx) => {
          (await tx.doc(Note, nativeId)).text = "recreated";
        });
        listening.resolve();
        await recreated.promise;
        await c.controller.configure({ instructions: `only ${c.session.id}` });
      },
    },
    {
      id: "test.confirm",
      title: "Confirm",
      scope: "global",
      confirmation: "Really?",
      run: () => {
        global++;
      },
    },
  ];
  try {
    assert.equal(
      (
        await f.host.reload({
          ...f.options.config,
          apiVersion: 2,
          commands,
          keymaps: [
            { keys: "ctrl+k", command: "test.change", when: "composer" },
          ],
        })
      ).state,
      "applied",
    );
    const description = await f.host.describeCommands();
    await f.host.invokeCommand({
      generation: description.generation,
      commandId: "test.global",
    });
    assert.equal(global, 1);
    await assert.rejects(
      f.host.invokeCommand({
        generation: description.generation,
        commandId: "test.confirm",
      }),
      /CONFIRMATION_UNAVAILABLE/,
    );
    const a = await f.host.open({ cwd: f.cwd, openId: "a" });
    const b = await f.host.open({ cwd: f.cwd, openId: "b" });
    await until(async () =>
      Boolean((await f.host.getSnapshot(a.address)).sessionUI?.keymaps.length),
    );
    const ui = (await f.host.getSnapshot(a.address)).sessionUI;
    assert(ui);
    const keymap = ui.keymaps[0];
    assert(keymap);
    assert(keymap.adapter.startsWith("pig.host-commands."));
    assert.equal(keymap.command, "test.change");
    assert.equal(keymap.keys, "Ctrl+K");
    await f.host.invokeSessionAction({
      ...a.address,
      generation: ui.generation,
      adapterId: keymap.adapter,
      commandId: keymap.command,
    });
    const workspace = await f.host.workspace(f.cwd);
    const ca = await workspace.conversation(a.info.id),
      cb = await workspace.conversation(b.info.id);
    assert.equal((await ca.agent(f.ctx)).instructions, `only ${a.info.id}`);
    assert.notEqual((await cb.agent(f.ctx)).instructions, `only ${a.info.id}`);
    assert(immediate > 0);
    assert.equal(observed[0], "committed");
    assert(observed.some((text) => text.startsWith("retired:")));
    assert(observed.includes("recreated"));
    assert(retained);
    await assert.rejects(
      retained.controller.configure({ instructions: "late" }),
      /COMMAND_EXECUTION_REQUIRED|abort|disposed/i,
    );
    assert.throws(() => retained?.sources.conversation());
    f.host.connect({ clientId: "ui" });
    const confirming = f.host.invokeCommand({
      generation: description.generation,
      commandId: "test.confirm",
      conversationId: a.info.id,
    });
    await until(() => f.host.broker.pending().length === 1);
    const request = f.host.broker.pending()[0];
    assert(request);
    f.host.resolveUI({ ...request, kind: "confirm", value: true });
    await confirming;
    assert.equal(global, 2);
    assert.equal(
      (
        await f.host.reload({
          ...f.options.config,
          apiVersion: 2,
          commands: [],
        })
      ).state,
      "applied",
    );
    await assert.rejects(
      f.host.invokeCommand({
        generation: description.generation,
        commandId: "test.global",
      }),
      /STALE_GENERATION/,
    );
    const last = (await f.host.describeCommands()).generation;
    // Staging failures must not replace either registry generation or UI adapter generation.
    const capacity = await f.host.reload({
      ...f.options.config,
      apiVersion: 2,
      sessionAdapters: Array.from({ length: 128 }, (_, i) => ({
        id: `user-${i}`,
        connect: () => {},
      })),
    });
    assert.equal(capacity.state, "failed");
    assert.match(capacity.reason ?? "", /HOST_COMMAND_ADAPTER_CAPACITY/);
    assert.equal((await f.host.describeCommands()).generation, last);
    assert.equal(
      (await f.host.reload({ apiVersion: 1 } as unknown as PigConfig)).state,
      "failed",
    );
    assert.equal((await f.host.describeCommands()).generation, last);
  } finally {
    await f.host.dispose();
  }
}

async function commandLeases() {
  const entered = Promise.withResolvers<void>(),
    proceed = Promise.withResolvers<void>();
  const f = await fixture();
  let aborted = false;
  try {
    const config: PigConfig = {
      ...f.options.config,
      apiVersion: 2,
      commands: [
        {
          id: "test.wait",
          title: "Wait",
          scope: "global",
          run: async (ctx) => {
            entered.resolve();
            await proceed.promise;
            aborted = ctx.scope.signal.aborted;
            await ctx.conversation?.controller.configure({
              instructions: "finished admitted command",
            });
          },
        },
      ],
    };
    await f.host.reload(config);
    const a = await f.host.open({ cwd: f.cwd, openId: "a" });
    const b = await f.host.open({ cwd: f.other, openId: "b" });
    const description = await f.host.describeCommands(a.info.id);
    const running = f.host.invokeCommand({
      generation: description.generation,
      commandId: "test.wait",
      conversationId: a.info.id,
    });
    await entered.promise;
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /PACKAGE_MUTATION_BUSY/,
    );
    const pending = await f.host.reload({ apiVersion: 2 });
    assert.equal(pending.state, "pending");
    assert.equal(
      (await f.host.describeCommands()).generation,
      description.generation,
    );
    await assert.rejects(
      f.host.invokeCommand({
        generation: description.generation,
        commandId: "test.wait",
        conversationId: b.info.id,
      }),
      /COMMAND_BUSY/,
    );
    proceed.resolve();
    await running;
    assert.equal(aborted, false);
    const ws = await f.host.workspace(f.cwd);
    assert.equal(
      (await (await ws.conversation(a.info.id)).agent(f.ctx)).instructions,
      "finished admitted command",
    );
    const release = await f.host.acquirePackageMutationLease();
    release();
    const stage = Promise.withResolvers<void>(),
      finishStage = Promise.withResolvers<void>();
    // A config compatibility gate holding the host transition also excludes commands and package commits.
    const other = await fixture({
      dataRoot: join(f.root, "other-data"),
      checkCompatibility: async () => {
        stage.resolve();
        await finishStage.promise;
        return undefined;
      },
    });
    try {
      const c = await other.host.open({ cwd: other.cwd, openId: "config" });
      const reload = other.host.reload({
        ...other.options.config,
        apiVersion: 2,
        commands: [],
      });
      await stage.promise;
      await assert.rejects(
        other.host.acquirePackageMutationLease(),
        /CONFIG_TRANSITION_BUSY/,
      );
      await assert.rejects(
        other.host.invokeCommand({
          generation: (await other.host.describeCommands()).generation,
          commandId: "config.reload",
        }),
        /CONFIG_TRANSITION_BUSY/,
      );
      assert.equal(
        (await other.host.getSnapshot(c.address)).address.epoch,
        c.address.epoch,
      );
      finishStage.resolve();
      assert.equal((await reload).state, "applied");
    } finally {
      finishStage.resolve();
      await other.host.dispose();
    }
  } finally {
    proceed.resolve();
    await f.host.dispose();
  }
}

async function deferredReload() {
  const f = await fixture({
    configFile: join(process.env.PIG_P0_ROOT ?? "", "explicit", "config.ts"),
  });
  try {
    await mkdir(join(f.root, "explicit"), { recursive: true });
    const file = join(f.root, "explicit", "config.ts");
    await writeFile(
      file,
      'export default { apiVersion: 2, commands: [{ id: "test.loaded", title: "Loaded", scope: "global", run() {} }], keymaps: [{ keys: "ctrl+r", command: "config.reload", when: "chat" }] };',
    );
    const first = await f.host.describeCommands();
    await f.host.invokeCommand({
      generation: first.generation,
      commandId: "config.reload",
    });
    await until(() => f.host.commandReloadResult !== undefined);
    assert.equal(f.host.commandReloadResult?.state, "applied");
    const next = await f.host.describeCommands();
    assert.notEqual(next.generation, first.generation);
    assert(next.commands.some((command) => command.id === "test.loaded"));
    const a = await f.host.open({ cwd: f.cwd, openId: "keyboard" });
    await until(async () =>
      Boolean((await f.host.getSnapshot(a.address)).sessionUI?.keymaps.length),
    );
    const ui = (await f.host.getSnapshot(a.address)).sessionUI;
    assert(ui);
    const key = ui.keymaps[0];
    assert(key);
    await writeFile(file, "export default { apiVersion: 1 };");
    await f.host.invokeSessionAction({
      ...a.address,
      generation: ui.generation,
      adapterId: key.adapter,
      commandId: key.command,
    });
    await until(() => f.host.commandReloadResult?.state === "failed");
    assert.match(f.host.commandReloadResult?.reason ?? "", /apiVersion 1/);
    assert.equal((await f.host.describeCommands()).generation, next.generation);
  } finally {
    await f.host.dispose();
  }
}

async function reconnect() {
  const entered = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>(),
    model = Promise.withResolvers<void>();
  let count = 0,
    aborts = 0,
    fail = false;
  const f = await fixture({
    attachUI: () => ({
      reconnect: async () => {
        count++;
        entered.resolve();
        await resume.promise;
        if (fail) throw new Error("reconnect fixture failure");
      },
      dispose: () => {},
    }),
  });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "a" });
    const b = await f.host.open({ cwd: f.cwd, openId: "b" });
    const ws = await f.host.workspace(f.cwd);
    const provider = f.providers.get(ws.identity.key);
    assert(provider);
    provider.setResponses([
      async (_context, options) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            aborts++;
          },
          { once: true },
        );
        await model.promise;
        return f.ai.fauxAssistantMessage("done");
      },
    ]);
    await f.host.prompt({
      ...a.address,
      requestId: "running",
      text: "run",
      draftRevision: 0,
    });
    await until(() => provider.state.callCount === 1);
    const before = f.host.draft({
      ...a.address,
      expectedRevision: f.host.drafts.read(a.address).revision,
      content: { text: "preserved", pastes: [], images: [] },
    }).draft;
    f.host.connect({ clientId: "first" });
    f.host.disconnect({ clientId: "first" });
    f.host.connect({ clientId: "second" });
    const connecting = f.host.reconnectUI();
    await entered.promise;
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /PACKAGE_MUTATION_BUSY/,
    );
    resume.resolve();
    await connecting;
    assert.equal(count, 2);
    assert.equal(aborts, 0);
    assert.deepEqual(f.host.drafts.read(a.address), before);
    assert.deepEqual((await f.host.getSnapshot(a.address)).address, a.address);
    assert.deepEqual((await f.host.getSnapshot(b.address)).address, b.address);
    fail = true;
    await assert.rejects(f.host.reconnectUI(), /NATIVE_UI_RECONNECT_FAILED/);
    assert.equal(f.host.broker.isAvailable(), false);
    assert.equal(aborts, 0);
    assert((await f.host.getSnapshot(a.address)).failure);
    model.resolve();
    await ws.harness.waitForIdle(f.ctx);
  } finally {
    model.resolve();
    resume.resolve();
    await f.host.dispose();
  }
}

async function admissionLeases() {
  const creating = Promise.withResolvers<void>(),
    modelsReady = Promise.withResolvers<void>();
  const preparing = Promise.withResolvers<void>(),
    inputReady = Promise.withResolvers<void>();
  let dependency: string | undefined;
  const f = await fixture({
    createModels: async () => {
      creating.resolve();
      await modelsReady.promise;
      return (await import("@earendil-works/pi-ai")).createModels();
    },
    pendingDependencies: async () => {
      if (dependency === "throw") throw new Error("approval read unavailable");
      return dependency;
    },
  });
  try {
    const opening = f.host.open({ cwd: f.cwd, openId: "opening" });
    await creating.promise;
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /PACKAGE_MUTATION_BUSY/,
    );
    modelsReady.resolve();
    const a = await opening;
    dependency = "persistent approval waiting";
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /persistent approval waiting/,
    );
    dependency = "throw";
    await assert.rejects(
      f.host.acquirePackageMutationLease(),
      /approval read unavailable/,
    );
    dependency = undefined;
    const release = await f.host.acquirePackageMutationLease();
    release();
    assert.equal((await f.host.getSnapshot(a.address)).failure, undefined);
    const other = await fixture({
      dataRoot: join(f.root, "preflight-data"),
      prepareInput: async (params) => {
        preparing.resolve();
        await inputReady.promise;
        return params.text;
      },
    });
    try {
      const b = await other.host.open({ cwd: other.cwd, openId: "preflight" });
      const sending = other.host.prompt({
        ...b.address,
        requestId: "preparing",
        text: "input",
        draftRevision: 0,
      });
      await preparing.promise;
      await assert.rejects(
        other.host.acquirePackageMutationLease(),
        /PACKAGE_MUTATION_BUSY/,
      );
      inputReady.resolve();
      await sending;
      assert.equal(
        (await other.host.getSnapshot(b.address)).failure,
        undefined,
      );
    } finally {
      inputReady.resolve();
      await other.host.dispose();
    }
  } finally {
    modelsReady.resolve();
    await f.host.dispose();
  }
}

async function commandCancellation() {
  const f = await fixture();
  const acquired = Promise.withResolvers<void>(),
    deliver = Promise.withResolvers<void>(),
    model = Promise.withResolvers<void>();
  let callbacks = 0,
    aborted = 0,
    scopeSignal: AbortSignal | undefined;
  const Note = f.d.defineDoc({
    kind: "test.late-command-doc",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ text: "native" }),
    checkpointWhen: () => true,
  });
  try {
    await f.host.reload({
      ...f.options.config,
      apiVersion: 2,
      commands: [
        {
          id: "test.watch",
          title: "Watch",
          scope: "conversation",
          allowWhileStreaming: true,
          run: async (ctx) => {
            scopeSignal = ctx.scope.signal;
            const c = ctx.conversation;
            assert(c);
            const nativeId = c.sources.conversation().conversation.id;
            await c.controller.commit(async (tx) => {
              await tx.doc(Note, nativeId);
            });
            await c.sources.watchDocument(Note, () => {
              callbacks++;
            });
          },
        },
        {
          id: "test.idle",
          title: "Idle only",
          scope: "conversation",
          run: () => {
            throw new Error("must not run while streaming");
          },
        },
      ],
    });
    const a = await f.host.open({ cwd: f.cwd, openId: "cancel-command" });
    const ws = await f.host.workspace(f.cwd);
    const provider = f.providers.get(ws.identity.key);
    assert(provider);
    provider.setResponses([
      async (_context, options) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            aborted++;
          },
          { once: true },
        );
        await model.promise;
        return f.ai.fauxAssistantMessage("done");
      },
    ]);
    await f.host.prompt({
      ...a.address,
      requestId: "native",
      text: "native",
      draftRevision: 0,
    });
    await until(() => provider.state.callCount === 1);
    const description = await f.host.describeCommands(a.info.id);
    assert.equal(
      description.commands.find((cmd) => cmd.id === "test.idle")?.disabled,
      "AGENT_BUSY",
    );
    await assert.rejects(
      f.host.invokeCommand({
        generation: description.generation,
        commandId: "test.idle",
        conversationId: a.info.id,
      }),
      /AGENT_BUSY/,
    );
    const original = ws.harness.watchDoc;
    ws.harness.watchDoc = (async (...args: unknown[]) => {
      // Real watch acquired before cancellation; delay only its delivery, ignoring the original canceled signal.
      args[args.length - 1] = f.ctx;
      const watch = await Reflect.apply(original, ws.harness, args);
      acquired.resolve();
      await deliver.promise;
      return watch;
    }) as typeof original;
    const running = f.host.invokeCommand({
      generation: description.generation,
      commandId: "test.watch",
      conversationId: a.info.id,
    });
    const failed = assert.rejects(running);
    await acquired.promise;
    const closing = f.host.close(a.address);
    await failed;
    assert(scopeSignal?.aborted);
    deliver.resolve();
    await closing;
    assert.equal(callbacks, 0);
    assert.equal(aborted, 0);
    ws.harness.watchDoc = original;
    model.resolve();
    await ws.harness.waitForIdle(f.ctx);
  } finally {
    deliver.resolve();
    model.resolve();
    await f.host.dispose();
  }
}

if (import.meta.main) {
  const probes: Record<string, () => Promise<void>> = {
    "package-idle": packageIdle,
    "package-native": packageNativeWork,
    commands: commandPorts,
    "command-leases": commandLeases,
    "deferred-reload": deferredReload,
    reconnect,
    "admission-leases": admissionLeases,
    "command-cancellation": commandCancellation,
  };
  const mode = process.argv[2],
    probe = probes[mode];
  assert(probe);
  await probe();
  console.log(`PASS ${mode}`);
}
