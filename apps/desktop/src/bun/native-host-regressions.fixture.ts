import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PigConfig } from "../../../../packages/config/src";
import { isolatedP0Env } from "../../scripts/durable-p0";
import type { Snapshot } from "../shared/rpc-schema";
import { runCommand } from "./command-executor";
import type { DurableHostOptions } from "./durable-host";

/** No native value imports before the RTK subprocess has its temporary HOME. */
export async function runNativeHostRegression(mode: string): Promise<void> {
  assert(process.env.PI_SCRATCH_DIR, "PI_SCRATCH_DIR required");
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR, "pig-native-regression-"),
  );
  try {
    const result = await runCommand(
      process.execPath,
      [import.meta.path, mode],
      {
        cwd: root,
        env: { ...isolatedP0Env(root), PI_OFFLINE: "1" },
        timeout: 25_000,
      },
    );
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert(result.stdout.includes(`PASS ${mode}`), result.stdout);
    assert(!result.stderr.includes("Unhandled"), result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fixture(overrides: Partial<DurableHostOptions> = {}) {
  const root = process.env.PIG_P0_ROOT;
  assert(root && process.env.HOME === root && process.env.USERPROFILE === root);
  const [ai, { BACKGROUND_CONTEXT: ctx }, { DurableHost }] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/chord/context"),
    import("./durable-host"),
  ]);
  globalThis.fetch = Object.assign(
    () => {
      throw new Error("Unexpected regression fixture network");
    },
    { preconnect: fetch.preconnect },
  ) as typeof fetch;
  const cwd = join(root, "project-a"),
    other = join(root, "project-b");
  await Promise.all([mkdir(cwd), mkdir(other)]);
  const config: PigConfig = {
    apiVersion: 2,
    runtime: {
      defaultProfile: "main",
      profiles: {
        main: {
          model: { provider: "fixture", modelId: "a" },
          thinkingLevel: "off",
          extensions: [],
          tools: [],
        },
      },
    },
  };
  const providers = new Map<string, ReturnType<typeof ai.fauxProvider>>();
  const options: DurableHostOptions = {
    dataRoot: join(root, "data"),
    config,
    createModels: async (identity) => {
      const faux = ai.fauxProvider({
        provider: "fixture",
        models: [
          { id: "a", reasoning: true },
          { id: "b", reasoning: true },
        ],
        tokensPerSecond: Infinity,
      });
      const models = ai.createModels();
      models.setProvider(faux.provider);
      providers.set(identity.key, faux);
      return models;
    },
    settings: { retry: { enabled: false }, compaction: { enabled: false } },
    checkCompatibility: async () => undefined,
    emit() {},
    emitUI() {},
    ...overrides,
  };
  const host = new DurableHost(options);
  const workspace = await host.workspace(cwd);
  const provider = providers.get(workspace.identity.key);
  assert(provider);
  return {
    cwd,
    other,
    ai,
    ctx,
    host,
    workspace,
    provider,
    options,
    DurableHost,
  };
}

function selectedB(snapshot: Snapshot) {
  assert.equal(snapshot.model?.id, "b");
  assert.equal(snapshot.effort, "high");
}

