// Repository-relative native import for typecheck; copied configs use @earendil-works/pi-durable and @pig/config.
import {
  type ConversationDocToken,
  defineDoc,
  type JsonObject,
  type TaskGraphNode,
} from "../../apps/desktop/node_modules/@earendil-works/pi-durable";
import type {
  AdapterContext,
  AgentRun,
  DocumentState,
  Provenance,
  RunState,
  SessionAdapter,
} from "../../packages/config/src";

export type TodoState = {
  revision: number;
  items: { id: string; title: string; done: boolean }[];
};
export type ModeState = { workflow: "work" | "review" };
export type DelegationRun = {
  id: string;
  title: string;
  profile: string;
  taskId: string;
  conversationId?: string;
  parentId?: string;
  dependsOn?: string[];
  outcome?: "success" | "error" | "cancelled" | "interrupted" | "unknown";
  output: string;
};
export type DelegationState = { runs: DelegationRun[] };
export type ArtifactState = {
  revision: number;
  text: string;
  stage: "draft" | "final";
};

export const TodoDoc = defineDoc({
  kind: "example.todos",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: (): TodoState => ({ revision: 0, items: [] }),
  checkpointWhen: () => true,
});
export const ModeDoc = defineDoc({
  kind: "example.mode",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: (): ModeState => ({ workflow: "work" }),
  checkpointWhen: () => true,
});
export const DelegationDoc = defineDoc({
  kind: "example.delegations",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: (): DelegationState => ({ runs: [] }),
  checkpointWhen: () => true,
});
export const ArtifactDoc = defineDoc({
  kind: "example.artifact",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: (): ArtifactState => ({ revision: 0, text: "", stage: "draft" }),
  checkpointWhen: () => true,
});

function source(
  ctx: AdapterContext,
  label: string,
  freshness: Provenance["freshness"],
): Provenance {
  return { label, scope: { kind: "session", id: ctx.session.id }, freshness };
}
function observe<T extends JsonObject>(
  ctx: AdapterContext,
  token: ConversationDocToken<T>,
  render: (state: DocumentState<T> | undefined) => void,
): Promise<void> {
  render(undefined); // Missing never becomes a fabricated successful/empty domain document.
  return ctx.sources.watchDocument(token, render).then(() => {});
}
function state(run: DelegationRun, live?: TaskGraphNode): RunState {
  if (run.outcome !== undefined)
    return { phase: "finished", outcome: run.outcome };
  if (!live)
    return {
      phase: "unknown",
      outcome: "unknown",
      label: "No terminal result recorded; live task unavailable",
    };
  if (live.blocked) return { phase: "paused", label: live.blocked };
  switch (live.state.status) {
    case "pending":
      return { phase: "queued" };
    case "running":
      return { phase: "running" };
    case "waiting":
      return { phase: "waiting" };
    case "sleeping":
      return { phase: "waiting", label: "Sleeping" };
    case "completing":
      return {
        phase: "waiting",
        label: "Draining owned tasks; terminal result not recorded yet",
      };
  }
}

