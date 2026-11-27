import { selectPaneSession } from "../mainview/pane-selection";
import type { SendController, SendState } from "../mainview/send-controller";
import { showNotice, useStore } from "../mainview/store";
import { safeTerminalURL } from "../mainview/terminal-ui";
import type {
  ChatHistoryImportResult,
  LocalHistorySource,
} from "../shared/chat-history-import";
import type { UIReply } from "../shared/extension-ui";
import type {
  Appearance,
  ConversationHit,
  Effort,
  InstalledPackage,
  MarketPackage,
  ModelSelection,
} from "../shared/rpc-schema";
import type {
  DraftSyncParams,
  DraftSyncResult,
  SessionAddress,
} from "../shared/runtime-contract";
import { patchSettings, type SettingsPatch } from "../shared/settings";
import { supportedExtension } from "../shared/supported-extensions";
import { filePreview, localPreview } from "./settings/history-import-data";

// The canvas runs in a browser without Electrobun or a real session.
export const regenerate = async () => {};
let previewActive = false;
export function setStoryPreviewActive(active: boolean) {
  previewActive = active;
}
const unavailable = async () => {
  throw new Error(
    "Storybookの表示用プレビューです。送信・実行・保存は実アプリに接続していません。",
  );
};
export const ensureSessionRuntime = unavailable;
export const openChat = async (_cwd: string, id?: string) => {
  if (!previewActive) return;
  const state = useStore.getState();
  const snapshot = id && state.snapshots[id];
  if (!snapshot) {
    showNotice({
      level: "info",
      message: "新しいセッションの作成は、このプレビューでは接続していません。",
    });
    return;
  }
  useStore.setState({
    page: "chat",
    active: snapshot.info.id,
    ...selectPaneSession(state, snapshot.info.id),
  });
  return snapshot;
};
export const showPendingOpen = () => {};
export const openRemoteDraft = () => void openChat("");
export function updateAppearance(change: (current: Appearance) => Appearance) {
  if (previewActive)
    useStore.setState((state) => ({ appearance: change(state.appearance) }));
}
export const initRuntimeConnection = () => () => {};
export const initSessionLinks = () => () => {};
export const initSessionReadTracking = () => () => {};
export const refreshSessions = async () => {};
export const cancelOpening = () => {};
export const startOpeningChat = unavailable;
export const requestSelection = (
  _address: SessionAddress,
  request: () => Promise<ModelSelection>,
) => request();
export function updateUiPreferences(patch: Record<string, unknown>) {
  if (previewActive)
    useStore.setState((state) => ({
      bootstrap: {
        ...state.bootstrap,
        desktop: { ...state.bootstrap.desktop, ...patch },
      },
    }));
}
let queuedPreview: SendState | undefined;
export function setQueuedPreview(item?: SendState) {
  queuedPreview = item;
}
export const sends = {
  subscribe: () => () => {},
  getTick: () => 0,
  read: () => undefined,
  optimistic: () => [],
  pendingSteering: () => [],
  queued: (address: SessionAddress) =>
    queuedPreview &&
    queuedPreview.key.hostId === address.hostId &&
    queuedPreview.key.sessionId === address.sessionId &&
    queuedPreview.key.epoch === address.epoch
      ? [queuedPreview]
      : [],
  lookup: unavailable,
  send: unavailable,
  stop: unavailable,
  withdrawQueued: unavailable,
  reorderQueued: unavailable,
  steerQueued: unavailable,
} satisfies Pick<
  SendController,
  | "subscribe"
  | "getTick"
  | "read"
  | "optimistic"
  | "pendingSteering"
  | "queued"
  | "lookup"
  | "send"
  | "stop"
  | "withdrawQueued"
  | "reorderQueued"
  | "steerQueued"
