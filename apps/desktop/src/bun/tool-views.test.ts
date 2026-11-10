import { afterEach, expect, test } from "bun:test";
import type {
  SourceEvent,
  ToolObservation,
  ToolView,
} from "../../../../packages/config/src";
import { validateToolCard } from "../../../../packages/config/src/validate";
import { AdapterRuntime } from "./adapter-runtime";
import type { AdapterBackend } from "./adapter-source";

const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const runtimes: AdapterRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function make(toolViews: ToolView[], tools: ToolObservation[]) {
  const changes = new Set<() => void>();
  const events = new Set<(event: SourceEvent) => void>();
  const backend: AdapterBackend = {
    session: { id: "session", cwd: "cwd" },
    entries: () => [],
    tools: () => tools,
    subscribe: (callback) => {
      changes.add(callback);
      return () => changes.delete(callback);
    },
    onEvent: (callback) => {
      events.add(callback);
      return () => events.delete(callback);
    },
    onBus: () => () => {},
    commands: () => [],
    invoke: async () => {},
    emit: () => {},
    assertCurrent: () => {},
    isStreaming: () => false,
  };
  let publications = 0;
  const runtime = new AdapterRuntime(
    { apiVersion: 1, toolViews },
    backend,
    () => {
      publications++;
    },
  );
  runtimes.push(runtime);
  runtime.start();
  return {
    runtime,
    changes,
    publications: () => publications,
    // Mirrors the real source: the event is delivered before the change notification.
    event(type: string) {
      for (const callback of events) callback({ type });
      for (const callback of changes) callback();
    },
  };
}
const call = (
  toolCallId: string,
  toolName: string,
  extra: Partial<ToolObservation> = {},
): ToolObservation => ({
  toolCallId,
  toolName,
  phase: "finished",
  origin: "history",
  ...extra,
});

test("matching calls get a validated card; other tools keep pig's display", async () => {
  const { runtime } = make(
    [
      {
        id: "deploy",
        tools: ["deploy"],
        render: (tool) => ({
          title: "Deploy",
          target: String((tool.args as { env: string }).env),
          body: [{ type: "facts", items: [{ label: "Env", value: "prod" }] }],
        }),
      },
    ],
    [call("a", "deploy", { args: { env: "prod" } }), call("b", "read")],
  );
  await tick();
  expect(runtime.snapshot().toolCards).toEqual({
    a: {
      title: "Deploy",
      target: "prod",
      body: [{ type: "facts", items: [{ label: "Env", value: "prod" }] }],
    },
  });
});

test("first view returning a card wins; undefined falls through", async () => {
  const { runtime } = make(
    [
      { id: "skip", tools: ["x"], render: () => undefined },
      { id: "first", tools: ["x"], render: () => ({ title: "First" }) },
      { id: "second", tools: ["x"], render: () => ({ title: "Second" }) },
    ],
    [call("a", "x")],
  );
  await tick();
  expect(runtime.snapshot().toolCards).toEqual({ a: { title: "First" } });
});

test("finished calls render once; running calls follow tool events but not text deltas", async () => {
  const rendered: string[] = [];
  const tools = [
    call("done", "x"),
    call("live", "x", { phase: "running", origin: "live", result: 1 }),
  ];
  const { runtime, event, publications } = make(
    [
      {
        id: "view",
        tools: ["x"],
        render(tool) {
          rendered.push(tool.toolCallId);
          return { title: "X", meta: String(tool.result ?? "") };
        },
      },
    ],
    tools,
  );
  await tick();
  expect(rendered).toEqual(["done", "live"]);
  const published = publications();

  tools[1] = { ...tools[1], result: 2 };
  event("message_update");
  expect(rendered).toEqual(["done", "live"]);

  event("tool_execution_update");
  expect(rendered).toEqual(["done", "live", "live"]);
  expect(runtime.snapshot().toolCards?.live.meta).toBe("2");
  expect(publications()).toBe(published + 1);

  // An identical card is not republished.
  event("tool_execution_update");
  expect(publications()).toBe(published + 1);
});

test("a throwing or invalid view loses only its own cards and is reported", async () => {
  const tools = [call("a", "x"), call("b", "y")];
  let broken = false;
  const { runtime, event } = make(
    [
      {
        id: "fragile",
        tools: ["x", "y"],
        render(tool) {
          if (broken && tool.toolCallId === "c")
            return {
              title: "",
              body: [{ type: "html", text: "<b>" }],
            } as never;
          return { title: "Fragile" };
        },
      },
      { id: "stable", tools: ["y"], render: () => ({ title: "Stable" }) },
    ],
    tools,
  );
  await tick();
  expect(runtime.snapshot().toolCards).toEqual({
    a: { title: "Fragile" },
    b: { title: "Fragile" },
  });

  broken = true;
  tools.push(call("c", "x"));
  event("tool_execution_end");
  const state = runtime.snapshot();
  // Cached cards from the failed view are withdrawn; the next view takes over where it matches.
  expect(state.toolCards).toEqual({ b: { title: "Stable" } });
  expect(state.diagnostics).toEqual([
    { adapterId: "toolView:fragile", message: expect.any(String) },
  ]);
});

test("without tool views nothing subscribes and no cards are published", () => {
  const { runtime, changes } = make([], [call("a", "x")]);
  expect(changes.size).toBe(0);
  expect(runtime.snapshot().toolCards).toBeUndefined();
});

test("card validation rejects unknown blocks and non-JSON data", () => {
  expect(() => validateToolCard({ title: "" })).toThrow();
  expect(() =>
    validateToolCard({ title: "T", body: [{ type: "html", text: "x" }] }),
  ).toThrow();
  expect(() => validateToolCard({ title: "T", meta: () => "x" })).toThrow();
  expect(
    validateToolCard({
      title: "T",
      body: [
        { type: "diff", text: "+a" },
        { type: "list", items: [{ title: "one", state: "completed" }] },
      ],
    }).body,
  ).toHaveLength(2);
});
