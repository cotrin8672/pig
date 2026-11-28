import { readFile, rename } from "node:fs/promises";
import {
  type NewNotice,
  NOTICE_HISTORY_LIMIT,
  type NoticeHistoryRequest,
  type NoticeHistorySnapshot,
  type NoticeRecord,
  newNoticeRecord,
  validateNotice,
  validateNoticeHistory,
} from "../shared/notification-history";
import { writeAtomicJson } from "./atomic-json";

export class NotificationHistory {
  private snapshot: NoticeHistorySnapshot = { revision: 0, notices: [] };
  private migrated = false;
  private corrupt = false;
  private queue = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly publish: (snapshot: NoticeHistorySnapshot) => void,
  ) {}

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (typeof data?.migrated !== "boolean" || !Array.isArray(data.notices))
        throw new Error("Invalid notification history");
      this.snapshot = {
        revision: 0,
        notices: validateNoticeHistory(data.notices),
      };
      this.migrated = data.migrated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.corrupt = true;
      console.error(
        "Cannot load notification history; preserving original file:",
        error,
      );
    }
  }

  async settled() {
    let pending: Promise<void>;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
    return this.snapshot;
  }

  private update(
    change: (notices: NoticeRecord[]) => NoticeRecord[],
    migrate = false,
  ) {
    const task = this.queue.then(async () => {
      if (migrate && this.migrated) return this.snapshot;
      const notices = change(this.snapshot.notices);
      if (!migrate && notices === this.snapshot.notices) return this.snapshot;
      const migrated = migrate || this.migrated;
      if (this.corrupt) {
        await rename(this.file, `${this.file}.corrupt-${crypto.randomUUID()}`);
        this.corrupt = false;
      }
      await writeAtomicJson(this.file, { migrated, notices });
      this.migrated = migrated;
      this.snapshot = { revision: this.snapshot.revision + 1, notices };
      this.publish(this.snapshot);
      return this.snapshot;
    });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  append(notice: NewNotice, toast: (record: NoticeRecord) => void) {
    const record = newNoticeRecord(notice);
    return this.update((current) =>
      [...current, record].slice(-NOTICE_HISTORY_LIMIT),
    ).then((snapshot) => {
      toast(record);
      return snapshot;
    });
  }

  request(input: NoticeHistoryRequest, toast: (record: NoticeRecord) => void) {
    switch (input?.type) {
      case "open": {
        if (input.legacy === undefined) return this.settled();
        if (
          !Array.isArray(input.legacy) ||
          input.legacy.length > NOTICE_HISTORY_LIMIT
        )
          throw new Error("Invalid legacy notification history");
        const legacy = input.legacy;
        return this.update(
          (current) => validateNoticeHistory([...legacy, ...current]),
          true,
        );
      }
      case "append": {
        const notice = validateNotice(input.notice);
        if (!notice) throw new Error("Invalid notification");
        return this.append(notice, toast);
      }
      case "read": {
        if (
          !Array.isArray(input.ids) ||
          input.ids.length > NOTICE_HISTORY_LIMIT ||
          input.ids.some(
            (id) => typeof id !== "string" || !id.length || id.length > 128,
          )
        )
          throw new Error("Invalid notification IDs");
        const ids = new Set(input.ids);
        return this.update((current) =>
          current.some((notice) => !notice.read && ids.has(notice.id))
            ? current.map((notice) =>
                !notice.read && ids.has(notice.id)
                  ? { ...notice, read: true }
                  : notice,
              )
            : current,
        );
      }
      case "clear":
        return this.update((current) => (current.length ? [] : current));
      default:
        throw new Error("Invalid notification history operation");
    }
  }
}
