import { afterEach, expect, test } from "bun:test";
import type { SessionFlags } from "../shared/desktop-state";
import { visibleCompletion } from "./session-read";
import { hasUnreadCompletion, sessionStatus } from "./session-status";
import { clearNotices, markNoticeRead, useStore } from "./store";

const complete: SessionFlags = {
  completion: { id: "turn-1", outcome: "success" },
};

function state() {
  return {
    active: "chat",
    page: "chat",
    opening: false,
    modelPending: false,
    bootstrap: { desktop: { sessions: { chat: complete } } },
    snapshots: {
      chat: {
        info: { id: "chat", cwd: "general", title: "Chat", modified: 1 },
        transcript: { running: false },
      },
    },
  };
}

test("dots prioritize waiting over running over unread outcome; idle stays empty", () => {
  expect(sessionStatus(true, true, complete)).toBe("waiting");
  expect(sessionStatus(true, false, complete)).toBe("running");
  expect(sessionStatus(false, false, complete)).toBe("completed");
  expect(
    sessionStatus(false, false, {
      completion: { id: "failed", outcome: "error" },
    }),
  ).toBe("failed");
  expect(
    sessionStatus(false, false, { ...complete, readCompletionId: "turn-1" }),
  ).toBeUndefined();
  expect(
    sessionStatus(false, false, { pinned: true, archived: true }),
  ).toBeUndefined();
  expect(sessionStatus(false, false)).toBeUndefined();
  expect(hasUnreadCompletion({ ...complete, readCompletionId: "older" })).toBe(
    true,
  );
});

test("only the rendered, focused, visible, settled chat acknowledges its exact completion", () => {
  expect(visibleCompletion(state(), true, true)).toEqual({
    id: "chat",
    cwd: "general",
    completionId: "turn-1",
  });
  expect(visibleCompletion(state(), false, true)).toBeUndefined();
  expect(visibleCompletion(state(), true, false)).toBeUndefined();
  for (const patch of [
    { active: "other" },
    { page: "settings" },
    { opening: true },
    { modelPending: true },
    { snapshots: {} },
  ])
    expect(
      visibleCompletion({ ...state(), ...patch }, true, true),
    ).toBeUndefined();
  const running = state();
  running.snapshots.chat.transcript.running = true;
  expect(visibleCompletion(running, true, true)).toBeUndefined();
  const read = state();
  read.bootstrap.desktop.sessions.chat = {
    ...complete,
    readCompletionId: "turn-1",
  };
  expect(visibleCompletion(read, true, true)).toBeUndefined();
});

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));
test("notification reads and deletion never acknowledge chat completion", () => {
  useStore.setState({
    bootstrap: {
      ...original.bootstrap,
      desktop: { sessions: { chat: complete } },
    },
  });
  markNoticeRead();
  clearNotices();
  expect(useStore.getState().bootstrap.desktop.sessions.chat).toEqual(complete);
});
