import { afterEach, expect, jest, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import {
  NOTICE_HISTORY_LIMIT,
  parseNoticeHistory,
} from "./notification-history";
import {
  clearNotices,
  dismissNotice,
  markNoticeRead,
  readViewedNotices,
  receivePackageOp,
  showError,
  showNotice,
  useStore,
} from "./store";

const original = useStore.getState();
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
function viewDocument(visible = true, focused = true) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: visible ? "visible" : "hidden",
      hasFocus: () => focused,
    },
  });
}
afterEach(() => {
  jest.useRealTimers();
  if (originalDocument)
    Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  useStore.setState({ ...original, notices: [], noticeHistory: [] }, true);
});

test("identical notices coexist and expire independently, including before session load", () => {
  jest.useFakeTimers();
  const notice = {
    message: "Hello",
    level: "info" as const,
    session: { id: "not-loaded", cwd: "project" },
  };
  showNotice(notice);
  const first = useStore.getState().notices[0];
  jest.advanceTimersByTime(3000);
  showNotice(notice);
  expect(useStore.getState().notices).toHaveLength(2);
  expect(useStore.getState().notices[1].id).not.toBe(first.id);
  jest.advanceTimersByTime(4000);
  expect(useStore.getState().notices).toHaveLength(1);
  expect(useStore.getState().notices[0].session).toEqual(notice.session);
  jest.advanceTimersByTime(3000);
  expect(useStore.getState().notices).toEqual([]);
  expect(useStore.getState().noticeHistory).toHaveLength(2);
  expect(
    useStore.getState().noticeHistory.every((notice) => !notice.read),
  ).toBe(true);
});

test("dismissal removes only its notice; errors and completions share the stack", () => {
  jest.useFakeTimers();
  showError("Failure");
  const first = useStore.getState().notices[0];
  showNotice({ message: "Finished", level: "success" });
  expect(useStore.getState().notices.map((n) => n.level)).toEqual([
    "error",
    "success",
  ]);
  dismissNotice(first.id);
  expect(useStore.getState().notices).toHaveLength(1);
});

test("history supports individual and bulk read, retains the newest 200, and clears without timer resurrection", () => {
  jest.useFakeTimers();
  for (let index = 0; index < NOTICE_HISTORY_LIMIT + 1; index++) {
    showNotice({ message: String(index), level: "info" });
  }
  const history = useStore.getState().noticeHistory;
  expect(history).toHaveLength(NOTICE_HISTORY_LIMIT);
  expect(useStore.getState().notices).toHaveLength(3);
  expect(history[0].message).toBe("1");
  expect(history.at(-1)?.message).toBe("200");
  markNoticeRead(history[0].id);
  expect(
    useStore.getState().noticeHistory.filter((notice) => notice.read),
  ).toHaveLength(1);
  markNoticeRead();
  expect(useStore.getState().noticeHistory.every((notice) => notice.read)).toBe(
    true,
  );
  clearNotices();
  jest.advanceTimersByTime(7000);
  expect(useStore.getState().noticeHistory).toEqual([]);
  expect(useStore.getState().notices).toEqual([]);
});

test("stored history round-trips and ignores corrupt or invalid entries", () => {
  const notice = {
    id: "id",
    message: "done",
    level: "success" as const,
    createdAt: 123,
    read: true,
    title: "Chat",
    session: { id: "chat", cwd: "project" },
  };
  expect(parseNoticeHistory(JSON.stringify([notice]))).toEqual([notice]);
  for (const raw of [null, "{", "{}", "null"])
    expect(parseNoticeHistory(raw)).toEqual([]);
  const invalid = [
    null,
    1,
    { ...notice, level: "unknown" },
    { ...notice, read: "true" },
    { ...notice, session: null },
    { ...notice, createdAt: 1e100 },
    { ...notice, title: 12 },
  ];
  expect(parseNoticeHistory(JSON.stringify([...invalid, notice]))).toEqual([
    notice,
  ]);
  expect(
    parseNoticeHistory(
      JSON.stringify(
        Array.from({ length: 205 }, (_, i) => ({ ...notice, id: String(i) })),
      ),
    ),
  ).toHaveLength(NOTICE_HISTORY_LIMIT);
});

