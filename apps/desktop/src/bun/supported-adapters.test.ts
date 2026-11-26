import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterContext,
  ExtensionCommand,
  SessionView,
  SourceEvent,
} from "../../../../packages/config/src";
import { validateView } from "../../../../packages/config/src/validate";
import { CODEX_SUBAGENT_COMPLETION } from "../shared/supported-extensions";
import {
  connectCodexSubagents,
  connectNicoSubagents,
  connectPigSubagents,
  connectSchedulePrompt,
  holdsLiveWork,
} from "./supported-adapters";

function fakeContext(cwd: string, commands: ExtensionCommand[]) {
  const views = new Map<string, SessionView>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const events = new Set<(event: SourceEvent) => void>();
  const invoked: unknown[] = [];
  const registered = new Map<string, () => unknown>();
  const ctx = {
    session: { id: "s1", cwd },
    sources: {
      onEvent(listener: (event: SourceEvent) => void) {
        events.add(listener);
        return () => events.delete(listener);
      },
      onBus(channel: string, listener: (data: unknown) => void) {
        const set = bus.get(channel) ?? new Set();
        bus.set(channel, set);
        set.add(listener);
        return () => set.delete(listener);
      },
    },
    views: {
      set: (view: SessionView) => views.set(view.id, validateView(view)),
      remove: (id: string) => views.delete(id),
    },
    commands: {
      register: (c: { id: string; run: () => unknown }) =>
        registered.set(c.id, c.run),
    },
    pi: {
      commands: () => commands,
      invoke: async (c: unknown) => void invoked.push(c),
    },
  } as unknown as AdapterContext;
  const emit = (channel: string, data: unknown) => {
    for (const listener of bus.get(channel) ?? []) listener(data);
  };
  return {
    ctx,
    views,
    emit,
    bus,
    event: (event: SourceEvent) => {
      for (const listener of events) listener(event);
    },
    invoked,
    registered,
  };
}
const state = (views: Map<string, SessionView>) => ({
  generation: "g",
  views: [...views.values()].map((view) => ({
    adapterId: view.kind === "agents" ? "pig:subagents" : "a",
    revision: 1,
    view,
  })),
  commands: [],
  keymaps: [],
  diagnostics: [],
});

test("pi-subagent requests parent snapshots on attach and change, ignoring obsolete replies", async () => {
  const source = "/node_modules/pi-subagent/index.ts";
  const f = fakeContext("project", [
    { name: "agents", invocationName: "agents", source },
  ]);
  const replies: Array<(rows: unknown) => void> = [];
  const adapter = connectPigSubagents({
    emit(channel, data) {
      expect(channel).toBe("pig:subagents:snapshot");
      const req = data as { parentId: string; reply(rows: unknown): void };
      expect(req.parentId).toBe("s1");
      replies.push(req.reply);
    },
  });
  const dispose = adapter.connect(f.ctx);
  const row = {
    agent_id: "worker",
    run_id: "first",
    task_name: "Review",
    status: "starting",
  };
  const changed = () => f.emit("pig:subagents:changed", { parentId: "s1" });
  const pinned = () =>
    holdsLiveWork({
      ...state(f.views),
      views: state(f.views).views.map((v) => ({ ...v, adapterId: adapter.id })),
    });
  replies[0]([row]);
  expect(pinned()).toBe(true);
  f.emit("pig:subagents:changed", { parentId: "other" });
  expect(replies).toHaveLength(1);
  changed();
  replies[1]([{ ...row, status: "running", child_session_id: "child" }]);
  expect(pinned()).toBe(true);
  replies[0]([]);
  expect(f.views.get("subagents")).toMatchObject({
    runs: [
      {
        id: "first",
        agentId: "worker",
        title: "Review",
        session: { kind: "session", id: "child" },
        state: { phase: "running" },
      },
    ],
    actions: [{ command: "peek" }],
  });
  await f.registered.get("peek")?.();
  expect(f.invoked).toEqual([{ name: "agents", source }]);
  for (const [status, outcome] of [
    ["completed", "success"],
    ["failed", "error"],
    ["interrupted", "interrupted"],
  ]) {
    changed();
    replies.at(-1)?.([
      {
        ...row,
        status,
        ...(status === "completed"
          ? { final_response: "result" }
          : { error: "result" }),
      },
    ]);
    expect(pinned()).toBe(false);
    expect(f.views.get("subagents")).toMatchObject({
      runs: [
        { state: { phase: "finished", outcome }, output: { text: "result" } },
      ],
    });
  }
  if (typeof dispose !== "function") throw Error("missing cleanup");
  dispose();
  replies.at(-1)?.([row]);
  expect(pinned()).toBe(false);
  const count = replies.length;
  changed();
  expect(replies).toHaveLength(count);
  adapter.connect(f.ctx);
  expect(replies).toHaveLength(count + 1);
  replies.at(-1)?.([]);
  expect(f.views.size).toBe(0);
});

