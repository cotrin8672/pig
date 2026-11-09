import { afterEach, expect, test } from "bun:test";
import type { SessionFlags } from "../shared/desktop-state";
import {
  isInlineResultVisible,
  isViewedCompletion,
  visibleCompletion,
} from "./session-read";
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

test("only successful completion of the chat being watched is silent", () => {
  const notice = {
    kind: "completion" as const,
    level: "success" as const,
    message: "Done",
    session: { id: "chat", cwd: "general" },
  };
  expect(isViewedCompletion(notice, state(), true, true)).toBe(true);
  // Notification and snapshot publications may arrive in either order.
  const streaming = state();
  streaming.snapshots.chat.transcript.running = true;
  expect(isViewedCompletion(notice, streaming, true, true)).toBe(true);
  expect(isViewedCompletion(notice, state(), false, true)).toBe(false);
  expect(isViewedCompletion(notice, state(), true, false)).toBe(false);
  for (const patch of [
    { active: "other" },
    { page: "settings" },
    { opening: true },
    { snapshots: {} },
    { pendingUI: [{ sessionId: "chat" }] },
  ]) {
    expect(
      isViewedCompletion(notice, { ...state(), ...patch }, true, true),
    ).toBe(false);
  }
  expect(
    isViewedCompletion(
      { ...notice, session: { id: "chat", cwd: "other" } },
      state(),
      true,
      true,
    ),
  ).toBe(false);
  expect(
    isViewedCompletion({ ...notice, level: "error" }, state(), true, true),
  ).toBe(false);
  expect(
    isViewedCompletion({ ...notice, kind: undefined }, state(), true, true),
  ).toBe(false);
});

test("inline operation errors notify globally only when their own form cannot be seen", () => {
  const form = { isConnected: true, getClientRects: () => ({ length: 1 }) };
  expect(isInlineResultVisible(form, true, true)).toBe(true);
  expect(isInlineResultVisible(form, false, true)).toBe(false);
  expect(isInlineResultVisible(form, true, false)).toBe(false);
  expect(
    isInlineResultVisible({ ...form, isConnected: false }, true, true),
  ).toBe(false);
  expect(
    isInlineResultVisible(
      { ...form, getClientRects: () => ({ length: 0 }) },
      true,
      true,
    ),
  ).toBe(false);
});
