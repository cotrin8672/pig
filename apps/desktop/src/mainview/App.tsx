import type { ToolCall } from "@earendil-works/pi-ai";
import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  PanelLeft,
  Plus,
  Puzzle,
  Settings2,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import {
  Fragment,
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
import { finishedWork, groupBlocks } from "../shared/tool-view";
import { ChatHeader } from "./ChatHeader";
import { ChatEmpty, ChatLayout } from "./ChatLayout";
import { ChatOpening, OpeningComposer, OpeningMessages } from "./ChatOpening";
import { Composer } from "./Composer";
import { CustomRecord } from "./CustomRecord";
import type { ChatSnapshot } from "./chat-snapshot";
import { addressKey, prependHistory, sameAddress } from "./chat-snapshot";
import { dataText, isVisibleRecord } from "./custom-data";
import { Extensions } from "./Extensions";
import {
  ExtensionNoticeLine,
  interleaveExtensionNotices,
} from "./extension-notices";
import { workingLabel } from "./extension-status";
import { fontFamilyValue } from "./font-family";
import { getT, useT } from "./i18n";
import { DisclosureScope, LazyDetails } from "./LazyDetails";
import { Markdown, UserMessage } from "./MessageContent";
import { modelDividers } from "./model-dividers";
import { NotificationCenter } from "./NotificationCenter";
import { OptimisticMessages } from "./OptimisticMessages";
import "./model-dividers.css";
import { Notifications } from "./Notifications";
import { initNavigation, navigate } from "./navigation";
import { ProviderIcon } from "./ProviderIcon";
import { Providers } from "./Providers";
import { ProviderUsage } from "./ProviderUsage";

import { ResponseError } from "./ResponseError";
import { ResponseFooter } from "./ResponseFooter";
import { createResponseFooterIndex } from "./response-footers";
import {
  initRuntimeConnection,
  initSessionLinks,
  initSessionReadTracking,
  openChat,
  refresh,
  rpc,
  sends,
} from "./rpc";
import { SessionPanel } from "./SessionPanel";
import { Settings } from "./Settings";

import { SidebarSessions } from "./SidebarSessions";
import { initShortcuts } from "./shortcuts";
import { type LoginState, showError, useStore } from "./store";
import { ThinkingBlock, ToolBlock, ToolGroup, WorkToggle } from "./ToolBlock";
import {
  isThreadAtBottom,
  pruneThreadViews,
  threadView,
} from "./thread-scroll";
import { UIRequestBroker } from "./UIRequestBroker";
import { selectAppView } from "./ui-selectors";
import { WindowTitlebar } from "./WindowTitlebar";

function isWindowDragTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    !target.closest(".electrobun-webkit-app-region-no-drag") &&
    !!target.closest(".electrobun-webkit-app-region-drag")
  );
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
  useEffect(initSessionLinks, []);
  useEffect(initSessionReadTracking, []);
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);
  const active = state.activeSnapshot;
  const openingSnapshot = state.openingSnapshot;
  const openingView = state.openingView;
  const displayedChat = openingView ? openingSnapshot : active;
  const connected = state.connected;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Native drag handles; maximize is also available as a keyboard-accessible button.
    <div
      className={`app-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}
      onContextMenu={(event) => event.preventDefault()}
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
          "--window-opacity":
            state.appearance.opacity[state.appearance.backdrop],
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        className="sidebar-toggle electrobun-webkit-app-region-no-drag"
        aria-label={t["Toggle sidebar"]}
        title={t["Toggle sidebar"]}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
        hidden={!state.sidebarReady}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <PanelLeft size={16} aria-hidden="true" />
      </button>
      <aside id="app-sidebar" className="sidebar" inert={!sidebarOpen}>
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
            <div className="sidebar-footer">
              <button
                type="button"
                className={`sidebar-icon ${state.page === "settings" ? "active" : ""}`}
                aria-label={t.Settings}
                title={t.Settings}
                onClick={() =>
                  navigate(state.page === "settings" ? "chat" : "settings")
                }
              >
                <SettingsIcon size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`sidebar-icon ${state.page === "providers" ? "active" : ""}`}
                aria-label={`${t.Providers}: ${state.login?.error || (state.login ? t["Signing in…"] : connected ? t.Connected : t["Not connected"])}`}
                title={`${t.Providers}: ${state.login?.error || (state.login ? t["Signing in…"] : connected ? t.Connected : t["Not connected"])}`}
                onClick={() =>
                  navigate(state.page === "providers" ? "chat" : "providers")
                }
              >
                <Settings2 size={16} aria-hidden="true" />
                <span
                  className={`sidebar-provider-dot ${state.login?.error ? "error" : state.login ? "busy" : connected ? "connected" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                className={`sidebar-icon ${state.page === "extensions" ? "active" : ""}`}
                aria-label={t.Extensions}
                title={t.Extensions}
                onClick={() =>
                  navigate(state.page === "extensions" ? "chat" : "extensions")
                }
              >
                <Puzzle size={16} aria-hidden="true" />
              </button>
              <NotificationCenter />
            </div>
          </>
        )}
      </aside>
      <main aria-busy={!state.initialized}>
        {!state.initialized ? (
          startupFailed && (
            <div className="welcome" role="alert">
              <p>{t.startupFailed}</p>
              <button type="button" onClick={initialize}>
                {t.Retry}
              </button>
            </div>
          )
        ) : state.page === "providers" ? (
          <Providers />
        ) : state.page === "extensions" ? (
          <Extensions />
        ) : state.page === "settings" ? (
          <Settings />
        ) : openingView ? (
          openingSnapshot ? (
            <Chat
              key={addressKey(openingSnapshot.address)}
              snapshot={openingSnapshot}
            />
          ) : (
            <ChatOpening />
          )
        ) : active ? (
          <Chat key={addressKey(active.address)} snapshot={active} />
        ) : (
          <div className="welcome">
            <h1>{t["What shall we build?"]}</h1>
            <p className="muted">
              {connected
                ? t["Start a chat, or add a project folder."]
                : t["Connect a provider to start building with pi."]}
            </p>
            <button
              className="primary"
              type="button"
              onClick={() =>
                connected
                  ? void openChat(state.generalCwd)
                  : navigate("providers")
              }
            >
              {connected ? <Plus size={16} /> : <Settings2 size={16} />}{" "}
              {connected ? t["New chat"] : t["Connect a provider"]}
            </button>
          </div>
        )}
      </main>
      <UIRequestBroker />
      <WindowTitlebar
        maximized={state.maximized}
        onAction={(action) => rpc.send.windowControl({ action })}
      >
        {state.initialized &&
          state.page === "chat" &&
          (openingView || displayedChat) && (
            <ChatHeader
              cwd={displayedChat?.info.cwd ?? state.openingTarget?.cwd}
              title={
                displayedChat
                  ? ((openingView ? state.openingTitle : state.activeTitle) ??
                    displayedChat.info.title)
                  : state.openingTarget?.id
                    ? (state.openingListedTitle ?? t["Opening chat…"])
                    : t["New chat"]
              }
            />
          )}
      </WindowTitlebar>
      {state.login && (
        <OAuthLoginDialog key={state.login.loginId} login={state.login} />
      )}
      <Notifications />
    </div>
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
          <LoaderCircle size={14} className="spinner" />
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
                  <input
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
                  <button
                    className="primary"
                    type="submit"
                    disabled={!value.trim() && prompt.type !== "text"}
                  >
                    {t.Submit}
                  </button>
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

