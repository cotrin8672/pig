import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type {
  Conversation,
  ConversationId,
  SubmissionId,
  ToolTaskCheckpoint,
} from "@earendil-works/pi-durable";
import { isolatedP0Env } from "../../scripts/durable-p0";
import type { UIRequest } from "../shared/extension-ui";
import type { PromptReceipt, SendKey } from "../shared/runtime-contract";
import { runCommand } from "./command-executor";
import type { ApprovalRequest } from "./native-approvals";

// Parent imports only node helpers, the env allowlist and the RTK command boundary.
// In particular, no native value import may move above the isolated-child check.
type Scenario = "before-intent" | "unsafe-write";
type Confirm = Extract<UIRequest, { kind: "confirm" }>;
type Effect = {
  pid: number;
  simulated: true;
  program: string;
  args: readonly string[];
  cwd?: string;
};
type Checkpoint = {
  scenario: Scenario;
  pid: number;
  root: string;
  cwd: string;
  dataRoot: string;
  appId: string;
  conversationId: ConversationId;
  key: SendKey;
  receipt: PromptReceipt;
  submissionId: SubmissionId;
  userEntryId: number;
  ui: Confirm;
  intent: ApprovalRequest;
  checkpoint: ToolTaskCheckpoint;
  manifest: { signature?: string; opaque?: boolean };
  sqlitePath: string;
  network: number;
  invocations: number;
};

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
async function durableJson(path: string, value: unknown) {
  const file = await open(path, "w");
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function absent(path: string) {
  await assert.rejects(readFile(path), { code: "ENOENT" });
}
function scratchRoot() {
  const scratch = process.env.PI_SCRATCH_DIR;
  assert(scratch && isAbsolute(scratch), "absolute PI_SCRATCH_DIR required");
  return scratch;
}
function assertScratch(root: string) {
  assert(isAbsolute(root), "absolute fixture root required");
  const child = relative(scratchRoot(), root);
  assert(child && !child.startsWith("..") && !isAbsolute(child));
}

/** Two sequential RTK children, same HOME/data/cwd; cleanup only after both exit.
 * Failed evidence is retained under PI_SCRATCH_DIR for diagnosis. */
export async function runApplicationRecoveryFixture(scenario: Scenario) {
  const root = await mkdtemp(join(scratchRoot(), "pig-application-recovery-"));
  let passed = false;
  try {
    const run = async (phase: "crash" | "recover") => {
      const result = await runCommand(
        process.execPath,
        [import.meta.path, scenario, phase],
        { cwd: root, env: isolatedP0Env(root), timeout: 19_000 },
      );
      await durableJson(join(root, `${phase}-process.json`), result);
      return result;
    };
    const crash = await run("crash");
    assert.notEqual(crash.exitCode, 0, "checkpoint child must self-SIGKILL");
    const saved = await json<Checkpoint>(join(root, "checkpoint.json"));
    assert.equal(saved.scenario, scenario);
    assert.notEqual(saved.pid, process.pid);
    assert.equal(saved.root, root);
    assert.equal(saved.network, 0);
    assert.equal(saved.invocations, 0);
    assert.equal(saved.intent.state, "pending");
    assert.deepEqual(await json(join(root, "effects.json")), []);
    assert.equal(
      (await readFile(saved.sqlitePath)).subarray(0, 16).toString(),
      "SQLite format 3\0",
      "actual default durable SQLite storage, not MemoryStorage",
    );
    await absent(join(root, "project", "must-not-exist.txt"));
    const recovered = await run("recover");
    assert.equal(
      recovered.exitCode,
      0,
      `${scenario}\n${recovered.stdout}\n${recovered.stderr}\nArtifacts: ${root}`,
    );
    assert(recovered.stdout.includes(`PASS ${scenario}`), recovered.stdout);
    assert(!recovered.stderr.includes("Unhandled"), recovered.stderr);
    const effects = await json<Effect[]>(join(root, "effects.json"));
    assert.equal(effects.length, scenario === "before-intent" ? 1 : 0);
    assert(effects.every((effect) => effect.simulated));
    await absent(join(root, "project", "must-not-exist.txt"));
    passed = true;
  } finally {
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error(`Application recovery artifacts retained: ${root}`);
  }
}

async function until(
  check: () => boolean | Promise<boolean>,
  evidence: () => Promise<unknown>,
) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert(
      Date.now() < deadline,
      `recovery condition timed out: ${JSON.stringify(await evidence())}`,
    );
    await Bun.sleep(5);
  }
}

