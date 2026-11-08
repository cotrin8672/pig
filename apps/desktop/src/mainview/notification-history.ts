import type { Notice } from "../shared/rpc-schema";

export interface NoticeRecord extends Notice {
  id: string;
  createdAt: number;
  read: boolean;
  title?: string;
}
export const NOTICE_HISTORY_LIMIT = 200;
export const NOTICE_HISTORY_KEY = "pig.notifications";

export function parseNoticeHistory(raw: string | null): NoticeRecord[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is NoticeRecord =>
          item !== null &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          item.id.length > 0 &&
          typeof item.message === "string" &&
          ["info", "success", "warning", "error"].includes(item.level) &&
          typeof item.createdAt === "number" &&
          Number.isFinite(item.createdAt) &&
          !Number.isNaN(new Date(item.createdAt).getTime()) &&
          typeof item.read === "boolean" &&
          (item.title === undefined || typeof item.title === "string") &&
          (item.session === undefined ||
            (item.session !== null &&
              typeof item.session === "object" &&
              typeof item.session.id === "string" &&
              typeof item.session.cwd === "string")),
      )
      .slice(-NOTICE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function loadNoticeHistory(): NoticeRecord[] {
  try {
    return parseNoticeHistory(localStorage.getItem(NOTICE_HISTORY_KEY));
  } catch {
    return [];
  }
}
