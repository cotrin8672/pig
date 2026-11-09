import { createHash } from "node:crypto";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  AgentDoc,
  CompactionTask,
  type ConversationDocToken,
  type Cursor,
  type DocumentRecord,
  defineDoc,
  type Extension,
  GenerationTask,
  type Harness,
  type HarnessInspection,
  InboxDoc,
  type JsonObject,
  LiveDoc,
  NestedCallDoc,
  ProviderDoc,
  type Storage,
  ToolTask,
  type ToolTaskInput,
  type Tx,
  UsageDoc,
} from "@earendil-works/pi-durable";
import { Delegations, Todos } from "./builtin-extensions";
import { DurableReceiptDoc } from "./durable-send-receipts";
import { NativeApprovals } from "./native-approvals";
import {
  assertConversationMembership,
  PigConversationMeta,
  PigWorkspaceMeta,
} from "./native-conversation-meta";
import type {
  RuntimeCompatibilityInput,
  WorkspaceRuntime,
} from "./workspace-runtime";

type Manifest = { signature?: string; opaque?: boolean };
/** No migration/default signature: an empty or missing document is NOT evidence. */
export const BuiltinRuntimeManifest = defineDoc<Manifest>({
  kind: "pig.builtin-runtime-manifest",
  version: 1,
  scope: "session",
  initial: () => ({}),
  checkpointWhen: () => true,
});

type Workspace = Pick<WorkspaceRuntime, "harness" | "registry" | "identity">;
/** Read-only PUBLIC Storage port for this same NEW agent-v2 workspace. Harness/Tx cannot enumerate docs. */
export type BuiltinCompatibilityStorage = Pick<
  Storage,
  "scanDocuments" | "scanSubmissions"
>;
export interface BuiltinRuntimeCompatibility {
  readonly signature: string;
  /** Host must exclude admission/scheduling. Call before first admission, including on idle reopen.
   * Bootstrap needs non-creating Harness snapshots plus the public Storage metadata port. */
  initialize(workspace: Workspace): Promise<void>;
  /** First operation in conversationCreated, in the SAME transaction as app documents.
   * Never bootstraps an absent manifest; initialize() must already have run. */
  admit(tx: Tx): Promise<void>;
  validateResume(
    workspace: Workspace,
    inspection: HarnessInspection,
  ): Promise<string | undefined>;
  /** Capture both policies per candidate; do not publish a candidate to check it. */
  checkCompatibility(
    input: RuntimeCompatibilityInput,
    next: BuiltinRuntimeCompatibility,
  ): Promise<string | undefined>;
  /** Evidence only. Host separately checks live work/submissions and holds the actual mutation lease. */
  pendingDependencies(workspace: Workspace): Promise<string | undefined>;
}

const tasks = [GenerationTask, ToolTask, CompactionTask] as const;
const conversationDocs = [
  AgentDoc,
  InboxDoc,
  LiveDoc,
  ProviderDoc,
  UsageDoc,
  PigConversationMeta,
  Todos,
  Delegations,
  NativeApprovals,
] as const;
const sessionDocs = [
  BuiltinRuntimeManifest,
  PigWorkspaceMeta,
  DurableReceiptDoc,
] as const;
const documents = [...sessionDocs, ...conversationDocs, NestedCallDoc];
const toolNames: Readonly<Record<string, readonly string[]>> = {
  "pig.tools": ["read", "write", "edit", "bash", "powershell"],
  "pig.todos": ["todos"],
  "pig.delegation": ["delegate"],
  "pig.research": ["read"],
  "pig.resources": [],
  "pig.reconcile": [],
  "pig.approvals": [],
  "pig.image-policy": [],
  "pig.tool-policy": [],
};
const policies = new WeakMap<
  BuiltinRuntimeCompatibility,
  {
    extensions: readonly Extension[];
    opaque: boolean;
  }
>();
const reason = (message: string) =>
  `BUILTIN_RUNTIME_COMPATIBILITY_UNKNOWN: ${message}`;
const sorted = (values: readonly string[]) => [...values].sort();

