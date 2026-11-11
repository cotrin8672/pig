import { Electroview } from "electrobun/view";
import {
  legacyUiPreferences,
  type UiPreferences,
} from "../shared/desktop-state";
import { isModelEnabled } from "../shared/models";
import type {
  Appearance,
  ModelSelection,
  RPCSchema,
  Snapshot,
} from "../shared/rpc-schema";
import {
  type RuntimeRecoveryState,
  type SessionAddress,
  UI_HEARTBEAT_INTERVAL_MS,
} from "../shared/runtime-contract";
import { sessionIdFromLink } from "../shared/session-links";
import {
  patchSettings,
  type Settings,
  type SettingsPatch,
} from "../shared/settings";
import type { Message } from "../shared/transcript";
import { transferEditorView } from "./ComposerEditor";
import { addressKey, sameAddress } from "./chat-snapshot";
import { drafts } from "./draft-store";
import { getT } from "./i18n";
import { navigate, navigationRevision } from "./navigation";
import { OpenController } from "./open-controller";
import { mergeOpeningText } from "./opening-draft";
import {
  openingDraftKey,
  restoreOpeningSends,
  takeOpeningOps,
} from "./opening-sends";
import {
  liveAddress,
  receiveExtension,
  receiveRuntime,
  receiveRuntimeState,
  receiveSnapshot,
  receiveTerminal,
  receiveWire,
  runtimeRevision,
  subscribeOwnership,
} from "./runtime-events";
import { changeSelection, selections } from "./selections";
import { SendController } from "./send-controller";
import { lane } from "./session-lane";
import { visibleCompletion } from "./session-read";
import {
  readViewedNotices,
  receivePackageOp,
  showError,
  showNotice,
  useStore,
} from "./store";
import {
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
export const rpc = Electroview.defineRPC<RPCSchema>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {
      flushDrafts: async () => {
        await drafts.flushAll((params) => rpc.request.syncDraft(params));
      },
    },
    messages: {
      packageOp: receivePackageOp,
      installed: (installed) =>
        useStore.setState({ installed, installedLoaded: true }),
      runtimeEvent: (event) => {
        if (event.type === "closed" && event.discardDraft) {
          receiveRuntime(event);
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
          event.type === "replaced" ? event.previous : address;
        const previousCwd =
          before.snapshots[previousAddress.sessionId]?.info.cwd ??
          (event.type === "closed"
            ? Object.keys(before.sessions).find((cwd) =>
                before.sessions[cwd].some(
                  (session) => session.id === address.sessionId,
                ),
              )
            : undefined);
        receiveRuntime(event);
        const current = useStore.getState().snapshots[address.sessionId];
        if (current) sends.reconcile(current);
        resumeSelectionChanges();
        if (
          event.type === "ready" ||
          event.type === "replaced" ||
          event.type === "closed" ||
          (event.type === "snapshot" && !event.snapshot.transcript.running)
        ) {
          const cwd =
            event.type === "closed" ? previousCwd : event.snapshot.info.cwd;
          void refreshSessions(cwd).catch(showError);
          if (event.type === "replaced" && previousCwd && previousCwd !== cwd)
            void refreshSessions(previousCwd).catch(showError);
        }
      },
      extensionUIEvent: receiveExtension,
      terminalEvent: receiveTerminal,
      sessionEvent: (event) => {
        receiveWire(event);
        const snapshot = useStore.getState().snapshots[event.address.sessionId];
        if (snapshot) sends.reconcile(snapshot);
      },
      appearance: receiveAppearance,
      settings: receiveSettings,
      windowState: ({ maximized }) => useStore.setState({ maximized }),
      appearanceError: ({ message }) => showError(message),
      projects: (projects) => {
        useStore.setState((s) => ({
          bootstrap: { ...s.bootstrap, projects: overlayProjects(projects) },
        }));
        // Only the project list changed; its chats are all that needs loading.
        void refreshSessions().catch(showError);
      },
      error: ({ message }) => showError(message),
      notification: showNotice,
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
        if (!login || login.loginId !== frame.loginId) return;
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
        if (frame.kind === "promptEnd")
          useStore.setState({ login: { ...login, prompt: undefined } });
        if (frame.kind === "error")
          useStore.setState({
            login: { ...login, error: frame.message, prompt: undefined },
          });
        if (frame.kind === "success" || frame.kind === "cancelled") {
          // Connected now; models arrive with the refresh below.
          if (frame.kind === "success")
            publishProvider(frame.provider, { configured: true, stored: true });
          useStore.setState({ login: undefined });
          void refresh().catch(showError);
        }
      },
    },
  },
});
new Electroview({ rpc });
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
    try {
      do {
        flight.dirty = false;
        if (!sessionCwds().has(cwd)) return;
        const before = useStore.getState().sessions[cwd];
        const sessions = await rpc.request.listSessions({ cwd });
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
      .catch(showError);
  bootstrap.disabledModels = overlayModelVisibility(bootstrap.disabledModels);
  bootstrap.projects = overlayProjects(bootstrap.projects);
  bootstrap.modelOverrides = overlayModelOverrides(bootstrap.modelOverrides);
  bootstrap.models = bootstrap.models.map(overlayDefaultEffort);
  bootstrap.desktop = overlayDesktop(bootstrap.desktop);
  useStore.setState((s) => ({
    initialized: true,
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
  await refreshSessions();
}
export const sends = new SendController(
  drafts,
  {
    syncDraft: (params) => rpc.request.syncDraft(params),
    // Issued synchronously: the host orders it against earlier selection changes.
    prompt: (params) => rpc.request.prompt(params),
    getPromptReceipt: (params) => rpc.request.getPromptReceipt(params),
    cancelPrompt: (params) => rpc.request.cancelPrompt(params),
  },
  undefined,
  undefined,
  showError,
  (address, step) => lane.enqueue(address, step),
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
    return await request();
  } catch (error) {
    const snapshot = await rpc.request.getSessionSnapshot(address);
    receiveSnapshot(snapshot);
    showError(error);
    return snapshot;
  }
}
const clientId = crypto.randomUUID();
let rootConnection: Promise<void> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatInFlight = false;
let connectionGeneration = 0;
let recoveryError: string | undefined;
function receiveRecovery(state: RuntimeRecoveryState) {
  for (const item of state.retainedDrafts ?? [])
    drafts.recover(item.address, item.draft, item.owner);
  sends.restore(state.sendIntents ?? []);
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
      .heartbeatUI({ clientId })
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
    rpc.send.connectUI({ clientId });
    startHeartbeat();
    const generation = ++connectionGeneration;
    rootConnection = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const revision = runtimeRevision;
        const state = await rpc.request.runtimeState();
        if (generation !== connectionGeneration)
          throw new Error("Runtime synchronization was superseded");
        if (receiveRuntimeState(state, revision)) {
          receiveRecovery(state);
          resumeSelectionChanges();
          return;
        }
      }
      throw new Error(getT().runtimeUnsynchronized);
    })().catch((error) => {
      if (generation === connectionGeneration) rootConnection = undefined;
      throw error;
    });
  }
  return rootConnection;
}
export function initRuntimeConnection() {
  void connectRuntime().catch(showError);
  const disconnect = () => {
    connectionGeneration++;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    rootConnection = undefined;
    rpc.send.disconnectUI({ clientId });
  };
  const reconnect = (event: PageTransitionEvent) => {
    if (event.persisted) void reconnectRuntime().catch(showError);
  };
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", reconnect);
  return () => {
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
  const cancellation = opens.cancel(openId);
  restoreOpening(openId);
  clearOpeningView(openId);
  await cancellation;
}
export async function openChat(
  cwd: string,
  id?: string,
  push = true,
): Promise<Snapshot | undefined> {
  const key = JSON.stringify([cwd, id ?? null]);
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
    else useStore.setState({ active: current.info.id });
    return current;
  }
  const openId = crypto.randomUUID();
  const promise = openSnapshot(
    () =>
      opens.open({ openId, cwd, id }, (openMessage) => {
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
/** Shows the transcript as it will be after a rewind or branch, until it lands. */
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
  // The branch keeps this chat's view; it never blanks into a loading screen.
  const settle = beginRewind(sessionId, { kind: "fork", entryId });
  try {
    await sends.wait(previous);
    await selections.flush(previous);
    await rpc.request.abort(previous);
    const snapshot = await rpc.request.forkSession({ ...previous, entryId });
    if (!liveAddress(snapshot.address))
      throw new Error("The branch response belongs to a replaced session");
    receiveRuntime({ type: "replaced", previous, snapshot });
    const state = useStore.getState();
    if (
      revision === navigationRevision &&
      state.page === "chat" &&
      state.active === snapshot.info.id
    )
      navigate("chat", snapshot.info.id);
    void refreshSessions(snapshot.info.cwd).catch(showError);
    return useStore.getState().snapshots[snapshot.info.id];
  } finally {
    settle();
  }
}
/** Rewind by exact persisted entry identity; timestamps are never identities. */
export async function regenerate(
  sessionId: string,
  user: Extract<Message, { role: "user" }>,
  entryId: string,
) {
  const previous = currentAddress(sessionId);
  // Display only: the persisted transcript changes when the rewind lands.
  const settle = beginRewind(sessionId, { kind: "resend", entryId, user });
  let sending: Promise<void> | undefined;
  try {
    await sends.wait(previous);
    await selections.flush(previous);
    await rpc.request.abort(previous);
    const snapshot = await rpc.request.rewindSession({
      ...previous,
      entryId,
    });
    if (!liveAddress(snapshot.address))
      throw new Error("The rewind response belongs to a replaced session");
    sends.discard(previous);
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
async function openSnapshot(
  load: () => Promise<Snapshot | undefined>,
  push = true,
  openId = crypto.randomUUID(),
  optimistic?: { id?: string; cwd: string },
): Promise<Snapshot | undefined> {
  const previous = useStore.getState();
  if (optimistic) {
    const { models, disabledModels } = previous.bootstrap;
    const model =
      !optimistic.id && models.find((m) => isModelEnabled(m, disabledModels));
    useStore.setState({
      pendingOpens: {
        ...previous.pendingOpens,
        [openId]: {
          ...optimistic,
          selection: optimistic.id
            ? previous.snapshots[optimistic.id]
            : model
              ? {
                  model,
                  effort: model.effectiveDefaultEffort ?? "off",
                  effortLevels: model.effortLevels ?? [],
                }
              : undefined,
        },
      },
    });
    showOpening(openId, push);
  } else {
    useStore.setState({
      opening: true,
      openId,
      openMessage: undefined,
      openingAddress: undefined,
      openingViewRevision: undefined,
      openingTarget: undefined,
    });
  }
  const revision = navigationRevision;
  let transferred: { cwd: string; text: string } | undefined;
  try {
    await connectRuntime();
    if (opens.isCancelled(openId)) return;
    const snapshot = await load();
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
        `new:${optimistic.cwd}`,
        addressKey(snapshot.address),
        merged.slice(0, merged.length - text.length),
      );
      transferred = { cwd: draftKey, text };
    }
    receiveSnapshot(snapshot);
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
    // Recovery bytes are available only after this project's Trust/startup completed.
    void Promise.resolve()
      .then(() => rpc.request.getRecovery(snapshot.address))
      .then((state) => {
        if (
          liveAddress(snapshot.address) &&
          state.hostId === snapshot.address.hostId &&
          useStore.getState().hostId === state.hostId
        )
          receiveRecovery(state);
      })
      .catch(showError);
    if (ownsOpeningView(openId, revision)) {
      useStore.setState({ active: snapshot.info.id });
      if (push && optimistic)
        history.replaceState(
          { page: "chat", sessionKey: snapshot.info.id },
          "",
        );
      else if (push) navigate("chat", snapshot.info.id);
    }
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
    restoreOpening(openId);
    clearOpeningView(openId);
    useStore.setState((state) => {
      const pendingOpens = { ...state.pendingOpens };
      delete pendingOpens[openId];
      const newChatDrafts = { ...state.newChatDrafts };
      if (transferred && newChatDrafts[transferred.cwd] === transferred.text)
        delete newChatDrafts[transferred.cwd];
      return { pendingOpens, newChatDrafts };
    });
  }
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
