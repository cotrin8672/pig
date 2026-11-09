import { expect, test } from "bun:test";
import exampleConfig from "../../../../examples/session-ui/config";
import {
  connectPiPlanMode,
  connectPiSubagents,
  connectPiTodos,
} from "../../../../examples/session-ui/pi-adapters";
import type {
  AdapterContext,
  ExtensionCommand,
  SessionAdapter,
  SessionView,
  SourceEntry,
  SourceEvent,
  ToolObservation,
} from "../../../../packages/config/src";
import { validateView } from "../../../../packages/config/src/validate";

const timestamp = "2026-01-01T00:00:00.000Z";
const planSource = "C:\\extensions\\plan-mode\\index.ts";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}
function fakeContext() {
  const branch: SourceEntry[] = [];
  const all: SourceEntry[] = [];
  const tools: ToolObservation[] = [];
  const piCommands: ExtensionCommand[] = [];
  const commands = new Map<
    string,
    Parameters<AdapterContext["commands"]["register"]>[0]
  >();
  const views = new Map<string, SessionView>();
  const revisions = new Map<string, number>();
  const changes = new Set<() => void | Promise<void>>();
  const events = new Set<(event: SourceEvent) => void | Promise<void>>();
  const calls: Parameters<AdapterContext["pi"]["invoke"]>[0][] = [];
  const disposals: (() => void)[] = [];
  const ctx: AdapterContext = {
    session: { id: "session-1", cwd: "C:\\project" },
    sources: {
      entries: (scope) => (scope === "branch" ? branch : all),
      tools: () => tools,
      subscribe(listener) {
        changes.add(listener);
        void listener();
        return () => {
          changes.delete(listener);
        };
      },
      onEvent(listener) {
        events.add(listener);
        return () => {
          events.delete(listener);
        };
      },
      onBus() {
        throw new Error("No example bus protocol exists");
      },
    },
    views: {
      set(value) {
        // Every produced view must pass the same public validation as the Host.
        const view = validateView(value);
        if (JSON.stringify(views.get(view.id)) !== JSON.stringify(view))
          revisions.set(view.id, (revisions.get(view.id) ?? 0) + 1);
        views.set(view.id, view);
      },
      remove(id) {
        views.delete(id);
      },
    },
    commands: {
      register(command) {
        expect(commands.has(command.id)).toBe(false);
        commands.set(command.id, command);
      },
    },
    pi: {
      commands: () => piCommands,
      async invoke(command) {
        calls.push(command);
      },
      emit() {
        throw new Error("No mutation bus exists");
      },
    },
    scope: {
      signal: new AbortController().signal,
      onDispose(cleanup) {
        disposals.push(cleanup);
      },
      interval() {
        throw new Error("No polling needed");
      },
    },
  };
  return {
    ctx,
    branch,
    all,
    tools,
    piCommands,
    commands,
    views,
    revisions,
    changes,
    events,
    calls,
    refresh() {
      for (const listener of changes) void listener();
    },
    event() {
      for (const listener of events)
        void listener({ type: "commands_changed" });
    },
    view<K extends SessionView["kind"]>(
      id: string,
      kind: K,
    ): Extract<SessionView, { kind: K }> {
      const view = views.get(id);
      if (!view || view.kind !== kind)
        throw new Error(`Missing ${kind} view ${id}`);
      return view as Extract<SessionView, { kind: K }>;
    },
    async connect(adapter: SessionAdapter) {
      const cleanup = await adapter.connect(ctx);
      return () => {
        if (cleanup) cleanup();
        for (const dispose of disposals.splice(0)) dispose();
      };
    },
  };
}
function todoEntry(
  id: string,
  title: string,
  done = false,
  extra: Record<string, unknown> = {},
): SourceEntry {
  return {
    id,
    type: "message",
    timestamp,
    message: {
      role: "toolResult",
      toolName: "todo",
      toolCallId: `call-${id}`,
      details: { todos: [{ id: 1, text: title, done }], nextId: 2 },
      ...extra,
    },
  };
}
function planEntry(id: string, data: unknown): SourceEntry {
  return { id, type: "custom", customType: "plan-mode", timestamp, data };
}
function child(overrides: Record<string, unknown> = {}) {
  return {
    agent: "reviewer",
    agentSource: "project",
    task: "Review the patch",
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Partial findings" },
          { type: "text", text: "More findings" },
        ],
      },
    ],
    stderr: "",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
      contextTokens: 30,
      turns: 1,
    },
    model: "provider/model",
    ...overrides,
  };
}
function subagent(
  results: unknown[],
  overrides: Partial<ToolObservation> = {},
  mode = "parallel",
): ToolObservation {
  return {
    toolCallId: "parent",
    toolName: "subagent",
    phase: "finished",
    origin: "history",
    isError: false,
    result: {
      content: [{ type: "text", text: "Parallel aggregate succeeded" }],
      details: { mode, results },
    },
    ...overrides,
  };
}

