import type { ActionKeymap } from "../../../../packages/config/src";
import { accountSourceKey } from "../shared/account-models";
import {
  legacyUiPreferences,
  type UiPreferences,
} from "../shared/desktop-state";
import { isModelEnabled } from "../shared/models";
import {
  NOTICE_HISTORY_KEY,
  parseNoticeHistory,
} from "../shared/notification-history";
import type {
  Appearance,
  Bootstrap,
  ModelSelection,
  SessionInfo,
  Snapshot,
} from "../shared/rpc-schema";
import {
  type RuntimePublication,
  type RuntimeRecoveryState,
  type RuntimeUsage,
  type SessionAddress,
  UI_HEARTBEAT_INTERVAL_MS,
} from "../shared/runtime-contract";
import { sessionIdFromLink } from "../shared/session-links";
import {
  patchSettings,
  type Settings,
  type SettingsPatch,
} from "../shared/settings";
import {
  expandSnapshotDelta,
  type RuntimeWireEvent,
} from "../shared/snapshot-delta";
import type { Message } from "../shared/transcript";
import { transferEditorView } from "./ComposerEditor";
import { addressKey, sameAddress } from "./chat-snapshot";
import { attachmentReads } from "./composer-attachments";
import { createDraftImageRecovery } from "./draft-image-recovery";
import { drafts } from "./draft-store";
import { runEditMenuCommand } from "./edit-menu";
import { getT } from "./i18n";
import { navigate, navigationRevision } from "./navigation";
import { OpenController } from "./open-controller";
import { mergeOpeningText } from "./opening-draft";
import {
  openingDraftKey,
  queueOpeningSelection,
  restoreOpeningSends,
  takeOpeningOps,
} from "./opening-sends";
import { selectPaneSession } from "./pane-selection";
import { loadPaneWorkspace } from "./pane-workspace-cache";
import { createRendererRpc } from "./rpc-transport";
import {
  liveAddress,
  prepareRuntimeHost,
  receiveCoveredRuntime,
  receiveExtension,
  receiveRuntime,
  receiveRuntimeState,
  receiveSnapshot,
  receiveTerminal,
  receiveWire,
  subscribeOwnership,
} from "./runtime-events";
import { type PublicationPhase, RuntimeSync } from "./runtime-sync";
import { changeSelection, selections } from "./selections";
import { SendController } from "./send-controller";
import { lane } from "./session-lane";
import { visibleCompletion } from "./session-read";
import { createSnapshotRecovery } from "./snapshot-recovery";
import {
  connectNoticeHistory,
  type OpeningTarget,
  type PendingOpen,
  readViewedNotices,
  receiveNoticeHistory,
  receiveNoticeToast,
  receivePackageOp,
  showError,
  showNotice,
  showSessionReadError,
  useStore,
} from "./store";
import {
  defaultModelPreference,
  markRead,
  overlayDefaultEffort,
  overlayDesktop,
  overlayModelOverrides,
  overlayModelVisibility,
  overlayProjects,
  overlaySessionInfo,
  publishProvider,
  settleRead,
} from "./ui-mutations";

const recoverDraftImages = createDraftImageRecovery(
  (address) => rpc.request.getSessionDraft(address),
  (address, draft) => {
    drafts.receive(address, draft);
  },
  liveAddress,
);

const recoverSnapshots = createSnapshotRecovery(
  (address) => rpc.request.getSessionSnapshot(address),
  liveAddress,
);

const runtimeSync = new RuntimeSync();
function receivePublication<T>(
  publication: RuntimePublication<T>,
  apply: (event: T, phase: PublicationPhase) => void,
) {
  const receive = (phase: PublicationPhase) => apply(publication.event, phase);
  if (!runtimeSync.receive(publication, receive)) {
    void reconnectRuntime().catch(showError);
    runtimeSync.receive(publication, receive);
  }
}