async function models() {
  let hidden: readonly string[] = ["fixture/a"];
  const f = await fixture({ disabled: () => hidden });
  let restarted: InstanceType<typeof f.DurableHost> | undefined;
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "first" });
    const draft = f.host.draft({
      ...a.address,
      expectedRevision: 0,
      content: { text: "retain hidden-model input", images: [], pastes: [] },
    }).draft;
    const input = {
      ...a.address,
      requestId: "hidden",
      text: draft.text,
      draftRevision: draft.revision,
    };
    await assert.rejects(
      f.host.setModel({ ...a.address, provider: "fixture", id: "a" }),
      /hidden/,
    );
    await assert.rejects(async () => f.host.prompt(input), /available model/);
    assert.deepEqual(f.host.drafts.read(a.address), draft);
    assert.equal((await f.host.getReceipt(input)).state, "unknown");
    assert.equal(f.provider.state.callCount, 0);
    await f.host.setModel({ ...a.address, provider: "fixture", id: "b" });
    await f.host.setEffort({ ...a.address, effort: "high" });
    f.provider.setResponses([f.ai.fauxAssistantMessage("Selected B")]);
    await f.host.prompt({ ...input, requestId: "selected-b" });
    const conversation = await f.workspace.conversation(a.info.id);
    await conversation.waitForIdle(f.ctx);
    const saved = await f.host.getSnapshot(a.address);
    const answer = saved.transcript.records.find(
      (r) => r.kind === "message" && r.message.role === "assistant",
    );
    assert(answer?.entryId);
    // No setModel after fork: that used to mask the selection restoration bug.
    const fork = await f.host.fork({ ...a.address, entryId: answer.entryId });
    selectedB(fork);
    selectedB(await f.host.getSnapshot(a.address)); // Native forks retain the original.
    await f.host.close(fork.address);
    selectedB(
      await f.host.open({
        cwd: f.cwd,
        id: fork.info.id,
        openId: "fork-reopen",
      }),
    );
    const empty = await f.host.open({ cwd: f.cwd, openId: "metadata-only" });
    await f.host.setModel({ ...empty.address, provider: "fixture", id: "b" });
    await f.host.setEffort({ ...empty.address, effort: "high" });
    await f.host.rename(empty.info, "Metadata only B");
    assert.equal(
      (await f.workspace.entries(await f.workspace.conversation(empty.info.id)))
        .length,
      0,
    );
    await f.host.close(empty.address);
    const metadata = await f.host.open({
      cwd: f.cwd,
      id: empty.info.id,
      openId: "metadata-reopen",
    });
    selectedB(metadata);
    assert.equal(metadata.info.title, "Metadata only B");
    assert.equal(
      metadata.transcript.records.filter((r) => r.kind === "message").length,
      0,
    );
    await f.host.dispose();
    hidden = [];
    restarted = new f.DurableHost(f.options);
    selectedB(
      await restarted.open({
        cwd: f.cwd,
        id: fork.info.id,
        openId: "fork-restart",
      }),
    );
    const restored = await restarted.open({
      cwd: f.cwd,
      id: empty.info.id,
      openId: "metadata-restart",
    });
    selectedB(restored);
    assert.equal(restored.info.title, "Metadata only B");
    assert.equal(
      restored.transcript.records.filter((r) => r.kind === "message").length,
      0,
    );
  } finally {
    await f.host.dispose();
    await restarted?.dispose();
  }
}