test("todos read latest successful branch details, not all entries or rendered text", async () => {
  const fake = fakeContext();
  fake.branch.push(
    todoEntry("old", "Old"),
    todoEntry("latest", "Current", true),
    todoEntry("failed", "Must not replace", false, { isError: true }),
    todoEntry("details-error", "Ignored", false, {
      details: { todos: [], nextId: 1, error: "Missing text" },
    }),
    todoEntry("malformed", "Ignored", false, {
      details: { todos: [{ id: 2, text: "Missing done" }], nextId: 3 },
    }),
  );
  fake.all.push(todoEntry("other-branch", "Wrong branch"));
  const cleanup = await fake.connect(connectPiTodos());
  const view = fake.view("pi-todos", "todo");
  expect(view.items).toEqual([
    { id: "1", identity: "native", title: "Current", state: "completed" },
  ]);
  expect(view.source).toMatchObject({
    scope: { kind: "session", id: "session-1" },
    freshness: "saved",
  });
  expect(view.origin).toMatchObject({ kind: "message", id: "latest" });
  expect(view.facts).toContainEqual({ label: "Next native ID", value: "2" });
  expect(fake.commands.size).toBe(0);
  expect(fake.calls).toHaveLength(0);
  cleanup();
  expect(fake.changes.size).toBe(0);
});

test("todo native ID reuse after clear and branching changes snapshot revision", async () => {
  const fake = fakeContext();
  fake.branch.push(todoEntry("original", "Original"));
  await fake.connect(connectPiTodos({ id: "work" }));
  const revision = required(fake.revisions.get("work"));
  const clear: SourceEntry = {
    id: "clear",
    type: "message",
    timestamp,
    message: {
      role: "toolResult",
      toolName: "todo",
      details: { todos: [], nextId: 1 },
    },
  };
  fake.branch.push(clear);
  fake.refresh();
  expect(fake.view("work", "todo").items).toEqual([]);
  fake.branch.push(todoEntry("reused", "New task"));
  fake.refresh();
  expect(fake.view("work", "todo").items[0]).toMatchObject({
    id: "1",
    title: "New task",
    state: "pending",
  });
  expect(fake.revisions.get("work")).toBeGreaterThan(revision);
  fake.branch.splice(0, fake.branch.length, todoEntry("fork", "Fork task"));
  fake.refresh();
  expect(fake.view("work", "todo").items[0].title).toBe("Fork task");
  expect(fake.view("work", "todo").origin?.revision).toBe("fork");
});

test("todo freshness needs a matching known-live finished observation", async () => {
  const fake = fakeContext();
  fake.branch.push(todoEntry("saved", "Saved"));
  fake.tools.push({
    toolName: "todo",
    toolCallId: "unrelated",
    origin: "live",
    phase: "finished",
  });
  await fake.connect(connectPiTodos());
  expect(fake.view("pi-todos", "todo").source.freshness).toBe("saved");
  fake.tools[0].toolCallId = "call-saved";
  fake.refresh();
  expect(fake.view("pi-todos", "todo").source.freshness).toBe("live");
  fake.branch.length = 0;
  fake.refresh();
  expect(fake.view("pi-todos", "todo").source.freshness).toBe("unknown");
  expect(fake.view("pi-todos", "todo").items).toEqual([]);
});

test("plan uses newest all-session custom state and separates mode from execution todos", async () => {
  const fake = fakeContext();
  fake.branch.push(planEntry("branch", { enabled: true }));
  fake.all.push(
    planEntry("old", { enabled: true }),
    planEntry("latest", {
      enabled: false,
      executing: true,
      todos: [
        { step: 1, text: "Implement", completed: false },
        { step: 2, text: "Verify", completed: true },
      ],
    }),
    {
      id: "irrelevant",
      type: "custom",
      customType: "plan-mode-context",
      timestamp,
      data: { enabled: true },
    },
  );
  await fake.connect(connectPiPlanMode({ source: planSource }));
  const mode = fake.view("pi-plan-mode", "mode");
  expect(mode.value).toBe("normal");
  expect(mode.source.freshness).toBe("saved");
  expect(mode.origin?.revision).toBe("latest");
  expect(mode.facts).toContainEqual({ label: "Executing plan", value: "Yes" });
  expect(mode.choices).toEqual([
    { id: "plan", label: "Plan" },
    { id: "normal", label: "Normal" },
  ]);
  expect(
    fake
      .view("pi-plan-mode:todos", "todo")
      .items.map((item) => [item.identity, item.state]),
  ).toEqual([
    ["snapshot", "pending"],
    ["snapshot", "completed"],
  ]);
  expect(mode.actions).toEqual([]);
  expect(fake.commands.size).toBe(0);
});