async function fixture(scenario: Scenario, phase: "crash" | "recover") {
  const root = process.env.PIG_P0_ROOT;
  assert(root && process.env.HOME === root && process.env.USERPROFILE === root);
  assertScratch(root);
  let network = 0;
  const denyNetwork = () => {
    network++;
    throw new Error("Application recovery fixture forbids network");
  };
  globalThis.fetch = Object.assign(denyNetwork, {
    preconnect: denyNetwork,
  }) as typeof fetch;
  const [
    ai,
    d,
    { BACKGROUND_CONTEXT: ctx },
    { createApplicationRuntime },
    { FileCredentials },
    { defaultSettings },
    { NativeApprovals },
    { BuiltinRuntimeManifest },
    { durableStoragePath },
  ] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
    import("./application-runtime"),
    import("./credentials"),
    import("../shared/settings"),
    import("./native-approvals"),
    import("./application-compatibility"),
    import("./durable-storage"),
  ]);
  const cwd = join(root, "project");
  const dataRoot = join(root, "data");
  const modelDirectory = join(root, "models");
  const target = join(cwd, "must-not-exist.txt");
  const effectsPath = join(root, "effects.json");
  await mkdir(cwd, { recursive: true });
  await mkdir(modelDirectory, { recursive: true });
  if (phase === "crash") await durableJson(effectsPath, []);
  const providers = new Map<string, ReturnType<typeof ai.fauxProvider>>();
  let modelCreations = 0;
  let invocations = 0;
  const app = createApplicationRuntime({
    dataRoot,
    modelDirectory,
    credentials: new FileCredentials(join(modelDirectory, "auth.json")),
    // Only default known builtins: no compatibility bypass, extension, or hook.
    config: { apiVersion: 2 },
    settings: () => ({
      ...defaultSettings,
      shell: "powershell",
      blockImages: true,
    }),
    emit: () => {},
    emitUI: () => {},
    defaultModel: { provider: "recovery-fixture", modelId: "fake" },
    harnessSettings: {
      retry: { enabled: false },
      compaction: { enabled: false },
    },
    createModels: async (identity) => {
      modelCreations++;
      const provider = ai.fauxProvider({
        provider: "recovery-fixture",
        models: [{ id: "fake" }],
        tokensPerSecond: Infinity,
      });
      provider.setResponses(
        phase === "crash"
          ? [
              ai.fauxAssistantMessage(
                [
                  scenario === "before-intent"
                    ? ai.fauxToolCall(
                        "powershell",
                        {
                          command:
                            "INJECTED FIXTURE ONLY - never a real command",
                        },
                        { id: "original-shell-call" },
                      )
                    : ai.fauxToolCall(
                        "write",
                        { path: target, content: "MUST NEVER BE WRITTEN" },
                        { id: "original-write-call" },
                      ),
                ],
                { stopReason: "toolUse" },
              ),
              ai.fauxAssistantMessage("original run complete"),
            ]
          : [ai.fauxAssistantMessage("recovered native run complete")],
      );
      const models = ai.createModels();
      models.setProvider(provider.provider);
      assert(
        !providers.has(identity.key),
        "fresh provider per workspace/process",
      );
      providers.set(identity.key, provider);
      return models;
    },
    execution: {
      shellProgram: "fixture-shell",
      which: (program) => program,
      // The ONLY shell runner; never invokes a shell, RTK, or a project command.
      runner: async (program, args, options = {}) => {
        invocations++;
        const effects = await json<Effect[]>(effectsPath);
        effects.push({
          pid: process.pid,
          simulated: true,
          program,
          args,
          cwd: options.cwd,
        });
        await durableJson(effectsPath, effects);
        options.onOutput?.("stdout", "simulated recovery effect\n");
        return {
          stdout: "simulated recovery effect\n",
          stderr: "",
          exitCode: 0,
        };
      },
    },
  });
  assert.equal(modelCreations, 0, "native workspaces remain lazy");
  // Authorize/register the immutable workspace before addressing a saved session.
  // This must pass the application's DEFAULT known-schema recovery gate.
  const workspace = await app.host.workspace(cwd);
  assert.equal(modelCreations, 1);
  const provider = providers.get(workspace.identity.key);
  assert(provider);
  const manifest = await workspace.harness.snapshot(
    BuiltinRuntimeManifest,
    ctx,
  );
  assert(
    manifest?.signature,
    "default manifest exists even before first admission",
  );
  assert.equal(manifest.opaque, false);
  return {
    root,
    cwd,
    dataRoot,
    target,
    effectsPath,
    app,
    workspace,
    provider,
    manifest,
    ai,
    d,
    ctx,
    NativeApprovals,
    durableStoragePath,
    network: () => network,
    invocations: () => invocations,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function admissions(f: Fixture, conversation: Conversation) {
  const page = await f.workspace.storageMetadata.scanSubmissions(
    { conversationId: conversation.id },
    2,
    undefined,
    f.ctx,
  );
  assert.equal(page.next, undefined);
  assert.equal(
    page.items.length,
    1,
    "one original admission; no automatic resend",
  );
  const submission = page.items[0];
  assert(submission && submission.type === "input");
  const users = (await f.workspace.entries(conversation)).filter(
    f.d.UserEntry.is,
  );
  assert.equal(users.length, 1, "one original user entry");
  const user = users[0];
  assert(user);
  return { submission, user };
}
async function intent(f: Fixture, conversation: Conversation) {
  const state = await f.workspace.harness.snapshot(
    f.NativeApprovals,
    conversation.id,
    f.ctx,
  );
  const requests = Object.values(state?.requests ?? {});
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert(request);
  return request;
}
async function confirm(f: Fixture): Promise<Confirm> {
  await until(
    () =>
      f.app.host.broker.pending().some((request) => request.kind === "confirm"),
    () => f.workspace.harness.inspect(f.ctx),
  );
  const request = f.app.host.broker
    .pending()
    .find((request) => request.kind === "confirm");
  assert(request);
  return request;
}
async function settled(f: Fixture, conversation: Conversation) {
  await until(
    async () => {
      const inspection = await f.workspace.harness.inspect(f.ctx);
      return (
        inspection.tasks.length === 0 && inspection.submissions.length === 0
      );
    },
    () => f.workspace.harness.inspect(f.ctx),
  );
  await conversation.waitForIdle(f.ctx);
}

async function crash(scenario: Scenario) {
  const f = await fixture(scenario, "crash");
  assert.equal(
    (
      await f.workspace.harness.commit(
        (tx) => tx.scanConversations({}, 1),
        f.ctx,
      )
    ).items.length,
    0,
  );
  await f.app.connect({ clientId: "crash-root" });
  const snapshot = await f.app.host.open({
    cwd: f.cwd,
    openId: "original-open",
  });
  const conversation = await f.workspace.conversation(snapshot.info.id);
  await f.app.ready(snapshot.address);
  const tools = (await conversation.agent(f.ctx)).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["read", "write", "edit", "powershell", "todos"],
  );
  assert(tools.every((tool) => tool.replay === "unsafe"));
  const key = { ...snapshot.address, requestId: "original-user-admission" };
  await f.app.host.prompt({
    ...key,
    text: "isolated crash fixture",
    draftRevision: 0,
  });
  const ui = await confirm(f);
  const pending = await intent(f, conversation);
  assert.equal(pending.state, "pending");
  assert.equal(pending.consumed, false);
  assert.equal(
    pending.stage,
    scenario === "before-intent" ? "before-intent" : "final-operation",
  );
  assert.equal(
    pending.toolName,
    scenario === "before-intent" ? "powershell" : "write",
  );
  assert.equal(
    pending.operationKind,
    scenario === "before-intent" ? "exec" : "file",
  );
  if (scenario === "unsafe-write")
    assert(pending.description.startsWith("write:"));
  const task = await f.workspace.harness.getTask(pending.taskId, f.ctx);
  assert(task && task.kind === f.d.ToolTask.definition.name);
  assert.equal(task.conversationId, conversation.id);
  assert.notEqual(task.state.status, "terminal");
  assert.equal(task.abortRequested, false);
  const checkpoint = task.state.checkpoint as ToolTaskCheckpoint;
  if (scenario === "before-intent")
    assert.deepEqual(checkpoint, { phase: "call" });
  else {
    assert.equal(checkpoint.phase, "execute");
    assert(checkpoint.phase === "execute" && checkpoint.replay === "unsafe");
    assert.equal(checkpoint.arguments.path, f.target);
  }
  const inspection = await f.workspace.harness.inspect(f.ctx);
  assert(inspection.tasks.some((item) => item.record.id === pending.taskId));
  const receipt = await f.app.host.getReceipt(key);
  assert.equal(receipt.state, "accepted");
  const { submission, user } = await admissions(f, conversation);
  assert.equal(submission.requestId, key.requestId);
  assert.equal(f.provider.state.callCount, 1);
  assert.equal(f.invocations(), 0);
  assert.equal(f.network(), 0);
  await absent(f.target);
  await durableJson(join(f.root, "checkpoint.json"), {
    scenario,
    pid: process.pid,
    root: f.root,
    cwd: f.cwd,
    dataRoot: f.dataRoot,
    appId: snapshot.info.id,
    conversationId: conversation.id,
    key,
    receipt,
    submissionId: submission.id,
    userEntryId: user.id,
    ui,
    intent: pending,
    checkpoint,
    manifest: f.manifest,
    sqlitePath: f.durableStoragePath({
      dataRoot: f.dataRoot,
      workspaceId: f.workspace.identity.key,
    }),
    network: f.network(),
    invocations: f.invocations(),
  } satisfies Checkpoint);
  // Deliberately no close/dispose/abort: only this isolated child kills ITSELF,
  // after the public native checkpoint and SQLite receipt have committed.
  process.kill(process.pid, "SIGKILL");
  throw new Error("self-SIGKILL unexpectedly returned");
}

