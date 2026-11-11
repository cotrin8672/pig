import "./runtime-profile";
import { join } from "node:path";
import type { SessionActionRequest } from "../../../../packages/config/src";
import { AdapterRuntime } from "./adapter-runtime";
import { createAdapterSource } from "./adapter-source";
import { ConfigLoader } from "./config-loader";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Session runtime is not ready");
  return value;
}

import {
  type Api,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionRuntime,
  EventBusController,
  ModelRuntime,
  SessionManager as SDKSessionManager,
} from "@earendil-works/pi-coding-agent";
import { displayedEffort } from "../shared/effort";
import type { ExtensionUIEvent, UIReply } from "../shared/extension-ui";
import { isModelEnabled } from "../shared/models";
import { unfoldPastes } from "../shared/paste";
import type {
  Effort,
  ModelInfo,
  ModelSelection,
  SessionInfo,
  SlashCommand,
  Snapshot,
  WireEvent,
} from "../shared/rpc-schema";
import type {
  DraftSyncParams,
  OpenSessionParams,
  OpenState,
  PromptParams,
  RuntimeEvent,
  RuntimeRecoveryState,
  RuntimeViewState,
  SendKey,
  SessionAddress,
  SessionPhase,
} from "../shared/runtime-contract";
import type { Settings } from "../shared/settings";
import type {
  TerminalClientCommand,
  TerminalHostEvent,
} from "../shared/terminal-ui";
import { storeImage, withAttachmentPaths } from "./attachments";
import { ComposerBridge } from "./composer-bridge";
import { desktopConfigDir } from "./desktop-config";
import { createExtensionUIHost, type ExtensionUIHost } from "./extension-ui";
import { createQueuedImagePolicy, scrubImages } from "./image-policy";
import {
  createModelRuntime,
  releaseModelRuntime,
  resetExtensionProviders,
} from "./model-runtime";
import { defaultEffort } from "./model-settings";
import { resolveProjectTrust } from "./project-trust";
import { desktopResourceOptions } from "./resources";
import { agentDir } from "./runtime-profile";
import { initializeRuntimeTheme } from "./runtime-theme";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEventBus,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
  SettingsManager,
} from "./sdk";
import { SDKProjector } from "./sdk-projector";
import { addressKey, SendReceipts } from "./sdk-send-receipts";
import {
  type SendRecoveryStore,
  sendRecoveryStore,
} from "./send-recovery-store";
import { SessionDiagnosticStore } from "./session-diagnostics";
import {
  listSessionFiles,
  readSessionFile,
  removeSessionFile,
  resolveSessionFile,
  sameSessionPath,
} from "./session-files";
import { currentSettings } from "./settings";
import { desktopShellTool } from "./shell-tools";
import { UIRequestBroker } from "./ui-request-broker";