async function transitions() {
  let entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let fail = true;
  const f = await fixture({
    checkCompatibility: async () => {
      entered.resolve();
      await release.promise;
      if (fail) throw new Error("fixture candidate rejected");
      return undefined;
    },
  });
  try {
    const a = await f.host.open({ cwd: f.cwd, openId: "transition" });
    const draft = f.host.draft({
      ...a.address,
      expectedRevision: 0,
      content: { text: "never lose this", images: [], pastes: [] },
    }).draft;
    const input = {
      ...a.address,
      requestId: "during-transition",
      text: draft.text,
      draftRevision: draft.revision,
    };
    assert(f.options.config?.runtime?.profiles?.main);
    const profile = f.options.config.runtime.profiles.main;
    for (const rejected of [true, false]) {
      fail = rejected;
      entered = Promise.withResolvers<void>();
      release = Promise.withResolvers<void>();
      const pending = f.host.reload({
        ...f.options.config,
        apiVersion: 2,
        runtime: {
          ...f.options.config.runtime,
          profiles: {
            main: {
              ...profile,
              instructions: rejected ? "reject candidate" : "accept candidate",
            },
          },
        },
      });
      await Promise.race([
        entered.promise,
        pending.then((result) => {
          throw new Error(
            `Transition ended before gate: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      await assert.rejects(
        async () => f.host.prompt(input),
        /CONFIG_TRANSITION_BUSY/,
      );
      assert.throws(
        () =>
          f.host.draft({
            ...a.address,
            expectedRevision: draft.revision,
            content: { text: "blocked", images: [], pastes: [] },
          }),
        /CONFIG_TRANSITION_BUSY/,
      );
      await assert.rejects(
        f.host.setModel({ ...a.address, provider: "fixture", id: "b" }),
        /CONFIG_TRANSITION_BUSY/,
      );
      await assert.rejects(
        f.host.setEffort({ ...a.address, effort: "high" }),
        /CONFIG_TRANSITION_BUSY/,
      );
      await assert.rejects(
        f.host.rename(a.info, "blocked"),
        /CONFIG_TRANSITION_BUSY/,
      );
      assert.equal((await f.host.getReceipt(input)).state, "unknown");
      assert.deepEqual(
        (await f.host.getSnapshot(a.address)).address,
        a.address,
      );
      assert.deepEqual(f.host.drafts.read(a.address), draft);
      assert.equal(f.provider.state.callCount, 0);
      release.resolve();
      const result = await pending;
      assert.equal(result.state, rejected ? "failed" : "applied");
      if (rejected)
        assert.match(result.reason ?? "", /fixture candidate rejected/);
      assert.deepEqual(f.host.drafts.read(a.address), draft);
      assert.deepEqual(
        (await f.host.getSnapshot(a.address)).address,
        a.address,
      );
    }
    // A native transition never tears down the conversation to rebuild an SDK session.
    await f.host.close(a.address);
    const reopened = await f.host.open({
      cwd: f.cwd,
      id: a.info.id,
      openId: "after-transition",
    });
    const retained = f.host.drafts.read(reopened.address);
    assert.deepEqual(retained, { ...draft, revision: draft.revision + 1 });
    await assert.rejects(
      f.host.setModel({ ...a.address, provider: "fixture", id: "b" }),
      /STALE_SESSION_ADDRESS/,
    );
  } finally {
    release.resolve();
    await f.host.dispose();
  }
}

async function deletion() {
  const f = await fixture();
  let restarted: InstanceType<typeof f.DurableHost> | undefined;
  try {
    // Preserve the user's empty-delete safety fix, not the obsolete JSONL unlink.
    const empty = await f.host.open({ cwd: f.cwd, openId: "empty-delete" });
    const renamed = await f.host.open({
      cwd: f.cwd,
      openId: "renamed-empty-delete",
    });
    await f.host.rename(renamed.info, "Empty renamed");
    const draft = f.host.draft({
      ...empty.address,
      expectedRevision: 0,
      content: { text: "original retained", images: [], pastes: [] },
    }).draft;
    const conversation = await f.workspace.conversation(empty.info.id);
    await conversation.configure({ cwd: f.other }, f.ctx);
    // Mutable agent.cwd cannot move immutable membership, even for an empty chat.
    for (const info of [empty.info, renamed.info]) {
      await assert.rejects(
        f.host.delete({ ...info, cwd: f.other }),
        /WORKSPACE_MISMATCH/,
      );
      await assert.rejects(
        f.host.delete(info),
        /NATIVE_PHYSICAL_DELETE_UNSUPPORTED/,
      );
      assert.equal(
        (
          await f.host.getSnapshot(
            info.id === empty.info.id ? empty.address : renamed.address,
          )
        ).info.id,
        info.id,
      );
      assert.equal(
        (await f.workspace.entries(await f.workspace.conversation(info.id)))
          .length,
        0,
      );
    }
    await assert.rejects(
      f.host.delete({
        cwd: f.cwd,
        id: `d2_${f.workspace.identity.key}_999999`,
      }),
      /CONVERSATION_NOT_FOUND/,
    );
    await assert.rejects(
      f.host.delete({ ...empty.info, id: "missing-id" }),
      /INVALID_NATIVE_SESSION_ID/,
    );
    assert.deepEqual(f.host.drafts.read(empty.address), draft);
    assert.deepEqual(
      (await f.host.list(f.cwd)).map((info) => info.id).sort(),
      [empty.info.id, renamed.info.id].sort(),
    );
    assert.equal((await f.host.list(f.other)).length, 0);
    await f.host.dispose();
    restarted = new f.DurableHost(f.options);
    const restored = await restarted.open({
      cwd: f.cwd,
      id: empty.info.id,
      openId: "original-survives",
    });
    assert.equal(restored.info.cwd, f.cwd);
    assert.equal(
      (await restarted.list(f.cwd)).find((info) => info.id === renamed.info.id)
        ?.title,
      "Empty renamed",
    );
    await assert.rejects(
      restarted.delete(restored.info),
      /NATIVE_PHYSICAL_DELETE_UNSUPPORTED/,
    );
    assert.equal((await restarted.list(f.cwd)).length, 2);
  } finally {
    await f.host.dispose();
    await restarted?.dispose();
  }
}

async function dialogs() {
  const { createNativeUIHost } = await import("./extension-ui");
  let now = 1;
  let native: ReturnType<typeof createNativeUIHost> | undefined;
  const f = await fixture({
    connectionNow: () => now,
    attachUI: ({ address, broker, drafts }) => {
      const ui = createNativeUIHost({ address, broker, drafts, emit() {} });
      native = ui;
      return {
        status: () => ui.getStatus(),
        disconnect: () => ui.cancelAll("disconnect"),
        dispose: () => ui.dispose(),
      };
    },
  });
  const release = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  let aborted = 0,
    guarded = 0;
  try {
    f.host.connect({ clientId: "root" });
    const a = await f.host.open({ cwd: f.cwd, openId: "ordinary-dialog" });
    assert(native);
    f.provider.setResponses([
      async (_context, options) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            aborted++;
          },
          { once: true },
        );
        entered.resolve();
        await release.promise;
        return f.ai.fauxAssistantMessage("Native run survives UI loss");
      },
    ]);
    await f.host.prompt({
      ...a.address,
      requestId: "running",
      text: "native only",
      draftRevision: 0,
    });
    await entered.promise;
    const draft = f.host.draft({
      ...a.address,
      expectedRevision: f.host.drafts.read(a.address).revision,
      content: { text: "unsent", images: [], pastes: [] },
    }).draft;
    const ordinary = native.ui
      .confirm("Native dialog", "Never grant on lease loss")
      .then((allow) => {
        if (allow) guarded++;
        return allow;
      });
    const old = f.host.broker.pending()[0];
    assert(old);
    now += 30_001;
    assert.equal(f.host.heartbeat({ clientId: "root" }).connected, false);
    assert.equal(await ordinary, false);
    assert.equal(guarded, 0);
    assert.equal(aborted, 0);
    assert.equal(f.host.broker.pending().length, 0);
    assert((await f.workspace.harness.inspect(f.ctx)).tasks.length > 0);
    assert.deepEqual(f.host.drafts.read(a.address), draft);
    assert.throws(
      () => f.host.resolveUI({ ...old, kind: "confirm", value: true }),
      /unknown|completed|stale/i,
    );
    f.host.connect({ clientId: "new-root" });
    const next = native.ui.input("Reconnected");
    const request = f.host.broker.pending()[0];
    assert(request);
    f.host.resolveUI({
      ...request,
      kind: "input",
      value: "native dialogs remain",
    });
    assert.equal(await next, "native dialogs remain");
    release.resolve();
    await f.workspace.harness.waitForIdle(f.ctx);
    assert.equal(
      (await f.host.getSnapshot(a.address)).transcript.running,
      false,
    );
    assert.equal(f.provider.state.callCount, 1);
  } finally {
    release.resolve();
    await f.host.dispose();
  }
}

if (import.meta.main) {
  const mode = process.argv[2];
  const probes = { models, transitions, deletion, dialogs };
  assert(mode && Object.hasOwn(probes, mode), "Unknown regression mode");
  await probes[mode as keyof typeof probes]();
  console.log(`PASS ${mode}`);
}
