import { navigate } from "./navigation";
import {
  adjacentPane,
  paneGeometry,
  removePane,
  type SplitAxis,
  splitPane,
} from "./pane-layout";
import { openChat, showPendingOpen } from "./rpc";
import { useStore } from "./store";

let nextPaneId = 1;
function focusEditor(id: number) {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    if (useStore.getState().activePane === id)
      document
        .querySelector<HTMLElement>(`[data-pane-id="${id}"] textarea`)
        ?.focus({ preventScroll: true });
  });
}
export function focusPane(id: number) {
  const state = useStore.getState();
  const pane = state.panes[id];
  if (!pane || (state.activePane === id && state.page === "chat")) return;
  useStore.setState({ activePane: id });
  if (pane.openId && state.pendingOpens[pane.openId])
    showPendingOpen(pane.openId);
  else navigate("chat", pane.sessionId ?? null);
}

export function createPane(axis: SplitAxis) {
  const state = useStore.getState();
  if (
    state.page !== "chat" ||
    !state.initialized ||
    Object.values(state.panes).some(
      (pane) => pane.openId && state.pendingOpens[pane.openId],
    )
  )
    return;
  const cwd =
    (state.active && state.snapshots[state.active]?.info.cwd) ||
    state.bootstrap.generalCwd;
  if (!cwd) return;
  const id = Math.max(nextPaneId, ...Object.keys(state.panes).map(Number)) + 1;
  nextPaneId = id;
  useStore.setState({
    paneTree: splitPane(state.paneTree, state.activePane, id, axis),
    panes: { ...state.panes, [id]: {} },
    activePane: id,
  });
  void openChat(cwd).then((snapshot) => {
    if (!snapshot) closePane(id);
  });
  focusEditor(id);
}

export function closePane(id = useStore.getState().activePane) {
  const state = useStore.getState();
  if (
    state.page !== "chat" ||
    !state.panes[id] ||
    Object.keys(state.panes).length === 1
  )
    return;
  const paneTree = removePane(state.paneTree, id);
  if (!paneTree) return;
  const panes = { ...state.panes };
  delete panes[id];
  useStore.setState({ paneTree, panes });
  if (state.activePane === id) {
    const next = paneGeometry(paneTree).panes[0].id;
    focusPane(next);
    focusEditor(next);
  }
}

export function movePaneFocus(direction: "left" | "right" | "up" | "down") {
  const state = useStore.getState();
  if (state.page !== "chat") return;
  const next = adjacentPane(state.paneTree, state.activePane, direction);
  if (next !== undefined) {
    focusPane(next);
    focusEditor(next);
  }
}
