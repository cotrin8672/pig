import { afterEach, expect, jest, test } from "bun:test";
import {
  NOTICE_HISTORY_LIMIT,
  parseNoticeHistory,
} from "./notification-history";
import {
  clearNotices,
  dismissNotice,
  markNoticeRead,
  receivePackageOp,
  showError,
  showNotice,
  useStore,
} from "./store";

afterEach(() => {
  jest.useRealTimers();
  useStore.setState({ notices: [], noticeHistory: [], packageOps: {} });
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

test("dismissal removes only its notice; existing errors and package results share the stack", () => {
  jest.useFakeTimers();
  showError("Failure");
  const first = useStore.getState().notices[0];
  const op = { opId: "op", action: "install" as const, source: "npm:example" };
  receivePackageOp({ ...op, status: "running" });
  expect(useStore.getState().notices).toHaveLength(1);
  receivePackageOp({ ...op, status: "done" });
  expect(useStore.getState().notices.map((n) => n.level)).toEqual([
    "error",
    "success",
  ]);
  dismissNotice(first.id);
  expect(useStore.getState().notices).toHaveLength(1);
  receivePackageOp({ ...op, status: "error", message: "Cannot install" });
  expect(useStore.getState().notices[1]).toMatchObject({
    message: "Cannot install",
    level: "error",
  });
});

test("history supports individual and bulk read, retains the newest 200, and clears without timer resurrection", () => {
  jest.useFakeTimers();
  for (let index = 0; index < NOTICE_HISTORY_LIMIT + 1; index++) {
    showNotice({ message: String(index), level: "info" });
  }
  const history = useStore.getState().noticeHistory;
  expect(history).toHaveLength(NOTICE_HISTORY_LIMIT);
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
