import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import {
  type Api,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";
import type { Conversation, UserInput } from "@earendil-works/pi-durable";
import type {
  CommandContext,
  HostCommand,
  PigConfig,
  RuntimeConfig,
  SessionActionRequest,
} from "../../../../packages/config/src";
import { displayedEffort, effortOptions } from "../shared/effort";
import type {
  ExtensionStatus,
  ExtensionUIEvent,
  UIReply,
} from "../shared/extension-ui";
import { isModelEnabled } from "../shared/models";
import type {
  Effort,
  ModelInfo,
  ModelSelection,
  SessionInfo,
  Snapshot,
  WireEvent,
} from "../shared/rpc-schema";
import type {
  DraftSyncParams,
  OpenSessionParams,
  OpenState,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  RuntimeEvent,
  RuntimeViewState,
  SendKey,
  SessionAddress,
  SessionPhase,
} from "../shared/runtime-contract";
import { AdapterRuntime } from "./adapter-runtime";
import {
  type CommandDescriptor,
  CommandRegistry,
  type CommandRequest,
} from "./command-registry";
import { ComposerBridge } from "./composer-bridge";
import {
  type ConfigApplyDecision,
  type ConfigCandidate,
  ConfigLoader,
} from "./config-loader";
import { validateConfig } from "./config-validation";
import { DurableAdapterSource } from "./durable-adapter-source";
import {
  bindCommandConversation,
  commandAdapterConfig,
} from "./durable-command-bridge";
import {
  DurableProjector,
  type DurableProjectorOptions,
} from "./durable-projector";
import { DurableSendReceipts } from "./durable-send-receipts";
import {
  conversationAppId,
  type PigConversationMetadata,
  parseConversationAppId,
  type WorkspaceIdentity,
  workspaceIdentity,
} from "./native-conversation-meta";
import { UIConnectionLease } from "./ui-connection-lease";
import {
  sameSession,
  UIRequestBroker,
  validateSession,
} from "./ui-request-broker";
import {
  type PreparedRuntime,
  type RuntimeApplyResult,
  WorkspaceRuntime,
  type WorkspaceRuntimeOptions,
} from "./workspace-runtime";

/** Native dialog/display lifetime only. Durable permission decisions belong to persistent task/docs, NOT this port. */
export interface NativeUIAttachment {
  status?(): ExtensionStatus;
  disconnect?(): void;
  reconnect?(): void | Promise<void>;
  dispose(): void | Promise<void>;
}
export interface DurableHostOptions
  extends Omit<WorkspaceRuntimeOptions, "cwd" | "runtime" | "onFailure"> {
  config?: PigConfig;
  /** Explicit only: no real user config is read by default. */
  configFile?: string;
  configLoader?: ConfigLoader;
  /** Required for config providers: return fresh, workspace-owned Provider instances. */
  createRuntimeConfig?(
    identity: WorkspaceIdentity,
    runtime: RuntimeConfig | undefined,
  ): RuntimeConfig | Promise<RuntimeConfig>;
  emit(event: RuntimeEvent): void;
  emitUI(event: ExtensionUIEvent): void;
  emitSession?(id: string, event: WireEvent): void;
  modelInfo?(model: Model<Api>): ModelInfo;
  defaultEffort?(model: Model<Api>): Effort | undefined;
  disabled?(): readonly string[];
  prepareInput?(
    params: PromptParams,
    model: Model<Api>,
    context: Context,
  ): Promise<UserInput>;
  projectorImagePolicy?: DurableProjectorOptions["imagePolicy"];
  attachUI?(input: {
    address: SessionAddress;
    signal: AbortSignal;
    broker: UIRequestBroker;
    drafts: ComposerBridge;
  }): NativeUIAttachment;
  /** Additional persistent approval/domain gate before runtime replacement. A reason means pending. */
  pendingDependencies?(
    workspace: WorkspaceRuntime,
  ): Promise<string | undefined>;
  connectionNow?: () => number;
  onFailure?(error: unknown, workspace: WorkspaceRuntime): void;
}

type Attachment = {
  address: SessionAddress;
  /** Transport/display project context; NEVER used as native membership proof. */
  cwd: string;
  workspace: WorkspaceRuntime;
  conversation: Conversation;
  phase: SessionPhase;
  openId: string;
  seq: number;
  controller: AbortController;
  projector: DurableProjector;
  source: DurableAdapterSource;
  adapters?: AdapterRuntime;
  ui?: NativeUIAttachment;
  metadata: PigConversationMetadata;
  selection: ModelSelection;
  operation: Promise<unknown>;
  pending: number;
  stopRevision: number;
  stopping?: Promise<void>;
  admission?: AbortController;
  closing?: Promise<void>;
  failure?: string;
  stopFailureWatch: () => void;
};
type Opening = {
  input: OpenSessionParams;
  state: OpenState;
  controller: AbortController;
  promise: Promise<Snapshot>;
  attachment?: Attachment;
};
type PromptInput = PromptParams & {
  whenBusy?: "followUp" | "steer" | "reject";
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const emptyStatus = (): ExtensionStatus => ({ statuses: [], widgets: [] });

/** App operation boundary only. A closed tab never closes its workspace Harness or stops native tasks. */
export class DurableHost {
  readonly hostId = randomUUID();
  readonly broker: UIRequestBroker;
  readonly drafts: ComposerBridge;
  private readonly workspaces = new Map<string, Promise<WorkspaceRuntime>>();
  private readonly workspaceByKey = new Map<string, WorkspaceRuntime>();
  private readonly receipts = new WeakMap<
    WorkspaceRuntime,
    DurableSendReceipts
  >();
  private readonly providerOwners = new WeakMap<object, string>();
  private readonly sessions = new Map<string, Attachment>();
  private readonly parkedDrafts = new Map<string, SessionAddress>();
  private readonly opens = new Map<string, Opening>();
  private readonly cancelled = new Set<string>();
  private readonly lease: UIConnectionLease;
  private readonly loader?: ConfigLoader;
  private config: PigConfig;
  private epoch = 0;
  private attaching: Promise<unknown> = Promise.resolve();
  private shuttingDown = false;
  private disposal?: Promise<void>;
  private reloading = false;
  private configOperation?: Promise<RuntimeApplyResult>;
  private configError?: string;
  private commands: CommandRegistry;
  private readonly commandBindings = new WeakMap<AbortSignal, Attachment>();
  private mutationLeases = 0;
  private packageMutation?: symbol;
  private reloadRequested = false;
  private reloadScheduled = false;
  private commandReloadState?: RuntimeApplyResult;

  constructor(private readonly options: DurableHostOptions) {
    this.config = validateConfig(options.config ?? { apiVersion: 2 });
    this.loader =
      options.configLoader ??
      (options.configFile ? new ConfigLoader(options.configFile) : undefined);
    this.broker = new UIRequestBroker(options.emitUI);
    this.drafts = new ComposerBridge(options.emitUI);
    this.commands = this.createCommandRegistry(this.config);
    commandAdapterConfig(this.config, this.commands, (request) =>
      this.invokeCommand(request),
    );
    this.lease = new UIConnectionLease(
      () => {
        // Disable durable approval projections synchronously BEFORE broker-wide cancellation.
        for (const m of this.sessions.values()) {
          try {
            m.ui?.disconnect?.();
          } catch (error) {
            this.recordFailure(m, error);
          }
        }
        try {
          this.broker.setAvailable(false);
        } catch (error) {
          for (const m of this.sessions.values()) this.recordFailure(m, error);
        }
        // Loss of UI never grants permissions, aborts a run, or closes a Harness.
      },
      undefined,
      options.connectionNow,
    );
  }

  private assertRunning(): void {
    if (this.shuttingDown) throw new Error("DURABLE_HOST_CLOSED");
  }

  private assertAvailable(): void {
    this.assertRunning();
    if (this.packageMutation) throw new Error("PACKAGE_MUTATION_LEASE_ACTIVE");
    if (this.reloading) throw new Error("CONFIG_TRANSITION_BUSY");
  }

  private controlBusy(): boolean {
    return (
      this.mutationLeases > 0 ||
      this.commands.busy ||
      [...this.opens.values()].some(
        (open) =>
          open.state.state === "unknown" || open.state.state === "opening",
      ) ||
      [...this.sessions.values()].some(
        (m) =>
          m.pending > 0 ||
          m.stopping ||
          m.adapters?.busy ||
          m.phase !== "ready",
      ) ||
      this.workspaces.size !== this.workspaceByKey.size
    );
  }

  private beginMutation(): () => void {
    this.assertAvailable();
    this.mutationLeases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mutationLeases--;
      this.scheduleCommandReload();
    };
  }

  /** App admission exclusion, not a lock on arbitrary trusted JS. Never pauses/aborts native work. */
  async acquirePackageMutationLease(): Promise<() => void> {
    this.assertAvailable();
    const token = Symbol("package mutation");
    this.packageMutation = token; // Seal synchronously, before the first inspect/approval await.
    const release = () => {
      if (this.packageMutation !== token) return;
      this.packageMutation = undefined;
      this.scheduleCommandReload();
    };
    try {
      if (this.controlBusy())
        throw new Error(
          "PACKAGE_MUTATION_BUSY: app operation/command/workspace initialization",
        );
      for (const workspace of this.workspaceByKey.values()) {
        workspace.assertHealthy();
        const inspection = await workspace.harness.inspect(BACKGROUND_CONTEXT);
        workspace.assertHealthy();
        if (inspection.tasks.length || inspection.submissions.length)
          throw new Error(
            "PACKAGE_MUTATION_BUSY: live tasks or unsettled submissions",
          );
        const reason = await this.options.pendingDependencies?.(workspace);
        if (reason !== undefined)
          throw new Error(`PACKAGE_MUTATION_DEPENDENCY: ${String(reason)}`);
        workspace.assertHealthy();
      }
      this.assertRunning();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  async reconnectUI(): Promise<void> {
    const release = this.beginMutation();
    const errors: unknown[] = [];
    try {
      for (const m of this.sessions.values()) {
        if (m.phase !== "ready") continue;
        try {
          this.current(m.address);
          await awaitWithContext(
            Promise.resolve().then(() => m.ui?.reconnect?.()),
            this.context(m),
          );
          this.current(m.address);
        } catch (error) {
          this.recordFailure(m, error);
          errors.push(error);
        }
      }
      if (errors.length) {
        try {
          this.broker.setAvailable(false);
        } catch (error) {
          errors.push(error);
        }
        throw new AggregateError(errors, "NATIVE_UI_RECONNECT_FAILED");
      }
    } finally {
      release();
    }
  }

  private createCommandRegistry(config: PigConfig): CommandRegistry {
    let registry: CommandRegistry;
    const wrap = (command: HostCommand): HostCommand => ({
      ...command,
      run: async (context, input) => {
        const m = this.commandBindings.get(context.scope.signal);
        const signal = m
          ? AbortSignal.any([context.scope.signal, m.controller.signal])
          : context.scope.signal;
        signal.throwIfAborted();
        if (m) this.current(m.address);
        await awaitWithContext(
          Promise.resolve().then(() =>
            command.run({ ...context, scope: { signal } }, input),
          ),
          withAbortSignal(signal, BACKGROUND_CONTEXT),
        );
        signal.throwIfAborted();
        if (m) this.current(m.address);
      },
    });
    registry = new CommandRegistry(
      (config.commands ?? []).map(wrap),
      {
        assertCurrent: () => {
          this.assertRunning();
          if (registry !== this.commands) throw new Error("STALE_GENERATION");
        },
        conversation: async (id, signal) => {
          parseConversationAppId(id);
          const m = this.sessions.get(id);
          if (!m) return undefined;
          this.current(m.address);
          const combined = AbortSignal.any([signal, m.controller.signal]);
          await m.workspace.metadata(
            m.conversation,
            withAbortSignal(combined, BACKGROUND_CONTEXT),
          );
          this.current(m.address);
          this.commandBindings.set(signal, m);
          return bindCommandConversation(
            m.source,
            combined,
            () => {
              this.current(m.address);
            },
            (error) => this.recordFailure(m, error),
          );
        },
        isStreaming: (id) => {
          const m = this.sessions.get(id);
          if (!m) throw new Error("CONVERSATION_UNAVAILABLE");
          this.current(m.address);
          return m.source.isStreaming();
        },
        confirm: (text, context) => this.confirmCommand(text, context),
        released: () => this.scheduleCommandReload(),
      },
      [
        wrap({
          id: "config.reload",
          title: "Reload configuration",
          scope: "global",
          allowWhileStreaming: true,
          run: () => {
            this.reloadRequested = true;
            this.commandReloadState = undefined;
          },
        }),
      ],
    );
    return registry;
  }

  private async confirmCommand(
    text: string,
    context: CommandContext,
  ): Promise<boolean> {
    const m = this.commandBindings.get(context.scope.signal);
    if (!m || !this.broker.isAvailable(m.address))
      throw new Error("COMMAND_CONFIRMATION_UNAVAILABLE");
    this.current(m.address);
    const signal = AbortSignal.any([context.scope.signal, m.controller.signal]);
    const reply = await this.broker.request(
      {
        ...m.address,
        uiId: randomUUID(),
        kind: "confirm",
        title: "Run command",
        message: text,
      },
      { signal },
    );
    signal.throwIfAborted();
    this.current(m.address);
    return reply.kind === "confirm" && reply.value;
  }

  async describeCommands(
    conversationId?: string,
  ): Promise<{ generation: string; commands: CommandDescriptor[] }> {
    this.assertRunning();
    const registry = this.commands;
    const commands = await registry.describe(conversationId);
    if (registry !== this.commands) throw new Error("STALE_GENERATION");
    return { generation: registry.generation, commands };
  }

  async invokeCommand(request: CommandRequest): Promise<void> {
    request = structuredClone(request);
    const release = this.beginMutation();
    try {
      await this.commands.invoke(request);
    } finally {
      release();
    }
  }

  /** Observable even when config.reload was invoked with no attached conversation. */
  get commandReloadResult(): RuntimeApplyResult | undefined {
    return this.commandReloadState && { ...this.commandReloadState };
  }

  private scheduleCommandReload(): void {
    if (!this.reloadRequested || this.reloadScheduled || this.shuttingDown)
      return;
    this.reloadScheduled = true;
    queueMicrotask(() => {
      this.reloadScheduled = false;
      if (
        !this.reloadRequested ||
        this.packageMutation ||
        this.reloading ||
        this.controlBusy() ||
        this.shuttingDown
      )
        return;
      this.reloadRequested = false;
      void this.reload().then(
        (result) => {
          this.commandReloadState = result;
        },
        (error) => {
          this.configError = message(error);
          this.commandReloadState = {
            state: "failed",
            reason: this.configError,
          };
        },
      );
    });
  }

  connect({ clientId }: { clientId: string }): void {
    this.assertAvailable();
    this.lease.connect(clientId);
    this.broker.setAvailable(true);
  }
  heartbeat({ clientId }: { clientId: string }): { connected: boolean } {
    return { connected: !this.shuttingDown && this.lease.heartbeat(clientId) };
  }
  disconnect({ clientId }: { clientId: string }): void {
    this.lease.disconnect(clientId);
  }
  disconnectAll(): void {
    this.lease.clear();
  }

  private async runtimeConfig(
    identity: WorkspaceIdentity,
    config: PigConfig,
  ): Promise<RuntimeConfig> {
    if (config.runtime?.providers?.length && !this.options.createRuntimeConfig)
      throw new Error("WORKSPACE_PROVIDER_FACTORY_REQUIRED");
    const runtime = this.options.createRuntimeConfig
      ? await this.options.createRuntimeConfig(identity, config.runtime)
      : (config.runtime ?? {});
    for (const provider of runtime.providers ?? []) {
      const owner = this.providerOwners.get(provider);
      if (owner && owner !== identity.key)
        throw new Error("PROVIDER_INSTANCE_SHARED_ACROSS_WORKSPACES");
      this.providerOwners.set(provider, identity.key);
    }
    return runtime;
  }

  /** Trusted host integration port; never returned over RPC. Only explicit NEW agent-v2 workspace paths. */
  async workspace(cwd: string): Promise<WorkspaceRuntime> {
    this.assertRunning();
    const identity = await workspaceIdentity(cwd);
    this.assertRunning();
    let promise = this.workspaces.get(identity.key);
    if (!promise) {
      this.assertAvailable(); // Existing native tasks may resolve their workspace while admission is sealed.
      promise = this.runtimeConfig(identity, this.config).then((runtime) =>
        WorkspaceRuntime.open({
          ...this.options,
          cwd: identity.cwd,
          runtime,
          onFailure: undefined,
        }),
      );
      this.workspaces.set(identity.key, promise);
      void promise.then(
        (workspace) => {
          this.workspaceByKey.set(identity.key, workspace);
          this.receipts.set(
            workspace,
            new DurableSendReceipts(workspace.harness),
          );
          workspace.onFailure((error) => {
            this.options.onFailure?.(error, workspace);
          });
        },
        () => {
          if (this.workspaces.get(identity.key) === promise)
            this.workspaces.delete(identity.key);
        },
      );
    }
    const workspace = await promise;
    workspace.assertHealthy();
    if (this.shuttingDown) throw new Error("DURABLE_HOST_CLOSED");
    return workspace;
  }

  private current(
    address: SessionAddress,
    ready = true,
    healthy = true,
  ): Attachment {
    validateSession(address);
    const m = this.sessions.get(address.sessionId);
    if (
      !m ||
      !sameSession(m.address, address) ||
      m.phase === "closing" ||
      (ready && m.phase !== "ready")
    )
      throw new Error("STALE_SESSION_ADDRESS");
    if (healthy) {
      if (this.shuttingDown) throw new Error("DURABLE_HOST_CLOSED");
      m.workspace.assertHealthy();
      if (m.failure) throw new Error(m.failure);
    }
    return m;
  }

  private context(m: Attachment): Context {
    return withAbortSignal(m.controller.signal, BACKGROUND_CONTEXT);
  }

  private serialize<T>(m: Attachment, action: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    this.current(m.address, false);
    m.pending++;
    const task = m.operation.then(() =>
      m.workspace.run(async () => {
        this.assertAvailable();
        this.current(m.address, false);
        await m.workspace.metadata(m.conversation, this.context(m));
        return action();
      }),
    );
    m.operation = task.catch(() => {});
    return task.finally(() => {
      m.pending--;
      this.scheduleCommandReload();
    });
  }

  getOpenState({ openId }: { openId: string }): OpenState {
    const open = this.opens.get(openId);
    if (!open)
      return this.cancelled.has(openId)
        ? { state: "cancelled", message: "Opening cancelled" }
        : { state: "unknown" };
    if (open.state.state === "ready") {
      const m = this.sessions.get(open.state.snapshot.address.sessionId);
      if (!m || !sameSession(m.address, open.state.snapshot.address))
        return { state: "failed", message: "STALE_SESSION_ADDRESS" };
      return { state: "ready", snapshot: this.snapshot(m) };
    }
    return structuredClone(open.state);
  }

  cancelOpen({ openId }: { openId: string }): void {
    this.cancelled.add(openId);
    const open = this.opens.get(openId);
    if (!open || open.state.state === "ready") return;
    open.state = { state: "cancelled", message: "Opening cancelled" };
    open.controller.abort(new Error("Opening cancelled"));
    if (open.attachment)
      void this.close(open.attachment.address).catch((error) =>
        this.recordFailure(open.attachment as Attachment, error),
      );
  }

  open(input: OpenSessionParams): Promise<Snapshot> {
    input = structuredClone(input);
    try {
      this.assertAvailable();
      if (
        !input ||
        typeof input.openId !== "string" ||
        !input.openId ||
        input.openId.length > 256 ||
        !input.cwd
      )
        throw new Error("Invalid open request");
      if (input.id !== undefined) parseConversationAppId(input.id);
      const prior = this.opens.get(input.openId);
      if (prior) {
        if (prior.input.cwd !== input.cwd || prior.input.id !== input.id)
          throw new Error("OPEN_ID_CONFLICT");
        if (prior.state.state === "ready") {
          const current = this.current(prior.state.snapshot.address);
          return Promise.resolve(this.snapshot(current));
        }
        return prior.promise;
      }
      if (this.cancelled.has(input.openId))
        throw new Error("Opening cancelled");
      const deferred = Promise.withResolvers<Snapshot>();
      const open: Opening = {
        input: { ...input },
        state: { state: "unknown" },
        controller: new AbortController(),
        promise: deferred.promise,
      };
      this.opens.set(input.openId, open);
      const task = this.attaching.then(async () => {
        const workspace = await this.workspace(input.cwd);
        this.assertAvailable();
        open.controller.signal.throwIfAborted();
        if (input.id) {
          const existing = this.sessions.get(input.id);
          if (existing) {
            if (existing.workspace !== workspace)
              throw new Error("CONVERSATION_WORKSPACE_MISMATCH");
            await workspace.conversation(input.id);
            const snapshot = await this.getSnapshot(existing.address);
            open.state = { state: "ready", snapshot };
            return snapshot;
          }
        }
        const conversation = await workspace.run(() =>
          input.id ? workspace.conversation(input.id) : workspace.create(),
        );
        open.controller.signal.throwIfAborted();
        return this.attach(workspace, conversation, open);
      });
      this.attaching = task.catch(() => {});
      void task.then(
        (snapshot) => {
          deferred.resolve(snapshot);
          this.scheduleCommandReload();
        },
        (error) => {
          open.state = {
            state: open.controller.signal.aborted ? "cancelled" : "failed",
            message: message(error),
          };
          deferred.reject(error);
          this.scheduleCommandReload();
        },
      );
      void deferred.promise.catch(() => {});
      return deferred.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async attach(
    workspace: WorkspaceRuntime,
    conversation: Conversation,
    open?: Opening,
    cwd = open?.input.cwd ?? workspace.identity.cwd,
  ): Promise<Snapshot> {
    this.assertAvailable();
    const id = conversationAppId(workspace.identity.key, conversation.id);
    if (this.sessions.has(id)) throw new Error("CONVERSATION_ALREADY_ATTACHED");
    const address: SessionAddress = {
      hostId: this.hostId,
      sessionId: id,
      epoch: ++this.epoch,
    };
    const controller = new AbortController();
    const ctx = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
    const metadata = await workspace.metadata(conversation, ctx);
    let m: Attachment;
    const source = new DurableAdapterSource({
      harness: workspace.harness,
      conversation,
      context: ctx,
      session: { id, cwd },
      assertCurrent: () => {
        this.current(address, false);
      },
      operate: (action) =>
        this.serialize(m, async () => {
          await workspace.ensureCanProgress(ctx);
          const result = await action();
          await this.updateSelection(m);
          return result;
        }),
      onFailure: (error) => this.recordFailure(m, error),
    });
    const projector = new DurableProjector(conversation, ctx, {
      onChange: () => {
        this.publish(m);
      },
      onFailure: (error) => this.recordFailure(m, error),
      imagePolicy: this.options.projectorImagePolicy,
    });
    m = {
      address,
      cwd,
      workspace,
      conversation,
      phase: "opening",
      openId: open?.input.openId ?? randomUUID(),
      seq: 0,
      controller,
      projector,
      source,
      metadata,
      selection: { effort: "off", effortLevels: [] },
      operation: Promise.resolve(),
      pending: 0,
      stopRevision: 0,
      stopFailureWatch: () => {},
    };
    this.sessions.set(id, m);
    if (open) {
      open.attachment = m;
      open.state = { state: "opening", address: { ...address } };
    }
    m.stopFailureWatch = workspace.onFailure((error) => {
      this.recordFailure(m, error);
    });
    const onCancel = () => controller.abort(open?.controller.signal.reason);
    open?.controller.signal.addEventListener("abort", onCancel, { once: true });
    try {
      this.options.emit({
        type: "opening",
        openId: open?.input.openId,
        address: { ...address },
        cwd,
      });
      open?.controller.signal.throwIfAborted();
      await Promise.all([source.start(), projector.start()]);
      await this.updateSelection(m);
      controller.signal.throwIfAborted();
      this.current(address, false);
      const parked = this.parkedDrafts.get(id);
      if (parked) {
        this.drafts.transfer(parked, address);
        this.parkedDrafts.delete(id);
      }
      m.ui = this.options.attachUI?.({
        address: { ...address },
        signal: controller.signal,
        broker: this.broker,
        drafts: this.drafts,
      });
      m.phase = "ready";
      this.attachAdapters(m, this.config);
      const snapshot = this.snapshot(m);
      if (open) open.state = { state: "ready", snapshot };
      this.options.emit({
        type: "ready",
        openId: open?.input.openId,
        snapshot,
      });
      return snapshot;
    } catch (error) {
      await this.closeAttachment(m, "failed", message(error));
      throw error;
    } finally {
      open?.controller.signal.removeEventListener("abort", onCancel);
    }
  }

  private prepareAdapters(
    m: Attachment,
    config: PigConfig,
    commands: CommandRegistry,
  ): AdapterRuntime {
    return new AdapterRuntime(
      commandAdapterConfig(config, commands, (request) => {
        this.current(m.address);
        return this.invokeCommand(request);
      }),
      m.source,
      () => this.publish(m),
    );
  }

  private attachAdapters(
    m: Attachment,
    config: PigConfig,
    prepared?: AdapterRuntime,
  ): void {
    const adapters = prepared ?? this.prepareAdapters(m, config, this.commands);
    m.adapters?.dispose();
    m.adapters = adapters;
    adapters.start();
  }

  private recordFailure(m: Attachment, error: unknown): void {
    if (!m || m.phase === "closing") return;
    m.failure ??= message(error);
    try {
      this.broker.cancelSession(m.address);
      this.publish(m);
    } catch (callbackError) {
      m.failure += `; failure delivery: ${message(callbackError)}`;
    }
  }

  private snapshot(m: Attachment): Snapshot {
    return {
      address: { ...m.address },
      snapshotSeq: ++m.seq,
      info: { ...m.workspace.info(m.metadata), cwd: m.cwd },
      transcript: m.projector.snapshot(),
      ...structuredClone(m.selection),
      failure: m.workspace.failure ?? m.failure ?? m.projector.failure,
      aborted: m.projector.aborted,
      sessionUI: m.adapters?.snapshot(),
      configError: this.configError ?? this.loader?.error,
    };
  }

  private publish(m: Attachment): void {
    if (
      !m ||
      m.phase !== "ready" ||
      this.sessions.get(m.address.sessionId) !== m
    )
      return;
    const snapshot = this.snapshot(m);
    this.options.emit({ type: "snapshot", snapshot });
    this.options.emitSession?.(m.address.sessionId, {
      type: "snapshot",
      address: snapshot.address,
      snapshotSeq: snapshot.snapshotSeq,
      transcript: snapshot.transcript,
      failure: snapshot.failure,
      aborted: snapshot.aborted,
      sessionUI: snapshot.sessionUI,
      configError: snapshot.configError,
    });
  }

  private async updateSelection(m: Attachment): Promise<void> {
    const agent = await m.conversation.agent(this.context(m));
    const model =
      agent.model &&
      m.workspace.models.getModel(agent.model.provider, agent.model.modelId);
    const info =
      model &&
      (this.options.modelInfo?.(model) ?? {
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        vision: model.input.includes("image"),
        effortLevels: effortOptions(
          getSupportedThinkingLevels(model),
          model.thinkingLevelMap,
        ),
      });
    const levels = info?.effortLevels ?? [];
    m.selection = {
      model: info,
      effort: displayedEffort(
        agent.thinkingLevel,
        levels,
        model?.thinkingLevelMap,
      ),
      effortLevels: levels,
      contextUsage: await m.projector.contextUsage(model?.contextWindow),
    };
  }

  async getSnapshot(address: SessionAddress): Promise<Snapshot> {
    address = structuredClone(address);
    const m = this.current(address, false, false);
    if (!m.workspace.failure && !m.failure) {
      await m.projector.refresh();
      m.metadata = await m.workspace.metadata(m.conversation, this.context(m));
      await this.updateSelection(m);
    }
    this.current(address, false, false);
    return this.snapshot(m);
  }

  async list(cwd: string): Promise<SessionInfo[]> {
    return (await (await this.workspace(cwd)).list()).map((info) => ({
      ...info,
      cwd,
    }));
  }

  async rename(
    info: Pick<SessionInfo, "cwd" | "id">,
    title: string,
  ): Promise<SessionInfo> {
    info = structuredClone(info);
    const release = this.beginMutation();
    try {
      const workspace = await this.workspace(info.cwd);
      return await workspace.run(async () => {
        const result = await workspace.rename(info.id, title);
        const m = this.sessions.get(info.id);
        if (m) {
          m.metadata = await workspace.metadata(m.conversation);
          this.publish(m);
        }
        return { ...result, cwd: info.cwd };
      });
    } finally {
      release();
    }
  }

  private ledger(workspace: WorkspaceRuntime): DurableSendReceipts {
    const ledger = this.receipts.get(workspace);
    if (!ledger) throw new Error("WORKSPACE_RECEIPTS_NOT_READY");
    return ledger;
  }

  /** Receipt lookup intentionally accepts previous host/epoch, but always proves immutable workspace membership. */
  async getReceipt(key: SendKey & { cwd?: string }): Promise<PromptReceipt> {
    key = structuredClone(key);
    validateSession(key);
    const parsed = parseConversationAppId(key.sessionId);
    const workspace = key.cwd
      ? await this.workspace(key.cwd)
      : this.workspaceByKey.get(parsed.workspaceKey);
    if (!workspace || workspace.identity.key !== parsed.workspaceKey)
      throw new Error("RECEIPT_WORKSPACE_CONTEXT_REQUIRED");
    const conversation = await workspace.conversation(key.sessionId);
    return this.ledger(workspace).lookup(conversation, key, BACKGROUND_CONTEXT);
  }

  prompt(input: PromptInput): Promise<PromptAccepted> {
    const params = structuredClone(input);
    const m = this.current(params);
    const stopRevision = m.stopRevision;
    if (m.stopping) return Promise.reject(new Error("SESSION_STOPPING"));
    return this.serialize(m, async () => {
      if (stopRevision !== m.stopRevision || m.stopping)
        throw new Error("PROMPT_STOPPED");
      const admission = new AbortController();
      m.admission = admission;
      const ctx = withAbortSignal(admission.signal, this.context(m));
      try {
        await m.workspace.ensureCanProgress(ctx);
        const ledger = this.ledger(m.workspace);
        const previous = await ledger.lookup(m.conversation, params, ctx);
        if (previous.state === "accepted")
          return ledger.send(m.conversation, params, ctx);
        if (this.drafts.read(params).revision !== params.draftRevision)
          throw new Error("DRAFT_REVISION_CONFLICT");
        const agent = await m.conversation.agent(ctx);
        const model =
          agent.model &&
          (
            await awaitWithContext(
              m.workspace.models.getAvailable(undefined, {
                signal: ctx.abortSignal,
              }),
              ctx,
            )
          ).find(
            (item) =>
              item.provider === agent.model?.provider &&
              item.id === agent.model.modelId &&
              isModelEnabled(item, this.options.disabled?.() ?? []),
          );
        if (!model) throw new Error("Choose an available model first");
        if (params.images?.length && !this.options.prepareInput)
          throw new Error("NATIVE_IMAGE_POLICY_REQUIRED");
        const content = this.options.prepareInput
          ? await awaitWithContext(
              this.options.prepareInput(params, model, ctx),
              ctx,
            )
          : params.text;
        this.current(params);
        ctx.abortSignal?.throwIfAborted();
        const accepted = await ledger.send(
          m.conversation,
          params,
          ctx,
          content,
        );
        // A receipt is already persisted. Neither CAS/emit nor metadata failure may reject this accepted send.
        try {
          if (
            this.sessions.get(m.address.sessionId) === m &&
            m.phase === "ready"
          )
            this.drafts.sync({
              ...params,
              expectedRevision: params.draftRevision,
              content: { text: "", pastes: [], images: [] },
            });
          m.metadata = await m.workspace.touch(
            m.conversation,
            params.text,
            BACKGROUND_CONTEXT,
          );
          await m.projector.refresh();
          this.publish(m);
        } catch (error) {
          this.recordFailure(m, error);
        }
        return accepted;
      } finally {
        if (m.admission === admission) m.admission = undefined;
      }
    });
  }

  draft(params: DraftSyncParams) {
    this.current(params, false);
    this.assertAvailable();
    return this.drafts.sync(params);
  }
  resolveUI(reply: UIReply): void {
    this.current(reply, false);
    this.assertAvailable();
    this.broker.resolve(reply);
  }

  async setModel(
    params: SessionAddress & { provider: string; id: string },
  ): Promise<ModelSelection> {
    params = structuredClone(params);
    const m = this.current(params);
    return this.serialize(m, async () => {
      const ctx = this.context(m);
      const model = (
        await awaitWithContext(
          m.workspace.models.getAvailable(undefined, {
            signal: ctx.abortSignal,
          }),
          ctx,
        )
      ).find(
        (item) =>
          item.provider === params.provider &&
          item.id === params.id &&
          isModelEnabled(item, this.options.disabled?.() ?? []),
      );
      if (!model) throw new Error("Model unavailable or hidden");
      this.current(params);
      await m.conversation.configure(
        {
          model: { provider: model.provider, modelId: model.id },
          thinkingLevel: this.options.defaultEffort?.(model) ?? "medium",
        },
        this.context(m),
      );
      await this.updateSelection(m);
      this.publish(m);
      return structuredClone(m.selection);
    });
  }

  async setEffort(
    params: SessionAddress & { effort: Effort },
  ): Promise<ModelSelection> {
    params = structuredClone(params);
    const m = this.current(params);
    return this.serialize(m, async () => {
      await this.updateSelection(m);
      if (!m.selection.effortLevels.includes(params.effort))
        throw new Error("Unsupported reasoning effort");
      await m.conversation.configure(
        { thinkingLevel: params.effort },
        this.context(m),
      );
      await this.updateSelection(m);
      this.publish(m);
      return structuredClone(m.selection);
    });
  }

  abort(address: SessionAddress): Promise<void> {
    address = structuredClone(address);
    this.assertAvailable();
    const m = this.current(address);
    if (m.stopping) return m.stopping;
    m.stopRevision++;
    m.admission?.abort(new Error("PROMPT_STOPPED"));
    // Stop must not wait behind image/auth preparation. Native owns abort's mutation line and child scope.
    const stopping = Promise.resolve().then(async () => {
      await m.workspace.metadata(m.conversation);
      await m.workspace.ensureCanProgress();
      await m.conversation.abort(BACKGROUND_CONTEXT);
      if (this.sessions.get(m.address.sessionId) === m && m.phase === "ready") {
        await m.projector.refresh();
        this.publish(m);
      }
    });
    m.stopping = stopping;
    void stopping.then(
      () => {
        m.stopping = undefined;
      },
      () => {
        m.stopping = undefined;
      },
    );
    return stopping;
  }

  close(address: SessionAddress): Promise<void> {
    validateSession(address);
    const m = this.sessions.get(address.sessionId);
    if (!m || !sameSession(m.address, address))
      return Promise.reject(new Error("STALE_SESSION_ADDRESS"));
    return this.closeAttachment(m, "close");
  }

  private closeAttachment(
    m: Attachment,
    reason: "close" | "failed" | "cancelled",
    failure?: string,
  ): Promise<void> {
    if (m.closing) return m.closing;
    const closing = Promise.withResolvers<void>();
    m.closing = closing.promise;
    void closing.promise.catch(() => {});
    m.phase = "closing";
    const errors: unknown[] = [];
    for (const cleanup of [
      () => m.controller.abort(new Error("UI_ATTACHMENT_CLOSED")),
      () => m.adapters?.dispose(),
      () => this.broker.cancelSession(m.address),
      m.stopFailureWatch,
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    this.parkedDrafts.set(m.address.sessionId, { ...m.address });
    void Promise.resolve()
      .then(async () => {
        const outcomes = await Promise.allSettled([
          Promise.resolve().then(() => m.source.dispose()),
          Promise.resolve().then(() => m.projector.dispose()),
          Promise.resolve().then(() => m.ui?.dispose()),
        ]);
        await m.operation;
        if (this.sessions.get(m.address.sessionId) === m)
          this.sessions.delete(m.address.sessionId);
        try {
          this.options.emit({
            type: "closed",
            address: { ...m.address },
            reason,
            message: failure,
          });
        } catch (error) {
          errors.push(error);
        }
        errors.push(
          ...outcomes.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          ),
        );
        if (errors.length)
          throw new AggregateError(errors, "UI attachment cleanup failed");
      })
      .then(closing.resolve, closing.reject);
    return m.closing;
  }

  async fork(params: SessionAddress & { entryId: string }): Promise<Snapshot> {
    return this.forkAt(params, false);
  }
  async regenerateFrom(
    params: SessionAddress & { entryId: string },
  ): Promise<Snapshot> {
    return this.forkAt(params, true);
  }

  private async forkAt(
    params: SessionAddress & { entryId: string },
    beforeInput: boolean,
  ): Promise<Snapshot> {
    params = structuredClone(params);
    const release = this.beginMutation();
    try {
      const m = this.current(params);
      if (m.pending || m.adapters?.busy)
        throw new Error("SESSION_TRANSITION_BUSY");
      const conversation = await this.serialize(m, async () => {
        const inspection = await m.workspace.harness.inspect(this.context(m));
        if (
          inspection.tasks.some(
            (task) => task.record.conversationId === m.conversation.id,
          ) ||
          inspection.submissions.some(
            (submission) => submission.conversationId === m.conversation.id,
          )
        )
          throw new Error("AGENT_BUSY");
        return m.workspace.fork(
          m.conversation,
          params.entryId,
          beforeInput,
          this.context(m),
        );
      });
      // Original is retained AND stays attached. The caller opens/replaces its tab with this new snapshot explicitly.
      return await this.attach(m.workspace, conversation, undefined, m.cwd);
    } finally {
      release();
    }
  }

  async invokeSessionAction(
    input: SessionAddress & SessionActionRequest,
  ): Promise<void> {
    input = structuredClone(input);
    const release = this.beginMutation();
    try {
      const m = this.current(input);
      if (!m.adapters) throw new Error("ADAPTER_UNAVAILABLE");
      // AdapterRuntime verifies generation/revision/action/fixed input and holds the command lease.
      await m.adapters.invoke(input);
      this.current(input);
    } finally {
      release();
    }
  }

  async delete(info: Pick<SessionInfo, "cwd" | "id">): Promise<never> {
    info = structuredClone(info);
    this.assertAvailable();
    return (await this.workspace(info.cwd)).delete(info.id);
  }

  runtimeState(): RuntimeViewState {
    const sessions = [...this.sessions.values()];
    return {
      hostId: this.hostId,
      sessions: sessions.map((m) => ({
        phase: m.phase,
        address: { ...m.address },
        openId: m.openId,
        snapshot: m.phase === "ready" ? this.snapshot(m) : undefined,
      })),
      pendingUI: this.broker.pending(),
      drafts: sessions.map((m) => ({
        address: { ...m.address },
        draft: this.drafts.read(m.address),
      })),
      statuses: sessions.map((m) => ({
        address: { ...m.address },
        status: m.ui?.status?.() ?? emptyStatus(),
      })),
    };
  }

  private async stageConfig(
    candidate: ConfigCandidate,
  ): Promise<ConfigApplyDecision> {
    if (this.controlBusy())
      return {
        status: "pending",
        reason: "UI operation/attachment lease is active",
      };
    const runtimeChanged = candidate.config.runtime !== this.config.runtime;
    const staged: PreparedRuntime[] = [];
    const commands = this.createCommandRegistry(candidate.config);
    try {
      commandAdapterConfig(candidate.config, commands, (request) =>
        this.invokeCommand(request),
      );
      const ready = await Promise.all(this.workspaces.values());
      if (runtimeChanged) {
        const configs = await Promise.all(
          ready.map((workspace) =>
            this.runtimeConfig(workspace.identity, candidate.config),
          ),
        );
        for (const [index, workspace] of ready.entries()) {
          const pending = await this.options.pendingDependencies?.(workspace);
          if (pending !== undefined) {
            commands.dispose();
            return { status: "pending", reason: pending };
          }
          const gate = await workspace.reloadGate(configs[index]);
          if (gate.state !== "applied") {
            commands.dispose();
            return {
              status: gate.state === "pending" ? "pending" : "rejected",
              reason: gate.reason ?? "Runtime config unsafe",
            };
          }
        }
        for (const [index, workspace] of ready.entries())
          staged.push(await workspace.prepareRuntime(configs[index]));
      }
      const adapters = new Map(
        [...this.sessions.values()].map((m) => [
          m,
          this.prepareAdapters(m, candidate.config, commands),
        ]),
      );
      let applied = false;
      return {
        status: "ready",
        apply: () => {
          if (this.shuttingDown) throw new Error("DURABLE_HOST_CLOSED");
          for (const workspace of ready) workspace.assertHealthy();
          for (const item of staged) item.commit();
          const previousCommands = this.commands;
          this.commands = commands;
          previousCommands.dispose();
          this.config = candidate.config;
          this.configError = undefined;
          applied = true;
          for (const m of this.sessions.values())
            this.attachAdapters(m, this.config, adapters.get(m));
        },
        release: () => {
          if (!applied) for (const item of staged) item.discard();
          if (!applied) commands.dispose();
        },
      };
    } catch (error) {
      commands.dispose();
      for (const item of staged) item.discard();
      throw error;
    }
  }

  /** ConfigLoader commits its candidate ONLY after workspace staging and cache cleanup succeed. */
  reload(next?: PigConfig): Promise<RuntimeApplyResult> {
    this.assertAvailable();
    if (this.controlBusy())
      return Promise.resolve({
        state: "pending",
        reason: "App operation/command lease is active",
      });
    const operation = this.applyConfig(next);
    this.configOperation = operation;
    return operation;
  }

  private async applyConfig(next?: PigConfig): Promise<RuntimeApplyResult> {
    this.reloading = true;
    try {
      if (this.loader && next === undefined) {
        const success = await this.loader.reload((candidate) =>
          this.stageConfig(candidate),
        );
        this.configError = this.loader.error;
        return {
          state: success
            ? "applied"
            : this.loader.status === "pending"
              ? "pending"
              : "failed",
          reason: this.loader.error,
        };
      }
      if (next === undefined)
        throw new Error("Explicit config or config loader required");
      const config = validateConfig(next);
      const decision = await this.stageConfig({
        config,
        revision: randomUUID(),
        dependencies: [],
        diagnostics: [],
      });
      if (decision.status !== "ready") {
        this.configError = decision.reason;
        return {
          state: decision.status === "pending" ? "pending" : "failed",
          reason: decision.reason,
        };
      }
      try {
        decision.apply?.();
      } finally {
        decision.release?.();
      }
      return { state: "applied" };
    } catch (error) {
      this.configError = message(error);
      return { state: "failed", reason: this.configError };
    } finally {
      this.reloading = false;
      for (const m of this.sessions.values()) {
        try {
          this.publish(m);
        } catch (error) {
          this.recordFailure(m, error);
        }
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const disposal = Promise.withResolvers<void>();
    this.disposal = disposal.promise;
    void disposal.promise.catch(() => {});
    const errors: unknown[] = [];
    this.shuttingDown = true;
    this.commands.dispose();
    for (const open of this.opens.values())
      if (open.state.state !== "ready") {
        try {
          this.cancelOpen({ openId: open.input.openId });
        } catch (error) {
          errors.push(error);
        }
      }
    try {
      this.disconnectAll();
    } catch (error) {
      errors.push(error);
    }
    void Promise.resolve()
      .then(async () => {
        try {
          await this.configOperation;
          if (this.loader?.candidate) await this.loader.discard();
        } catch (error) {
          errors.push(error);
        }
        await this.attaching;
        const detached = await Promise.allSettled(
          [...this.sessions.values()].map((m) =>
            this.closeAttachment(m, "close"),
          ),
        );
        const opened = await Promise.allSettled([...this.workspaces.values()]);
        const closed = await Promise.allSettled(
          opened.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.dispose()] : [],
          ),
        );
        errors.push(
          ...[...detached, ...closed].flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          ),
        );
        if (errors.length)
          throw new AggregateError(errors, "Durable host shutdown failed");
      })
      .then(disposal.resolve, disposal.reject);
    return this.disposal;
  }
}