// Root event handlers below are installed before any session-opening RPC.
let appearanceInFlight = false;
let appearancePending = false;
let appearanceTimer: ReturnType<typeof setTimeout> | undefined;
export function updateAppearance(change: (current: Appearance) => Appearance) {
  useStore.setState((s) => ({ appearance: change(s.appearance) }));
  appearancePending = true;
  clearTimeout(appearanceTimer);
  appearanceTimer = setTimeout(flushAppearance, 120);
}
function flushAppearance() {
  if (appearanceInFlight || !appearancePending) return;
  appearancePending = false;
  appearanceInFlight = true;
  rpc.send.setAppearance(useStore.getState().appearance);
}
function receiveAppearance(appearance: Appearance) {
  appearanceInFlight = false;
  if (!appearancePending) useStore.setState({ appearance });
  else flushAppearance();
}
let settingsInFlight = false;
let settingsPending = false;
export function updateSettings(patch: SettingsPatch) {
  useStore.setState((s) => ({ settings: patchSettings(s.settings, patch) }));
  settingsPending = true;
  flushSettings();
}
function flushSettings() {
  if (settingsInFlight || !settingsPending) return;
  settingsPending = false;
  settingsInFlight = true;
  rpc.send.setSettings(useStore.getState().settings);
}
function receiveActionKeymaps(actionKeymaps: ActionKeymap[]) {
  // Most users have no TS config; skip a store publication for an empty list.
  if (actionKeymaps.length || useStore.getState().actionKeymaps.length)
    useStore.setState({ actionKeymaps });
}
function receiveSettings(settings: Settings) {
  settingsInFlight = false;
  if (!settingsPending) useStore.setState({ settings });
  else flushSettings();
}
let uiPreferencesPending: UiPreferences = {};
let uiPreferencesInFlight = false;
let uiPreferencesTimer: ReturnType<typeof setTimeout> | undefined;
export function updateUiPreferences(patch: UiPreferences) {
  useStore.setState((s) => ({
    bootstrap: {
      ...s.bootstrap,
      desktop: { ...s.bootstrap.desktop, ...patch },
    },
  }));
  uiPreferencesPending = { ...uiPreferencesPending, ...patch };
  clearTimeout(uiPreferencesTimer);
  uiPreferencesTimer = setTimeout(flushUiPreferences, 120);
}
function flushUiPreferences() {
  if (uiPreferencesInFlight || !Object.keys(uiPreferencesPending).length)
    return;
  const patch = uiPreferencesPending;
  uiPreferencesPending = {};
  uiPreferencesInFlight = true;
  void rpc.request
    .setUiPreferences(patch)
    .catch(showError)
    .finally(() => {
      uiPreferencesInFlight = false;
      flushUiPreferences();
    });
}
export const rpc = createRendererRpc({
  requests: {
    flushDrafts: async () => {
      await drafts.flushAll((params) => rpc.request.syncDraft(params));
    },
  },
  messages: {
    chatHistoryFile: (event) => {
      if (useStore.getState().chatHistoryFile?.requestId !== event.requestId)
        return;
      useStore.setState({
        chatHistoryFile: event.preview || event.error ? event : undefined,
      });
      if (event.error) showError(event.error);
    },
    chatsImported: ({ cwd }) => {
      void refreshSessions(cwd).catch(showError);
    },
    appUpdate: (appUpdate) => useStore.setState({ appUpdate }),
    packageOp: (op) => receivePackageOp(op, false),
    installed: (installed) =>
      useStore.setState({ installed, installedLoaded: true }),
    runtimeEvent: (publication) => {
      function handleRuntimeEvent(
        event: RuntimeWireEvent,
        phase: PublicationPhase = "live",
      ) {
        if (phase === "covered") {
          if (event.type !== "snapshotDelta") receiveCoveredRuntime(event);
          if (event.type === "closed" && event.discardDraft) {
            drafts.discard(event.address, true);
            sends.discard(event.address);
          }
          return;
        }
        if (event.type === "snapshotDelta") {
          const address = event.snapshot.address;
          if (
            useStore.getState().hostId &&
            useStore.getState().hostId !== address.hostId
          ) {
            void reconnectRuntime().catch(showError);
            return;
          }
          if (!liveAddress(address)) return;
          const current = useStore.getState().snapshots[address.sessionId];
          if (
            current &&
            sameAddress(current.address, address) &&
            current.snapshotSeq >= event.snapshot.snapshotSeq
          )
            return;
          const snapshot = expandSnapshotDelta(event, current);
          if (!snapshot) {
            // The full read supplies this base; do not launch a redundant recovery.
            if (phase === "before-state") return;
            void recoverSnapshots(
              address,
              event.snapshot.snapshotSeq,
              (value) =>
                handleRuntimeEvent({ type: "snapshot", snapshot: value }),
            ).catch((error) => {
              if (liveAddress(address)) showSessionReadError(error);
            });
            return;
          }
          event = { type: "snapshot", snapshot };
        }
        if (event.type === "closed" && event.discardDraft) {
          receiveRuntime(event, false);
          drafts.discard(event.address, true);
          sends.discard(event.address);
          return;
        }
        const address =
          event.type === "ready" ||
          event.type === "snapshot" ||
          event.type === "replaced"
            ? event.snapshot.address
            : event.address;
        if (
          useStore.getState().hostId &&
          useStore.getState().hostId !== address.hostId
        ) {
          void reconnectRuntime().catch(showError);
          return;
        }
        const before = useStore.getState();
        const previousAddress =
          event.type === "replaced" || event.type === "suspended"
            ? event.previous
            : address;
        const previousCwd =
          before.snapshots[previousAddress.sessionId]?.info.cwd ??
          (event.type === "closed"
            ? Object.keys(before.sessions).find((cwd) =>
                before.sessions[cwd].some(
                  (session) => session.id === address.sessionId,
                ),
              )
            : undefined);
        receiveRuntime(event, false);
        const current = useStore.getState().snapshots[address.sessionId];
        if (
          event.type === "suspended" &&
          current?.transcript.history?.revision !== event.historyRevision &&
          Object.values(useStore.getState().panes).some(
            (pane) => pane.sessionId === address.sessionId,
          )
        ) {
          void recoverSnapshots(address, event.snapshotSeq, (snapshot) =>
            handleRuntimeEvent({ type: "snapshot", snapshot }),
          ).catch((error) => {
            if (liveAddress(address)) showSessionReadError(error);
          });
        }
        if (current) sends.reconcile(current);
        resumeSelectionChanges();
        if (
          event.type === "ready" ||
          event.type === "replaced" ||
          event.type === "closed" ||
          (event.type === "snapshot" &&
            current &&
            current !== before.snapshots[address.sessionId] &&
            (!before.snapshots[address.sessionId] ||
              (before.snapshots[address.sessionId].transcript.running &&
                !current.transcript.running) ||
              before.snapshots[address.sessionId].info.cwd !==
                current.info.cwd ||
              before.snapshots[address.sessionId].info.title !==
                current.info.title ||
              before.snapshots[address.sessionId].info.modified !==
                current.info.modified))
        ) {
          const cwd =
            event.type === "closed" ? previousCwd : event.snapshot.info.cwd;
          void refreshSessions(cwd).catch(showError);
          if (event.type === "replaced" && previousCwd && previousCwd !== cwd)
            void refreshSessions(previousCwd).catch(showError);
        }
      }
      receivePublication(publication, handleRuntimeEvent);
    },
    extensionUIEvent: (publication) =>
      receivePublication(publication, (event, phase) => {
        if (
          phase === "covered" &&
          event.type !== "notify" &&
          event.type !== "capability"
        )
          return;
        if (
          phase === "covered" &&
          !useStore.getState().addresses[
            (event.type === "request" ? event.request : event.address).sessionId
          ]
        )
          return;
        if (!receiveExtension(event) && event.type === "draft")
          void recoverDraftImages(event.address, event.draft.revision).catch(
            (error) => {
              if (liveAddress(event.address)) showSessionReadError(error);
            },
          );
      }),
    terminalEvent: (publication) =>
      receivePublication(publication, receiveTerminal),
    promptAdmitted: (admission) => sends.receiveAdmission(admission),
    sessionEvent: (event) => {
      receiveWire(event);
      const snapshot = useStore.getState().snapshots[event.address.sessionId];
      if (snapshot) sends.reconcile(snapshot);
    },
    appearance: receiveAppearance,
    settings: receiveSettings,
    actionKeymaps: receiveActionKeymaps,
    providerUsage: (providerUsage) => useStore.setState({ providerUsage }),
    windowState: ({ maximized }) => useStore.setState({ maximized }),
    editMenuCommand: runEditMenuCommand,
    projects: (projects) => {
      useStore.setState((s) => ({
        bootstrap: { ...s.bootstrap, projects: overlayProjects(projects) },
      }));
      // Only the project list changed; its chats are all that needs loading.
      void refreshSessions().catch(showError);
    },
    notification: receiveNoticeToast,
    noticeHistory: receiveNoticeHistory,
    desktopState: (desktop) => {
      useStore.setState((s) => ({
        bootstrap: {
          ...s.bootstrap,
          desktop: overlayDesktop({
            ...s.bootstrap.desktop,
            sessions: desktop.sessions,
          }),
        },
      }));
    },
    agentEvent: ({ event, contextUsage }) => {
      receiveWire(event);
      if (contextUsage !== undefined)
        useStore.setState((s) => {
          const snapshot = s.snapshots[event.address.sessionId];
          if (
            !snapshot ||
            !sameAddress(snapshot.address, event.address) ||
            snapshot.snapshotSeq !== event.snapshotSeq
          )
            return {};
          return {
            snapshots: {
              ...s.snapshots,
              [event.address.sessionId]: { ...snapshot, contextUsage },
            },
          };
        });
    },
    loginFrame: (frame) => {
      const login = useStore.getState().login;
      if (!login || login.loginId !== frame.loginId) {
        // Closing a dialog after the credential commit cannot undo that commit.
        if (frame.kind === "success") void refresh().catch(showError);
        return;
      }
      if (frame.kind === "event")
        useStore.setState({
          login: {
            ...login,
            event: frame.event,
            ...(frame.event.type === "auth_url"
              ? { authUrl: frame.event }
              : {}),
            ...(frame.event.type === "device_code"
              ? { deviceCode: frame.event }
              : {}),
          },
        });
      if (frame.kind === "prompt")
        useStore.setState({ login: { ...login, prompt: frame.prompt } });
      if (frame.kind === "browser")
        useStore.setState({
          login: { ...login, browserOpened: frame.opened },
        });
      if (frame.kind === "promptEnd")
        useStore.setState({ login: { ...login, prompt: undefined } });
      if (frame.kind === "error")
        useStore.setState({
          login: { ...login, error: frame.message, prompt: undefined },
        });
      if (frame.kind === "success" || frame.kind === "cancelled") {
        // Connected now; models arrive with the refresh below.
        if (frame.kind === "success" && !frame.accountId)
          publishProvider(frame.provider, { configured: true, stored: true });
        if (frame.kind === "success" && login.addAccount && frame.accountId)
          useStore.setState({
            providerSelection: {
              provider: frame.provider,
              accountId: frame.accountId,
            },
          });
        useStore.setState({ login: undefined });
        void refresh().catch(showError);
      }
    },
  },
});
export function initNoticeHistory() {
  let legacy: ReturnType<typeof parseNoticeHistory> | undefined;
  try {
    legacy = parseNoticeHistory(localStorage.getItem(NOTICE_HISTORY_KEY));
  } catch (error) {
    console.warn("Cannot read legacy notification history:", error);
  }
  void connectNoticeHistory(
    (input) => rpc.request.noticeHistory(input),
    legacy,
  ).catch((error) => console.error("Cannot load notification history:", error));
}
const sessionRefreshes = new Map<
  string,
  { dirty: boolean; promise: Promise<void> }
