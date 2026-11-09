import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { create } from "zustand";
import { defaultAppearance } from "../shared/appearance";
import type { ExtensionStatus, UIRequest } from "../shared/extension-ui";
import { dictionary } from "../shared/i18n";
import type {
  Appearance,
  AuthMethod,
  Bootstrap,
  InstalledPackage,
  Notice,
  PackageOpStatus,
  SessionInfo,
} from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import { defaultSettings, type Settings } from "../shared/settings";
import type { ChatSnapshot } from "./chat-snapshot";
import {
  loadNoticeHistory,
  NOTICE_HISTORY_KEY,
  NOTICE_HISTORY_LIMIT,
  type NoticeRecord,
} from "./notification-history";
import { isViewedNotice } from "./session-read";

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
  hostId?: string;
  addresses: Record<string, SessionAddress>;
  pendingUI: UIRequest[];
  extensionStatuses: Record<string, ExtensionStatus>;
  capabilities: Record<string, string[]>;
  openingAddress?: SessionAddress;
  openId?: string;
  openMessage?: string;
  openingViewRevision?: number;
  openingNewCwd?: string;
  newChatDrafts: Record<string, string>;
  installed: InstalledPackage[];
  packageOps: Record<string, PackageOpStatus>;
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
    decisionModels: [],
    decisionProviders: [],
    disabledModels: [],
    modelOverrides: {},
    desktop: { sessions: {} },
  },
  sessions: {},
  snapshots: {},
  addresses: {},
  pendingUI: [],
  extensionStatuses: {},
  capabilities: {},
  page: "chat",
  installed: [],
  packageOps: {},
  notices: [],
  newChatDrafts: {},
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
export function readViewedNotices(visible: boolean, focused: boolean) {
  const state = useStore.getState();
  const viewed = (notice: Notice) =>
    isViewedNotice(notice, state, visible, focused);
  if (
    !state.notices.some(viewed) &&
    !state.noticeHistory.some((n) => !n.read && viewed(n))
  )
    return;
  useStore.setState({
    notices: state.notices.filter((n) => !viewed(n)),
    noticeHistory: state.noticeHistory.map((n) =>
      !n.read && viewed(n) ? { ...n, read: true } : n,
    ),
  });
}
export function showNotice(notice: Notice, acknowledged = false) {
  const silent =
    typeof document !== "undefined" &&
    isViewedNotice(
      notice,
      useStore.getState(),
      document.visibilityState === "visible",
      document.hasFocus(),
    );
  const read = silent || acknowledged;
  const id = crypto.randomUUID();
  useStore.setState((s) => ({
    notices: silent ? s.notices : [...s.notices, { ...notice, id }].slice(-3),
    noticeHistory: [
      ...s.noticeHistory,
      {
        ...notice,
        id,
        createdAt: Date.now(),
        read,
        title: notice.session
          ? s.snapshots[notice.session.id]?.info.title
          : undefined,
      },
    ].slice(-NOTICE_HISTORY_LIMIT),
  }));
  if (!silent) setTimeout(() => dismissNotice(id), 7000);
}
export function showError(error: unknown) {
  showNotice(
    { message: String(error), level: "error" },
    typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      document.hasFocus(),
  );
}

export function receivePackageOp(op: PackageOpStatus) {
  useStore.setState((s) => ({
    packageOps: { ...s.packageOps, [op.opId]: op },
  }));
  if (op.status === "running") return;
  showNotice({
    kind: "package",
    message:
      op.status === "error"
        ? op.message
        : dictionary(useStore.getState().settings.language).packageDone(
            op.action,
            op.source.replace(/^npm:/, ""),
          ),
    level: op.status === "error" ? "error" : "success",
  });
}