const subagentCommand = {
  name: "subagents-fleet",
  invocationName: "subagents-fleet",
  source: "C:\\Users\\me\\node_modules\\pi-subagents\\src\\extension\\index.js",
};
const requestChannel = "subagents:rpc:v1:request";

test("subagent status is refreshed from correlated, session-local RPC replies", async () => {
  const f = fakeContext("C:\\p", [subagentCommand]);
  const other = fakeContext("C:\\p", [subagentCommand]);
  let next = Promise.withResolvers<string>();
  const dispose = connectNicoSubagents({
    emit: (channel, data) => {
      expect(channel).toBe(requestChannel);
      expect(data).toMatchObject({ version: 1, method: "status" });
      next.resolve((data as { requestId: string }).requestId);
    },
  }).connect(f.ctx);
  const reply = (requestId: string, status: string) => ({
    version: 1,
    requestId,
    success: true,
    data: {
      asyncSnapshot: {
        kind: "pi-subagents.async-status-snapshot",
        version: 1,
        runs: [{ id: "a1", label: "Find tests", state: status }],
      },
    },
  });
  const first = await next.promise;
  const channel = (id: string) => `subagents:rpc:v1:reply:${id}`;
  other.emit(channel(first), reply(first, "running"));
  f.emit(channel(first), reply("wrong", "running"));
  expect(f.views.size).toBe(0);
  next = Promise.withResolvers<string>();
  f.emit("subagent:jobs-changed", {});
  f.emit("subagent:child-status", {});
  f.emit(channel(first), reply(first, "running"));
  expect(holdsLiveWork(state(f.views))).toBe(true);

  const second = await next.promise;
  expect(second).not.toBe(first);
  f.emit(channel(second), reply(second, "stopped"));
  const view = f.views.get("subagents");
  if (view?.kind !== "agents") throw new Error("expected agents view");
  expect(view.runs[0]).toMatchObject({
    id: "async:a1",
    state: { phase: "finished", outcome: "cancelled" },
  });
  expect(holdsLiveWork(state(f.views))).toBe(false);
  next = Promise.withResolvers<string>();
  f.emit("subagent:jobs-changed", {});
  const pending = await next.promise;
  if (typeof dispose !== "function") throw new Error("expected cleanup");
  dispose();
  f.emit(channel(pending), reply(pending, "running"));
  expect(holdsLiveWork(state(f.views))).toBe(false);
  expect([...f.bus.values()].every((listeners) => !listeners.size)).toBe(true);
});

