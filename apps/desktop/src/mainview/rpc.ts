import { Electroview } from "electrobun/view";
import {
  legacyUiPreferences,
  type UiPreferences,
} from "../shared/desktop-state";
import type { Appearance, RPCSchema, Snapshot } from "../shared/rpc-schema";
import {
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
import { sameAddress } from "./chat-snapshot";
import { drafts } from "./draft-store";
import { navigate, navigationRevision } from "./navigation";
import { OpenController } from "./open-controller";
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
import { SendController } from "./send-controller";
import { visibleCompletion } from "./session-read";
import { receivePackageOp, showError, showNotice, useStore } from "./store";

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
    requests: {},
    messages: {
      packageOp: receivePackageOp,
      installed: (installed) => useStore.setState({ installed }),
      runtimeEvent: (event) => {
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
        receiveRuntime(event);
        if (
          event.type === "ready" ||
          event.type === "replaced" ||
          event.type === "closed" ||
          (event.type === "snapshot" && !event.snapshot.transcript.running)
        )
          void refreshSessions().catch(showError);
      },
      extensionUIEvent: receiveExtension,
      terminalEvent: receiveTerminal,
      sessionEvent: receiveWire,
      appearance: receiveAppearance,
      settings: receiveSettings,
      windowState: ({ maximized }) => useStore.setState({ maximized }),
      appearanceError: ({ message }) => showError(message),
      projects: (projects) => {
        useStore.setState((s) => ({ bootstrap: { ...s.bootstrap, projects } }));
        void refresh().catch(showError);
      },
      error: ({ message }) => showError(message),
      notification: showNotice,
      desktopState: (desktop) => {
        useStore.setState((s) => ({
          bootstrap: {
            ...s.bootstrap,
            desktop: { ...s.bootstrap.desktop, sessions: desktop.sessions },
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
          useStore.setState({ login: undefined });
          void refresh().catch(showError);
        }
      },
    },
  },
});
new Electroview({ rpc });
let sessionsRevision = 0;
export async function refreshSessions() {
  const revision = ++sessionsRevision;
  const { projects, generalCwd } = useStore.getState().bootstrap;
  const entries = await Promise.all(
    [...new Set([generalCwd, ...projects].filter(Boolean))].map(
      async (cwd) => [cwd, await rpc.request.listSessions({ cwd })] as const,
    ),
  );
  if (revision === sessionsRevision)
    useStore.setState({ sessions: Object.fromEntries(entries) });
}
export async function refresh() {
  const before = useStore.getState();
  const bootstrap = await rpc.request.bootstrap();
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
  useStore.setState((s) => ({
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
  try {
    const beforeAppearance = useStore.getState().appearance;
    const appearance = await rpc.request.appearance();
    if (
      !appearanceInFlight &&
      !appearancePending &&
      useStore.getState().appearance === beforeAppearance
    )
      useStore.setState({ appearance });
    const beforeSettings = useStore.getState().settings;
    const settings = await rpc.request.settings();
    if (
      !settingsInFlight &&
      !settingsPending &&
      useStore.getState().settings === beforeSettings
    )
      useStore.setState({ settings });
  } catch (error) {
    showError(error);
  }
  await refreshSessions();
}
export const sends = new SendController(drafts, {
  syncDraft: (params) => rpc.request.syncDraft(params),
  prompt: (params) => rpc.request.prompt(params),
  getPromptReceipt: (params) => rpc.request.getPromptReceipt(params),
});
subscribeOwnership((previous, next) => sends.transfer(previous, next));
const clientId = crypto.randomUUID();
let rootConnection: Promise<void> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatInFlight = false;
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void rpc.request
      .heartbeatUI({ clientId })
      .then(({ connected }) => {
        if (!connected) {
          rootConnection = undefined;
          void connectRuntime().catch(showError);
        }
      })
      .catch(() => {
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
    rootConnection = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const revision = runtimeRevision;
        const state = await rpc.request.runtimeState();
        if (receiveRuntimeState(state, revision)) return;
      }
    })().catch((error) => {
      rootConnection = undefined;
      throw error;
    });
  }
  return rootConnection;
}
export function initRuntimeConnection() {
  void connectRuntime().catch(showError);
  const disconnect = () => {
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
export async function cancelOpening() {
  const openId = useStore.getState().openId;
  if (!openId) return;
  const cancellation = opens.cancel(openId);
  useStore.setState({
    opening: false,
    openingAddress: undefined,
    openMessage: undefined,
    openId: undefined,
  });
  await cancellation;
}
export async function openChat(
  cwd: string,
  id?: string,
  push = true,
): Promise<Snapshot | undefined> {
  const current = id ? useStore.getState().snapshots[id] : undefined;
  if (current && current.info.cwd === cwd && liveAddress(current.address)) {
    if (push) navigate("chat", current.info.id);
    else useStore.setState({ active: current.info.id });
    return current;
  }
  const openId = crypto.randomUUID();
  return openSnapshot(
    () =>
      opens.open({ openId, cwd, id }, (openMessage) => {
        if (useStore.getState().openId === openId)
          useStore.setState({ openMessage });
      }),
    push,
    openId,
  );
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
  if (!address || !liveAddress(address))
    throw new Error("Session is no longer open");
  return address;
}
export function forkChat(sessionId: string, entryId: string) {
  const previous = currentAddress(sessionId);
  return openSnapshot(async () => {
    const snapshot = await rpc.request.forkSession({ ...previous, entryId });
    receiveRuntime({ type: "replaced", previous, snapshot });
    return snapshot;
  });
}
/** Rewind by exact persisted entry identity; timestamps are never identities. */
export async function regenerate(
  sessionId: string,
  user: Extract<Message, { role: "user" }>,
  entryId: string,
) {
  const previous = currentAddress(sessionId);
  const snapshot = await rpc.request.rewindSession({
    ...previous,
    entryId,
  });
  if (!liveAddress(snapshot.address))
    throw new Error("The rewind response belongs to a replaced session");
  receiveRuntime({ type: "replaced", previous, snapshot });
  navigate("chat", snapshot.info.id);
  const blocks =
    typeof user.content === "string"
      ? [{ type: "text" as const, text: user.content }]
      : user.content;
  drafts.edit(snapshot.address, () => ({
    text: blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n"),
    pastes: [],
    images: blocks
      .filter((b) => b.type === "image")
      .map((image) => ({ id: crypto.randomUUID(), image })),
  }));
  await sends.send(snapshot.address);
}
async function openSnapshot(
  load: () => Promise<Snapshot | undefined>,
  push = true,
  openId = crypto.randomUUID(),
): Promise<Snapshot | undefined> {
  if (push && useStore.getState().opening) return;
  const revision = navigationRevision;
  useStore.setState({
    opening: true,
    openId,
    openMessage: undefined,
    openingAddress: undefined,
  });
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
    receiveSnapshot(snapshot);
    if (revision === navigationRevision) {
      useStore.setState({ active: snapshot.info.id });
      if (push) navigate("chat", snapshot.info.id);
    }
    await refreshSessions();
    return useStore.getState().snapshots[snapshot.info.id];
  } catch (error) {
    if (!opens.isCancelled(openId)) showError(error);
  } finally {
    if (useStore.getState().openId === openId)
      useStore.setState({
        opening: false,
        openId: undefined,
        openingAddress: undefined,
        openMessage: undefined,
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
    const target = visibleCompletion(
      useStore.getState(),
      document.visibilityState === "visible",
      document.hasFocus(),
    );
    if (!target || attempted.get(target.id) === target.completionId) return;
    attempted.set(target.id, target.completionId);
    // The pushed desktopState is authoritative; an older RPC reply must not overwrite it.
    void rpc.request.markSessionRead(target).catch(showError);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  const onFocus = () => {
    attempted.clear();
    schedule();
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
    rootConnection = undefined;
    reconnecting = connectRuntime().finally(() => {
      reconnecting = undefined;
    });
  }
  return reconnecting;
}
