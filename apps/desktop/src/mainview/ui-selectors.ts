import { projectLabel } from "../shared/projects";
import type { SessionInfo } from "../shared/rpc-schema";
import { addressKey, sameAddress } from "./chat-snapshot";
import { navigationRevision } from "./navigation";
import {
  hasUnreadCompletion,
  interruptedSession,
  sessionStatus,
} from "./session-status";
import type { useStore } from "./store";

type State = ReturnType<typeof useStore.getState>;

/** Metadata only: a pane's winbar must not subscribe to streaming bodies. */
export function selectPaneHeading(s: State, paneId: number) {
  const pane = s.panes[paneId];
  const opening = pane?.openId ? s.pendingOpens[pane.openId] : undefined;
  const sessionId = pane?.sessionId ?? opening?.id;
  const snapshot = sessionId ? s.snapshots[sessionId] : undefined;
  const cwd = snapshot?.info.cwd ?? opening?.cwd;
  const listed =
    !snapshot && cwd
      ? s.sessions[cwd]?.find((session) => session.id === sessionId)
      : undefined;
  return {
    project: cwd
      ? projectLabel(cwd, s.bootstrap.desktop.projects?.[cwd])
      : undefined,
    general: !cwd || cwd === s.bootstrap.generalCwd,
    title: snapshot
      ? (s.extensionStatuses[addressKey(snapshot.address)]?.title ??
        snapshot.info.title)
      : listed?.title,
  };
}

/** Full snapshots belong to the conversation, not the window/sidebar subscription. */
export function selectConversationView(s: State) {
  const openingView = s.opening && s.openingViewRevision === navigationRevision;
  const active =
    s.page === "chat" && !openingView && s.active
      ? s.snapshots[s.active]
      : undefined;
  const opening =
    s.page === "chat" && openingView && s.openingTarget?.id
      ? s.snapshots[s.openingTarget.id]
      : undefined;
  return {
    openingView,
    activeSnapshot: active,
    openingSnapshot: opening,
    generalCwd: s.bootstrap.generalCwd,
  };
}

export function selectAppView(s: State) {
  const { openingView, activeSnapshot, openingSnapshot } =
    selectConversationView(s);
  const displayed = openingView ? openingSnapshot : activeSnapshot;
  return {
    initialized: s.initialized,
    sidebarReady: s.initialized || s.cachedSidebar,
    page: s.page,
    language: s.settings.language,
    // Seed previews update CSS independently, never re-render the conversation.
    windowOpacity: s.appearance.opacity[s.appearance.backdrop],
    connected: s.bootstrap.models.length > 0,
    showChatHeader:
      s.initialized && s.page === "chat" && !!(openingView || displayed),
    chatCwd: displayed?.info.cwd ?? s.openingTarget?.cwd,
    chatTitle: displayed
      ? (s.extensionStatuses[addressKey(displayed.address)]?.title ??
        displayed.info.title)
      : s.openingTarget?.id
        ? s.sessions[s.openingTarget.cwd]?.find(
            (session) => session.id === s.openingTarget?.id,
          )?.title
        : undefined,
    openingExistingChat: !!s.openingTarget?.id,
    maximized: s.maximized,
    login: s.login,
  };
}

export function selectBrokerView(s: State) {
  return {
    navigationRevision,
    pendingUI: s.pendingUI,
    terminals: s.terminals,
    page: s.page,
    active: s.active,
    opening: s.opening,
    openingAddress: s.openingAddress,
    openingViewRevision: s.openingViewRevision,
  };
}

const preview = { ready: false as const };
export function selectRequestPreviews(s: State) {
  return Object.fromEntries(
    s.pendingUI
      .filter((request) => s.snapshots[request.sessionId]?.ready === false)
      .map((request) => [request.sessionId, preview]),
  );
}

/**
 * Live rows for one project as flat primitives, so streaming tokens (which never
 * change a title or entry time) leave the selection shallow-equal.
 */
export function selectLiveSessions(s: State, cwd: string) {
  const rows: (string | number)[] = [];
  for (const snapshot of Object.values(s.snapshots))
    if (snapshot.info.cwd === cwd && snapshot.ready !== false)
      rows.push(snapshot.info.id, snapshot.info.title, snapshot.info.modified);
  return rows;
}

/**
 * The persisted list lags behind the host: an open chat's title and entry time
 * come from its live snapshot, and a new chat appears once the host owns it.
 */
export function mergeLiveSessions(
  cwd: string,
  listed: SessionInfo[] | undefined,
  live: (string | number)[],
  deleting: Record<string, true>,
) {
  const rows = new Map((listed ?? []).map((session) => [session.id, session]));
  for (let index = 0; index < live.length; index += 3) {
    const id = live[index] as string;
    const known = rows.get(id);
    rows.set(id, {
      id,
      cwd,
      title: live[index + 1] as string,
      modified: Math.max(known?.modified ?? 0, live[index + 2] as number),
    });
  }
  return [...rows.values()].filter((session) => !deleting[session.id]);
}

/** New chats still starting in this project: [openId, title, sessionId]. */
export function selectStartingChats(s: State, cwd: string, untitled: string) {
  const rows: string[] = [];
  for (const [openId, open] of Object.entries(s.pendingOpens)) {
    if (open.cwd !== cwd || open.id || open.deferred) continue;
    const first = open.queued?.find((op) => op.kind === "send");
    const text =
      first?.kind === "send" ? first.content.text.trim().split("\n")[0] : "";
    rows.push(openId, text || untitled, open.address?.sessionId ?? "");
  }
  return rows;
}

export function selectSessionStatus(s: State, id: string) {
  return sessionStatus(
    !!s.snapshots[id]?.transcript.running,
    s.pendingUI.some((request) => {
      const owner = s.addresses[id] ?? s.snapshots[id]?.address;
      return (
        request.sessionId === id &&
        (!s.hostId || request.hostId === s.hostId) &&
        (!owner || sameAddress(owner, request))
      );
    }),
    s.bootstrap.desktop.sessions[id],
    !!s.snapshots[id] && interruptedSession(s.snapshots[id]) === "failed",
  );
}

export function selectProjectActivity(s: State, cwd: string) {
  return (s.sessions[cwd] ?? []).flatMap((session) =>
    s.bootstrap.desktop.sessions[session.id]?.archived
      ? []
      : [
          selectSessionStatus(s, session.id),
          hasUnreadCompletion(s.bootstrap.desktop.sessions[session.id]),
        ],
  );
}