test("the supported adapter projects per-child foreground progress and outcomes", () => {
  const f = fakeContext("C:\\p", [subagentCommand]);
  const dispose = connectNicoSubagents({ emit() {} }).connect(f.ctx);
  const child = { agent: "reviewer", index: 0, task: "Find tests" };
  f.event({
    type: "tool_execution_update",
    toolName: "subagent",
    toolCallId: "call",
    partialResult: {
      details: {
        runId: "fg-1",
        progress: [
          {
            ...child,
            status: "running",
            recentTools: [{ tool: "read", args: "a.ts", endMs: 1 }],
            recentOutput: ["Looking at tests"],
            currentTool: "bash",
            currentToolArgs: "bun test",
          },
          { ...child, index: 2, status: "pending" },
        ],
      },
    },
  });
  expect(holdsLiveWork(state(f.views))).toBe(true);
  const live = f.views.get("subagents");
  if (live?.kind !== "agents") throw new Error("expected agents view");
  expect(live.runs.at(-1)?.output?.text).toBe(
    "✓ read a.ts\nLooking at tests\n→ bash bun test",
  );
  f.event({
    type: "tool_execution_end",
    toolName: "subagent",
    toolCallId: "call",
    result: {
      details: {
        runId: "fg-1",
        results: [
          { ...child, exitCode: 2, error: "Model failed" },
          { ...child, index: 1, exitCode: 0, finalOutput: "Result" },
        ],
      },
    },
  });
  const view = f.views.get("subagents");
  if (view?.kind !== "agents") throw new Error("expected agents view");
  expect(view.runs.map((run) => [run.state.outcome, run.output?.text])).toEqual(
    [
      ["success", "Result"],
      ["unknown", undefined],
      ["error", "Model failed"],
    ],
  );
  expect(holdsLiveWork(state(f.views))).toBe(false);
  if (typeof dispose === "function") dispose();
});

test("unrelated packages do not activate the subagents adapter", () => {
  const f = fakeContext("C:\\p", [
    {
      ...subagentCommand,
      source: "C:\\x\\node_modules\\other-subagents\\index.ts",
    },
  ]);
  expect(connectNicoSubagents({ emit() {} }).connect(f.ctx)).toBeUndefined();
  expect(f.bus.size).toBe(0);
  expect(f.views.size).toBe(0);
});

const codexCommand = {
  name: "subagents",
  invocationName: "subagents",
  source: "C:\\x\\node_modules\\@ogulcancelik\\pi-codex-subagents\\index.ts",
};

function codexFixture() {
  const f = fakeContext("C:\\p", [codexCommand]);
  const dispose = connectCodexSubagents().connect(f.ctx);
  return {
    ...f,
    dispose,
    start: (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ) => f.event({ type: "tool_execution_start", toolName, toolCallId, args }),
    end: (
      toolName: string,
      toolCallId: string,
      details: Record<string, unknown> = {},
      content: unknown[] = [],
      isError = false,
    ) =>
      f.event({
        type: "tool_execution_end",
        toolName,
        toolCallId,
        result: { details, content },
        isError,
      }),
    runs: () => {
      const view = f.views.get("codex-subagents");
      return view?.kind === "agents" ? view.runs : [];
    },
  };
}

test("Codex publishes session-local agents before spawn returns and settles each one", () => {
  const f = codexFixture();
  const other = codexFixture();
  expect(f.runs()).toEqual([]);
  f.start("spawn_agent", "call-a", { task_name: "scout/tests" });
  expect(f.runs()).toMatchObject([
    { id: "call-a", title: "scout/tests", state: { phase: "queued" } },
  ]);
  expect(other.runs()).toEqual([]);
  expect(holdsLiveWork(state(f.views))).toBe(true);
  f.end("spawn_agent", "call-a", { task_name: "/scout/tests" });
  f.start("spawn_agent", "call-b", { task_name: "invalid" });
  expect(f.runs().map(({ state }) => state.phase)).toEqual([
    "queued",
    "running",
  ]);
  f.end("spawn_agent", "call-b", {}, [], true);
  expect(f.runs().map(({ title }) => title)).toEqual(["scout/tests"]);
  f.event({
    type: "message_start",
    message: {
      role: "custom",
      customType: CODEX_SUBAGENT_COMPLETION,
      details: { agent_name: "/scout/tests", status: "completed" },
    },
  });
  expect(f.runs()[0]?.state).toEqual({ phase: "finished", outcome: "success" });
  expect(holdsLiveWork(state(f.views))).toBe(false);
  if (typeof f.dispose === "function") f.dispose();
  f.start("spawn_agent", "after", { task_name: "ignored" });
  expect(f.runs()).toHaveLength(1);
});