>;
type ConversationSearch = (params: { query: string; refresh?: boolean }) => {
  hits: ConversationHit[];
  indexing: boolean;
};
let conversationSearch: ConversationSearch = () => ({
  hits: [],
  indexing: false,
});
/** Search palette stories answer content search from fixtures. */
export function setStoryConversationSearch(search: ConversationSearch) {
  conversationSearch = search;
}
export const forkChat = async () => {};
// History import stories answer like a local scan after a short delay.
function answerHistory(requestId: string, source?: LocalHistorySource) {
  setTimeout(() => {
    if (useStore.getState().chatHistoryFile?.requestId !== requestId) return;
    useStore.setState({
      chatHistoryFile: {
        requestId,
        source,
        preview: source ? localPreview(source) : filePreview,
      },
    });
  }, 900);
}
export const openChatLink = async () => {};
// Settings stories reuse real provider/model panels; writes stay in the story's store.
export const refresh = async () => {};
export function updateSettings(patch: SettingsPatch) {
  if (previewActive)
    useStore.setState((state) => ({
      settings: patchSettings(state.settings, patch),
    }));
}
const send = {
  listChatHistory: ({
    requestId,
    source,
  }: {
    requestId: string;
    source: LocalHistorySource;
  }) => answerHistory(requestId, source),
  chooseChatHistory: ({ requestId }: { requestId: string }) =>
    answerHistory(requestId),
  imageMenu: () => {},
  startLogin: () => {},
  cancelLogin: () => {},
  revealPath: () => {},
  openExternal: ({ url }: { url: string }) => {
    const safe = safeTerminalURL(url);
    if (!safe) return;
    const link = document.createElement("a");
    link.href = safe;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  },
};
const marketPackages: MarketPackage[] = [
  [
    "@ogulcancelik/pi-codex-subagents",
    "0.3.5",
    "ogulcancelik",
    4200,
    "Codex-shaped, session-scoped subagents for Pi.",
  ],
  [
    "pi-ask-user",
    "0.17.2",
    "edlsh",
    3100,
    "Ask the user with searchable choices and free-form answers.",
  ],
  [
    "pi-schedule-prompt",
    "0.5.1",
    "tintinweb",
    1800,
    "Schedule one-shot and recurring prompts into the chat.",
  ],
  [
    "@pi-archimedes/session-name",
    "2.15.0",
    "archimedes-codes",
    0,
    "Auto-generate session names after the first exchange.",
  ],
  [
    "pi-mcp-adapter",
    "2.1.0",
    "nicobailon",
    9800,
    "MCP adapter extension for pi.",
  ],
].map(([name, version, publisher, monthlyDownloads, description]) => ({
  name: name as string,
  version: version as string,
  publisher: publisher as string,
  monthlyDownloads: monthlyDownloads as number,
  description: description as string,
  date: "2026-01-01T00:00:00.000Z",
  types: ["extension"],
}));
const request = {
  async statistics() {
    return (await import("./statistics/statistics-data")).statisticsFixture;
  },
  async listSlashCommands() {
    return [];
  },
  async searchProjectPaths() {
    return [];
  },
  async completeSlashArguments() {
    return [];
  },
  async syncDraft(params: DraftSyncParams): Promise<DraftSyncResult> {
    if (!previewActive) return unavailable();
    return {
      applied: true,
      draft: { ...params.content, revision: params.expectedRevision + 1 },
    };
  },
  async setModel(
    params: SessionAddress & {
      provider: string;
      id: string;
      accountId?: string | null;
    },
  ): Promise<ModelSelection> {
    if (!previewActive) return unavailable();
    const state = useStore.getState(),
      snapshot = state.snapshots[params.sessionId];
    const model = state.bootstrap.models.find(
      (model) => model.provider === params.provider && model.id === params.id,
    );
    if (
      !snapshot ||
      !model ||
      snapshot.address.hostId !== params.hostId ||
      snapshot.address.epoch !== params.epoch
    )
      return unavailable();
    return {
      model,
      accountId: params.accountId ?? undefined,
      effort: model.effectiveDefaultEffort ?? "off",
      effortLevels: model.effortLevels ?? [],
    };
  },
  async setEffort(
    params: SessionAddress & { effort: Effort },
  ): Promise<ModelSelection> {
    if (!previewActive) return unavailable();
    const snapshot = useStore.getState().snapshots[params.sessionId];
    if (
      !snapshot ||
      snapshot.address.hostId !== params.hostId ||
      snapshot.address.epoch !== params.epoch
    )
      return unavailable();
    return {
      model: snapshot.model,
      accountId: snapshot.accountId,
      effort: params.effort,
      effortLevels: snapshot.effortLevels,
    };
  },
  async resolveExtensionUI(reply: UIReply) {
    if (!previewActive) return unavailable();
    useStore.setState((state) => ({
      pendingUI: state.pendingUI.filter(
        (request) =>
          request.uiId !== reply.uiId ||
          request.hostId !== reply.hostId ||
          request.sessionId !== reply.sessionId ||
          request.epoch !== reply.epoch,
      ),
    }));
  },
  async searchPackages({ supported }: { supported?: boolean }) {
    const items = supported
      ? marketPackages.filter((pkg) => supportedExtension(pkg.name))
      : marketPackages;
    return { items, total: items.length, pageSize: 50 };
  },
  async packagePreviews({ names }: { names: string[] }) {
    return Object.fromEntries(names.map((name) => [name, null]));
  },
  async listInstalled(): Promise<InstalledPackage[]> {
    return [];
  },
  async refreshProviderUsage() {},
  async importChatHistory(params: {
    ids: string[] | null;
  }): Promise<ChatHistoryImportResult> {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { copied: params.ids?.length ?? 12, skipped: 0, failed: 0 };
  },
  async setModelsEnabled() {},
  async setModelEnabled() {},
  async refreshProviderModels() {},
  async setModelOverride() {},
  async setDefaultEffort() {},
  async logout() {},
  async searchConversations(params: { query: string; refresh?: boolean }) {
    return conversationSearch(params);
  },
  async copyImage({ src }: { src: string }) {
    const blob = await (await fetch(src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  },
  async saveImage({ src }: { src: string }) {
    const link = document.createElement("a");
    link.href = src;
    link.download = "preview.png";
    link.click();
  },
};
// Unknown host operations fail closed; native messages never reach Electrobun.
export const rpc = {
  send: new Proxy(send, {
    get: (target, key) => target[key as keyof typeof target] ?? (() => {}),
  }),
  request: new Proxy(request, {
    get: (target, key) => target[key as keyof typeof target] ?? unavailable,
  }),
};
