import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PigConfig } from "../../../../packages/config/src";
import { isolatedP0Env } from "../../scripts/durable-p0";
import type { DurableHostOptions } from "./durable-host";

/** Tests launch only through RTK; native runtime imports happen inside the isolated child. */
export async function runDurableHostFixture(mode: string): Promise<void> {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-native-host-"),
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
  const timeout = setTimeout(() => child.kill(), 25_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert.equal(code, 0, `${mode}\n${stdout}\n${stderr}`);
    assert(stdout.includes(`PASS ${mode}`), `${stdout}\n${stderr}`);
    assert(!stderr.includes("Unhandled"), stderr);
  } finally {
    clearTimeout(timeout);
    child.kill();
    await child.exited;
    await rm(root, { recursive: true, force: true });
  }
}

async function fixture(overrides: Partial<DurableHostOptions> = {}) {
  const root = process.env.PIG_P0_ROOT;
  assert(
    root && process.env.HOME === root && process.env.USERPROFILE === root,
    "temporary HOME required",
  );
  const [
    ai,
    d,
    { BACKGROUND_CONTEXT: ctx },
    { DurableHost },
    { WorkspaceRuntime },
    meta,
  ] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
    import("./durable-host"),
    import("./workspace-runtime"),
    import("./native-conversation-meta"),
  ]);
  const cwd = join(root, "project-a"),
    other = join(root, "project-b"),
    dataRoot = join(root, "data");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(other, { recursive: true }),
  ]);
  const faux = new Map<string, ReturnType<typeof ai.fauxProvider>>();
  const events: unknown[] = [];
  const runtime: NonNullable<PigConfig["runtime"]> = {
    profiles: {
      main: {
        model: { provider: "fixture", modelId: "fake" },
        thinkingLevel: "off",
        extensions: [],
        tools: [],
      },
    },
    defaultProfile: "main",
  };
  const options: DurableHostOptions = {
    dataRoot,
    config: { apiVersion: 2, runtime },
    createModels: async (identity) => {
      const provider = ai.fauxProvider({
        provider: "fixture",
        models: [{ id: "fake", reasoning: true }],
        tokensPerSecond: Infinity,
      });
      const models = ai.createModels();
      models.setProvider(provider.provider);
      faux.set(identity.key, provider);
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
  const workspace = await host.workspace(cwd);
  const provider = () => {
    const value = faux.get(workspace.identity.key);
    assert(value);
    return value;
  };
  return {
    root,
    cwd,
    other,
    dataRoot,
    ctx,
    ai,
    d,
    meta,
    host,
    workspace,
    provider,
    faux,
    events,
    options,
    DurableHost,
    WorkspaceRuntime,
  };
}

async function until(test: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!(await test())) {
    assert(Date.now() < deadline, "fixture condition timed out");
    await Bun.sleep(5);
  }
}