export function Chat({ snapshot }: { snapshot: ChatSnapshot }) {
  const t = useT();
  const { info, transcript } = snapshot;
  const dividers = useMemo(
    () => modelDividers(transcript.records),
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
  const openMessage = useStore((s) => s.openMessage);
  const rewind = useStore((s) => s.rewinds[info.id]);
  const rewound = rewind
    ? transcript.records.findIndex(
        (record) => record.entryId === rewind.entryId,
      )
    : -1;
  // A resend replaces its message onward; a branch keeps the chosen entry.
  const cut = rewound >= 0 && rewind?.kind === "fork" ? rewound + 1 : rewound;
  const ja = useStore((s) => s.settings.language === "ja");
  const thread = useRef<HTMLDivElement>(null);
  const [view] = useState(() => threadView(snapshot.address.hostId, info.id));
  const prependScroll = useRef<{ top: number; height: number } | undefined>(
    undefined,
  );
  const followOptimistic = useCallback(() => {
    if (thread.current && view.follow)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [view]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  async function loadEarlier() {
    const cursor = transcript.history;
    if (!cursor?.before || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError(undefined);
    try {
      const page = await rpc.request.getSessionHistory({
        ...snapshot.address,
        revision: cursor.revision,
        before: cursor.before,
      });
      useStore.setState((state) => {
        const current = state.snapshots[info.id];
        if (!current || !sameAddress(current.address, snapshot.address))
          return {};
        const next = prependHistory(current, page, cursor.before as string);
        if (next === current) return {};
        if (thread.current) {
          prependScroll.current = {
            top: thread.current.scrollTop,
            height: thread.current.scrollHeight,
          };
          view.follow = false;
        }
        return { snapshots: { ...state.snapshots, [info.id]: next } };
      });
    } catch (error) {
      setHistoryError(String(error));
    } finally {
      setLoadingHistory(false);
    }
  }
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
  const echoed = new Set(transcript.records.map((record) => record.requestId));
  const pending = sends
    .optimistic(snapshot.address)
    .filter((send) => !echoed.has(send.key.requestId));
  if (!transcript.running)
    for (const send of pending) idleSends.add(send.key.requestId);
  const starting = pending.some((send) => idleSends.has(send.key.requestId));
  const work = useMemo(
    () =>
      finishedWork(
        transcript.records,
        transcript.running && !starting,
        isVisibleRecord,
      ),
    [transcript.records, transcript.running, starting],
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
  useLayoutEffect(() => {
    if (thread.current && !view.follow) thread.current.scrollTop = view.top;
  }, [view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Follow newly committed content only while the user is at the end.
  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    if (prependScroll.current) {
      const { top, height } = prependScroll.current;
      element.scrollTop = top + element.scrollHeight - height;
      prependScroll.current = undefined;
    } else if (view.follow) {
      element.scrollTop = element.scrollHeight;
    }
  }, [transcript, notices, view]);
  return (
    <ChatLayout
      threadRef={thread}
      onScroll={({ currentTarget }) => {
        view.follow = isThreadAtBottom(currentTarget);
        view.top = currentTarget.scrollTop;
      }}
      composer={
        readOnly ? (
          <OpeningComposer preview={snapshot} />
        ) : (
          <Composer snapshot={snapshot} />
        )
      }
      panel={
        readOnly ? undefined : (
          <SessionPanel
            key={addressKey(snapshot.address)}
            sessionId={snapshot.address.sessionId}
            state={snapshot.sessionUI}
            configError={snapshot.configError}
            onAction={(request) =>
              rpc.request.invokeSessionAction({
                ...snapshot.address,
                ...request,
              })
            }
            onActionError={showError}
            onReload={async () => {
              const result = await rpc.request.reloadAdapterConfig();
              if (result.state === "failed")
                throw new Error(
                  "Config reload failed; previous configuration is still active.",
                );
            }}
          />
        )
      }
    >
      {transcript.history?.before && (
        <button
          type="button"
          disabled={loadingHistory}
          onClick={() => void loadEarlier()}
        >
          {loadingHistory ? t["Loading…"] : t["Load earlier messages"]}
        </button>
      )}
      {historyError && (
        <p className="error" role="alert">
          {historyError}
        </p>
      )}
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
          return toggle ? <Fragment key={record.id}>{toggle}</Fragment> : null;
        if (record.kind !== "message" || record.message.role === "custom")
          return (
            <Fragment key={record.id}>
              {toggle}
              <CustomRecord record={record} />
            </Fragment>
          );
        const { id, message } = record;
        const live =
          transcript.running && index === transcript.records.length - 1;
        return (
          <div
            key={id}
            className="response-turn"
            data-record-id={id}
            data-record-order={record.order}
            tabIndex={-1}
          >
            {divider && (
              <div className="model-divider">
                <span className="model-divider-model">
                  <ProviderIcon provider={divider.from.provider} size={14} />
                  {divider.from.provider}/{divider.from.id}
                </span>
                →
                <span className="model-divider-model">
                  <ProviderIcon provider={divider.to.provider} size={14} />
                  {divider.to.provider}/{divider.to.id}
                </span>
              </div>
            )}
            <DisclosureScope id={id} values={view.details}>
              {toggle}
              <article className={`message ${message.role}`}>
                {message.role === "user" ? (
                  <UserMessage
                    message={message}
                    sessionId={info.id}
                    entryId={record.entryId}
                    disabled={readOnly || !snapshot.model}
                  />
                ) : message.role === "assistant" ? (
                  <>
                    {groupBlocks(
                      folded
                        ? message.content.filter(
                            (block) => block.type === "text",
                          )
                        : message.content,
                    ).map(({ start, blocks }) => {
                      const content = blocks[0];
                      return (
                        <DisclosureScope
                          key={`${content.type}-${start}`}
                          id={`block:${start}`}
                        >
                          <div
                            data-content-index={start}
                            data-tool-call-id={
                              blocks.length === 1 && content.type === "toolCall"
                                ? content.id
                                : undefined
                            }
                            tabIndex={-1}
                          >
                            {blocks.length > 1 ? (
                              <ToolGroup
                                calls={blocks.filter(
                                  (block): block is ToolCall =>
                                    block.type === "toolCall",
                                )}
                                tools={transcript.tools}
                                live={transcript.running}
                                cards={snapshot.sessionUI?.toolCards}
                              />
                            ) : content.type === "text" ? (
                              <div className="prose">
                                <Markdown
                                  text={content.text}
                                  streaming={
                                    live &&
                                    transcript.current === id &&
                                    !message.errorMessage
                                  }
                                />
                              </div>
                            ) : content.type === "thinking" ? (
                              <ThinkingBlock
                                text={content.thinking}
                                label={
                                  status?.hiddenThinkingLabel ?? t.Thinking
                                }
                                active={
                                  live && start === message.content.length - 1
                                }
                              />
                            ) : content.type === "toolCall" ? (
                              <ToolBlock
                                call={content}
                                state={transcript.tools[content.id]}
                                live={transcript.running}
                                card={
                                  snapshot.sessionUI?.toolCards?.[content.id]
                                }
                              />
                            ) : null}
                          </div>
                        </DisclosureScope>
                      );
                    })}
                    {(message.errorMessage ||
                      message.stopReason === "error") && (
                      <ResponseError
                        message={message.errorMessage ?? "Model request failed"}
                        stopReason={message.stopReason}
                      />
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
          </div>
        );
      })}
      {rewind?.kind === "resend" && cut >= 0 && (
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
      {transcript.running && (
        <p className="muted running" role="status">
          {workingLabel(status, t["Working…"])}
        </p>
      )}
    </ChatLayout>
  );
}
