import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  Action,
  AgentRun,
  SessionUIState,
  SessionView,
  ViewEnvelope,
  WorkItem,
} from "../../../../packages/config/src";
import {
  actionDisabledReason,
  actionRequest,
  agentDepths,
  envelopeKey,
  timingLabel,
  todoProgress,
} from "./session-panel-model";

// Markdown's existing renderer imports the desktop bridge. No browser or host is
// available in SSR tests; keep the real Markdown renderer, stub only its bridge.
mock.module("./rpc", () => ({
  rpc: { send: {} },
  openChatLink: async () => {},
  regenerate: async () => {},
}));
const { SessionPanel } = await import("./SessionPanel");
const source = {
  label: "Task adapter",
  scope: { kind: "session" as const, id: "session-one" },
  freshness: "saved" as const,
  observedAt: "source-time",
};
const base = { id: "view-one", title: "Session facts", source };
const noop = async () => {};
const envelope = (view: SessionView): ViewEnvelope => ({
  adapterId: "adapter-one",
  revision: 7,
  view,
});
function stateFor(...views: SessionView[]): SessionUIState {
  return {
    generation: "generation-one",
    views: views.map(envelope),
    commands: [],
    keymaps: [],
    diagnostics: [],
  };
}
function render(...views: SessionView[]) {
  return renderToStaticMarkup(
    <SessionPanel state={stateFor(...views)} onAction={noop} onReload={noop} />,
  );
}
const action: Action = {
  id: "act",
  label: "Apply change",
  command: "apply",
  input: { hostOnly: true },
};
const status: SessionView = {
  ...base,
  kind: "status",
  tone: "warning",
  text: "Source warning",
};