/** Canonical DATA only. Never stringify functions, invoke hooks/wrappers/renderers or instantiate tools. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  if (typeof value === "function") throw new Error(reason("non-data metadata"));
  return value;
}
function metadata(extensions: readonly Extension[]) {
  return extensions
    .map((extension) => ({
      name: extension.name,
      tasks: (extension.tasks ?? [])
        .map((task) => [task.definition.name, task.definition.version])
        .sort(),
      tools: (extension.tools ?? [])
        .map((tool) => ({
          name: tool.name,
          parameters: tool.parameters,
          replay: tool.replay ?? "unsafe",
          executionMode: tool.executionMode,
          callers: tool.callers,
          deferred: tool.deferred,
          outputLimits: tool.outputLimits,
          structuredOutputSchema: tool.structuredOutputSchema,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      sections: sorted(
        (extension.sections ?? []).map((section) => section.key),
      ),
      hooks: (extension.hooks ?? [])
        .map((hook) => [hook.task, sorted(Object.keys(hook.handlers))])
        .sort(),
      wraps: sorted(
        (extension.wraps ?? []).map((wrap) =>
          "tool" in wrap ? `tool:${wrap.tool}` : `section:${wrap.section}`,
        ),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function sameExtensions(
  actual: readonly Extension[] = [],
  expected: readonly Extension[],
) {
  return (
    actual.length === expected.length &&
    expected.every((extension) => actual.includes(extension))
  );
}
async function* conversations(harness: Harness) {
  let cursor: Cursor | undefined;
  do {
    const page = await harness.commit(
      (tx) => tx.scanConversations({}, 100, cursor),
      context,
    );
    for (const record of page.items) yield record;
    cursor = page.next;
  } while (cursor);
}
/** Current metadata only, not SQL, retired incarnations or history. Typed snapshots reject version/scope drift. */
async function readScope(
  harness: Harness,
  storage: BuiltinCompatibilityStorage,
  scope: DocumentRecord["scope"],
): Promise<string | undefined> {
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanDocuments(
      { scope, at: "current" },
      100,
      cursor,
      context,
    );
    for (const record of page.items) {
      if (scope.kind === "session") {
        if (
          record.kind === BuiltinRuntimeManifest.definition.kind &&
          record.key === undefined
        )
          await harness.snapshot(BuiltinRuntimeManifest, context);
        else if (
          record.kind === PigWorkspaceMeta.definition.kind &&
          record.key === undefined
        )
          await harness.snapshot(PigWorkspaceMeta, context);
        else if (
          record.kind === DurableReceiptDoc.definition.kind &&
          record.key !== undefined
        )
          await harness.snapshot(DurableReceiptDoc, record.key, context);
        else return reason(`unknown session document ${record.kind}`);
      } else if (scope.kind === "conversation") {
        const token = conversationDocs.find(
          (doc) => doc.definition.kind === record.kind,
        );
        if (!token || record.key !== undefined)
          return reason(`unknown conversation document ${record.kind}`);
        await harness.snapshot(
          token as ConversationDocToken<JsonObject>,
          scope.conversationId,
          context,
        );
      } else {
        if (
          record.kind !== NestedCallDoc.definition.kind ||
          record.key === undefined
        )
          return reason(`unknown task document ${record.kind}`);
        await harness.snapshot(
          NestedCallDoc,
          scope.taskId,
          record.key,
          context,
        );
      }
    }
    cursor = page.next;
  } while (cursor);
}

/** TRUSTED APP ASSEMBLY PORT, not an extension verifier or sandbox.
 * opaque MUST be true for ANY extra runtime extension or conversationCreated callback, even unselected.
 * opaque:false asserts these exact objects came only from fixed app/native 1.5 factories; names/versions
 * and this data signature do NOT prove arbitrary JavaScript/closure/schema compatibility.
 * Bump the protocol revision when app-owned persisted semantics change. */