test("missing plan state is unknown, not Normal/false; explicit command source required", async () => {
  expect(() => connectPiPlanMode({ source: "" })).toThrow(
    "explicit command sourceInfo.path",
  );
  expect(() =>
    connectPiPlanMode({ source: undefined as unknown as string }),
  ).toThrow("explicit command sourceInfo.path");
  const fake = fakeContext();
  fake.piCommands.push({
    name: "plan",
    invocationName: "plan",
    source: "other-extension",
  });
  await fake.connect(connectPiPlanMode({ source: planSource }));
  expect(fake.view("pi-plan-mode", "mode").value).toBeNull();
  expect(fake.view("pi-plan-mode", "mode").source.freshness).toBe("unknown");
  expect(fake.view("pi-plan-mode", "mode").facts).toContainEqual({
    label: "Executing plan",
    value: "Unknown",
  });
  expect(fake.commands.size).toBe(0);
});

test("plan command source events expose one confirmed toggle, invoke exact handler, never optimistically set", async () => {
  const fake = fakeContext();
  fake.all.push(planEntry("saved", { enabled: true, executing: false }));
  const cleanup = await fake.connect(connectPiPlanMode({ source: planSource }));
  expect(fake.commands.size).toBe(0);
  fake.piCommands.push({
    name: "plan",
    invocationName: "namespaced:plan",
    source: planSource,
  });
  fake.event();
  const mode = fake.view("pi-plan-mode", "mode");
  expect(mode.actions).toHaveLength(1);
  expect(mode.actions?.[0].confirmation).toContain("clears the current plan");
  expect(mode.choices.every((choice) => !choice.action)).toBe(true);
  await required(fake.commands.get("toggle")).run(undefined);
  expect(fake.calls).toEqual([{ name: "plan", source: planSource }]);
  expect(fake.view("pi-plan-mode", "mode").value).toBe("plan");
  fake.all.push(
    planEntry("updated", { enabled: false, executing: false, todos: [] }),
  );
  fake.refresh();
  expect(fake.view("pi-plan-mode", "mode").value).toBe("normal");
  fake.piCommands.length = 0;
  fake.event();
  expect(fake.view("pi-plan-mode", "mode").actions).toEqual([]);
  await expect(
    required(fake.commands.get("toggle")).run(undefined),
  ).rejects.toThrow("no longer registered");
  fake.piCommands.push({
    name: "plan",
    invocationName: "plan",
    source: planSource,
  });
  fake.event(); // No duplicate local command registration after reload.
  cleanup();
  expect(fake.changes.size).toBe(0);
  expect(fake.events.size).toBe(0);
});

test("example placeholder config remains read-only until a real exact source is loaded", async () => {
  const fake = fakeContext();
  fake.piCommands.push({
    name: "plan",
    invocationName: "plan",
    source: planSource,
  });
  for (const adapter of required(exampleConfig.sessionAdapters))
    await fake.connect(adapter);
  expect(fake.views.size).toBe(4);
  expect(fake.commands.size).toBe(0);
  expect(fake.view("pi-plan-mode", "mode").actions).toEqual([]);
});

test("parallel aggregate success cannot hide each child's failure or cancellation", async () => {
  const fake = fakeContext();
  fake.tools.push(
    subagent([
      child(),
      child({ exitCode: 2, stderr: "failed process" }),
      child({ stopReason: "error", errorMessage: "Model failed" }),
      child({ stopReason: "aborted" }),
    ]),
  );
  fake.branch.push({
    id: "result-entry",
    type: "message",
    timestamp,
    message: { role: "toolResult", toolName: "subagent", toolCallId: "parent" },
  });
  await fake.connect(connectPiSubagents());
  const view = fake.view("pi-subagents", "agents");
  expect(view.runs.map((run) => run.id)).toEqual([
    "parent:0",
    "parent:1",
    "parent:2",
    "parent:3",
  ]);
  expect(view.runs.map((run) => run.state.outcome)).toEqual([
    "success",
    "error",
    "error",
    "cancelled",
  ]);
  expect(view.runs[0]).toMatchObject({
    profile: "reviewer",
    task: "Review the patch",
    model: "provider/model",
    origin: { kind: "message", id: "result-entry" },
  });
  expect(view.runs[0].facts).toContainEqual({
    label: "Usage · cost",
    value: "0.01",
  });
  expect(view.runs[0].facts).toContainEqual({
    label: "Usage · input",
    value: "10",
  });
  expect(view.source.freshness).toBe("saved");
  expect(
    view.runs.every((run) => !run.actions && !run.session && !run.parentId),
  ).toBe(true);
  expect(fake.commands.size).toBe(0);
});