>();
function sessionCwds() {
  const { projects, generalCwd } = useStore.getState().bootstrap;
  return new Set([generalCwd, ...projects].filter(Boolean));
}
function refreshProjectSessions(cwd: string): Promise<void> {
  const current = sessionRefreshes.get(cwd);
  if (current) {
    current.dirty = true;
    return current.promise;
  }
  const flight = { dirty: false, promise: Promise.resolve() };
  sessionRefreshes.set(cwd, flight);
  flight.promise = Promise.resolve().then(async () => {
    let retriedTimeout = false;
    try {
      do {
        flight.dirty = false;
        if (!sessionCwds().has(cwd)) return;
        const before = useStore.getState().sessions[cwd];
        let sessions: SessionInfo[];
        try {
          sessions = await rpc.request.listSessions({ cwd });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/timed out|timeout/i.test(error.message)
          )
            throw error;
          // Keep rendering the last known list if the host is still unavailable.
          if (retriedTimeout) return;
          retriedTimeout = true;
          flight.dirty = true;
          continue;
        }
        retriedTimeout = false;
        if (!sessionCwds().has(cwd)) return;
        if (useStore.getState().sessions[cwd] !== before) flight.dirty = true;
        if (!flight.dirty)
          useStore.setState((s) => ({
            sessions: {
              ...s.sessions,
              [cwd]: sessions.map(overlaySessionInfo),
            },
          }));
      } while (flight.dirty);
    } finally {
      sessionRefreshes.delete(cwd);
    }
  });
  return flight.promise;
}
export async function refreshSessions(cwd?: string) {
  const cwds = sessionCwds();
  if (Object.keys(useStore.getState().sessions).some((key) => !cwds.has(key)))
    useStore.setState((s) => ({
      sessions: Object.fromEntries(
        Object.entries(s.sessions).filter(([key]) => cwds.has(key)),
      ),
    }));
  await Promise.all(
    (cwd === undefined ? [...cwds] : cwds.has(cwd) ? [cwd] : []).map(
      refreshProjectSessions,
    ),
  );
}
export async function refresh() {
  const before = useStore.getState();
  const [bootstrap, appearance, settings] = await Promise.all([
    rpc.request.bootstrap(),
    rpc.request.appearance(),
    rpc.request.settings(),
  ]);
  // Not awaited: the TS config may still be building and must not delay startup.
  void rpc.request.actionKeymaps().then(receiveActionKeymaps).catch(showError);
  if (bootstrap.desktop) {
    try {
      const patch = legacyUiPreferences(
        bootstrap.desktop,
        localStorage.getItem("pig.chat-width"),
        localStorage.getItem("pig.recent-models"),
      );
      if (Object.keys(patch).length) {
        await rpc.request.setUiPreferences(patch);
        bootstrap.desktop = { ...bootstrap.desktop, ...patch };
      }
    } catch (error) {
      showError(error);
    }
  } else bootstrap.desktop = { sessions: {} };
  if (uiPreferencesInFlight || Object.keys(uiPreferencesPending).length) {
    const current = useStore.getState().bootstrap.desktop;
    bootstrap.desktop = {
      ...bootstrap.desktop,
      chatWidth: current.chatWidth,
      sidebarWidth: current.sidebarWidth,
      recentModels: current.recentModels,
    };
  }
  const activeAddress =
    before.active && before.snapshots[before.active]?.address;
  if (
    activeAddress &&
    before.snapshots[activeAddress.sessionId]?.ready !== false
  )
    void rpc.request
      .getSessionSnapshot(activeAddress)
      .then(receiveSnapshot)
      .catch(showSessionReadError);
  bootstrap.disabledModels = overlayModelVisibility(bootstrap.disabledModels);
  bootstrap.projects = overlayProjects(bootstrap.projects);
  bootstrap.modelOverrides = overlayModelOverrides(bootstrap.modelOverrides);
  bootstrap.models = bootstrap.models.map(overlayDefaultEffort);
  const desiredDefault = defaultModelPreference.value("default");
  if (desiredDefault !== undefined) bootstrap.defaultModel = desiredDefault;
  bootstrap.desktop = overlayDesktop(bootstrap.desktop);
  const workspace = useStore.getState().initialized
    ? undefined
    : loadPaneWorkspace();
  useStore.setState((s) => ({
    initialized: true,
    ...(workspace ? preparePaneRestore(workspace, bootstrap) : {}),
    ...(!appearanceInFlight &&
    !appearancePending &&
    s.appearance === before.appearance
      ? { appearance }
      : {}),
    ...(!settingsInFlight && !settingsPending && s.settings === before.settings
      ? { settings }
      : {}),
    bootstrap: {
      ...bootstrap,
      desktop: {
        ...bootstrap.desktop,
        sessions:
          before.bootstrap.desktop.sessions === s.bootstrap.desktop.sessions
            ? bootstrap.desktop.sessions
            : s.bootstrap.desktop.sessions,
      },
    },
  }));
  // Check package updates without delaying startup or overwriting newer events.
  const previousInstalled = useStore.getState().installed;
  void rpc.request
    .listInstalled()
    .then((installed) =>
      useStore.setState((s) =>
        s.installed === previousInstalled
          ? { installed, installedLoaded: true }
          : {},
      ),
    )
    .catch(console.warn);
  try {
    await refreshSessions();
  } finally {
    if (workspace) void restorePaneChats(workspace).catch(showSessionReadError);
  }
}
export const sends = new SendController(
  drafts,
  {
    prepareSession: (address) =>
      useStore.getState().snapshots[address.sessionId]?.suspended
        ? ensureSessionRuntime(address)
        : undefined,
    syncDraft: (params) => rpc.request.syncDraft(params),
    // Issued synchronously: the host orders it against earlier selection changes.
    prompt: (params) => rpc.request.prompt(params),
    getPromptReceipt: (params) => rpc.request.getPromptReceipt(params),
    cancelPrompt: (params) => rpc.request.cancelPrompt(params),
    reorderPrompts: (params) => rpc.request.reorderQueuedPrompts(params),
    steerPrompt: (params) => rpc.request.steerQueuedPrompt(params),
    acknowledgeRecovery: (params) =>
      rpc.request.acknowledgePromptRecovery(params),
  },
  undefined,
  undefined,
  showError,
  (address, step) => lane.enqueue(address, step),
  (kind) =>
    showNotice({
      level: "warning",
      message:
        kind === "restored" ? getT().steeringRestored : getT().sendUnconfirmed,
    }),
  (address) => {
    const current = useStore.getState().addresses[address.sessionId];
    return !!current && sameAddress(current, address) && liveAddress(address);
  },
);
const selectionTransfers = new Map<
  string,
  { address: SessionAddress; desired: ModelSelection }