async function workspaceProbe() {
  const f = await fixture();
  let restarted: InstanceType<typeof f.DurableHost> | undefined;
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "a" });
    const b = await f.host.open({ cwd: f.other, openId: "b" });
    const wb = await f.host.workspace(f.other);
    assert.notEqual(f.workspace.harness, wb.harness);
    assert.notEqual(f.workspace.registry, wb.registry);
    assert.notEqual(f.workspace.models, wb.models);
    assert.notEqual(
      f.meta.parseConversationAppId(a.info.id).workspaceKey,
      f.meta.parseConversationAppId(b.info.id).workspaceKey,
    );
    assert.match(a.info.id, /^d2_[a-f0-9]{32}_[1-9][0-9]*$/);
    assert(!a.info.id.includes("project-a"));
    const installed = f.d.defineExtension({ name: "workspace-a-only" });
    f.workspace.registry.install(installed);
    assert.equal(wb.registry.snapshot().extension(installed.name), undefined);
    f.workspace.models.deleteProvider("fixture");
    assert(wb.models.getProvider("fixture"));
    f.workspace.models.setProvider(f.provider().provider);
    const c = await f.workspace.conversation(a.info.id);
    await c.configure({ cwd: f.other }, f.ctx);
    assert.equal((await f.host.list(f.cwd))[0]?.cwd, f.cwd);
    await assert.rejects(
      f.host.open({ cwd: f.other, id: a.info.id, openId: "cross" }),
      /WORKSPACE_MISMATCH/,
    );
    await assert.rejects(
      f.host.rename({ cwd: f.other, id: a.info.id }, "bad"),
      /WORKSPACE_MISMATCH/,
    );
    for (const id of [
      "sdk-id",
      "d2_bad_1",
      `d2_${f.workspace.identity.key}_01`,
      `d2_${f.workspace.identity.key}_9007199254740993`,
    ])
      await assert.rejects(
        f.host.open({ cwd: f.cwd, id, openId: id }),
        /INVALID_NATIVE_SESSION_ID/,
      );
    await f.host.rename(a.info, "Persisted name");
    await f.host.dispose();
    restarted = new f.DurableHost(f.options);
    const listed = await restarted.list(f.cwd);
    assert.equal(listed[0]?.id, a.info.id);
    assert.equal(listed[0]?.title, "Persisted name");
    const reopened = await restarted.open({
      cwd: f.cwd,
      id: a.info.id,
      openId: "restart",
    });
    assert.notEqual(reopened.address.hostId, a.address.hostId);
    assert.equal(reopened.info.cwd, f.cwd);
    const ws = await restarted.workspace(f.cwd);
    const membership = await ws.metadata(await ws.conversation(a.info.id));
    assert.equal(membership.profile, "main");
    await assert.rejects(
      restarted.delete(a.info),
      /NATIVE_PHYSICAL_DELETE_UNSUPPORTED/,
    );
    assert.equal((await restarted.list(f.cwd)).length, 1);
  } finally {
    await f.host.dispose();
    await restarted?.dispose();
  }
}

async function lifecycleProbe() {
  const f = await fixture();
  try {
    f.host.connect({ clientId: "root" });
    assert.equal(f.host.heartbeat({ clientId: "root" }).connected, true);
    const input = { cwd: f.cwd, openId: "same" };
    const [a, duplicate] = await Promise.all([
      f.host.open(input),
      f.host.open(input),
    ]);
    assert.deepEqual(a.address, duplicate.address);
    await assert.rejects(
      f.host.open({ cwd: f.other, openId: "same" }),
      /OPEN_ID_CONFLICT/,
    );
    f.host.draft({
      ...a.address,
      expectedRevision: 0,
      content: { text: "unsent", pastes: [], images: [] },
    });
    await f.host.close(a.address);
    await assert.rejects(
      f.host.getSnapshot(a.address),
      /STALE_SESSION_ADDRESS/,
    );
    const reopened = await f.host.open({
      cwd: f.cwd,
      id: a.info.id,
      openId: "new-epoch",
    });
    assert(reopened.address.epoch > a.address.epoch);
    assert.equal(f.host.drafts.read(reopened.address).text, "unsent");
    assert.throws(
      () =>
        f.host.draft({
          ...a.address,
          expectedRevision: 1,
          content: { text: "stale", pastes: [], images: [] },
        }),
      /STALE_SESSION_ADDRESS/,
    );
    assert.equal(f.host.getOpenState({ openId: "same" }).state, "failed");
    const other = await f.host.open({ cwd: f.cwd, openId: "other" });
    let aborts = 0;
    const wait = Promise.withResolvers<void>();
    const response: Parameters<
      ReturnType<typeof f.ai.fauxProvider>["setResponses"]
    >[0][number] = async (_context, options) => {
      await Promise.race([
        wait.promise,
        new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            aborts++;
            resolve();
          } else
            options?.signal?.addEventListener(
              "abort",
              () => {
                aborts++;
                resolve();
              },
              { once: true },
            );
        }),
      ]);
      return f.ai.fauxAssistantMessage("finished");
    };
    f.provider().setResponses([response, response]);
    const revision = f.host.drafts.read(reopened.address).revision;
    await f.host.prompt({
      ...reopened.address,
      requestId: "a",
      text: "work",
      draftRevision: revision,
    });
    await f.host.prompt({
      ...other.address,
      requestId: "b",
      text: "other work",
      draftRevision: 0,
    });
    await until(() => f.provider().state.callCount === 2);
    await f.host.close(reopened.address);
    await f.host.close(other.address);
    f.host.disconnect({ clientId: "root" });
    assert.equal(f.host.heartbeat({ clientId: "root" }).connected, false);
    assert.equal(aborts, 0);
    assert((await f.workspace.harness.inspect(f.ctx)).tasks.length >= 2);
    const attached = await f.host.open({
      cwd: f.cwd,
      id: other.info.id,
      openId: "stop-target",
    });
    await f.host.abort(attached.address);
    assert.equal(aborts, 1);
    assert(
      (await f.workspace.harness.inspect(f.ctx)).tasks.some(
        (task) =>
          task.record.conversationId !==
          f.meta.parseConversationAppId(other.info.id).id,
      ),
    );
    wait.resolve();
    await f.workspace.harness.waitForIdle(f.ctx);
    assert((await f.host.getSnapshot(attached.address)).aborted);
  } finally {
    await f.host.dispose();
  }
}

