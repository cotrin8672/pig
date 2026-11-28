import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import {
  ChartColumn,
  Link2,
  PanelLeft,
  Puzzle,
  Settings2,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useShallow } from "zustand/react/shallow";
import appIcon from "../../assets/icon.svg";
import { SIDEBAR_WIDTH } from "../shared/desktop-state";
import { createFinishedWorkIndex, groupBlocks } from "../shared/tool-view";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { VirtualTurns } from "./VirtualTurns";

declare const __VIRTUAL_TURNS__: boolean;

import { ChatOpening, OpeningComposer, OpeningMessages } from "./ChatOpening";
import { Compaction } from "./CompactionRenderer";
import { Composer } from "./Composer";
import { CustomRecord } from "./CustomRecord";
import type { ChatSnapshot } from "./chat-snapshot";
import { addressKey, chatViewKey, sameAddress } from "./chat-snapshot";
import { dataText, isVisibleRecord } from "./custom-data";
import { DynamicTheme } from "./DynamicTheme";
import { Extensions } from "./Extensions";
import {
  ExtensionNoticeLine,
  interleaveExtensionNotices,
} from "./extension-notices";
import { fontFamilyValue } from "./font-family";
import { SavedOutputContext } from "./HighlightedCode";
import { IndicatorDot } from "./IndicatorDot";
import { useT } from "./i18n";
import { AnswerMarkdown, MarkdownCwd, UserMessage } from "./MessageContent";
import { modelDividers } from "./model-dividers";
import { NotificationCenter } from "./NotificationCenter";
import { OAuthLoginDialog } from "./OAuthLoginDialog";
import { OptimisticMessages } from "./OptimisticMessages";
import { DisclosureScope, LazyDetails } from "./patterns/LazyDetails";
import "./model-dividers.css";
import { initEditMenu } from "./edit-menu";
import { MainViewport } from "./MainViewport";
import { McpAppScope } from "./McpAppPreview";
import { Notifications } from "./Notifications";
import { initNavigation, navigate } from "./navigation";
import { PaneWorkspace } from "./PaneWorkspace";
import { ProviderIcon } from "./ProviderIcon";
import { Providers } from "./Providers";
import { ProviderUsage } from "./ProviderUsage";
import { createPane } from "./pane-state";
import { RemoteConversation } from "./RemoteConversation";
import { RemotePairing } from "./RemotePairing";
import { RemoteSidebar } from "./RemoteSidebar";
import { ResponseError, RetryNotice } from "./ResponseError";
import { ResponseFooter } from "./ResponseFooter";
import { RunningIndicator } from "./RunningIndicator";
import { createResponseFooterIndex } from "./response-footers";
import { retriedAttempts } from "./retry-attempts";
import {
  initRuntimeConnection,
  initSessionLinks,
  initSessionReadTracking,
  openChat,
  refresh,
  rpc,
  sends,
  updateUiPreferences,
} from "./rpc";
import { SearchPalette } from "./SearchPalette";
import { Settings } from "./Settings";
import { SidebarResizer } from "./SidebarResizer";
import { SidebarSessions } from "./SidebarSessions";
import { Statistics } from "./Statistics";
import { scheduledUsers } from "./scheduled-prompt-model";
import { revealTarget } from "./search-target";
import { initShortcuts } from "./shortcuts";
import { showError, showNotice, useStore } from "./store";
import { ThinkingBlock, ToolBlock, ToolGroup, WorkToggle } from "./ToolBlock";
import { TooltipLayer, useTooltip } from "./Tooltip";
import { TurnRail } from "./TurnRail";
import {
  captureThreadAnchor,
  restoreThreadAnchor,
  type ThreadAnchor,
} from "./thread-anchor";
import {
  isThreadAtBottom,
  pruneThreadViews,
  threadView,
} from "./thread-scroll";
import { transcriptRequestIds } from "./transcript-requests";
import { initTypeToCompose } from "./type-to-compose";
import { UIRequestBroker } from "./UIRequestBroker";
import { selectAppView, selectConversationView } from "./ui-selectors";
import { useHistoryPaging } from "./use-history-paging";
import { WindowTitlebar } from "./WindowTitlebar";

function isWindowDragTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    !target.closest(".window-no-drag") &&
    !!target.closest(".window-drag-region")
  );
}
function renderPaneChat(snapshot: ChatSnapshot) {
  return <Chat key={chatViewKey(snapshot)} snapshot={snapshot} />;
}

