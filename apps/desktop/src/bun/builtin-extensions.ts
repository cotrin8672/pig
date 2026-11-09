import type { Context } from "@earendil-works/chord";
import {
  type Agent,
  type ConversationId,
  configure,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  hook,
  type ModelRef,
  section,
  type TaskId,
  type ToolRegistration,
  ToolResultEntry,
  ToolTask,
  type ToolTaskResult,
  type Tx,
} from "@earendil-works/pi-durable";

/** App-native planning data, deliberately unrelated to Durable execution Tasks. */
export type TodoItem = {
  id: string;
  title: string;
  state: "pending" | "active" | "completed" | "cancelled" | "unknown";
};
export type TodoState = { revision: number; items: TodoItem[] };
export const Todos = defineDoc<TodoState>({
  kind: "pig.todos",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ revision: 0, items: [] }),
  checkpointWhen: () => true,
});
export class RevisionConflict extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`TODO revision conflict: expected ${expected}, current ${actual}`);
  }
}
export function validateTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("Expected at most 200 TODO items");
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid TODO item");
    const candidate = item as Record<string, unknown>;
    if (
      Object.keys(candidate).some(
        (key) => !["id", "title", "state"].includes(key),
      ) ||
      typeof candidate.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate.id) ||
      typeof candidate.title !== "string" ||
      !candidate.title.trim() ||
      candidate.title.length > 500 ||
      typeof candidate.state !== "string" ||
      !["pending", "active", "completed", "cancelled", "unknown"].includes(
        candidate.state,
      )
    )
      throw new Error("Invalid TODO item");
    if (seen.has(candidate.id))
      throw new Error(`Duplicate TODO id: ${candidate.id}`);
    seen.add(candidate.id);
    return {
      id: candidate.id,
      title: candidate.title,
      state: candidate.state as TodoItem["state"],
    };
  });
}
/** Shared CAS for the native Tool and explicit GUI controller commands. */
export async function replaceTodos(
  tx: Tx,
  conversationId: ConversationId,
  expectedRevision: number,
  value: unknown,
): Promise<number> {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("Invalid TODO revision");
  const items = validateTodoItems(value),
    doc = await tx.doc(Todos, conversationId);
  if (doc.revision !== expectedRevision)
    throw new RevisionConflict(expectedRevision, doc.revision);
  doc.items = items;
  return ++doc.revision;
}
export function createTodosExtension() {
  return defineExtension({
    name: "pig.todos",
    tools: [
      defineTool({
        name: "todos",
        description:
          "Replace the conversation's planning checklist using its current revision. This does not start execution tasks.",
        replay: "unsafe",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision", "items"],
          properties: {
            expectedRevision: { type: "integer", minimum: 0 },
            items: {
              type: "array",
              maxItems: 200,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "title", "state"],
                properties: {
                  id: {
                    type: "string",
                    pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
                  },
                  title: { type: "string", minLength: 1, maxLength: 500 },
                  state: {
                    enum: [
                      "pending",
                      "active",
                      "completed",
                      "cancelled",
                      "unknown",
                    ],
                  },
                },
              },
            },
          },
        },
        execute: async (args, api, ctx) => {
          const input = args as { expectedRevision: number; items: unknown };
          const revision = await api.commit(
            (tx) =>
              replaceTodos(
                tx,
                api.conversationId,
                input.expectedRevision,
                input.items,
              ),
            ctx,
          );
          return {
            output: [
              {
                type: "text",
                text: `TODO revision ${revision} saved. No execution tasks started.`,
              },
            ],
          };
        },
      }),
    ],
    sections: [
      section("todos", async (input, ctx) => {
        const doc = await input.read.snapshot(Todos, input.conversationId, ctx);
        return `Planning checklist revision ${doc?.revision ?? 0}:\n${JSON.stringify(doc?.items ?? [])}`;
      }),
    ],
  });
}

export type DelegationOutcome =
  | "unknown"
  | "success"
  | "error"
  | "cancelled"
  | "interrupted";
