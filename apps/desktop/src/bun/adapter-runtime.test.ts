import { afterEach, expect, test } from "bun:test";
import type {
  Action,
  AdapterContext,
  Json,
  PigConfig,
  SessionActionRequest,
  SessionAdapter,
  SessionView,
  SourceEvent,
} from "../../../../packages/config/src";
import { actionRequest } from "../mainview/session-panel-model";
import { AdapterRuntime } from "./adapter-runtime";
import type { AdapterBackend } from "./adapter-source";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const runtimes: AdapterRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function fakeBackend() {
  const changes = new Set<() => void>();
  const events = new Set<(event: SourceEvent) => void>();
  const bus = new Set<(data: unknown) => void>();
  const entries = [
    {
      id: "entry",
      type: "custom",
      timestamp: "now",
      data: { value: "original" },
    },
  ];
  const tools = [
    {
      toolCallId: "tool",
      toolName: "read",
      phase: "finished" as const,
      origin: "history" as const,
      result: { value: "original" },
    },
  ];
  const commands = [
    { name: "toggle", invocationName: "toggle", source: "extension" },
  ];
  let current = true;
  let streaming = false;
  const calls: unknown[] = [];
  const backend: AdapterBackend = {
    session: { id: "session", cwd: "cwd" },
    entries: () => entries,
    tools: () => tools,
    subscribe: (callback) => {
      changes.add(callback);
      return () => {
        changes.delete(callback);
      };
    },
    onEvent: (callback) => {
      events.add(callback);
      return () => {
        events.delete(callback);
      };
    },
    onBus: (_channel, callback) => {
      bus.add(callback);
      return () => {
        bus.delete(callback);
      };
    },
    commands: () => commands,
    invoke: async (input) => {
      calls.push(input);
    },
    emit: (channel, data) => {
      calls.push({ channel, data });
    },
    assertCurrent: () => {
      if (!current) throw new Error("OLD_BACKEND");
    },
    isStreaming: () => streaming,
  };
  return {
    backend,
    entries,
    tools,
    commands,
    changes,
    events,
    bus,
    calls,
    stale: () => {
      current = false;
    },
    stream: (value: boolean) => {
      streaming = value;
    },
    refresh: () => {
      for (const callback of changes) callback();
    },
    event: (event: SourceEvent) => {
      for (const callback of events) callback(event);
    },
    broadcast: (data: unknown) => {
      for (const callback of bus) callback(data);
    },
  };
}
function view(
  actions: Action[] = [{ id: "act", label: "Run", command: "run" }],
): SessionView {
  return {
    kind: "status",
    id: "view",
    title: "Status",
    source: {
      label: "Test",
      scope: { kind: "session", id: "session" },
      freshness: "live",
    },
    text: "Ready",
    tone: "info",
    actions,
  };
}
function make(adapters: SessionAdapter[], keymaps: PigConfig["keymaps"] = []) {
  const fake = fakeBackend();
  const publications: boolean[] = [];
  const runtime = new AdapterRuntime(
    { apiVersion: 1, sessionAdapters: adapters, keymaps },
    fake.backend,
    () => {
      publications.push(runtime.busy);
    },
  );
  runtimes.push(runtime);
  runtime.start();
  return { runtime, fake, publications };
}
function request(
  runtime: AdapterRuntime,
  adapterId = "demo",
): SessionActionRequest {
  const envelope = runtime
    .snapshot()
    .views.find((item) => item.adapterId === adapterId);
  if (!envelope) throw new Error("Missing test view");
  return {
    generation: runtime.generation,
    adapterId,
    commandId: "run",
    viewId: envelope.view.id,
    revision: envelope.revision,
    actionId: "act",
  };
}

test("connect is asynchronous; reload aborts, ignores late writes, and runs late cleanup", async () => {
  let context!: AdapterContext;
  const gate = deferred();
  const order: number[] = [];
  const { runtime } = make([
    {
      id: "demo",
      async connect(ctx) {
        context = ctx;
        ctx.scope.onDispose(() => {
          order.push(1);
        });
        ctx.scope.onDispose(() => {
          order.push(2);
        });
        await gate.promise;
        ctx.views.set(view());
        return () => {
          order.push(3);
        };
      },
    },
  ]);
  expect(context).toBeUndefined();
  await tick();
  const replacement = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.views.set(view());
      },
    },
  ]).runtime;
  expect(replacement.generation).not.toBe(runtime.generation);
  runtime.dispose();
  expect(context.scope.signal.aborted).toBe(true);
  expect(order).toEqual([2, 1]);
  gate.resolve();
  await tick();
  expect(order).toEqual([2, 1, 3]);
  expect(runtime.snapshot().views).toEqual([]);
  expect(replacement.snapshot().views).toHaveLength(1);
  expect(() => context.views.set(null as unknown as SessionView)).not.toThrow();
  await expect(
    context.pi.invoke({ name: "toggle", source: "extension" }),
  ).rejects.toThrow("ADAPTER_DISPOSED");
  expect(() => context.pi.emit("test", null)).toThrow("ADAPTER_DISPOSED");
});

