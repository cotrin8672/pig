import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import {
  ChartColumn,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  PanelLeft,
  Puzzle,
  Settings2,
  Settings as SettingsIcon,
  X,
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
import { getT, useT } from "./i18n";
import { Markdown, MarkdownCwd, UserMessage } from "./MessageContent";
import { modelDividers } from "./model-dividers";
import { NotificationCenter } from "./NotificationCenter";
import { OptimisticMessages } from "./OptimisticMessages";
import { DisclosureScope, LazyDetails } from "./patterns/LazyDetails";
import { Button } from "./primitives/Button";
import { Spinner } from "./primitives/Spinner";
import { TextField } from "./primitives/TextField";
import "./model-dividers.css";
import { initEditMenu } from "./edit-menu";
import { MainViewport } from "./MainViewport";
import { McpAppScope } from "./McpAppPreview";
import { Notifications } from "./Notifications";
import { initNavigation, navigate } from "./navigation";
import { PaneWorkspace } from "./PaneWorkspace";
import { Providers } from "./Providers";
import { ProviderUsage } from "./ProviderUsage";
import { createPane } from "./pane-state";
import { ProviderIcon } from "./primitives/ProviderIcon";
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
import { type LoginState, showError, showNotice, useStore } from "./store";
import { ThinkingBlock, ToolBlock, ToolGroup, WorkToggle } from "./ToolBlock";
import { TooltipLayer, useTooltip } from "./Tooltip";
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
    !target.closest(".electrobun-webkit-app-region-no-drag") &&
    !!target.closest(".electrobun-webkit-app-region-drag")
  );
}
function renderPaneChat(snapshot: ChatSnapshot) {
  return <Chat key={chatViewKey(snapshot)} snapshot={snapshot} />;
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
        sidebarOpen
          ? "sidebar-toggle electrobun-webkit-app-region-no-drag"
          : undefined
      }
      aria-label={t["Toggle sidebar"]}
      aria-expanded={sidebarOpen}
      aria-controls="app-sidebar"
      hidden={!state.sidebarReady}
      style={liveSidebar}
      onClick={() => setSidebarOpen((open) => !open)}
    >
      <PanelLeft size={16} aria-hidden="true" />
    </button>
  );
  return (
    <TooltipLayer>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native drag handles; maximize is also available as a keyboard-accessible button. */}
      <div
        className={`app-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}
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
            "--window-opacity": state.windowOpacity,
            "--ds-sidebar-width": `${savedSidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <DynamicTheme />
        {sidebarOpen && sidebarToggle}
        <aside
          id="app-sidebar"
          className="sidebar"
          inert={!sidebarOpen}
          style={liveSidebar}
        >
          <header className="electrobun-webkit-app-region-drag">
            <strong className="sidebar-brand">
              <img src={appIcon} alt="" width={20} height={20} />
              pig
            </strong>
          </header>
          {state.sidebarReady && (
            <>
              <SidebarSessions />
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
          {!sidebarOpen && (
            <div className="window-controls window-sidebar-controls electrobun-webkit-app-region-no-drag">
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
          <span className="sidebar-update-dot" aria-hidden="true" />
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
          <span className="sidebar-update-dot" aria-hidden="true" />
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
      <NotificationCenter />
    </div>
  );
}

function SidebarPage({ page }: { page: string }) {
  if (page === "providers") return <Providers />;
  if (page === "extensions") return <Extensions />;
  if (page === "settings") return <Settings />;
  if (page === "statistics") return <Statistics />;
  return null;
}

function ConversationWorkspace({ active: shown }: { active: boolean }) {
  const {
    activeSnapshot: active,
    openingSnapshot,
    openingView,
    generalCwd,
  } = useStore(useShallow(selectConversationView));
  const idle = shown && !openingView && !active;
  // With no chat shown, the workspace is simply a new local draft. Drafts do
  // not start an SDK session until the first send, so this is free.
  useLayoutEffect(() => {
    if (idle && generalCwd) void openChat(generalCwd, undefined, false);
  }, [idle, generalCwd]);
  return (
    <PaneWorkspace renderChat={renderPaneChat}>
      {openingView ? (
        openingSnapshot ? (
          <Chat key={chatViewKey(openingSnapshot)} snapshot={openingSnapshot} />
        ) : (
          <ChatOpening />
        )
      ) : active ? (
        <Chat key={chatViewKey(active)} snapshot={active} />
      ) : null}
    </PaneWorkspace>
  );
}

function OAuthLoginDialog({ login }: { login: LoginState }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const { prompt, authUrl, deviceCode, event } = login;
  const name = useStore((state) => {
    const provider = state.bootstrap.providers.find(
      (p) => p.id === login.provider,
    );
    if (!provider) return login.provider;
    if (login.addAccount) return provider.name;
    return login.accountId
      ? (provider.accounts?.find((account) => account.id === login.accountId)
          ?.label ?? provider.name)
      : (provider.accountLabel ?? provider.name);
  });
  useEffect(() => {
    dialog.current?.show();
  }, []);
  useEffect(() => {
    if (prompt) {
      setValue("");
      if (prompt.type === "select")
        dialog.current
          ?.querySelector<HTMLButtonElement>(".oauth-option")
          ?.focus();
      else input.current?.focus();
    }
  }, [prompt]);
  function cancel() {
    rpc.send.cancelLogin({ loginId: login.loginId });
    useStore.setState({ login: undefined });
  }
  function answer(answer: string) {
    rpc.send.resolveLogin({ loginId: login.loginId, value: answer });
    useStore.setState({ login: { ...login, prompt: undefined } });
  }
  async function copy(text: string) {
    const t = getT();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setCopyError(undefined);
    } catch {
      setCopyError(t["Could not copy. Try opening the sign-in page again."]);
    }
  }
  const status = event && "message" in event ? event.message : t["Signing in…"];
  return (
    <dialog
      ref={dialog}
      className="oauth-dialog"
      aria-modal="false"
      aria-labelledby="oauth-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <div className="dialog-heading">
        <h2 id="oauth-title">
          <ProviderIcon provider={login.provider} size={22} />
          {login.method === "oauth" ? t.signIn(name) : t.setUp(name)}
        </h2>
        <button
          type="button"
          aria-label={t["Close sign-in dialog"]}
          onClick={cancel}
        >
          <X size={16} />
        </button>
      </div>
      {login.error ? (
        <div className="oauth-error" role="alert">
          <CircleAlert size={16} />
          {login.error}
        </div>
      ) : (
        <div className="oauth-status status" role="status">
          <Spinner size={14} />
          {status}
        </div>
      )}
      {!login.error && (
        <>
          {authUrl && (
            <div className="oauth-block">
              <p role={login.browserOpened === false ? "alert" : undefined}>
                {login.browserOpened === undefined
                  ? t["Opening your browser…"]
                  : login.browserOpened
                    ? t["Browser opened — finish signing in there"]
                    : t[
                        "Couldn't open your browser. Copy the link and open it manually."
                      ]}
              </p>
              {authUrl.instructions && (
                <p className="muted">{authUrl.instructions}</p>
              )}
              <div className="inline-actions">
                <button type="button" onClick={() => void copy(authUrl.url)}>
                  {copied === authUrl.url ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  {copied === authUrl.url ? t.Copied : t["Copy link"]}
                </button>
                <button
                  className="accent-link"
                  type="button"
                  onClick={() => rpc.send.openExternal({ url: authUrl.url })}
                >
                  <ExternalLink size={13} /> {t["Open again"]}
                </button>
              </div>
            </div>
          )}
          {deviceCode && (
            <div className="oauth-block">
              <p>{t["Enter this code on the verification page"]}</p>
              <button
                type="button"
                className="device-code"
                aria-label={t.copyCode(deviceCode.userCode)}
                onClick={() => void copy(deviceCode.userCode)}
              >
                {deviceCode.userCode}
                {copied === deviceCode.userCode ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
              </button>
              <button
                className="accent-link"
                type="button"
                onClick={() =>
                  rpc.send.openExternal({ url: deviceCode.verificationUri })
                }
              >
                <ExternalLink size={13} />
                {deviceCode.verificationUri}
              </button>
            </div>
          )}
          {prompt && (
            <div className="oauth-block">
              <p>{prompt.message}</p>
              {prompt.type === "select" ? (
                <div className="oauth-options">
                  {prompt.options.map((option) => (
                    <button
                      type="button"
                      className="oauth-option"
                      key={option.id}
                      onClick={() => answer(option.id)}
                    >
                      <span>{option.label}</span>
                      {option.description && (
                        <small className="muted">{option.description}</small>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  className="input-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Some text prompts only ask to press Enter (e.g. Bedrock credential chain).
                    if (value.trim() || prompt.type === "text")
                      answer(value.trim());
                  }}
                >
                  <TextField
                    ref={input}
                    aria-label={prompt.message}
                    autoComplete="off"
                    className={
                      prompt.type === "manual_code" ? "manual-code" : undefined
                    }
                    type={prompt.type === "secret" ? "password" : "text"}
                    placeholder={prompt.placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={!value.trim() && prompt.type !== "text"}
                  >
                    {t.Submit}
                  </Button>
                </form>
              )}
            </div>
          )}
          {event?.type === "info" &&
            event.links?.map((link) => (
              <button
                key={link.url}
                type="button"
                className="accent-link"
                onClick={() => rpc.send.openExternal({ url: link.url })}
              >
                {link.label || t["More information"]}
                <ExternalLink size={13} />
              </button>
            ))}
        </>
      )}
      {copyError && (
        <p className="error" role="alert">
          {copyError}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={cancel}>
          {login.error ? t.Close : t.Cancel}
        </button>
      </div>
    </dialog>
  );
}

const noTools: ChatSnapshot["transcript"]["tools"] = {};

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
              <Markdown text={block.text} streaming={streaming} />
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
        if (wasAtBottom) element.scrollTop = element.scrollHeight;
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
    if (!thread.current) return;
    // A native wheel can move the viewport before its React scroll event lands.
    if (!isThreadAtBottom(thread.current)) view.follow = false;
    prependScroll.current = captureThreadAnchor(thread.current);
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
    if (thread.current && !view.follow) thread.current.scrollTop = view.top;
  }, [view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Follow newly committed content only while the user is at the end.
  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
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
      {interleaveExtensionNotices(
        cut >= 0
          ? { ...transcript, records: transcript.records.slice(0, cut) }
          : transcript,
        notices ?? [],
      ).map((item) => {
        if ("notice" in item)
          return (
            <ExtensionNoticeLine key={item.notice.id} notice={item.notice} />
          );
        const { record, index } = item;
        if (index < hiddenRecords) return null;
        const key = liveIds.get(record.id) ?? record.id;
        const divider = dividers.get(record.id);
        if (!isVisibleRecord(record)) return null;
        const range = work.get(index);
        const folded = range !== undefined && !openWork[range.key];
        const toggle = range && !renderedWork.has(range.key) && (
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
        if (range) renderedWork.add(range.key);
        if (folded && index !== range.final)
          return toggle ? <Fragment key={key}>{toggle}</Fragment> : null;
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
      })}
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
      <span role="status" className="sr-status">
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
