import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineDoc,
  Harness,
  type JsonObject,
  MemoryStorage,
  type TaskGraphNode,
} from "@earendil-works/pi-durable";
import type {
  ArtifactState,
  DelegationState,
  ModeState,
  TodoState,
} from "../../../../examples/session-ui/durable-adapters";
import type { PigConfig, SessionView } from "../../../../packages/config/src";
import type { AdapterBackend } from "./adapter-backend";
import { AdapterRuntime } from "./adapter-runtime";
import { ConfigLoader } from "./config-loader";

const roots: string[] = [];
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function token<T extends JsonObject>(kind: string, initial: () => T) {
  return defineDoc({
    kind,
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial,
    checkpointWhen: () => true,
  });
}
const Todos = token<TodoState>("example.todos", () => ({
  revision: 0,
  items: [],
}));
const Mode = token<ModeState>("example.mode", () => ({ workflow: "work" }));
const Artifact = token<ArtifactState>("example.artifact", () => ({
  revision: 0,
  text: "",
  stage: "draft",
}));
const Delegations = defineDoc({
  kind: "example.delegations",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: (): DelegationState => ({ runs: [] }),
  checkpointWhen: () => true,
});

async function config(): Promise<PigConfig> {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-native-example-"),
  );
  roots.push(root);
  const example = resolve(import.meta.dir, "../../../../examples/session-ui");
  for (const name of ["config.ts", "durable-adapters.ts"]) {
    const source = (await readFile(join(example, name), "utf8"))
      .replace('"../../packages/config/src"', '"@pig/config"')
      .replace(
        '"../../apps/desktop/node_modules/@earendil-works/pi-durable"',
        '"@earendil-works/pi-durable"',
      );
    await writeFile(join(root, name), source);
  }
  const loader = new ConfigLoader(join(root, "config.ts"), {
    moduleRoot: resolve(import.meta.dir, "../.."),
  });
  const candidate = await loader.prepare();
  if (!candidate) throw new Error(loader.error);
  const result = candidate.config;
  await loader.discard(candidate);
  return result;
}
async function fixture(initialize = true) {
  const selected = await config();
  const registry = createRegistry();
  for (const extension of selected.runtime?.extensions ?? [])
    registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      registry,
      models: createModels(),
      settings: { extensions: [] },
      ...(initialize
        ? { conversationCreated: selected.runtime?.conversationCreated }
        : {}),
    },
    context,
  );
  cleanups.push(() => harness.close(context));
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: selected.runtime?.profiles?.research,
    },
    context,
  );
  const watch = await conversation.watch(context);
  const graph = await harness.watchTaskGraph(context);
  const changes = new Set<() => void>();
  const refresh = () => {
    for (const listener of changes) listener();
  };
  watch.start(async () => {
    refresh();
  });
  graph.start(async () => {
    refresh();
  });
  const backend: AdapterBackend = {
    session: { id: String(conversation.id), cwd: "" },
    assertCurrent() {},
    isStreaming: () => false,
    conversation: () => watch.value,
    taskGraph: () => graph.value,
    subscribe(listener) {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    snapshot: (token) => harness.snapshot(token, conversation.id, context),
    async watchDocument(token, listener) {
      const watch = await harness.watchDoc(token, conversation.id, context);
      if (!watch) return undefined;
      listener({ value: watch.value, retired: false });
      watch.start(async (call) => {
        if (call.kind === "failed") throw call.error;
        listener({ value: call.value, retired: call.retired === true });
      });
      return () => {
        void watch.stop();
      };
    },
    configure: (change) => conversation.configure(change, context),
    commit: (change) => conversation.commit(change, context),
  };
  const runtime = new AdapterRuntime(selected, backend, () => {});
  cleanups.push(() => {
    runtime.dispose();
    void watch.stop();
    void graph.stop();
  });
  runtime.start();
  await Bun.sleep(1);
  await tick();
  function view<K extends SessionView["kind"]>(
    id: string,
    kind: K,
  ): Extract<SessionView, { kind: K }> {
    const value = runtime
      .snapshot()
      .views.find((item) => item.view.id === id)?.view;
    if (!value || value.kind !== kind)
      throw new Error(
        `Missing ${id}: ${JSON.stringify(runtime.snapshot().diagnostics)}`,
      );
    return value as Extract<SessionView, { kind: K }>;
  }
  return { selected, harness, conversation, runtime, view, backend, refresh };
}

