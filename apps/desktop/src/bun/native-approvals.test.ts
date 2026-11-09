import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";
import type { SessionAddress } from "../shared/runtime-contract";
import { createNativeApprovals, NativeApprovals } from "./native-approvals";
import {
  createNativeToolPolicy,
  type NativeOperation,
  operationHash,
  type ToolIdentity,
  type ToolOwner,
} from "./native-tool-policy";
import { DesktopExecutionEnv } from "./shell-tools";
import { UIRequestBroker } from "./ui-request-broker";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("fixture condition timed out");
    await Bun.sleep(2);
  }
}
function requiredFirst<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Fixture request missing");
  return value;
}
// Public storage test double keeps persisted commits across Harness.close/open.
// It does not bypass native ToolTask recovery or edit task checkpoints.
class ReopenableMemory extends MemoryStorage {
  override async close() {}
}
async function fixture(
  mode:
    | "standard"
    | "changed"
    | "direct"
    | "effect"
    | "twice"
    | "detach-final"
    | "stop-final" = "standard",
  ttlMs = 5000,
  toolIntent = false,
) {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const cwd = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR, "native-approval-"),
  );
  const storage = new ReopenableMemory();
  const broker = new UIRequestBroker(() => {});
  broker.setAvailable(true);
  const provider = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels();
  models.setProvider(provider.provider);
  const model = {
    provider: provider.getModel().provider,
    modelId: provider.getModel().id,
  };
  let harness!: Harness;
  let approvals: ReturnType<typeof createNativeApprovals>;
  let spawns = 0;
  const plans: NativeOperation[] = [];
  let conversation: Conversation;
  let taskId: ToolOwner["taskId"] | undefined;
  const address: SessionAddress = {
    hostId: "fixture",
    sessionId: "native",
    epoch: 1,
  };
  const owner = async (identity: ToolIdentity): Promise<ToolOwner> => ({
    ...identity,
    profileId: "fixture",
    policyRevision: 1,
    readOnly: false,
    tools: ["bash", "direct"],
    roots: [cwd],
  });
  async function open() {
    const registry = createRegistry();
    const policy = createNativeToolPolicy({
      resolveOwner: owner,
      authorize: async (identity, operation, context) => {
        plans.push(operation);
        const lease = await approvals.authorize(identity, operation, context);
        if (mode === "detach-final") {
          await approvals.detach(identity.conversationId);
          broker.setAvailable(false);
        }
        if (mode === "stop-final")
          await approvals.cancel(identity.conversationId, ctx);
        return lease;
      },
    });
    const env = new DesktopExecutionEnv({
      cwd,
      shell: "git-bash",
      shellProgram: "fixture-shell",
      spillDirectory: cwd,
      policy,
      which: (name) => name,
      runner: async (_program, _args, options = {}) => {
        spawns++;
        options.onOutput?.("stdout", "live fixture\n");
        if (mode === "effect")
          await new Promise<void>((_resolve, reject) =>
            options.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("closed", "AbortError")),
              { once: true },
            ),
          );
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const tool: ToolRegistration =
      mode === "direct" || mode === "twice"
        ? defineTool({
            name: "direct",
            description: "Unknown native exec fixture",
            replay: "safe",
            parameters: { type: "object" },
            async execute(_args, api, context) {
              if (!api.env) throw new Error("Fixture environment missing");
              for (let i = 0; i < (mode === "twice" ? 2 : 1); i++) {
                const result = await api.env.exec(
                  ["fixture-shell", "effect"],
                  undefined,
                  context,
                );
                if (!result.ok) throw result.error;
              }
              return {};
            },
          })
        : createBashTool(
            mode === "changed"
              ? {
                  prepare: (execution) => {
                    execution.command = "changed final source";
                  },
                }
              : undefined,
          );
    approvals = createNativeApprovals({
      harness: () => harness,
      broker,
      ttlMs,
      resolveOwner: async (call, api) => {
        taskId = api.taskId;
        return owner({
          taskId: api.taskId,
          conversationId: api.conversationId,
          callId: call.id,
          toolName: call.name,
        });
      },
      planTool: async (call, identity) => {
        if (toolIntent) {
          return {
            kind: "tool",
            name: call.name,
            argumentsJson: JSON.stringify(call.arguments),
            policyRevision: identity.policyRevision,
          };
        }
        const plan = await env.planTool(call, identity);
        if (plan) plans.push(plan);
        return plan;
      },
    });
    const extension = defineExtension({ name: "fixture-tools", tools: [tool] });
    const security = policy.extension([tool]);
    for (const item of [extension, approvals.extension, security])
      registry.install(item);
    harness = await Harness.open(
      storage,
      {
        models,
        registry,
        env: () => env,
        settings: {
          extensions: [extension, approvals.extension, security],
          retry: { enabled: false },
          compaction: { enabled: false },
        },
      },
      ctx,
    );
    return { tool, env };
  }
  let current = await open();
  conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: { model } },
    ctx,
  );
  const id = conversation.id;
  cleanups.push(async () => {
    await approvals.dispose();
    await harness.close(ctx);
    await MemoryStorage.prototype.close.call(storage, ctx);
    await rm(cwd, { recursive: true, force: true });
  });
  const state = async () => {
    const value = await harness.snapshot(NativeApprovals, id, ctx);
    if (!value) throw new Error("Fixture approval document missing");
    return value;
  };
  return {
    broker,
    address,
    state,
    plans,
    spawns: () => spawns,
    task: () => taskId,
    get harness() {
      return harness;
    },
    get approvals() {
      return approvals;
    },
    get conversation() {
      return conversation;
    },
    async start() {
      await approvals.attach(id, address, ctx);
      provider.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(
              current.tool.name,
              { command: "fixture" },
              { id: "call-fixture" },
            ),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);
      const submission = await conversation.submit(
        { type: "input", content: "fixture only" },
        ctx,
      );
      await until(
        async () => Object.keys((await state())?.requests ?? {}).length > 0,
      );
      return submission;
    },
    async ui() {
      await until(() => broker.pending().length > 0);
      const first = broker.pending()[0];
      if (!first) throw new Error("No projected request");
      return first;
    },
    async reopen() {
      await approvals.dispose();
      await harness.close(ctx);
      current = await open();
      const restored = await harness.conversation(id, ctx);
      if (!restored) throw new Error("Conversation missing");
      conversation = restored;
      await approvals.attach(id, { ...address, epoch: 2 }, ctx);
      harness.resume();
    },
  };
}

