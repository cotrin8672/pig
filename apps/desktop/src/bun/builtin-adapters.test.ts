import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
  type ConversationDocToken,
  createRegistry,
  Harness,
  type JsonObject,
  MemoryStorage,
  type Harness as NativeHarness,
  type TaskId,
} from "@earendil-works/pi-durable";
import type {
  AdapterContext,
  DocumentState,
  SessionView,
} from "../../../../packages/config/src";
import { validateView } from "../../../../packages/config/src/validate";
import {
  createBuiltinAdapters,
  delegationView,
  todoView,
} from "./builtin-adapters";
import { Delegations, replaceTodos, Todos } from "./builtin-extensions";

const harnesses: NativeHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close(ctx);
});
async function fixture() {
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models: createModels(),
      registry: createRegistry(),
      settings: { extensions: [] },
    },
    ctx,
  );
  harnesses.push(harness);
  const conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: { extensions: [], tools: [] } },
    ctx,
  );
  const controller = new AbortController();
  const views = new Map<string, SessionView>();
  const commands = new Map<
    string,
    Parameters<AdapterContext["commands"]["register"]>[0]
  >();
  const listeners = new Map<
    string,
    Set<(state: DocumentState<JsonObject>) => void | Promise<void>>
  >();
  const subscriptions = new Set<() => void | Promise<void>>();
  const cleanups: (() => void)[] = [];
  const context: AdapterContext = {
    session: { id: "opaque-ui-session", cwd: "not-needed" },
    sources: {
      conversation: () => ({
        conversation: { id: conversation.id },
        entries: [],
        docs: {},
      }),
      taskGraph: () => {
        throw new Error("Live graph is not saved planning/history");
      },
      subscribe: (callback) => {
        subscriptions.add(callback);
        void callback();
        return () => {
          subscriptions.delete(callback);
        };
      },
      snapshot: (token) => harness.snapshot(token, conversation.id, ctx),
      watchDocument: async (token, callback) => {
        const value = await harness.snapshot(token, conversation.id, ctx);
        if (!value) return undefined;
        const dispatch = callback as (
          state: DocumentState<JsonObject>,
        ) => void | Promise<void>;
        let set = listeners.get(token.definition.kind);
        if (!set) {
          set = new Set();
          listeners.set(token.definition.kind, set);
        }
        set.add(dispatch);
        await callback({ value, retired: false });
        return () => {
          set.delete(dispatch);
        };
      },
    },
    views: {
      set: (view) => {
        validateView(view);
        views.set(view.id, structuredClone(view));
      },
      remove: (id) => {
        views.delete(id);
      },
    },
    commands: {
      register: (command) => {
        commands.set(command.id, command);
      },
    },
    controller: {
      configure: (change) => conversation.configure(change, ctx),
      commit: (change) => harness.commit(change, ctx),
    },
    scope: {
      signal: controller.signal,
      onDispose: (cleanup) => {
        cleanups.push(cleanup);
      },
      interval: () => {
        throw new Error("No polling needed");
      },
    },
  };
  return {
    harness,
    conversation,
    context,
    commands,
    views,
    listeners,
    subscriptions,
    async publish() {
      for (const token of [
        Todos,
        Delegations,
      ] as readonly ConversationDocToken<JsonObject>[]) {
        const value = await harness.snapshot(token, conversation.id, ctx);
        if (value)
          for (const callback of listeners.get(token.definition.kind) ?? [])
            await callback({ value, retired: false });
      }
      for (const callback of subscriptions) await callback();
    },
    dispose() {
      controller.abort();
      for (const cleanup of cleanups) cleanup();
    },
  };
}

