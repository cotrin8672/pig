// biome-ignore-all lint/style/noNonNullAssertion: Fixtures explicitly create the indexed runs.
import { describe, expect, test } from "bun:test";
import type {
  Provenance,
  RunRecord,
  SessionUIState,
  SessionView,
  ViewEnvelope,
  WorkItem,
} from "../../../../packages/config/src";
import {
  dismissDockRun,
  dockOtherViews,
  dockRuns,
  dockTodoSummary,
  dockTodos,
  isActiveRun,
  nextDockExpiry,
  observeDockRuns,
  type RunVisibility,
  resolveDockTab,
  visibleDockRuns,
} from "./session-dock-state";

const source: Provenance = {
  label: "fixture",
  scope: { kind: "session", id: "s" },
  freshness: "live",
};
const base = { id: "view", title: "View", source };
const envelope = (view: SessionView, adapterId = "adapter"): ViewEnvelope => ({
  adapterId,
  revision: 1,
  view,
});
function state(
  views: ViewEnvelope[],
  generation = "generation",
): SessionUIState {
  return { generation, views, commands: [], keymaps: [], diagnostics: [] };
}
function runs(
  phase: RunRecord["state"]["phase"] = "running",
  freshness: Provenance["freshness"] = "live",
) {
  return dockRuns(
    state([
      envelope({
        ...base,
        source: { ...source, freshness },
        kind: "agents",
        runs: [{ id: "run", title: "Run", state: { phase } }],
      }),
    ]),
  );
}
function todos(...states: WorkItem["state"][]): ViewEnvelope {
  return envelope({
    ...base,
    kind: "todo",
    items: states.map((status, index) => ({
      id: String(index),
      identity: "native",
      title: `Todo ${index}`,
      state: status,
    })),
  });
}
const empty: RunVisibility = new Map();