test("connect and callback failures remove only that adapter, retaining diagnostics", async () => {
  const { runtime, fake } = make([
    {
      id: "sync",
      connect() {
        throw new Error("sync failure");
      },
    },
    {
      id: "async",
      async connect() {
        throw new Error("async failure");
      },
    },
    {
      id: "callback",
      connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({ id: "run", title: "Run", run() {} });
        ctx.sources.onEvent(() => {
          throw new Error("event failure");
        });
      },
    },
    {
      id: "promise",
      connect(ctx) {
        ctx.sources.onBus("test", async () => {
          throw new Error("bus failure");
        });
      },
    },
    {
      id: "good",
      connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({ id: "run", title: "Run", run() {} });
      },
    },
  ]);
  await tick();
  expect(runtime.snapshot().diagnostics.map((item) => item.adapterId)).toEqual([
    "sync",
    "async",
  ]);
  fake.event({ type: "change" });
  fake.broadcast({});
  await tick();
  expect(runtime.snapshot().diagnostics).toHaveLength(4);
  expect(runtime.snapshot().views.map((item) => item.adapterId)).toEqual([
    "good",
  ]);
  expect(runtime.snapshot().commands.map((item) => item.adapterId)).toEqual([
    "good",
  ]);
  expect(fake.events.size + fake.bus.size).toBe(0);
  fake.event({ type: "again" });
  expect(runtime.snapshot().diagnostics).toHaveLength(4);
});

test("same command/view IDs and delimiter-like namespaces remain independent", async () => {
  const calls: string[] = [];
  const { runtime } = make(
    ["a", "a:b"].map((id) => ({
      id,
      connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({
          id: "run",
          title: "Run",
          run() {
            calls.push(id);
          },
        });
      },
    })),
  );
  await tick();
  await runtime.invoke(request(runtime, "a"));
  await runtime.invoke(request(runtime, "a:b"));
  expect(calls).toEqual(["a", "a:b"]);
  expect(runtime.snapshot().views).toHaveLength(2);
});

test("views are snapshots, identical sets skip publication, revision survives deletion and reuse", async () => {
  let context!: AdapterContext;
  const original = view();
  let runs = 0;
  const { runtime, publications } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
        ctx.views.set(original);
        ctx.commands.register({
          id: "run",
          title: "Run",
          run() {
            runs++;
          },
        });
      },
    },
  ]);
  await tick();
  const old = request(runtime);
  const count = publications.length;
  context.views.set(view());
  expect(publications).toHaveLength(count);
  original.title = "mutated";
  runtime.snapshot().views[0].view.title = "also mutated";
  expect(runtime.snapshot().views[0].view.title).toBe("Status");
  context.views.remove("view");
  context.views.set(view());
  expect(request(runtime).revision).toBeGreaterThan(old.revision ?? 0);
  await expect(runtime.invoke(old)).rejects.toThrow("STALE_VIEW");
  await expect(
    runtime.invoke({ ...request(runtime), generation: "old" }),
  ).rejects.toThrow("STALE_GENERATION");
  await expect(
    runtime.invoke({ ...request(runtime), actionId: "missing" }),
  ).rejects.toThrow("ACTION_UNAVAILABLE");
  context.commands.register({
    id: "other",
    title: "Other",
    run() {
      runs++;
    },
  });
  await expect(
    runtime.invoke({ ...request(runtime), commandId: "other" }),
  ).rejects.toThrow("ACTION_UNAVAILABLE");
  context.views.set(
    view([
      { id: "act", command: "run", label: "Disabled", disabled: "Not now" },
    ]),
  );
  await expect(runtime.invoke(request(runtime))).rejects.toThrow(
    "ACTION_UNAVAILABLE",
  );
  expect(runs).toBe(0);
});

