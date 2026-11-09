import { isAbsolute } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CredentialStore, MutableModels } from "@earendil-works/pi-ai";
import {
  type AgentChange,
  AgentDoc,
  type AgentState,
  type Conversation,
  type ConversationId,
  type Cursor,
  configure,
  createRegistry,
  type EntryRecord,
  Harness,
  type HarnessInspection,
  type HarnessOptions,
  type HarnessSettings,
  type Registry,
  type Report,
  type Storage,
  type Tx,
  UserEntry,
} from "@earendil-works/pi-durable";
import type {
  AgentProfile,
  RuntimeConfig,
} from "../../../../packages/config/src";
import type { SessionInfo } from "../shared/rpc-schema";
import { validateConfig } from "./config-validation";
import { openDurableStorage } from "./durable-storage";
import {
  createModelRuntime,
  releaseModelRuntime,
  setRuntimeProviders,
} from "./model-runtime";
import {
  assertConversationMembership,
  conversationAppId,
  PigConversationMeta,
  type PigConversationMetadata,
  PigWorkspaceMeta,
  parseConversationAppId,
  parseNativeEntryId,
  type WorkspaceIdentity,
  workspaceIdentity,
} from "./native-conversation-meta";

export interface RuntimeCompatibilityInput {
  workspace: WorkspaceRuntime;
  current: RuntimeConfig;
  next: RuntimeConfig;
  inspection: HarnessInspection;
}
export interface WorkspaceRuntimeOptions {
  cwd: string;
  dataRoot: string;
  credentials?: CredentialStore;
  /** Explicit: never default to a real user's models/config directory in isolated callers. */
  modelDirectory?: string;
  createModels?(identity: WorkspaceIdentity): Promise<MutableModels>;
  /** Provider instances in this value must belong to THIS workspace only. */
  runtime?: RuntimeConfig;
  env?: HarnessOptions["env"];
  settings?: Omit<HarnessSettings, "extensions">;
  now?: () => number;
  onReport?(report: Report): void;
  onFailure?(error: unknown): void;
  /** Trusted app initialization while Harness scheduling is still paused, before ANY saved work resumes. */
  prepareResume?(
    workspace: WorkspaceRuntime,
    inspection: HarnessInspection,
  ): Promise<void>;
  /** Persisted custom docs/tasks require an explicit schema/definition compatibility policy. */
  validateResume?(
    workspace: WorkspaceRuntime,
    inspection: HarnessInspection,
  ): Promise<string | undefined>;
  checkCompatibility?(
    input: RuntimeCompatibilityInput,
  ): Promise<string | undefined>;
}
export type RuntimeApplyResult = {
  state: "applied" | "pending" | "failed";
  reason?: string;
};
export type PreparedRuntime = {
  commit(): void;
  discard(): void;
};

const emptyProfile: AgentProfile = {
  extensions: [],
  tools: [],
  thinkingLevel: "off",
};
// Factories must never recycle a collection across workspaces or runtime generations.
const seenModels = new WeakSet<MutableModels>();

/** One native writer, registry, model collection and Harness; never owned by a UI tab. */
export class WorkspaceRuntime {
  readonly identity: WorkspaceIdentity;
  readonly harness: Harness;
  /** Read-only public metadata from this Harness's storage; never another writer or SQL. */
  readonly storageMetadata: Pick<Storage, "scanDocuments" | "scanSubmissions">;
  private activeRegistry: Registry;
  private activeModels: MutableModels;
  private runtimeConfig: RuntimeConfig;
  private readonly registryListeners = new Set<() => void>();
  private stopRegistry: () => void;
  private failureClose?: Promise<void>;
  private operation: Promise<unknown> = Promise.resolve();
  private closing = false;
  private disposal?: Promise<void>;
  private resumeChecked = false;
  failure?: string;
  private readonly failureListeners = new Set<(error: unknown) => void>();