test("native document ports acquire missing TODO later; GUI command uses same revision CAS, no Task", async () => {
  const f = await fixture();
  const adapter = createBuiltinAdapters()[0];
  if (!adapter) throw new Error("Missing adapter");
  await adapter.connect(f.context);
  expect(f.views.size).toBe(0);
  await f.harness.commit(
    (tx) =>
      replaceTodos(tx, f.conversation.id, 0, [
        { id: "a", title: "Plan", state: "pending" },
      ]),
    ctx,
  );
  await f.publish();
  const view = f.views.get("pig.todos");
  if (view?.kind !== "todo") throw new Error("Missing TODO view");
  const action = view.items[0]?.actions?.[0];
  if (!action) throw new Error("Missing GUI action");
  const command = f.commands.get(action.command);
  if (!command) throw new Error("Missing GUI command");
  await command.run(action.input);
  await f.publish();
  expect(
    (await f.harness.snapshot(Todos, f.conversation.id, ctx))?.items[0]?.state,
  ).toBe("completed");
  await expect(command.run(action.input)).rejects.toThrow("revision conflict");
  expect((await f.harness.inspect(ctx)).tasks).toHaveLength(0);
  await expect(
    command.run({ id: "a", revision: 2, state: "execute" }),
  ).rejects.toThrow("Invalid TODO");
  f.dispose();
  expect(f.views.size).toBe(0);
  expect(f.subscriptions.size).toBe(0);
  expect(f.listeners.get("pig.todos")?.size).toBe(0);
});
test("saved research outcomes survive an empty graph; unknown never means active or success", async () => {
  const f = await fixture();
  await f.harness.commit(async (tx) => {
    const doc = await tx.doc(Delegations, f.conversation.id);
    doc.runs = [
      {
        taskId: 100 as TaskId,
        childId: f.conversation.id,
        requestId: "delegate:100",
        task: "Question",
        profile: "research",
        model: "faux/model",
        outcome: "success",
        result: "Conclusion. Evidence. Unresolved.",
        truncated: false,
      },
    ];
    doc.revision++;
  }, ctx);
  await createBuiltinAdapters()[1]?.connect(f.context);
  const view = f.views.get("pig.delegations");
  if (view?.kind !== "agents") throw new Error("Missing research view");
  expect(view.runs[0]?.state).toEqual({
    phase: "finished",
    outcome: "success",
  });
  expect(view.runs[0]?.output?.text).toContain("Evidence");
  const state = await f.harness.snapshot(Delegations, f.conversation.id, ctx);
  if (!state) throw new Error("Missing document");
  const unknown = delegationView("session", {
    revision: 2,
    runs: state.runs.map((run) => ({ ...run, outcome: "unknown" })),
  });
  expect(unknown.runs[0]?.state.phase).toBe("unknown");
  expect(unknown.runs[0]?.state.outcome).toBe("unknown");
  expect(validateView(unknown)).toEqual(unknown);
  expect(
    validateView(todoView("session", { revision: 0, items: [] })).kind,
  ).toBe("todo");
  f.dispose();
});
test("retirement removes the view and disposal rejects late watch delivery", async () => {
  const f = await fixture();
  await f.harness.commit(
    (tx) => replaceTodos(tx, f.conversation.id, 0, []),
    ctx,
  );
  await createBuiltinAdapters()[0]?.connect(f.context);
  const callback = [...(f.listeners.get("pig.todos") ?? [])][0];
  if (!callback) throw new Error("Missing document listener");
  await callback({ value: { revision: 1, items: [] }, retired: true });
  expect(f.views.size).toBe(0);
  f.dispose();
  await callback({ value: { revision: 1, items: [] }, retired: false });
  expect(f.views.size).toBe(0);
});

test("creation during missing-watch acquisition is retried without duplicate listeners", async () => {
  const f = await fixture();
  const watch = f.context.sources.watchDocument;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquisitions = 0;
  f.context.sources.watchDocument = async (token, listener) => {
    if (++acquisitions === 1) {
      await gate;
      return undefined;
    }
    return watch(token, listener);
  };
  const connected = createBuiltinAdapters()[0]?.connect(f.context);
  await f.harness.commit(
    (tx) => replaceTodos(tx, f.conversation.id, 0, []),
    ctx,
  );
  const invalidated = f.publish();
  release();
  await Promise.all([connected, invalidated]);
  expect(f.views.has("pig.todos")).toBe(true);
  expect(f.listeners.get("pig.todos")?.size).toBe(1);
  f.dispose();
});