// Slider previews only change the shell's background, not its React subtree.
function bindWindowOpacity(shell: HTMLDivElement | null) {
  if (!shell) return;
  let opacity: number | undefined;
  const apply = ({ appearance }: ReturnType<typeof useStore.getState>) => {
    const next = appearance.opacity[appearance.backdrop];
    if (next === opacity) return;
    opacity = next;
    shell.style.setProperty("--window-opacity", String(next));
  };
  apply(useStore.getState());
  return useStore.subscribe(apply);
}

export function App() {
  const t = useT();
  const state = useStore(useShallow(selectAppView));
  const fontFamily = useStore((state) => state.settings.fontFamily);
  const codeFontFamily = useStore((state) => state.settings.codeFontFamily);
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    style.setProperty(
      "--font-sans",
      fontFamilyValue(fontFamily, "var(--font-sans-default)"),
    );
    style.setProperty(
      "--font-mono",
      fontFamilyValue(codeFontFamily, "var(--font-mono-default)"),
    );
    return () => {
      style.removeProperty("--font-sans");
      style.removeProperty("--font-mono");
    };
  }, [fontFamily, codeFontFamily]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Collapsed sidebar slides over the content while the pointer rests on the
  // left edge, like the turn rail; it never resizes the conversation.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const sidebarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (sidebarOpen || peek) return;
    const notifications = sidebarRef.current?.querySelector<HTMLDetailsElement>(
      ".notification-center[open]",
    );
    if (notifications) notifications.open = false;
  }, [sidebarOpen, peek]);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!peek || !sidebar) return;
    let frame: number;
    const check = () => {
      if (
        !sidebar.matches(":hover") &&
        !document.querySelector(
          ".sidebar-peek-zone:hover, .sidebar-toggle:hover",
        ) &&
        !sidebar.querySelector(":popover-open, input:focus")
      )
        setPeek(false);
    };
    // Check after hover/focus has moved, including when a menu or edit ends.
    const recheck = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    recheck();
    document.addEventListener("pointerout", recheck, true);
    sidebar.addEventListener("toggle", recheck, true);
    sidebar.addEventListener("focusout", recheck);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerout", recheck, true);
      sidebar.removeEventListener("toggle", recheck, true);
      sidebar.removeEventListener("focusout", recheck);
    };
  }, [peek]);
  const savedSidebarWidth = useStore(
    (s) => s.bootstrap.desktop.sidebarWidth ?? SIDEBAR_WIDTH.default,
  );
  const [draggedSidebarWidth, setDraggedSidebarWidth] = useState<number>();
  const sidebarWidth = draggedSidebarWidth ?? savedSidebarWidth;
  // The shell's inherited variable keeps the saved width. While dragging, only
  // the elements that position against it get the live width: changing an
  // inherited variable on the shell restyles every conversation each move.
  const liveSidebar =
    draggedSidebarWidth === undefined
      ? undefined
      : ({
          "--ds-sidebar-width": `${draggedSidebarWidth}px`,
        } as React.CSSProperties);
  const [startupFailed, setStartupFailed] = useState(false);
  const initialize = useCallback(() => {
    setStartupFailed(false);
    void refresh().catch((error) => {
      console.error("App initialization failed", error);
      if (useStore.getState().initialized) showError(error);
      else setStartupFailed(true);
    });
  }, []);
  useEffect(() => {
    let pending = false;
    return useStore.subscribe((state, previous) => {
      if (state.snapshots === previous.snapshots || pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        pruneThreadViews(useStore.getState().snapshots);
      });
    });
  }, []);
  useEffect(initRuntimeConnection, []);
  useEffect(initialize, [initialize]);
  useEffect(initNavigation, []);
  useEffect(initShortcuts, []);
  // After shortcuts: a handled shortcut is defaultPrevented and never types.
  useEffect(initTypeToCompose, []);
  useEffect(initSessionLinks, []);
  useEffect(() => initEditMenu((request) => rpc.send.editMenu(request)), []);
  useEffect(initSessionReadTracking, []);
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);
  const connected = state.connected;
  const updateVersion = useStore((s) =>
    s.appUpdate?.status === "available" ? s.appUpdate.latest : undefined,
  );
  const settingsLabel = updateVersion
    ? `${t.Settings}: ${t.appUpdateAvailable(updateVersion)}`
    : t.Settings;
  // Open: top-right of the sidebar. Collapsed: left end of the Zen bar, so it
  // never covers the pane winbar.
  const sidebarToggle = (
    <button
      type="button"
      className={
        sidebarOpen || peek ? "sidebar-toggle window-no-drag" : undefined
      }
      aria-label={t["Toggle sidebar"]}
      aria-expanded={sidebarOpen}
      aria-controls="app-sidebar"
      hidden={!state.sidebarReady}
      style={liveSidebar}
      onClick={() => {
        setSidebarOpen((open) => !open);
        setPeek(false);
      }}
    >
      <PanelLeft size={16} aria-hidden="true" />
    </button>
  );
  return (
    <TooltipLayer>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native drag handles; maximize is also available as a keyboard-accessible button. */}
      <div
        ref={bindWindowOpacity}
        className={`app-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}
        data-peek={(!sidebarOpen && peek) || undefined}
        data-backdrop={state.backdrop}
        onMouseDown={(event) => {
          // Do not start a second native move while double-clicking a drag handle.
          if (event.detail === 2 && isWindowDragTarget(event.target))
            event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          if (isWindowDragTarget(event.target))
            rpc.send.windowControl({ action: "toggleMaximize" });
        }}
        style={
          {
            "--ds-sidebar-width": `${savedSidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <DynamicTheme />
        {(sidebarOpen || peek) && sidebarToggle}
        {!sidebarOpen && state.sidebarReady && (
          <div
            className="sidebar-peek-zone"
            aria-hidden="true"
            onPointerEnter={() => {
              clearTimeout(peekTimer.current);
              // A short rest, so reaching for the window edge does not open it.
              peekTimer.current = setTimeout(() => setPeek(true), 150);
            }}
            onPointerLeave={() => clearTimeout(peekTimer.current)}
          />
        )}
        <aside
          ref={sidebarRef}
          id="app-sidebar"
          className="sidebar"
          inert={!sidebarOpen && !peek}
          style={liveSidebar}
        >
          <header
            className={sidebarOpen ? "window-drag-region" : "window-no-drag"}
          >
            <strong className="sidebar-brand">
              <img src={appIcon} alt="" width={20} height={20} />
              pig
            </strong>
          </header>
          {state.sidebarReady && (
            <>
              <SidebarSessions after={<RemoteSidebar />} />
              <ProviderUsage />
              <SidebarFooter
                page={state.page}
                settingsLabel={settingsLabel}
                updateVersion={updateVersion}
                providerStatus={
                  state.login?.error ||
                  (state.login
                    ? t["Signing in…"]
                    : connected
                      ? t.Connected
                      : t["Not connected"])
                }
                providerDot={
                  state.login?.error
                    ? "error"
                    : state.login
                      ? "busy"
                      : connected
                        ? "connected"
                        : ""
                }
              />
            </>
          )}
        </aside>
        {sidebarOpen && state.sidebarReady && (
          <SidebarResizer
            width={sidebarWidth}
            style={liveSidebar}
            onResize={setDraggedSidebarWidth}
            onCommit={(width) => {
              setDraggedSidebarWidth(undefined);
              updateUiPreferences({ sidebarWidth: width });
            }}
            onCollapse={() => {
              setDraggedSidebarWidth(undefined);
              setSidebarOpen(false);
            }}
          />
        )}
        <MainViewport busy={!state.initialized}>
          {!state.initialized ? (
            startupFailed && (
              <div className="welcome" role="alert">
                <p>{t.startupFailed}</p>
                <button type="button" onClick={initialize}>
                  {t.Retry}
                </button>
              </div>
            )
          ) : (
            <>
              {/* Pages cover the chats instead of replacing them: rebuilding
                  every pane on each page switch costs seconds in long chats. */}
              <div
                className="main-layer"
                data-covered={state.page !== "chat" || undefined}
                inert={state.page !== "chat"}
              >
                <ConversationWorkspace active={state.page === "chat"} />
              </div>
              <SidebarPage page={state.page} />
            </>
          )}
        </MainViewport>
        <UIRequestBroker />
        <SearchPalette />
        <WindowTitlebar
          style={liveSidebar}
          maximized={state.maximized}
          onAction={(action) => rpc.send.windowControl({ action })}
          onSplit={createPane}
          splitDisabled={!state.initialized || state.page !== "chat"}
        >
          {!sidebarOpen && !peek && (
            <div className="window-controls window-sidebar-controls window-no-drag">
              {sidebarToggle}
            </div>
          )}
        </WindowTitlebar>
        {state.login && (
          <OAuthLoginDialog key={state.login.loginId} login={state.login} />
        )}
        <Notifications />
      </div>
    </TooltipLayer>
  );
}