async function sendProbe() {
  const preparing = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const f = await fixture({
    prepareInput: async (params) => {
      preparing.resolve();
      await release.promise;
      return params.text;
    },
  });
  let restarted: InstanceType<typeof f.DurableHost> | undefined;
  try {
    f.provider().setResponses([f.ai.fauxAssistantMessage("ok")]);
    const a = await f.host.open({ cwd: f.cwd, openId: "send" });
    const draft = f.host.draft({
      ...a.address,
      expectedRevision: 0,
      content: { text: "first", pastes: [], images: [] },
    }).draft;
    const params = {
      ...a.address,
      requestId: "durable-key",
      text: "first",
      draftRevision: draft.revision,
    };
    const sending = f.host.prompt(params);
    await preparing.promise;
    assert.equal(f.host.drafts.read(a.address).text, "first");
    f.host.draft({
      ...a.address,
      expectedRevision: draft.revision,
      content: { text: "newer draft", pastes: [], images: [] },
    });
    release.resolve();
    assert.equal((await sending).disposition, "started");
    assert.equal(f.host.drafts.read(a.address).text, "newer draft");
    assert.equal((await f.host.getReceipt(params)).state, "accepted");
    assert.equal((await f.host.prompt(params)).disposition, "started");
    await assert.rejects(
      async () => f.host.prompt({ ...params, text: "different" }),
      /REQUEST_ID_CONFLICT/,
    );
    await f.workspace.harness.waitForIdle(f.ctx);
    assert.equal(f.provider().state.callCount, 1);
    await f.host.close(a.address);
    assert.equal((await f.host.getReceipt(params)).state, "accepted");
    await f.host.dispose();
    restarted = new f.DurableHost(f.options);
    assert.equal(
      (await restarted.getReceipt({ ...params, cwd: f.cwd })).state,
      "accepted",
    );
    await assert.rejects(
      restarted.getReceipt({ ...params, cwd: f.other }),
      /CONTEXT_REQUIRED/,
    );
    const fresh = await restarted.open({
      cwd: f.cwd,
      id: a.info.id,
      openId: "receipt-reopen",
    });
    assert.equal(
      (await restarted.prompt({ ...params, ...fresh.address })).disposition,
      "started",
    );
    assert.equal(
      (await restarted.workspace(f.cwd)).models.getProviders().length,
      1,
    );
    assert.equal(
      (await restarted.getSnapshot(fresh.address)).transcript.records.filter(
        (record) => record.kind === "message" && record.message.role === "user",
      ).length,
      1,
    );
    const ws = await restarted.workspace(f.cwd),
      c = await ws.conversation(a.info.id);
    await c.configure({ model: null }, f.ctx);
    const retained = restarted.draft({
      ...fresh.address,
      expectedRevision: 0,
      content: { text: "no model", pastes: [], images: [] },
    }).draft;
    await assert.rejects(
      async () =>
        restarted?.prompt({
          ...fresh.address,
          requestId: "rejected",
          text: "no model",
          draftRevision: retained.revision,
        }),
      /available model/,
    );
    assert.equal(restarted.drafts.read(fresh.address).text, "no model");
  } finally {
    release.resolve();
    await f.host.dispose();
    await restarted?.dispose();
  }
}