>();
subscribeOwnership((previous, next) => {
  lane.move(previous, next);
  sends.transfer(previous, next);
  const desired =
    selections.take(previous) ??
    selectionTransfers.get(addressKey(previous))?.desired;
  selectionTransfers.delete(addressKey(previous));
  if (desired)
    selectionTransfers.set(addressKey(next), { address: next, desired });
});
function resumeSelectionChanges() {
  for (const [key, { address, desired }] of selectionTransfers) {
    const snapshot = useStore.getState().snapshots[address.sessionId];
    if (
      !snapshot ||
      snapshot.ready === false ||
      snapshot.suspended ||
      !sameAddress(snapshot.address, address)
    )
      continue;
    selectionTransfers.delete(key);
    const model = desired.model;
    if (model)
      void changeSelection(address, desired, () =>
        requestSelection(address, () => applySelection(address, desired)),
      );
  }
}
async function applySelection(
  address: SessionAddress,
  desired: ModelSelection,
) {
  const model = desired.model;
  if (!model) throw new Error("No model selected");
  const selected = await rpc.request.setModel({
    ...address,
    provider: model.provider,
    id: model.id,
    accountId: desired.accountId ?? null,
  });
  return selected.effort === desired.effort ||
    !selected.effortLevels.includes(desired.effort)
    ? selected
    : rpc.request.setEffort({ ...address, effort: desired.effort });
}
export async function requestSelection(
  address: SessionAddress,
  request: () => Promise<ModelSelection>,
) {
  try {
    if (useStore.getState().snapshots[address.sessionId]?.suspended)
      await ensureSessionRuntime(address);
    return await request();
  } catch (error) {
    const snapshot = await rpc.request.getSessionSnapshot(address);
    await settleRuntimeRead();
    receiveSnapshot(snapshot);
    showError(error);
    return snapshot;
  }
}
const clientId = crypto.randomUUID();
let usageSequence = 0;
let usageSignature = "";
let lastUsage: RuntimeUsage = { sequence: 0, protected: [] };
function runtimeUsage(): RuntimeUsage {
  const state = useStore.getState();
  const owners = [
    ...Object.values(state.panes).flatMap((pane) => {
      const address = pane.sessionId && state.addresses[pane.sessionId];
      return address ? [address] : [];
    }),
    ...Object.values(state.pendingOpens).flatMap((open) => {
      const address = open.address ?? (open.id && state.addresses[open.id]);
      return address ? [address] : [];
    }),
    ...drafts.protectedAddresses(),
    ...sends.protectedAddresses(),
    ...attachmentReads.protectedAddresses(),
  ];
  const unique = new Map(
    owners.map((address) => [addressKey(address), address]),
  );
  const signature = [...unique.keys()].sort().join("\n");
  if (signature !== usageSignature) {
    usageSignature = signature;
    lastUsage = { sequence: ++usageSequence, protected: [...unique.values()] };
  }
  return lastUsage;
}
function publishUsage() {
  if (rootConnection)
    rpc.send.runtimeUsage?.({ clientId, usage: runtimeUsage() });
}
const wakes = new Map<string, Promise<void>>();
/** Startup precedes CAS: a failure cannot reserve or dispatch this input. */
export function ensureSessionRuntime(address: SessionAddress): Promise<void> {
  const current = useStore.getState().snapshots[address.sessionId];
  if (!current?.suspended) return Promise.resolve();
  const key = addressKey(address);
  const pending = wakes.get(key);
  if (pending) return pending;
  const task = rpc.request
    .wakeSession(address)
    .then(async (snapshot) => {
      await settleRuntimeRead();
      if (!sameAddress(snapshot.address, address) || !liveAddress(address))
        throw new Error(
          "Session changed before sending; your input is retained.",
        );
      receiveSnapshot(snapshot);
      receiveRecovery(await rpc.request.getRecovery(address));
    })
    .finally(() => {
      if (wakes.get(key) === task) wakes.delete(key);
    });
  wakes.set(key, task);
  return task;
}
let rootConnection: Promise<void> | undefined;
// RPC action replies must not install new owners ahead of an older state read.
async function settleRuntimeRead() {
  for (let read = rootConnection; read; read = rootConnection) {
    await read;
    if (read === rootConnection) return;
  }
}
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatInFlight = false;
let connectionGeneration = 0;
let recoveryError: string | undefined;
function receiveRecovery(state: RuntimeRecoveryState) {
  for (const item of state.retainedDrafts ?? [])
    drafts.recover(item.address, item.draft, item.owner);
  sends.restore(state.sendIntents ?? []);
  for (const snapshot of Object.values(useStore.getState().snapshots))
    sends.reconcile(snapshot);
  if (state.recoveryError && state.recoveryError !== recoveryError)
    showNotice({ level: "error", message: state.recoveryError });
  recoveryError = state.recoveryError;
}
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void rpc.request
      .heartbeatUI({ clientId, usage: runtimeUsage() })
      .then(({ connected }) => {
        if (!connected || !rootConnection) {
          if (!connected) rootConnection = undefined;
          void connectRuntime().catch(showError);
        }
      })
      .catch(() => {
        rootConnection = undefined;
        /* Host lease fails closed; never resend prompts here. */
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, UI_HEARTBEAT_INTERVAL_MS);
}
export function connectRuntime() {
  if (!rootConnection) {
    runtimeSync.begin();
    rpc.send.connectUI({ clientId, usage: runtimeUsage() });
    startHeartbeat();
    const generation = ++connectionGeneration;
    rootConnection = (async () => {
      for (;;) {
        const state = await rpc.request.runtimeState();
        if (generation !== connectionGeneration)
          throw new Error("Runtime synchronization was superseded");
        prepareRuntimeHost(state.hostId);
        const foreign = runtimeSync.finish(state, () => {
          receiveRuntimeState(state);
          receiveRecovery(state);
        });
        resumeSelectionChanges();
        if (!foreign.length) {
          const viewed = new Set(
            Object.values(useStore.getState().panes).map(
              (pane) => pane.sessionId,
            ),
          );
          await Promise.all(
            state.sessions
              .filter((session) => {
                const shown =
                  useStore.getState().snapshots[session.address.sessionId];
                return (
                  session.suspended &&
                  viewed.has(session.address.sessionId) &&
                  (!shown ||
                    shown.transcript.history?.revision !==
                      session.suspended.historyRevision)
                );
              })
              .map(async (session) => {
                try {
                  const snapshot = await rpc.request.getSessionSnapshot(
                    session.address,
                  );
                  if (
                    generation === connectionGeneration &&
                    liveAddress(session.address)
                  )
                    receiveSnapshot(snapshot);
                } catch (error) {
                  if (
                    generation === connectionGeneration &&
                    useStore.getState().snapshots[session.address.sessionId]
                      ?.suspended
                  )
                    showSessionReadError(error);
                }
                return undefined;
              }),
          );
          publishUsage();
          return;
        }
        // Only an actual host change needs another read, never ordinary activity.
        runtimeSync.begin();
        for (const event of foreign) runtimeSync.receive(event, event.apply);
      }
    })().catch((error) => {
      if (generation === connectionGeneration) {
        rootConnection = undefined;
        runtimeSync.cancel();
      }
      throw error;
    });
  }
  return rootConnection;
}
export function initRuntimeConnection() {
  void connectRuntime().catch(showError);
  const unsubscribe = [
    useStore.subscribe((state, previous) => {
      if (
        state.panes !== previous.panes ||
        state.addresses !== previous.addresses ||
        state.pendingOpens !== previous.pendingOpens
      )
        publishUsage();
    }),
    drafts.subscribe(publishUsage),
    sends.subscribe(publishUsage),
    attachmentReads.subscribe(publishUsage),
  ];
  const disconnect = () => {
    connectionGeneration++;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    rootConnection = undefined;
    runtimeSync.cancel();
    rpc.send.disconnectUI({ clientId });
  };
  const reconnect = (event: PageTransitionEvent) => {
    if (event.persisted) void reconnectRuntime().catch(showError);
  };
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", reconnect);
  return () => {
    for (const stop of unsubscribe) stop();
    window.removeEventListener("pagehide", disconnect);
    window.removeEventListener("pageshow", reconnect);
    disconnect();
  };
}
const opens = new OpenController({
  openSession: (params) => rpc.request.openSession(params),
  getOpenState: (params) => rpc.request.getOpenState(params),
  cancelOpen: (params) => rpc.request.cancelOpen(params),
});
const pendingChats = new Map<
  string,
  { openId: string; promise: Promise<Snapshot | undefined> }
