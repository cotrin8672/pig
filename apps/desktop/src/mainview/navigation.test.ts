import { expect, test } from "bun:test";
import { goPane as go, historyEntry, trackPaneHistory } from "./navigation";
import { useStore } from "./store";

const opened: string[] = [];
const open = async (_cwd: string, id: string) => {
  opened.push(id);
  // Like openChat(push=false): the pane passes through an opening state.
  useStore.setState((s) => ({ panes: { ...s.panes, [s.activePane]: {} } }));
  useStore.setState((s) => ({
    panes: { ...s.panes, [s.activePane]: { sessionId: id } },
  }));
};
const goPane = (direction: "back" | "forward", id: number) =>
  go(direction, id, open);

test("back and forward move through the chats of one pane only", async () => {
  const initial = useStore.getState();
  const untrack = trackPaneHistory();
  const show = (pane: number, sessionId?: string) =>
    useStore.setState((s) => ({
      panes: { ...s.panes, [pane]: { sessionId } },
    }));
  const snapshot = (id: string) => ({ info: { cwd: "C:\\p", id } });
  useStore.setState({
    page: "chat",
    activePane: 1,
    panes: { 1: { sessionId: "a" }, 2: { sessionId: "x" } },
    snapshots: Object.fromEntries(
      ["a", "b", "c", "x", "y"].map((id) => [id, snapshot(id)]),
    ) as never,
  });
  show(1, "b");
  show(2, "y");
  show(1, undefined); // new chat
  show(1, "c");
  const settle = () => new Promise((r) => setTimeout(r, 0));

  goPane("back", 1);
  await settle();
  goPane("back", 1);
  await settle();
  expect(useStore.getState().panes[1].sessionId).toBe("a");
  expect(useStore.getState().panes[2].sessionId).toBe("y");
  goPane("forward", 1);
  await settle();
  expect(opened).toEqual(["b", "a", "b"]);

  goPane("back", 2);
  await settle();
  expect(useStore.getState()).toMatchObject({
    activePane: 2,
    panes: { 1: { sessionId: "b" }, 2: { sessionId: "x" } },
  });
  // A new chat clears forward.
  show(1, "c");
  goPane("forward", 1);
  await settle();
  expect(opened).toHaveLength(4);
  untrack();
  useStore.setState(initial, true);
});

test("history entries restore known pages and only string session keys", () => {
  expect(historyEntry({ page: "settings", sessionKey: "s1" })).toEqual({
    page: "settings",
    sessionKey: "s1",
  });
  expect(historyEntry({ page: "chat", sessionKey: 123 })).toEqual({
    page: "chat",
  });
  for (const value of [null, undefined, "chat", { page: "missing" }])
    expect(historyEntry(value)).toEqual({ page: "chat" });
});