  private constructor(
    identity: WorkspaceIdentity,
    models: MutableModels,
    registry: Registry,
    runtime: RuntimeConfig,
    harness: Harness,
    private readonly options: WorkspaceRuntimeOptions,
    registryListeners: Set<() => void>,
    storage: Storage,
  ) {
    this.identity = Object.freeze(identity);
    this.activeModels = models;
    this.activeRegistry = registry;
    this.runtimeConfig = runtime;
    this.harness = harness;
    this.storageMetadata = Object.freeze({
      scanDocuments: storage.scanDocuments.bind(storage),
      scanSubmissions: storage.scanSubmissions.bind(storage),
    });
    this.registryListeners = registryListeners;
    this.stopRegistry = registry.subscribe(() => {
      for (const listener of this.registryListeners) listener();
    });
    void harness.closed.then((end) => {
      if (end.kind === "failed") this.fail(end.error);
      else if (!this.closing) this.fail(new Error("WORKSPACE_HARNESS_CLOSED"));
    });
  }

  static async open(
    options: WorkspaceRuntimeOptions,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<WorkspaceRuntime> {
    if (!isAbsolute(options.dataRoot))
      throw new TypeError("Explicit absolute dataRoot required");
    const identity = await workspaceIdentity(options.cwd);
    const runtime =
      validateConfig({ apiVersion: 2, runtime: options.runtime ?? {} })
        .runtime ?? {};
    const registry = WorkspaceRuntime.registryFor(runtime);
    const models = await WorkspaceRuntime.modelsFor(options, identity, runtime);
    let storage: Awaited<ReturnType<typeof openDurableStorage>> | undefined;
    let harness: Harness | undefined;
    let workspace: WorkspaceRuntime | undefined;
    const reports: Report[] = [];
    const listeners = new Set<() => void>();
    try {
      storage = await openDurableStorage({
        dataRoot: options.dataRoot,
        workspaceId: identity.key,
      });
      harness = await Harness.open(
        storage,
        {
          models: () => workspace?.models ?? models,
          registry: {
            snapshot: () => (workspace?.registry ?? registry).snapshot(),
            subscribe: (listener) => {
              listeners.add(listener);
              return () => {
                listeners.delete(listener);
              };
            },
          },
          // Never select every installed extension implicitly.
          settings: () => ({ ...(options.settings ?? {}), extensions: [] }),
          env: options.env ?? (() => undefined),
          now: options.now,
          conversationCreated: async (tx, record) => {
            const config = workspace?.runtime ?? runtime;
            const profileId = config.defaultProfile ?? "default";
            const profile = config.profiles?.[profileId] ?? emptyProfile;
            if (!record.parent && !record.owner)
              await configure(tx, record.id, {
                ...profile,
                cwd: profile.cwd ?? identity.cwd,
              });
            await config.conversationCreated?.(tx, record);
            const meta = await tx.doc(PigConversationMeta, record.id);
            const now = Math.max(1, (options.now ?? Date.now)());
            Object.assign(meta, {
              workspaceKey: identity.key,
              canonicalCwd: identity.cwd,
              conversationId: record.id,
              profile: profileId,
              title: "New chat",
              titleExplicit: false,
              createdAt: now,
              modifiedAt: now,
            });
          },
          onReport: (report) => {
            if (!workspace) reports.push(report);
            try {
              options.onReport?.(report);
            } catch (callbackError) {
              workspace?.fail(callbackError);
            }
            if (
              report.kind === "storage_failed" ||
              report.kind === "host_error" ||
              report.kind === "task_outdated" ||
              report.kind === "migration_failed"
            )
              workspace?.fail(report.error);
          },
        },
        context,
      );
      workspace = new WorkspaceRuntime(
        identity,
        models,
        registry,
        runtime,
        harness,
        options,
        listeners,
        storage,
      );
      await harness.commit(async (tx) => {
        const doc = await tx.doc(PigWorkspaceMeta);
        if (
          doc.workspaceKey &&
          (doc.workspaceKey !== identity.key ||
            doc.canonicalCwd !== identity.cwd)
        )
          throw new Error("PERSISTED_WORKSPACE_MISMATCH");
        doc.workspaceKey = identity.key;
        doc.canonicalCwd = identity.cwd;
      }, context);
      if (
        reports.some((report) =>
          [
            "storage_failed",
            "host_error",
            "task_outdated",
            "migration_failed",
          ].includes(report.kind),
        )
      )
        throw new Error("WORKSPACE_OPEN_REPORTED_FAILURE");
      await options.prepareResume?.(workspace, await harness.inspect(context));
      await workspace.checkResume(context);
      harness.resume();
      return workspace;
    } catch (error) {
      if (workspace) {
        workspace.closing = true;
        workspace.stopRegistry();
      }
      try {
        if (harness) await harness.close(BACKGROUND_CONTEXT);
        else if (storage) await storage.close(BACKGROUND_CONTEXT);
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Workspace open and cleanup failed",
        );
      } finally {
        releaseModelRuntime(models);
      }
      throw error;
    }
  }

