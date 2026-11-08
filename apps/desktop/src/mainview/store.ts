import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { create } from "zustand";
import { defaultAppearance } from "../shared/appearance";
import type {
  Appearance,
  AuthMethod,
  Bootstrap,
  Notice,
  SessionInfo,
} from "../shared/rpc-schema";
import { defaultSettings, type Settings } from "../shared/settings";
import type { ChatSnapshot } from "./chat-snapshot";
import {
  loadNoticeHistory,
  NOTICE_HISTORY_KEY,
  NOTICE_HISTORY_LIMIT,
  type NoticeRecord,
} from "./notification-history";

export interface LoginState {
  loginId: string;
  provider: string;
  method: AuthMethod;
  event?: AuthEvent;
  authUrl?: Extract<AuthEvent, { type: "auth_url" }>;
  deviceCode?: Extract<AuthEvent, { type: "device_code" }>;
  error?: string;
  prompt?: AuthPrompt;
}
export const useStore = create<{
  bootstrap: Bootstrap;
  sessions: Record<string, SessionInfo[]>;
  snapshots: Record<string, ChatSnapshot>;
  active?: string;
  page: "chat" | "providers" | "extensions" | "settings";
  notices: (Notice & { id: string })[];
  noticeHistory: NoticeRecord[];
  login?: LoginState;
  opening: boolean;
  appearance: Appearance;
  settings: Settings;
  modelPending: boolean;
  maximized: boolean;
}>(() => ({
  bootstrap: {
    generalCwd: "",
    projects: [],
    providers: [],
    models: [],
    imageModels: [],
    classificationModels: [],
    classificationProviders: [],
    disabledModels: [],
    modelOverrides: {},
    desktop: { sessions: {} },
  },
  sessions: {},
  snapshots: {},
  page: "chat",
  notices: [],
  noticeHistory: loadNoticeHistory(),
  opening: false,
  maximized: false,
  modelPending: false,
  appearance: defaultAppearance,
  settings: defaultSettings,
}));
useStore.subscribe((state, previous) => {
  if (state.noticeHistory === previous.noticeHistory) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      NOTICE_HISTORY_KEY,
      JSON.stringify(state.noticeHistory),
    );
  } catch (error) {
    console.warn("Cannot save notification history:", error);
  }
});
export function markNoticeRead(id?: string) {
  useStore.setState((s) => ({
    noticeHistory: s.noticeHistory.map((notice) =>
      id === undefined || notice.id === id ? { ...notice, read: true } : notice,
    ),
  }));
}
export function clearNotices() {
  useStore.setState({ noticeHistory: [], notices: [] });
}
export function dismissNotice(id: string) {
  useStore.setState((s) => ({
    notices: s.notices.filter((notice) => notice.id !== id),
  }));
}
export function showNotice(notice: Notice) {
  const id = crypto.randomUUID();
  useStore.setState((s) => ({
    notices: [...s.notices, { ...notice, id }],
    noticeHistory: [
      ...s.noticeHistory,
      {
        ...notice,
        id,
        createdAt: Date.now(),
        read: false,
        title: notice.session
          ? s.snapshots[notice.session.id]?.info.title
          : undefined,
      },
    ].slice(-NOTICE_HISTORY_LIMIT),
  }));
  setTimeout(() => dismissNotice(id), 7000);
}
export function showError(error: unknown) {
  showNotice({ message: String(error), level: "error" });
}
