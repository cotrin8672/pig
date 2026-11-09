import type {
  ConversationDocToken,
  JsonObject,
} from "@earendil-works/pi-durable";
import type {
  AdapterContext,
  AgentView,
  DocumentState,
  SessionAdapter,
  TodoView,
  Unsubscribe,
} from "../../../../packages/config/src";
import {
  type DelegationState,
  Delegations,
  replaceTodos,
  type TodoState,
  Todos,
} from "./builtin-extensions";

/** Native planning data is not a projection of running or disappeared tasks. */
export function todoView(
  sessionId: string,
  state: Readonly<TodoState>,
): TodoView {
  return {
    id: "pig.todos",
    kind: "todo",
    title: "TODO",
    source: {
      label: "pig.todos",
      scope: { kind: "session", id: sessionId },
      freshness: "saved",
    },
    explanation:
      "Planning checklist only; updating an item does not execute it.",
    origin: {
      kind: "document",
      id: "pig.todos",
      revision: String(state.revision),
    },
    items: state.items.map((item) => ({
      ...item,
      identity: "native",
      actions: [
        {
          id: `todo:${item.id}`,
          label: item.state === "completed" ? "Reopen" : "Complete",
          command: "todos.set-state",
          input: {
            revision: state.revision,
            id: item.id,
            state: item.state === "completed" ? "pending" : "completed",
          },
        },
      ],
    })),
  };
}
export function delegationView(
  sessionId: string,
  state: Readonly<DelegationState>,
): AgentView {
  return {
    id: "pig.delegations",
    kind: "agents",
    title: "Research",
    source: {
      label: "pig.delegations",
      scope: { kind: "session", id: sessionId },
      freshness: "saved",
    },
    origin: {
      kind: "document",
      id: "pig.delegations",
      revision: String(state.revision),
    },
    runs: state.runs.map((run) => ({
      id: String(run.taskId),
      title: run.task,
      task: run.task,
      profile: run.profile,
      model: run.model,
      agentId: run.profile,
      session: { kind: "session", id: String(run.childId) },
      state: {
        phase: run.outcome === "unknown" ? "unknown" : "finished",
        outcome: run.outcome,
        ...(run.outcome === "unknown"
          ? { label: "Awaiting a saved outcome; not proof of active execution" }
          : {}),
      },
      output: { text: run.result, truncated: run.truncated },
    })),
  };
}
/** Missing watches stay missing: retry acquisition only on native source invalidations, never poll disk. */
async function mountDocument<T extends JsonObject>(
  ctx: AdapterContext,
  token: ConversationDocToken<T>,
  id: string,
  render: (value: Readonly<T>) => void,
): Promise<Unsubscribe> {
  let closed = false,
    watching: Unsubscribe | undefined,
    attaching: Promise<void> | undefined;
  let requested = false;
  const show = (state: DocumentState<T>) => {
    if (closed || ctx.scope.signal.aborted) return;
    if (state.retired) ctx.views.remove(id);
    else render(state.value);
  };
  const attach = async () => {
    if (closed || watching || ctx.scope.signal.aborted) return;
    if (attaching) {
      requested = true;
      await attaching;
      return;
    }
    attaching = (async () => {
      const stop = await ctx.sources.watchDocument(token, show);
      if (closed || ctx.scope.signal.aborted) stop?.();
      else watching = stop;
    })();
    try {
      await attaching;
    } finally {
      attaching = undefined;
    }
    if (requested) {
      requested = false;
      await attach();
    }
  };
  const stopSubscribe = ctx.sources.subscribe(attach);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stopSubscribe();
    watching?.();
    ctx.views.remove(id);
  };
  ctx.scope.onDispose(cleanup);
  try {
    await attach();
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function createBuiltinAdapters(): readonly SessionAdapter[] {
  return [
    {
      id: "pig.todos",
      connect: async (ctx) => {
        const conversationId = ctx.sources.conversation().conversation.id;
        ctx.commands.register({
          id: "todos.set-state",
          title: "Update TODO state",
          allowWhileStreaming: true,
          run: async (input) => {
            if (
              !input ||
              typeof input !== "object" ||
              Array.isArray(input) ||
              typeof input.id !== "string" ||
              typeof input.revision !== "number" ||
              typeof input.state !== "string" ||
              ![
                "pending",
                "active",
                "completed",
                "cancelled",
                "unknown",
              ].includes(input.state) ||
              Object.keys(input).some(
                (key) => !["id", "revision", "state"].includes(key),
              )
            )
              throw new Error("Invalid TODO state command");
            const { id, revision, state } = input;
            await ctx.controller.commit(async (tx) => {
              const current = await tx.doc(Todos, conversationId);
              if (!current.items.some((item) => item.id === id))
                throw new Error("TODO item no longer exists");
              await replaceTodos(
                tx,
                conversationId,
                revision,
                current.items.map((item) => ({
                  ...item,
                  state: item.id === id ? state : item.state,
                })),
              );
            });
          },
        });
        return mountDocument(ctx, Todos, "pig.todos", (value) =>
          ctx.views.set(todoView(ctx.session.id, value)),
        );
      },
    },
    {
      id: "pig.delegations",
      connect: (ctx) =>
        mountDocument(ctx, Delegations, "pig.delegations", (value) =>
          ctx.views.set(delegationView(ctx.session.id, value)),
        ),
    },
  ];
}