  private static registryFor(runtime: RuntimeConfig): Registry {
    const registry = createRegistry();
    for (const extension of runtime.extensions ?? [])
      registry.install(extension);
    return registry;
  }

  private static async modelsFor(
    options: WorkspaceRuntimeOptions,
    identity: WorkspaceIdentity,
    runtime: RuntimeConfig,
  ): Promise<MutableModels> {
    if (
      !options.createModels &&
      (!options.credentials ||
        !options.modelDirectory ||
        !isAbsolute(options.modelDirectory))
    )
      throw new Error(
        "Explicit app credentials/modelDirectory or createModels factory required",
      );
    const models = options.createModels
      ? await options.createModels(identity)
      : await createModelRuntime(
          options.credentials as CredentialStore,
          options.modelDirectory,
        );
    if (seenModels.has(models))
      throw new Error(
        "MODEL_COLLECTION_REUSED: provide a fresh collection per workspace/generation",
      );
    seenModels.add(models);
    try {
      if (options.createModels)
        for (const provider of runtime.providers ?? [])
          models.setProvider(provider);
      else setRuntimeProviders(models, runtime.providers ?? []);
      return models;
    } catch (error) {
      releaseModelRuntime(models);
      throw error;
    }
  }

  get registry(): Registry {
    return this.activeRegistry;
  }
  get models(): MutableModels {
    return this.activeModels;
  }
  get runtime(): RuntimeConfig {
    return this.runtimeConfig;
  }

  assertHealthy(): void {
    if (this.failure) throw new Error(`WORKSPACE_FAILED: ${this.failure}`);
    if (this.closing) throw new Error("WORKSPACE_CLOSED");
  }