test("duplicate action IDs anywhere in a view are rejected by validation", async () => {
  const { runtime } = make([
    {
      id: "demo",
      connect(ctx) {
        const base = view();
        ctx.views.set({
          ...base,
          kind: "todo",
          items: [
            {
              id: "item",
              identity: "native",
              title: "Item",
              state: "pending",
              actions: base.actions,
            },
          ],
        });
      },
    },
  ]);
  await tick();
  expect(runtime.snapshot().views).toEqual([]);
  expect(runtime.snapshot().diagnostics).toHaveLength(1);
});

test("fields use exact string names/bounds/required and host fixed input, never client values", async () => {
  let context!: AdapterContext;
  const received: (Json | undefined)[] = [];
  const { runtime } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
        ctx.commands.register({
          id: "run",
          title: "Run",
          run(input) {
            received.push(input);
          },
        });
        ctx.views.set(
          view([
            {
              id: "act",
              label: "Submit",
              command: "run",
              input: { host: true },
              fields: [
                { name: "name", label: "Name", required: true },
                { name: "notes", label: "Notes" },
              ],
            },
          ]),
        );
      },
    },
  ]);
  await tick();
  for (const input of [
    null,
    [],
    "bad",
    {},
    { name: "a" },
    { name: "a", notes: "", extra: "" },
    { name: 1, notes: "" },
    { name: "  ", notes: "" },
    { name: "a", notes: "x".repeat(16_385) },
  ] as Json[]) {
    await expect(
      runtime.invoke({ ...request(runtime), input }),
    ).rejects.toThrow("INVALID_ACTION_FIELDS");
  }
  await runtime.invoke({
    ...request(runtime),
    input: { name: "Ada", notes: "" },
  });
  expect(received).toEqual([
    { value: { host: true }, fields: { name: "Ada", notes: "" } },
  ]);
  context.views.set(
    view([
      {
        id: "act",
        label: "Fixed",
        command: "run",
        input: { host: "authoritative" },
      },
    ]),
  );
  await runtime.invoke({ ...request(runtime), input: { host: "forged" } });
  expect(received[1]).toEqual({ host: "authoritative" });
  await expect(
    runtime.invoke({ ...request(runtime), input: Number.NaN }),
  ).rejects.toThrow();
  expect(runtime.snapshot().diagnostics).toEqual([]);
});

test("all nested actions are bound using viewActions", async () => {
  let runs = 0;
  const { runtime } = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.commands.register({
          id: "run",
          title: "Run",
          run() {
            runs++;
          },
        });
        ctx.views.set({
          ...view([]),
          kind: "mode",
          axis: "mode",
          value: "off",
          choices: [
            {
              id: "on",
              label: "On",
              action: { id: "act", label: "Enable", command: "run" },
            },
          ],
        });
      },
    },
  ]);
  await tick();
  await runtime.invoke(request(runtime));
  expect(runs).toBe(1);
});

test("busy rejects concurrent commands without retransmit, streaming gates, errors do not kill scope", async () => {
  const gate = deferred();
  let runs = 0;
  const { runtime, fake, publications } = make(
    [
      {
        id: "demo",
        connect(ctx) {
          ctx.views.set(view());
          ctx.commands.register({
            id: "run",
            title: "Run",
            async run() {
              runs++;
              await gate.promise;
              throw new Error("operation rejected");
            },
          });
          ctx.commands.register({
            id: "safe",
            title: "Safe",
            allowWhileStreaming: true,
            run() {
              runs++;
            },
          });
        },
      },
    ],
    [{ keys: "Ctrl+K", adapter: "demo", command: "safe", when: "chat" }],
  );
  await tick();
  const pending = runtime.invoke(request(runtime));
  expect(runtime.busy).toBe(true);
  expect(runtime.snapshot().commands[0].busy).toBe(true);
  await expect(runtime.invoke(request(runtime))).rejects.toThrow(
    "COMMAND_BUSY",
  );
  await expect(
    runtime.invoke({
      generation: runtime.generation,
      adapterId: "demo",
      commandId: "safe",
    }),
  ).rejects.toThrow("COMMAND_BUSY");
  expect(runs).toBe(1);
  gate.resolve();
  await expect(pending).rejects.toThrow("operation rejected");
  expect(runtime.busy).toBe(false);
  expect(publications.slice(-2)).toEqual([true, false]);
  expect(runtime.snapshot().views[0].view).toEqual(view());
  expect(runtime.snapshot().diagnostics).toEqual([]);
  fake.stream(true);
  await expect(runtime.invoke(request(runtime))).rejects.toThrow("AGENT_BUSY");
  await runtime.invoke({
    generation: runtime.generation,
    adapterId: "demo",
    commandId: "safe",
  });
  await expect(
    runtime.invoke({
      generation: runtime.generation,
      adapterId: "demo",
      commandId: "safe",
      input: null,
    }),
  ).rejects.toThrow("KEYBOARD_COMMAND_UNAVAILABLE");
  fake.stream(false);
  await expect(
    runtime.invoke({
      generation: runtime.generation,
      adapterId: "demo",
      commandId: "run",
    }),
  ).rejects.toThrow("KEYBOARD_COMMAND_UNAVAILABLE");
  expect(runs).toBe(2);
});