test("empty dock is absent; connection failures remain available without a permanent config toolbar", () => {
  expect(
    renderToStaticMarkup(<SessionPanel onAction={noop} onReload={noop} />),
  ).toBe("");
  const html = renderToStaticMarkup(
    <SessionPanel
      onAction={noop}
      onReload={noop}
      configError="Invalid config"
    />,
  );
  for (const text of [
    "Session activity",
    'aria-expanded="false"',
    "aria-controls=",
    "UI connection needs attention",
    "Invalid config",
    "Connection details",
    "Reload UI config",
    'hidden=""',
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Session 0");
  expect(html).not.toContain("session-panel-header");
});

test("todo preserves order, ownership and dependencies; cancelled is not completed", () => {
  const items: WorkItem[] = [
    {
      id: "first",
      identity: "native",
      title: "Completed item",
      state: "completed",
    },
    {
      id: "second",
      identity: "snapshot",
      title: "Cancelled item",
      state: "cancelled",
      owner: "Pat",
      dependsOn: ["first"],
      availability: "blocked",
    },
    {
      id: "third",
      identity: "native",
      title: "Active item",
      state: "active",
      activeLabel: "Checking",
    },
  ];
  expect(todoProgress(items)).toEqual({ total: 3, completed: 1, cancelled: 1 });
  const html = render({ ...base, kind: "todo", items });
  for (const text of [
    "1/2 done",
    "<ul",
    "is-cancelled",
    "Owner",
    "Pat",
    "Depends on",
    "Checking",
    "blocked",
  ])
    expect(html).toContain(text);
  expect(html.indexOf("Completed item")).toBeLessThan(
    html.indexOf("Cancelled item"),
  );
  expect(html.indexOf("Cancelled item")).toBeLessThan(
    html.indexOf("Active item"),
  );
  expect(todoProgress([])).toEqual({ total: 0, completed: 0, cancelled: 0 });
});

test("agent indentation is bounded and graph safe for missing parents, self links, cycles and deep chains", () => {
  const run = (id: string, parentId?: string): AgentRun => ({
    id,
    parentId,
    title: id,
    state: { phase: "running" },
  });
  expect(
    agentDepths([
      run("a"),
      run("b", "a"),
      run("orphan", "absent"),
      run("self", "self"),
    ]),
  ).toEqual([0, 1, 0, 0]);
  expect(agentDepths([run("a", "b"), run("b", "a")])).toEqual([1, 1]);
  const deep = Array.from({ length: 100 }, (_, index) =>
    run(String(index), index ? String(index - 1) : undefined),
  );
  expect(Math.max(...agentDepths(deep))).toBe(6);
});

test("saved agent history stays out of the dock; live agent rows are compact and logs start closed", () => {
  const history: SessionView = {
    ...base,
    kind: "agents",
    runs: [
      {
        id: "run-2",
        agentId: "worker-7",
        title: "Review",
        state: { phase: "finished", outcome: "error" },
        output: { text: "Failure log", stream: "stderr", truncated: true },
      },
    ],
  };
  expect(render(history)).toBe("");
  const html = render({
    ...history,
    source: { ...source, freshness: "live" },
    runs: history.runs.map((run) => ({ ...run, state: { phase: "running" } })),
  });
  for (const text of [
    "Review",
    "Running",
    "1 active",
    "session-task-row",
    'aria-expanded="false"',
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Failure log");
  expect(html).not.toContain("Run ID");
  expect(html).not.toContain("worker-7");
});

test("background history does not flash; live command rows retain view and run actions without displaying unselected output", () => {
  const history: SessionView = {
    ...base,
    kind: "background",
    runs: [
      {
        id: "process-run",
        title: "Build",
        state: { phase: "finished", outcome: "success" },
        command: "bun build",
        exit: { code: 0 },
        output: { text: "Build result" },
      },
    ],
  };
  expect(render(history)).toBe("");
  const html = render({
    ...history,
    source: { ...source, freshness: "live" },
    actions: [{ id: "all", label: "All tasks", command: "all" }],
    runs: history.runs.map((run) => ({
      ...run,
      actions: [{ id: "stop", label: "Stop build", command: "stop" }],
      state: { phase: "queued" },
    })),
  });
  for (const text of [
    "bun build",
    "Queued",
    "Exit code 0",
    "All tasks",
    "Stop build",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Build result");
  expect(html).not.toContain("0 active");
});

test("schedule timing is source text, enabled unknown and history independent of next run", () => {
  expect(
    timingLabel({
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "Asia/Tokyo",
    }),
  ).toBe("Cron · 0 9 * * * · timezone Asia/Tokyo");
  expect(
    timingLabel({
      kind: "interval",
      milliseconds: 1500,
      anchor: "opaque-anchor",
    }),
  ).toBe("Interval · 1500 ms · anchor opaque-anchor");
  expect(timingLabel({ kind: "once", at: "not-a-date" })).toBe(
    "Once · not-a-date",
  );
  expect(
    timingLabel({ kind: "opaque", description: "When upstream is ready" }),
  ).toBe("When upstream is ready");
  const html = render({
    ...base,
    kind: "schedule",
    schedules: [
      {
        id: "timer",
        title: "Check",
        enabled: null,
        timing: { kind: "opaque", description: "Adapter-defined timing" },
        nextRunAt: "source-next-run",
        runs: [
          {
            id: "history",
            title: "Prior invocation",
            state: { phase: "running" },
          },
        ],
      },
    ],
  });
  for (const text of [
    "Enabled state unknown",
    "Adapter-defined timing",
    "source-next-run",
    "Run history (1)",
    "Prior invocation",
    "running",
  ])
    expect(html).toContain(text);
});

test("mode choices show authoritative current value and goal renders phase/outcome and measures", () => {
  const html = render(
    {
      ...base,
      kind: "mode",
      axis: "review",
      value: "careful",
      choices: [
        { id: "careful", label: "Careful" },
        { id: "fast", label: "Fast", action },
      ],
    },
    {
      ...base,
      id: "goal",
      kind: "goal",
      objective: "Ship safely",
      state: { phase: "finished", outcome: "cancelled" },
      reason: "Paused by owner",
      measures: [{ label: "Budget", value: 0, unit: "tokens", limit: 200 }],
    },
  );
  for (const text of [
    "Current value",
    "careful",
    "Current</span>",
    "Ship safely",
    "finished · cancelled",
    "Paused by owner",
    "0 / 200 tokens",
  ])
    expect(html).toContain(text);
});

test("annotations keep target resolution, revision, range and quote separate from thread state; refs inert", () => {
  const html = render({
    ...base,
    kind: "annotations",
    threads: [
      {
        id: "thread-one",
        state: "resolved",
        target: {
          resource: {
            kind: "url",
            id: "https://untrusted.example/file",
            revision: "old-revision",
          },
          resolution: "outdated",
          range: { kind: "text", start: 1, end: 8, unit: "unicode-codepoint" },
          quote: { prefix: "before", exact: "Quoted text", suffix: "after" },
        },
        comments: [
          {
            id: "comment",
            author: "Pat",
            createdAt: "comment-time",
            body: "<script>unsafe()</script>",
          },
        ],
        actions: [action],
      },
    ],
  });
  for (const text of [
    "Thread state: resolved",
    "Target resolution",
    "outdated",
    "revision old-revision",
    "text 1–8 · unicode-codepoint",
    "Quoted text",
    "before",
    "after",
    "Pat",
    "comment-time",
    "&lt;script&gt;",
    "Apply change",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<script>");
});

test("documents use real Markdown safely, text stays literal, stages remain distinct, status has tone", () => {
  const html = render(
    {
      ...base,
      kind: "document",
      resource: { kind: "file", id: "/not-read" },
      stage: "draft",
      format: "markdown",
      text: "**Rich text**\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)",
    },
    {
      ...base,
      id: "text",
      kind: "document",
      resource: { kind: "document", id: "plain-doc" },
      stage: "final",
      format: "text",
      text: "**Not bold** <img src=x>",
    },
    status,
  );
  for (const text of [
    "<strong>Rich text</strong>",
    "session-stage-draft",
    "session-stage-final",
    "**Not bold** &lt;img src=x&gt;",
    "session-tone-warning",
    "Source warning",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
});

test("source, diagnostics, commands and keymaps expose adapter connections without executing anything", () => {
  let calls = 0;
  const state = stateFor(status);
  state.diagnostics = [{ adapterId: "adapter-one", message: "Stale source" }];
  state.commands = [
    { adapterId: "adapter-one", id: "apply", title: "Apply", busy: true },
  ];
  state.keymaps = [
    { adapter: "adapter-one", command: "apply", keys: "ctrl+k", when: "panel" },
  ];
  const html = renderToStaticMarkup(
    <SessionPanel
      state={state}
      onAction={async () => {
        calls++;
      }}
      onReload={async () => {
        calls++;
      }}
    />,
  );
  for (const text of [
    "Task adapter",
    "saved",
    "Revision",
    ">7<",
    "Stale source",
    "Connection details",
    "adapter-one/apply",
    'aria-busy="true"',
    "ctrl+k",
    "panel",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Request pending");
  expect(calls).toBe(0);
});

test("actions resolve commands per adapter; disabled reasons, busy, missing commands and labeled fields render", () => {
  const state = stateFor({
    ...status,
    actions: [
      { ...action, id: "busy" },
      { ...action, id: "disabled", disabled: "Read-only source" },
      {
        ...action,
        id: "missing",
        command: "missing",
        fields: [
          {
            name: "body",
            label: "Comment body",
            required: true,
            multiline: true,
          },
        ],
      },
    ],
  });
  const env = state.views[0];
  if (!env) throw new Error("Missing test view");
  state.commands = [
    {
      adapterId: "other-adapter",
      id: "apply",
      title: "Wrong adapter",
      busy: false,
    },
  ];
  expect(actionDisabledReason(state, env, action)).toBe(
    "Command not registered for this adapter",
  );
  state.commands.push({
    adapterId: env.adapterId,
    id: "apply",
    title: "Right adapter",
    busy: true,
  });
  expect(actionDisabledReason(state, env, action)).toBe("Command is busy");
  expect(
    actionDisabledReason(state, env, { ...action, disabled: "Policy says no" }),
  ).toBe("Policy says no");
  const html = renderToStaticMarkup(
    <SessionPanel state={state} onAction={noop} onReload={noop} />,
  );
  expect(html).not.toContain("Command is busy");
  for (const text of [
    'aria-busy="true"',
    "Read-only source",
    "Command not registered for this adapter",
    "Comment body (required)",
    "<textarea",
    'required=""',
    'disabled=""',
    "aria-describedby=",
  ])
    expect(html).toContain(text);
  state.commands = state.commands.map((command) => ({
    ...command,
    busy: false,
  }));
  expect(actionDisabledReason(state, env, action)).toBeUndefined();
});

test("action payload includes envelope identity, never static input; fields are a plain filtered string record", () => {
  const state = stateFor(status);
  const env = state.views[0];
  if (!env) throw new Error("Missing test view");
  expect(actionRequest(state, env, action, { unexpected: "ignored" })).toEqual({
    generation: "generation-one",
    adapterId: "adapter-one",
    viewId: "view-one",
    revision: 7,
    actionId: "act",
    commandId: "apply",
  });
  const request = actionRequest(
    state,
    env,
    {
      ...action,
      fields: [
        { name: "body", label: "Body" },
        { name: "constructor", label: "Constructor" },
      ],
    },
    { body: "User input", injected: "no" },
  );
  expect(request.input).toEqual({ body: "User input", constructor: "" });
  expect(request.input).not.toHaveProperty("value");
  expect(request.input).not.toHaveProperty("fields");
  expect(request.input).not.toHaveProperty("hostOnly");
});

test("new generation, revision, adapter or view produces a fresh form boundary", () => {
  const state = stateFor(status);
  const env = state.views[0];
  if (!env) throw new Error("Missing test view");
  const key = envelopeKey(state, env);
  for (const changed of [
    { ...env, revision: 8 },
    { ...env, adapterId: "other" },
    { ...env, view: { ...status, id: "other" } },
  ])
    expect(envelopeKey(state, changed)).not.toBe(key);
  expect(envelopeKey({ ...state, generation: "new-generation" }, env)).not.toBe(
    key,
  );
  expect(envelopeKey(state, env)).toBe(key);
});
