import { describe, expect, test } from "bun:test";
import {
  type SessionView,
  viewActions,
} from "../../../../packages/config/src/models";
import {
  validateJson,
  validateView,
} from "../../../../packages/config/src/validate";

const source = {
  label: "fixture",
  scope: { kind: "session", id: "session-1" },
  freshness: "saved",
  observedAt: "2026-01-02T03:04:05Z",
} as const;
const base = { id: "view", title: "Session data", source };
const action = {
  id: "act",
  label: "Continue",
  command: "continue",
  input: { value: null },
  disabled: "Not available",
  confirmation: "Continue?",
  fields: [{ name: "note", label: "Note", required: true, multiline: false }],
};
const resource = {
  kind: "file",
  id: "src/main.ts",
  label: "main",
  revision: "sha:old",
} as const;
const run = {
  id: "invocation-1",
  title: "Run",
  state: { phase: "finished", outcome: "interrupted", label: "Stopped" },
  startedAt: "2026-01-02T03:04:05Z",
  endedAt: "2026-01-02T03:04:06Z",
  detail: "Details",
  output: { text: "partial output", truncated: true, stream: "combined" },
  origin: resource,
  actions: [action],
  facts: [{ label: "Backend", value: "native" }],
} as const;

// These mappings describe the source's identity semantics, not a universal task engine.
const piTodo: SessionView = {
  ...base,
  kind: "todo",
  explanation: "Pi boolean completion",
  items: [{ id: "pi:1", title: "Write test", completed: true }].map((item) => ({
    id: item.id,
    identity: "native",
    title: item.title,
    state: item.completed ? "completed" : "pending",
  })),
};
const codexTodo: SessionView = {
  ...base,
  kind: "todo",
  explanation: "Ordinals identify items only inside this snapshot",
  items: ["Plan", "Implement"].map((title, ordinal) => ({
    id: `snapshot-7:${ordinal}`,
    identity: "snapshot",
    title,
    state: "pending",
  })),
};
const claudeTodo: SessionView = {
  ...base,
  kind: "todo",
  source: { ...source, scope: { kind: "shared", id: "team-list" } },
  items: [
    {
      id: "task-1",
      identity: "native",
      title: "Build",
      state: "active",
      stateLabel: "in progress",
      description: "Build package",
      activeLabel: "Building",
      owner: "worker",
      availability: "blocked",
      dependsOn: ["task-2", "external-task"],
      actions: [action],
    },
    {
      id: "task-2",
      identity: "native",
      title: "Test",
      state: "unknown",
      dependsOn: ["external-task"],
    },
  ],
};
const agents: SessionView = {
  ...base,
  kind: "agents",
  relations: [{ kind: "resumes", from: "invocation-1", to: "external-run" }],
  runs: [
    {
      ...run,
      actions: [action],
      facts: [...run.facts],
      agentId: "worker",
      profile: "reviewer",
      task: "Review",
      model: "source-model",
      session: { kind: "session", id: "conversation" },
      parentId: "external-parent",
      previousRunId: "external-run",
      dependsOn: ["external-run", "other-branch"],
    },
    {
      id: "invocation-2",
      title: "Resumed",
      state: { phase: "waiting" },
      agentId: "worker",
      session: { kind: "session", id: "conversation" },
      previousRunId: "invocation-1",
    },
  ],
};
const background: SessionView = {
  ...base,
  kind: "background",
  runs: [
    {
      ...run,
      actions: [action],
      facts: [...run.facts],
      command: "pnpm test",
      cwd: "C:\\project",
      processId: "opaque-pid",
      exit: { code: -1, signal: "SIGTERM" },
      lifetime: "host",
    },
  ],
};
const schedule: SessionView = {
  ...base,
  kind: "schedule",
  schedules: [
    {
      id: "cron",
      title: "Cron",
      enabled: null,
      timing: {
        kind: "cron",
        expression: "source-specific expression",
        timezone: "opaque/vendor-zone",
      },
      nextRunAt: "2026-01-03T03:04:05Z",
      lifetime: "source-defined",
      policy: "manual",
      actions: [action],
      runs: [
        {
          id: "history-1",
          title: "Previous",
          state: { phase: "finished", outcome: "error" },
        },
        { id: "history-2", title: "Retry", state: { phase: "running" } },
      ],
    },
    {
      id: "once",
      title: "Once",
      enabled: false,
      timing: { kind: "once", at: "2026-01-01T00:00:00Z" },
    },
    {
      id: "interval",
      title: "Interval",
      enabled: true,
      timing: {
        kind: "interval",
        milliseconds: 0.5,
        anchor: "2026-01-01T00:00:00Z",
      },
    },
    {
      id: "opaque",
      title: "Opaque",
      enabled: null,
      timing: { kind: "opaque", description: "after source-specific event" },
    },
  ],
};
const mode: SessionView = {
  ...base,
  kind: "mode",
  axis: "permissions",
  value: null,
  description: "Not reported",
  choices: [
    { id: "ask", label: "Ask", action },
    { id: "custom", label: "Source-defined" },
  ],
};
const goal: SessionView = {
  ...base,
  kind: "goal",
  objective: "Finish",
  state: { phase: "paused", outcome: "unknown" },
  reason: "Budget",
  measures: [{ label: "Spent", value: 12.5, unit: "USD", limit: 10 }],
};
const annotations: SessionView = {
  ...base,
  kind: "annotations",
  threads: [
    {
      id: "thread-1",
      state: "open",
      target: {
        resource,
        resolution: "exact",
        range: { kind: "text", start: 0, end: 2, unit: "unicode-codepoint" },
        quote: { exact: "😀x", prefix: "", suffix: "tail" },
      },
      comments: [
        {
          id: "comment-1",
          body: "Review",
          author: "Alice",
          createdAt: "2026-01-02T00:00:00Z",
        },
      ],
      actions: [action],
    },
    {
      id: "thread-2",
      state: "unknown",
      target: {
        resource: { kind: "diff", id: "diff" },
        resolution: "outdated",
        range: { kind: "lines", start: 1, end: 2, side: "before" },
      },
      comments: [],
    },
    {
      id: "thread-3",
      state: "resolved",
      target: {
        resource: { kind: "document", id: "gone" },
        resolution: "unresolved",
      },
      comments: [],
    },
  ],
};
const document: SessionView = {
  ...base,
  kind: "document",
  resource,
  text: "# Draft\n",
  format: "markdown",
  stage: "draft",
};
const status: SessionView = {
  ...base,
  kind: "status",
  text: "Unknown backend state",
  tone: "warning",
};
const fixtures = [
  piTodo,
  codexTodo,
  claudeTodo,
  agents,
  background,
  schedule,
  mode,
  goal,
  annotations,
  document,
  status,
];