test("durable approval detach/reconnect reuses request, rotates uiId and rejects stale epoch; only approved final plan spawns", async () => {
  const f = await fixture();
  const submission = await f.start();
  const first = await f.ui();
  const state = await f.state(),
    request = requiredFirst(Object.values(state.requests));
  const task = await f.harness.getTask(request.taskId, ctx);
  expect(task?.state.checkpoint).toMatchObject({ phase: "call" });
  await f.approvals.detach(f.conversation.id);
  f.broker.setAvailable(false);
  expect(Object.values((await f.state()).requests)[0]?.state).toBe("pending");
  expect(f.spawns()).toBe(0);
  f.broker.setAvailable(true);
  await f.approvals.attach(f.conversation.id, { ...f.address, epoch: 2 }, ctx);
  const next = await f.ui();
  expect(next.uiId).not.toBe(first.uiId);
  expect(next.epoch).toBe(2);
  expect(Object.values((await f.state()).requests)[0]?.requestId).toBe(
    request.requestId,
  );
  await expect(
    f.approvals.resolve({ ...first, kind: "confirm", value: true }),
  ).rejects.toThrow();
  await f.approvals.resolve({ ...next, kind: "confirm", value: true });
  await submission.wait(ctx);
  expect(operationHash(f.plans[0])).toBe(operationHash(f.plans[1]));
  expect(f.spawns()).toBe(1);
});

test("deny, UI cancel, expiry, UI absence and explicit Stop execute ZERO operations", async () => {
  for (const mode of ["deny", "cancel", "expire", "absent", "stop"] as const) {
    const f = await fixture(
      "standard",
      mode === "expire" || mode === "absent" ? 30 : 5000,
    );
    if (mode === "absent") f.broker.setAvailable(false);
    const submission = await f.start();
    if (mode === "deny" || mode === "cancel") {
      const request = await f.ui();
      await f.approvals.resolve(
        mode === "deny"
          ? { ...request, kind: "confirm", value: false }
          : { ...request, kind: "cancel" },
      );
    }
    if (mode === "stop") {
      await f.approvals.cancel(f.conversation.id, ctx);
      await f.conversation.abort(ctx);
    }
    await submission.wait(ctx);
    expect(f.spawns()).toBe(0);
  }
});

test("beforeTool plan vs changed final env.exec hash is rejected with spawn ZERO", async () => {
  const f = await fixture("changed");
  const submission = await f.start();
  await f.approvals.resolve({
    ...(await f.ui()),
    kind: "confirm",
    value: true,
  });
  await submission.wait(ctx);
  expect(f.spawns()).toBe(0);
  const history = await f.conversation.entries(
    { order: "ascending" },
    100,
    undefined,
    ctx,
  );
  expect(JSON.stringify(history.items)).toContain("Final operation changed");
});