>();
const openingReturns = new Map<
  string,
  {
    revision: number;
    page: ReturnType<typeof useStore.getState>["page"];
    active?: string;
    pendingId?: string;
  }
>();
function clearOpeningView(openId?: string) {
  if (openId && useStore.getState().openId !== openId) return;
  useStore.setState({
    opening: false,
    openingAddress: undefined,
    openMessage: undefined,
    openingViewRevision: undefined,
    openingTarget: undefined,
    openId: undefined,
  });
}
function showOpening(openId: string, push: boolean) {
  const previous = useStore.getState();
  const pending = previous.pendingOpens[openId];
  if (!pending) return;
  if (
    previous.openId === openId &&
    previous.page === "chat" &&
    previous.openingViewRevision === navigationRevision
  )
    return;
  const pendingId =
    previous.openingViewRevision === navigationRevision
      ? previous.openId
      : undefined;
  useStore.setState(selectPaneSession(previous, pending.id, openId));
  if (push) navigate("chat", pending.id ?? null);
  if (push)
    openingReturns.set(openId, {
      revision: navigationRevision,
      page: previous.page,
      active: previous.active,
      pendingId,
    });
  else {
    const saved = openingReturns.get(openId);
    if (saved) saved.revision = navigationRevision;
  }
  useStore.setState({
    page: "chat",
    active: pending.id,
    opening: true,
    openId,
    openingTarget: pending,
    openingAddress: pending.address,
    openMessage: pending.message,
    openingViewRevision: navigationRevision,
    ...selectPaneSession(useStore.getState(), pending.id, openId),
  });
}
/** Selects a chat that is still starting, e.g. from its placeholder row. */
export function showPendingOpen(openId: string) {
  if (!opens.isCancelled(openId)) showOpening(openId, true);
}
function ownsOpeningView(openId: string, revision: number) {
  const state = useStore.getState();
  return (
    state.openId === openId &&
    (state.openingViewRevision ?? revision) === navigationRevision
  );
}
function restoreOpening(openId: string) {
  const previous = openingReturns.get(openId);
  openingReturns.delete(openId);
  if (
    !previous ||
    previous.revision !== navigationRevision ||
    useStore.getState().openId !== openId
  )
    return;
  clearOpeningView(openId);
  history.replaceState(
    { page: previous.page, sessionKey: previous.active },
    "",
  );
  useStore.setState({ page: previous.page, active: previous.active });
  if (
    previous.pendingId &&
    useStore.getState().pendingOpens[previous.pendingId] &&
    !opens.isCancelled(previous.pendingId)
  )
    showOpening(previous.pendingId, false);
}
export async function cancelOpening(openId = useStore.getState().openId) {
  if (!openId) return;
  if (useStore.getState().pendingOpens[openId]?.deferred) {
    restoreOpening(openId);
    clearOpeningView(openId);
    useStore.setState((state) => {
      const pendingOpens = { ...state.pendingOpens };
      delete pendingOpens[openId];
      return { pendingOpens };
    });
    return;
  }
  const cancellation = opens.cancel(openId);
  restoreOpening(openId);
  clearOpeningView(openId);
  await cancellation;
}
export async function openChat(
  cwd: string,
  id?: string,
  push = true,
  selection?: ModelSelection,
): Promise<Snapshot | undefined> {
  if (!id) {
    const state = useStore.getState();
    const paneOpenId = state.panes[state.activePane]?.openId;
    const target = paneOpenId && state.pendingOpens[paneOpenId];
    if (target && !target.id && target.cwd === cwd) {
      if (selection) queueOpeningSelection(paneOpenId, selection);
      showOpening(paneOpenId, push);
      return;
    }
    const [openId, local] = createLocalChat(cwd, selection);
    useStore.setState({
      pendingOpens: {
        ...state.pendingOpens,
        [openId]: local,
      },
    });
    showOpening(openId, push);
    return;
  }
  const key = JSON.stringify([cwd, id]);
  const pending =
    pendingChats.get(key) ??
    (id
      ? [...pendingChats.values()].find((item) => {
          const target = useStore.getState().pendingOpens[item.openId];
          return target?.cwd === cwd && target.address?.sessionId === id;
        })
      : undefined);
  if (pending && !opens.isCancelled(pending.openId)) {
    showOpening(pending.openId, push);
    return pending.promise;
  }
  const current = id ? useStore.getState().snapshots[id] : undefined;
  if (
    current &&
    current.ready !== false &&
    current.info.cwd === cwd &&
    liveAddress(current.address)
  ) {
    clearOpeningView();
    if (push) navigate("chat", current.info.id);
    else
      useStore.setState((state) => ({
        active: current.info.id,
        ...selectPaneSession(state, current.info.id),
      }));
    if (current.suspended) {
      try {
        const snapshot = await rpc.request.getSessionSnapshot(current.address);
        await settleRuntimeRead();
        receiveSnapshot(snapshot);
        return useStore.getState().snapshots[id];
      } catch (error) {
        showSessionReadError(error);
      }
    }
    return current;
  }
  const openId = crypto.randomUUID();
  const promise = openSnapshot(
    () =>
      opens.open({ openId, cwd, id, historyOnly: true }, (openMessage) => {
        useStore.setState((state) => {
          const pending = state.pendingOpens[openId];
          return {
            ...(state.openId === openId ? { openMessage } : {}),
            ...(pending
              ? {
                  pendingOpens: {
                    ...state.pendingOpens,
                    [openId]: { ...pending, message: openMessage },
                  },
                }
              : {}),
          };
        });
      }),
    push,
    openId,
    { id, cwd },
  );
  pendingChats.set(key, { openId, promise });
  const settled = () => {
    if (pendingChats.get(key)?.openId === openId) pendingChats.delete(key);
  };
  void promise.then(settled, settled);
  return promise;
}
export async function openChatLink(url: string) {
  const id = sessionIdFromLink(url);
  if (!id) {
    showError("Invalid session link");
    return;
  }
  // Resolve only configured workspace membership, then use the SAME cancellable
  // openId path as every sidebar open. A link never creates a lookalike session.
  try {
    await refreshSessions();
    const target = Object.values(useStore.getState().sessions)
      .flat()
      .find((session) => session.id === id);
    if (!target)
      throw new Error(
        "This session is not in the configured workspaces. Add its project before opening the link.",
      );
    return openChat(target.cwd, target.id);
  } catch (error) {
    showError(error);
  }
}
function currentAddress(sessionId: string): SessionAddress {
  const address = useStore.getState().snapshots[sessionId]?.address;
  if (
    !address ||
    useStore.getState().snapshots[sessionId]?.ready === false ||
    !liveAddress(address)
  )
    throw new Error("Session is no longer open");
  return address;
}
type Rewind = ReturnType<typeof useStore.getState>["rewinds"][string];
/** Shows the transcript as it will be after a rewind, until it lands. */
function beginRewind(sessionId: string, rewind: Rewind) {
  if (useStore.getState().rewinds[sessionId])
    throw new Error("This chat is already changing");
  useStore.setState((s) => ({
    rewinds: { ...s.rewinds, [sessionId]: rewind },
  }));
  return () =>
    useStore.setState((s) => {
      const rewinds = { ...s.rewinds };
      delete rewinds[sessionId];
      return { rewinds };
    });
}
export async function forkChat(sessionId: string, entryId: string) {
  const previous = currentAddress(sessionId);
  const revision = navigationRevision;
  const snapshot = await rpc.request.forkSession({ ...previous, entryId });
  await settleRuntimeRead();
  if (!liveAddress(snapshot.address))
    throw new Error("The branch response belongs to a replaced session");
  receiveSnapshot(snapshot);
  const state = useStore.getState();
  if (
    revision === navigationRevision &&
    state.page === "chat" &&
    state.active === sessionId
  )
    navigate("chat", snapshot.info.id);
  void refreshSessions(snapshot.info.cwd).catch(showError);
  return useStore.getState().snapshots[snapshot.info.id];
}
/** Rewind by exact persisted entry identity; timestamps are never identities. */
export async function regenerate(
  sessionId: string,
  user: Extract<Message, { role: "user" }>,
  entryId: string,
) {
  const previous = currentAddress(sessionId);
  if (useStore.getState().snapshots[sessionId]?.suspended)
    await ensureSessionRuntime(previous);
  // Display only: the persisted transcript changes when the rewind lands.
  const settle = beginRewind(sessionId, { entryId, user });
  let sending: Promise<void> | undefined;
  try {
    await sends.stop(previous, () => rpc.request.abort(previous));
    await selections.flush(previous);
    const snapshot = await rpc.request.rewindSession({
      ...previous,
      entryId,
    });
    await settleRuntimeRead();
    if (!liveAddress(snapshot.address))
      throw new Error("The rewind response belongs to a replaced session");
    sends.retire(previous);
    receiveRuntime({ type: "replaced", previous, snapshot });
    const state = useStore.getState();
    if (state.page === "chat" && state.active === sessionId)
      navigate("chat", snapshot.info.id);
    const blocks =
      typeof user.content === "string"
        ? [{ type: "text" as const, text: user.content }]
        : user.content;
    // The optimistic send takes over from the placeholder without a gap.
    sending = sends.send(snapshot.address, {
      text: blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
      pastes: [],
      images: blocks
        .filter((b) => b.type === "image")
        .map((image) => ({ id: crypto.randomUUID(), image })),
    });
  } finally {
    settle();
  }
  await sending;
}
function createLocalChat(
  cwd: string,
  selection = newChatSelection(),
): [string, PendingOpen] {
  const openId = crypto.randomUUID();
  return [
    openId,
    {
      cwd,
      draftId: openId,
      deferred: true,
      selection,
      queued: selection
        ? [{ id: crypto.randomUUID(), kind: "select", selection }]
        : undefined,
    },
  ];
}