function changed(view: SessionView, path: string, value: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  const keys = path.split(".");
  let target = clone;
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]] = value;
  return clone;
}

describe("validated session snapshots", () => {
  for (const [i, fixture] of fixtures.entries())
    test(`${fixture.kind} fixture ${i} round trips`, () => {
      const result = validateView(fixture);
      expect(result).toEqual(fixture);
      expect(result).not.toBe(fixture);
      expect(result.source).not.toBe(fixture.source);
      expect(validateView(JSON.parse(JSON.stringify(result)))).toEqual(fixture);
      expect(() => validateJson(result)).not.toThrow();
    });

  test("preserves extensions and safely omits optional undefined fields", () => {
    const original = {
      ...status,
      origin: undefined,
      vendor: { flag: false, absent: undefined, values: [1, null] },
      ...JSON.parse('{"__proto__":{"safe":true}}'),
    };
    const clone = validateView(original);
    expect(clone).toEqual(JSON.parse(JSON.stringify(original)));
    expect(Object.hasOwn(clone, "origin")).toBe(false);
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
    original.vendor.values.push(2);
    expect(JSON.stringify(clone)).not.toContain("[1,null,2]");
    expect(() => validateJson({ optional: undefined })).not.toThrow();
    expect(() =>
      validateJson(Object.assign(Object.create(null), { okay: 1 })),
    ).not.toThrow();
  });

  test("resumed agents keep invocation, definition and conversation IDs distinct", () => {
    const result = validateView(agents);
    if (result.kind !== "agents") throw new Error("wrong kind");
    expect(result.runs.map((r) => r.id)).toEqual([
      "invocation-1",
      "invocation-2",
    ]);
    expect(result.runs.map((r) => r.agentId)).toEqual(["worker", "worker"]);
    expect(result.runs[1].previousRunId).toBe("invocation-1");
    expect(result.runs[0].state).toEqual(run.state);
  });

  test("annotations keep original anchors without relocating or interpreting units", () => {
    const result = validateView(annotations);
    expect(result).toEqual(annotations);
    expect(
      validateView(
        changed(annotations, "threads.0.target.range.unit", "utf16"),
      ),
    ).toBeDefined();
    expect(
      validateView(changed(annotations, "threads.0.target.range", undefined)),
    ).toBeDefined();
  });

  test("does not infer transitions, dependency locality, schedule execution or budget policy", () => {
    expect(() =>
      validateView(
        changed(agents, "runs.0.state", {
          phase: "running",
          outcome: "success",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateView(
        changed(claudeTodo, "items.1.dependsOn", ["task-1", "external"]),
      ),
    ).not.toThrow();
    expect(() =>
      validateView(
        changed(schedule, "schedules.0.timing.timezone", "not-an-IANA-zone"),
      ),
    ).not.toThrow();
    expect(() => validateView(goal)).not.toThrow(); // value may exceed limit
  });
});

const malformed: [SessionView, string, unknown][] = [
  [status, "id", " "],
  [status, "title", 1],
  [status, "kind", "unknown"],
  [status, "source.label", null],
  [status, "source.scope.kind", "machine"],
  [status, "source.scope.id", ""],
  [status, "source.freshness", "fresh"],
  [status, "source.observedAt", "not-a-date"],
  [status, "origin", { kind: "file" }],
  [status, "facts", [{ label: "x", value: 1 }]],
  [status, "text", {}],
  [status, "tone", "green"],
  [status, "title", "x".repeat(16_385)],
  [claudeTodo, "items.0.id", ""],
  [claudeTodo, "items.0.identity", "stable"],
  [claudeTodo, "items.0.state", true],
  [claudeTodo, "items.0.title", null],
  [claudeTodo, "items.0.stateLabel", false],
  [claudeTodo, "items.0.description", []],
  [claudeTodo, "items.0.activeLabel", 2],
  [claudeTodo, "items.0.owner", {}],
  [claudeTodo, "items.0.availability", false],
  [claudeTodo, "items.0.dependsOn", ["ok", 3]],
  [claudeTodo, "items.0.actions.0.command", undefined],
  [claudeTodo, "items.0.actions.0.label", null],
  [claudeTodo, "items.0.actions.0.disabled", false],
  [claudeTodo, "items.0.actions.0.confirmation", false],
  [claudeTodo, "items.0.actions.0.fields.0.required", "yes"],
  [claudeTodo, "items.0.actions.0.fields.0.multiline", 1],
  [claudeTodo, "items.0.actions.0.fields.0.name", ""],
  [claudeTodo, "items.0.actions.0.fields.0.label", {}],
  [agents, "runs.0.state.phase", "done"],
  [agents, "runs.0.state.outcome", "done"],
  [agents, "runs.0.state.label", false],
  [agents, "runs.0.startedAt", false],
  [agents, "runs.0.endedAt", "yesterday-ish"],
  [agents, "runs.0.detail", []],
  [agents, "runs.0.output.text", 1],
  [agents, "runs.0.output.truncated", "true"],
  [agents, "runs.0.output.stream", "other"],
  [agents, "runs.0.origin.kind", "image"],
  [agents, "runs.0.facts.0.label", null],
  [agents, "runs.0.agentId", ""],
  [agents, "runs.0.session.id", ""],
  [agents, "runs.0.parentId", 1],
  [agents, "runs.0.dependsOn", [null]],
  [agents, "runs.0.previousRunId", false],
  [agents, "runs.0.profile", {}],
  [agents, "runs.0.task", false],
  [agents, "runs.0.model", []],
  [agents, "relations.0.from", ""],
  [agents, "relations.0.to", null],
  [agents, "relations.0.kind", 1],
  [background, "runs.0.exit.code", 1.5],
  [background, "runs.0.exit.signal", true],
  [background, "runs.0.lifetime", "forever"],
  [background, "runs.0.command", []],
  [background, "runs.0.cwd", 1],
  [background, "runs.0.processId", {}],
  [schedule, "schedules.0.enabled", "yes"],
  [schedule, "schedules.0.timing.timezone", {}],
  [schedule, "schedules.0.timing.expression", 1],
  [schedule, "schedules.0.nextRunAt", "never"],
  [schedule, "schedules.0.lifetime", 1],
  [schedule, "schedules.0.policy", {}],
  [schedule, "schedules.0.runs.0.state", {}],
  [schedule, "schedules.1.timing.at", null],
  [schedule, "schedules.2.timing.milliseconds", 0],
  [schedule, "schedules.2.timing.milliseconds", -1],
  [schedule, "schedules.2.timing.anchor", 1],
  [schedule, "schedules.3.timing.description", null],
  [schedule, "schedules.3.timing.kind", "event"],
  [mode, "value", false],
  [mode, "axis", []],
  [mode, "choices.0.label", {}],
  [mode, "choices.0.action.command", ""],
  [goal, "objective", {}],
  [goal, "measures.0.value", -1],
  [goal, "measures.0.limit", -1],
  [goal, "measures.0.unit", 1],
  [goal, "reason", false],
  [annotations, "threads.0.target.resolution", "current"],
  [annotations, "threads.0.target.resource.revision", undefined],
  [annotations, "threads.0.target.range.start", -1],
  [annotations, "threads.0.target.range.start", 2],
  [annotations, "threads.0.target.range.end", 0],
  [annotations, "threads.0.target.range.end", 0.5],
  [annotations, "threads.0.target.range.unit", "bytes"],
  [annotations, "threads.1.target.range.start", 0],
  [annotations, "threads.1.target.range.side", "left"],
  [annotations, "threads.0.target.quote.exact", null],
  [annotations, "threads.0.target.quote.prefix", []],
  [annotations, "threads.0.target.quote.suffix", 1],
  [annotations, "threads.0.state", "closed"],
  [annotations, "threads.0.comments.0.body", {}],
  [annotations, "threads.0.comments.0.author", false],
  [annotations, "threads.0.comments.0.createdAt", "bad"],
  [document, "resource", null],
  [document, "format", "html"],
  [document, "stage", "published"],
];

describe("malformed consumed fields", () => {
  for (const [i, [view, path, value]] of malformed.entries())
    test(`${i}: ${view.kind}.${path}`, () => {
      expect(() => validateView(changed(view, path, value))).toThrow();
    });
  test("required collections and nested objects cannot be absent or malformed", () => {
    for (const [view, path] of [
      [piTodo, "items"],
      [agents, "runs"],
      [background, "runs"],
      [schedule, "schedules"],
      [mode, "choices"],
      [annotations, "threads"],
      [goal, "state"],
      [status, "source"],
    ] as const)
      for (const value of [undefined, null, 1])
        expect(() => validateView(changed(view, path, value))).toThrow();
  });
  test("IDs and action field names are unique within collections", () => {
    for (const [view, path, duplicate] of [
      [claudeTodo, "items.1.id", "task-1"],
      [agents, "runs.1.id", "invocation-1"],
      [schedule, "schedules.1.id", "cron"],
      [schedule, "schedules.0.runs.1.id", "history-1"],
      [mode, "choices.1.id", "ask"],
      [annotations, "threads.1.id", "thread-1"],
      [
        annotations,
        "threads.0.comments",
        [
          { id: "c", body: "a" },
          { id: "c", body: "b" },
        ],
      ],
      [
        claudeTodo,
        "items.0.actions.0.fields",
        [action.fields[0], action.fields[0]],
      ],
    ] as const)
      expect(() => validateView(changed(view, path, duplicate))).toThrow();
  });
  test("actions are unique over the entire view, including schedule history and choices", () => {
    for (const fixture of [
      claudeTodo,
      agents,
      background,
      schedule,
      mode,
      annotations,
    ]) {
      expect(viewActions(fixture)).toHaveLength(1);
      expect(() => validateView({ ...fixture, actions: [action] })).toThrow(
        /duplicate action/,
      );
    }
    expect(() =>
      validateView(changed(schedule, "schedules.0.runs.0.actions", [action])),
    ).toThrow(/duplicate action/);
  });
});

describe("bounded plain JSON", () => {
  test("rejects non-JSON values, custom prototypes, getters, holes and cycles", () => {
    class Custom {
      value = 1;
    }
    class CustomArray extends Array {}
    let getterCalled = false;
    let toJSONCalled = false;
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const values = [
      undefined,
      () => 1,
      Symbol("x"),
      1n,
      NaN,
      Infinity,
      -Infinity,
      new Date(),
      new Map(),
      new Set(),
      new Custom(),
      new CustomArray(),
      cyclic,
      [undefined],
      Array(1),
      { [Symbol("x")]: 1 },
      {
        toJSON() {
          toJSONCalled = true;
          return {};
        },
      },
      {
        get value() {
          getterCalled = true;
          return 1;
        },
      },
      Object.defineProperty({}, "hidden", { value: 1 }),
      Object.assign([], { extra: true }),
    ];
    for (const value of values) {
      expect(() => validateJson(value)).toThrow();
      expect(() =>
        validateView({
          ...status,
          extension: value === undefined ? [undefined] : value,
        }),
      ).toThrow();
    }
    expect(getterCalled).toBe(false);
    expect(toJSONCalled).toBe(false);
    const shared = { okay: true };
    expect(() => validateJson({ left: shared, right: shared })).not.toThrow();
  });
  test("enforces depth, array count and UTF-8 serialized byte limits", () => {
    let nested: unknown = null;
    for (let i = 0; i < 32; i++) nested = [nested];
    expect(() => validateJson(nested)).not.toThrow();
    expect(() => validateJson([nested])).toThrow(/depth/);
    expect(() => validateJson(Array(10_000).fill(null))).not.toThrow();
    expect(() => validateJson(Array(10_001).fill(null))).toThrow(/10000/);
    expect(() => validateJson("a".repeat(1024 * 1024 - 2))).not.toThrow();
    expect(() => validateJson("a".repeat(1024 * 1024 - 1))).toThrow(/1MB/);
    expect(() => validateJson("😀".repeat(300_000))).toThrow(/1MB/);
    expect(() => validateJson("\u0000".repeat(200_000))).toThrow(/1MB/);
    expect(() =>
      validateView({ ...document, text: "x".repeat(1024 * 1024) }),
    ).toThrow(/1MB/);
    expect(() =>
      validateView({
        ...goal,
        measures: [{ label: "x", unit: "u", value: Infinity }],
      }),
    ).toThrow();
    expect(() =>
      validateView({ ...background, runs: [{ ...run, exit: { code: NaN } }] }),
    ).toThrow();
  });
});