function SidebarFooter({
  page,
  settingsLabel,
  updateVersion,
  providerStatus,
  providerDot,
}: {
  page: string;
  settingsLabel: string;
  updateVersion?: string;
  providerStatus: string;
  providerDot: string;
}) {
  const t = useT();
  const tooltip = useTooltip();
  const extensionUpdateAvailable = useStore((s) =>
    s.installed.some((pkg) => pkg.updateAvailable),
  );
  const tip = (label: string) => tooltip({ tier: "label", side: "top", label });
  const toggle = (target: Parameters<typeof navigate>[0]) =>
    navigate(page === target ? "chat" : target);
  return (
    <div className="sidebar-footer">
      <button
        type="button"
        className={`sidebar-icon ${page === "settings" ? "active" : ""}`}
        aria-label={settingsLabel}
        onClick={() => toggle("settings")}
        {...tip(t.Settings)}
      >
        <SettingsIcon size={16} aria-hidden="true" />
        {updateVersion && (
          <IndicatorDot state="unread" className="sidebar-update-dot" />
        )}
      </button>
      <button
        type="button"
        className={`sidebar-icon ${page === "providers" ? "active" : ""}`}
        aria-label={`${t.Providers}: ${providerStatus}`}
        onClick={() => toggle("providers")}
        {...tip(t.Providers)}
      >
        <Settings2 size={16} aria-hidden="true" />
        <span
          className={`sidebar-provider-dot ${providerDot}`}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        className={`sidebar-icon ${page === "extensions" ? "active" : ""}`}
        aria-label={
          extensionUpdateAvailable
            ? `${t.Extensions}: ${t["Update available"]}`
            : t.Extensions
        }
        onClick={() => toggle("extensions")}
        {...tip(t.Extensions)}
      >
        <Puzzle size={16} aria-hidden="true" />
        {extensionUpdateAvailable && (
          <IndicatorDot state="unread" className="sidebar-update-dot" />
        )}
      </button>
      <button
        type="button"
        className={`sidebar-icon ${page === "statistics" ? "active" : ""}`}
        aria-label={t.Statistics}
        aria-pressed={page === "statistics"}
        onClick={() => toggle("statistics")}
        {...tip(t.Statistics)}
      >
        <ChartColumn size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`sidebar-icon ${page === "pairing" ? "active" : ""}`}
        aria-label={t.Pairing}
        aria-pressed={page === "pairing"}
        onClick={() => toggle("pairing")}
        {...tip(t.Pairing)}
      >
        <Link2 size={16} aria-hidden="true" />
      </button>
      <NotificationCenter />
    </div>
  );
}

