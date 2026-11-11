import type { SessionInfo } from "../shared/rpc-schema";
import { addressKey, sameAddress } from "./chat-snapshot";
import { navigationRevision } from "./navigation";
import { hasUnreadCompletion, sessionStatus } from "./session-status";
import type { useStore } from "./store";

type State = ReturnType<typeof useStore.getState>;

export function selectAppView(s: State) {
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
    initialized: s.initialized,
    sidebarReady: s.initialized || s.cachedSidebar,
    page: s.page,
    language: s.settings.language,
    appearance: s.appearance,
    connected: s.bootstrap.models.length > 0,
    generalCwd: s.bootstrap.generalCwd,
    openingView,
    openingTarget: s.openingTarget,
    activeSnapshot: active,
    openingSnapshot: opening,
    activeTitle:
      active && s.extensionStatuses[addressKey(active.address)]?.title,
    openingTitle:
      opening && s.extensionStatuses[addressKey(opening.address)]?.title,
    // Known from the list before the chat's history has loaded.
    openingListedTitle: s.openingTarget?.id
      ? s.sessions[s.openingTarget.cwd]?.find(
          (session) => session.id === s.openingTarget?.id,
        )?.title
      : undefined,
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
    if (open.cwd !== cwd || open.id) continue;
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
