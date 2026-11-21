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
import {
  connectNicoSubagents,
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
          { ...child, status: "running" },
          { ...child, index: 2, status: "pending" },
        ],
      },
    },
  });
  expect(holdsLiveWork(state(f.views))).toBe(true);
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
