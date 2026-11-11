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