async function forkProbe() {
  const f = await fixture();
  try {
    const Note = f.d.defineDoc({
      kind: "pig.fixture.fork-doc",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ text: "initialized" }),
      checkpointWhen: () => true,
    });
    // The fixture's explicit compatibility port proves this known test schema.
    const config = {
      ...f.options.config,
      apiVersion: 2 as const,
      runtime: {
        ...f.options.config?.runtime,
        conversationCreated: async (
          tx: import("@earendil-works/pi-durable").Tx,
          record: import("@earendil-works/pi-durable").ConversationRecord,
        ) => {
          await tx.doc(Note, record.id);
        },
      },
    };
    assert.equal((await f.host.reload(config)).state, "applied");
    const a = await f.host.open({ cwd: f.cwd, openId: "original" });
    f.provider().setResponses([
      f.ai.fauxAssistantMessage("one"),
      f.ai.fauxAssistantMessage("two"),
    ]);
    const c = await f.workspace.conversation(a.info.id);
    await c.commit(async (tx) => {
      (await tx.doc(Note, c.id)).text = "first-context";
    }, f.ctx);
    await f.host.prompt({
      ...a.address,
      requestId: "one",
      text: "first input",
      draftRevision: 0,
    });
    await c.waitForIdle(f.ctx);
    await c.commit(async (tx) => {
      (await tx.doc(Note, c.id)).text = "later-context";
    }, f.ctx);
    await f.host.prompt({
      ...a.address,
      requestId: "two",
      text: "second input",
      draftRevision: f.host.drafts.read(a.address).revision,
    });
    await c.waitForIdle(f.ctx);
    const original = await f.workspace.entries(c);
    const inputs = original.filter((entry) => f.d.UserEntry.is(entry));
    assert.equal(inputs.length, 2);
    const branch = await f.host.regenerateFrom({
      ...a.address,
      entryId: String(inputs[1].id),
    });
    const branchC = await f.workspace.conversation(branch.info.id);
    const copied = await f.workspace.entries(branchC);
    const boundary =
      original[original.findIndex((entry) => entry.id === inputs[1].id) - 1];
    assert.equal(copied.at(-1)?.id, boundary?.id);
    assert(!copied.some((entry) => entry.id === inputs[1].id));
    assert.equal(
      (await f.workspace.harness.snapshot(Note, branchC.id, f.ctx))?.text,
      "first-context",
    );
    const first = await f.host.regenerateFrom({
      ...a.address,
      entryId: String(inputs[0].id),
    });
    const firstC = await f.workspace.conversation(first.info.id);
    assert.equal((await f.workspace.entries(firstC)).length, 0);
    assert.equal((await firstC.agent(f.ctx)).model?.modelId, "fake");
    assert.deepEqual((await firstC.agent(f.ctx)).tools, []);
    assert.equal(
      (await f.workspace.harness.snapshot(Note, firstC.id, f.ctx))?.text,
      "initialized",
    );
    assert.equal(
      (await f.workspace.harness.snapshot(Note, c.id, f.ctx))?.text,
      "later-context",
    );
    const inclusive = await f.host.fork({
      ...a.address,
      entryId: String(inputs[1].id),
    });
    assert.equal(
      (
        await f.workspace.entries(
          await f.workspace.conversation(inclusive.info.id),
        )
      ).at(-1)?.id,
      inputs[1].id,
    );
    assert.deepEqual(
      (await f.workspace.entries(c)).map((entry) => entry.id),
      original.map((entry) => entry.id),
    );
    await assert.rejects(
      f.host.regenerateFrom({
        ...a.address,
        entryId: String(
          original.find((entry) => f.d.AssistantEntry.is(entry))?.id,
        ),
      }),
      /native user input/,
    );
    await assert.rejects(
      f.host.fork({ ...a.address, entryId: "999999" }),
      /ENTRY_NOT_VISIBLE/,
    );
    assert.equal((await f.host.list(f.cwd)).length, 4);
    assert.equal((await f.workspace.metadata(branchC)).profile, "main");
    assert.equal(
      (await f.host.getReceipt({ ...branch.address, requestId: "two" })).state,
      "unknown",
    );
  } finally {
    await f.host.dispose();
  }
}