describe("dock run visibility", () => {
  test("only explicit live active phases count, including queued/waiting/paused", () => {
    for (const phase of [
      "queued",
      "running",
      "waiting",
      "paused",
      "finished",
      "unknown",
    ] as const) {
      for (const freshness of ["live", "saved", "unknown"] as const) {
        const items = runs(phase, freshness);
        const active =
          freshness === "live" && phase !== "finished" && phase !== "unknown";
        expect(isActiveRun(items[0]!)).toBe(active);
        const observed = observeDockRuns(empty, items, 0);
        expect(visibleDockRuns(observed, items, 0).length).toBe(active ? 1 : 0);
      }
    }
  });

  test("initial history never flashes or schedules expiry", () => {
    for (const items of [
      runs("finished"),
      runs("finished", "saved"),
      runs("running", "saved"),
    ]) {
      const observed = observeDockRuns(empty, items, 100);
      expect(visibleDockRuns(observed, items, 100)).toEqual([]);
      expect(nextDockExpiry(observed, items, 100)).toBeNull();
      expect(observeDockRuns(observed, items, 200)).toBe(observed);
      expect(observed.get(items[0]!.key)?.endedAt).toBeUndefined();
    }
  });

  test("fake time: grace lasts exactly 10 seconds after observed transition", () => {
    const active = runs();
    const finished = runs("finished");
    const observed = observeDockRuns(empty, active, 0);
    expect(visibleDockRuns(observed, active, 100_000)).toEqual(active);
    const ended = observeDockRuns(observed, finished, 500);
    expect(observed.get(active[0]!.key)).toEqual({ active: true });
    expect(observeDockRuns(ended, finished, 1_000)).toBe(ended);
    expect(nextDockExpiry(ended, finished, 500)).toBe(10_500);
    expect(visibleDockRuns(ended, finished, 10_499)).toEqual(finished);
    expect(visibleDockRuns(ended, finished, 10_500)).toEqual([]);
    expect(nextDockExpiry(ended, finished, 10_500)).toBeNull();
  });

  test("pin survives expiry; dismissal beats pin and never mutates source", () => {
    const items = runs("finished");
    const key = items[0]!.key;
    const observed = observeDockRuns(
      observeDockRuns(empty, runs(), 0),
      items,
      20,
    );
    expect(visibleDockRuns(observed, items, 50_000, key)).toEqual(items);
    expect(nextDockExpiry(observed, items, 20, key)).toBeNull();
    const dismissed = dismissDockRun(observed, key);
    expect(visibleDockRuns(dismissed, items, 21, key)).toEqual([]);
    expect(nextDockExpiry(dismissed, items, 21)).toBeNull();
    expect(observed.get(key)?.dismissed).toBeUndefined();
    expect(items[0]!.run.state).toEqual({ phase: "finished" });
    expect(dismissDockRun(dismissed, key)).toBe(dismissed);
    expect(dismissDockRun(dismissed, "absent")).toBe(dismissed);
  });

  test("repeated active snapshots retain dismissal; actual reactivation resets it", () => {
    const active = runs();
    const key = active[0]!.key;
    const dismissed = dismissDockRun(observeDockRuns(empty, active, 0), key);
    expect(observeDockRuns(dismissed, active, 20)).toBe(dismissed);
    expect(visibleDockRuns(dismissed, active, 20)).toEqual([]);
    const ended = observeDockRuns(dismissed, runs("finished"), 30);
    const resumed = observeDockRuns(ended, runs("paused"), 40);
    expect(resumed.get(key)).toEqual({ active: true });
    expect(visibleDockRuns(resumed, active, 40)).toEqual(active);
    expect(nextDockExpiry(resumed, active, 40)).toBeNull();
    const pruned = observeDockRuns(resumed, [], 50);
    expect(pruned.size).toBe(0);
    expect(resumed.size).toBe(1);
    expect(observeDockRuns(pruned, [], 60)).toBe(pruned);
    expect(
      visibleDockRuns(
        observeDockRuns(pruned, runs("finished"), 60),
        runs("finished"),
        60,
      ),
    ).toEqual([]);
  });

  test("losing live freshness gives grace without fabricating terminal success", () => {
    const saved = runs("running", "saved");
    const observed = observeDockRuns(
      observeDockRuns(empty, runs(), 0),
      saved,
      100,
    );
    expect(observed.get(saved[0]!.key)).toEqual({
      active: false,
      endedAt: 100,
    });
    expect(
      visibleDockRuns(observed, saved, 101)[0]!.envelope.view.source.freshness,
    ).toBe("saved");
    expect(saved[0]!.run.state).toEqual({ phase: "running" });
    expect(visibleDockRuns(observed, saved, 10_100)).toEqual([]);
  });

  test("expiry selects earliest future unpinned, undismissed run in snapshot", () => {
    const items = [
      runs()[0]!,
      { ...runs()[0]!, key: "second" },
      { ...runs()[0]!, key: "third" },
    ];
    const visibility: RunVisibility = new Map([
      [items[0]!.key, { active: false, endedAt: 10 }],
      ["second", { active: false, endedAt: 20 }],
      ["third", { active: false, endedAt: 30, dismissed: true }],
      ["vanished", { active: false, endedAt: 0 }],
    ]);
    expect(nextDockExpiry(visibility, items, 50)).toBe(10_010);
    expect(nextDockExpiry(visibility, items, 50, items[0]!.key)).toBe(10_020);
    expect(nextDockExpiry(visibility, items, 10_010)).toBe(10_020);
  });
});

test("run keys namespace adapters, views, generations and reused invocation IDs", () => {
  const run: RunRecord = {
    id: "r:[]",
    title: "Run",
    state: { phase: "running" },
  };
  const first = envelope(
    { ...base, id: "v:a", kind: "agents", runs: [run] },
    "a",
  );
  const second = envelope(
    { ...base, id: "a", kind: "background", runs: [run] },
    "a:v",
  );
  const items = dockRuns(
    state([
      first,
      second,
      { ...first, adapterId: "b" },
      {
        ...first,
        view: { ...first.view, id: "other" },
      },
    ]),
  );
  expect(new Set(items.map((item) => item.key)).size).toBe(4);
  expect(items.map((item) => item.kind)).toEqual([
    "agents",
    "background",
    "agents",
    "agents",
  ]);
  expect(items[0]!.key).toBe(
    JSON.stringify(["generation", "a", "v:a", "r:[]", null]),
  );
  expect(dockRuns(state([first], "new"))[0]!.key).not.toBe(items[0]!.key);
  const reused = dockRuns(
    state([
      envelope(
        {
          ...base,
          id: "v:a",
          kind: "agents",
          runs: [{ ...run, startedAt: "later" }],
        },
        "a",
      ),
    ]),
  );
  expect(reused[0]!.key).not.toBe(items[0]!.key);
  const dismissed = dismissDockRun(
    observeDockRuns(empty, [items[0]!], 0),
    items[0]!.key,
  );
  const next = observeDockRuns(dismissed, reused, 10);
  expect(next.has(items[0]!.key)).toBe(false);
  expect(visibleDockRuns(next, reused, 10)).toEqual(reused);
  expect(items[0]!.envelope).toBe(first);
});

