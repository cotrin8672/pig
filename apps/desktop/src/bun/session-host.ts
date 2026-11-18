import "./runtime-profile";
import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActionKeymap,
  SessionActionRequest,
} from "../../../../packages/config/src";
import { AdapterRuntime } from "./adapter-runtime";
import { createAdapterSource } from "./adapter-source";
import { ConfigLoader } from "./config-loader";
import { keepLastContextTokens } from "./context-usage";

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
import { withDraftFiles } from "../shared/attachments";
import { IMPORTED_HISTORY_PROVIDER } from "../shared/chat-history-import";
import { displayedEffort } from "../shared/effort";
import type { ExtensionUIEvent, UIReply } from "../shared/extension-ui";
import type { McpAppPreviewResult } from "../shared/mcp-app";
import { createModelCatalogCache } from "../shared/model-catalog-cache";
import { isModelEnabled } from "../shared/models";
import { unfoldPastes } from "../shared/paste";
import {
  type SessionAccounts,
  validateAccountId,
  validateProviderId,
  validateSessionAccounts,
} from "../shared/provider-accounts";
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
  RuntimeUsage,
  RuntimeViewState,
  SendKey,
  SessionAddress,
  SessionPhase,
} from "../shared/runtime-contract";
import { RUNTIME_IDLE_MS } from "../shared/runtime-contract";
import type { Settings } from "../shared/settings";
import type {
  TerminalClientCommand,
  TerminalHostEvent,
} from "../shared/terminal-ui";
import { storeImage, withAttachmentPaths } from "./attachments";
import { ComposerBridge } from "./composer-bridge";
import { desktopConfigDir } from "./desktop-config";
import { createExtensionUIHost, type ExtensionUIHost } from "./extension-ui";
import { fastModeExtension } from "./fast-mode";
import { createQueuedImagePolicy, scrubImages } from "./image-policy";
import { McpApps } from "./mcp-apps";
import { desktopMcpExtensions } from "./mcp-extensions";
import {
  createModelRuntime,
  releaseModelRuntime,
  resetExtensionProviders,
  runtimeAccounts,
} from "./model-runtime";
import { defaultEffort } from "./model-settings";
import { traceOpen } from "./open-performance";
import { withPackageLock } from "./package-queue";
import { isProjectTrusted, resolveProjectTrust } from "./project-trust";
import { providerAccounts } from "./provider-accounts";
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
  sessionDirFor,
  sessionHistoryDigest,
  unchangedHistoryPrefix,
} from "./session-files";
import { currentSettings } from "./settings";
import { desktopShellTool } from "./shell-tools";
import { SessionStatistics, statisticsOwner } from "./statistics/collector";
import type { StatisticsSink } from "./statistics/contracts";
import { toolSourceLabel } from "./statistics/initial-context";
import { UIRequestBroker } from "./ui-request-broker";

type Managed = {
  idleSince?: number;
  wakeRequested?: boolean;
  operations: number;
  suspending?: Promise<HistoryHandle | undefined>;
  suspensionError?: string;
  suspensionCleanup?: Promise<void>;
  resuming?: boolean;
  address: SessionAddress;
  cwd: string;
  phase: SessionPhase;
  seq: number;
  openId: string;
  manager: SDKSessionManager;
  controller: AbortController;
  runtime?: AgentSessionRuntime;
  models?: ModelRuntime;
  accounts: SessionAccounts;
  accountHistory?: boolean;
  accountSelectionFailed?: boolean;
  modelCatalog?: ModelInfo[];
  catalogSource?: readonly Model<Api>[];
  projector?: SDKProjector;
  ui: ExtensionUIHost;
  unsubscribe?: () => void;
  statistics?: SessionStatistics;
  eventBus: EventBusController;
  mcpApps?: McpApps;
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
    running: boolean;
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
/** No manager, projector, SDK objects or transcript bodies survive suspension. */
type HistoryHandle = {
  digest: string;
  entryCount: number;
  address: SessionAddress;
  previous?: SessionAddress;
  draftRevision?: number;
  cwd: string;
  file: string;
  leaf: string | null;
  revision: string;
  seq: number;
  openId: string;
  info: SessionInfo;
  accounts: SessionAccounts;
  accountHistory: boolean;
  selection: ModelSelection;
  failure?: string;
  aborted?: boolean;
  reading?: Promise<Snapshot>;
  waking?: Promise<Snapshot>;
};
type BranchOrigin = {
  manager: SDKSessionManager;
  previousSessionFile: string;
  accounts: SessionAccounts;
};
type Opening = {
  input: OpenSessionParams;
  branch?: BranchOrigin;
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
export type SessionAccountPersistence = {
  read: (sessionId: string) => SessionAccounts;
  write: (sessionId: string, accounts: SessionAccounts) => Promise<unknown>;
};
type Options = {
  sessionAccounts?: SessionAccountPersistence;
  modelInfo: (model: Model<Api>) => ModelInfo;
  historyModel?: (provider: string, id: string) => ModelInfo | undefined;
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
  idleNow?: () => number;
  recoveryFile?: string;
  statistics?: StatisticsSink;
};
// SDK's low-level API registry is process-global: serialize loader/reload work.
let loaderQueue = Promise.resolve();
const stopWaitMs = 2_000;
function sessionInfo(manager: SDKSessionManager, cwd: string): SessionInfo {
  const first = manager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "user");
  const content =
    first?.type === "message" && first.message.role === "user"
      ? first.message.content
      : "";
  const title =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ");
  return {
    id: manager.getSessionId(),
    cwd,
    title: manager.getSessionName() ?? (title || "New chat"),
    modified:
      Date.parse(manager.getEntries().at(-1)?.timestamp ?? "") || Date.now(),
  };
}
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
  const task = loaderQueue.then(() => withPackageLock(fn));
  loaderQueue = task.then(
    () => {},
    () => {},
  );
  return task;
}

