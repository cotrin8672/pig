type PaneSelection = {
  activePane: number;
  panes: Record<number, { sessionId?: string; openId?: string }>;
};
export function selectPaneSession(
  state: PaneSelection,
  sessionId?: string,
  openId?: string,
) {
  const existing = Object.entries(state.panes).find(
    ([, pane]) =>
      (sessionId && pane.sessionId === sessionId) ||
      (openId && pane.openId === openId),
  );
  const activePane = existing ? Number(existing[0]) : state.activePane;
  return {
    activePane,
    panes: { ...state.panes, [activePane]: { sessionId, openId } },
  };
}