test("returning to a chat clears only its successful completion toast and marks its history read", () => {
  jest.useFakeTimers();
  useStore.setState({
    active: "chat",
    page: "chat",
    opening: false,
    modelPending: false,
    pendingUI: [],
    snapshots: {
      chat: {
        address: { hostId: "host", sessionId: "chat", epoch: 1 },
        snapshotSeq: 1,
        info: { id: "chat", cwd: "project", title: "Chat", modified: 1 },
        transcript: emptyTranscript(),
        effort: "off",
        effortLevels: [],
      },
    },
  });
  const notice = {
    kind: "completion" as const,
    level: "success" as const,
    message: "Done",
    session: { id: "chat", cwd: "project" },
  };
  showNotice(notice);
  showNotice({ ...notice, level: "error" });
  showNotice({ ...notice, kind: undefined });
  readViewedNotices(true, false);
  expect(useStore.getState().notices).toHaveLength(3);
  readViewedNotices(true, true);
  expect(useStore.getState().notices).toHaveLength(2);
  expect(useStore.getState().noticeHistory.map((n) => n.read)).toEqual([
    true,
    false,
    false,
  ]);
  const history = useStore.getState().noticeHistory;
  readViewedNotices(true, true);
  expect(useStore.getState().noticeHistory).toBe(history);
  viewDocument();
  showNotice(notice);
  expect(useStore.getState().noticeHistory.at(-1)?.read).toBe(true);
  expect(useStore.getState().notices).toHaveLength(2);
});

test.each([
  "install",
  "update",
  "uninstall",
] as const)("visible %s success is recorded as read without a toast", (action) => {
  jest.useFakeTimers();
  viewDocument();
  useStore.setState({ page: "extensions" });
  const op = { opId: "test-op", source: "npm:example", action };
  receivePackageOp({ ...op, status: "running" });
  expect(useStore.getState().noticeHistory).toHaveLength(0);
  receivePackageOp({ ...op, status: "done" });
  expect(useStore.getState().notices).toHaveLength(0);
  expect(useStore.getState().noticeHistory).toHaveLength(1);
  expect(useStore.getState().noticeHistory[0]).toMatchObject({
    kind: "package",
    level: "success",
    read: true,
  });
  jest.advanceTimersByTime(7000);
  expect(
    parseNoticeHistory(JSON.stringify(useStore.getState().noticeHistory))[0]
      .read,
  ).toBe(true);
});

test("unseen package results remain unread; returning reads successes but not failures or extension messages", () => {
  jest.useFakeTimers();
  const op = {
    opId: "test-op",
    source: "npm:example",
    action: "install" as const,
  };
  for (const [page, visible, focused] of [
    ["chat", true, true],
    ["extensions", false, true],
    ["extensions", true, false],
  ] as const) {
    clearNotices();
    useStore.setState({ page });
    viewDocument(visible, focused);
    receivePackageOp({ ...op, status: "done" });
    expect(useStore.getState().notices).toHaveLength(1);
    expect(useStore.getState().noticeHistory[0].read).toBe(false);
  }
  viewDocument();
  receivePackageOp({ ...op, status: "error", message: "Install failed" });
  showNotice({ level: "info", message: "Extension requires attention" });
  readViewedNotices(true, true);
  expect(useStore.getState().notices.map((n) => n.level)).toEqual([
    "error",
    "info",
  ]);
  expect(useStore.getState().noticeHistory.map((n) => n.read)).toEqual([
    true,
    false,
    false,
  ]);
});

test("foreground operation errors remain visible but do not add unread badges", () => {
  jest.useFakeTimers();
  viewDocument();
  showError(new Error("Delete failed"));
  expect(useStore.getState().notices).toHaveLength(1);
  expect(useStore.getState().noticeHistory[0]).toMatchObject({
    level: "error",
    read: true,
  });
  expect(useStore.getState().noticeHistory.filter((n) => !n.read)).toHaveLength(
    0,
  );
  jest.advanceTimersByTime(7000);
  expect(useStore.getState().notices).toHaveLength(0);
  expect(useStore.getState().noticeHistory[0].read).toBe(true);
  viewDocument(true, false);
  showError("Unseen failure");
  expect(useStore.getState().noticeHistory.at(-1)?.read).toBe(false);
  viewDocument();
  showNotice({ level: "error", message: "Extension failure" });
  expect(useStore.getState().noticeHistory.at(-1)?.read).toBe(false);
});