import { RuntimeUsageTracker } from "./runtime-usage";
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
  private histories = new Map<string, HistoryHandle>();
  private readonly usage: RuntimeUsageTracker;
  private idleTimer?: ReturnType<typeof setInterval>;
  private readonly shareModelCatalog = createModelCatalogCache();
  private failedHistory = new Map<
    string,
    {
      address: SessionAddress;
      cwd: string;
      revision: string;
      leaf: string | null;
      digest: string;
      entryCount: number;
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
  /** Called after a config reload replaces the active config. */
  onConfigApplied?: () => void;
  constructor(private readonly options: Options) {
    this.usage = new RuntimeUsageTracker(options.idleNow);
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
  connectUI(input: { clientId: string; usage?: RuntimeUsage }) {
    const { clientId, usage } = input;
    if (this.shuttingDown) throw new Error("Session host is shutting down");
    this.clients.connect(clientId);
    this.usage.connect(clientId);
    if (usage) this.runtimeUsage({ clientId, usage });
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        void this.suspendIdle().catch((error) =>
          console.error("Idle suspension failed", error),
        );
      }, 15_000);
      this.idleTimer.unref();
    }
    this.broker.setAvailable(true);
  }
  heartbeatUI(input: { clientId: string; usage?: RuntimeUsage }) {
    const connected =
      !this.shuttingDown && this.clients.heartbeat(input.clientId);
    if (connected && input.usage)
      this.runtimeUsage({ clientId: input.clientId, usage: input.usage });
    return { connected };
  }
  runtimeUsage(input: { clientId: string; usage: RuntimeUsage }) {
    if (!this.usage.update(input.clientId, input.usage)) return;
    for (const address of input.usage.protected) {
      const m = this.sessions.get(address.sessionId);
      if (m && addressKey(m.address) === addressKey(address))
        m.idleSince = undefined;
    }
  }
  disconnectUI({ clientId }: { clientId: string }) {
    this.usage.disconnect(clientId);
    this.clients.disconnect(clientId);
  }
  disconnectAll() {
    this.usage.clear();
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
      (ready &&
        (m.phase !== "ready" ||
          !!m.transition ||
          m.stopping ||
          !!m.suspending ||
          !!m.suspensionError))
    )
      throw new Error("STALE_SESSION_ADDRESS");
    if (ready) m.idleSince = undefined;
    return m;
  }
  session(id: string) {
    const m = this.sessions.get(id);
    if (!m?.runtime) throw new Error("Chat is not open");
    return m.runtime.session;
  }
  sessionAddress(id: string) {
    const history = this.histories.get(id);
    if (history) return { ...history.address };
    const m = this.sessions.get(id);
    if (!m) throw new Error("Chat is not open");
    return { ...m.address };
  }
  private serialize<T>(m: Managed, fn: () => Promise<T>) {
    m.operations++;
    m.idleSince = undefined;
    const expected = addressKey(m.address);
    const task = m.operation.then(() => {
      if (m.phase === "closing" || addressKey(m.address) !== expected)
        throw new Error("STALE_SESSION_ADDRESS");
      return fn();
    });
    m.operation = task
      .finally(() => {
        m.operations--;
      })
      .catch(() => {});
    return task;
  }
  private canSuspend(m: Managed, ownSlot = false) {
    const session = m.runtime?.session;
    if (
      this.shuttingDown ||
      m.phase !== "ready" ||
      !session?.isIdle ||
      m.projector?.running ||
      m.projector?.retry ||
      m.operations > (ownSlot ? 1 : 0) ||
      (!ownSlot && m.suspending) ||
      m.suspensionError ||
      m.wakeRequested ||
      m.resuming ||
      m.transition ||
      m.stopping ||
      m.reloadPending ||
      this.configReloading ||
      this.configReloadPending ||
      m.queuedImages ||
      m.preparingImages ||
      m.queued.size ||
      m.startedSends.length ||
      session.pendingMessageCount ||
      this.receipts.pending(m.address) ||
      this.drafts.hasContent(m.address) ||
      this.broker
        .pending()
        .some((request) => addressKey(request) === addressKey(m.address)) ||
      this.usage.protects(m.address) ||
      this.configLoader.config.sessionAdapters?.length ||
      this.configLoader.config.toolViews?.length
    )
      return false;
    // Extensions are stopped through the SDK's official session_shutdown.
    const file = m.manager.getSessionFile();
    try {
      return !!file && statSync(file).isFile();
    } catch {
      return false;
    }
  }
  /** One host sweep; eligibility is rechecked inside the session's operation lane. */
  async suspendIdle() {
    let suspended = 0;
    const now = (this.options.idleNow ?? Date.now)();
    for (const id of [...this.sessions.keys()]) {
      const m = this.sessions.get(id);
      if (!m) continue;
      if (!this.canSuspend(m)) {
        m.idleSince = undefined;
        continue;
      }
      m.idleSince ??= now;
      if (now - m.idleSince < RUNTIME_IDLE_MS) continue;
      m.wakeRequested = false;
      const task = this.serialize(m, async () => {
        if (!this.canSuspend(m, true)) return undefined;
        const previous = { ...m.address };
        const file = required(m.manager.getSessionFile());
        const history: HistoryHandle = {
          address: this.address(previous.sessionId),
          previous,
          cwd: m.cwd,
          file,
          leaf: m.manager.getLeafId(),
          digest: sessionHistoryDigest(m.manager),
          entryCount: m.manager.getEntryCount(),
          revision: required(m.projector?.snapshot().history?.revision),
          seq: m.seq + 1,
          openId: m.openId,
          info: { ...this.info(m) },
          accounts: { ...m.accounts },
          accountHistory: this.hasAccountHistory(m),
          selection: structuredClone(this.selection(m)),
          failure: m.projector?.failure,
          aborted: m.projector?.aborted,
        };
        this.cancelPublish(m);
        m.mcpApps?.dispose();
        // dispose emits session_shutdown and awaits the SDK's credential writes.
        m.suspensionCleanup = required(m.runtime).dispose();
        await stopBudget(m.suspensionCleanup, "idle SDK shutdown");
        if (m.phase === "closing" || this.shuttingDown) return undefined;
        m.projector?.checkpoint();
        history.leaf = m.manager.getLeafId();
        this.detachAdapters(m);
        m.unsubscribe?.();
        m.ui.dispose();
        m.eventBus.clear();
        if (m.models) releaseModelRuntime(m.models);
        m.suspensionCleanup = undefined;
        m.controller.abort(new Error("SDK suspended"));
        this.receipts.cancel(previous);
        history.draftRevision = this.drafts.read(previous).revision + 1;
        this.histories.set(previous.sessionId, history);
        try {
          this.drafts.transfer(previous, history.address);
        } catch (error) {
          this.histories.delete(previous.sessionId);
          throw error;
        }
        this.sessions.delete(previous.sessionId);
        this.options.emit({
          type: "suspended",
          previous,
          address: history.address,
          snapshotSeq: history.seq,
          historyRevision: history.revision,
          draftRevision: history.draftRevision,
        });
        return history;
      });
      m.suspending = task;
      try {
        if (await task) suspended++;
      } catch (error) {
        // Never claim success or start a second SDK after an unconfirmed shutdown.
        m.suspensionError = `SDK suspension failed: ${String(error)}`;
        m.projector?.fail(m.suspensionError);
        this.options.emitUI({
          type: "notify",
          address: m.address,
          level: "error",
          message: m.suspensionError,
        });
      } finally {
        m.suspending = undefined;
        m.wakeRequested = false;
      }
    }
    return suspended;
  }
  isSuspended(address: SessionAddress) {
    const m = this.sessions.get(address.sessionId);
    return !!(
      (m &&
        addressKey(m.address) === addressKey(address) &&
        (m.suspending || m.suspensionError || m.resuming)) ||
      this.histories.has(address.sessionId)
    );
  }
  wakeSession(address: SessionAddress): Promise<Snapshot> {
    const m = this.sessions.get(address.sessionId);
    if (m && addressKey(m.address) === addressKey(address)) {
      if (m.suspensionError)
        return Promise.reject(new Error(m.suspensionError));
      if (m.suspending) {
        m.wakeRequested = true;
        return m.suspending.then((history) =>
          history ? this.wakeSession(history.address) : this.snapshot(m),
        );
      }
      if (m.phase === "ready") return Promise.resolve(this.snapshot(m));
    }
    const history = this.histories.get(address.sessionId);
    if (
      this.shuttingDown ||
      !history ||
      addressKey(history.address) !== addressKey(address)
    )
      return Promise.reject(new Error("STALE_SESSION_ADDRESS"));
    history.waking ??= this.openSession({
      openId: crypto.randomUUID(),
      cwd: history.cwd,
      id: address.sessionId,
    }).finally(() => {
      history.waking = undefined;
    });
    return history.waking;
  }
  private historySelection(
    manager: SDKSessionManager,
    accounts: SessionAccounts,
    previous?: ModelSelection,
  ): ModelSelection {
    const saved = manager.buildSessionContext().model;
    if (!saved || saved.provider === IMPORTED_HISTORY_PROVIDER)
      return previous ?? { effort: "off", effortLevels: [] };
    const model = (previous?.model?.provider === saved.provider &&
    previous.model.id === saved.modelId
      ? previous.model
      : undefined) ??
      this.options.historyModel?.(saved.provider, saved.modelId) ?? {
        provider: saved.provider,
        id: saved.modelId,
        name: saved.modelId,
      };
    const level = [...manager.getBranch()]
      .reverse()
      .find((entry) => entry.type === "thinking_level_change");
    const levels = model.effortLevels ?? [];
    return {
      model,
      ...(accounts[model.provider]
        ? { accountId: accounts[model.provider] }
        : {}),
      effort:
        level?.type === "thinking_level_change"
          ? (levels.find((item) => item === level.thinkingLevel) ?? "off")
          : "off",
      effortLevels: levels,
    };
  }
  private historySnapshot(
    history: HistoryHandle,
    prepared?: SDKSessionManager,
  ): Promise<Snapshot> {
    if (history.reading) return history.reading;
    const task = (async () => {
      const manager =
        prepared ??
        (await readSessionFile(history.cwd, history.address.sessionId));
      if (this.shuttingDown) throw new Error("STALE_SESSION_ADDRESS");
      if (this.histories.get(history.address.sessionId) !== history) {
        const live = this.sessions.get(history.address.sessionId);
        if (
          live?.phase === "ready" &&
          addressKey(live.address) === addressKey(history.address)
        )
          return this.snapshot(live);
        throw new Error("STALE_SESSION_ADDRESS");
      }
      const prefixChanged = !unchangedHistoryPrefix(manager, history);
      if (prefixChanged) {
        if (
          this.drafts.hasContent(history.address) ||
          this.receipts.pending(history.address)
        )
          throw new Error(
            "History changed externally; your draft is retained.",
          );
        history.revision = crypto.randomUUID();
      }
      if (manager.getLeafId() !== history.leaf || prefixChanged) {
        history.failure = undefined;
        history.aborted = undefined;
      }
      history.leaf = manager.getLeafId();
      history.digest = sessionHistoryDigest(manager);
      history.entryCount = manager.getEntryCount();
      history.accountHistory ||= manager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "message" &&
            (entry.message.role === "user" ||
              entry.message.role === "assistant"),
        );
      history.selection = this.historySelection(
        manager,
        history.accounts,
        history.selection,
      );
      history.info = sessionInfo(manager, history.cwd);
      const projector = new SDKProjector(
        manager,
        history.address.epoch,
        undefined,
        history.revision,
      );
      const snapshot: Snapshot = {
        ...history.selection,
        suspended: true,
        address: { ...history.address },
        snapshotSeq: ++history.seq,
        info: { ...history.info },
        sessionAccounts: { ...history.accounts },
        accountSwitchAllowed: !history.accountHistory,
        transcript: projector.snapshot(),
        failure: history.failure ?? projector.failure,
        aborted: history.aborted,
      };
      return this.settings.blockImages ? scrubImages(snapshot) : snapshot;
    })();
    history.reading = task;
    void task
      .finally(() => {
        if (history.reading === task) history.reading = undefined;
      })
      .catch(() => {});
    return task;
  }
  readSessionSnapshot(address: SessionAddress): Promise<Snapshot> {
    const history = this.histories.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address))
      return this.historySnapshot(history);
    return Promise.resolve(this.getSessionSnapshot(address));
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
      const history = this.histories.get(result.state.address.sessionId);
      if (
        history &&
        addressKey(history.address) === addressKey(result.state.address)
      )
        return { state: "opening", address: { ...history.address } };
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
  async readOpenState(input: { openId: string }): Promise<OpenState> {
    const result = this.openResults.get(input.openId);
    if (result?.state.state === "ready") {
      const history = this.histories.get(result.state.address.sessionId);
      if (
        history &&
        addressKey(history.address) === addressKey(result.state.address)
      )
        return {
          state: "ready",
          snapshot: await this.historySnapshot(history),
        };
    }
    return this.getOpenState(input);
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
    return this.startOpen(input);
  }
  private startOpen(
    input: OpenSessionParams,
    branch?: BranchOrigin,
  ): Promise<Snapshot> {
    if (this.shuttingDown)
      return Promise.reject(new Error("Session host is shutting down"));
    if (!input.openId || input.openId.length > 256 || !input.cwd)
      return Promise.reject(new Error("Invalid open request"));
    const old = this.opens.get(input.openId);
    if (old)
      return old.input.cwd === input.cwd &&
        old.input.id === input.id &&
        old.input.historyOnly === input.historyOnly
        ? old.promise
        : Promise.reject(new Error("OPEN_ID_CONFLICT"));
    const result = this.openResults.get(input.openId);
    if (result) {
      if (
        result.input.cwd !== input.cwd ||
        result.input.id !== input.id ||
        result.input.historyOnly !== input.historyOnly
      )
        return Promise.reject(new Error("OPEN_ID_CONFLICT"));
      return this.readOpenState(input).then((state) => {
        if (state.state === "ready") return state.snapshot;
        throw new Error(
          "message" in state ? state.message : "Opening cancelled",
        );
      });
    }
    if (this.cancelledOpens.has(input.openId))
      return Promise.reject(new Error("Opening cancelled"));
    const controller = new AbortController();
    const deferred = Promise.withResolvers<Snapshot>();
    const open: Opening = {
      input: { ...input },
      branch,
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
    const timing = traceOpen(open.input.openId);
    let m: Managed | undefined;
    let historyPreview:
      | {
          snapshot: Snapshot;
          leaf: string | null;
          digest: string;
          entryCount: number;
        }
      | undefined;
    let resuming: HistoryHandle | undefined;
    try {
      const { input, controller, branch } = open;
      controller.signal.throwIfAborted();
      if (input.id && this.sessions.has(input.id)) {
        const existing = this.sessions.get(input.id) as Managed;
        if (existing.cwd !== input.cwd)
          throw new Error("Session does not belong to this project");
        const history = this.histories.get(input.id);
        if (existing.resuming && history && input.historyOnly) {
          const snapshot = await this.historySnapshot(history);
          open.state = { state: "ready", snapshot };
          return snapshot;
        }
        if (existing.phase !== "ready")
          throw new Error("Session is already opening or closing");
        const snapshot = this.snapshot(existing);
        open.state = { state: "ready", snapshot };
        return snapshot;
      }
      const file = branch
        ? branch.manager.getSessionFile()
        : input.id
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
      timing.mark("resolve-file");
      const known = input.id && this.histories.get(input.id);
      if (known && known.cwd !== input.cwd)
        throw new Error("Session does not belong to this project");
      if (input.historyOnly && input.id && file) {
        let prepared: SDKSessionManager | undefined;
        let history = known || undefined;
        if (!history) {
          const reader = await readSessionFile(input.cwd, input.id);
          controller.signal.throwIfAborted();
          prepared = reader;
          controller.signal.throwIfAborted();
          const acquired = this.sessions.get(input.id);
          if (acquired) {
            const snapshot = this.snapshot(acquired);
            open.state = { state: "ready", snapshot };
            return snapshot;
          }
          history = this.histories.get(input.id);
          if (!history) {
            const accounts = validateSessionAccounts(
              this.options.sessionAccounts?.read(input.id) ?? {},
            );
            history = {
              address: this.address(input.id),
              cwd: input.cwd,
              file,
              leaf: reader.getLeafId(),
              digest: sessionHistoryDigest(reader),
              entryCount: reader.getEntryCount(),
              revision: crypto.randomUUID(),
              seq: 0,
              openId: input.openId,
              info: sessionInfo(reader, input.cwd),
              accounts,
              accountHistory: reader
                .getEntries()
                .some(
                  (entry) =>
                    entry.type === "message" &&
                    (entry.message.role === "user" ||
                      entry.message.role === "assistant"),
                ),
              selection: this.historySelection(reader, accounts),
            };
            this.histories.set(input.id, history);
          }
        }
        const snapshot = await this.historySnapshot(history, prepared);
        controller.signal.throwIfAborted();
        open.state = { state: "ready", snapshot };
        this.options.emit({ type: "ready", openId: input.openId, snapshot });
        return snapshot;
      }
      resuming = known || undefined;
      if (resuming && (!file || !sameSessionPath(file, resuming.file)))
        throw new Error("Session file changed while suspended");
      // open() derives the directory from the file, which matches sessionDirFor.
      const manager =
        branch?.manager ??
        (file
          ? SessionManager.open(file)
          : SessionManager.create(input.cwd, await sessionDirFor(input.cwd)));
      controller.signal.throwIfAborted();
      if (
        resuming &&
        (manager.getSessionId() !== resuming.address.sessionId ||
          manager.getLeafId() !== resuming.leaf ||
          sessionHistoryDigest(manager) !== resuming.digest)
      )
        throw new Error(
          "History changed externally; reopen it before sending.",
        );
      timing.mark("session-manager");
      const address = resuming?.address ?? this.address(manager.getSessionId());
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
        seq: resuming?.seq ?? 0,
        operations: 0,
        resuming: !!resuming,
        openId: input.openId,
        manager,
        accounts:
          branch?.accounts ??
          (resuming
            ? { ...resuming.accounts }
            : validateSessionAccounts(
                this.options.sessionAccounts?.read(address.sessionId) ?? {},
              )),
        projector: new SDKProjector(
          manager,
          address.epoch,
          this.runDiagnostics,
          resuming?.revision,
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
      // Claim the new session before awaiting account persistence, so another
      // window cannot open the new file under a different account.
      if (branch && file && Object.keys(branch.accounts).length) {
        try {
          await this.options.sessionAccounts?.write(
            address.sessionId,
            branch.accounts,
          );
        } catch (error) {
          await unlink(file);
          throw error;
        }
        controller.signal.throwIfAborted();
      }
      if (!resuming)
        this.options.emit({
          type: "opening",
          openId: input.openId,
          address,
          cwd: input.cwd,
        });
      if (!resuming) {
        // A cold handle already owns its view; do not copy a second preview.
        const preview = this.snapshot(m);
        historyPreview = {
          snapshot: preview,
          leaf: manager.getLeafId(),
          digest: sessionHistoryDigest(manager),
          entryCount: manager.getEntryCount(),
        };
        this.options.emit({ type: "snapshot", snapshot: preview });
      }
      timing.mark("history-preview");
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
          desktopConfigDir,
          controller.signal,
        );
        timing.mark("trust-check-or-user-wait");
        if (!trust.trusted)
          this.options.emitUI({
            type: "notify",
            address: managed.address,
            level: "warning",
            message: `Safe mode: omitted project resources: ${trust.omitted.map((r) => r.path).join(", ")}. Trust and reload to enable them.`,
          });
        const targetId = target.sessionManager.getSessionId();
        if (targetId !== managed.address.sessionId)
          await this.options.sessionAccounts?.write(targetId, managed.accounts);
        const models = await createModelRuntime(managed.accounts);
        timing.mark("model-runtime");
        managed.models = models;
        await this.options.configureModels?.(models);
        controller.signal.throwIfAborted();
        transitionSignal.throwIfAborted();
        managed.mcpApps?.dispose();
        const mcpApps = new McpApps(controller.signal);
        managed.mcpApps = mcpApps;
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
              extensionFactories: [
                ...desktopMcpExtensions(mcpApps),
                { name: "pig-image-policy", factory: managed.images.extension },
                {
                  name: "pig-fast-mode",
                  factory: fastModeExtension(() => this.settings.fastMode),
                },
              ],
            },
            resourceLoaderReloadOptions: {
              resolveProjectTrust: async () => trust.trusted,
            },
          });
        });
        timing.mark("resource-services-and-queue");
        services.resourceLoader.reload = async () => {
          if (managed.runtime) this.invalidated.add(managed.runtime.session);
          await resetExtensionProviders(models);
          await this.options.configureModels?.(models);
          const nextTrust = await resolveProjectTrust(
            target.cwd,
            managed.address,
            this.broker,
            managed.transition?.signal ?? controller.signal,
            desktopConfigDir,
            controller.signal,
          );
          services.settingsManager.setProjectTrusted(nextTrust.trusted);
          managed.mcpApps?.dispose();
          const reloadedMcpApps = new McpApps(controller.signal);
          managed.mcpApps = reloadedMcpApps;
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
            extensionFactories: [
              ...desktopMcpExtensions(reloadedMcpApps),
              { name: "pig-image-policy", factory: managed.images.extension },
              {
                name: "pig-fast-mode",
                factory: fastModeExtension(() => this.settings.fastMode),
              },
            ],
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
        timing.mark("available-models");
        const context = target.sessionManager.buildSessionContext();
        // Source model labels are provenance, not a destination provider/account.
        if (context.model?.provider === IMPORTED_HISTORY_PROVIDER)
          context.model = null;
        const branch = target.sessionManager.getBranch();
        const enabled = (candidate: Model<Api>) =>
          isModelEnabled(candidate, this.options.disabled?.() ?? []);
        // A saved account must never silently resume under a different identity/provider.
        if (
          context.model &&
          managed.accounts[context.model.provider] &&
          !available.some(
            (candidate) =>
              candidate.provider === context.model?.provider &&
              candidate.id === context.model.modelId &&
              enabled(candidate),
          )
        )
          throw new Error(
            "Saved account or model is unavailable. Sign in or enable that model again.",
          );
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
        });
        timing.mark("create-agent-session");
        return { ...result, services, diagnostics: services.diagnostics };
      };
      managed.runtime = await createAgentSessionRuntime(factory, {
        cwd: input.cwd,
        agentDir,
        sessionManager: manager,
        sessionStartEvent: branch
          ? {
              type: "session_start",
              reason: "fork",
              previousSessionFile: branch.previousSessionFile,
            }
          : undefined,
      });
      managed.runtime.setBeforeSessionInvalidate(() => {
        this.cancelPublish(managed);
        managed.mcpApps?.dispose();
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
      timing.mark("bind-extensions-and-adapters");
      controller.signal.throwIfAborted();
      managed.phase = "ready";
      managed.resuming = false;
      if (resuming) {
        managed.seq = Math.max(managed.seq, resuming.seq);
        this.histories.delete(address.sessionId);
      }
      const snapshot = this.snapshot(managed);
      open.state = { state: "ready", snapshot };
      this.options.emit({ type: "ready", openId: input.openId, snapshot });
      timing.mark("ready-publication");
      return snapshot;
    } catch (error) {
      const cancelled = open.controller.signal.aborted;
      open.state = {
        state: cancelled ? "cancelled" : "failed",
        message: String(error),
      };
      if (resuming) {
        resuming.failure = `SDK startup failed: ${String(error)}`;
        if (m) {
          if (
            resuming.leaf &&
            !m.manager.getBranch().some((entry) => entry.id === resuming?.leaf)
          )
            resuming.revision = crypto.randomUUID();
          resuming.leaf = m.manager.getLeafId();
          resuming.digest = sessionHistoryDigest(m.manager);
          resuming.entryCount = m.manager.getEntryCount();
          m.phase = "closing";
          m.controller.abort(error);
          await this.destroy(
            m,
            this.histories.get(resuming.address.sessionId) === resuming,
          );
        }
        this.options.emitUI({
          type: "notify",
          address: resuming.address,
          level: "error",
          message: resuming.failure,
        });
        throw error;
      }
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
        if (history && preview && historyPreview)
          this.failedHistory.set(m.address.sessionId, {
            address: { ...m.address },
            cwd: m.cwd,
            revision: history.revision,
            leaf: historyPreview.leaf,
            digest: historyPreview.digest,
            entryCount: historyPreview.entryCount,
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
    } finally {
      timing.finish(open.state.state);
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
      const outgoing = this.settings.blockImages ? scrubImages(result) : result;
      try {
        m.statistics?.initialContext(
          outgoing,
          session.model?.contextWindow ?? null,
          new Map(
            session
              .getAllTools()
              .map((tool) => [tool.name, toolSourceLabel(tool.sourceInfo)]),
          ),
        );
      } catch {
        console.error("[statistics] initial context unavailable");
      }
      return outgoing;
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
        // Keep the SDK's attribution: without the extension and event, the error is not actionable.
        if (m.runtime?.session === session)
          this.failure(
            m,
            [
              `Extension ${error.extensionPath} failed in ${error.event}: ${error.error}`,
              error.stack,
            ]
              .filter(Boolean)
              .join("\n"),
          );
      },
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: (options) =>
          this.transition(m, () => required(m.runtime).newSession(options)),
        fork: (entryId, options) =>
          this.transition(m, () => required(m.runtime).fork(entryId, options)),
        switchSession: async (path, options) => {
          const known = (
            await SessionManager.list(m.cwd, await sessionDirFor(m.cwd))
          ).find(
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
    let statistics: SessionStatistics | undefined;
    let statisticsErrorReported = false;
    const observe = (callback: () => void) => {
      if (!this.options.statistics) return;
      try {
        callback();
      } catch {
        // Extension metadata and collection failures must never break a run.
        if (!statisticsErrorReported) {
          console.error("[statistics] session metadata unavailable");
          statisticsErrorReported = true;
        }
      }
    };
    observe(() => {
      statistics = new SessionStatistics(
        {
          profile: agentDir,
          cwd: m.cwd,
          session: m.address.sessionId,
          host: this.hostId,
          epoch,
          account: (provider) =>
            m.models
              ? runtimeAccounts(m.models).selection()[provider]
              : undefined,
        },
        required(this.options.statistics),
      );
      statistics.context(session);
      m.statistics = statistics;
    });
    const dequeue = session.agent.subscribe((event) => {
      if (current() && event.type === "message_start") {
        const requestId = m.queued.get(event.message);
        m.queued.delete(event.message);
        if (requestId) m.startedSends.push({ ...m.address, requestId });
      }
    });
    let retrying = false;
    const unsubscribe = session.subscribe((event) => {
      if (!current()) return;
      m.idleSince = undefined;
      observe(() => {
        statistics?.event(
          event,
          event.type === "message_start"
            ? m.requestIds.get(event.message)
            : undefined,
        );
        if (
          event.type === "agent_start" ||
          (event.type === "message_start" && event.message.role === "assistant")
        )
          statistics?.context(session);
      });
      const failure = m.projector?.failure;
      m.projector?.event(
        this.settings.blockImages ? scrubImages(event) : event,
        event.type === "message_start"
          ? m.requestIds.get(event.message)
          : undefined,
      );
      if (event.type === "auto_retry_start") retrying = true;
      // The SDK retries transient errors up to its budget. A model error it
      // will not retry stops the run synchronously, before queued input is
      // delivered: agent_end for an unretried error, auto_retry_end once the
      // budget is exhausted.
      const lastAssistant =
        event.type === "agent_end"
          ? [...event.messages]
              .reverse()
              .find((message) => message.role === "assistant")
          : undefined;
      const unrecovered =
        (event.type === "agent_end" &&
          lastAssistant?.role === "assistant" &&
          lastAssistant.stopReason === "error" &&
          !event.willRetry &&
          !retrying) ||
        (event.type === "auto_retry_end" && !event.success);
      if (event.type === "auto_retry_end" || event.type === "agent_settled")
        retrying = false;
      if (unrecovered && m.phase !== "closing" && !m.stopping)
        void this.abort(m.address).catch((error) =>
          console.error("Stop after model error failed", error),
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
      observe(() => statistics?.close());
      if (m.statistics === statistics) m.statistics = undefined;
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
  /** Config keys for built-in actions; they work without a session. */
  async actionKeymaps(): Promise<ActionKeymap[]> {
    await this.configReady;
    return (this.configLoader.config.keymaps ?? []).filter(
      (keymap): keymap is ActionKeymap => "action" in keymap,
    );
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
      if (applied) this.onConfigApplied?.();
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
    if (
      m.phase === "closing" ||
      (m.resuming && m.phase !== "ready") ||
      m.suspending ||
      !m.runtime ||
      !m.projector
    )
      return;
    const snapshot = this.snapshot(m, false);
    this.options.emit({ type: "snapshot", snapshot });
    this.options.emitSession?.(m.address.sessionId, {
      type: "snapshot",
      address: m.address,
      snapshotSeq: snapshot.snapshotSeq,
      transcript: snapshot.transcript,
      failure: snapshot.failure,
      aborted: snapshot.aborted,
      retry: snapshot.retry,
      sessionUI: snapshot.sessionUI,
      configError: snapshot.configError,
    });
  }
  publishModelCatalogs() {
    for (const m of this.sessions.values())
      if (m.phase === "ready" && !m.quarantined) this.publish(m);
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
        value: keepLastContextTokens(
          session.getContextUsage(),
          m.contextCache?.value,
        ),
      };
    const usage = m.contextCache.value;
    return {
      model: info,
      ...(model && m.accounts[model.provider]
        ? { accountId: m.accounts[model.provider] }
        : {}),
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
    const running = m.projector?.running ?? false;
    if (
      m.infoCache?.leaf === leaf &&
      m.infoCache?.count === count &&
      m.infoCache.running === running &&
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
      // Persisted tool/message entries must not reorder chats before agent_settled.
      modified:
        (running ? m.infoCache?.value.modified : undefined) ??
        (Date.parse(m.manager.getEntries().at(-1)?.timestamp ?? "") ||
          Date.now()),
    };
    m.infoCache = { leaf, count, running, value };
    return value;
  }
  private hasAccountHistory(m: Managed) {
    if (!m.accountHistory)
      m.accountHistory = m.manager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "message" &&
            (entry.message.role === "user" ||
              entry.message.role === "assistant"),
        );
    return m.accountHistory;
  }
  private snapshot(m: Managed, includeCatalog = true): Snapshot {
    const projector = required(m.projector);
    m.adapterSnapshot ??= m.adapters?.snapshot();
    const catalog = m.models?.getAvailableSnapshot();
    const catalogChanged = catalog && catalog !== m.catalogSource;
    if (catalogChanged) {
      m.catalogSource = catalog;
      m.modelCatalog = this.shareModelCatalog(
        catalog.map(this.options.modelInfo),
      );
    }
    const snapshot: Snapshot = {
      ...(m.resuming || m.suspending || m.suspensionError
        ? { suspended: true as const }
        : {}),
      ...(m.phase === "ready" ? {} : { ready: false }),
      address: { ...m.address },
      snapshotSeq: ++m.seq,
      sessionAccounts: { ...m.accounts },
      accountSwitchAllowed: !this.hasAccountHistory(m),
      modelCatalog:
        includeCatalog || catalogChanged ? m.modelCatalog : undefined,
      info: this.info(m),
      transcript: projector.snapshot(),
      failure: projector.failure,
      aborted: projector.aborted,
      retry: projector.retry,
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
  /** Sanitized static HTML for a live call, or null. Never wakes a suspended runtime. */
  async getMcpAppPreview(
    input: SessionAddress & { appId: string; toolCallId: string },
  ): Promise<McpAppPreviewResult> {
    try {
      if (
        typeof input.appId !== "string" ||
        typeof input.toolCallId !== "string"
      )
        return null;
      const m = this.current(input, false);
      const apps = m.mcpApps;
      if (!apps) return null;
      const html = await apps.readStatic(
        input.appId,
        input.toolCallId,
        AbortSignal.timeout(10_000),
      );
      return this.current(input, false) === m && m.mcpApps === apps
        ? { html }
        : null;
    } catch {
      // Optional preview: the normal tool result stays the fallback.
      return null;
    }
  }
  /** Internal raw resource boundary; never expose this HTML through RPC or render it unsanitized. */
  async readMcpAppResource(
    input: SessionAddress & { appId: string; toolCallId: string },
    signal: AbortSignal,
  ) {
    const m = this.current(input, false);
    const apps = required(m.mcpApps);
    const result = await apps.read(input.appId, input.toolCallId, signal);
    if (this.current(input, false) !== m || m.mcpApps !== apps)
      throw new Error("STALE_SESSION_ADDRESS");
    return result;
  }
  async getSessionHistory(
    input: SessionAddress & { revision: string; before: string },
  ) {
    if (typeof input.revision !== "string" || typeof input.before !== "string")
      throw new Error("Invalid history cursor");
    let page: ReturnType<SDKProjector["historyPage"]>;
    if (
      this.sessions.has(input.sessionId) &&
      !this.histories.has(input.sessionId)
    ) {
      const m = this.current(input, false);
      page = required(m.projector).historyPage(input.before, input.revision);
    } else {
      const owner =
        this.histories.get(input.sessionId) ??
        this.failedHistory.get(input.sessionId);
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
        (this.histories.get(input.sessionId) ??
          this.failedHistory.get(input.sessionId)) !== owner ||
        (this.sessions.has(input.sessionId) &&
          !this.histories.has(input.sessionId))
      )
        throw new Error("STALE_SESSION_ADDRESS");
      if (
        owner.revision !== input.revision ||
        !unchangedHistoryPrefix(manager, owner)
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
    const history = this.histories.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address))
      return [];
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
  cancelPrompt(key: SendKey) {
    const intent = this.receipts.queuedIntent(key);
    const receipt = this.receipts.withdraw(key);
    const m = this.sessions.get(key.sessionId);
    if (
      intent &&
      receipt.state === "rejected" &&
      receipt.code === "CANCELLED" &&
      m?.phase === "ready" &&
      addressKey(m.address) === addressKey(key)
    ) {
      this.drafts.consume(key, intent.draftRevision, (consumed) => {
        if (consumed)
          this.recovery.draft(
            consumed.address,
            consumed.draft,
            this.draftOwner(key),
          );
      });
    }
    return receipt;
  }
  getPromptReceipt(key: SendKey) {
    return this.receipts.lookup(key);
  }
  acknowledgePromptRecovery(params: SessionAddress & { key: SendKey }) {
    const m = this.current(params, false);
    if (
      !(
        addressKey(params) === addressKey(params.key) &&
        this.receipts.queuedIntent(params.key)
      ) &&
      !m.projector?.diagnostics.value.recovered.some(
        (item) =>
          item.key &&
          addressKey(item.key) === addressKey(params.key) &&
          item.key.requestId === params.key.requestId,
      )
    )
      throw new Error("Queued input was not cancelled in this chat");
    this.receipts.acknowledgeRecovery(params.key);
  }
  /** Returns the resulting order of the host-held follow-ups. */
  reorderQueuedPrompts(input: SessionAddress & { requestIds: string[] }) {
    this.current(input, false);
    if (
      !Array.isArray(input.requestIds) ||
      input.requestIds.length > 256 ||
      input.requestIds.some((id) => typeof id !== "string" || id.length > 256)
    )
      throw new Error("Invalid queue order");
    return this.receipts.reorderQueued(input, input.requestIds);
  }
  /** Promotes a waiting follow-up to steering; false once it has started sending. */
  steerQueuedPrompt(key: SendKey) {
    this.current(key);
    return this.receipts.steerQueued(key);
  }
  private draftOwner(address: SessionAddress) {
    const history = this.histories.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address))
      return {
        cwd: history.cwd,
        sessionFile: history.file,
        branchId: history.leaf,
      };
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
    // Selection changes requested before this prompt apply to it; later ones do not.
    const ordered = m.operation;
    const reserved = this.receipts.has(params);
    if (
      !reserved &&
      params.delivery === "followUp" &&
      this.drafts.read(params).revision !== params.draftRevision
    )
      throw new Error("DRAFT_REVISION_CONFLICT");
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
          await ordered;
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
            params.delivery !== "followUp" &&
            this.drafts.read(params).revision !== params.draftRevision
          )
            throw new Error("DRAFT_REVISION_CONFLICT");
          if (!params.text.trim() && !params.images?.length)
            throw new Error("Message is empty");
          if (!params.text.startsWith("/")) {
            if (m.accountSelectionFailed)
              throw new Error(
                "Account selection failed. Choose an account again before sending.",
              );
            const available = required(m.models).getAvailableSnapshot();
            if (
              !available.some(
                (model) =>
                  model.provider === session.model?.provider &&
                  model.id === session.model.id &&
                  isModelEnabled(model, this.options.disabled?.() ?? []),
              )
            ) {
              await this.applyModel(
                m,
                session.model?.provider ?? "",
                session.model?.id ?? "",
              );
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
          if (addressKey(params) === addressKey(m.address)) {
            this.failure(m, error);
            // SDK exceptions need the same queue recovery as terminal model errors.
            if (m.phase !== "closing" && !m.stopping)
              void this.abort(m.address).catch((error) =>
                console.error("Stop after prompt failure failed", error),
              );
          }
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
  getSessionDraft(address: SessionAddress) {
    this.draftOwner(address);
    return this.drafts.read(address);
  }
  syncDraft(params: DraftSyncParams) {
    this.draftOwner(params);
    const managed = this.sessions.get(params.sessionId);
    if (managed?.transition || managed?.suspending)
      throw new Error("STALE_SESSION_ADDRESS");
    const result = this.drafts.sync(params);
    if (result.applied && params.requestId)
      this.receipts.register(
        {
          hostId: params.hostId,
          sessionId: params.sessionId,
          epoch: params.epoch,
          requestId: params.requestId,
          delivery: params.delivery,
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
    m.idleSince = undefined;
    this.broker.resolve(reply);
    this.maybeReload(m);
  }
  terminalCommand(command: TerminalClientCommand & SessionAddress) {
    const m = this.current(command, false);
    m.idleSince = undefined;
    m.ui.handleTerminal(command);
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
                    text: withDraftFiles(
                      unfoldPastes(content.text, content.pastes).trim(),
                      content.files,
                      content.annotations,
                    ),
                  },
                  ...content.images.map(({ image }) => image),
                ],
              }
            : structuredClone(message),
          key: requestId ? { ...m.address, requestId } : undefined,
        },
      ];
    });
    // Host-held follow-ups have not entered SDK queues; save their text before rejection releases it.
    const waiting = this.receipts.intents().flatMap((intent) =>
      addressKey(intent.receipt) === addressKey(m.address) &&
      intent.delivery === "followUp" &&
      intent.content &&
      intent.receipt.state === "pending" &&
      intent.receipt.stage === "queued"
        ? [
            {
              message: {
                role: "user" as const,
                timestamp: intent.timestamp ?? 0,
                content: [
                  {
                    type: "text" as const,
                    text: withDraftFiles(
                      unfoldPastes(
                        intent.content.text,
                        intent.content.pastes,
                      ).trim(),
                      intent.content.files,
                      intent.content.annotations,
                    ),
                  },
                  ...intent.content.images.map(({ image }) => image),
                ],
              },
            },
          ]
        : [],
    );
    m.projector?.recoverQueue([...queued, ...waiting]);
    m.runtime?.session.clearQueue();
    m.queued.clear();
    if (queued.length || waiting.length) this.publish(m);
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
    this.recoverQueue(m);
    this.receipts.cancel(address);
    this.broker.cancelSession(address);
    m.ui.cancelAll("stop");
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
    const dormant = this.histories.get(address.sessionId);
    if (dormant && addressKey(dormant.address) === addressKey(address)) {
      this.histories.delete(address.sessionId);
      if (!this.sessions.has(address.sessionId)) {
        this.receipts.cancel(address);
        this.drafts.remove(address);
        this.options.emit({ type: "closed", address, reason: "close" });
        return Promise.resolve();
      }
    }
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
    this.recoverQueue(m);
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
  private destroy(m: Managed, keepDraft = false) {
    this.cancelPublish(m);
    m.mcpApps?.dispose();
    if (m.disposing) return m.disposing;
    this.recoverQueue(m);
    const cleanup = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      this.detachAdapters(m);
      await m.operation.catch(() => {});
      if (m.suspensionCleanup) {
        try {
          await m.suspensionCleanup;
        } catch (error) {
          errors.push(error);
        }
      }
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
        if (!keepDraft) this.drafts.remove(m.address);
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
  /** Prompts admitted before a selection change finish with the old selection. */
  private orderedSelection<T>(
    params: SessionAddress,
    change: (m: Managed) => Promise<T>,
  ) {
    const m = this.current(params);
    const admitted = this.receipts.admitted(params);
    return this.serialize(m, async () => {
      await admitted;
      const session = required(m.runtime).session;
      if (session.isStreaming || m.projector?.running)
        await session.waitForIdle();
      m.controller.signal.throwIfAborted();
      this.current(params);
      return change(m);
    });
  }
  async setModel(
    params: SessionAddress & {
      provider: string;
      id: string;
      accountId?: string | null;
    },
  ) {
    validateProviderId(params.provider);
    if (typeof params.id !== "string" || !params.id)
      throw new Error("Invalid model ID.");
    if (params.accountId !== undefined && params.accountId !== null)
      validateAccountId(params.accountId);
    return this.orderedSelection(params, async (m) => {
      const previous = m.accounts[params.provider];
      const next =
        params.accountId === undefined
          ? previous
          : (params.accountId ?? undefined);
      const changed = previous !== next;
      const models = required(m.models);
      const credentials = runtimeAccounts(models);
      const session = required(m.runtime).session;
      const oldModel = session.model;
      const oldEffort = session.thinkingLevel;
      if (changed) {
        // Do not let sends queued behind a failed account change use the old identity.
        m.accountSelectionFailed = true;
        // shortcut: prohibit account changes with history until cross-account reasoning replay is verified.
        if (this.hasAccountHistory(m))
          throw new Error("Account changes currently require a new chat.");
        if (next) {
          if (!models.getProvider(params.provider)?.auth.oauth?.isSubscription)
            throw new Error("Only subscription accounts are supported.");
          if (!(await providerAccounts.read(next, params.provider)))
            throw new Error("Selected account is signed out. Sign in again.");
        }
        credentials.select(params.provider, next ?? null);
      }
      try {
        if (changed)
          await models.refresh({
            providers: [params.provider],
            allowNetwork: false,
          });
        await this.applyModel(m, params.provider, params.id, changed);
        if (changed) {
          const accounts = credentials.selection();
          await this.options.sessionAccounts?.write(
            m.address.sessionId,
            accounts,
          );
          m.accounts = accounts;
        }
      } catch (error) {
        if (changed) {
          credentials.select(params.provider, previous ?? null);
          await models.refresh({
            providers: [params.provider],
            allowNetwork: false,
          });
          if (oldModel && session.model !== oldModel)
            await session.setModel(oldModel);
          session.setThinkingLevel(oldEffort);
        }
        throw error;
      }
      m.accountSelectionFailed = false;
      this.publish(m);
      return this.selection(m);
    });
  }
  private async applyModel(
    m: Managed,
    provider: string,
    id: string,
    strict = false,
  ) {
    const session = required(m.runtime).session;
    const available = required(m.models).getAvailableSnapshot();
    m.modelCatalog = available.map(this.options.modelInfo);
    const enabled = available.filter((model) =>
      isModelEnabled(model, this.options.disabled?.() ?? []),
    );
    const settings = session.settingsManager;
    const requested = enabled.find(
      (model) => model.provider === provider && model.id === id,
    );
    if (!requested && (strict || m.accounts[provider]))
      throw new Error(
        "Selected account or model is unavailable. No account fallback was used.",
      );
    const model =
      requested ??
      enabled.find(
        (model) =>
          model.provider === settings.getDefaultProvider() &&
          model.id === settings.getDefaultModel(),
      ) ??
      enabled[0];
    if (!model) throw new Error("No enabled models available");
    await session.setModel(model);
    session.setThinkingLevel(
      defaultEffort(model.provider, model.id) ?? "medium",
    );
  }
  async setEffort(params: SessionAddress & { effort: Effort }) {
    return this.orderedSelection(params, async (m) => {
      if (!this.selection(m).effortLevels.includes(params.effort))
        throw new Error("Unsupported reasoning effort");
      required(m.runtime).session.setThinkingLevel(params.effort);
      this.publish(m);
      return this.selection(m);
    });
  }
  async forkSession(params: SessionAddress & { entryId: string }) {
    if (this.shuttingDown) throw new Error("Session host is shutting down");
    const m = this.current(params);
    const { entryId } = params;
    const entry = m.manager.getEntry(entryId);
    if (
      entry?.type !== "message" ||
      (entry.message.role !== "user" && entry.message.role !== "assistant")
    )
      throw new Error("Select a saved message to branch from");
    const runner = required(m.runtime).session.extensionRunner;
    if (runner.hasHandlers("session_before_fork")) {
      const result = await runner.emit({
        type: "session_before_fork",
        entryId,
        position: "at",
      });
      if (result?.cancel) throw new Error("Branch cancelled");
      this.current(params);
    }
    const source = m.manager.getSessionFile();
    if (!source || !statSync(source, { throwIfNoEntry: false })?.isFile())
      throw new Error("Session history has not been saved");
    // Branching changes the manager's file and leaf. Never use the live manager.
    const copy = SessionManager.open(source, m.manager.getSessionDir());
    if (copy.getSessionId() !== params.sessionId)
      throw new Error("Session history changed before branching");
    const file = copy.createBranchedSession(entryId);
    if (!file) throw new Error("Failed to save branch");
    return this.startOpen(
      { cwd: m.cwd, id: copy.getSessionId(), openId: crypto.randomUUID() },
      {
        manager: copy,
        previousSessionFile: source,
        accounts: { ...m.accounts },
      },
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
  /**
   * Membership of one chat without scanning the project: an open chat, or a
   * file whose header belongs to `cwd`. Title and time come only from open chats.
   */
  async findSession(cwd: string, id: string): Promise<SessionInfo> {
    const m = this.sessions.get(id);
    if (m && m.cwd === cwd) return this.info(m);
    const history = this.histories.get(id);
    if (history && history.cwd === cwd) return { ...history.info };
    await resolveSessionFile(cwd, id);
    return { id, cwd, title: "", modified: 0 };
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
    const history = this.histories.get(info.id);
    if (history) {
      if (history.cwd !== info.cwd)
        throw new Error("Session does not belong to this project");
      await this.closeSession(history.address);
    }
    const m = this.sessions.get(info.id);
    if (m && m.cwd !== info.cwd)
      throw new Error("Session does not belong to this project");
    if (m) await this.closeSession(m.address);
    if (this.sessions.has(info.id))
      throw new Error(
        "Stop is unconfirmed; session cannot be deleted while external work may be running",
      );
    const manager =
      m?.manager ??
      SessionManager.open(await resolveSessionFile(info.cwd, info.id));
    const file = manager.getSessionFile();
    // The SDK creates no file until the first user or assistant message.
    if (file && statSync(file, { throwIfNoEntry: false }))
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
    await this.options.statistics?.forget(
      statisticsOwner(agentDir, info.cwd, info.id),
    );
  }
  private recoveryState(
    sessions: Managed[],
    histories: HistoryHandle[] = [],
  ): RuntimeRecoveryState {
    const allowed = sessions
      .filter(
        (m) =>
          m.phase === "ready" &&
          m.runtime?.session.settingsManager.isProjectTrusted(),
      )
      .map((m) => this.draftOwner(m.address))
      .concat(histories.map((h) => this.draftOwner(h.address)));
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
        const current =
          this.sessions.get(item.address.sessionId) ??
          this.histories.get(item.address.sessionId);
        return (
          !current || addressKey(current.address) !== addressKey(item.address)
        );
      }),
      recoveryError: this.recovery.error,
    };
  }
  getRecovery(address: SessionAddress): RuntimeRecoveryState {
    const history = this.histories.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address))
      return this.recoveryState([]);
    return this.recoveryState([this.current(address)]);
  }
  async readRecovery(address: SessionAddress): Promise<RuntimeRecoveryState> {
    const history = this.histories.get(address.sessionId);
    if (history && addressKey(history.address) === addressKey(address)) {
      const trusted = await isProjectTrusted(history.cwd);
      if (this.histories.get(address.sessionId) !== history)
        throw new Error("STALE_SESSION_ADDRESS");
      return this.recoveryState([], trusted ? [history] : []);
    }
    return this.getRecovery(address);
  }
  runtimeState(): RuntimeViewState {
    const sessions = [...this.sessions.values()].filter((m) => !m.resuming);
    const histories = [...this.histories.values()];
    return {
      ...this.recoveryState(sessions),
      sessions: [
        ...sessions.map((m) => ({
          phase: m.phase,
          address: { ...m.address },
          openId: m.openId,
          snapshot: m.projector ? this.snapshot(m) : undefined,
        })),
        ...histories.map((history) => ({
          phase: "ready" as const,
          address: { ...history.address },
          openId: history.openId,
          suspended: {
            previous: history.previous,
            snapshotSeq: history.seq,
            historyRevision: history.revision,
            draftRevision: history.draftRevision,
          },
        })),
        ...[...this.failedHistory.values()].map((history) => ({
          phase: "closing" as const,
          address: { ...history.address },
          snapshot: history.snapshot,
        })),
      ],
      pendingUI: this.broker.pending(),
      drafts: [...sessions, ...histories].map((m) => ({
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
    clearInterval(this.idleTimer);
    this.idleTimer = undefined;
    this.histories.clear();
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