type SavedPaneWorkspace = NonNullable<ReturnType<typeof loadPaneWorkspace>>;

function preparePaneRestore(
  workspace: SavedPaneWorkspace,
  bootstrap: Bootstrap,
) {
  const pendingOpens = { ...useStore.getState().pendingOpens };
  const restoringChats = new Set<string>();
  const panes = Object.fromEntries(
    Object.entries(workspace.panes).map(([id, pane]) => {
      if (pane.sessionId) {
        restoringChats.add(pane.sessionId);
        return [id, pane];
      }
      const [openId, target] = createLocalChat(
        bootstrap.generalCwd,
        newChatSelection(bootstrap),
      );
      pendingOpens[openId] = target;
      return [id, { openId }];
    }),
  );
  return {
    ...workspace,
    panes,
    pendingOpens,
    restoringChats,
    active: workspace.panes[workspace.activePane].sessionId,
  };
}

async function restorePaneChats({ panes }: SavedPaneWorkspace) {
  const listed = Object.values(useStore.getState().sessions).flat();
  await Promise.all(
    Object.entries(panes).map(async ([key, { sessionId }]) => {
      const paneId = Number(key);
      if (!sessionId) return;
      const session = listed.find(({ id }) => id === sessionId);
      let loaded = false;
      try {
        if (
          session &&
          useStore.getState().panes[paneId]?.sessionId === sessionId
        ) {
          await connectRuntime();
          if (useStore.getState().panes[paneId]?.sessionId !== sessionId)
            return;
          const snapshot = await rpc.request.openSession({
            openId: crypto.randomUUID(),
            cwd: session.cwd,
            id: sessionId,
            historyOnly: true,
          });
          await settleRuntimeRead();
          if (snapshot.info.id === sessionId && liveAddress(snapshot.address)) {
            receiveSnapshot(snapshot);
            readOpeningRecovery(snapshot.address);
            loaded = true;
          }
        }
      } catch (error) {
        if (useStore.getState().panes[paneId]?.sessionId === sessionId)
          showSessionReadError(error);
      } finally {
        useStore.setState((state) => {
          const restoringChats = new Set(state.restoringChats);
          restoringChats.delete(sessionId);
          const pane = state.panes[paneId];
          // A delayed restore must not reopen a closed pane or replace a newer choice.
          if (loaded || pane?.sessionId !== sessionId || pane.openId)
            return { restoringChats };
          const [openId, target] = createLocalChat(state.bootstrap.generalCwd);
          return {
            restoringChats,
            panes: { ...state.panes, [paneId]: { openId } },
            pendingOpens: { ...state.pendingOpens, [openId]: target },
            ...(state.activePane === paneId && state.active === sessionId
              ? { active: undefined }
              : {}),
          };
        });
      }
    }),
  );
}