function SidebarPage({ page }: { page: string }) {
  if (page === "providers") return <Providers />;
  if (page === "extensions") return <Extensions />;
  if (page === "settings") return <Settings />;
  if (page === "statistics") return <Statistics />;
  if (page === "pairing") return <RemotePairing />;
  if (page === "remoteChat") return <RemoteConversation />;
  return null;
}

const ConversationWorkspace = memo(function ConversationWorkspace({
  active: shown,
}: {
  active: boolean;
}) {
  const t = useT();
  const {
    activeSnapshot: active,
    openingSnapshot,
    openingView,
    restoringChat,
    generalCwd,
  } = useStore(useShallow(selectConversationView));
  const idle = shown && !openingView && !restoringChat && !active;
  // With no chat shown, the workspace is simply a new local draft. Drafts do
  // not start an SDK session until the first send, so this is free.
  useLayoutEffect(() => {
    if (idle && generalCwd) void openChat(generalCwd, undefined, false);
  }, [idle, generalCwd]);
  const snapshot = openingView ? openingSnapshot : active;
  return (
    <PaneWorkspace renderChat={renderPaneChat}>
      {snapshot ? (
        renderPaneChat(snapshot)
      ) : openingView ? (
        <ChatOpening />
      ) : restoringChat ? (
        <p className="muted" role="status">
          {t["Opening chat…"]}
        </p>
      ) : null}
    </PaneWorkspace>
  );
});

const noTools: ChatSnapshot["transcript"]["tools"] = {};

function runningTurnKey({ info, transcript }: ChatSnapshot) {
  for (let i = transcript.records.length - 1; i >= 0; i--) {
    const record = transcript.records[i];
    if (record.kind === "message" && record.message.role === "user")
      return `${info.id}:${record.message.timestamp}`;
  }
  return info.id;
}