async function sourceProbe() {
  const f = await fixture();
  const { DurableAdapterSource } = await import("./durable-adapter-source");
  const Note = f.d.defineDoc({
    kind: "pig.fixture.note",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ text: "initial" }),
    checkpointWhen: () => true,
  });
  const signal = new AbortController();
  let stale = false;
  const c = await f.workspace.create();
  const source = new DurableAdapterSource({
    harness: f.workspace.harness,
    conversation: c,
    context: f.ctx,
    session: { id: "native-source", cwd: f.cwd },
    assertCurrent: () => {
      if (stale) throw new Error("STALE_SESSION_ADDRESS");
    },
  });
  try {
    await source.start();
    assert.equal(await source.snapshot(Note, signal.signal), undefined);
    await c.commit(async (tx) => {
      (await tx.doc(Note, c.id)).text = "created";
    }, f.ctx);
    const observed: { value: Readonly<{ text: string }>; retired: boolean }[] =
      [];
    const stop = await source.watchDocument(
      Note,
      (state) => {
        observed.push(state);
      },
      signal.signal,
    );
    assert(stop);
    assert.equal(observed[0]?.value.text, "created");
    assert.equal(source.conversation().docs[Note.definition.kind], undefined);
    const detached = source.conversation();
    (detached.docs as Record<string, unknown>).bad = true;
    assert.equal(source.conversation().docs.bad, undefined);
    await source.commit(async (tx) => {
      (await tx.doc(Note, c.id)).text = "updated";
    }, signal.signal);
    await until(() => observed.some((state) => state.value.text === "updated"));
    await c.commit((tx) => tx.retireDoc(Note, c.id), f.ctx);
    await until(() => observed.some((state) => state.retired));
    stop();
    await Bun.sleep(1);
    assert.equal(source.failure, undefined);
    stale = true;
    await assert.rejects(
      source.configure({ instructions: "stale mutation" }, signal.signal),
      /STALE_SESSION_ADDRESS/,
    );
    assert.notEqual((await c.agent(f.ctx)).instructions, "stale mutation");
    stale = false;
    // Delay acquisition of a REAL native watch acquired without the source cancellation context.
    await c.commit((tx) => tx.doc(Note, c.id), f.ctx);
    const native = await f.workspace.harness.watchDoc(Note, c.id, f.ctx);
    assert(native);
    const gate = Promise.withResolvers<void>();
    let stopped = false;
    const lateWatch = {
      value: native.value,
      closed: native.closed,
      start: native.start.bind(native),
      stop: async () => {
        stopped = true;
        return native.stop();
      },
    };
    const proxy = new Proxy(f.workspace.harness, {
      get(target, key) {
        if (key === "watchDoc")
          return async () => {
            await gate.promise;
            return lateWatch;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const late = new DurableAdapterSource({
      harness: proxy,
      conversation: c,
      context: f.ctx,
      session: { id: "late", cwd: f.cwd },
      assertCurrent: () => {},
    });
    await late.start();
    const pending = late.watchDocument(
      Note,
      () => {
        throw new Error("late listener must not run");
      },
      signal.signal,
    );
    const disposed = late.dispose();
    gate.resolve();
    await pending;
    await disposed;
    assert(stopped);
    assert.deepEqual(source.taskGraph(), { tasks: {} });
  } finally {
    stale = false;
    await source.dispose();
    await f.host.dispose();
  }
}

async function reloadProbe() {
  const f = await fixture({ checkCompatibility: undefined });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "reload" });
    const c = await f.workspace.conversation(a.info.id);
    const wait = Promise.withResolvers<void>();
    f.provider().setResponses([
      async (_context, options) => {
        await Promise.race([
          wait.promise,
          new Promise<void>((resolve) => {
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
          }),
        ]);
        return f.ai.fauxAssistantMessage("done");
      },
    ]);
    await f.host.prompt({
      ...a.address,
      requestId: "busy",
      text: "busy",
      draftRevision: 0,
    });
    await until(() => f.provider().state.callCount === 1);
    const registry = f.workspace.registry,
      models = f.workspace.models;
    const result = await f.host.reload({ apiVersion: 2, runtime: {} });
    assert.equal(result.state, "pending");
    assert.equal(f.workspace.registry, registry);
    assert.equal(f.workspace.models, models);
    wait.resolve();
    await c.waitForIdle(f.ctx);
    const unknown = await f.host.reload({ apiVersion: 2, runtime: {} });
    assert.equal(unknown.state, "failed");
    assert.match(unknown.reason ?? "", /SCHEMA_COMPATIBILITY_UNKNOWN/);
    assert.equal(f.workspace.registry, registry);
    const adapter = { id: "safe-display", connect: () => {} };
    // Removing the runtime is itself a runtime change and cannot bypass the gate.
    assert.equal(
      (await f.host.reload({ apiVersion: 2, sessionAdapters: [adapter] }))
        .state,
      "failed",
    );
    // Pending durable custom/approval/child/background work is counted even with no running model.
    const task = f.d.defineTask<null, { phase: "wait" }, null>({
      name: "fixture.pending",
      version: 1,
      initial: () => ({ phase: "wait" }),
      phases: {
        wait: async (_task, runtime, context) => {
          await runtime.commit(
            () => ({
              status: "sleeping",
              checkpoint: { phase: "wait" },
              until: Date.now() + 60_000,
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
    f.workspace.registry.install(
      f.d.defineExtension({ name: "pending", tasks: [task] }),
    );
    const id = await c.commit(
      (tx) =>
        tx.createTask(task, null, {
          ownership: { kind: "conversation" },
          background: true,
        }),
      f.ctx,
    );
    await until(async () =>
      (await f.workspace.harness.inspect(f.ctx)).tasks.some(
        (item) => item.record.id === id && item.state.kind === "sleeping",
      ),
    );
    assert.equal(
      (await f.host.reload({ apiVersion: 2, runtime: {} })).state,
      "pending",
    );
    await f.workspace.harness.abortTask(id, f.ctx);
    await f.workspace.harness.waitForTask(id, f.ctx);
  } finally {
    await f.host.dispose();
  }
}

async function actionProbe() {
  const f = await fixture({
    config: {
      apiVersion: 2,
      sessionAdapters: [
        {
          id: "fixture",
          connect(ctx) {
            ctx.commands.register({
              id: "set",
              title: "Set",
              run: async () => {
                await ctx.controller.configure({ instructions: "configured" });
              },
            });
            ctx.views.set({
              id: "mode",
              kind: "mode",
              title: "Mode",
              source: {
                label: "Native",
                scope: { kind: "session", id: ctx.session.id },
                freshness: "live",
              },
              axis: "test",
              value: "initial",
              choices: [],
              actions: [{ id: "set", label: "Set", command: "set" }],
            });
          },
        },
      ],
    },
  });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "action" });
    await until(async () =>
      Boolean((await f.host.getSnapshot(a.address)).sessionUI?.views.length),
    );
    const ui = (await f.host.getSnapshot(a.address)).sessionUI;
    assert(ui);
    const view = ui.views[0];
    assert(view);
    const request = {
      ...a.address,
      generation: ui.generation,
      adapterId: "fixture",
      commandId: "set",
      viewId: view.view.id,
      revision: view.revision,
      actionId: "set",
    };
    await f.host.invokeSessionAction(request);
    assert.equal(
      (await (await f.workspace.conversation(a.info.id)).agent(f.ctx))
        .instructions,
      "configured",
    );
    await assert.rejects(f.host.invokeSessionAction(request), /STALE_VIEW/);
    await assert.rejects(
      f.host.invokeSessionAction({ ...request, epoch: a.address.epoch + 100 }),
      /STALE_SESSION_ADDRESS/,
    );
    assert.equal((await f.host.reload({ apiVersion: 2 })).state, "applied");
    await assert.rejects(
      f.host.invokeSessionAction(request),
      /STALE_GENERATION/,
    );
  } finally {
    await f.host.dispose();
  }
}

async function failureProbe() {
  const f = await fixture();
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "failed" });
    await f.workspace.harness.close(f.ctx);
    await f.workspace.harness.closed;
    await until(() => Boolean(f.workspace.failure));
    assert((await f.host.getSnapshot(a.address)).failure);
    await assert.rejects(
      async () =>
        f.host.prompt({
          ...a.address,
          text: "must not run",
          requestId: "no",
          draftRevision: 0,
        }),
      /WORKSPACE_FAILED/,
    );
    await f.host.close(a.address);
    assert.equal(f.host.runtimeState().sessions.length, 0);
    await f.host.dispose();
    // A failed OPEN must release its new SQLite writer. Invalid saved custom task blocks resume.
    const task = f.d.defineTask<null, { phase: "wait" }, null>({
      name: "fixture.missing",
      version: 1,
      initial: () => ({ phase: "wait" }),
      phases: { wait: async () => {} },
      abort: async () => {},
    });
    const options = {
      ...f.options,
      onFailure: undefined,
      cwd: f.cwd,
      runtime: {
        extensions: [f.d.defineExtension({ name: "missing", tasks: [task] })],
      },
    };
    const ws = await f.WorkspaceRuntime.open(options);
    const c = await ws.create();
    await c.commit(
      (tx) =>
        tx.createTask(task, null, { ownership: { kind: "conversation" } }),
      f.ctx,
    );
    await ws.dispose();
    await assert.rejects(
      f.WorkspaceRuntime.open({ ...options, runtime: {} }),
      /RESUME_DEFINITION_UNVERIFIED/,
    );
    const recovered = await f.WorkspaceRuntime.open({
      ...options,
      validateResume: async () => undefined,
    });
    await recovered.dispose();
    // No real app data/config/auth path was opened. A legacy-looking sentinel remains untouched.
    const sentinel = join(f.dataRoot, "old-sdk-sentinel");
    await writeFile(sentinel, "do not scan");
  } finally {
    await f.host.dispose();
  }
}

async function stopPreflightProbe() {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const f = await fixture({
    prepareInput: async (params) => {
      entered.resolve();
      await release.promise;
      return params.text;
    },
  });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "stop-preflight" });
    const draft = f.host.draft({
      ...a.address,
      expectedRevision: 0,
      content: { text: "retain", pastes: [], images: [] },
    }).draft;
    const input = {
      ...a.address,
      requestId: "preparing",
      text: "retain",
      draftRevision: draft.revision,
    };
    const sending = f.host.prompt(input);
    const rejected = assert.rejects(sending, /PROMPT_STOPPED/);
    await entered.promise;
    const queued = f.host.prompt({ ...input, requestId: "queued-before-stop" });
    const rejectedQueued = assert.rejects(queued, /PROMPT_STOPPED/);
    await f.host.abort(a.address);
    release.resolve();
    await rejected;
    await rejectedQueued;
    assert.equal(f.host.drafts.read(a.address).text, "retain");
    assert.equal((await f.host.getReceipt(input)).state, "unknown");
    assert.equal(f.provider().state.callCount, 0);
    const before = (await f.host.getSnapshot(a.address)).snapshotSeq;
    assert((await f.host.getSnapshot(a.address)).snapshotSeq > before);
    const opening = f.host.open({ cwd: f.cwd, openId: "cancelled" });
    f.host.cancelOpen({ openId: "cancelled" });
    await assert.rejects(opening, /Opening cancelled/);
    assert.equal(
      f.host.getOpenState({ openId: "cancelled" }).state,
      "cancelled",
    );
  } finally {
    release.resolve();
    await f.host.dispose();
  }
}