test("server-bound immutable revision/hash/deadline CAS rejects stale replies with spawn ZERO", async () => {
  for (const field of ["revision", "operationHash", "expiresAt"] as const) {
    const f = await fixture();
    const submission = await f.start();
    const ui = await f.ui();
    await f.harness.commit(async (tx) => {
      const doc = await tx.doc(NativeApprovals, f.conversation.id);
      const request = requiredFirst(Object.values(doc.requests));
      if (field === "revision") request.revision++;
      if (field === "operationHash") request.operationHash = "stale";
      if (field === "expiresAt") request.expiresAt = Date.now() - 1;
    }, ctx);
    await expect(
      f.approvals.resolve({ ...ui, kind: "confirm", value: true }),
    ).rejects.toThrow();
    await f.approvals.cancel(f.conversation.id, ctx);
    await submission.wait(ctx);
    expect(f.spawns()).toBe(0);
  }
});

test("restart before native intent preserves pending request; unsafe direct exec after intent is interrupted, never auto-executed", async () => {
  for (const mode of ["standard", "direct"] as const) {
    const f = await fixture(mode);
    await f.start();
    const first = await f.ui();
    const prior = requiredFirst(Object.values((await f.state()).requests));
    expect(prior.stage).toBe(
      mode === "standard" ? "before-intent" : "final-operation",
    );
    await f.reopen();
    if (mode === "standard") {
      const next = await f.ui();
      expect(next.uiId).not.toBe(first.uiId);
      expect(Object.values((await f.state()).requests)[0]?.requestId).toBe(
        prior.requestId,
      );
      await f.approvals.resolve({ ...next, kind: "confirm", value: true });
      await f.conversation.waitForIdle(ctx);
      expect(f.spawns()).toBe(1);
    } else {
      await f.conversation.waitForIdle(ctx);
      expect(f.spawns()).toBe(0);
      const history = await f.conversation.entries(
        { order: "ascending" },
        100,
        undefined,
        ctx,
      );
      expect(JSON.stringify(history.items)).toContain("interrupted");
    }
  }
});

test("unsafe side effect started before restart is NOT replayed", async () => {
  const f = await fixture("effect");
  await f.start();
  await f.approvals.resolve({
    ...(await f.ui()),
    kind: "confirm",
    value: true,
  });
  await until(() => f.spawns() === 1);
  await f.reopen();
  await f.conversation.waitForIdle(ctx);
  expect(f.spawns()).toBe(1);
});

test("final synchronous lease rejects Stop/UI loss after durable approval; one approval cannot repeat an operation", async () => {
  for (const mode of ["detach-final", "stop-final", "twice"] as const) {
    const f = await fixture(mode);
    const submission = await f.start();
    await f.approvals.resolve({
      ...(await f.ui()),
      kind: "confirm",
      value: true,
    });
    await submission.wait(ctx);
    expect(f.spawns()).toBe(mode === "twice" ? 1 : 0);
  }
});

test("generic beforeTool permission intents cannot authorize unknown direct env.exec", async () => {
  const f = await fixture("direct", 5000, true);
  const submission = await f.start();
  const intent = requiredFirst(Object.values((await f.state()).requests));
  expect(intent.operationKind).toBe("tool");
  expect(
    (await f.harness.getTask(intent.taskId, ctx))?.state.checkpoint,
  ).toMatchObject({ phase: "call" });
  await f.approvals.resolve({
    ...(await f.ui()),
    kind: "confirm",
    value: true,
  });
  const final = await f.ui();
  expect(f.spawns()).toBe(0);
  await f.approvals.resolve({ ...final, kind: "confirm", value: false });
  await submission.wait(ctx);
  expect(f.spawns()).toBe(0);
});

test("a superseded older plan cannot poison the latest explicitly approved revision", async () => {
  const f = await fixture();
  const submission = await f.start();
  const ui = await f.ui();
  await f.harness.commit(async (tx) => {
    const doc = await tx.doc(NativeApprovals, f.conversation.id);
    const current = requiredFirst(Object.values(doc.requests));
    doc.requests.older = {
      ...current,
      requestId: "older",
      operationHash: "superseded",
      revision: current.revision - 1,
      state: "cancelled",
    };
  }, ctx);
  await f.approvals.resolve({ ...ui, kind: "confirm", value: true });
  await submission.wait(ctx);
  expect(f.spawns()).toBe(1);
});
