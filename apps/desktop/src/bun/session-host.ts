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
  type CredentialStore,
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
import { ComposerBridge } from "./composer-bridge";
import { desktopConfigDir } from "./desktop-config";
import { createExtensionUIHost, type ExtensionUIHost } from "./extension-ui";
import {
  createQueuedImagePolicy,
  preparePromptImages,
  scrubImages,
} from "./image-policy";
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
  listSessionFiles,
  removeSessionFile,
  resolveSessionFile,
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
  projector?: SDKProjector;
  ui: ExtensionUIHost;
  unsubscribe?: () => void;
  eventBus: EventBusController;
  adapterSource?: ReturnType<typeof createAdapterSource>;
  adapters?: AdapterRuntime;
  disposing?: Promise<void>;
  closing?: Promise<void>;
  operation: Promise<unknown>;
  reloadPending: boolean;
  stopping: boolean;
  queuedImages: boolean;
  preparingImages?: boolean;
  images: ReturnType<typeof createQueuedImagePolicy>;
  admissionSignal?: AbortSignal;
  transition?: AbortController;
};
type Opening = {
  input: OpenSessionParams;
  state: OpenState;
  promise: Promise<Snapshot>;
  controller: AbortController;
  managed?: Managed;
};
type Options = {
  credentials: CredentialStore;
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
};
// SDK's low-level API registry is process-global: serialize loader/reload work.
let loaderQueue = Promise.resolve();
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
  readonly receipts = new SendReceipts(this.hostId);
  readonly broker: UIRequestBroker;
  readonly drafts: ComposerBridge;
  private epoch = 0;
  private sessions = new Map<string, Managed>();
  private opens = new Map<string, Opening>();
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
    this.broker = new UIRequestBroker(options.emitUI);
    this.drafts = new ComposerBridge(options.emitUI);
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
      (ready && (m.phase !== "ready" || !!m.transition))
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
    void this.open(open).then(deferred.resolve, deferred.reject);
    void open.promise.catch(() => {});
    return open.promise;
  }
  private async open(open: Opening): Promise<Snapshot> {
    let m: Managed | undefined;
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
        const models = await createModelRuntime(this.options.credentials);
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
        const model = context.model
          ? available.find(
              (candidate) =>
                candidate.provider === context.model?.provider &&
                candidate.id === context.model.modelId &&
                enabled(candidate),
            )
          : available.find(enabled);
        if ((context.model || available.length) && !model)
          throw new Error(
            "Saved model is unavailable or hidden; choose an enabled model before continuing",
          );
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
    m.manager = session.sessionManager;
    m.projector = new SDKProjector(m.manager, m.address.epoch);
    const agentPrompt = session.agent.prompt.bind(session.agent);
    session.agent.prompt = new Proxy(agentPrompt, {
      apply(target, agent, args) {
        m.controller.signal.throwIfAborted();
        m.admissionSignal?.throwIfAborted();
        return Reflect.apply(target, agent, args);
      },
    });
    const followUp = session.agent.followUp.bind(session.agent);
    session.agent.followUp = (message) => {
      m.controller.signal.throwIfAborted();
      m.admissionSignal?.throwIfAborted();
      return followUp(
        this.settings.blockImages ? scrubImages(message) : message,
      );
    };
    // Public adapters apply image policy to persistence and final context, including extension insertion.
    const appendMessage = m.manager.appendMessage.bind(m.manager);
    m.manager.appendMessage = (message) =>
      appendMessage(this.settings.blockImages ? scrubImages(message) : message);
    const appendCustom = m.manager.appendCustomMessageEntry.bind(m.manager);
    m.manager.appendCustomMessageEntry = (type, content, display, details) =>
      appendCustom(
        type,
        this.settings.blockImages ? scrubImages(content) : content,
        display,
        this.settings.blockImages ? scrubImages(details) : details,
      );
    const transform = session.agent.transformContext;
    session.agent.transformContext = async (messages, signal) => {
      const result = transform ? await transform(messages, signal) : messages;
      return this.settings.blockImages ? scrubImages(result) : result;
    };
    const setModel = session.setModel.bind(session);
    session.setModel = async (model, options) => {
      if (m.queuedImages || m.preparingImages)
        throw new Error(
          "Model change deferred until queued images are consumed",
        );
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
        void this.abort(m.address);
      },
      shutdownHandler: () => {
        queueMicrotask(() => {
          void this.closeSession(m.address);
        });
      },
      onError: (error) => this.failure(m, error.error),
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: (options) =>
          this.transition(m, () => required(m.runtime).newSession(options)),
        fork: (entryId, options) =>
          this.transition(m, () => required(m.runtime).fork(entryId, options)),
        switchSession: async (path, options) => {
          const known = (await SessionManager.list(m.cwd)).find(
            (info) => info.path === path && info.cwd === m.cwd,
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
    m.unsubscribe = session.subscribe((event) => {
      m.projector?.event(
        this.settings.blockImages ? scrubImages(event) : event,
      );
      if (event.type === "agent_settled") {
        m.queuedImages = false;
        this.maybeReload(m);
      }
      this.publish(m);
    });
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
    m.adapterSource?.dispose();
    m.adapterSource = undefined;
  }
  private attachAdapters(m: Managed) {
    m.adapters?.dispose();
    if (!m.adapterSource || m.phase === "closing") return;
    m.adapters = new AdapterRuntime(
      this.configLoader.config,
      m.adapterSource.backend,
      () => {
        this.publish(m);
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
  private failure(m: Managed, error: unknown) {
    m.projector?.fail(error);
    this.publish(m);
  }
  private publish(m: Managed) {
    if (m.phase === "closing" || !m.runtime || !m.projector) return;
    const snapshot = this.snapshot(m);
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
  private selection(m: Managed): ModelSelection {
    const session = required(m.runtime).session;
    const model = session.model;
    const info = model && this.options.modelInfo(model);
    const usage = session.getContextUsage();
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
    return {
      id: m.address.sessionId,
      cwd: m.cwd,
      title: m.manager.getSessionName() ?? (title || "New chat"),
      modified:
        Date.parse(m.manager.getEntries().at(-1)?.timestamp ?? "") ||
        Date.now(),
    };
  }
  private snapshot(m: Managed): Snapshot {
    const projector = required(m.projector);
    const snapshot = {
      address: { ...m.address },
      snapshotSeq: ++m.seq,
      info: this.info(m),
      transcript: projector.snapshot(),
      failure: projector.failure,
      aborted: projector.aborted,
      sessionUI: m.adapters?.snapshot(),
      configError: this.configLoader.error,
      ...this.selection(m),
    };
    return this.settings.blockImages ? scrubImages(snapshot) : snapshot;
  }
  getSessionSnapshot(address: SessionAddress) {
    return this.snapshot(this.current(address, false));
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
  prompt(params: PromptParams) {
    // Ledger lookup remains usable across closed/old epochs; mutation never does.
    const m = this.current(params),
      session = required(m.runtime).session;
    return this.receipts
      .send(
        params,
        session,
        async (signal) => {
          signal.throwIfAborted();
          this.current(params);
          m.admissionSignal = signal;
          m.preparingImages = !!params.images?.length;
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
          if (this.drafts.read(params).revision !== params.draftRevision)
            throw new Error("DRAFT_REVISION_CONFLICT");
          if (!params.text.trim() && !params.images?.length)
            throw new Error("Message is empty");
          const model = session.model;
          if (
            params.images?.length &&
            model &&
            !this.settings.blockImages &&
            !model.input.includes("image")
          )
            throw new Error("The current model does not accept images");
          if (!model && !params.text.startsWith("/"))
            throw new Error("Choose an available model first");
          const queued = session.isStreaming;
          const result = await preparePromptImages(
            params.images ?? [],
            {
              queued,
              blockImages: this.settings.blockImages,
              provider: model?.provider ?? "",
              modelId: model?.id ?? "",
            },
            model?.inputLimits?.images?.resize && {
              ...model.inputLimits.images.resize,
            },
          );
          if (queued) m.images.remember(result.images, model);
          if (queued && result.images.length) m.queuedImages = true;
          signal.throwIfAborted();
          return {
            text: [params.text, ...result.hints].filter(Boolean).join("\n\n"),
            images: result.images,
          };
        },
        (error) => this.failure(m, error),
      )
      .finally(() => {
        if (!this.receipts.pending(params)) m.preparingImages = false;
        this.maybeReload(m);
      });
  }
  syncDraft(params: DraftSyncParams) {
    this.current(params, false);
    if (this.sessions.get(params.sessionId)?.transition)
      throw new Error("STALE_SESSION_ADDRESS");
    return this.drafts.sync(params);
  }
  resolveExtensionUI(reply: UIReply) {
    const m = this.current(reply, false);
    this.broker.resolve(reply);
    this.maybeReload(m);
  }
  terminalCommand(command: TerminalClientCommand & SessionAddress) {
    this.current(command, false).ui.handleTerminal(command);
  }
  async abort(address: SessionAddress) {
    const m = this.current(address, false);
    m.stopping = true;
    m.transition?.abort(new Error("Session transition cancelled by Stop"));
    this.receipts.cancel(address);
    this.broker.cancelSession(address);
    m.ui.cancelAll("stop");
    try {
      await m.runtime?.session.abort();
      await this.receipts.settled(address);
      m.runtime?.session.clearQueue();
    } finally {
      m.stopping = false;
      m.admissionSignal = undefined;
      m.queuedImages = false;
      this.maybeReload(m);
    }
  }
  closeSession(address: SessionAddress): Promise<void> {
    const existing = this.sessions.get(address.sessionId);
    if (
      existing?.phase === "closing" &&
      addressKey(existing.address) === addressKey(address)
    )
      return existing.closing ?? existing.disposing ?? Promise.resolve();
    const m = this.current(address, false);
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
        await opening.promise.catch(() => {});
        return;
      }
      await m.operation.catch(() => {});
      await this.destroy(m);
      this.options.emit({
        type: "closed",
        address: m.address,
        reason: "close",
      });
    });
    return m.closing;
  }
  private destroy(m: Managed) {
    m.disposing ??= Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      this.detachAdapters(m);
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
                m.address = this.address(previous.sessionId);
                this.drafts.transfer(previous, m.address);
                m.ui.rotate(m.address);
                m.unsubscribe?.();
                m.projector = new SDKProjector(m.manager, m.address.epoch);
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
      const model = (await required(m.models).getAvailable()).find(
        (model) =>
          model.provider === params.provider &&
          model.id === params.id &&
          isModelEnabled(model, this.options.disabled?.() ?? []),
      );
      if (!model) throw new Error("Model unavailable or hidden");
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
        m.manager.appendCustomEntry("piris.rewind", {
          entryId: params.entryId,
        });
        m.projector = new SDKProjector(m.manager, m.address.epoch);
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
    if (
      m &&
      (m.runtime?.session.isStreaming || this.receipts.pending(m.address))
    )
      throw new Error("Stop active chats before deleting a chat");
    if (m) await this.closeSession(m.address);
    await removeSessionFile(info.cwd, info.id);
  }
  runtimeState(): RuntimeViewState {
    const sessions = [...this.sessions.values()];
    return {
      hostId: this.hostId,
      sessions: sessions.map((m) => ({
        phase: m.phase,
        address: { ...m.address },
        openId: m.openId,
        snapshot: m.runtime && m.projector ? this.snapshot(m) : undefined,
      })),
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
    const opening = [...this.opens.values()].filter(
      (open) =>
        open.state.state === "opening" || open.state.state === "unknown",
    );
    for (const open of opening) this.cancelOpen({ openId: open.input.openId });
    for (const m of this.sessions.values()) {
      m.phase = "closing";
      m.controller.abort(new Error("Host is shutting down"));
      this.receipts.cancel(m.address);
      this.broker.cancelSession(m.address);
      m.ui.cancelAll("close");
    }
    this.disconnectAll();
    this.disposal = Promise.resolve().then(async () => {
      await Promise.all(opening.map((open) => open.promise.catch(() => {})));
      const sessions = [...this.sessions.values()];
      await Promise.all(sessions.map((m) => m.operation.catch(() => {})));
      await Promise.all(sessions.map((m) => this.destroy(m)));
    });
    return this.disposal;
  }
}