const AssistantBlocks = memo(function AssistantBlocks({
  content,
  folded,
  live,
  streaming,
  thinkingLabel,
  tools,
  toolsRunning,
  cards,
}: {
  content: AssistantMessage["content"];
  folded: boolean;
  live: boolean;
  streaming: boolean;
  thinkingLabel: string;
  tools: ChatSnapshot["transcript"]["tools"];
  toolsRunning: boolean;
  cards: NonNullable<ChatSnapshot["sessionUI"]>["toolCards"];
}) {
  return groupBlocks(
    folded ? content.filter((block) => block.type === "text") : content,
  ).map(({ start, blocks }) => {
    const block = blocks[0];
    return (
      <DisclosureScope key={`${block.type}-${start}`} id={`block:${start}`}>
        <div
          data-content-index={start}
          data-tool-call-id={
            blocks.length === 1 && block.type === "toolCall"
              ? block.id
              : undefined
          }
          tabIndex={-1}
        >
          {blocks.length > 1 ? (
            <ToolGroup
              calls={blocks.filter(
                (block): block is ToolCall => block.type === "toolCall",
              )}
              tools={tools}
              live={toolsRunning}
              cards={cards}
            />
          ) : block.type === "text" ? (
            <div className="prose">
              <AnswerMarkdown text={block.text} streaming={streaming} />
            </div>
          ) : block.type === "thinking" ? (
            <ThinkingBlock
              text={block.thinking}
              label={thinkingLabel}
              active={live && start === content.length - 1}
            />
          ) : block.type === "toolCall" ? (
            <ToolBlock
              call={block}
              state={tools[block.id]}
              live={toolsRunning}
              card={cards?.[block.id]}
            />
          ) : null}
        </div>
      </DisclosureScope>
    );
  });
});

