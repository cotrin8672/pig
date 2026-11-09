import { afterEach, expect, test } from "bun:test";
import {
  type ConversationView,
  defineDoc,
  type JsonObject,
  type TaskGraph,
  type Tx,
} from "@earendil-works/pi-durable";
import type {
  Action,
  AdapterContext,
  DocumentState,
  Json,
  PigConfig,
  SessionActionRequest,
  SessionAdapter,
  SessionView,
} from "../../../../packages/config/src";
import { actionRequest } from "../mainview/session-panel-model";
import type { AdapterBackend } from "./adapter-backend";
import { AdapterRuntime } from "./adapter-runtime";

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

const TestDoc = defineDoc({
  kind: "test.adapter",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ value: "original" }),
  checkpointWhen: () => true,
});
function fakeBackend() {
  const changes = new Set<() => void>();
  const documents = new Set<(state: DocumentState<JsonObject>) => void>();
  const conversation = {
    conversation: { id: 1 },
    entries: [],
    before: 42,
    docs: { "pi.test": { value: "original" } },
  } as unknown as ConversationView;
  const graph: TaskGraph = { tasks: {} };
  const document = { value: "original" };
  let current = true;
  let streaming = false;
  const calls: unknown[] = [];
  const backend: AdapterBackend = {
    session: { id: "session", cwd: "cwd" },
    conversation: () => conversation,
    taskGraph: () => graph,
    subscribe: (callback) => {
      changes.add(callback);
      return () => {
        changes.delete(callback);
      };
    },
    snapshot: async () => document as never,
    watchDocument: async (_token, callback) => {
      const dispatch = callback as (state: DocumentState<JsonObject>) => void;
      documents.add(dispatch);
      dispatch({ value: document, retired: false });
      return () => {
        documents.delete(dispatch);
      };
    },
    configure: async (change, signal) => {
      calls.push({ change, signal });
    },
    commit: async (change, signal) => {
      calls.push({ signal });
      return change({} as Tx);
    },
    assertCurrent: () => {
      if (!current) throw new Error("OLD_BACKEND");
    },
    isStreaming: () => streaming,
  };
  return {
    backend,
    conversation,
    graph,
    document,
    documents,
    changes,
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
    publishDocument: (state: DocumentState<JsonObject>) => {
      for (const callback of documents) callback(state);
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
    { apiVersion: 2, sessionAdapters: adapters, keymaps },
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
    context.controller.configure({ instructions: "changed" }),
  ).rejects.toThrow("ADAPTER_DISPOSED");
  await expect(context.controller.commit(() => {})).rejects.toThrow(
    "ADAPTER_DISPOSED",
  );
});