  onFailure(listener: (error: unknown) => void): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  private fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? error.message : String(error);
    this.resumeChecked = false;
    try {
      this.options.onFailure?.(error);
    } catch (callbackError) {
      this.failure += `; onFailure: ${String(callbackError)}`;
    }
    for (const listener of this.failureListeners) {
      try {
        listener(error);
      } catch (callbackError) {
        this.failure += `; failure listener: ${String(callbackError)}`;
      }
    }
    // Reports run off the mutation line. Seal scheduling/admission, not merely the UI, on a fatal host failure.
    if (!this.closing) {
      this.failureClose ??= this.harness.close(BACKGROUND_CONTEXT);
      void this.failureClose.catch((closeError) => {
        this.failure += `; close: ${String(closeError)}`;
      });
    }
  }

  /** One workspace-wide app mutation line, independent of native background scheduling. */
  run<T>(action: () => Promise<T>): Promise<T> {
    const task = this.operation.then(() => {
      this.assertHealthy();
      return action();
    });
    this.operation = task.catch(() => {});
    return task;
  }

  async checkResume(context: Context = BACKGROUND_CONTEXT): Promise<void> {
    this.assertHealthy();
    const inspection = await this.harness.inspect(context);
    for (const task of inspection.tasks) {
      const definition = this.registry
        .snapshot()
        .task(task.record.kind)?.definition;
      if (
        task.state.kind === "blocked" ||
        !definition ||
        definition.version !== task.record.version
      )
        throw new Error(`RESUME_DEFINITION_UNVERIFIED: ${task.record.kind}`);
    }
    const conversations = new Set([
      ...inspection.tasks.map((task) => task.record.conversationId),
      ...inspection.submissions.map((submission) => submission.conversationId),
    ]);
    for (const id of conversations) {
      const c = await this.harness.conversation(id, context);
      if (!c) throw new Error("RESUME_CONVERSATION_MISSING");
      await this.metadata(c, context);
      const state = await this.harness.snapshot(AgentDoc, id, context);
      if (!state) throw new Error("RESUME_AGENT_MISSING");
      this.agentChange(state); // Native resolution silently omits missing names; admission must not.
      if (
        state.model &&
        !this.models.getModel(state.model.provider, state.model.modelId)
      )
        throw new Error("RESUME_MODEL_UNAVAILABLE");
    }
    if (inspection.tasks.length || inspection.submissions.length) {
      if (
        (this.runtime.extensions?.length || this.runtime.conversationCreated) &&
        !this.options.validateResume
      )
        throw new Error("RESUME_SCHEMA_COMPATIBILITY_UNKNOWN");
      const reason = await this.options.validateResume?.(this, inspection);
      if (reason) throw new Error(`RESUME_REJECTED: ${reason}`);
    }
    this.resumeChecked = true;
  }

  async ensureCanProgress(
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<void> {
    this.assertHealthy();
    if (!this.resumeChecked) await this.checkResume(context);
  }

  async metadata(
    conversation: Conversation,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<PigConversationMetadata> {
    this.assertHealthy();
    const meta = await this.harness.snapshot(
      PigConversationMeta,
      conversation.id,
      context,
    );
    assertConversationMembership(meta, this.identity, conversation.id);
    return structuredClone(meta);
  }

  async conversation(
    appId: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<Conversation> {
    this.assertHealthy();
    const parsed = parseConversationAppId(appId);
    if (parsed.workspaceKey !== this.identity.key)
      throw new Error("CONVERSATION_WORKSPACE_MISMATCH");
    const conversation = await this.harness.conversation(parsed.id, context);
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    await this.metadata(conversation, context);
    return conversation;
  }

  async create(
    profileId = this.runtime.defaultProfile ?? "default",
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<Conversation> {
    this.assertHealthy();
    const profile =
      this.runtime.profiles?.[profileId] ??
      (profileId === "default" ? emptyProfile : undefined);
    if (!profile) throw new Error(`UNKNOWN_AGENT_PROFILE: ${profileId}`);
    return this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { ...profile, cwd: profile.cwd ?? this.identity.cwd },
        init: async (tx, id) => {
          (await tx.doc(PigConversationMeta, id)).profile = profileId;
        },
      },
      context,
    );
  }

  info(meta: PigConversationMetadata): SessionInfo {
    assertConversationMembership(
      meta,
      this.identity,
      meta.conversationId as ConversationId,
    );
    return {
      id: conversationAppId(
        this.identity.key,
        meta.conversationId as ConversationId,
      ),
      cwd: this.identity.cwd,
      title: meta.title,
      modified: meta.modifiedAt,
    };
  }

  async list(context: Context = BACKGROUND_CONTEXT): Promise<SessionInfo[]> {
    this.assertHealthy();
    const records = await this.harness.commit(async (tx) => {
      const all = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanConversations({}, 200, cursor);
        all.push(...page.items);
        cursor = page.next;
      } while (cursor);
      return all;
    }, context);
    const result: SessionInfo[] = [];
    for (const record of records) {
      // Only NEW native records in this workspace storage. No old-history scans.
      if (record.owner) continue;
      const c = await this.harness.conversation(record.id, context);
      if (c) result.push(this.info(await this.metadata(c, context)));
    }
    return result.sort(
      (a, b) => b.modified - a.modified || a.id.localeCompare(b.id),
    );
  }

  async rename(
    appId: string,
    title: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<SessionInfo> {
    if (typeof title !== "string" || !title.trim() || title.length > 4096)
      throw new Error("Invalid chat title");
    const c = await this.conversation(appId, context);
    await c.commit(async (tx) => {
      const doc = await tx.doc(PigConversationMeta, c.id);
      assertConversationMembership(doc, this.identity, c.id);
      doc.title = title.trim();
      doc.titleExplicit = true;
      doc.modifiedAt = Math.max(
        doc.modifiedAt,
        (this.options.now ?? Date.now)(),
      );
    }, context);
    return this.info(await this.metadata(c, context));
  }

  /** Called only AFTER durable admission, never used as an acceptance receipt. */
  async touch(
    c: Conversation,
    text: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<PigConversationMetadata> {
    await c.commit(async (tx) => {
      const doc = await tx.doc(PigConversationMeta, c.id);
      assertConversationMembership(doc, this.identity, c.id);
      if (!doc.titleExplicit && doc.title === "New chat" && text.trim())
        doc.title = text.trim().slice(0, 256);
      doc.modifiedAt = Math.max(
        doc.modifiedAt,
        (this.options.now ?? Date.now)(),
      );
    }, context);
    return this.metadata(c, context);
  }

  async entries(
    c: Conversation,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<EntryRecord[]> {
    await this.metadata(c, context);
    const records: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await c.entries(
        { order: "ascending" },
        200,
        cursor,
        context,
      );
      records.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return records;
  }

  private agentChange(state: Readonly<AgentState>): AgentChange {
    const snapshot = this.registry.snapshot();
    // Resolve native patches against our explicit empty Harness selection, never all installed extensions.
    const selection = state.extensions;
    const names = Array.isArray(selection)
      ? selection
      : (selection?.add ?? []).filter(
          (name) => !selection?.remove?.includes(name),
        );
    const extensions = names.map((name) => {
      const extension = snapshot.extension(name);
      if (!extension) throw new Error(`Missing fork extension: ${name}`);
      return extension;
    });
    const available = new Map(
      extensions.flatMap((extension) =>
        (extension.tools ?? []).map((tool) => [tool.name, tool] as const),
      ),
    );
    const resolve = (names: string[]) =>
      names.map((name) => {
        const tool = available.get(name);
        if (!tool) throw new Error(`Missing fork tool: ${name}`);
        return tool;
      });
    const tools = Array.isArray(state.tools)
      ? resolve(state.tools)
      : [...available.values()].filter(
          (tool) =>
            !state.tools ||
            !(state.tools as { remove: string[] }).remove.includes(tool.name),
        );
    const modelTools = Array.isArray(state.modelTools)
      ? resolve(state.modelTools)
      : state.modelTools
        ? {
            add: resolve(state.modelTools.add ?? []),
            remove: resolve(state.modelTools.remove ?? []),
          }
        : null;
    return {
      model: state.model ?? null,
      thinkingLevel: state.thinkingLevel ?? null,
      instructions: state.instructions ?? null,
      cwd: state.cwd ?? null,
      maxTurns: state.maxTurns ?? null,
      extensions,
      tools,
      modelTools,
    };
  }

  /** Native fork is INCLUSIVE. Regenerate/edit omit the selected input via its preceding boundary. */
  async fork(
    c: Conversation,
    entryId: string,
    beforeInput = false,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<Conversation> {
    const meta = await this.metadata(c, context);
    const id = parseNativeEntryId(entryId);
    const entries = await this.entries(c, context);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("ENTRY_NOT_VISIBLE_IN_CONVERSATION");
    if (beforeInput && !UserEntry.is(entries[index]))
      throw new Error("Select a native user input");
    const init = async (tx: Tx, forkId: ConversationId) => {
      const doc = await tx.doc(PigConversationMeta, forkId);
      doc.profile = meta.profile;
      doc.title = `${meta.title} (fork)`;
      doc.titleExplicit = true;
    };
    const fresh =
      beforeInput &&
      !entries.slice(0, index).some((entry) => UserEntry.is(entry));
    if (fresh) {
      const state = await this.harness.snapshotAsOf(
        AgentDoc,
        c.id,
        id,
        context,
      );
      if (!state) throw new Error("FORK_AGENT_STATE_MISSING");
      return this.harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: this.agentChange(state),
          init,
        },
        context,
      );
    }
    const boundary = beforeInput ? entries[index - 1] : entries[index];
    if (!boundary) throw new Error("FORK_BOUNDARY_MISSING");
    return c.fork(
      boundary.id,
      { ownership: { kind: "ownerless" }, init },
      context,
    );
  }

  async reloadGate(
    next: RuntimeConfig,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<RuntimeApplyResult> {
    this.assertHealthy();
    if (next === this.runtimeConfig) return { state: "applied" };
    const inspection = await this.harness.inspect(context);
    if (inspection.tasks.length || inspection.submissions.length)
      return {
        state: "pending",
        reason:
          "Workspace has live/pending/waiting/background/child work or unsettled submissions",
      };
    const persisted = await this.harness.commit(
      (tx) => tx.scanConversations({}, 1),
      context,
    );
    if (persisted.items.length) {
      if (!this.options.checkCompatibility)
        return {
          state: "failed",
          reason:
            "RUNTIME_SCHEMA_COMPATIBILITY_UNKNOWN: opaque document/task dependencies need an explicit proof",
        };
      const reason = await this.options.checkCompatibility({
        workspace: this,
        current: this.runtimeConfig,
        next,
        inspection,
      });
      if (reason) return { state: "failed", reason };
    }
    return { state: "applied" };
  }

  /** Stage first; host holds admission/config leases until every workspace is ready. */
  async prepareRuntime(next: RuntimeConfig): Promise<PreparedRuntime> {
    const runtime =
      validateConfig({ apiVersion: 2, runtime: next }).runtime ?? {};
    const registry = WorkspaceRuntime.registryFor(runtime);
    const models = await WorkspaceRuntime.modelsFor(
      this.options,
      this.identity,
      runtime,
    );
    let settled = false;
    return {
      commit: () => {
        if (settled) throw new Error("RUNTIME_CANDIDATE_ALREADY_SETTLED");
        this.assertHealthy();
        const old = this.activeModels;
        this.stopRegistry();
        this.stopRegistry = registry.subscribe(() => {
          for (const listener of this.registryListeners) listener();
        });
        this.activeModels = models;
        this.activeRegistry = registry;
        this.runtimeConfig = runtime;
        this.resumeChecked = false;
        settled = true;
        releaseModelRuntime(old);
        for (const listener of this.registryListeners) listener();
      },
      discard: () => {
        if (!settled) {
          settled = true;
          releaseModelRuntime(models);
        }
      },
    };
  }

  /** No archive/tombstone masquerading as physical deletion. */
  async delete(appId: string): Promise<never> {
    await this.conversation(appId);
    throw new Error(
      "NATIVE_PHYSICAL_DELETE_UNSUPPORTED: Durable 1.5 has no verified safe public delete API",
    );
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = this.operation.then(async () => {
      try {
        await (this.failureClose ?? this.harness.close(BACKGROUND_CONTEXT));
      } finally {
        this.stopRegistry();
        releaseModelRuntime(this.models);
        this.failureListeners.clear();
      }
      const end = await this.harness.closed;
      if (end.kind === "failed") throw end.error;
    });
    return this.disposal;
  }
}
