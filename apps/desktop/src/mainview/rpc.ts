import { Electroview } from "electrobun/view";
import {
  legacyUiPreferences,
  type UiPreferences,
} from "../shared/desktop-state";
import type { Appearance, RPCSchema, Snapshot } from "../shared/rpc-schema";
import { sessionIdFromLink } from "../shared/session-links";
import {
  patchSettings,
  type Settings,
  type SettingsPatch,
} from "../shared/settings";
import { type Message, reduceTranscript } from "../shared/transcript";
import { navigate, navigationRevision } from "./navigation";
import { mergeDialogSnapshot, visibleCompletion } from "./session-read";
import { receivePackageOp, showError, showNotice, useStore } from "./store";
import { receiveTerminalUI } from "./terminal-ui";

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
      packageOp: (op) => {
        receivePackageOp(op);
        // Extensions may add or remove providers; bun reloads them before "done".
        if (op.status === "done") void refresh().catch(showError);
      },
      installed: (installed) => useStore.setState({ installed }),
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
      terminalUI: receiveTerminalUI,
      desktopState: (desktop) => {
        useStore.setState((s) => ({
          bootstrap: {
            ...s.bootstrap,
            desktop: { ...s.bootstrap.desktop, sessions: desktop.sessions },
          },
        }));
      },
      extensionDialogs: ({ sessionId, requests }) => {
        useStore.setState((s) => ({
          dialogs: { ...s.dialogs, [sessionId]: requests },
        }));
      },
      agentEvent: ({ sessionId, event, contextUsage }) => {
        useStore.setState((s) => {
          const snapshot = s.snapshots[sessionId];
          if (!snapshot) return {};
          return {
            snapshots: {
              ...s.snapshots,
              [sessionId]: {
                ...snapshot,
                ...(contextUsage !== undefined ? { contextUsage } : {}),
                transcript: reduceTranscript(snapshot.transcript, event),
              },
            },
          };
        });
        if (
          event.type === "agent_settled" ||
          event.type === "session_info_changed"
        )
          void refreshSessions().catch(showError);
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
    dialogs: mergeDialogSnapshot(
      before.dialogs,
      s.dialogs,
      bootstrap.pendingDialogs ?? [],
    ),
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
export function openChat(cwd: string, path?: string, id?: string, push = true) {
  return openSnapshot(() => rpc.request.openSession({ cwd, path, id }), push);
}
export function openChatLink(url: string) {
  return openSnapshot(() => rpc.request.openSessionLink({ url }));
}
export function forkChat(sessionId: string, timestamp: number) {
  return openSnapshot(() => rpc.request.forkSession({ sessionId, timestamp }));
}
/** Drops the reply to `user` (kept as an unseen branch) and sends it again. */
export async function regenerate(
  sessionId: string,
  user: Extract<Message, { role: "user" }>,
) {
  const snapshot = await rpc.request.rewindSession({
    sessionId,
    timestamp: user.timestamp,
  });
  useStore.setState((s) => ({
    snapshots: { ...s.snapshots, [sessionId]: snapshot },
  }));
  const blocks =
    typeof user.content === "string"
      ? [{ type: "text" as const, text: user.content }]
      : user.content;
  const images = blocks.filter((b) => b.type === "image");
  await rpc.request.prompt({
    sessionId,
    text: blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n"),
    images: images.length ? images : undefined,
  });
}
async function openSnapshot(load: () => Promise<Snapshot>, push = true) {
  if (push && useStore.getState().opening) return;
  const revision = navigationRevision;
  const beforeDialogs = useStore.getState().dialogs;
  useStore.setState({ opening: true });
  try {
    const snapshot = await load();
    useStore.setState((s) => ({
      ...(revision === navigationRevision ? { active: snapshot.info.id } : {}),
      snapshots: { ...s.snapshots, [snapshot.info.id]: snapshot },
      dialogs: {
        ...s.dialogs,
        [snapshot.info.id]:
          beforeDialogs[snapshot.info.id] === s.dialogs[snapshot.info.id]
            ? (snapshot.pendingDialogs ?? [])
            : s.dialogs[snapshot.info.id],
      },
    }));
    if (push && revision === navigationRevision)
      navigate("chat", snapshot.info.id);
    await refreshSessions();
  } catch (error) {
    showError(error);
  } finally {
    useStore.setState({ opening: false });
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