test("Codex waits and interrupts clear only their own runs, even if wait output is truncated", () => {
  const f = codexFixture();
  for (const name of ["review", "scout", "tests"]) {
    f.start("spawn_agent", name, { task_name: name });
    f.end("spawn_agent", name);
  }
  f.start("wait_all_agents", "all", { targets: ["review"] });
  f.end("wait_all_agents", "all", {
    message: "All target agents reached final status.",
    truncated: true,
  });
  f.start("wait_agent", "one", { targets: ["scout"] });
  f.end("wait_agent", "one", { message: "Wait completed: /scout failed." });
  expect(f.runs().map(({ state }) => state)).toEqual([
    { phase: "running" },
    { phase: "finished", outcome: "error" },
    { phase: "finished", outcome: "unknown" },
  ]);
  f.start("interrupt_agent", "stop", { target: "/tests" });
  f.end("interrupt_agent", "stop", { previous_status: "running" });
  expect(holdsLiveWork(state(f.views))).toBe(false);
  f.start("send_message", "follow-up", { target: "scout" });
  expect(f.runs()[0]).toMatchObject({
    id: "follow-up",
    state: { phase: "queued" },
  });
  f.end("send_message", "follow-up", { target: "scout", delivery: "prompt" });
  f.start("wait_all_agents", "done", {});
  f.end("wait_all_agents", "done", {}, [
    {
      type: "text",
      text: JSON.stringify({
        responses: [{ agent_name: "/scout", status: "completed" }],
      }),
    },
  ]);
  expect(f.runs()[0]?.state).toEqual({ phase: "finished", outcome: "success" });
  expect(holdsLiveWork(state(f.views))).toBe(false);
});

test("scheduled prompts show only this session's and shared jobs", () => {
  const dir = mkdtempSync(join(tmpdir(), "pig-schedule-"));
  const cwd = mkdtempSync(join(tmpdir(), "pig-project-"));
  const key = createHash("sha256")
    .update(realpathSync.native(cwd))
    .digest("hex");
  const job = (id: string, extra: object) => ({
    id,
    name: id,
    schedule: "+10m",
    prompt: "check CI",
    enabled: true,
    type: "once",
    createdAt: "2026-01-01T00:00:00.000Z",
    nextRun: "2026-01-01T00:10:00.000Z",
    runCount: 0,
    ...extra,
  });
  writeFileSync(
    join(dir, `${key}.json`),
    JSON.stringify({
      version: 1,
      jobs: [
        job("mine", { session: "s1" }),
        job("other", { session: "s2" }),
        job("shared", { type: "interval", intervalMs: 60_000, schedule: "1m" }),
      ],
    }),
  );
  const source = "C:\\n\\node_modules\\pi-schedule-prompt\\dist\\index.js";
  const f = fakeContext(cwd, [
    { name: "schedule-prompt", invocationName: "schedule-prompt", source },
  ]);
  connectSchedulePrompt(dir).connect(f.ctx);
  const view = f.views.get("schedule-prompt");
  if (view?.kind !== "schedule") throw new Error("expected schedule view");
  expect(view.schedules.map((s) => s.id)).toEqual(["mine", "shared"]);
  expect(view.schedules[0]?.timing).toEqual({
    kind: "once",
    at: "2026-01-01T00:10:00.000Z",
  });
  expect(view.schedules[1]?.timing).toEqual({
    kind: "interval",
    milliseconds: 60_000,
  });
  expect(holdsLiveWork(state(f.views))).toBe(true);

  void f.registered.get("manage")?.();
  expect(f.invoked).toEqual([{ name: "schedule-prompt", source }]);

  writeFileSync(
    join(dir, `${key}.json`),
    JSON.stringify({ version: 1, jobs: [] }),
  );
  f.emit("cron:change", {});
  expect(f.views.size).toBe(0);
});
