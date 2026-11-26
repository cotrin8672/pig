import { selectPaneSession } from "./pane-selection";
import { useStore } from "./store";

type Page = ReturnType<typeof useStore.getState>["page"];
export interface HistoryEntry {
  page: Page;
  sessionKey?: string;
}
export function historyEntry(value: unknown): HistoryEntry {
  if (!value || typeof value !== "object") return { page: "chat" };
  const entry = value as HistoryEntry;
  if (
    ![
      "chat",
      "providers",
      "extensions",
      "settings",
      "statistics",
      "pairing",
      "remoteChat",
    ].includes(entry.page)
  )
    return { page: "chat" };
  return {
    page: entry.page,
    ...(typeof entry.sessionKey === "string"
      ? { sessionKey: entry.sessionKey }
      : {}),
  };
}
export let navigationRevision = 0;

/** Chats each pane showed before (back) and after (forward) its current one. */
type PaneHistory = { back: string[]; forward: string[]; expect?: string };
const paneHistories = new Map<number, PaneHistory>();
const paneHistory = (id: number) => {
  const entry = paneHistories.get(id) ?? { back: [], forward: [] };
  paneHistories.set(id, entry);
  return entry;
};

/** Records every change of a pane's chat, whichever path opened it. */
export function trackPaneHistory() {
  return useStore.subscribe((state, previous) => {
    if (state.panes === previous.panes) return;
    for (const id of Object.keys(previous.panes))
      if (!state.panes[Number(id)]) paneHistories.delete(Number(id));
    for (const [key, pane] of Object.entries(state.panes)) {
      const before = previous.panes[Number(key)]?.sessionId;
      const after = pane.sessionId;
      if (before === after) continue;
      const entry = paneHistory(Number(key));
      if (entry.expect !== undefined) {
        // Our own back/forward: ignore the opening step and the arrival.
        if (after === undefined) continue;
        const arrived = after === entry.expect;
        entry.expect = undefined;
        if (arrived) continue;
      }
      if (before) entry.back.push(before);
      entry.forward.length = 0;
    }
  });
}

/** Back/forward within one pane's chats; other pages use the window history. */
export function goPane(
  direction: "back" | "forward",
  id = useStore.getState().activePane,
  open = async (cwd: string, sessionId: string) => {
    const revision = navigationRevision;
    const { openChat } = await import("./rpc");
    // A later navigation wins over a slow module load.
    if (revision === navigationRevision) await openChat(cwd, sessionId, false);
  },
) {
  const state = useStore.getState();
  if (state.page !== "chat") {
    if (direction === "back") history.back();
    else history.forward();
    return;
  }
  const pane = state.panes[id];
  const entry = paneHistories.get(id);
  if (!pane || !entry) return;
  const from = direction === "back" ? entry.back : entry.forward;
  const to = direction === "back" ? entry.forward : entry.back;
  const sessions = Object.values(state.sessions).flat();
  for (let target = from.pop(); target; target = from.pop()) {
    const cwd =
      state.snapshots[target]?.info.cwd ??
      sessions.find((session) => session.id === target)?.cwd;
    // Deleted chats and chats shown in another pane are skipped.
    if (
      !cwd ||
      Object.entries(state.panes).some(
        ([key, other]) => Number(key) !== id && other.sessionId === target,
      )
    )
      continue;
    if (pane.sessionId) to.push(pane.sessionId);
    entry.expect = target;
    navigationRevision++;
    useStore.setState({ activePane: id });
    void open(cwd, target);
    return;
  }
}

function showPage(page: Page) {
  useStore.setState((state) => {
    if (page !== "chat") return { page };
    const pane = state.panes[state.activePane];
    const openId = pane?.openId;
    return {
      page,
      active: state.active ?? pane?.sessionId,
      // An unsent chat is owned by the pane, not by a saved session key.
      ...(openId &&
      openId === state.openId &&
      state.pendingOpens[openId]?.draftId
        ? { openingViewRevision: navigationRevision }
        : {}),
    };
  });
}

export function navigate(page: Page, sessionKey?: string | null) {
  navigationRevision++;
  const key =
    sessionKey === undefined ? useStore.getState().active : sessionKey;
  const entry = { page, sessionKey: key ?? undefined };
  // The window history holds pages only; chats are per pane (goPane).
  if (historyEntry(history.state).page !== page) history.pushState(entry, "");
  if (sessionKey === undefined) return showPage(page);
  useStore.setState((state) => ({
    page,
    active: sessionKey ?? undefined,
    ...(page === "chat"
      ? selectPaneSession(state, sessionKey ?? undefined)
      : {}),
  }));
}
export function initNavigation() {
  const state = useStore.getState();
  history.replaceState({ page: state.page, sessionKey: state.active }, "");
  const restore = () => {
    navigationRevision++;
    showPage(historyEntry(history.state).page);
  };
  const untrack = trackPaneHistory();
  const mouseDown = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  const mouseUp = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    // The pane under the pointer, not the focused one.
    const pane = (event.target as Element | null)
      ?.closest?.("[data-pane-id]")
      ?.getAttribute("data-pane-id");
    goPane(
      event.button === 3 ? "back" : "forward",
      pane ? Number(pane) : undefined,
    );
  };
  window.addEventListener("popstate", restore);
  window.addEventListener("mousedown", mouseDown, true);
  window.addEventListener("mouseup", mouseUp, true);
  return () => {
    untrack();
    window.removeEventListener("popstate", restore);
    window.removeEventListener("mousedown", mouseDown, true);
    window.removeEventListener("mouseup", mouseUp, true);
  };
}