export const Chat = memo(function Chat({
  snapshot,
}: {
  snapshot: ChatSnapshot;
}) {
  const t = useT();
  const { info, transcript } = snapshot;
  // Persistence replaces live IDs; keep their React keys so tool clocks survive.
  const liveIds = new Map(
    Object.entries(transcript.liveToEntry).map(([liveId, entryId]) => [
      entryId,
      liveId,
    ]),
  );
  const dividers = useMemo(
    () => modelDividers(transcript.records),
    [transcript.records],
  );
  const scheduled = useMemo(
    () => scheduledUsers(transcript.records),
    [transcript.records],
  );
  const retried = useMemo(
    () => retriedAttempts(transcript.records),
    [transcript.records],
  );
  const hasConversation =
    !!transcript.history?.before || transcript.records.some(isVisibleRecord);
  const [observedRun, setObservedRun] = useState(transcript.running);
  useEffect(() => {
    if (transcript.running) setObservedRun(true);
  }, [transcript.running]);
  const readOnly = snapshot.ready === false;
  const opening = useStore(
    (s) =>
      s.opening &&
      s.openingAddress &&
      sameAddress(s.openingAddress, snapshot.address),
  );
  const openMessage = useStore((s) =>
    readOnly && opening ? s.openMessage : undefined,
  );
  const rewind = useStore((s) => s.rewinds[info.id]);
  const cut = rewind
    ? transcript.records.findIndex(
        (record) => record.entryId === rewind.entryId,
      )
    : -1;
  const ja = useStore((s) => s.settings.language === "ja");
  const thread = useRef<HTMLElement>(null);
  const [view] = useState(() => threadView(snapshot.address.hostId, info.id));
  const prependScroll = useRef<ThreadAnchor | undefined>(undefined);
  const retainedAnchor = useRef<ThreadAnchor | undefined>(undefined);
  const resizeContent = useCallback(
    (wasAtBottom: boolean) => {
      const element = thread.current;
      if (!element) return;
      if (view.follow) {
        if (wasAtBottom && !isThreadAtBottom(element))
          element.scrollTop = element.scrollHeight;
      } else if (element.querySelector("[data-virtual-turns]")) {
        // Only the virtualizer restores an off-bottom reader's anchor.
        return;
      } else if (
        retainedAnchor.current?.record &&
        element.contains(retainedAnchor.current.record)
      ) {
        restoreThreadAnchor(element, retainedAnchor.current);
        view.top = element.scrollTop;
      } else {
        retainedAnchor.current = undefined;
      }
    },
    [view],
  );
  const followOptimistic = useCallback(
    () => resizeContent(true),
    [resizeContent],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new branch must not inherit a pending/retained viewport anchor.
  useLayoutEffect(() => {
    prependScroll.current = undefined;
    retainedAnchor.current = undefined;
  }, [transcript.history?.revision]);
  useEffect(() => {
    const element = thread.current;
    if (!element) return;
    const release = () => {
      retainedAnchor.current = undefined;
    };
    // Do not fight native wheel/touch/keyboard/scrollbar movement after a prepend.
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events)
      element.addEventListener(event, release, { passive: true });
    return () => {
      for (const event of events) element.removeEventListener(event, release);
    };
  }, []);
  const preparePrepend = useCallback(() => {
    if (!thread.current || thread.current.querySelector("[data-virtual-turns]"))
      return;
    // A native wheel can move the viewport before its React scroll event lands.
    if (!isThreadAtBottom(thread.current)) view.follow = false;
    // Keep the same reader across batches, including asynchronous Markdown
    // growth between them. User input clears this anchor above.
    prependScroll.current =
      retainedAnchor.current?.record &&
      thread.current.contains(retainedAnchor.current.record)
        ? retainedAnchor.current
        : captureThreadAnchor(thread.current);
  }, [view]);
  const { edge, hiddenRecords, loadingHistory, historyError, loadEarlier } =
    useHistoryPaging(snapshot, thread, preparePrepend);
  const status = useStore(
    (s) => s.extensionStatuses[addressKey(snapshot.address)],
  );
  const notices = useStore(
    (s) => s.extensionNotices[addressKey(snapshot.address)],
  );
  const [openWork, setOpenWork] = useState(view.work);
  const renderedWork = new Set<string>();
  useSyncExternalStore(sends.subscribe, sends.getTick, sends.getTick);
  // agent_start (running) arrives before the new user message. Until it lands,
  // a send made while idle means the trailing response is finished, not live.
  const idleSends = useRef(new Set<string>()).current;
  const pending = sends
    .optimistic(snapshot.address)
    .filter(
      (send) =>
        !transcriptRequestIds(transcript.records).has(send.key.requestId),
    );
  if (!transcript.running)
    for (const send of pending) idleSends.add(send.key.requestId);
  const starting = pending.some((send) => idleSends.has(send.key.requestId));
  const [indexWork] = useState(() => createFinishedWorkIndex(isVisibleRecord));
  const work = useMemo(
    () =>
      indexWork(
        transcript.records,
        transcript.running && !starting,
        transcript.history?.revision,
      ),
    [
      indexWork,
      transcript.records,
      transcript.running,
      starting,
      transcript.history?.revision,
    ],
  );
  const [indexFooters] = useState(createResponseFooterIndex);
  const footers = useMemo(
    () =>
      indexFooters(
        transcript.records,
        transcript.running,
        transcript.history?.revision,
      ),
    [
      indexFooters,
      transcript.records,
      transcript.running,
      transcript.history?.revision,
    ],
  );
  const footer = (index: number) => {
    const record = transcript.records[index];
    const response = footers.get(record.id);
    if (!response) return null;
    const { stats, user: userRecord } = response;
    const user = userRecord?.message;
    return (
      <ResponseFooter
        sessionId={info.id}
        entryId={readOnly ? undefined : record.entryId}
        userEntryId={userRecord?.entryId}
        stats={stats}
        user={user?.role === "user" ? user : undefined}
        canRegenerate={!readOnly}
      />
    );
  };
  const jump = useStore((s) =>
    s.jump?.sessionId === info.id ? s.jump : undefined,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-run as history pages, work folds and the transcript change.
  useEffect(() => {
    if (!jump || readOnly || hiddenRecords) return;
    const finish = () =>
      useStore.setState((s) =>
        s.jump?.nonce === jump.nonce ? { jump: undefined } : {},
      );
    const index = transcript.records.findIndex(
      (record) => record.entryId === jump.entryId,
    );
    if (index < 0) {
      // Search hits can be older than the loaded page; fetch until found.
      if (transcript.history?.before && !historyError) {
        if (!loadingHistory) void loadEarlier();
        return;
      }
      finish();
      showNotice({ message: t.searchMessageMissing, level: "info" });
      return;
    }
    const range = work.get(index);
    if (range && !openWork[range.key] && index !== range.final) {
      setOpenWork((open) => (view.work = { ...open, [range.key]: true }));
      return;
    }
    const id = transcript.records[index].id;
    retainedAnchor.current = undefined;
    view.follow = false;
    return revealTarget(
      () =>
        thread.current?.querySelector(`[data-record-id="${CSS.escape(id)}"]`) ??
        null,
      finish,
    );
  }, [
    jump,
    readOnly,
    transcript,
    loadingHistory,
    historyError,
    openWork,
    hiddenRecords,
  ]);
  useLayoutEffect(() => {
    if (
      thread.current &&
      !view.follow &&
      !thread.current.querySelector("[data-virtual-turns]")
    )
      thread.current.scrollTop = view.top;
  }, [view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Follow newly committed content only while the user is at the end.
  useLayoutEffect(() => {
    const element = thread.current;
    if (!element || element.querySelector("[data-virtual-turns]")) return;
    if (prependScroll.current) {
      if (view.follow) element.scrollTop = element.scrollHeight;
      else restoreThreadAnchor(element, prependScroll.current);
      retainedAnchor.current = view.follow ? undefined : prependScroll.current;
      view.top = element.scrollTop;
      prependScroll.current = undefined;
    } else if (view.follow) {
      element.scrollTop = element.scrollHeight;
    }
  }, [transcript, notices, view, hiddenRecords]);
  const renderTurns = (
    items: ReturnType<typeof interleaveExtensionNotices>,
    renderRow: (
      item: (typeof items)[number],
      key: string,
      toggle: boolean,
    ) => React.ReactElement,
  ) => {
    const keys: string[] = [];
    const toggles = new Set<number>();
    const rows = items.filter((item) => {
      if ("notice" in item) {
        keys.push(item.notice.id);
        return true;
      }
      const { record, index } = item;
      if (index < hiddenRecords || !isVisibleRecord(record)) return false;
      const range = work.get(index);
      if (range && !renderedWork.has(range.key)) {
        renderedWork.add(range.key);
        toggles.add(keys.length);
      } else if (range && !openWork[range.key] && index !== range.final)
        return false;
      keys.push(liveIds.get(record.id) ?? record.id);
      return true;
    });
    const render = (i: number) => renderRow(rows[i], keys[i], toggles.has(i));
    if (typeof __VIRTUAL_TURNS__ === "undefined" || !__VIRTUAL_TURNS__)
      return keys.map((_, i) => render(i));
    const target =
      jump &&
      transcript.records.find((record) => record.entryId === jump.entryId)?.id;
    return (
      <VirtualTurns
        follow={view}
        thread={thread}
        keys={keys}
        inlineLimit={40}
        renderRow={render}
        target={target ? (liveIds.get(target) ?? target) : undefined}
      />
    );
  };
  const layout = (
    <ChatLayout
      threadRef={thread}
      onContentResize={resizeContent}
      onScroll={({ currentTarget }) => {
        view.follow = isThreadAtBottom(currentTarget);
        if (view.follow) retainedAnchor.current = undefined;
        view.top = currentTarget.scrollTop;
      }}
      onJumpToBottom={() => {
        retainedAnchor.current = undefined;
        view.follow = true;
      }}
      rail={
        !readOnly && (
          <TurnRail
            sessionId={info.id}
            records={transcript.records}
            thread={thread}
          />
        )
      }
      composer={
        readOnly ? (
          <OpeningComposer preview={snapshot} />
        ) : (
          <Composer snapshot={snapshot} annotationRoot={thread} />
        )
      }
    >
      <div ref={edge} className="history-edge" aria-hidden="true" />
      {readOnly && opening && openMessage && (
        <p className="muted" role="status">
          {openMessage}
        </p>
      )}
      {!hasConversation && <ChatEmpty cwd={info.cwd} />}
      {renderTurns(
        interleaveExtensionNotices(
          cut >= 0
            ? { ...transcript, records: transcript.records.slice(0, cut) }
            : transcript,
          notices ?? [],
        ),
        (item, key, showToggle) => {
          if ("notice" in item)
            return (
              <ExtensionNoticeLine key={item.notice.id} notice={item.notice} />
            );
          const { record, index } = item;
          const divider = dividers.get(record.id);
          const range = work.get(index);
          const folded = range !== undefined && !openWork[range.key];
          const toggle = range && showToggle && (
            <WorkToggle
              open={!folded}
              tools={range.tools}
              onToggle={() =>
                setOpenWork(
                  (open) =>
                    (view.work = {
                      ...open,
                      [range.key]: !open[range.key],
                    }),
                )
              }
            />
          );
          if (folded && index !== range.final)
            return <Fragment key={key}>{toggle}</Fragment>;
          if (record.kind !== "message" || record.message.role === "custom")
            return (
              <Fragment key={key}>
                {toggle}
                <CustomRecord record={record} />
              </Fragment>
            );
          const { id, message } = record;
          const live =
            transcript.running && index === transcript.records.length - 1;
          // Don't invalidate text-only or folded blocks with unrelated tool updates.
          const hasTools =
            !folded &&
            message.role === "assistant" &&
            message.content.some((block) => block.type === "toolCall");
          return (
            <div
              key={key}
              className="response-turn"
              data-record-id={id}
              data-record-order={record.order}
              tabIndex={-1}
            >
              {divider && (
                <div className="model-divider">
                  <span
                    className="model-divider-model"
                    aria-description={`${divider.from.provider}/${divider.from.id}`}
                  >
                    <ProviderIcon provider={divider.from.provider} size={14} />
                    {divider.from.id}
                  </span>
                  →
                  <span
                    className="model-divider-model"
                    aria-description={`${divider.to.provider}/${divider.to.id}`}
                  >
                    <ProviderIcon provider={divider.to.provider} size={14} />
                    {divider.to.id}
                  </span>
                </div>
              )}
              <SavedOutputContext.Provider value={Boolean(record.entryId)}>
                <DisclosureScope id={id} values={view.details}>
                  {toggle}
                  <article className={`message ${message.role}`}>
                    {message.role === "user" ? (
                      <UserMessage
                        message={message}
                        sessionId={info.id}
                        entryId={record.entryId}
                        disabled={readOnly || !snapshot.model}
                        scheduled={scheduled.get(id)}
                      />
                    ) : message.role === "assistant" ? (
                      <>
                        <AssistantBlocks
                          content={message.content}
                          folded={folded}
                          live={live}
                          streaming={
                            live &&
                            transcript.current === id &&
                            !message.errorMessage
                          }
                          thinkingLabel={
                            status?.hiddenThinkingLabel ?? t.Thinking
                          }
                          tools={hasTools ? transcript.tools : noTools}
                          toolsRunning={hasTools && transcript.running}
                          cards={
                            hasTools ? snapshot.sessionUI?.toolCards : undefined
                          }
                        />
                        {retried.has(id) ? (
                          <RetryNotice
                            attempt={retried.get(id) ?? 1}
                            message={
                              message.errorMessage ?? "Model request failed"
                            }
                            waiting={
                              snapshot.retry?.attempt === retried.get(id) &&
                              id === [...retried.keys()].at(-1)
                                ? snapshot.retry
                                : undefined
                            }
                          />
                        ) : (
                          (message.errorMessage ||
                            message.stopReason === "error") && (
                            <ResponseError
                              message={
                                message.errorMessage ?? "Model request failed"
                              }
                              stopReason={message.stopReason}
                            />
                          )
                        )}
                      </>
                    ) : (
                      <CustomRecord record={record} />
                    )}
                    {record.details !== undefined && (
                      <DisclosureScope id="record-details">
                        <LazyDetails name="details" summary="Details">
                          {() => <pre>{dataText(record.details)}</pre>}
                        </LazyDetails>
                      </DisclosureScope>
                    )}
                  </article>
                  {footer(index)}
                </DisclosureScope>
              </SavedOutputContext.Provider>
            </div>
          );
        },
      )}
      {rewind && cut >= 0 && (
        <div className="response-turn">
          <article className="message user">
            <UserMessage message={rewind.user} sessionId={info.id} disabled />
          </article>
        </div>
      )}
      {readOnly && <OpeningMessages />}
      <OptimisticMessages snapshot={snapshot} onChange={followOptimistic} />
      {snapshot.failure &&
        !transcript.records.some(
          (record) =>
            record.kind === "message" &&
            record.message.role === "assistant" &&
            record.message.stopReason === "error" &&
            (record.message.errorMessage ?? "Model request failed") ===
              snapshot.failure,
        ) && <ResponseError message={snapshot.failure} />}
      {readOnly && !opening && snapshot.failure && (
        <button
          type="button"
          onClick={() => void openChat(info.cwd, info.id).catch(showError)}
        >
          {ja ? "実行環境の準備を再試行" : "Retry runtime initialization"}
        </button>
      )}
      <span role="status" className="sr-only">
        {observedRun &&
          !transcript.running &&
          !snapshot.failure &&
          (snapshot.aborted ? t.Stopped : t.responseComplete)}
      </span>
      {transcript.compaction && (
        <Compaction active reason={transcript.compaction.reason} />
      )}
      {transcript.running && !transcript.compaction && (
        <RunningIndicator
          turnKey={runningTurnKey(snapshot)}
          symbol={status?.workingSymbol}
          message={status?.workingMessage}
        />
      )}
    </ChatLayout>
  );
  return (
    <MarkdownCwd.Provider value={info.cwd}>
      <McpAppScope address={snapshot.address}>{layout}</McpAppScope>
    </MarkdownCwd.Provider>
  );
});