test("chain siblings depend on previous run, never imply nested parent agents", async () => {
  const fake = fakeContext();
  fake.tools.push(
    subagent(
      [child({ step: 1 }), child({ step: 2 }), child({ step: 3 })],
      {},
      "chain",
    ),
  );
  await fake.connect(connectPiSubagents({ id: "workers" }));
  const runs = fake.view("workers", "agents").runs;
  expect(runs.map((run) => run.dependsOn)).toEqual([
    undefined,
    ["parent:0"],
    ["parent:1"],
  ]);
  expect(runs.every((run) => run.parentId === undefined)).toBe(true);
});

test("saved -1 is unknown, never resurrected running; live placeholders cannot distinguish queued/running", async () => {
  const fake = fakeContext();
  fake.tools.push(subagent([child({ exitCode: -1 })]));
  const cleanup = await fake.connect(connectPiSubagents());
  expect(fake.view("pi-subagents", "agents").runs[0].state).toMatchObject({
    phase: "unknown",
    outcome: "unknown",
  });
  expect(fake.view("pi-subagents", "agents").runs[0].state.label).toContain(
    "Saved incomplete",
  );
  fake.tools[0] = subagent([child({ exitCode: -1 })], {
    origin: "live",
    phase: "running",
  });
  fake.refresh();
  expect(fake.view("pi-subagents", "agents").runs[0].state).toMatchObject({
    phase: "unknown",
    label: "Queued or running (source does not distinguish)",
  });
  expect(fake.view("pi-subagents", "agents").source.freshness).toBe("live");
  cleanup();
  expect(fake.changes.size).toBe(0);
});

test("live exit zero is not proof of completion: official single/chain initialize it before exit", async () => {
  for (const mode of ["single", "chain", "parallel"]) {
    const fake = fakeContext();
    fake.tools.push(
      subagent([child()], { origin: "live", phase: "running" }, mode),
    );
    await fake.connect(connectPiSubagents());
    expect(
      fake.view("pi-subagents", "agents").runs[0].state.outcome,
    ).toBeUndefined();
    fake.tools[0].phase = "finished";
    fake.refresh();
    expect(fake.view("pi-subagents", "agents").runs[0].state).toEqual({
      phase: "finished",
      outcome: "success",
    });
  }
});

test("subagent partial output combines all text blocks, stderr and error with a 20k cap", async () => {
  const fake = fakeContext();
  fake.tools.push(
    subagent([
      child({
        exitCode: 1,
        stderr: "stderr diagnostic",
        errorMessage: "error diagnostic",
      }),
    ]),
  );
  await fake.connect(connectPiSubagents());
  let output = required(fake.view("pi-subagents", "agents").runs[0].output);
  for (const part of [
    "stderr diagnostic",
    "error diagnostic",
    "Partial findings",
    "More findings",
  ])
    expect(output.text).toContain(part);
  expect(output.stream).toBe("combined");
  expect(output.truncated).toBe(false);
  fake.tools[0] = subagent([
    child({
      exitCode: 1,
      stderr: "STDERR".repeat(10_000),
      errorMessage: "ERROR".repeat(10_000),
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "PARTIAL".repeat(10_000) }],
        },
      ],
    }),
  ]);
  fake.refresh();
  output = required(fake.view("pi-subagents", "agents").runs[0].output);
  expect(output.text.length).toBeLessThanOrEqual(20_000);
  expect(output.truncated).toBe(true);
  for (const part of ["STDERR", "ERROR", "PARTIAL"])
    expect(output.text).toContain(part);
});

test("subagents only read structured details.results, not aggregate text or fabricated children", async () => {
  const fake = fakeContext();
  fake.tools.push(
    subagent([], {
      result: {
        content: [{ type: "text", text: "reviewer running: fabricated text" }],
      },
    }),
    {
      toolName: "bash",
      toolCallId: "bash",
      origin: "history",
      phase: "finished",
      result: { details: { results: [child()] } },
    },
  );
  await fake.connect(connectPiSubagents());
  expect(fake.view("pi-subagents", "agents").runs).toEqual([]);
  expect(fake.calls).toEqual([]);
});