test("all nine model kinds partition correctly and empty content stays out", () => {
  const views: SessionView[] = [
    { ...base, kind: "todo", items: [] },
    { ...base, kind: "agents", runs: [] },
    { ...base, kind: "background", runs: [] },
    { ...base, kind: "schedule", schedules: [] },
    { ...base, kind: "annotations", threads: [] },
    { ...base, kind: "status", text: " \n", tone: "info" },
    {
      ...base,
      kind: "document",
      text: "\t",
      resource: { kind: "document", id: "d" },
      format: "text",
      stage: "unknown",
    },
    { ...base, kind: "goal", objective: " ", state: { phase: "unknown" } },
    { ...base, kind: "mode", axis: "mode", value: null, choices: [] },
  ];
  const snapshot = state(views.map((view) => envelope(view)));
  expect(dockOtherViews(snapshot).map(({ view }) => view.kind)).toEqual([
    "mode",
  ]);
  expect(dockTodos(snapshot)).toEqual([]);
  expect(dockRuns(snapshot)).toEqual([]);
  const populated = views.slice(3).map((view): SessionView => {
    switch (view.kind) {
      case "schedule":
        return {
          ...view,
          schedules: [
            {
              id: "s",
              title: "s",
              enabled: null,
              timing: { kind: "opaque", description: "custom" },
            },
          ],
        };
      case "annotations":
        return {
          ...view,
          threads: [
            {
              id: "t",
              state: "unknown",
              comments: [],
              target: {
                resource: { kind: "file", id: "f" },
                resolution: "unresolved",
              },
            },
          ],
        };
      case "status":
      case "document":
        return { ...view, text: "Content" };
      case "goal":
        return { ...view, objective: "Goal" };
      default:
        return view;
    }
  });
  expect(
    dockOtherViews(state(populated.map((view) => envelope(view)))),
  ).toHaveLength(6);
  expect(dockTodos(state([todos("pending")]))).toHaveLength(1);
  expect(dockRuns(undefined)).toEqual([]);
  expect(dockTodos(undefined)).toEqual([]);
  expect(dockOtherViews(undefined)).toEqual([]);
});

test("todo summaries preserve original total and cancelled denominator semantics", () => {
  const summary = dockTodoSummary([
    todos("completed", "cancelled", "active", "unknown"),
    todos("active", "pending"),
  ]);
  expect(summary).toEqual({
    total: 6,
    completed: 1,
    cancelled: 1,
    remaining: 4,
    current: "Todo 2",
    activeCount: 2,
    symbol: "◐",
    finished: false,
  });
  expect(summary.total - summary.cancelled).toBe(5);
  expect(dockTodoSummary([todos("completed", "cancelled")])).toMatchObject({
    total: 2,
    completed: 1,
    cancelled: 1,
    remaining: 0,
    finished: true,
    symbol: "✓",
  });
  expect(dockTodoSummary([todos("cancelled", "cancelled")])).toMatchObject({
    total: 2,
    completed: 0,
    remaining: 0,
    symbol: "⊘",
    finished: true,
  });
  expect(dockTodoSummary([todos("unknown")])).toMatchObject({
    remaining: 1,
    completed: 0,
    finished: false,
    symbol: "◐",
    current: undefined,
  });
  expect(dockTodoSummary([])).toMatchObject({
    total: 0,
    remaining: 0,
    activeCount: 0,
    current: undefined,
  });
});

test("tab fallback respects valid remembered choice, activity and availability order", () => {
  expect(resolveDockTab("info", ["todo", "tasks", "info"], 2, 2)).toBe("info");
  expect(resolveDockTab("todo", ["todo", "tasks"], 2, 0)).toBe("todo");
  expect(resolveDockTab("info", ["todo", "tasks"], 2, 2)).toBe("tasks");
  expect(resolveDockTab(null, ["info", "todo", "tasks"], 0, 2)).toBe("todo");
  expect(resolveDockTab("tasks", ["info", "todo"], 3, 0)).toBe("info");
  expect(resolveDockTab(null, ["tasks", "todo"], 0, 0)).toBe("tasks");
  expect(resolveDockTab("tasks", [], 3, 2)).toBeNull();
});
