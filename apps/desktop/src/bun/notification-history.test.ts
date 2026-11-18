import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  NoticeHistoryRequest,
  NoticeHistorySnapshot,
  NoticeRecord,
} from "../shared/notification-history";
import { ClientHub } from "./client-hub";
import { NotificationHistory } from "./notification-history";

const ignoreToast = () => {};
const legacy: NoticeRecord[] = [
  {
    id: "legacy",
    message: "Previously read",
    level: "info",
    read: true,
    createdAt: 1,
  },
];

test("two windows read a shared history without losing concurrent changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "notification-history-"));
  try {
    const file = join(directory, "notifications.json");
    const hub = new ClientHub("host");
    const host = new NotificationHistory(file, (state) =>
      hub.broadcast("noticeHistory", state),
    );
    type WindowStore = typeof import("../mainview/store");
    const open = async (id: string) => {
      const path = `../mainview/store.ts?notice-history-window=${id}`;
      const view: WindowStore = await import(path);
      const toasts: NoticeRecord[] = [];
      hub.add(id, (name, payload) => {
        if (name === "noticeHistory")
          view.receiveNoticeHistory(payload as NoticeHistorySnapshot);
        if (name === "notification") toasts.push(payload as NoticeRecord);
      });
      const request = (input: NoticeHistoryRequest) =>
        host.request(input, (record) => hub.to(id, "notification", record));
      await view.connectNoticeHistory(request, legacy);
      return {
        ...view,
        toasts,
        unread: () =>
          view.useStore
            .getState()
            .noticeHistory.filter((notice) => !notice.read),
      };
    };
    const [a, b] = await Promise.all([open("a"), open("b")]);
    expect(a.useStore).not.toBe(b.useStore);
    expect(a.useStore.getState().noticeHistory).toEqual(legacy);
    expect(a.toasts).toEqual([]);
    const broadcast = (record: NoticeRecord) =>
      hub.broadcast("notification", record);
    await host.append({ message: "First", level: "info" }, broadcast);
    const firstSnapshot = await host.append(
      { message: "Second", level: "info" },
      broadcast,
    );
    const [first, second] = a.unread();
    expect(b.unread()).toEqual([first, second]);
    expect(a.toasts).toEqual(b.toasts);

    a.markNoticeRead(first.id);
    b.markNoticeRead(second.id);
    const settled = await host.request({ type: "open", legacy }, ignoreToast);
    expect(a.unread()).toEqual([]);
    expect(b.unread()).toEqual([]);
    b.receiveNoticeHistory(firstSnapshot);
    expect(b.unread()).toEqual([]);

    const reloaded = new NotificationHistory(file, () => {});
    await reloaded.load();
    expect(
      (await reloaded.request({ type: "open", legacy }, ignoreToast)).notices,
    ).toEqual(settled.notices);
    const c = await open("c");
    expect(c.unread()).toEqual([]);
    expect(c.toasts).toEqual([]);

    a.showNotice({ message: "Local error", level: "error" });
    await host.request({ type: "open", legacy }, ignoreToast);
    expect(b.unread()).toHaveLength(1);
    expect(a.toasts.at(-1)?.id).toBe(b.unread()[0].id);
    expect(b.toasts).toHaveLength(2);

    await host.append(
      { message: "Updated", kind: "package", level: "success" },
      broadcast,
    );
    a.useStore.setState({ page: "extensions" });
    a.readViewedNotices(true, true);
    await host.request({ type: "open", legacy }, ignoreToast);
    expect(b.unread().map((notice) => notice.message)).toEqual(["Local error"]);
    b.markNoticeRead();
    await host.request({ type: "open", legacy }, ignoreToast);
    expect(a.unread()).toEqual([]);

    b.clearNotices();
    expect(
      (await host.request({ type: "open", legacy }, ignoreToast)).notices,
    ).toEqual([]);
    expect(a.useStore.getState().noticeHistory).toEqual([]);
    await reloaded.load();
    expect(
      (await reloaded.request({ type: "open", legacy }, ignoreToast)).notices,
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