async function configLoaderProbe() {
  const root = process.env.PIG_P0_ROOT;
  assert(root);
  await mkdir(join(root, "explicit-config"), { recursive: true });
  const file = join(root, "explicit-config", "config.ts");
  const f = await fixture({ configFile: file });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "config-loader" });
    await writeFile(
      file,
      'export default { apiVersion: 2, runtime: { profiles: { main: { model: { provider: "fixture", modelId: "fake" }, extensions: [], tools: [] } }, defaultProfile: "main" }, sessionAdapters: [{ id: "loaded", connect(ctx) { ctx.views.set({ id: "loaded", title: "Loaded", kind: "status", source: { label: "native", scope: { kind: "session", id: ctx.session.id }, freshness: "live" }, text: "Loaded", tone: "info" }); } }] };',
    );
    const applied = await f.host.reload();
    assert.equal(
      applied.state,
      "applied",
      applied.reason ?? "Config should apply",
    );
    await until(async () =>
      Boolean((await f.host.getSnapshot(a.address)).sessionUI?.views.length),
    );
    const good = (await f.host.getSnapshot(a.address)).sessionUI;
    assert(good);
    const models = f.workspace.models,
      registry = f.workspace.registry;
    await writeFile(file, "export default { apiVersion: 1 };");
    assert.equal((await f.host.reload()).state, "failed");
    assert.equal(
      (await f.host.getSnapshot(a.address)).sessionUI?.generation,
      good.generation,
    );
    assert.equal(f.workspace.models, models);
    assert.equal(f.workspace.registry, registry);
    await writeFile(file, "export default { broken syntax");
    assert.equal((await f.host.reload()).state, "failed");
    assert.equal(
      (await f.host.getSnapshot(a.address)).sessionUI?.generation,
      good.generation,
    );
  } finally {
    await f.host.dispose();
  }
}