function newChatSelection(
  bootstrap = useStore.getState().bootstrap,
): ModelSelection | undefined {
  const { models, disabledModels, defaultModel, accountCatalogs } = bootstrap;
  const available = models.filter(
    (model) =>
      (!accountCatalogs ||
        accountCatalogs[accountSourceKey(model.provider)]?.some(
          (entry) => entry.id === model.id,
        )) &&
      isModelEnabled(model, disabledModels),
  );
  const model =
    available.find(
      (m) => m.provider === defaultModel?.provider && m.id === defaultModel.id,
    ) ?? available[0];
  return model
    ? {
        model,
        effort: model.effectiveDefaultEffort ?? "off",
        effortLevels: model.effortLevels ?? [],
      }
    : undefined;
}

/** The first submit promotes a local editor to an SDK session, exactly once. */
export function startOpeningChat(openId: string) {
  const state = useStore.getState();
  const target = state.pendingOpens[openId];
  if (!target?.deferred) return;
  useStore.setState({
    pendingOpens: {
      ...state.pendingOpens,
      [openId]: { ...target, deferred: false },
    },
  });
  const promise = openSnapshot(
    () =>
      opens.open({ openId, cwd: target.cwd }, (message) => {
        useStore.setState((state) => {
          const pending = state.pendingOpens[openId];
          return pending
            ? {
                pendingOpens: {
                  ...state.pendingOpens,
                  [openId]: { ...pending, message },
                },
                ...(state.openId === openId ? { openMessage: message } : {}),
              }
            : {};
        });
      }),
    true,
    openId,
    target,
  );
  const key = `draft:${target.draftId}`;
  pendingChats.set(key, { openId, promise });
  const settled = () => {
    if (pendingChats.get(key)?.openId === openId) pendingChats.delete(key);
  };
  void promise.then(settled, settled);
  return promise;
}