async function recover(scenario: Scenario) {
  const root = process.env.PIG_P0_ROOT;
  assert(root);
  const saved = await json<Checkpoint>(join(root, "checkpoint.json"));
  const f = await fixture(scenario, "recover");
  try {
    assert.equal(saved.cwd, f.cwd);
    assert.equal(saved.dataRoot, f.dataRoot);
    assert.deepEqual(f.manifest, saved.manifest);
    assert.notEqual(process.pid, saved.pid);
    await f.app.connect({ clientId: "fresh-root" });
    const snapshot = await f.app.host.open({
      cwd: f.cwd,
      id: saved.appId,
      openId: "recovered-open",
    });
    await f.app.ready(snapshot.address);
    const conversation = await f.workspace.conversation(saved.appId);
    assert.equal(conversation.id, saved.conversationId);
    assert.notEqual(snapshot.address.hostId, saved.key.hostId);
    assert.deepEqual(
      (await f.app.host.getSnapshot(snapshot.address)).address,
      snapshot.address,
    );
    // Deliberately use OLD host/epoch and no new prompt, not a resent admission.
    assert.deepEqual(await f.app.host.getReceipt(saved.key), saved.receipt);
    assert.equal(f.invocations(), 0);
    await absent(f.target);
    await assert.rejects(
      f.app.resolveUI({ ...saved.ui, kind: "confirm", value: true }),
      /unknown|completed|stale|host/i,
    );
    let newUI: Confirm | undefined;
    let interrupted: unknown;
    if (scenario === "before-intent") {
      newUI = await confirm(f);
      assert.notEqual(
        newUI.uiId,
        saved.ui.uiId,
        "disposable projection rotates across processes",
      );
      assert.equal(newUI.hostId, snapshot.address.hostId);
      assert.deepEqual(await intent(f, conversation), saved.intent);
      const task = await f.workspace.harness.getTask(
        saved.intent.taskId,
        f.ctx,
      );
      assert(task);
      assert.deepEqual(task.state.checkpoint, { phase: "call" });
      // Give scheduling a turn: neither reopen nor stale UI is consent.
      await Bun.sleep(100);
      assert.equal(
        f.provider.state.callCount,
        0,
        "no automatic prompt/model resend",
      );
      assert.equal(f.invocations(), 0);
      assert.deepEqual(await json(f.effectsPath), []);
      await admissions(f, conversation);
      await f.app.resolveUI({ ...newUI, kind: "confirm", value: true });
      await settled(f, conversation);
      assert.equal(
        f.invocations(),
        1,
        "one injected invocation, NOT external exactly-once",
      );
      const effects = await json<Effect[]>(f.effectsPath);
      assert.equal(effects.length, 1);
      assert.equal(effects[0]?.pid, process.pid);
      assert(effects[0]?.args.includes("-Command"));
      assert.equal(
        f.provider.state.callCount,
        1,
        "only the native follow-on generation",
      );
    } else {
      await settled(f, conversation);
      const results = (await f.workspace.entries(conversation)).filter(
        f.d.ToolResultEntry.is,
      );
      assert.equal(results.length, 1);
      const result = results[0];
      assert(result);
      assert(
        result.data?.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "interrupted" &&
            diagnostic.severity === "error",
        ),
        JSON.stringify(result),
      );
      const message = result.model?.[0];
      assert(message?.role === "toolResult");
      assert.equal(message.toolCallId, saved.intent.callId);
      assert.equal(message.toolName, "write");
      assert.equal(message.isError, true);
      interrupted = result; // Positive persisted diagnostic, never a disappearance heuristic.
      await absent(f.target);
      await assert.rejects(
        f.app.resolveUI({ ...saved.ui, kind: "confirm", value: true }),
        /unknown|completed|stale|host/i,
      );
      await Bun.sleep(100);
      await absent(f.target);
      assert.equal(f.invocations(), 0);
      assert.deepEqual(await json(f.effectsPath), []);
    }
    const { submission, user } = await admissions(f, conversation);
    assert.equal(submission.id, saved.submissionId);
    assert.equal(submission.requestId, saved.key.requestId);
    assert.equal(user.id, saved.userEntryId);
    assert.deepEqual(await f.app.host.getReceipt(saved.key), saved.receipt);
    assert.equal(f.network(), 0);
    await durableJson(join(root, "recovery.json"), {
      scenario,
      pid: process.pid,
      originalPid: saved.pid,
      oldAddress: saved.key,
      address: snapshot.address,
      originalUI: saved.ui,
      newUI,
      interrupted,
      staleUIRejected: true,
      submission,
      userEntryId: user.id,
      receipt: await f.app.host.getReceipt(saved.key),
      manifest: f.manifest,
      effects: await json(f.effectsPath),
      invocations: f.invocations(),
      network: f.network(),
      inspection: await f.workspace.harness.inspect(f.ctx),
    });
  } finally {
    await f.app.dispose(); // Only the recovery child may close gracefully.
  }
  console.log(`PASS ${scenario}`);
}

if (import.meta.main) {
  // Bound even native readiness/disposal hangs; the parent timeout is a backstop.
  const watchdog = setTimeout(() => {
    console.error("application recovery child exceeded 16 seconds");
    process.exit(124);
  }, 16_000);
  try {
    const scenario = process.argv[2];
    const phase = process.argv[3];
    assert(scenario === "before-intent" || scenario === "unsafe-write");
    assert(phase === "crash" || phase === "recover");
    if (phase === "crash") await crash(scenario);
    else await recover(scenario);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    clearTimeout(watchdog);
  }
}