async function shutdownFailureProbe() {
  let disposed = 0;
  const f = await fixture({
    attachUI: () => ({
      dispose: () => {
        disposed++;
        throw new Error("fixture UI cleanup failed");
      },
    }),
    emit: (event) => {
      if (event.type === "closed") throw new Error("fixture transport gone");
    },
  });
  try {
    await f.host.open({ cwd: f.cwd, openId: "exit-a" });
    await f.host.open({ cwd: f.other, openId: "exit-b" });
    const other = await f.host.workspace(f.other);
    await assert.rejects(f.host.dispose(), /Durable host shutdown failed/);
    assert.equal(disposed, 2);
    assert.equal((await f.workspace.harness.closed).kind, "closed");
    assert.equal((await other.harness.closed).kind, "closed");
    assert.equal(f.host.runtimeState().sessions.length, 0);
    const restarted = new f.DurableHost({
      ...f.options,
      attachUI: undefined,
      emit: () => {},
    });
    try {
      assert.equal((await restarted.list(f.cwd)).length, 1);
    } finally {
      await restarted.dispose();
    }
  } finally {
    await Promise.allSettled([f.host.dispose()]);
  }
}

if (import.meta.main) {
  const mode = process.argv[2];
  const probes: Record<string, () => Promise<void>> = {
    workspace: workspaceProbe,
    lifecycle: lifecycleProbe,
    send: sendProbe,
    fork: forkProbe,
    source: sourceProbe,
    reload: reloadProbe,
    action: actionProbe,
    failure: failureProbe,
    "stop-preflight": stopPreflightProbe,
    "config-loader": configLoaderProbe,
    "shutdown-failure": shutdownFailureProbe,
  };
  const probe = probes[mode];
  assert(probe, `Unknown fixture ${mode}`);
  await probe();
  console.log(`PASS ${mode}`);
}
