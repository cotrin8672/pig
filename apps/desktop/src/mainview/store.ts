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
  ModelSelection,
  Notice,
  PackageOpStatus,
  SessionInfo,
} from "../shared/rpc-schema";
import type {
  DraftContent,
  PromptDelivery,
  SessionAddress,
} from "../shared/runtime-contract";
import { defaultSettings, type Settings } from "../shared/settings";
import type { TerminalOpenEvent } from "../shared/terminal-ui";
import type { Message } from "../shared/transcript";
import type { ChatSnapshot } from "./chat-snapshot";
import type { ExtensionNotice } from "./extension-notices";
import {
  loadNoticeHistory,
  NOTICE_HISTORY_KEY,
  NOTICE_HISTORY_LIMIT,
  type NoticeRecord,
} from "./notification-history";
import { isViewedNotice } from "./session-read";
import { loadSidebarCache, saveSidebarCache } from "./sidebar-cache";

const launchCache = loadSidebarCache();
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
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
export interface OpeningTarget {
  cwd: string;
  id?: string;
  selection?: ModelSelection;
  /** Sends and selection changes made before startup, replayed in click order. */
  queued?: OpeningOp[];
}
export type OpeningOp = { id: string } & (
  | {
      kind: "send";
      content: DraftContent;
      timestamp: number;
      delivery?: PromptDelivery;
    }
  | { kind: "select"; selection: ModelSelection }
);
type UserMessage = Extract<Message, { role: "user" }>;
export interface PendingOpen extends OpeningTarget {
  address?: SessionAddress;
  message?: string;
}
export const useStore = create<{
  bootstrap: Bootstrap;
  initialized: boolean;
  installedLoaded: boolean;
  sessions: Record<string, SessionInfo[]>;
  snapshots: Record<string, ChatSnapshot>;
  active?: string;
  page: "chat" | "providers" | "extensions" | "settings";
  hostId?: string;
  addresses: Record<string, SessionAddress>;
  pendingUI: UIRequest[];
  terminals: Record<string, TerminalOpenEvent>;
  extensionStatuses: Record<string, ExtensionStatus>;
  extensionNotices: Record<string, ExtensionNotice[]>;
  capabilities: Record<string, string[]>;
  openingAddress?: SessionAddress;
  openId?: string;
  openMessage?: string;
  openingViewRevision?: number;
  openingTarget?: OpeningTarget;
  pendingOpens: Record<string, PendingOpen>;
  newChatDrafts: Record<string, string>;
  /** Chats whose deletion is in flight: hidden now, restored if it fails. */
  deletingSessions: Record<string, true>;
  /**
   * Resends in flight by chat: the transcript is shown cut at the rewound
   * entry, with the new message pending, until the host's rewind lands.
   */
  rewinds: Record<
    string,
    | { kind: "resend"; entryId: string; user: UserMessage }
    | { kind: "fork"; entryId: string }
  >;
  installed: InstalledPackage[];
  packageOps: Record<string, PackageOpStatus>;
  notices: (Notice & { id: string })[];
  noticeHistory: NoticeRecord[];
  login?: LoginState;
  /** Selected-view state only; pendingOpens tracks startup without locking navigation. */
  opening: boolean;
  appearance: Appearance;
  settings: Settings;
  maximized: boolean;
  /** The sidebar shows the previous launch's list until bootstrap answers. */
  cachedSidebar: boolean;
}>(() => ({
  bootstrap: {
    generalCwd: launchCache?.generalCwd ?? "",
    projects: launchCache?.projects ?? [],
    providers: [],
    models: [],
    imageModels: [],
    classificationModels: [],
    classificationProviders: [],
    disabledModels: [],
    modelOverrides: {},
    desktop: launchCache?.desktop ?? { sessions: {} },
  },
  initialized: false,
  cachedSidebar: !!launchCache,
  installedLoaded: false,
  sessions: launchCache?.sessions ?? {},
  snapshots: {},
  addresses: {},
  pendingUI: [],
  terminals: {},
  extensionStatuses: {},
  extensionNotices: {},
  capabilities: {},
  page: "chat",
  installed: [],
  packageOps: {},
  notices: [],
  newChatDrafts: {},
  deletingSessions: {},
  rewinds: {},
  noticeHistory: loadNoticeHistory(),
  opening: false,
  pendingOpens: {},
  maximized: false,
  appearance: defaultAppearance,
  settings: defaultSettings,
}));
useStore.subscribe((state, previous) => {
  if (
    !state.initialized ||
    (state.sessions === previous.sessions &&
      state.bootstrap.projects === previous.bootstrap.projects &&
      state.bootstrap.desktop === previous.bootstrap.desktop)
  )
    return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    const { bootstrap, sessions } = useStore.getState();
    saveSidebarCache({
      generalCwd: bootstrap.generalCwd,
      projects: bootstrap.projects,
      desktop: {
        sessions: bootstrap.desktop.sessions,
        projects: bootstrap.desktop.projects,
      },
      sessions,
    });
  }, 500);
});
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
export function showNotice(notice: Notice) {
  const read =
    typeof document !== "undefined" &&
    isViewedNotice(
      notice,
      useStore.getState(),
      document.visibilityState === "visible",
      document.hasFocus(),
    );
  const id = crypto.randomUUID();
  useStore.setState((s) => ({
    notices: read ? s.notices : [...s.notices, { ...notice, id }].slice(-3),
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
  if (!read) setTimeout(() => dismissNotice(id), 7000);
}
export function showError(error: unknown) {
  showNotice({ message: String(error), level: "error" });
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