export function nativeTodoAdapter(): SessionAdapter {
  return {
    id: "native-todos",
    connect: (ctx) =>
      observe(ctx, TodoDoc, (state) => {
        ctx.views.set({
          kind: "todo",
          id: "todos",
          title: "TODO",
          source: source(
            ctx,
            "Native TODO document",
            state ? (state.retired ? "saved" : "live") : "unknown",
          ),
          explanation: state
            ? "TODO describes work; it does not automatically create execution tasks."
            : "TODO document is absent, not an empty saved list.",
          items:
            state?.value.items.map((item) => ({
              id: item.id,
              identity: "native",
              title: item.title.slice(0, 16_000),
              state: item.done ? "completed" : "pending",
            })) ?? [],
          ...(state
            ? {
                origin: {
                  kind: "document",
                  id: TodoDoc.definition.kind,
                  revision: String(state.value.revision),
                },
              }
            : {}),
        });
      }),
  };
}
export function nativeModeAdapter(): SessionAdapter {
  return {
    id: "native-mode",
    async connect(ctx) {
      let writable = false;
      ctx.commands.register({
        id: "review",
        title: "Set review workflow",
        async run() {
          if (!writable)
            throw new Error("Mode document unavailable or retired");
          const conversationId = ctx.sources.conversation().conversation.id;
          await ctx.controller.commit(async (tx) => {
            const doc = await tx.doc(ModeDoc, conversationId);
            doc.workflow = "review";
          });
        },
      });
      await observe(ctx, ModeDoc, (state) => {
        writable = Boolean(state && !state.retired);
        ctx.views.set({
          kind: "mode",
          id: "workflow",
          title: "Workflow",
          axis: "workflow",
          source: source(
            ctx,
            "Native workflow document",
            state ? (state.retired ? "saved" : "live") : "unknown",
          ),
          value: state?.value.workflow ?? null,
          choices: [
            { id: "work", label: "Work" },
            { id: "review", label: "Review" },
          ],
          description:
            "Explicit workflow set, not a legacy toggle. TODO is a separate document and is never cleared.",
          actions: writable
            ? [
                {
                  id: "review",
                  command: "review",
                  label: "Set review workflow",
                },
              ]
            : [],
        });
      });
    },
  };
}
export function nativeDelegationAdapter(): SessionAdapter {
  return {
    id: "native-delegations",
    async connect(ctx) {
      let document: DocumentState<DelegationState> | undefined;
      const render = () => {
        const graph = ctx.sources.taskGraph(); // Workspace LIVE graph; never used as history.
        const runs: AgentRun[] =
          document?.value.runs.slice(-128).map((run) => ({
            id: run.id,
            title: run.title.slice(0, 16_000),
            profile: run.profile,
            state: state(
              run,
              document?.retired ? undefined : graph.tasks[run.taskId],
            ),
            ...(run.conversationId
              ? {
                  session: { kind: "session", id: run.conversationId } as const,
                }
              : {}),
            ...(run.parentId ? { parentId: run.parentId } : {}),
            ...(run.dependsOn ? { dependsOn: [...run.dependsOn] } : {}),
            output: {
              text: run.output.slice(0, 20_000),
              truncated: run.output.length > 20_000,
              stream: "combined",
            },
            facts: [
              { label: "Task", value: run.taskId },
              {
                label: "Result",
                value:
                  run.outcome === undefined
                    ? "Unconfirmed"
                    : "Persisted in delegation document",
              },
            ],
          })) ?? [];
        ctx.views.set({
          kind: "agents",
          id: "delegations",
          title: "Delegated runs",
          runs,
          source: source(
            ctx,
            "Native owned delegation results",
            document ? (document.retired ? "saved" : "live") : "unknown",
          ),
          facts: [
            {
              label: "Scope",
              value:
                "Owned delegation only. Independent-agent communication is a separate operation.",
            },
          ],
        });
      };
      ctx.sources.subscribe(render);
      await observe(ctx, DelegationDoc, (value) => {
        document = value;
        render();
      });
    },
  };
}
export function nativeDocumentAdapter(): SessionAdapter {
  return {
    id: "native-document",
    connect: (ctx) =>
      observe(ctx, ArtifactDoc, (state) => {
        ctx.views.set({
          kind: "document",
          id: "artifact",
          title: "Artifact",
          source: source(
            ctx,
            "Native artifact document",
            state ? (state.retired ? "saved" : "live") : "unknown",
          ),
          resource: {
            kind: "document",
            id: ArtifactDoc.definition.kind,
            ...(state ? { revision: String(state.value.revision) } : {}),
          },
          text: state?.value.text.slice(0, 50_000) ?? "Document unavailable",
          format: "markdown",
          stage: state?.value.stage ?? "unknown",
        });
      }),
  };
}