export type DelegationRecord = {
  taskId: TaskId;
  childId: ConversationId;
  requestId: string;
  task: string;
  profile: string;
  model: string;
  outcome: DelegationOutcome;
  result: string;
  truncated: boolean;
};
export type DelegationState = { revision: number; runs: DelegationRecord[] };
/** Saved outcomes outlive the live task graph. Forks do not inherit running child ownership. */
export const Delegations = defineDoc<DelegationState>({
  kind: "pig.delegations",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ revision: 0, runs: [] }),
  checkpointWhen: () => true,
});
export type DelegationOptions = {
  /** Parent supplies the already security/image-wrapped native read tool. */
  readTool: ToolRegistration;
  profile: {
    id: string;
    extensions: readonly Extension[];
    instructions?: string;
  };
  model: ModelRef;
  cwd: string;
  maxTurns: number;
  /** Concurrent delegations per parent conversation (admitted atomically). */
  maxConcurrency: number;
  maxDepth: number;
  maxReturnChars: number;
  /** Public Host closure: (id, ctx) => harness.conversation(id, ctx).then(c => c!.agent(ctx)). */
  inspectAgent(
    conversationId: ConversationId,
    context: Context,
  ): Promise<Agent>;
};
function boundedInteger(name: string, value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be ${min}..${max}`);
}
function boundedText(text: string, max: number) {
  const truncated = text.length > max;
  const suffix = "\n[truncated]";
  return {
    result: truncated ? `${text.slice(0, max - suffix.length)}${suffix}` : text,
    truncated,
  };
}

/**
 * Host calls in its commit after task settlement and on reopen, BEFORE publishing saved Dock state.
 * No graph-disappearance heuristic and no orphaned work is automatically resumed. Missing evidence stays unknown.
 */
export async function reconcileDelegations(
  tx: Tx,
  conversationId: ConversationId,
): Promise<void> {
  const doc = await tx.doc(Delegations, conversationId);
  for (let i = 0; i < doc.runs.length; i++) {
    const run = doc.runs[i];
    if (!run || run.outcome !== "unknown") continue;
    const task = await tx.task(run.taskId);
    if (!task || task.state.status !== "terminal") continue;
    let outcome: DelegationOutcome = "interrupted";
    if (task.state.outcome.status === "aborted")
      outcome = task.abortReason === "restart" ? "interrupted" : "cancelled";
    else if (
      task.state.outcome.status === "failed" ||
      task.state.outcome.status === "faulted"
    )
      outcome = "error";
    else if (task.state.outcome.status === "completed") {
      const receipt = task.state.outcome.result as ToolTaskResult;
      if (receipt.kind === "model") {
        const entry = await tx.entry(ToolResultEntry, receipt.entryId);
        const codes = entry?.data.diagnostics.map((item) => item.code) ?? [];
        if (codes.includes("aborted")) outcome = "cancelled";
        else if (
          codes.includes("abandoned") ||
          codes.includes("interrupted") ||
          codes.includes("restart_limit")
        )
          outcome = "interrupted";
        else if (
          entry?.model?.some(
            (message) => message.role === "toolResult" && message.isError,
          )
        )
          outcome = "error";
      }
    }
    // A completed ToolTask may carry an interrupted/error tool result; never manufacture success.
    doc.runs[i] = {
      ...run,
      outcome,
      result: `Delegation ${outcome}; no committed research conclusion is available.`,
      truncated: false,
    };
    doc.revision++;
  }
}

/** Small synchronous delegation; no intercom, background manager, transcript copying, or replay claim. */
export function createDelegationExtensions(options: DelegationOptions): {
  extension: Extension;
  researchExtension: Extension;
} {
  boundedInteger("maxTurns", options.maxTurns, 1, 32);
  boundedInteger("maxConcurrency", options.maxConcurrency, 1, 8);
  boundedInteger("maxDepth", options.maxDepth, 1, 8);
  boundedInteger("maxReturnChars", options.maxReturnChars, 256, 16000);
  if (
    options.readTool.name !== "read" ||
    !options.cwd ||
    !options.model.provider ||
    !options.model.modelId ||
    !options.profile.id ||
    typeof options.inspectAgent !== "function"
  )
    throw new Error(
      "An explicit native read-only research profile/model/cwd and public agent inspector are required",
    );
  if (
    new Set(options.profile.extensions.map((ext) => ext.name)).size !==
      options.profile.extensions.length ||
    options.profile.extensions.some((ext) => ext.name === "pig.research")
  )
    throw new Error("Duplicate research extension");
  const researchExtension = defineExtension({
    name: "pig.research",
    tools: [options.readTool],
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) =>
          call.name === "read"
            ? undefined
            : { block: "Research permits only read" },
        afterTool: (_call, result) => {
          const { control: _control, ...rest } = result;
          return rest;
        },
      }),
    ],
  });
  const profile = {
    extensions: [...options.profile.extensions, researchExtension],
    tools: [options.readTool],
    modelTools: [options.readTool],
    model: options.model,
    thinkingLevel: "off" as const,
    cwd: options.cwd,
    maxTurns: options.maxTurns,
    instructions: `Read-only research. Do not execute commands, change files, or delegate. Return a short Conclusion, Evidence (paths/lines), and Unresolved section.\n${options.profile.instructions ?? ""}`,
  };
  const tool = defineTool({
    name: "delegate",
    description:
      "Research one bounded question in a fresh, task-owned, read-only child conversation. Returns a saved short conclusion, evidence and unresolved issues.",
    // Deliberately unsafe until a real crash/restart test proves safe replay. Child and submission still deduplicate.
    replay: "unsafe",
    outputLimits: { maxBytes: options.maxReturnChars * 4, maxLines: 1000 },
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: 8000 } },
    },
    execute: async (args, api, ctx) => {
      const task = (args as { task: string }).task;
      if (typeof task !== "string" || !task.trim() || task.length > 8000)
        throw new Error("Research question must be 1..8000 characters");
      const requestId = `delegate:${api.taskId}`;
      const childId = await api.commit(async (tx) => {
        const prior = (
          await tx.scanConversations({ ownerTaskId: api.taskId }, 1)
        ).items[0];
        let conversation = await tx.conversation(api.conversationId),
          depth = 1;
        while (conversation?.owner) {
          if (++depth > options.maxDepth)
            throw new Error("Delegation depth limit exceeded");
          conversation = await tx.conversation(
            conversation.owner.conversationId,
          );
        }
        const doc = await tx.doc(Delegations, api.conversationId),
          saved = doc.runs.find((run) => run.taskId === api.taskId);
        if (saved) {
          if (saved.task !== task || !prior || saved.childId !== prior.id)
            throw new Error("Delegation recovery identity mismatch");
          return prior.id;
        }
        await reconcileDelegations(tx, api.conversationId);
        let active = 0;
        for (const run of doc.runs) {
          const owner = await tx.task(run.taskId);
          if (owner && owner.state.status !== "terminal") active++;
        }
        if (active >= options.maxConcurrency)
          throw new Error("Delegation concurrency limit exceeded");
        if (doc.runs.length >= 100)
          throw new Error("Conversation delegation history limit exceeded");
        const child =
          prior ??
          (await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          }));
        // createConversation inherits agent settings, NOT transcript. Replace every security-relevant choice explicitly.
        await configure(tx, child.id, profile);
        doc.runs.push({
          taskId: api.taskId,
          childId: child.id,
          requestId,
          task,
          profile: options.profile.id,
          model: `${options.model.provider}/${options.model.modelId}`,
          outcome: "unknown",
          result: "Awaiting a committed research conclusion.",
          truncated: false,
        });
        doc.revision++;
        return child.id;
      }, ctx);
      const saved = (
        await api.snapshot(Delegations, api.conversationId, ctx)
      )?.runs.find((run) => run.taskId === api.taskId);
      if (saved && saved.outcome !== "unknown")
        return {
          isError: saved.outcome !== "success",
          output: [{ type: "text", text: saved.result }],
        };
      try {
        const child = await api.conversation(childId, ctx);
        if (!child)
          throw new Error("Task-owned research conversation is missing");
        // Native section/hook throws are reported and swallowed; inspect via the public Host read BEFORE submit instead.
        const agent = await options.inspectAgent(childId, ctx);
        if (
          agent.tools.length !== 1 ||
          agent.tools[0]?.name !== "read" ||
          agent.callable.some((tool) => tool.name !== "read") ||
          agent.deferred.length ||
          agent.maxTurns !== options.maxTurns ||
          agent.cwd !== options.cwd ||
          agent.model?.provider !== options.model.provider ||
          agent.model.modelId !== options.model.modelId ||
          agent.instructions !== profile.instructions ||
          agent.extensions.map((ext) => ext.name).join("\n") !==
            profile.extensions.map((ext) => ext.name).join("\n")
        )
          throw new Error(
            "Effective research agent violates the read-only profile",
          );
        const submission = await child.submit(
          { type: "input", content: task, requestId },
          ctx,
        );
        const settled = await submission.wait(ctx);
        const record = await api.commit(async (tx) => {
          let outcome: DelegationOutcome = "error",
            text: string;
          if (settled.type === "input" && settled.status === "done") {
            const answer = await tx.entry(settled.answer);
            text =
              answer?.model
                ?.filter((message) => message.role === "assistant")
                .flatMap((message) =>
                  message.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text),
                )
                .join("\n") ?? "";
            outcome = text.trim() ? "success" : "error";
            if (!text.trim())
              text =
                "Unresolved: child answered without a text research conclusion.";
          } else {
            const reason =
              settled.status === "unanswered" ? settled.reason : "unknown";
            outcome = /abort|cancel/.test(reason)
              ? "cancelled"
              : /interrupt|restart/.test(reason)
                ? "interrupted"
                : "error";
            text = `Unresolved: research did not produce an answer (${reason}).`;
          }
          const doc = await tx.doc(Delegations, api.conversationId),
            index = doc.runs.findIndex((run) => run.taskId === api.taskId),
            current = doc.runs[index];
          if (!current) throw new Error("Delegation history record missing");
          const record = {
            ...current,
            outcome,
            ...boundedText(text, options.maxReturnChars),
          };
          doc.runs[index] = record;
          doc.revision++;
          return record;
        }, ctx);
        return {
          isError: record.outcome !== "success",
          output: [{ type: "text", text: record.result }],
        };
      } catch (error) {
        // On cancellation invocation commits may be forbidden. Host reconciliation records the native receipt later.
        if (ctx.abortSignal?.aborted) throw error;
        const result = boundedText(
          `Unresolved: ${error instanceof Error ? error.message : String(error)}`,
          options.maxReturnChars,
        );
        await api.commit(async (tx) => {
          const doc = await tx.doc(Delegations, api.conversationId),
            index = doc.runs.findIndex((run) => run.taskId === api.taskId),
            current = doc.runs[index];
          if (!current) throw new Error("Delegation history record missing");
          doc.runs[index] = { ...current, outcome: "error", ...result };
          doc.revision++;
        }, ctx);
        return {
          isError: true,
          output: [{ type: "text", text: result.result }],
        };
      }
    },
  });
  return {
    extension: defineExtension({ name: "pig.delegation", tools: [tool] }),
    researchExtension,
  };
}
