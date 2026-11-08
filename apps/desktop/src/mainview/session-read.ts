import type { SessionFlags } from "../shared/desktop-state";
import type { SessionInfo } from "../shared/rpc-schema";
import { hasUnreadCompletion } from "./session-status";

export function visibleCompletion(
  state: {
    active?: string;
    page: string;
    opening: boolean;
    modelPending: boolean;
    bootstrap: { desktop: { sessions: Record<string, SessionFlags> } };
    snapshots: Record<
      string,
      { info: SessionInfo; transcript: { running: boolean } }
    >;
  },
  visible: boolean,
  focused: boolean,
) {
  if (
    !visible ||
    !focused ||
    state.page !== "chat" ||
    state.opening ||
    !state.active ||
    state.modelPending
  )
    return;
  const snapshot = state.snapshots[state.active];
  const flags = state.bootstrap.desktop.sessions[state.active];
  if (
    !snapshot ||
    snapshot.transcript.running ||
    !flags?.completion ||
    !hasUnreadCompletion(flags)
  )
    return;
  return {
    cwd: snapshot.info.cwd,
    id: state.active,
    completionId: flags.completion.id,
  };
}