test("source reads/events are cloned, subscriptions coalesce and unsubscribe, timers stop", async () => {
  const gate = deferred();
  let context!: AdapterContext;
  let unsubscribe!: () => void;
  const seen: number[] = [];
  let active = 0;
  let maxActive = 0;
  let timers = 0;
  const { runtime, fake } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
        unsubscribe = ctx.sources.subscribe(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          seen.push(seen.length);
          if (seen.length === 1) await gate.promise;
          active--;
        });
        ctx.sources.onEvent((event) => {
          (event.payload as { value: string }).value = "mutated";
        });
        ctx.sources.onBus("test", (data) => {
          (data as { value: string }).value = "mutated";
        });
        ctx.scope.interval(() => {
          timers++;
        }, 10);
      },
    },
  ]);
  await tick();
  expect(seen).toEqual([0]);
  fake.refresh();
  fake.refresh();
  fake.refresh();
  expect(seen).toEqual([0]);
  gate.resolve();
  await tick();
  expect(seen).toEqual([0, 1]);
  expect(maxActive).toBe(1);
  (context.sources.entries("all")[0].data as { value: string }).value =
    "mutated";
  (context.sources.tools()[0].result as { value: string }).value = "mutated";
  context.pi.commands()[0].name = "mutated";
  context.session.cwd = "mutated";
  const payload = { value: "original" };
  fake.event({ type: "test", payload });
  fake.broadcast(payload);
  expect(payload.value).toBe("original");
  expect(fake.entries[0].data.value).toBe("original");
  expect(fake.tools[0].result.value).toBe("original");
  expect(fake.commands[0].name).toBe("toggle");
  expect(fake.backend.session.cwd).toBe("cwd");
  unsubscribe();
  fake.refresh();
  await tick();
  expect(seen).toEqual([0, 1]);
  runtime.dispose();
  const before = timers;
  await Bun.sleep(25);
  expect(timers).toBe(before);
  expect(fake.changes.size + fake.events.size + fake.bus.size).toBe(0);
});

test("backend invoke/emit always check current scope and backend, without source-driven commands", async () => {
  let context!: AdapterContext;
  const { fake } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
        ctx.sources.subscribe(() => {});
      },
    },
  ]);
  await tick();
  expect(fake.calls).toEqual([]);
  await context.pi.invoke({ name: "toggle", source: "extension" });
  context.pi.emit("channel", { value: "ok" });
  expect(fake.calls).toHaveLength(2);
  fake.stale();
  await expect(
    context.pi.invoke({ name: "toggle", source: "extension" }),
  ).rejects.toThrow("OLD_BACKEND");
  expect(() => context.pi.emit("channel", null)).toThrow("OLD_BACKEND");
  expect(fake.calls).toHaveLength(2);
});

test("command registration is bounded, unique, and type checked", async () => {
  const { runtime } = make([
    {
      id: "duplicate",
      connect(ctx) {
        for (let i = 0; i < 2; i++)
          ctx.commands.register({ id: "run", title: "Run", run() {} });
      },
    },
    {
      id: "long",
      connect(ctx) {
        ctx.commands.register({ id: "x".repeat(257), title: "Run", run() {} });
      },
    },
    {
      id: "type",
      connect(ctx) {
        ctx.commands.register({
          id: "run",
          title: "Run",
          run: 42 as unknown as () => void,
        });
      },
    },
    {
      id: "limit",
      connect(ctx) {
        for (let i = 0; i < 257; i++)
          ctx.commands.register({ id: String(i), title: "Run", run() {} });
      },
    },
  ]);
  await tick();
  expect(runtime.snapshot().commands).toEqual([]);
  expect(runtime.snapshot().diagnostics).toHaveLength(4);
});

