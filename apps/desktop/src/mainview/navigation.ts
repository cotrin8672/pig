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
  if (!["chat", "providers", "extensions", "settings"].includes(entry.page))
    return { page: "chat" };
  return {
    page: entry.page,
    ...(typeof entry.sessionKey === "string"
      ? { sessionKey: entry.sessionKey }
      : {}),
  };
}
export let navigationRevision = 0;
export function navigate(
  page: Page,
  sessionKey: string | null | undefined = useStore.getState().active,
) {
  navigationRevision++;
  const entry = { page, sessionKey: sessionKey ?? undefined };
  const current = historyEntry(history.state);
  if (current.page !== page || current.sessionKey !== sessionKey)
    history.pushState(entry, "");
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
    const entry = historyEntry(history.state);
    const state = useStore.getState();
    const session = Object.values(state.sessions)
      .flat()
      .find((s) => s.id === entry.sessionKey);
    useStore.setState({
      page: entry.page,
      active: session ? entry.sessionKey : undefined,
    });
    if (entry.page === "chat" && session) {
      const revision = navigationRevision;
      void import("./rpc").then(({ openChat }) => {
        if (revision === navigationRevision)
          return openChat(session.cwd, session.id, false);
      });
    }
  };
  const mouseDown = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  const mouseUp = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (event.button === 3) history.back();
    else history.forward();
  };
  window.addEventListener("popstate", restore);
  window.addEventListener("mousedown", mouseDown, true);
  window.addEventListener("mouseup", mouseUp, true);
  return () => {
    window.removeEventListener("popstate", restore);
    window.removeEventListener("mousedown", mouseDown, true);
    window.removeEventListener("mouseup", mouseUp, true);
  };
}
