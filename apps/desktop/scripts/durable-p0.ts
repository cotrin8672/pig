/**
 * Isolated feasibility probe, NOT the desktop runtime. Run under mise exec -- rtk proxy bun.
 * The pinned pnpm lifecycle patch is removable only when wait-race/resources pass unpatched.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationId, SubmissionId } from "@earendil-works/pi-durable";

export function isolatedP0Env(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  // No inherited provider keys, credential commands or user config paths.
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "PI_SCRATCH_DIR",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return {
    ...env,
    HOME: root,
    USERPROFILE: root,
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "localappdata"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    TEMP: root,
    TMP: root,
    PIG_P0_ROOT: root,
  };
}

export function spawnP0(mode: string, root: string) {
  // The outer command already ran under mise. Re-entering mise with a temporary HOME
  // would read global tool config and potentially install tools instead of running this Bun.
  const rtk = Bun.which("rtk");
  assert(rtk, "Run the probe under mise exec -- rtk proxy bun");
  return Bun.spawn([rtk, "proxy", process.execPath, import.meta.path, mode], {
    cwd: root,
    env: isolatedP0Env(root),
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function runP0Child(mode: string, root: string) {
  const child = spawnP0(mode, root);
  const timeout = setTimeout(() => child.kill(), 25_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}

async function fixture() {
  const [{ BACKGROUND_CONTEXT: context }, ai, durable, { openDurableStorage }] =
    await Promise.all([
      import("@earendil-works/chord/context"),
      import("@earendil-works/pi-ai"),
      import("@earendil-works/pi-durable"),
      import("../src/bun/durable-storage"),
    ]);
  const root = process.env.PIG_P0_ROOT;
  assert(
    root && process.env.HOME === root && process.env.USERPROFILE === root,
    "isolated HOME required",
  );
  const faux = ai.fauxProvider({ tokensPerSecond: Infinity });
  const models = ai.createModels();
  models.setProvider(faux.provider);
  const registry = durable.createRegistry();
  const model = {
    provider: faux.getModel().provider,
    modelId: faux.getModel().id,
  };
  const storage = await openDurableStorage({
    dataRoot: root,
    workspaceId: "probe",
  });
  // Definitions are installed before open: open itself reconciles running tasks.
  const options = {
    models,
    registry,
    settings: { extensions: [] },
    env: () => undefined,
  };
  return {
    root,
    context,
    ai,
    durable,
    faux,
    models,
    registry,
    model,
    storage,
    options,
    openDurableStorage,
  };
}

async function harnessProbe() {
  const f = await fixture();
  const { context: ctx, durable: d } = f;
  const Note = d.defineDoc({
    kind: "pig.p0.note",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ value: "empty" }),
    checkpointWhen: () => true,
  });
  let toolCalls = 0;
  const tool = d.defineTool({
    name: "p0_read_constant",
    description: "Return an in-memory constant",
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      toolCalls++;
      return { output: [{ type: "text", text: "constant" }] };
    },
  });
  const Task = d.defineTask<null, { phase: "run" }, string>({
    name: "pig.p0.task",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, context) => {
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: "native task" },
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
  f.registry.install(d.defineExtension({ name: "p0_tasks", tasks: [Task] }));
  const selected = d.defineExtension({
    name: "p0_selected",
    tools: [tool],
    sections: [
      d.section(
        "p0_note",
        async (input, context) =>
          (await input.read.snapshot(Note, input.conversationId, context))
            ?.value,
      ),
    ],
  });
  const unselected = d.defineExtension({
    name: "p0_unselected",
    tools: [d.defineTool({ ...tool, name: "p0_forbidden" })],
  });
  f.registry.install(selected);
  f.registry.install(unselected);
  const harness = await d.Harness.open(f.storage, f.options, ctx);
  let conversationId: ConversationId | undefined;
  let submissionId: SubmissionId | undefined;
  try {
    const c = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: f.model, extensions: [selected], tools: [tool] },
      },
      ctx,
    );
    const other = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: f.model, extensions: [], tools: [] },
      },
      ctx,
    );
    conversationId = c.id;
    assert.equal(typeof c.id, "number");
    assert.deepEqual(
      (await c.agent(ctx)).tools.map((item) => item.name),
      [tool.name],
    );
    assert.deepEqual((await other.agent(ctx)).tools, []);
    await c.configure({ model: f.model, thinkingLevel: "off" }, ctx);
    await c.commit(async (tx) => {
      (await tx.doc(Note, c.id)).value = "only selected conversation";
    }, ctx);
    assert.equal(await harness.snapshot(Note, other.id, ctx), undefined);
    const taskId = await c.commit(
      (tx) =>
        tx.createTask(Task, null, { ownership: { kind: "conversation" } }),
      ctx,
    );
    assert.equal(
      (await harness.waitForTask(taskId, ctx)).state.outcome.result,
      "native task",
    );
    f.faux.setResponses([
      f.ai.fauxAssistantMessage([f.ai.fauxToolCall(tool.name, {})], {
        stopReason: "toolUse",
      }),
      f.ai.fauxAssistantMessage("done"),
    ]);
    const watch = await c.watch(ctx, { min: 1, max: 2 });
    let updates = 0;
    watch.start(async (call) => {
      if (call.kind === "value") updates++;
    });
    const draft = {
      type: "input" as const,
      content: "hello",
      requestId: "request-1",
      whenBusy: "followUp" as const,
    };
    const submission = await c.submit(draft, ctx);
    submissionId = submission.id;
    assert.equal((await c.submit(draft, ctx)).id, submission.id);
    assert.equal((await submission.wait(ctx)).status, "done");
    await c.waitForIdle(ctx);
    assert.equal(toolCalls, 1);
    assert(updates > 0);
    await watch.stop();
    // Several display-only writes while detached produce a bounded reconnect with a real gap.
    for (let i = 0; i < 5; i++)
      await c.submit(
        { type: "write", entry: { kind: "pig.p0.display", data: { i } } },
        ctx,
      );
    const reconnect = await c.watch(ctx, { min: 1, max: 2 });
    assert.equal(reconnect.value.entries.length, 1);
    assert(reconnect.value.before !== undefined);
    assert(
      (await c.entries({}, 100, undefined, ctx)).items.length >
        reconnect.value.entries.length,
    );
    await reconnect.stop();
    // Upstream only compares request type, NOT payload: a host fingerprint gate is still required.
    assert.equal(
      (await c.submit({ ...draft, content: "different payload" }, ctx)).id,
      submission.id,
    );
    assert.equal(f.ai.createModels().getProviders().length, 0);
    assert.equal(d.createRegistry().snapshot().installed().length, 0);
  } finally {
    await harness.close(ctx);
  }
  assert(conversationId && submissionId);
  const reopenedStorage = await f.openDurableStorage({
    dataRoot: f.root,
    workspaceId: "probe",
  });
  const reopened = await d.Harness.open(reopenedStorage, f.options, ctx);
  try {
    const c = await reopened.conversation(conversationId, ctx);
    assert(c);
    assert.equal(
      (await reopened.submission(submissionId, ctx))?.id,
      submissionId,
    );
    assert.equal(
      (await reopened.snapshot(Note, c.id, ctx))?.value,
      "only selected conversation",
    );
    assert.deepEqual(
      (await c.agent(ctx)).tools.map((item) => item.name),
      [tool.name],
    );
  } finally {
    await reopened.close(ctx);
  }
  console.log(
    "PASS harness admission/selection/docs/watch/reopen; payload mismatch requires host validation",
  );
}

async function waitRaceProbe() {
  const f = await fixture();
  const { context: ctx, durable: d } = f;
  const cleaned: string[] = [];
  const stopCleanup = f.ai.registerSessionResourceCleanup((id) => {
    if (id) cleaned.push(id);
  });
  const harness = await d.Harness.open(f.storage, f.options, ctx);
  const c = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { model: f.model, extensions: [], tools: [] },
    },
    ctx,
  );
  const entered = Promise.withResolvers<void>();
  f.faux.setResponses([
    async (_context, options) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return f.ai.fauxAssistantMessage("aborted", { stopReason: "aborted" });
    },
  ]);
  const submission = await c.submit(
    { type: "input", content: "hold", requestId: "race", whenBusy: "followUp" },
    ctx,
  );
  await entered.promise;
  const providerSession = (await harness.snapshot(d.ProviderDoc, c.id, ctx))
    ?.sessionId;
  const committing = Promise.withResolvers<void>();
  const failCommit = Promise.withResolvers<void>();
  const original = f.storage.commit.bind(f.storage);
  let armed = true;
  f.storage.commit = async (...args) => {
    if (!armed) return original(...args);
    armed = false;
    committing.resolve();
    await failCommit.promise;
    throw new Error("P0 injected commit failure");
  };
  const failed = c
    .configure({ instructions: "trigger failing commit" }, ctx)
    .then(
      () => false,
      () => true,
    );
  await committing.promise;
  // Session runs later reads speculatively, but delivers them behind the failed commit fence.
  const waiting = submission.wait(ctx).then(
    () => false,
    () => true,
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  failCommit.resolve();
  assert(await failed);
  assert(await waiting);
  await harness.close(ctx).catch(() => undefined); // the injected storage failure is expected
  await new Promise((resolve) => setTimeout(resolve, 50)); // allow the orphan inner rejection to surface
  stopCleanup();
  assert(
    providerSession && cleaned.includes(providerSession),
    "failed Harness also cleans its provider resource",
  );
  console.log(
    "PASS #11820 failed-commit/wait race (no global unhandled-rejection handler)",
  );
}

async function resourceProbe() {
  const f = await fixture();
  const released: string[] = [];
  const requested = new Set<string>();
  const stop = f.ai.registerSessionResourceCleanup((sessionId) => {
    if (sessionId) released.push(sessionId);
  });
  const harness = await f.durable.Harness.open(f.storage, f.options, f.context);
  const otherFaux = f.ai.fauxProvider({
    provider: "p0_other",
    tokensPerSecond: Infinity,
  });
  const otherModels = f.ai.createModels();
  otherModels.setProvider(otherFaux.provider);
  const otherStorage = await f.openDurableStorage({
    dataRoot: f.root,
    workspaceId: "other",
  });
  const otherHarness = await f.durable.Harness.open(
    otherStorage,
    {
      ...f.options,
      models: () => otherModels,
      registry: f.durable.createRegistry(),
    },
    f.context,
  );
  let otherSession: string | undefined;
  try {
    for (let i = 0; i < 2; i++) {
      f.faux.setResponses([
        (_context, options) => {
          assert(options?.sessionId);
          requested.add(options.sessionId);
          return f.ai.fauxAssistantMessage("resource acquired");
        },
      ]);
      const c = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { model: f.model, extensions: [], tools: [] },
        },
        f.context,
      );
      const s = await c.submit(
        { type: "input", content: "resource", whenBusy: "followUp" },
        f.context,
      );
      await s.wait(f.context);
      await c.waitForIdle(f.context);
    }
    otherFaux.setResponses([
      (_context, options) => {
        otherSession = options?.sessionId;
        return f.ai.fauxAssistantMessage("other workspace resource");
      },
    ]);
    const otherModel = otherFaux.getModel();
    const other = await otherHarness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: otherModel.provider, modelId: otherModel.id },
          extensions: [],
          tools: [],
        },
      },
      f.context,
    );
    await (
      await other.submit(
        { type: "input", content: "other resource", whenBusy: "followUp" },
        f.context,
      )
    ).wait(f.context);
    await other.waitForIdle(f.context);
    await harness.close(f.context);
    assert.equal(requested.size, 2);
    assert.deepEqual(
      new Set(released),
      requested,
      "#11676 Harness.close must release each used provider session",
    );
    assert.equal(released.length, 2, "cleanup must be per-session and once");
    assert(
      otherSession && !released.includes(otherSession),
      "closing one workspace must not clean another",
    );
    await harness.close(f.context);
    assert.equal(released.length, 2, "repeated close is idempotent");
    await otherHarness.close(f.context);
    assert.equal(released.length, 3);
    assert(released.includes(otherSession));
  } finally {
    await harness.close(f.context);
    await otherHarness.close(f.context);
    stop();
  }
  // A throwing cleanup callback is reported, and cannot strand the writer lock or other cleanup.
  const failingStorage = await f.openDurableStorage({
    dataRoot: f.root,
    workspaceId: "cleanup-error",
  });
  const reports: unknown[] = [];
  const failing = await f.durable.Harness.open(
    failingStorage,
    {
      ...f.options,
      onReport: (report) => {
        reports.push(report.error);
      },
    },
    f.context,
  );
  const removeThrow = f.ai.registerSessionResourceCleanup(() => {
    throw new Error("P0 cleanup callback failure");
  });
  try {
    f.faux.setResponses([f.ai.fauxAssistantMessage("cleanup test")]);
    const c = await failing.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: f.model, extensions: [], tools: [] },
      },
      f.context,
    );
    await (
      await c.submit(
        { type: "input", content: "cleanup", whenBusy: "followUp" },
        f.context,
      )
    ).wait(f.context);
    await c.waitForIdle(f.context);
  } finally {
    await failing.close(f.context);
    removeThrow();
  }
  assert.equal(reports.length, 1);
  assert(reports[0] instanceof AggregateError);
  const reopened = await f.openDurableStorage({
    dataRoot: f.root,
    workspaceId: "cleanup-error",
  });
  await reopened.close(f.context);
  console.log("PASS #11676 provider session cleanup lifecycle");
}

async function recoveryProbe(mode: string) {
  const f = await fixture();
  const safe = mode.includes("-safe-");
  const resume = mode.endsWith("-resume");
  let calls = 0;
  const tool = f.durable.defineTool({
    name: "p0_constant",
    description: "Pure in-memory constant query; no shell or external effects",
    ...(safe ? { replay: "safe" as const } : {}),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async (_args, _api, context) => {
      calls++;
      if (!resume) {
        // Test-only readiness instrumentation, not a tool side effect to be replayed.
        console.log(`P0_TOOL_READY:${process.pid}`);
        await new Promise<void>((resolve) =>
          context.abortSignal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      }
      return {
        output: [{ type: "text" as const, text: "constant" }],
        control: { terminate: true },
      };
    },
  });
  const extension = f.durable.defineExtension({
    name: "p0_recovery",
    tools: [tool],
  });
  f.registry.install(extension); // BEFORE Harness.open, including recovery reconciliation.
  f.faux.setResponses([
    resume
      ? f.ai.fauxAssistantMessage("recovered")
      : f.ai.fauxAssistantMessage([f.ai.fauxToolCall(tool.name, {})], {
          stopReason: "toolUse",
        }),
  ]);
  // Read only this fixture's temp storage BEFORE open's recovery writes/scheduler entrypoints.
  const tasks = await f.storage.scanTasks({}, 100, undefined, f.context);
  assert.equal(
    tasks.next,
    undefined,
    "fixture preflight must not skip a task page",
  );
  for (const task of tasks.items) {
    if (task.state.status === "terminal") continue;
    const definition = f.registry.snapshot().task(task.kind);
    assert(definition, `missing recovery task definition: ${task.kind}`);
    assert.equal(definition.definition.version, task.version);
  }
  const harness = await f.durable.Harness.open(f.storage, f.options, f.context);
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    if (!resume) {
      const c = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { model: f.model, extensions: [extension], tools: [tool] },
        },
        f.context,
      );
      await writeFile(join(f.root, "recovery-id.json"), JSON.stringify(c.id));
      await c.submit(
        {
          type: "input",
          content: "query constant",
          requestId: "recovery",
          whenBusy: "followUp",
        },
        f.context,
      );
      await c.waitForIdle(f.context);
      throw new Error("expected test controller to kill the process mid-tool");
    }
    const id = JSON.parse(
      await readFile(join(f.root, "recovery-id.json"), "utf8"),
    ) as ConversationId;
    const c = await harness.conversation(id, f.context);
    assert(c);
    await c.waitForIdle(f.context); // This call starts scheduling; definitions were checked above.
    assert.equal(
      calls,
      safe ? 1 : 0,
      "only the explicitly replay-safe constant query may rerun",
    );
    const entries = await c.entries({}, 100, undefined, f.context);
    assert(
      JSON.stringify(entries.items).includes(safe ? "constant" : "interrupted"),
    );
    console.log(
      `PASS ${safe ? "safe replay" : "unsafe interruption (not replayed)"} after process kill`,
    );
  } finally {
    clearInterval(keepAlive);
    await harness.close(f.context);
  }
}

export async function runCrashRecovery(root: string, kind: "safe" | "unsafe") {
  const child = spawnP0(`recovery-${kind}-start`, root);
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const timeout = setTimeout(() => child.kill(), 15_000);
  let pid: number | undefined;
  try {
    let output = "";
    const decoder = new TextDecoder();
    while (!pid) {
      const chunk = await reader.read();
      if (chunk.done)
        throw new Error(`tool child exited before readiness: ${await stderr}`);
      output += decoder.decode(chunk.value, { stream: true });
      const ready = /P0_TOOL_READY:(\d+)/.exec(output);
      if (ready) pid = Number(ready[1]);
    }
    process.kill(pid, "SIGKILL");
    pid = undefined;
    await child.exited;
    assert.equal(await stderr, "");
    return await runP0Child(`recovery-${kind}-resume`, root);
  } finally {
    clearTimeout(timeout);
    if (pid) process.kill(pid, "SIGKILL");
    child.kill();
    await child.exited;
    reader.releaseLock();
  }
}

async function writerProbe(mode: string) {
  const root = process.env.PIG_P0_ROOT;
  assert(root && process.env.HOME === root);
  const [{ openDurableStorage }, { BACKGROUND_CONTEXT: ctx }] =
    await Promise.all([
      import("../src/bun/durable-storage"),
      import("@earendil-works/chord/context"),
    ]);
  const storage = await openDurableStorage({
    dataRoot: root,
    workspaceId: "writer",
  });
  if (mode === "writer-hold") {
    await writeFile(join(root, "writer-ready"), String(process.pid));
    await new Promise(() => setInterval(() => undefined, 1_000));
  } else if (mode === "writer-crash") {
    await writeFile(join(root, "writer-ready"), "crashed");
    process.exit(73); // intentional hard exit, without Storage.close
  } else {
    await storage.close(ctx);
    console.log("PASS writer opened/closed");
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "harness") return harnessProbe();
  if (mode === "wait-race") return waitRaceProbe();
  if (mode === "resources") return resourceProbe();
  if (mode?.startsWith("recovery-")) return recoveryProbe(mode);
  if (mode?.startsWith("writer-")) return writerProbe(mode);
  assert.equal(mode, undefined, "unknown probe mode");
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-durable-p0-"),
  );
  let failures = 0;
  try {
    for (const childMode of ["harness", "wait-race", "resources"]) {
      const home = join(root, childMode);
      await mkdir(home);
      const result = await runP0Child(childMode, home);
      console.log(JSON.stringify({ probe: childMode, ...result }));
      if (result.exitCode !== 0) failures++;
    }
    for (const kind of ["safe", "unsafe"] as const) {
      const home = join(root, kind);
      await mkdir(home);
      const result = await runCrashRecovery(home, kind);
      console.log(JSON.stringify({ probe: `recovery-${kind}`, ...result }));
      if (result.exitCode !== 0) failures++;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log(
    "NOT full P0: packaged Bun/assets, auth policy, child dedup and fork/deletion semantics remain gates.",
  );
  process.exitCode = failures ? 1 : 0;
}

if (import.meta.main) {
  await main();
}