type Managed = {
  address: SessionAddress;
  cwd: string;
  phase: SessionPhase;
  seq: number;
  openId: string;
  manager: SDKSessionManager;
  controller: AbortController;
  runtime?: AgentSessionRuntime;
  models?: ModelRuntime;
  modelCatalog?: ModelInfo[];
  catalogSource?: readonly Model<Api>[];
  projector?: SDKProjector;
  ui: ExtensionUIHost;
  unsubscribe?: () => void;
  eventBus: EventBusController;
  adapterSource?: ReturnType<typeof createAdapterSource>;
  adapters?: AdapterRuntime;
  adapterSnapshot?: Snapshot["sessionUI"];
  disposing?: Promise<void>;
  closing?: Promise<void>;
  operation: Promise<unknown>;
  reloadPending: boolean;
  stopping: boolean;
  stopPromise?: Promise<void>;
  quarantined?: boolean;
  queued: Map<
    Parameters<AgentSession["agent"]["followUp"]>[0],
    string | undefined
  >;
  admissionRequestId?: string;
  requestIds: WeakMap<object, string>;
  startedSends: SendKey[];
  queuedImages: boolean;
  preparingImages?: boolean;
  images: ReturnType<typeof createQueuedImagePolicy>;
  admissionSignal?: AbortSignal;
  transition?: AbortController;
  publishTimer?: ReturnType<typeof setTimeout>;
  infoCache?: {
    leaf: ReturnType<SDKSessionManager["getLeafEntry"]>;
    count: number;
    value: SessionInfo;
  };
  contextCache?: {
    leaf: ReturnType<SDKSessionManager["getLeafEntry"]>;
    count: number;
    epoch: number;
    model?: Model<Api>;
    contextWindow?: number;
    value: ReturnType<AgentSession["getContextUsage"]>;
  };
};
type Opening = {
  input: OpenSessionParams;
  state: OpenState;
  promise: Promise<Snapshot>;
  controller: AbortController;
  managed?: Managed;
};
type OpenResult = {
  input: OpenSessionParams;
  state:
    | { state: "ready"; address: SessionAddress }
    | Extract<OpenState, { state: "failed" | "cancelled" }>;
};
type Options = {
  modelInfo: (model: Model<Api>) => ModelInfo;
  emit: (event: RuntimeEvent) => void;
  emitUI: (event: ExtensionUIEvent) => void;
  emitTerminal: (event: TerminalHostEvent) => void;
  emitSession?: (id: string, event: WireEvent) => void;
  disabled?: () => readonly string[];
  settings?: () => Settings;
  resourceDir?: string;
  configFile?: string;
  configureModels?: (runtime: ModelRuntime) => void | Promise<void>;
  connectionNow?: () => number;
  recoveryFile?: string;
};
// SDK's low-level API registry is process-global: serialize loader/reload work.
let loaderQueue = Promise.resolve();
const stopWaitMs = 2_000;
async function stopBudget<T>(task: Promise<T>, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Stop unconfirmed: ${phase} did not finish within ${stopWaitMs}ms. This runtime is isolated; external work may still be running.`,
              ),
            ),
          stopWaitMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function loadExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const task = loaderQueue.then(fn);
  loaderQueue = task.then(
    () => {},
    () => {},
  );
  return task;
}

import { UIConnectionLease } from "./ui-connection-lease";

export class SessionHost {
  readonly hostId = crypto.randomUUID();
  readonly receipts: SendReceipts;
  private readonly recovery: SendRecoveryStore;
  private readonly runDiagnostics: SessionDiagnosticStore;
  readonly broker: UIRequestBroker;
  readonly drafts: ComposerBridge;
  private epoch = 0;
  private sessions = new Map<string, Managed>();
  private failedHistory = new Map<
    string,
    {
      address: SessionAddress;
      cwd: string;
      revision: string;
      leaf: string | null;
      snapshot: Snapshot;
    }
  >();
  private opens = new Map<string, Opening>();
  private openResults = new Map<string, OpenResult>();
  private cancelledOpens = new Set<string>();
  private readonly clients: UIConnectionLease;
  private shuttingDown = false;
  private disposal?: Promise<void>;
  private invalidated = new WeakSet<AgentSession>();
  private readonly configLoader: ConfigLoader;
  private readonly configReady: Promise<boolean>;
  private configReloading = false;
  private configReloadPending = false;
  constructor(private readonly options: Options) {
    this.configLoader = new ConfigLoader(
      options.configFile ?? join(desktopConfigDir, "config.ts"),
    );
    this.configReady = this.configLoader.reload();
    initializeRuntimeTheme();
    this.broker = new UIRequestBroker((event) => {
      if (event.type === "request") {
        const m = this.sessions.get(event.request.sessionId);
        if (m?.publishTimer) this.publish(m);
      }
      options.emitUI(event);
    });
    this.recovery = sendRecoveryStore(
      options.recoveryFile ?? join(desktopConfigDir, "send-recovery.sqlite"),
    );
    this.runDiagnostics = new SessionDiagnosticStore(
      options.recoveryFile ?? join(desktopConfigDir, "send-recovery.sqlite"),
    );
    this.receipts = new SendReceipts(this.hostId, this.recovery);
    this.drafts = new ComposerBridge(
      options.emitUI,
      (address, draft, previous, keepImages) =>
        this.recovery.draft(
          address,
          draft,
          this.draftOwner(address),
          previous,
          keepImages,
        ),
    );
    this.clients = new UIConnectionLease(
      () => {
        this.broker.setAvailable(false);
        for (const m of this.sessions.values()) {
          m.transition?.abort(new Error("Root UI connection lost"));
          if (m.phase === "opening")
            m.controller.abort(
              new Error("Root UI connection lost during startup"),
            );
          m.ui.cancelAll("disconnect");
        }
      },
      undefined,
      options.connectionNow,
    );
  }
  private get settings() {
    return (this.options.settings ?? currentSettings)();
  }
  connectUI({ clientId }: { clientId: string }) {
    if (this.shuttingDown) throw new Error("Session host is shutting down");
    this.clients.connect(clientId);
    this.broker.setAvailable(true);
  }
  heartbeatUI({ clientId }: { clientId: string }) {
    return {
      connected: !this.shuttingDown && this.clients.heartbeat(clientId),
    };
  }
  disconnectUI({ clientId }: { clientId: string }) {
    this.clients.disconnect(clientId);
  }
  disconnectAll() {
    this.clients.clear();
  }
  private address(id: string): SessionAddress {
    return { hostId: this.hostId, sessionId: id, epoch: ++this.epoch };
  }
  private current(address: SessionAddress, ready = true) {
    const m = this.sessions.get(address.sessionId);
    if (
      !m ||
      addressKey(m.address) !== addressKey(address) ||
      m.phase === "closing" ||
      (ready && (m.phase !== "ready" || !!m.transition || m.stopping))
    )
      throw new Error("STALE_SESSION_ADDRESS");
    return m;
  }
  session(id: string) {
    const m = this.sessions.get(id);
    if (!m?.runtime) throw new Error("Chat is not open");
    return m.runtime.session;
  }
  sessionAddress(id: string) {
    const m = this.sessions.get(id);
    if (!m) throw new Error("Chat is not open");
    return { ...m.address };
  }
  private serialize<T>(m: Managed, fn: () => Promise<T>) {
    const expected = addressKey(m.address);
    const task = m.operation.then(() => {
      if (m.phase === "closing" || addressKey(m.address) !== expected)
        throw new Error("STALE_SESSION_ADDRESS");
      return fn();
    });
    m.operation = task.catch(() => {});
    return task;
  }
  /** Mark synchronously, before serialized work or SDK shutdown can yield. UI
   * replies/Stop/Close stay addressed through current(..., false). */
  private transition<T>(
    m: Managed,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (m.transition || m.stopping)
      return Promise.reject(new Error("SESSION_TRANSITION_BUSY"));
    const controller = new AbortController();
    m.transition = controller;
    return Promise.resolve()
      .then(() => action(controller.signal))
      .then((result) => {
        controller.signal.throwIfAborted();
        return result;
      })
      .catch((error) => {
        // SDK replacement failures can occur AFTER the outgoing runtime is
        // disposed. Never expose a ready dead tab or reuse an invalidated runner.
        m.phase = "closing";
        m.controller.abort(error);
        this.receipts.cancel(m.address);
        this.broker.cancelSession(m.address);
        m.ui.cancelAll("close");
        this.options.emit({
          type: "closed",
          address: m.address,
          reason: "failed",
          message: `Session transition failed: ${String(error)}`,
        });
        // A slash command can initiate its own transition; waiting for its send
        // receipt here would deadlock the SDK command handler.
        void this.destroy(m);
        throw error;
      })
      .finally(() => {
        if (m.transition === controller) m.transition = undefined;
        this.maybeReloadAdapterConfig();
      });
  }
  getOpenState({ openId }: { openId: string }): OpenState {
    const result = this.openResults.get(openId);
    if (result) {
      if (result.state.state !== "ready") return result.state;
      const m = this.sessions.get(result.state.address.sessionId);
      if (
        !m ||
        m.phase !== "ready" ||
        m.transition ||
        addressKey(m.address) !== addressKey(result.state.address)
      ) {
        result.state = {
          state: "cancelled",
          message: "Session was closed or replaced",
        };
        return result.state;
      }
      return { state: "ready", snapshot: this.snapshot(m) };
    }
    return (
      this.opens.get(openId)?.state ??
      (this.cancelledOpens.has(openId)
        ? { state: "cancelled", message: "Opening cancelled" }
        : { state: "unknown" })
    );
  }
  cancelOpen({ openId }: { openId: string }) {
    this.cancelledOpens.add(openId);
    const open = this.opens.get(openId);
    if (!open || open.state.state === "ready") return;
    open.state = { state: "cancelled", message: "Opening cancelled" };
    open.controller.abort(new Error("Opening cancelled"));
    if (open.managed) {
      this.broker.cancelSession(open.managed.address);
      open.managed.ui.cancelAll("close");
    }
  }
  openSession(input: OpenSessionParams): Promise<Snapshot> {
    if (this.shuttingDown)
      return Promise.reject(new Error("Session host is shutting down"));
    if (!input.openId || input.openId.length > 256 || !input.cwd)
      return Promise.reject(new Error("Invalid open request"));
    const old = this.opens.get(input.openId);
    if (old)
      return old.input.cwd === input.cwd && old.input.id === input.id
        ? old.promise
        : Promise.reject(new Error("OPEN_ID_CONFLICT"));
    const result = this.openResults.get(input.openId);
    if (result) {
      if (result.input.cwd !== input.cwd || result.input.id !== input.id)
        return Promise.reject(new Error("OPEN_ID_CONFLICT"));
      const state = this.getOpenState(input);
      return state.state === "ready"
        ? Promise.resolve(state.snapshot)
        : Promise.reject(
            new Error("message" in state ? state.message : "Opening cancelled"),
          );
    }
    if (this.cancelledOpens.has(input.openId))
      return Promise.reject(new Error("Opening cancelled"));
    const controller = new AbortController();
    const deferred = Promise.withResolvers<Snapshot>();
    const open: Opening = {
      input: { ...input },
      state: { state: "unknown" },
      controller,
      promise: deferred.promise,
    };
    this.opens.set(input.openId, open);
    void this.open(open).then(
      (snapshot) => {
        this.opens.delete(input.openId);
        this.openResults.set(input.openId, {
          input: open.input,
          state: { state: "ready", address: { ...snapshot.address } },
        });
        deferred.resolve(snapshot);
      },
      (error) => {
        this.opens.delete(input.openId);
        this.openResults.set(input.openId, {
          input: open.input,
          state:
            open.state.state === "failed" || open.state.state === "cancelled"
              ? open.state
              : { state: "failed", message: String(error) },
        });
        deferred.reject(error);
      },
    );
    void open.promise.catch(() => {});
    return open.promise;
  }
  private async open(open: Opening): Promise<Snapshot> {
    let m: Managed | undefined;
    let historyPreview: { snapshot: Snapshot; leaf: string | null } | undefined;
    try {
      const { input, controller } = open;
      controller.signal.throwIfAborted();
      if (input.id && this.sessions.has(input.id)) {
        const existing = this.sessions.get(input.id) as Managed;
        if (existing.cwd !== input.cwd)
          throw new Error("Session does not belong to this project");
        if (existing.phase !== "ready")
          throw new Error("Session is already opening or closing");
        const snapshot = this.snapshot(existing);
        open.state = { state: "ready", snapshot };
        return snapshot;
      }
      const file = input.id
        ? await resolveSessionFile(input.cwd, input.id)
        : undefined;
      controller.signal.throwIfAborted();
      // Another openId may have acquired this persisted session while the
      // membership scan awaited. Never construct two runtimes for one SDK ID.
      const concurrent = input.id && this.sessions.get(input.id);
      if (concurrent) {
        if (concurrent.cwd !== input.cwd || concurrent.phase !== "ready")
          throw new Error("Session is already opening or closing");
        const snapshot = this.snapshot(concurrent);
        open.state = { state: "ready", snapshot };
        return snapshot;
      }
      const manager = file
        ? SessionManager.open(file)
        : SessionManager.create(input.cwd);
      controller.signal.throwIfAborted();
      const address = this.address(manager.getSessionId());
      this.failedHistory.delete(address.sessionId);
      const ui = createExtensionUIHost({
        address,
        broker: this.broker,
        drafts: this.drafts,
        emit: this.options.emitUI,
        emitTerminal: this.options.emitTerminal,
      });
      m = {
        address,
        cwd: input.cwd,
        phase: "opening",
        seq: 0,
        openId: input.openId,
        manager,
        projector: new SDKProjector(
          manager,
          address.epoch,
          this.runDiagnostics,
        ),
        controller,
        ui,
        eventBus: createEventBus(),
        images: createQueuedImagePolicy({
          blockImages: () => this.settings.blockImages,
          processing: () => {
            if (m) m.preparingImages = true;
          },
          queued: () => {
            if (m) m.queuedImages = true;
          },
          settled: () => {
            if (m) {
              m.preparingImages = false;
              m.queuedImages = false;
            }
          },
        }),
        operation: Promise.resolve(),
        reloadPending: false,
        stopping: false,
        queued: new Map(),
        requestIds: new WeakMap(),
        startedSends: [],
        queuedImages: false,
      };
      open.managed = m;
      this.sessions.set(address.sessionId, m);
      open.state = { state: "opening", address };
      this.options.emit({
        type: "opening",
        openId: input.openId,
        address,
        cwd: input.cwd,
      });
      // History is independent of model availability, Trust UI and startup hooks.
      const preview = this.snapshot(m);
      historyPreview = { snapshot: preview, leaf: manager.getLeafId() };
      this.options.emit({ type: "snapshot", snapshot: preview });
      const managed = m;
      const factory: Parameters<typeof createAgentSessionRuntime>[0] = async (
        target,
      ) => {
        controller.signal.throwIfAborted();
        const transitionSignal =
          managed.transition?.signal ?? controller.signal;
        transitionSignal.throwIfAborted();
        const trust = await resolveProjectTrust(
          target.cwd,
          managed.address,
          this.broker,
          transitionSignal,
          agentDir,
          controller.signal,
        );
        if (!trust.trusted)
          this.options.emitUI({
            type: "notify",
            address: managed.address,
            level: "warning",
            message: `Safe mode: omitted project resources: ${trust.omitted.map((r) => r.path).join(", ")}. Trust and reload to enable them.`,
          });
        const models = await createModelRuntime();
        managed.models = models;
        await this.options.configureModels?.(models);
        controller.signal.throwIfAborted();
        transitionSignal.throwIfAborted();
        const services = await loadExclusive(async () => {
          const settingsManager = SettingsManager.create(target.cwd, agentDir, {
            projectTrusted: trust.trusted,
          });
          settingsManager.applyOverrides({
            cacheWarming: "off",
            images: { blockImages: this.settings.blockImages },
          });
          return createAgentSessionServices({
            cwd: target.cwd,
            agentDir,
            modelRuntime: models,
            settingsManager,
            resourceLoaderOptions: {
              ...(await desktopResourceOptions(
                target.cwd,
                trust.trusted,
                this.options.resourceDir ?? desktopConfigDir,
              )),
              eventBus: managed.eventBus,
              extensionFactories: [managed.images.extension],
            },
            resourceLoaderReloadOptions: {
              resolveProjectTrust: async () => trust.trusted,
            },
          });
        });
        services.resourceLoader.reload = async () => {
          if (managed.runtime) this.invalidated.add(managed.runtime.session);
          await resetExtensionProviders(models);
          await this.options.configureModels?.(models);
          const nextTrust = await resolveProjectTrust(
            target.cwd,
            managed.address,
            this.broker,
            managed.transition?.signal ?? controller.signal,
            agentDir,
            controller.signal,
          );
          services.settingsManager.setProjectTrusted(nextTrust.trusted);
          const next = new DefaultResourceLoader({
            cwd: target.cwd,
            agentDir,
            settingsManager: services.settingsManager,
            ...(await desktopResourceOptions(
              target.cwd,
              nextTrust.trusted,
              this.options.resourceDir ?? desktopConfigDir,
            )),
            eventBus: managed.eventBus,
            extensionFactories: [managed.images.extension],
          });
          await next.reload({
            resolveProjectTrust: async () => nextTrust.trusted,
          });
          const facade = services.resourceLoader;
          facade.getExtensions = () => next.getExtensions();
          facade.getSkills = () => next.getSkills();
          facade.getPrompts = () => next.getPrompts();
          facade.getThemes = () => next.getThemes();
          facade.getAgentsFiles = () => next.getAgentsFiles();
          facade.getSystemPrompt = () => next.getSystemPrompt();
          facade.getSystemPromptSource = () => next.getSystemPromptSource();
          facade.getAppendSystemPrompt = () => next.getAppendSystemPrompt();
          facade.getAppendSystemPromptSources = () =>
            next.getAppendSystemPromptSources();
          facade.extendResources = (paths) => next.extendResources(paths);
        };
        const available = await models.getAvailable();
        const context = target.sessionManager.buildSessionContext();
        const branch = target.sessionManager.getBranch();
        const enabled = (candidate: Model<Api>) =>
          isModelEnabled(candidate, this.options.disabled?.() ?? []);
        const model =
          (context.model
            ? available.find(
                (candidate) =>
                  candidate.provider === context.model?.provider &&
                  candidate.id === context.model.modelId &&
                  enabled(candidate),
              )
            : undefined) ??
          available.find(
            (candidate) =>
              enabled(candidate) &&
              candidate.provider ===
                services.settingsManager.getDefaultProvider() &&
              candidate.id === services.settingsManager.getDefaultModel(),
          ) ??
          available.find(
            (candidate) =>
              enabled(candidate) &&
              candidate.provider ===
                (context.model?.provider ??
                  managed.runtime?.session.model?.provider),
          ) ??
          available.find(enabled);
        managed.modelCatalog = available.map(this.options.modelInfo);
        const savedEffort = [...branch]
          .reverse()
          .find((entry) => entry.type === "thinking_level_change");
        const thinkingLevel =
          savedEffort?.type === "thinking_level_change"
            ? model &&
              getSupportedThinkingLevels(model).find(
                (level) => level === savedEffort.thinkingLevel,
              )
            : model
              ? (defaultEffort(model.provider, model.id) ?? "medium")
              : undefined;
        const shell = desktopShellTool(target.cwd, this.settings.shell);
        const result = await createAgentSessionFromServices({
          services,
          sessionManager: target.sessionManager,
          sessionStartEvent: target.sessionStartEvent,
          model,
          thinkingLevel,
          customTools: [defineTool(shell)],
          excludeTools:
            this.settings.shell === "powershell" ? ["bash"] : undefined,
          tools:
            this.settings.shell === "powershell"
              ? ["read", "powershell", "edit", "write"]
              : undefined,
        });
        return { ...result, services, diagnostics: services.diagnostics };
      };
      managed.runtime = await createAgentSessionRuntime(factory, {
        cwd: input.cwd,
        agentDir,
        sessionManager: manager,
      });
      managed.runtime.setBeforeSessionInvalidate(() => {
        this.cancelPublish(managed);
        this.invalidated.add(required(managed.runtime).session);
        this.detachAdapters(managed);
        managed.unsubscribe?.();
        managed.unsubscribe = undefined;
        managed.ui.cancelAll("reload");
        if (managed.models) releaseModelRuntime(managed.models);
      });
      managed.runtime.setRebindSession(async (session) => {
        controller.signal.throwIfAborted();
        managed.transition?.signal.throwIfAborted();
        const previous = managed.address;
        this.sessions.delete(previous.sessionId);
        managed.address = this.address(session.sessionManager.getSessionId());
        managed.manager = session.sessionManager;
        managed.projector = undefined;
        managed.phase = "opening";
        this.sessions.set(managed.address.sessionId, managed);
        this.drafts.transfer(previous, managed.address);
        managed.ui.rotate(managed.address);
        this.options.emit({
          type: "opening",
          previous,
          address: managed.address,
          cwd: managed.cwd,
        });
        await this.bind(managed, session);
        controller.signal.throwIfAborted();
        managed.transition?.signal.throwIfAborted();
        managed.phase = "ready";
        this.options.emit({
          type: "replaced",
          previous,
          snapshot: this.snapshot(managed),
        });
      });
      controller.signal.throwIfAborted();
      await this.bind(managed, managed.runtime.session);
      controller.signal.throwIfAborted();
      managed.phase = "ready";
      const snapshot = this.snapshot(managed);
      open.state = { state: "ready", snapshot };
      this.options.emit({ type: "ready", openId: input.openId, snapshot });
      return snapshot;
    } catch (error) {
      const cancelled = open.controller.signal.aborted;
      open.state = {
        state: cancelled ? "cancelled" : "failed",
        message: String(error),
      };
      if (m) {
        // Retain only verified ownership and a branch token, never a failed runtime.
        const preview =
          !cancelled && m.manager.getSessionFile() && historyPreview
            ? {
                ...historyPreview.snapshot,
                failure: String(error),
              }
            : undefined;
        const history = preview?.transcript.history;
        if (history && preview)
          this.failedHistory.set(m.address.sessionId, {
            address: { ...m.address },
            cwd: m.cwd,
            revision: history.revision,
            leaf: historyPreview?.leaf ?? null,
            snapshot: preview,
          });
        await this.destroy(m);
        this.options.emit({
          type: "closed",
          address: m.address,
          reason: cancelled ? "cancelled" : "failed",
          message: String(error),
        });
      }
      throw error;
    }
  }
  private async bind(m: Managed, session: AgentSession) {
    m.modelCatalog = (await required(m.models).getAvailable()).map(
      this.options.modelInfo,
    );
    m.manager = session.sessionManager;
    m.projector ??= new SDKProjector(
      m.manager,
      m.address.epoch,
      this.runDiagnostics,
    );
    this.restoreQueue(m);
    const agentPrompt = session.agent.prompt.bind(session.agent);
    session.agent.prompt = new Proxy(agentPrompt, {
      apply(target, agent, args) {
        m.controller.signal.throwIfAborted();
        m.admissionSignal?.throwIfAborted();
        if (m.stopping) throw new Error("Session is stopping");
        for (const message of Array.isArray(args[0]) ? args[0] : [args[0]]) {
          if (
            message &&
            typeof message === "object" &&
            message.role === "user"
          ) {
            m.queued.set(message, m.admissionRequestId);
            if (m.admissionRequestId)
              m.requestIds.set(message, m.admissionRequestId);
          }
        }
        return Reflect.apply(target, agent, args);
      },
    });
    const followUp = session.agent.followUp.bind(session.agent);
    session.agent.followUp = (message) => {
      m.controller.signal.throwIfAborted();
      m.admissionSignal?.throwIfAborted();
      if (m.stopping) throw new Error("Session is stopping");
      const queued = this.settings.blockImages ? scrubImages(message) : message;
      m.queued.set(queued, m.admissionRequestId);
      if (m.admissionRequestId) m.requestIds.set(queued, m.admissionRequestId);
      return followUp(queued);
    };
    const steer = session.agent.steer.bind(session.agent);
    session.agent.steer = (message) => {
      m.controller.signal.throwIfAborted();
      m.admissionSignal?.throwIfAborted();
      if (m.stopping) throw new Error("Session is stopping");
      const queued = this.settings.blockImages ? scrubImages(message) : message;
      m.queued.set(queued, m.admissionRequestId);
      if (m.admissionRequestId) m.requestIds.set(queued, m.admissionRequestId);
      return steer(queued);
    };
    // Public adapters apply image policy to persistence and final context, including extension insertion.
    const appendMessage = m.manager.appendMessage.bind(m.manager);
    m.manager.appendMessage = (message) => {
      if (m.quarantined) throw new Error("STOP_UNCONFIRMED");
      return appendMessage(
        this.settings.blockImages ? scrubImages(message) : message,
      );
    };
    const appendCustom = m.manager.appendCustomMessageEntry.bind(m.manager);
    m.manager.appendCustomMessageEntry = (type, content, display, details) => {
      if (m.quarantined) throw new Error("STOP_UNCONFIRMED");
      return appendCustom(
        type,
        this.settings.blockImages ? scrubImages(content) : content,
        display,
        this.settings.blockImages ? scrubImages(details) : details,
      );
    };
    const appendEntry = m.manager.appendCustomEntry.bind(m.manager);
    m.manager.appendCustomEntry = (type, data) => {
      if (m.quarantined) throw new Error("STOP_UNCONFIRMED");
      return appendEntry(type, data);
    };
    const transform = session.agent.transformContext;
    session.agent.transformContext = async (messages, signal) => {
      const result = transform ? await transform(messages, signal) : messages;
      m.controller.signal.throwIfAborted();
      return this.settings.blockImages ? scrubImages(result) : result;
    };
    const setModel = session.setModel.bind(session);
    session.setModel = async (model, options) => {
      m.controller.signal.throwIfAborted();
      if (m.queuedImages || m.preparingImages) await session.waitForIdle();
      m.controller.signal.throwIfAborted();
      return setModel(model, options);
    };
    this.subscribe(m, session);
    this.detachAdapters(m);
    const address = { ...m.address };
    m.adapterSource = createAdapterSource(
      session,
      m.eventBus,
      () => {
        this.current(address, false);
      },
      () => {
        this.current(address);
      },
    );
    await session.bindExtensions({
      uiContext: m.ui.uiContext,
      mode: "rpc",
      abortHandler: () => {
        void this.abort(m.address).catch((error) =>
          console.error("Stop failed", error),
        );
      },
      shutdownHandler: () => {
        queueMicrotask(() => {
          void this.closeSession(m.address);
        });
      },
      onError: (error) => {
        if (m.runtime?.session === session) this.failure(m, error.error);
      },
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: (options) =>
          this.transition(m, () => required(m.runtime).newSession(options)),
        fork: (entryId, options) =>
          this.transition(m, () => required(m.runtime).fork(entryId, options)),
        switchSession: async (path, options) => {
          const known = (await SessionManager.list(m.cwd)).find(
            (info) =>
              sameSessionPath(info.path, path) &&
              sameSessionPath(info.cwd, m.cwd),
          );
          if (!known) throw new Error("Session path outside workspace");
          return this.transition(m, () =>
            required(m.runtime).switchSession(known.path, options),
          );
        },
        navigateTree: async (id, options) => {
          const result = await session.navigateTree(id, options);
          if (!result.cancelled) this.attachAdapters(m);
          return result;
        },
        reload: async () => {
          await this.reloadSession(m.address);
        },
      },
    });
    for (const extension of session.resourceLoader.getExtensions().extensions)
      if (extension.shortcuts.size)
        m.ui.reportUnsupported("registerShortcut", extension.path);
    this.diagnostics(m, session);
    await this.configReady;
    this.attachAdapters(m);
  }
  private subscribe(m: Managed, session: AgentSession) {
    const epoch = m.address.epoch;
    const current = () =>
      !m.quarantined &&
      m.address.epoch === epoch &&
      m.runtime?.session === session;
    const dequeue = session.agent.subscribe((event) => {
      if (current() && event.type === "message_start") {
        const requestId = m.queued.get(event.message);
        m.queued.delete(event.message);
        if (requestId) m.startedSends.push({ ...m.address, requestId });
      }
    });
    const unsubscribe = session.subscribe((event) => {
      if (!current()) return;
      const failure = m.projector?.failure;
      m.projector?.event(
        this.settings.blockImages ? scrubImages(event) : event,
        event.type === "message_start"
          ? m.requestIds.get(event.message)
          : undefined,
      );
      if (event.type === "agent_settled") {
        for (const key of m.startedSends.splice(0)) {
          try {
            this.receipts.releasePayload(key);
          } catch (error) {
            this.failure(m, error);
          }
        }
        m.queuedImages = false;
        this.maybeReload(m);
      }
      if (
        (event.type === "message_update" ||
          event.type === "tool_execution_update") &&
        m.projector?.failure === failure
      )
        this.schedulePublish(m);
      else this.publish(m);
    });
    m.unsubscribe = () => {
      dequeue();
      unsubscribe();
    };
  }
  private maybeReload(m: Managed) {
    if (!m.reloadPending || m.phase !== "ready") return;
    queueMicrotask(() => {
      if (m.phase === "ready")
        void this.reloadSession(m.address).catch((error) =>
          this.failure(m, `Reload failed: ${String(error)}`),
        );
    });
  }
  private detachAdapters(m: Managed) {
    m.adapters?.dispose();
    m.adapters = undefined;
    m.adapterSnapshot = undefined;
    m.adapterSource?.dispose();
    m.adapterSource = undefined;
  }
  private attachAdapters(m: Managed) {
    m.adapters?.dispose();
    m.adapterSnapshot = undefined;
    if (!m.adapterSource || m.phase === "closing") return;
    m.adapters = new AdapterRuntime(
      this.configLoader.config,
      m.adapterSource.backend,
      () => {
        m.adapterSnapshot = undefined;
        if (!m.publishTimer) this.publish(m);
        if (m.reloadPending && !m.adapters?.busy) this.maybeReload(m);
        this.maybeReloadAdapterConfig();
      },
    );
    m.adapters.start();
  }
  async invokeSessionAction(input: SessionAddress & SessionActionRequest) {
    if (this.configReloading) throw new Error("CONFIG_RELOAD_IN_PROGRESS");
    const m = this.current(input);
    if (!m.adapters) throw new Error("ADAPTER_UNAVAILABLE");
    await m.adapters.invoke(input);
  }
  private maybeReloadAdapterConfig() {
    if (
      !this.configReloadPending ||
      this.configReloading ||
      this.shuttingDown ||
      [...this.sessions.values()].some((m) => m.adapters?.busy || m.transition)
    )
      return;
    this.configReloadPending = false;
    queueMicrotask(() => {
      void this.reloadAdapterConfig().catch((error) =>
        console.error("Adapter config reload", error),
      );
    });
  }
  async reloadAdapterConfig(): Promise<{
    state: "pending" | "applied" | "failed";
  }> {
    await this.configReady;
    if (
      this.configReloading ||
      [...this.sessions.values()].some((m) => m.adapters?.busy || m.transition)
    ) {
      this.configReloadPending = true;
      return { state: "pending" };
    }
    this.configReloading = true;
    try {
      const applied = await this.configLoader.reload();
      for (const m of this.sessions.values()) {
        if (applied) this.attachAdapters(m);
        this.publish(m);
      }
      return { state: applied ? "applied" : "failed" };
    } finally {
      this.configReloading = false;
      this.maybeReloadAdapterConfig();
    }
  }
  private diagnostics(m: Managed, session: AgentSession) {
    const extensions = session.resourceLoader.getExtensions();
    for (const warning of extensions.warnings ?? [])
      this.options.emitUI({
        type: "notify",
        address: m.address,
        level: "warning",
        message: `${warning.path}: ${warning.warning}`,
      });
    if (extensions.errors.length)
      this.failure(
        m,
        `Extension loading failed: ${extensions.errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`,
      );
  }
  private restoreQueue(m: Managed) {
    if (!m.runtime?.session.settingsManager.isProjectTrusted()) return;
    m.projector?.restoreQueue((key) => this.receipts.queuedIntent(key));
  }
  private failure(m: Managed, error: unknown) {
    if (m.quarantined || m.phase === "closing") return;
    m.projector?.fail(error);
    this.publish(m);
  }
  private publish(m: Managed) {
    this.cancelPublish(m);
    if (m.phase === "closing" || !m.runtime || !m.projector) return;
    const snapshot = this.snapshot(m, false);
    this.options.emit({ type: "snapshot", snapshot });
    this.options.emitSession?.(m.address.sessionId, {
      type: "snapshot",
      address: m.address,
      snapshotSeq: snapshot.snapshotSeq,
      transcript: snapshot.transcript,
      failure: snapshot.failure,
      aborted: snapshot.aborted,
      sessionUI: snapshot.sessionUI,
      configError: snapshot.configError,
    });
  }
  private cancelPublish(m: Managed) {
    clearTimeout(m.publishTimer);
    m.publishTimer = undefined;
  }
  private schedulePublish(m: Managed) {
    if (m.publishTimer || m.phase === "closing") return;
    m.publishTimer = setTimeout(() => this.publish(m), 32);
  }
  private selection(m: Managed): ModelSelection {
    const session = required(m.runtime).session;
    const model = session.model;
    const info = model && this.options.modelInfo(model);
    const leaf = m.manager.getLeafEntry();
    const count = m.manager.getEntryCount();
    const limitsModel = session.routedModel?.model ?? model;
    if (
      !m.contextCache ||
      m.contextCache.leaf !== leaf ||
      m.contextCache.count !== count ||
      m.contextCache.epoch !== m.address.epoch ||
      m.contextCache.model !== limitsModel ||
      m.contextCache.contextWindow !== limitsModel?.contextWindow
    )
      m.contextCache = {
        leaf,
        count,
        epoch: m.address.epoch,
        model: limitsModel,
        contextWindow: limitsModel?.contextWindow,
        value: session.getContextUsage(),
      };
    const usage = m.contextCache.value;
    return {
      model: info,
      effort: displayedEffort(
        session.thinkingLevel,
        info?.effortLevels ?? [],
        model?.thinkingLevelMap,
      ),
      effortLevels: info?.effortLevels ?? [],
      contextUsage: usage
        ? {
            tokens: usage.tokens,
            contextWindow: usage.contextWindow,
            percent: usage.percent,
          }
        : null,
    };
  }
  private info(m: Managed): SessionInfo {
    const leaf = m.manager.getLeafEntry();
    const count = m.manager.getEntryCount();
    if (
      m.infoCache?.leaf === leaf &&
      m.infoCache?.count === count &&
      m.infoCache.value.id === m.address.sessionId
    )
      return m.infoCache.value;
    const first = m.manager
      .getBranch()
      .find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
    const content =
      first?.type === "message" && first.message.role === "user"
        ? first.message.content
        : "";
    const title =
      typeof content === "string"
        ? content
        : content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ");
    const value: SessionInfo = {
      id: m.address.sessionId,
      cwd: m.cwd,
      title: m.manager.getSessionName() ?? (title || "New chat"),
      modified:
        Date.parse(m.manager.getEntries().at(-1)?.timestamp ?? "") ||
        Date.now(),
    };
    m.infoCache = { leaf, count, value };
    return value;
  }
  private snapshot(m: Managed, includeCatalog = true): Snapshot {
    const projector = required(m.projector);
    m.adapterSnapshot ??= m.adapters?.snapshot();
    const catalog = m.models?.getAvailableSnapshot();
    const catalogChanged = catalog && catalog !== m.catalogSource;
    if (catalogChanged) {
      m.catalogSource = catalog;
      m.modelCatalog = catalog.map(this.options.modelInfo);
    }
    const snapshot: Snapshot = {
      ...(m.phase === "ready" ? {} : { ready: false }),
      address: { ...m.address },
      snapshotSeq: ++m.seq,
      modelCatalog:
        includeCatalog || catalogChanged ? m.modelCatalog : undefined,
      info: this.info(m),
      transcript: projector.snapshot(),
      failure: projector.failure,
      aborted: projector.aborted,
      sessionUI: m.adapterSnapshot,
      configError: this.configLoader.error,
      ...(m.runtime
        ? this.selection(m)
        : { effort: "off" as const, effortLevels: [] }),
    };
    return this.settings.blockImages ? scrubImages(snapshot) : snapshot;
  }
  getSessionSnapshot(address: SessionAddress) {
    return this.snapshot(this.current(address, false));
  }
  async getSessionHistory(
    input: SessionAddress & { revision: string; before: string },
  ) {
    if (typeof input.revision !== "string" || typeof input.before !== "string")
      throw new Error("Invalid history cursor");
    let page: ReturnType<SDKProjector["historyPage"]>;
    if (this.sessions.has(input.sessionId)) {
      const m = this.current(input, false);
      page = required(m.projector).historyPage(input.before, input.revision);
    } else {
      const owner = this.failedHistory.get(input.sessionId);
      if (
        this.shuttingDown ||
        !owner ||
        addressKey(owner.address) !== addressKey(input)
      )
        throw new Error("STALE_SESSION_ADDRESS");
      if (owner.revision !== input.revision)
        throw new Error("STALE_HISTORY_CURSOR");
      // The same header/path checks used by open; no extensions, Trust grant or model startup.
      const manager = await readSessionFile(owner.cwd, input.sessionId);
      if (
        this.failedHistory.get(input.sessionId) !== owner ||
        this.sessions.has(input.sessionId)
      )
        throw new Error("STALE_SESSION_ADDRESS");
      if (
        owner.leaf &&
        !manager.getBranch().some((entry) => entry.id === owner.leaf)
      )
        throw new Error("STALE_HISTORY_CURSOR");
      page = new SDKProjector(
        manager,
        input.epoch,
        this.runDiagnostics,
      ).historyPage(input.before);
      if (page.history) page.history.revision = owner.revision;
    }
    return this.settings.blockImages ? scrubImages(page) : page;
  }
  listSlashCommands(address: SessionAddress): SlashCommand[] {
    const session = required(this.current(address).runtime).session;
    const commands: SlashCommand[] = [];
    const seen = new Set<string>();
    const add = (
      name: string,
      description: string | undefined,
      category: SlashCommand["category"],
    ) => {
      if (!seen.has(name)) {
        seen.add(name);
        commands.push({ name, description, category });
      }
    };
    for (const command of session.extensionRunner.getRegisteredCommands())
      add(command.invocationName, command.description, "extension");
    if (session.settingsManager.getEnableSkillCommands())
      for (const skill of session.resourceLoader.getSkills().skills)
        add(`skill:${skill.name}`, skill.description, "skill");
    for (const template of session.promptTemplates)
      add(template.name, template.description, "prompt");
    return commands;
  }
  async completeSlashArguments(
    input: SessionAddress & { name: string; argumentPrefix: string },
  ) {
    const session = required(this.current(input).runtime).session;
    const command = session.extensionRunner
      .getRegisteredCommands()
      .find((item) => item.invocationName === input.name);
    const items = await command?.getArgumentCompletions?.(input.argumentPrefix);
    this.current(input);
    return (items ?? []).map(({ value, label, description }) => ({
      value,
      label,
      description,
    }));
  }
  getPromptReceipt(key: SendKey) {
    return this.receipts.lookup(key);
  }
  private draftOwner(address: SessionAddress) {
    const m = this.current(address, false);
    return {
      cwd: m.cwd,
      sessionFile: m.manager.getSessionFile() ?? null,
      branchId: m.manager.getLeafId(),
    };
  }
  prompt(params: PromptParams) {
    // Ledger lookup remains usable across closed/old epochs; mutation never does.
    const m = this.current(params),
      session = required(m.runtime).session;
    const reserved = this.receipts.has(params);
    if (!reserved)
      this.receipts.register(params, {
        owner: this.draftOwner(params),
        content: {
          text: params.text,
          pastes: [],
          images: (params.images ?? []).map((image, index) => ({
            id: String(index),
            image,
          })),
        },
      });
    return this.receipts
      .send(
        params,
        session,
        async (signal) => {
          signal.throwIfAborted();
          this.current(params);
          m.admissionSignal = signal;
          m.admissionRequestId = params.requestId;
          // SDK defers prompt() while extension agent_settled hooks execute and can
          // resolve its Promise before preflight. Wait on the public settled event
          // instead, so this call retains a real failure/acceptance Promise.
          if (!session.isStreaming && m.projector?.running)
            await new Promise<void>((resolve, reject) => {
              const unsubscribe = session.subscribe((event) => {
                if (event.type === "agent_settled") {
                  cleanup();
                  resolve();
                }
              });
              const abort = () => {
                cleanup();
                reject(signal.reason);
              };
              const cleanup = () => {
                unsubscribe();
                signal.removeEventListener("abort", abort);
              };
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
          if (m.stopping) throw new Error("Session is stopping");
          if (
            !reserved &&
            this.drafts.read(params).revision !== params.draftRevision
          )
            throw new Error("DRAFT_REVISION_CONFLICT");
          if (!params.text.trim() && !params.images?.length)
            throw new Error("Message is empty");
          if (!params.text.startsWith("/")) {
            const available = required(m.models).getAvailableSnapshot();
            if (
              !available.some(
                (model) =>
                  model.provider === session.model?.provider &&
                  model.id === session.model.id &&
                  isModelEnabled(model, this.options.disabled?.() ?? []),
              )
            ) {
              await this.setModel({
                ...params,
                provider: session.model?.provider ?? "",
                id: session.model?.id ?? "",
              });
              signal.throwIfAborted();
              this.current(params);
            }
          }
          // Images go to the agent as file paths (like pi's TUI paste); its read
          // tool loads them on demand. Extensions may swap them back via `input`.
          const paths = await Promise.all(
            (params.images ?? []).map((image) => storeImage(image)),
          );
          signal.throwIfAborted();
          return { text: withAttachmentPaths(params.text, paths) };
        },
        (error) => {
          if (addressKey(params) === addressKey(m.address))
            this.failure(m, error);
        },
        (intent) =>
          this.drafts.consume(params, params.draftRevision, (consumed) =>
            this.recovery.intent(
              intent,
              consumed
                ? { ...consumed, owner: this.draftOwner(consumed.address) }
                : undefined,
            ),
          ),
      )
      .finally(() => {
        if (m.admissionRequestId === params.requestId)
          m.admissionRequestId = undefined;
        this.maybeReload(m);
      });
  }
  syncDraft(params: DraftSyncParams) {
    this.current(params, false);
    if (this.sessions.get(params.sessionId)?.transition)
      throw new Error("STALE_SESSION_ADDRESS");
    const result = this.drafts.sync(params);
    if (result.applied && params.requestId)
      this.receipts.register(
        {
          hostId: params.hostId,
          sessionId: params.sessionId,
          epoch: params.epoch,
          requestId: params.requestId,
          draftRevision: result.draft.revision,
          text: this.drafts.expandedText(params).trim(),
          images: result.draft.images.length
            ? result.draft.images.map((item) => item.image)
            : undefined,
        },
        { content: params.content, owner: this.draftOwner(params) },
      );
    return result;
  }
  discardRecovery(input: {
    current: SessionAddress;
    retained: SessionAddress;
  }) {
    const m = this.current(input.current);
    if (!m.runtime?.session.settingsManager.isProjectTrusted())
      throw new Error("Trust this project before recovering drafts");
    if (
      input.retained.hostId === this.hostId &&
      this.sessions.has(input.retained.sessionId)
    )
      throw new Error("Only retained drafts can be discarded");
    this.recovery.discard(input.retained, m.cwd);
    this.receipts.forget(input.retained);
  }
  resolveExtensionUI(reply: UIReply) {
    const m = this.current(reply, false);
    this.broker.resolve(reply);
    this.maybeReload(m);
  }
  terminalCommand(command: TerminalClientCommand & SessionAddress) {
    this.current(command, false).ui.handleTerminal(command);
  }
  private recoverQueue(m: Managed) {
    const intents = new Map(
      this.receipts
        .intents()
        .filter(
          (intent) => addressKey(intent.receipt) === addressKey(m.address),
        )
        .map((intent) => [intent.receipt.requestId, intent.content]),
    );
    const queued = [...m.queued].flatMap(([message, requestId]) => {
      if (message.role !== "user") return [];
      const content = requestId ? intents.get(requestId) : undefined;
      return [
        {
          message: content
            ? {
                ...message,
                content: [
                  {
                    type: "text" as const,
                    text: unfoldPastes(content.text, content.pastes).trim(),
                  },
                  ...content.images.map(({ image }) => image),
                ],
              }
            : structuredClone(message),
          key: requestId ? { ...m.address, requestId } : undefined,
        },
      ];
    });
    m.projector?.recoverQueue(queued);
    m.runtime?.session.clearQueue();
    m.queued.clear();
    if (queued.length) this.publish(m);
  }
  private quarantine(m: Managed, error: unknown) {
    if (m.quarantined) return;
    m.quarantined = true;
    m.phase = "closing";
    this.cancelPublish(m);
    m.controller.abort(error);
    m.transition?.abort(error);
    this.receipts.cancel(m.address);
    m.projector?.stopUnconfirmed(error);
    m.unsubscribe?.();
    this.detachAdapters(m);
    this.broker.cancelSession(m.address);
    m.ui.cancelAll("stop");
    this.options.emit({
      type: "closed",
      address: m.address,
      reason: "failed",
      message: String(error),
    });
  }
  abort(address: SessionAddress): Promise<void> {
    const m = this.current(address, false);
    if (m.stopPromise) return m.stopPromise;
    if (m.publishTimer) this.publish(m);
    m.stopping = true;
    m.transition?.abort(new Error("Session transition cancelled by Stop"));
    this.receipts.cancel(address);
    this.broker.cancelSession(address);
    m.ui.cancelAll("stop");
    this.recoverQueue(m);
    m.stopPromise = stopBudget(
      (async () => {
        await m.runtime?.session.abort();
        await this.receipts.settled(address);
      })(),
      "input/start/settled",
    )
      .catch((error) => {
        this.quarantine(m, error);
        void this.destroy(m);
        throw error;
      })
      .finally(() => {
        if (!m.quarantined) {
          m.stopping = false;
          m.admissionSignal = undefined;
          m.queuedImages = false;
          m.stopPromise = undefined;
          this.maybeReload(m);
        }
      });
    return m.stopPromise;
  }
  closeSession(address: SessionAddress): Promise<void> {
    const history = this.failedHistory.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address)) {
      this.failedHistory.delete(address.sessionId);
      this.options.emit({ type: "closed", address, reason: "close" });
      return Promise.resolve();
    }
    const existing = this.sessions.get(address.sessionId);
    if (
      existing?.phase === "closing" &&
      addressKey(existing.address) === addressKey(address)
    )
      return existing.closing ?? existing.disposing ?? Promise.resolve();
    const m = this.current(address, false);
    if (m.publishTimer) this.publish(m);
    m.phase = "closing";
    m.controller.abort(new Error("Chat closed"));
    m.transition?.abort(new Error("Session transition cancelled by Close"));
    this.receipts.cancel(address);
    this.broker.cancelSession(address);
    m.ui.cancelAll("close");
    const opening = this.opens.get(m.openId);
    if (opening && opening.state.state !== "ready")
      this.cancelOpen({ openId: m.openId });
    m.closing = Promise.resolve().then(async () => {
      if (opening && opening.state.state !== "ready") {
        await stopBudget(
          opening.promise.catch(() => {}),
          "startup/close",
        ).catch((error) => this.quarantine(m, error));
        return;
      }
      await this.destroy(m);
      if (!m.quarantined)
        this.options.emit({
          type: "closed",
          address: m.address,
          reason: "close",
        });
    });
    return m.closing;
  }
  private destroy(m: Managed) {
    this.cancelPublish(m);
    if (m.disposing) return m.disposing;
    this.recoverQueue(m);
    const cleanup = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      this.detachAdapters(m);
      await m.operation.catch(() => {});
      try {
        await m.runtime?.session.abort();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.receipts.settled(m.address);
      } catch (error) {
        errors.push(error);
      }
      try {
        if (m.runtime && !this.invalidated.has(m.runtime.session))
          await m.runtime.dispose();
        else m.runtime?.session.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (!m.quarantined) m.projector?.checkpoint();
        m.unsubscribe?.();
        m.ui.dispose();
        this.broker.cancelSession(m.address);
        this.drafts.remove(m.address);
      } catch (error) {
        errors.push(error);
      }
      m.eventBus.clear();
      if (m.models) releaseModelRuntime(m.models);
      if (this.sessions.get(m.address.sessionId) === m)
        this.sessions.delete(m.address.sessionId);
      if (errors.length) console.error("Session cleanup failures", errors);
    });
    m.disposing = stopBudget(cleanup, "close/shutdown").catch((error) =>
      this.quarantine(m, error),
    );
    return m.disposing;
  }
  async reloadSession(
    address: SessionAddress,
  ): Promise<{ state: "pending" | "applied" }> {
    const m = this.current(address),
      session = required(m.runtime).session;
    if (
      session.isStreaming ||
      m.adapters?.busy ||
      m.projector?.running ||
      this.receipts.pending(address) ||
      this.broker.pending().some((r) => addressKey(r) === addressKey(address))
    ) {
      m.reloadPending = true;
      return { state: "pending" };
    }
    return this.transition(m, (signal) =>
      this.serialize(m, async () => {
        m.reloadPending = false;
        const previous = m.address;
        this.detachAdapters(m);
        m.ui.cancelAll("reload");
        try {
          await loadExclusive(() =>
            session.reload({
              beforeSessionStart: () => {
                signal.throwIfAborted();
                this.cancelPublish(m);
                m.address = this.address(previous.sessionId);
                this.drafts.transfer(previous, m.address);
                m.ui.rotate(m.address);
                m.unsubscribe?.();
                m.projector = new SDKProjector(
                  m.manager,
                  m.address.epoch,
                  this.runDiagnostics,
                );
                this.restoreQueue(m);
                this.subscribe(m, session);
                const address = { ...m.address };
                m.adapterSource = createAdapterSource(
                  session,
                  m.eventBus,
                  () => {
                    this.current(address, false);
                  },
                  () => {
                    this.current(address);
                  },
                );
                this.options.emit({
                  type: "opening",
                  previous,
                  address: m.address,
                  cwd: m.cwd,
                });
              },
            }),
          );
          this.diagnostics(m, session);
          if (session.resourceLoader.getExtensions().errors.length)
            throw new Error("One or more extensions failed to reload");
          signal.throwIfAborted();
          this.invalidated.delete(session);
          this.attachAdapters(m);
          this.options.emit({
            type: "replaced",
            previous,
            snapshot: this.snapshot(m),
          });
          return { state: "applied" };
        } catch (error) {
          this.failure(m, `Reload failed: ${String(error)}`);
          throw error;
        }
      }),
    );
  }
  async setModel(params: SessionAddress & { provider: string; id: string }) {
    const m = this.current(params);
    return this.serialize(m, async () => {
      const session = required(m.runtime).session;
      if (session.isStreaming || m.projector?.running)
        await session.waitForIdle();
      m.controller.signal.throwIfAborted();
      const available = required(m.models).getAvailableSnapshot();
      m.modelCatalog = available.map(this.options.modelInfo);
      const enabled = available.filter((model) =>
        isModelEnabled(model, this.options.disabled?.() ?? []),
      );
      const model =
        enabled.find(
          (model) =>
            model.provider === params.provider && model.id === params.id,
        ) ??
        enabled.find(
          (candidate) =>
            candidate.provider ===
              required(
                m.runtime,
              ).session.settingsManager.getDefaultProvider() &&
            candidate.id ===
              required(m.runtime).session.settingsManager.getDefaultModel(),
        ) ??
        enabled[0];
      if (!model) throw new Error("No enabled models available");
      await required(m.runtime).session.setModel(model);
      required(m.runtime).session.setThinkingLevel(
        defaultEffort(model.provider, model.id) ?? "medium",
      );
      this.publish(m);
      return this.selection(m);
    });
  }
  async setEffort(params: SessionAddress & { effort: Effort }) {
    const m = this.current(params);
    return this.serialize(m, async () => {
      const session = required(m.runtime).session;
      if (session.isStreaming || m.projector?.running)
        await session.waitForIdle();
      m.controller.signal.throwIfAborted();
      if (!this.selection(m).effortLevels.includes(params.effort))
        throw new Error("Unsupported reasoning effort");
      required(m.runtime).session.setThinkingLevel(params.effort);
      this.publish(m);
      return this.selection(m);
    });
  }
  async forkSession(params: SessionAddress & { entryId: string }) {
    const m = this.current(params);
    if (!m.manager.getEntry(params.entryId)) throw new Error("Entry not found");
    if (this.receipts.pending(params) || m.adapters?.busy)
      throw new Error("SESSION_TRANSITION_BUSY");
    return this.transition(m, () =>
      this.serialize(m, async () => {
        await required(m.runtime).fork(params.entryId, { position: "at" });
        return this.snapshot(m);
      }),
    );
  }
  async rewindSession(params: SessionAddress & { entryId: string }) {
    const m = this.current(params);
    if (m.adapters?.busy) throw new Error("SESSION_TRANSITION_BUSY");
    return this.transition(m, () =>
      this.serialize(m, async () => {
        const entry = m.manager.getEntry(params.entryId);
        if (!entry || entry.type !== "message" || entry.message.role !== "user")
          throw new Error("Select a user entry to rewind");
        await required(m.runtime).session.abort();
        if (entry.parentId) {
          const result = await required(m.runtime).session.navigateTree(
            entry.parentId,
            {
              summarize: false,
            },
          );
          if (result.cancelled) throw new Error("Rewind cancelled");
        } else {
          m.manager.resetLeaf();
          required(m.runtime).session.agent.reset();
        }
        // branch()/resetLeaf() move only the in-memory cursor. A real SDK custom
        // entry persists the selected leaf without inventing a model message.
        m.manager.appendCustomEntry("pig.rewind", {
          entryId: params.entryId,
        });
        m.projector = new SDKProjector(
          m.manager,
          m.address.epoch,
          this.runDiagnostics,
        );
        this.restoreQueue(m);
        this.attachAdapters(m);
        this.publish(m);
        return this.snapshot(m);
      }),
    );
  }
  async listSessions(cwd: string) {
    const records = new Map(
      (await listSessionFiles(cwd)).map((info) => [info.id, info]),
    );
    for (const m of this.sessions.values())
      if (m.cwd === cwd) records.set(m.address.sessionId, this.info(m));
    return [...records.values()].sort((a, b) => b.modified - a.modified);
  }
  async renameSession(info: SessionInfo, name: string) {
    if (!name.trim()) throw new Error("Chat name is empty");
    const m = this.sessions.get(info.id);
    const manager =
      m?.manager ??
      SessionManager.open(await resolveSessionFile(info.cwd, info.id));
    manager.appendSessionInfo(name.trim());
    if (m) this.publish(m);
    return { ...info, title: name.trim(), modified: Date.now() };
  }
  async deleteSession(info: SessionInfo) {
    const m = this.sessions.get(info.id);
    if (m) await this.closeSession(m.address);
    if (this.sessions.has(info.id))
      throw new Error(
        "Stop is unconfirmed; session cannot be deleted while external work may be running",
      );
    const file = await resolveSessionFile(info.cwd, info.id);
    const manager = SessionManager.open(file);
    await removeSessionFile(info.cwd, info.id);
    for (const address of this.recovery.deleteSession(info.id, info.cwd)) {
      this.receipts.forget(address);
      this.options.emit({
        type: "closed",
        address,
        reason: "close",
        discardDraft: true,
      });
    }
    this.runDiagnostics.delete(manager);
    this.failedHistory.delete(info.id);
  }
  private recoveryState(sessions: Managed[]): RuntimeRecoveryState {
    const allowed = sessions
      .filter(
        (m) =>
          m.phase === "ready" &&
          m.runtime?.session.settingsManager.isProjectTrusted(),
      )
      .map((m) => this.draftOwner(m.address));
    const saved = this.recovery.snapshot(allowed, this.hostId);
    const intents = new Map(
      saved.intents.map((intent) => [
        JSON.stringify(intent.receipt.requestId) + addressKey(intent.receipt),
        intent,
      ]),
    );
    for (const intent of this.receipts.intents())
      if (allowed.some((owner) => owner.cwd === intent.owner.cwd))
        intents.set(
          JSON.stringify(intent.receipt.requestId) + addressKey(intent.receipt),
          intent,
        );
    return {
      hostId: this.hostId,
      sendIntents: [...intents.values()],
      retainedDrafts: saved.drafts.filter((item) => {
        const current = this.sessions.get(item.address.sessionId);
        return (
          !current || addressKey(current.address) !== addressKey(item.address)
        );
      }),
      recoveryError: this.recovery.error,
    };
  }
  getRecovery(address: SessionAddress): RuntimeRecoveryState {
    return this.recoveryState([this.current(address)]);
  }
  runtimeState(): RuntimeViewState {
    const sessions = [...this.sessions.values()];
    return {
      ...this.recoveryState(sessions),
      sessions: [
        ...sessions.map((m) => ({
          phase: m.phase,
          address: { ...m.address },
          openId: m.openId,
          snapshot: m.projector ? this.snapshot(m) : undefined,
        })),
        ...[...this.failedHistory.values()].map((history) => ({
          phase: "closing" as const,
          address: { ...history.address },
          snapshot: history.snapshot,
        })),
      ],
      pendingUI: this.broker.pending(),
      drafts: sessions.map((m) => ({
        address: { ...m.address },
        draft: this.drafts.read(m.address),
      })),
      statuses: sessions.map((m) => ({
        address: { ...m.address },
        status: m.ui.getStatus(),
      })),
    };
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.shuttingDown = true;
    this.failedHistory.clear();
    const opening = [...this.opens.values()].filter(
      (open) =>
        open.state.state === "opening" || open.state.state === "unknown",
    );
    for (const open of opening) this.cancelOpen({ openId: open.input.openId });
    for (const m of this.sessions.values()) {
      if (m.publishTimer) this.publish(m);
      m.phase = "closing";
      m.controller.abort(new Error("Host is shutting down"));
      this.receipts.cancel(m.address);
      this.broker.cancelSession(m.address);
      m.ui.cancelAll("close");
    }
    this.disconnectAll();
    this.disposal = Promise.resolve().then(async () => {
      await Promise.all(
        opening.map((open) =>
          stopBudget(
            open.promise.catch(() => {}),
            "startup/shutdown",
          ).catch((error) => {
            if (open.managed) this.quarantine(open.managed, error);
          }),
        ),
      );
      const sessions = [...this.sessions.values()];
      await Promise.all(sessions.map((m) => this.destroy(m)));
      this.runDiagnostics.close();
      this.recovery.close();
    });
    return this.disposal;
  }
}
