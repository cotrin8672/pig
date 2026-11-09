import type { SessionFlags } from "../shared/desktop-state";
import type { Notice, SessionInfo } from "../shared/rpc-schema";
import { hasUnreadCompletion } from "./session-status";

type ReadingState = {
  active?: string;
  page: string;
  opening: boolean;
  modelPending: boolean;
  pendingUI?: { sessionId: string }[];
  snapshots: Record<
    string,
    { info: SessionInfo; transcript: { running: boolean } }
  >;
};

export function isInlineResultVisible(
  element: { isConnected: boolean; getClientRects(): { length: number } },
  visible: boolean,
  focused: boolean,
) {
  return (
    visible &&
    focused &&
    element.isConnected &&
    element.getClientRects().length > 0
  );
}

export function visibleChat(
  state: ReadingState,
  visible: boolean,
  focused: boolean,
) {
  if (
    !visible ||
    !focused ||
    state.page !== "chat" ||
    state.opening ||
    !state.active ||
    state.pendingUI?.some((request) => request.sessionId === state.active) ||
    state.modelPending
  )
    return;
  const snapshot = state.snapshots[state.active];
  if (snapshot) return { id: state.active, cwd: snapshot.info.cwd };
}

export function isViewedCompletion(
  notice: Notice,
  state: ReadingState,
  visible: boolean,
  focused: boolean,
) {
  if (
    notice.kind !== "completion" ||
    notice.level !== "success" ||
    !notice.session
  )
    return false;
  const chat = visibleChat(state, visible, focused);
  return chat?.id === notice.session.id && chat.cwd === notice.session.cwd;
}

export function isViewedNotice(
  notice: Notice,
  state: ReadingState,
  visible: boolean,
  focused: boolean,
) {
  if (notice.kind === "package")
    return (
      notice.level === "success" &&
      state.page === "extensions" &&
      visible &&
      focused
    );
  return isViewedCompletion(notice, state, visible, focused);
}

export function visibleCompletion(
  state: ReadingState & {
    bootstrap: { desktop: { sessions: Record<string, SessionFlags> } };
  },
  visible: boolean,
  focused: boolean,
) {
  const chat = visibleChat(state, visible, focused);
  if (!chat) return;
  const snapshot = state.snapshots[chat.id];
  const flags = state.bootstrap.desktop.sessions[chat.id];
  if (
    snapshot.transcript.running ||
    !flags?.completion ||
    !hasUnreadCompletion(flags)
  )
    return;
  return { ...chat, completionId: flags.completion.id };
}