test("connect and callback failures remove only that adapter, retaining diagnostics", async () => {
  let failCallbacks = false;
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
        ctx.sources.subscribe(() => {
          if (failCallbacks) throw new Error("snapshot failure");
        });
      },
    },
    {
      id: "promise",
      connect(ctx) {
        ctx.sources.subscribe(async () => {
          if (failCallbacks) throw new Error("async snapshot failure");
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
  failCallbacks = true;
  fake.refresh();
  await tick();
  expect(runtime.snapshot().diagnostics).toHaveLength(4);
  expect(runtime.snapshot().views.map((item) => item.adapterId)).toEqual([
    "good",
  ]);
  expect(runtime.snapshot().commands.map((item) => item.adapterId)).toEqual([
    "good",
  ]);
  expect(fake.changes.size).toBe(0);
  fake.refresh();
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

test("native reads are detached, invalidations coalesce/unsubscribe and timers stop", async () => {
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
      async connect(ctx) {
        context = ctx;
        unsubscribe = ctx.sources.subscribe(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          seen.push(seen.length);
          if (seen.length === 1) await gate.promise;
          active--;
        });
        await ctx.sources.watchDocument(TestDoc, (state) => {
          (state.value as { value: string }).value = "mutated";
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
  context.sources.conversation().docs["pi.test"].value = "mutated";
  expect(Number(context.sources.conversation().before)).toBe(42);
  (context.sources.taskGraph().tasks as Record<string, unknown>).mutated = {};
  const snapshot = await context.sources.snapshot(TestDoc);
  (snapshot as { value: string }).value = "mutated";
  context.session.cwd = "mutated";
  const payload = { value: { value: "original" }, retired: true };
  fake.publishDocument(payload);
  await tick();
  expect(payload.value.value).toBe("original");
  expect(fake.conversation.docs["pi.test"].value).toBe("original");
  expect(fake.graph.tasks).toEqual({});
  expect(fake.document.value).toBe("original");
  expect(fake.backend.session.cwd).toBe("cwd");
  unsubscribe();
  fake.refresh();
  await tick();
  expect(seen).toEqual([0, 1]);
  runtime.dispose();
  const before = timers;
  await Bun.sleep(25);
  expect(timers).toBe(before);
  expect(fake.changes.size + fake.documents.size).toBe(0);
});

test("bound configure/commit require an explicit command, current backend and cancellation lifetime", async () => {
  let context!: AdapterContext;
  const { runtime, fake } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
        ctx.sources.subscribe(() => {});
        ctx.views.set(view());
        ctx.commands.register({
          id: "run",
          title: "Run",
          async run() {
            await ctx.controller.configure({ instructions: "native" });
            await ctx.controller.commit(() => "committed");
          },
        });
      },
    },
  ]);
  await tick();
  expect(fake.calls).toEqual([]);
  await expect(context.controller.configure({})).rejects.toThrow(
    "ADAPTER_COMMAND_REQUIRED",
  );
  await runtime.invoke(request(runtime));
  expect(fake.calls).toHaveLength(2);
  expect((fake.calls[0] as { signal: AbortSignal }).signal.aborted).toBe(true);
  fake.stale();
  await expect(context.controller.configure({})).rejects.toThrow("OLD_BACKEND");
  await expect(context.controller.commit(() => {})).rejects.toThrow(
    "OLD_BACKEND",
  );
  expect(fake.calls).toHaveLength(2);
});

test("late native watch attachment is released once after disposal, absent documents stay absent", async () => {
  const gate = deferred();
  let context!: AdapterContext;
  let stops = 0;
  const { runtime, fake } = make([
    {
      id: "demo",
      connect(ctx) {
        context = ctx;
      },
    },
  ]);
  await tick();
  fake.backend.snapshot = async () => undefined;
  fake.backend.watchDocument = async () => undefined;
  expect(await context.sources.snapshot(TestDoc)).toBeUndefined();
  expect(
    await context.sources.watchDocument(TestDoc, () => {}),
  ).toBeUndefined();
  fake.backend.watchDocument = async () => {
    await gate.promise;
    return () => {
      stops++;
    };
  };
  const attachment = context.sources.watchDocument(TestDoc, () => {});
  runtime.dispose();
  gate.resolve();
  expect(await attachment).toBeUndefined();
  expect(stops).toBe(1);
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
        ctx.sources.subscribe(async () => {
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
  fake.refresh();
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
        let first = true;
        ctx.sources.subscribe(() => {
          if (!first) throw new Error("source failure");
          first = false;
        });
      },
    },
  ]);
  await tick();
  const pending = runtime.invoke(request(runtime));
  fake.refresh();
  expect(runtime.snapshot().commands).toEqual([]);
  expect(runtime.busy).toBe(true);
  gate.resolve();
  await pending;
  expect(runtime.busy).toBe(false);
  expect(runtime.snapshot().diagnostics).toEqual([
    { adapterId: "demo", message: "source failure" },
  ]);
});

test("document revisions retain retirement order and a consumed display action cannot replay", async () => {
  const gate = deferred();
  const received: boolean[] = [];
  let calls = 0;
  const { runtime, fake } = make([
    {
      id: "demo",
      async connect(ctx) {
        ctx.views.set(view());
        ctx.commands.register({
          id: "run",
          title: "Run",
          run() {
            calls++;
          },
        });
        await ctx.sources.watchDocument(TestDoc, async (state) => {
          received.push(state.retired);
          if (received.length === 1) await gate.promise;
        });
      },
    },
  ]);
  await tick();
  fake.publishDocument({ value: { value: "second" }, retired: false });
  fake.publishDocument({ value: { value: "last" }, retired: true });
  gate.resolve();
  await tick();
  expect(received).toEqual([false, false, true]);
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