export function builtinRuntimeCompatibility(options: {
  extensions: readonly Extension[];
  opaque: boolean;
  /** Same storage passed to Harness.open, narrowed to read-only public metadata APIs. */
  storage: BuiltinCompatibilityStorage;
}): BuiltinRuntimeCompatibility {
  const extensions = [...options.extensions];
  const unsupported =
    !options.opaque &&
    extensions.find(
      (extension, index) =>
        !Object.hasOwn(toolNames, extension.name) ||
        extensions.findIndex((e) => e.name === extension.name) !== index ||
        extension.tools?.some(
          (tool) => !toolNames[extension.name]?.includes(tool.name),
        ) ||
        extension.tasks?.some(
          (task) => !tasks.some((known) => known === task),
        ) ||
        extension.hooks?.some(
          (hook) => !tasks.some((known) => known.definition.name === hook.task),
        ),
    );
  // Opaque definitions are never traversed for tool/schema metadata.
  const signature = `pig-native-1:${createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          protocol: 1,
          native: "1.5.0",
          documents: documents
            .map(({ definition: d }) => ({
              kind: d.kind,
              version: d.version,
              scope: d.scope,
              family: "family" in d ? d.family : undefined,
              history: "history" in d ? d.history : undefined,
              fork: "fork" in d ? d.fork : undefined,
            }))
            .sort((a, b) => a.kind.localeCompare(b.kind)),
          tasks: tasks.map(({ definition: d }) => [d.name, d.version]).sort(),
          extensions: options.opaque || unsupported ? [] : metadata(extensions),
        }),
      ),
    )
    .digest("hex")}`;
  const opaque = options.opaque || !!unsupported;
  const ownTools = new Set(
    opaque
      ? []
      : extensions.flatMap(
          (extension) => extension.tools?.map((tool) => tool.name) ?? [],
        ),
  );
  const manifestReason = (manifest: Readonly<Manifest> | undefined) =>
    opaque
      ? reason("opaque or unsupported runtime")
      : !manifest?.signature
        ? reason("missing manifest")
        : manifest.opaque !== false
          ? reason("opaque manifest")
          : manifest.signature !== signature
            ? reason("changed manifest")
            : undefined;
  const installedReason = (workspace: Workspace) =>
    sameExtensions(workspace.registry.snapshot().installed(), extensions)
      ? undefined
      : reason("unattested installed extensions");

  async function inspect(
    workspace: Workspace,
    inspection: HarnessInspection,
    dependencies: boolean,
  ) {
    const h = workspace.harness;
    const rejected =
      manifestReason(await h.snapshot(BuiltinRuntimeManifest, context)) ??
      installedReason(workspace);
    if (rejected) return rejected;
    const sessionReason = await readScope(h, options.storage, {
      kind: "session",
    });
    if (sessionReason) return sessionReason;
    const identity = await h.snapshot(PigWorkspaceMeta, context);
    if (
      !identity ||
      identity.workspaceKey !== workspace.identity.key ||
      identity.canonicalCwd !== workspace.identity.cwd
    )
      return reason("unknown workspace identity");
    const registry = workspace.registry.snapshot();
    const referenced = new Set([
      ...inspection.tasks.map((task) => task.record.conversationId),
      ...inspection.submissions.map((submission) => submission.conversationId),
    ]);
    for (const task of inspection.tasks) {
      const known = tasks.find(
        (definition) => definition.definition.name === task.record.kind,
      );
      if (
        !known ||
        registry.task(task.record.kind) !== known ||
        task.record.version !== known.definition.version ||
        task.state.kind === "blocked" ||
        (task.state.kind === "pending" && task.state.migrates)
      )
        return reason(`unknown/blocked/outdated task ${task.record.kind}`);
      if (known === ToolTask) {
        const input = task.record.input as ToolTaskInput;
        const call =
          input.kind === "nested"
            ? input.call
            : input.kind === "model"
              ? (
                  await h.commit((tx) => tx.entry(input.assistant), context)
                )?.model?.flatMap((message) =>
                  message.role === "assistant"
                    ? message.content.filter(
                        (part) =>
                          part.type === "toolCall" && part.id === input.callId,
                      )
                    : [],
                )[0]
              : undefined;
        if (!call || !("name" in call) || !ownTools.has(call.name))
          return reason("unknown native tool call");
      }
      const schemaReason = await readScope(h, options.storage, {
        kind: "task",
        taskId: task.record.id,
      });
      if (schemaReason) return schemaReason;
    }
    for await (const record of conversations(h)) {
      referenced.delete(record.id);
      const schemaReason = await readScope(h, options.storage, {
        kind: "conversation",
        conversationId: record.id,
      });
      if (schemaReason) return schemaReason;
      assertConversationMembership(
        await h.snapshot(PigConversationMeta, record.id, context),
        workspace.identity,
        record.id,
      );
      const agent = await h.snapshot(AgentDoc, record.id, context);
      if (!agent) return reason("missing agent document");
      const selected = agent.extensions;
      const names = Array.isArray(selected)
        ? selected
        : [...(selected?.add ?? []), ...(selected?.remove ?? [])];
      if (
        names.some(
          (name) => !extensions.some((extension) => extension.name === name),
        )
      )
        return reason("unknown saved extension selection");
      for (const filter of [agent.tools, agent.modelTools]) {
        const names = Array.isArray(filter)
          ? filter
          : [
              ...(filter?.remove ?? []),
              ...((filter && "add" in filter ? filter.add : undefined) ?? []),
            ];
        if (names.some((name) => !ownTools.has(name)))
          return reason("unknown saved tool selection");
      }
      const todos = await h.snapshot(Todos, record.id, context);
      const delegations = await h.snapshot(Delegations, record.id, context);
      const approvals = await h.snapshot(NativeApprovals, record.id, context);
      if (
        !todos ||
        !Array.isArray(todos.items) ||
        !delegations ||
        !Array.isArray(delegations.runs) ||
        !approvals ||
        !approvals.requests ||
        typeof approvals.requests !== "object" ||
        Array.isArray(approvals.requests)
      )
        return reason("missing/malformed app documents");
      if (
        [todos.revision, delegations.revision, approvals.revision].some(
          (revision) => !Number.isSafeInteger(revision) || revision < 0,
        ) ||
        delegations.runs.some(
          (run) =>
            !run ||
            ![
              "unknown",
              "success",
              "error",
              "cancelled",
              "interrupted",
            ].includes(run.outcome),
        )
      )
        return reason("unknown app document state");
      if (
        Object.values(approvals.requests).some(
          (request) =>
            !request ||
            typeof request.consumed !== "boolean" ||
            !["pending", "approved", "denied", "expired", "cancelled"].includes(
              request.state,
            ),
        )
      )
        return reason("unknown approval state");
      if (
        dependencies &&
        Object.values(approvals.requests).some(
          (request) =>
            request.state === "pending" ||
            (request.state === "approved" && !request.consumed),
        )
      )
        return reason(
          `pending approval dependency in conversation ${record.id}`,
        );
      if (
        dependencies &&
        delegations.runs.some((run) => run.outcome === "unknown")
      )
        return reason(
          `unresolved delegation dependency in conversation ${record.id}`,
        );
    }
    if (referenced.size) return reason("missing live conversation");
  }
  async function guarded(action: () => Promise<string | undefined>) {
    try {
      return await action();
    } catch (error) {
      return reason(
        `typed inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const policy: BuiltinRuntimeCompatibility = {
    signature,
    async initialize(workspace) {
      const h = workspace.harness;
      const existing = await h.snapshot(BuiltinRuntimeManifest, context);
      if (existing) {
        // Poison BEFORE custom admission; never clear poison by removing a registration.
        if (opaque) {
          await h.commit(async (tx) => {
            (await tx.doc(BuiltinRuntimeManifest)).opaque = true;
          }, context);
          return;
        }
        const rejected = await guarded(async () =>
          inspect(workspace, await h.inspect(context), false),
        );
        if (rejected) throw new Error(rejected);
        return;
      }
      if (installedReason(workspace))
        throw new Error(installedReason(workspace));
      for await (const _record of conversations(h))
        throw new Error(reason("refusing to stamp preexisting conversations"));
      if (
        (await h.commit((tx) => tx.scanTasks({}, 1), context)).items.length ||
        (await options.storage.scanSubmissions({}, 1, undefined, context)).items
          .length
      )
        throw new Error(reason("refusing to stamp preexisting work"));
      // Only WorkspaceRuntime's startup identity is allowed before the manifest.
      const startup = await options.storage.scanDocuments(
        { scope: { kind: "session" }, at: "current" },
        2,
        undefined,
        context,
      );
      if (
        startup.next ||
        startup.items.some(
          (doc) =>
            doc.kind !== PigWorkspaceMeta.definition.kind ||
            doc.key !== undefined,
        )
      )
        throw new Error(reason("refusing to stamp preexisting documents"));
      await h.snapshot(PigWorkspaceMeta, context);
      await h.commit(async (tx) => {
        if (
          (await tx.scanConversations({}, 1)).items.length ||
          (await tx.scanTasks({}, 1)).items.length
        )
          throw new Error(reason("work admitted during initialization"));
        const manifest = await tx.doc(BuiltinRuntimeManifest);
        if (Object.keys(manifest).length)
          throw new Error(reason("manifest changed during initialization"));
        manifest.signature = signature;
        manifest.opaque = opaque;
      }, context);
    },
    async admit(tx) {
      const manifest = await tx.doc(BuiltinRuntimeManifest);
      if (!manifest.signature)
        throw new Error(
          reason("missing manifest; initialize before admission"),
        );
      if (opaque) {
        manifest.opaque = true;
        return;
      }
      const rejected = manifestReason(manifest);
      if (rejected) throw new Error(rejected);
    },
    validateResume: (workspace, inspection) =>
      guarded(() => inspect(workspace, inspection, false)),
    checkCompatibility: (input, next) =>
      guarded(async () => {
        const candidate = policies.get(next);
        if (!candidate || candidate.opaque || opaque)
          return reason("opaque current/candidate runtime");
        if (
          !sameExtensions(input.current.extensions, extensions) ||
          !sameExtensions(input.next.extensions, candidate.extensions)
        )
          return reason("unattested current/candidate extensions");
        if (next.signature !== signature)
          return reason("changed builtin definition metadata");
        return inspect(input.workspace, input.inspection, false);
      }),
    pendingDependencies: (workspace) =>
      guarded(async () =>
        inspect(workspace, await workspace.harness.inspect(context), true),
      ),
  };
  policies.set(policy, { extensions, opaque });
  return Object.freeze(policy);
}
