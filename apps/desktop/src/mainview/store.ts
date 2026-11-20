import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { create } from "zustand";
import type { AppUpdateState } from "../shared/app-update";
import { defaultAppearance } from "../shared/appearance";
import type { ChatHistoryFileEvent } from "../shared/chat-history-import";
import type { ExtensionStatus, UIRequest } from "../shared/extension-ui";
import { dictionary } from "../shared/i18n";
import {
  type NewNotice,
  NOTICE_HISTORY_LIMIT,
  type NoticeHistoryRequest,
  type NoticeHistorySnapshot,
  type NoticeRecord,
  newNoticeRecord,
} from "../shared/notification-history";
import type { AccountTarget } from "../shared/provider-accounts";
import type { ProviderUsage } from "../shared/provider-usage";
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
import type { PaneNode } from "./pane-layout";
import { isViewedNotice } from "./session-read";
import { loadSidebarCache, saveSidebarCache } from "./sidebar-cache";

const launchCache = loadSidebarCache();
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
export interface LoginState {
  loginId: string;
  provider: string;
  method: AuthMethod;
  accountId?: string;
  addAccount?: boolean;
  event?: AuthEvent;
  authUrl?: Extract<AuthEvent, { type: "auth_url" }>;
  deviceCode?: Extract<AuthEvent, { type: "device_code" }>;
  /** undefined until the host reports whether the OS accepted the URL. */
  browserOpened?: boolean;
  error?: string;
  prompt?: AuthPrompt;
}
export interface OpeningTarget {
  /** Local new-chat identity; no SDK session exists until the first send. */
  draftId?: string;
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
export type SettingsCategory =
  | "general"
  | "appearance"
  | "keyboard"
  | "import"
  | "updates";
export interface PendingOpen extends OpeningTarget {
  /** A local editor, not an in-flight SDK open. */
  deferred?: boolean;
  address?: SessionAddress;
  message?: string;
}
export const useStore = create<{
  bootstrap: Bootstrap;
  providerUsage: ProviderUsage[];
  initialized: boolean;
  appUpdate?: AppUpdateState;
  installedLoaded: boolean;
  sessions: Record<string, SessionInfo[]>;
  snapshots: Record<string, ChatSnapshot>;
  active?: string;
  paneTree: PaneNode;
  activePane: number;
  panes: Record<number, { sessionId?: string; openId?: string }>;
  page: "chat" | "providers" | "extensions" | "settings" | "statistics";
  searchOpen: boolean;
  settingsCategory: SettingsCategory;
  /** Settings row (`data-setting`) to reveal once the settings page renders. */
  settingsFocus?: string;
  chatHistoryFile?: ChatHistoryFileEvent;
  chatHistoryImporting: boolean;
  /** Message to reveal once its chat is shown; nonce re-triggers the same target. */
  jump?: { sessionId: string; entryId: string; nonce: number };
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
  /** Images pasted into a chat that has not been created yet. */
  newChatImages: Record<string, DraftContent["images"]>;
  /** Non-image files dropped into a chat that has not been created yet. */
  newChatFiles: Record<string, NonNullable<DraftContent["files"]>>;
  /** Chats whose deletion is in flight: hidden now, restored if it fails. */
  deletingSessions: Record<string, true>;
  /**
   * Resends in flight by chat: the transcript is shown cut at the rewound
   * entry, with the new message pending, until the host's rewind lands.
   */
  rewinds: Record<string, { entryId: string; user: UserMessage }>;
  installed: InstalledPackage[];
  packageOps: Record<string, PackageOpStatus>;
  notices: (Notice & { id: string })[];
  noticeHistory: NoticeRecord[];
  login?: LoginState;
  providerSelection?: AccountTarget;
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
  providerUsage: [],
  cachedSidebar: !!launchCache,
  installedLoaded: false,
  sessions: launchCache?.sessions ?? {},
  snapshots: {},
  paneTree: { type: "pane", id: 1 },
  activePane: 1,
  panes: { 1: {} },
  addresses: {},
  pendingUI: [],
  terminals: {},
  extensionStatuses: {},
  extensionNotices: {},
  capabilities: {},
  page: "chat",
  searchOpen: false,
  settingsCategory: "general",
  chatHistoryImporting: false,
  installed: [],
  packageOps: {},
  notices: [],
  newChatDrafts: {},
  newChatImages: {},
  newChatFiles: {},
  deletingSessions: {},
  rewinds: {},
  noticeHistory: [],
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
type RequestNoticeHistory = (
  input: NoticeHistoryRequest,
) => Promise<NoticeHistorySnapshot>;
let requestNoticeHistory: RequestNoticeHistory | undefined;
let noticeRevision = -1;
const pendingAutoRead = new Set<string>();

export function connectNoticeHistory(
  request: RequestNoticeHistory,
  legacy?: NoticeRecord[],
) {
  requestNoticeHistory = request;
  return request({ type: "open", legacy }).then(receiveNoticeHistory);
}

export function receiveNoticeHistory(snapshot: NoticeHistorySnapshot) {
  if (snapshot.revision <= noticeRevision) return;
  noticeRevision = snapshot.revision;
  useStore.setState((state) => {
    const unread = new Set(
      snapshot.notices
        .filter((notice) => !notice.read)
        .map((notice) => notice.id),
    );
    const previous = new Set(state.noticeHistory.map((notice) => notice.id));
    return {
      noticeHistory: snapshot.notices,
      notices: state.notices.filter(
        (notice) => unread.has(notice.id) || !previous.has(notice.id),
      ),
    };
  });
}

function notifyHistoryFailure(error: unknown) {
  console.error("Cannot update notification history:", error);
  // Do not send an error about the history back through the failing history RPC.
  receiveNoticeToast(
    newNoticeRecord({ level: "error", message: String(error) }),
  );
}

export function markNoticeRead(id?: string) {
  const ids =
    id === undefined
      ? useStore
          .getState()
          .noticeHistory.filter((notice) => !notice.read)
          .map((notice) => notice.id)
      : [id];
  if (!ids.length) return;
  if (requestNoticeHistory) {
    void requestNoticeHistory({ type: "read", ids }).then(
      receiveNoticeHistory,
      notifyHistoryFailure,
    );
    return;
  }
  const selected = new Set(ids);
  useStore.setState((s) => ({
    noticeHistory: s.noticeHistory.map((notice) =>
      selected.has(notice.id) && !notice.read
        ? { ...notice, read: true }
        : notice,
    ),
  }));
}
export function clearNotices() {
  if (requestNoticeHistory) {
    void requestNoticeHistory({ type: "clear" }).then(
      receiveNoticeHistory,
      notifyHistoryFailure,
    );
    return;
  }
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
  if (requestNoticeHistory) {
    const ids = state.noticeHistory
      .filter(
        (notice) =>
          !notice.read && !pendingAutoRead.has(notice.id) && viewed(notice),
      )
      .map((notice) => notice.id);
    if (!ids.length) return;
    for (const id of ids) pendingAutoRead.add(id);
    void requestNoticeHistory({ type: "read", ids })
      .then(receiveNoticeHistory, (error) =>
        console.error("Cannot mark viewed notifications read:", error),
      )
      .finally(() => {
        for (const id of ids) pendingAutoRead.delete(id);
      });
    return;
  }
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
function viewingNotice(notice: Notice) {
  return (
    typeof document !== "undefined" &&
    isViewedNotice(
      notice,
      useStore.getState(),
      document.visibilityState === "visible",
      document.hasFocus(),
    )
  );
}
export function receiveNoticeToast(record: NoticeRecord) {
  const state = useStore.getState();
  if (
    record.read ||
    viewingNotice(record) ||
    state.noticeHistory.some((notice) => notice.id === record.id && notice.read)
  )
    return;
  useStore.setState({ notices: [...state.notices, record].slice(-3) });
  setTimeout(() => dismissNotice(record.id), 7000);
}
export function showNotice(notice: Notice) {
  const item: NewNotice = {
    ...notice,
    title: notice.session
      ? useStore.getState().snapshots[notice.session.id]?.info.title
      : undefined,
  };
  if (requestNoticeHistory) {
    void requestNoticeHistory({ type: "append", notice: item }).then(
      receiveNoticeHistory,
      (error) => {
        console.error("Cannot save notification:", error);
        receiveNoticeToast(newNoticeRecord(item));
      },
    );
    return;
  }
  // Storybook and standalone UI tests have no desktop host.
  const record = newNoticeRecord(item, viewingNotice(item));
  useStore.setState((s) => ({
    noticeHistory: [...s.noticeHistory, record].slice(-NOTICE_HISTORY_LIMIT),
  }));
  receiveNoticeToast(record);
}
export function showError(error: unknown) {
  showNotice({ message: String(error), level: "error" });
}

export function isStaleSessionRead(error: unknown) {
  const message = error instanceof Error ? error.message : error;
  return message === "STALE_SESSION_ADDRESS";
}

export function showSessionReadError(error: unknown) {
  // Runtime publications replace passive reads of a retired session address.
  if (!isStaleSessionRead(error)) showError(error);
}

export function receivePackageOp(op: PackageOpStatus, notify = true) {
  useStore.setState((s) => ({
    packageOps: { ...s.packageOps, [op.opId]: op },
  }));
  if (!notify || op.status === "running") return;
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
