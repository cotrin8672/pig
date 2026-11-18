import type { Notice } from "./rpc-schema";

export type NewNotice = Notice & { title?: string };
export interface NoticeRecord extends NewNotice {
  id: string;
  createdAt: number;
  read: boolean;
}
export const NOTICE_HISTORY_LIMIT = 200;
export const NOTICE_HISTORY_KEY = "pig.notifications";

export interface NoticeHistorySnapshot {
  revision: number;
  notices: NoticeRecord[];
}
type NoticeMutation =
  | { type: "append"; notice: NewNotice }
  | { type: "read"; ids: string[] }
  | { type: "clear" };
export type NoticeHistoryRequest =
  | { type: "open"; legacy?: NoticeRecord[] }
  | NoticeMutation;

export function newNoticeRecord(notice: NewNotice, read = false): NoticeRecord {
  return { ...notice, id: crypto.randomUUID(), createdAt: Date.now(), read };
}

export function validateNotice(value: unknown): NewNotice | undefined {
  if (!value || typeof value !== "object") return;
  const { message, level, kind, session, title } = value as Partial<NewNotice>;
  if (
    typeof message !== "string" ||
    (level !== "info" &&
      level !== "success" &&
      level !== "warning" &&
      level !== "error") ||
    (kind !== undefined && kind !== "completion" && kind !== "package") ||
    (title !== undefined && typeof title !== "string") ||
    (session !== undefined &&
      (!session ||
        typeof session !== "object" ||
        typeof session.id !== "string" ||
        typeof session.cwd !== "string"))
  )
    return;
  return {
    message,
    level,
    kind,
    title,
    session: session && { id: session.id, cwd: session.cwd },
  };
}

export function validateNoticeHistory(value: unknown): NoticeRecord[] {
  if (!Array.isArray(value)) return [];
  const notices = new Map<string, NoticeRecord>();
  for (const item of value) {
    const notice = validateNotice(item);
    if (!notice) continue;
    const { id, createdAt, read } = item as Partial<NoticeRecord>;
    if (
      typeof id !== "string" ||
      !id.length ||
      id.length > 128 ||
      typeof createdAt !== "number" ||
      Number.isNaN(new Date(createdAt).getTime()) ||
      typeof read !== "boolean"
    )
      continue;
    notices.set(id, {
      ...notice,
      id,
      createdAt,
      read: read || notices.get(id)?.read === true,
    });
  }
  return [...notices.values()].slice(-NOTICE_HISTORY_LIMIT);
}

export function parseNoticeHistory(raw: string | null): NoticeRecord[] {
  try {
    return validateNoticeHistory(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}
