import type { SessionFlags } from "../shared/desktop-state";
import type { ExtensionDialogRequest, SessionInfo } from "../shared/rpc-schema";
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
    dialogs: Record<string, ExtensionDialogRequest[]>;
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
    state.dialogs[state.active]?.length ||
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

// Keep events received during a request instead of resurrecting an answered question.
export function mergeDialogSnapshot(
  before: Record<string, ExtensionDialogRequest[]>,
  current: Record<string, ExtensionDialogRequest[]>,
  incoming: ExtensionDialogRequest[],
): Record<string, ExtensionDialogRequest[]> {
  const next: Record<string, ExtensionDialogRequest[]> = {};
  for (const request of incoming) {
    next[request.sessionId] ??= [];
    next[request.sessionId].push(request);
  }
  for (const id of new Set([...Object.keys(before), ...Object.keys(current)])) {
    if (before[id] !== current[id]) next[id] = current[id] ?? [];
  }
  return next;
}