test("native example loads into a real isolated Harness without a model request; research excludes nested write tools", async () => {
  const { conversation, runtime, view } = await fixture();
  const agent = await conversation.agent(context);
  expect(agent.tools.map((tool) => tool.name)).toEqual(["read_todos"]);
  expect(agent.callable.map((tool) => tool.name)).toEqual(["read_todos"]);
  expect(
    agent.callable.some((tool) => /write|edit|bash|complete/.test(tool.name)),
  ).toBe(false);
  expect(runtime.snapshot().diagnostics).toEqual([]);
  expect(runtime.snapshot().views).toHaveLength(4);
  expect(view("todos", "todo").source.freshness).toBe("live");
});

test("custom documents use native tokens, not ConversationView.docs; TODO revisions and workflow remain separate", async () => {
  const { harness, conversation, runtime, view, backend } = await fixture();
  expect(backend.conversation().docs["example.todos"]).toBeUndefined();
  await conversation.commit(async (tx) => {
    const todos = await tx.doc(Todos, conversation.id);
    todos.revision = 1;
    todos.items.push({ id: "one", title: "Observe", done: false });
    const artifact = await tx.doc(Artifact, conversation.id);
    artifact.text = "# Findings";
    artifact.revision = 1;
    artifact.stage = "final";
  }, context);
  await tick();
  expect(view("todos", "todo").items[0]).toMatchObject({
    id: "one",
    state: "pending",
  });
  const before = runtime
    .snapshot()
    .views.find((entry) => entry.view.id === "todos")?.revision;
  const envelope = runtime
    .snapshot()
    .views.find((entry) => entry.view.id === "workflow");
  if (!envelope) throw new Error("Missing mode view");
  await runtime.invoke({
    generation: runtime.generation,
    adapterId: "native-mode",
    commandId: "review",
    viewId: "workflow",
    revision: envelope.revision,
    actionId: "review",
  });
  await tick();
  expect(view("workflow", "mode").value).toBe("review");
  expect(
    (await harness.snapshot(Todos, conversation.id, context))?.items,
  ).toHaveLength(1);
  expect(
    runtime.snapshot().views.find((entry) => entry.view.id === "todos")
      ?.revision,
  ).toBe(before);
  expect(view("artifact", "document")).toMatchObject({
    text: "# Findings",
    stage: "final",
    resource: { revision: "1" },
  });
});

test("absent documents stay unknown and read-only; retirement removes mutation actions", async () => {
  const missing = await fixture(false);
  expect(missing.view("todos", "todo").source.freshness).toBe("unknown");
  expect(missing.view("workflow", "mode").value).toBeNull();
  expect(missing.view("artifact", "document").stage).toBe("unknown");
  expect(missing.view("workflow", "mode").actions).toEqual([]);
  const existing = await fixture();
  await existing.conversation.commit(
    (tx) => tx.retireDoc(Mode, existing.conversation.id),
    context,
  );
  await tick();
  expect(existing.view("workflow", "mode").source.freshness).toBe("saved");
  expect(existing.view("workflow", "mode").actions).toEqual([]);
});

test("delegation graph disappearance is unknown, persisted child outcomes survive; dependencies are not parenthood and output is bounded", async () => {
  const { conversation, backend, refresh, view } = await fixture();
  await conversation.commit(async (tx) => {
    const doc = await tx.doc(Delegations, conversation.id);
    doc.runs.push({
      id: "a",
      title: "Research",
      profile: "research",
      taskId: "task-a",
      output: "partial",
    });
    doc.runs.push({
      id: "b",
      title: "Review",
      profile: "research",
      taskId: "task-b",
      dependsOn: ["a"],
      outcome: "error",
      output: "diagnostic ".repeat(4000),
    });
    doc.runs.push({
      id: "c",
      title: "Cancelled",
      profile: "research",
      taskId: "task-c",
      outcome: "cancelled",
      output: "",
    });
  }, context);
  backend.taskGraph = () => ({
    tasks: {
      "task-a": {
        state: { status: "running", phase: "work" },
      } as TaskGraphNode,
    },
  });
  await tick();
  refresh();
  await tick();
  expect(view("delegations", "agents").runs[0].state.phase).toBe("running");
  backend.taskGraph = () => ({ tasks: {} });
  refresh();
  await tick();
  const runs = view("delegations", "agents").runs;
  expect(runs.map((run) => run.state.outcome)).toEqual([
    "unknown",
    "error",
    "cancelled",
  ]);
  expect(runs[1].dependsOn).toEqual(["a"]);
  expect(runs[1].parentId).toBeUndefined();
  expect(runs[1].output?.text.length).toBe(20_000);
  expect(runs[1].output?.truncated).toBe(true);
  await conversation.commit(async (tx) => {
    (await tx.doc(Delegations, conversation.id)).runs[0].outcome =
      "interrupted";
  }, context);
  await tick();
  expect(view("delegations", "agents").runs[0].state).toEqual({
    phase: "finished",
    outcome: "interrupted",
  });
});
