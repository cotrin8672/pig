import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterContext,
  ExtensionCommand,
  SessionView,
} from "../../../../packages/config/src";
import { validateView } from "../../../../packages/config/src/validate";
import {
  connectGotgenesSubagents,
  connectSchedulePrompt,
  holdsLiveWork,
} from "./supported-adapters";

function fakeContext(cwd: string, commands: ExtensionCommand[]) {
  const views = new Map<string, SessionView>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const invoked: unknown[] = [];
  const registered = new Map<string, () => unknown>();
  const ctx = {
    session: { id: "s1", cwd },
    sources: {
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
  return { ctx, views, emit, invoked, registered };
}
const state = (views: Map<string, SessionView>) => ({
  generation: "g",
  views: [...views.values()].map((view) => ({
    adapterId: "a",
    revision: 1,
    view,
  })),
  commands: [],
  keymaps: [],
  diagnostics: [],
});

const subagentCommand = {
  name: "subagents:settings",
  invocationName: "subagents:settings",
  source: "C:\\Users\\me\\node_modules\\@gotgenes\\pi-subagents\\src\\index.ts",
};

test("subagent lifecycle events become live runs and keep the session awake", () => {
  const f = fakeContext("C:\\p", [subagentCommand]);
  connectGotgenesSubagents().connect(f.ctx);
  f.emit("subagents:created", {
    id: "a1",
    type: "Explore",
    description: "Find tests",
  });
  f.emit("subagents:started", {
    id: "a1",
    type: "Explore",
    description: "Find tests",
  });
  let view = f.views.get("subagents");
  expect(view?.kind === "agents" && view.runs[0]?.state.phase).toBe("running");
  expect(holdsLiveWork(state(f.views))).toBe(true);

  f.emit("subagents:failed", {
    id: "a1",
    status: "stopped",
    error: "Stopped by user",
  });
  view = f.views.get("subagents");
  if (view?.kind !== "agents") throw new Error("expected agents view");
  expect(view.runs[0]?.state).toEqual({
    phase: "finished",
    outcome: "cancelled",
  });
  expect(view.runs[0]?.output?.text).toBe("Stopped by user");
  expect(holdsLiveWork(state(f.views))).toBe(false);
});

test("subagent events from an unrelated package are not shown", () => {
  const f = fakeContext("C:\\p", [
    {
      ...subagentCommand,
      source: "C:\\x\\node_modules\\other-subagents\\index.ts",
    },
  ]);
  connectGotgenesSubagents().connect(f.ctx);
  f.emit("subagents:started", { id: "a1" });
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