test("synchronous source reentry coalesces without recursion and late callback failure stays isolated", async () => {
  let context!: AdapterContext;
  let emit!: () => void;
  let calls = 0;
  let depth = 0;
  let maxDepth = 0;
  const gate = deferred();
  const { runtime, fake } = make([
    {
      id: "reentry",
      connect(ctx) {
        ctx.sources.subscribe(() => {
          depth++;
          maxDepth = Math.max(depth, maxDepth);
          calls++;
          if (calls > 1 && calls < 5) {
            emit();
            emit();
          }
          depth--;
        });
      },
    },
    {
      id: "late",
      connect(ctx) {
        context = ctx;
        ctx.sources.onBus("test", async () => {
          await gate.promise;
          ctx.views.set(view());
          throw new Error("late rejection");
        });
      },
    },
  ]);
  emit = fake.refresh;
  await tick();
  emit();
  await tick();
  expect(calls).toBe(5);
  expect(maxDepth).toBe(1);
  fake.broadcast({});
  runtime.dispose();
  gate.resolve();
  await tick();
  expect(context.scope.signal.aborted).toBe(true);
  expect(runtime.snapshot().views).toEqual([]);
  expect(runtime.snapshot().diagnostics).toEqual([]);
});

test("unsubscribe while a listener awaits discards its coalesced updates", async () => {
  const gate = deferred();
  let unsubscribe!: () => void;
  let calls = 0;
  const { fake } = make([
    {
      id: "demo",
      connect(ctx) {
        unsubscribe = ctx.sources.subscribe(async () => {
          calls++;
          await gate.promise;
        });
      },
    },
  ]);
  await tick();
  fake.refresh();
  fake.refresh();
  unsubscribe();
  gate.resolve();
  await tick();
  expect(calls).toBe(1);
  expect(fake.changes.size).toBe(0);
});

test("cleanup errors are contained and do not prevent remaining reverse-order cleanup", async () => {
  const order: number[] = [];
  const { runtime } = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.scope.onDispose(() => {
          order.push(1);
        });
        ctx.scope.onDispose(async () => {
          order.push(2);
          throw new Error("cleanup rejected");
        });
        ctx.scope.onDispose(() => {
          order.push(3);
          throw new Error("cleanup threw");
        });
        return () => {
          order.push(4);
        };
      },
    },
  ]);
  await tick();
  runtime.dispose();
  await tick();
  expect(order).toEqual([4, 3, 2, 1]);
  expect(runtime.snapshot().diagnostics).toEqual([
    { adapterId: "demo", message: "cleanup threw" },
  ]);
});

test("scope failure does not clear an in-flight command's busy state before finally", async () => {
  const gate = deferred();
  const { runtime, fake } = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({
          id: "run",
          title: "Run",
          async run() {
            await gate.promise;
          },
        });
        ctx.sources.onEvent(() => {
          throw new Error("source failure");
        });
      },
    },
  ]);
  await tick();
  const pending = runtime.invoke(request(runtime));
  fake.event({ type: "fail" });
  expect(runtime.snapshot().commands).toEqual([]);
  expect(runtime.busy).toBe(true);
  gate.resolve();
  await pending;
  expect(runtime.busy).toBe(false);
  expect(runtime.snapshot().diagnostics).toEqual([
    { adapterId: "demo", message: "source failure" },
  ]);
});

test("raw events retain every delta and a consumed display action cannot replay", async () => {
  const gate = deferred();
  const received: unknown[] = [];
  let calls = 0;
  const { runtime, fake } = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({
          id: "run",
          title: "Run",
          run() {
            calls++;
          },
        });
        ctx.sources.onBus("test", async (data) => {
          received.push(data);
          if (data === 1) await gate.promise;
        });
      },
    },
  ]);
  await tick();
  fake.broadcast(1);
  fake.broadcast(2);
  fake.broadcast(3);
  gate.resolve();
  await tick();
  expect(received).toEqual([1, 2, 3]);
  const original = request(runtime);
  await runtime.invoke(original);
  await expect(runtime.invoke(original)).rejects.toThrow("STALE_VIEW");
  expect(calls).toBe(1);
});

test("UI actions with empty declared fields reach the host without extra input", async () => {
  const action: Action = {
    id: "act",
    label: "Run",
    command: "run",
    input: { task: "host-owned" },
    fields: [],
  };
  let received: Json | undefined;
  const { runtime } = make([
    {
      id: "demo",
      connect(ctx) {
        ctx.commands.register({
          id: "run",
          title: "Run",
          run(input) {
            received = input;
          },
        });
        ctx.views.set(view([action]));
      },
    },
  ]);
  await tick();
  const state = runtime.snapshot();
  const envelope = state.views[0];
  if (!envelope) throw new Error("Missing test view");
  await runtime.invoke(
    actionRequest(state, envelope, action, { injected: "ignored" }),
  );
  expect(received).toEqual({ value: { task: "host-owned" }, fields: {} });
});