async function openSnapshot(
  load: () => Promise<Snapshot | undefined>,
  push = true,
  openId: string = crypto.randomUUID(),
  optimistic?: OpeningTarget,
): Promise<Snapshot | undefined> {
  const previous = useStore.getState();
  if (optimistic && !optimistic.draftId) {
    useStore.setState({
      pendingOpens: {
        ...previous.pendingOpens,
        [openId]: {
          ...optimistic,
          selection: optimistic.id
            ? previous.snapshots[optimistic.id]
            : undefined,
        },
      },
    });
    showOpening(openId, push);
  } else if (!optimistic) {
    useStore.setState({
      opening: true,
      openId,
      openMessage: undefined,
      openingAddress: undefined,
      openingViewRevision: undefined,
      openingTarget: undefined,
      ...selectPaneSession(useStore.getState(), undefined, openId),
    });
  }
  const revision = navigationRevision;
  let transferred: { cwd: string; text: string } | undefined;
  let completed = false;
  try {
    await connectRuntime();
    if (opens.isCancelled(openId)) return;
    const snapshot = await load();
    await settleRuntimeRead();
    if (
      !snapshot ||
      opens.isCancelled(openId) ||
      !liveAddress(snapshot.address)
    )
      return;
    if (optimistic) {
      const draftKey = openingDraftKey(optimistic);
      const text = useStore.getState().newChatDrafts[draftKey] ?? "";
      if (text)
        drafts.edit(snapshot.address, (content) =>
          mergeOpeningText(content, text),
        );
      const merged = drafts.read(snapshot.address).content.text;
      transferEditorView(
        `new:${optimistic.draftId ?? optimistic.cwd}`,
        addressKey(snapshot.address),
        merged.slice(0, merged.length - text.length),
      );
      transferred = { cwd: draftKey, text };
    }
    receiveSnapshot(snapshot);
    useStore.setState((state) => ({
      panes: Object.fromEntries(
        Object.entries(state.panes).map(([id, pane]) => [
          id,
          pane.openId === openId
            ? { sessionId: snapshot.info.id, openId }
            : pane,
        ]),
      ),
    }));
    // Each call enqueues synchronously, so the session lane keeps click order.
    for (const op of takeOpeningOps(openId)) {
      if (op.kind === "select") {
        const desired = op.selection;
        if (desired.model)
          void changeSelection(snapshot.address, desired, () =>
            requestSelection(snapshot.address, () =>
              applySelection(snapshot.address, desired),
            ),
          );
      } else
        void sends
          .send(snapshot.address, op.content, undefined, op.delivery)
          .catch((error) => {
            drafts.restoreSent(snapshot.address, op.content);
            showError(error);
          });
    }
    readOpeningRecovery(snapshot.address);
    if (ownsOpeningView(openId, revision)) {
      useStore.setState({ active: snapshot.info.id });
      if (push && optimistic)
        history.replaceState(
          { page: "chat", sessionKey: snapshot.info.id },
          "",
        );
      else if (push) navigate("chat", snapshot.info.id);
    }
    completed = true;
    openingReturns.delete(openId);
    void refreshSessions(snapshot.info.cwd).catch(showError);
    return useStore.getState().snapshots[snapshot.info.id];
  } catch (error) {
    if (!opens.isCancelled(openId)) {
      showError(error);
      const preview = optimistic?.id
        ? useStore.getState().snapshots[optimistic.id]
        : undefined;
      if (preview?.ready === false && ownsOpeningView(openId, revision)) {
        openingReturns.delete(openId);
        useStore.setState({ active: preview.info.id });
      }
    }
  } finally {
    restoreOpeningSends(openId);
    if (optimistic?.draftId && !completed && !opens.isCancelled(openId)) {
      // Keep the editor and restored text on failure, allowing an explicit retry.
      openingReturns.delete(openId);
      useStore.setState((state) => {
        const pending = state.pendingOpens[openId];
        if (!pending) return {};
        const next = {
          ...pending,
          deferred: true,
          address: undefined,
          message: undefined,
        };
        const retryId = crypto.randomUUID();
        const pendingOpens = { ...state.pendingOpens, [retryId]: next };
        delete pendingOpens[openId];
        return {
          pendingOpens,
          panes: Object.fromEntries(
            Object.entries(state.panes).map(([id, pane]) => [
              id,
              pane.openId === openId ? { openId: retryId } : pane,
            ]),
          ),
          ...(state.openId === openId
            ? { openId: retryId, openingTarget: next, openMessage: undefined }
            : {}),
        };
      });
    } else {
      restoreOpening(openId);
      clearOpeningView(openId);
      useStore.setState((state) => {
        const pendingOpens = { ...state.pendingOpens };
        delete pendingOpens[openId];
        const newChatDrafts = { ...state.newChatDrafts };
        if (transferred && newChatDrafts[transferred.cwd] === transferred.text)
          delete newChatDrafts[transferred.cwd];
        return {
          pendingOpens,
          newChatDrafts,
          panes: Object.fromEntries(
            Object.entries(state.panes).map(([id, pane]) => [
              id,
              pane.openId === openId ? { sessionId: pane.sessionId } : pane,
            ]),
          ),
        };
      });
    }
  }
}

function readOpeningRecovery(address: SessionAddress) {
  // Recovery bytes are available only after this project's Trust/startup completed.
  void Promise.resolve()
    .then(() => rpc.request.getRecovery(address))
    .then((state) => {
      if (
        liveAddress(address) &&
        state.hostId === address.hostId &&
        useStore.getState().hostId === state.hostId
      )
        receiveRecovery(state);
    })
    .catch(showSessionReadError);
}

export function initSessionLinks() {
  const paste = (event: ClipboardEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest(
        "input, textarea, [contenteditable]:not([contenteditable='false'])",
      )
    )
      return;
    const url = event.clipboardData?.getData("text/plain").trim();
    if (!url || !sessionIdFromLink(url)) return;
    event.preventDefault();
    void openChatLink(url);
  };
  window.addEventListener("paste", paste);
  return () => window.removeEventListener("paste", paste);
}

export function initSessionReadTracking() {
  let frame = 0;
  const attempted = new Map<string, string>();
  const check = () => {
    frame = 0;
    readViewedNotices(
      document.visibilityState === "visible",
      document.hasFocus(),
    );
    const target = visibleCompletion(
      useStore.getState(),
      document.visibilityState === "visible",
      document.hasFocus(),
    );
    if (!target || attempted.get(target.id) === target.completionId) return;
    attempted.set(target.id, target.completionId);
    // Clear the dot now. The pushed desktopState is authoritative; an older RPC
    // reply must not overwrite it, and a refused mark reloads the real state.
    markRead(target.id, target.completionId);
    void rpc.request.markSessionRead(target).catch((error) => {
      settleRead(target.id, target.completionId);
      showError(error);
      void refresh().catch(showError);
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  const onFocus = () => {
    attempted.clear();
    schedule();
    if (document.visibilityState === "visible" && document.hasFocus())
      void refreshSessions().catch(showError);
  };
  const unsubscribe = useStore.subscribe(schedule);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  schedule();
  return () => {
    unsubscribe();
    cancelAnimationFrame(frame);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}

let reconnecting: Promise<void> | undefined;
export function reconnectRuntime() {
  if (!reconnecting) {
    connectionGeneration++;
    rootConnection = undefined;
    reconnecting = connectRuntime().finally(() => {
      reconnecting = undefined;
    });
  }
  return reconnecting;
}
