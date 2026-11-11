import { expect, test } from "bun:test";
import type { SessionInfo } from "../shared/rpc-schema";
import { parseSidebarCache } from "./sidebar-cache";
import { useStore } from "./store";
import { markRead, overlayDesktop, settleRead } from "./ui-mutations";
import {
  mergeLiveSessions,
  selectLiveSessions,
  selectStartingChats,
} from "./ui-selectors";

const info = (id: string, title = id, modified = 1): SessionInfo => ({
  id,
  cwd: "project",
  title,
  modified,
});

test("live chats override stale list titles, appear before listing, and hide while deleting", () => {
  const merged = mergeLiveSessions(
    "project",
    [info("old", "New chat", 5), info("gone")],
    ["old", "First question", 9, "fresh", "Fresh chat", 10],
    { gone: true },
  );
  expect(merged).toEqual([
    info("old", "First question", 9),
    info("fresh", "Fresh chat", 10),
  ]);
});

test("live rows ignore streaming-only changes and other projects", () => {
  const state = useStore.getInitialState();
  const snapshot = (id: string, cwd: string, ready?: false) =>
    ({ info: { ...info(id), cwd }, ready }) as never;
  const s = {
    ...state,
    snapshots: {
      a: snapshot("a", "project"),
      b: snapshot("b", "other"),
      c: snapshot("c", "project", false),
    },
  };
  expect(selectLiveSessions(s, "project")).toEqual(["a", "a", 1]);
});

test("a starting new chat is listed at once with its first message as title", () => {
  const state = useStore.getInitialState();
  const s = {
    ...state,
    pendingOpens: {
      one: { cwd: "project" },
      two: {
        cwd: "project",
        address: { hostId: "h", sessionId: "sid", epoch: 1 },
        queued: [
          {
            id: "q",
            kind: "send" as const,
            timestamp: 1,
            content: { text: "Hello\nworld", pastes: [], images: [] },
          },
        ],
      },
      existing: { cwd: "project", id: "known" },
      elsewhere: { cwd: "other" },
    },
  };
  expect(selectStartingChats(s, "project", "New chat")).toEqual([
    "one",
    "New chat",
    "",
    "two",
    "Hello",
    "sid",
  ]);
});

test("a seen completion stays read until the host echoes it, and a refusal releases it", () => {
  const completion = { id: "done-1", outcome: "success" as const };
  useStore.setState((s) => ({
    bootstrap: {
      ...s.bootstrap,
      desktop: { sessions: { chat: { completion } } },
    },
  }));
  markRead("chat", "done-1");
  expect(
    useStore.getState().bootstrap.desktop.sessions.chat.readCompletionId,
  ).toBe("done-1");
  // An older bootstrap without the mark cannot bring the dot back.
  expect(
    overlayDesktop({ sessions: { chat: { completion } } }).sessions.chat
      .readCompletionId,
  ).toBe("done-1");
  settleRead("chat", "done-1");
  expect(
    overlayDesktop({ sessions: { chat: { completion } } }).sessions.chat
      .readCompletionId,
  ).toBeUndefined();
});

test("the launch cache accepts only well-formed sidebar data", () => {
  const valid = {
    generalCwd: "general",
    projects: ["project"],
    desktop: { sessions: { a: { pinned: true } } },
    sessions: { project: [info("a"), { id: 3 }, { ...info("b"), cwd: "x" }] },
  };
  expect(parseSidebarCache(JSON.stringify(valid))).toEqual({
    generalCwd: "general",
    projects: ["project"],
    desktop: { sessions: { a: { pinned: true } }, projects: {} },
    sessions: { project: [info("a")] },
  });
  for (const raw of [
    null,
    "{",
    "[]",
    JSON.stringify({ ...valid, projects: [1] }),
    JSON.stringify({ ...valid, sessions: { project: {} } }),
  ])
    expect(parseSidebarCache(raw)).toBeUndefined();
});
