import type { ToolCall } from "@earendil-works/pi-ai";
import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Folder,
  LoaderCircle,
  Minus,
  MoveHorizontal,
  PanelLeft,
  Plus,
  Puzzle,
  Settings2,
  Settings as SettingsIcon,
  Square,
  X,
} from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_WIDTH } from "../shared/chat-width";
import { filterModels } from "../shared/models";
import { finishedWork, groupBlocks } from "../shared/tool-view";
import { responseStats } from "../shared/transcript";
import { ChatOpening } from "./ChatOpening";
import { ChatWidthHandles, useChatWidth } from "./ChatWidth";
import { Composer } from "./Composer";
import { CustomRecord } from "./CustomRecord";
import type { ChatSnapshot } from "./chat-snapshot";
import { addressKey } from "./chat-snapshot";
import { customPresentation, dataText } from "./custom-data";
import { DraftRecovery } from "./DraftRecovery";
import { Extensions } from "./Extensions";
import { workingLabel } from "./extension-status";
import { getT, useT } from "./i18n";
import { Markdown, UserMessage } from "./MessageContent";
import { NotificationCenter } from "./NotificationCenter";
import { Notifications } from "./Notifications";
import { initNavigation, navigate, navigationRevision } from "./navigation";
import { ProviderIcon, useProviderName } from "./ProviderIcon";
import { Providers } from "./Providers";
import { ResponseFooter } from "./ResponseFooter";
import {
  initRuntimeConnection,
  initSessionLinks,
  initSessionReadTracking,
  openChat,
  refresh,
  refreshSessions,
  rpc,
} from "./rpc";
import { SessionPanel } from "./SessionPanel";
import { Settings } from "./Settings";
import { SidebarSessions } from "./SidebarSessions";
import { initShortcuts } from "./shortcuts";
import { type LoginState, showError, useStore } from "./store";
import { ThinkingBlock, ToolBlock, ToolGroup, WorkToggle } from "./ToolBlock";
import { isThreadAtBottom } from "./thread-scroll";
import { UIRequestBroker } from "./UIRequestBroker";

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

function isWindowDragTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    !target.closest(".electrobun-webkit-app-region-no-drag") &&
    !!target.closest(".electrobun-webkit-app-region-drag")
  );
}
export function App() {
  const t = useT();
  const state = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(initRuntimeConnection, []);
  useEffect(() => {
    void refresh().catch(showError);
  }, []);
  useEffect(initNavigation, []);
  useEffect(initShortcuts, []);
  useEffect(initSessionLinks, []);
  useEffect(initSessionReadTracking, []);
  useEffect(() => {
    document.documentElement.lang = state.settings.language;
  }, [state.settings.language]);
  const active = state.active ? state.snapshots[state.active] : undefined;
  const connected = state.bootstrap.models.length > 0;
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
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <PanelLeft size={16} aria-hidden="true" />
      </button>
      <aside id="app-sidebar" className="sidebar" inert={!sidebarOpen}>
        <header className="electrobun-webkit-app-region-drag">
          <strong>pig</strong>
        </header>
        <SidebarSessions />
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
      </aside>
      <main>
        <div className="window-drag-strip electrobun-webkit-app-region-drag" />
        {state.page === "providers" ? (
          <Providers />
        ) : state.page === "extensions" ? (
          <Extensions />
        ) : state.page === "settings" ? (
          <Settings />
        ) : state.opening &&
          state.openingViewRevision === navigationRevision ? (
          <ChatOpening cwd={state.openingNewCwd} />
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
                  ? void openChat(state.bootstrap.generalCwd)
                  : navigate("providers")
              }
            >
              {connected ? <Plus size={16} /> : <Settings2 size={16} />}{" "}
              {connected ? t["New chat"] : t["Connect a provider"]}
            </button>
          </div>
        )}
      </main>
      <DraftRecovery />
      <UIRequestBroker />
      {/* Mouse clicks must not leave a focus ring behind, like native caption buttons. */}
      <div
        className="window-controls electrobun-webkit-app-region-no-drag"
        role="toolbar"
        aria-label={t["Window controls"]}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          aria-label={t.Minimize}
          title={t.Minimize}
          onClick={() => rpc.send.windowControl({ action: "minimize" })}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label={state.maximized ? t.Restore : t.Maximize}
          title={state.maximized ? t.Restore : t.Maximize}
          onClick={() => rpc.send.windowControl({ action: "toggleMaximize" })}
        >
          {state.maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label={t["Close window"]}
          title={t.Close}
          onClick={() => rpc.send.windowControl({ action: "close" })}
        >
          <X size={15} />
        </button>
      </div>
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
  const name = useProviderName(login.provider);
  useEffect(() => {
    dialog.current?.showModal();
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
      aria-labelledby="oauth-title"
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
              <p>{t["Browser opened — finish signing in there"]}</p>
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

function Chat({ snapshot }: { snapshot: ChatSnapshot }) {
  const t = useT();
  const { info, transcript } = snapshot;
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const general = useStore((s) => s.bootstrap.generalCwd === info.cwd);
  const models = filterModels(available, disabledModels);
  const { width, setWidth } = useChatWidth();
  const thread = useRef<HTMLDivElement>(null);
  const followThread = useRef(true);
  const status = useStore(
    (s) => s.extensionStatuses[addressKey(snapshot.address)],
  );
  const [openWork, setOpenWork] = useState<Record<string, boolean>>({});
  const work = finishedWork(
    transcript.records,
    transcript.running,
    (record) => !customPresentation(record).hidden,
  );
  const turns = transcript.records.filter(
    (record) => record.kind === "message",
  );
  // A response ends where the next turn is not another assistant step.
  const footer = (index: number) => {
    const record = transcript.records[index];
    const messageIndex = turns.findIndex((turn) => turn.id === record.id);
    if (messageIndex < 0) return null;
    const next = turns
      .slice(messageIndex + 1)
      .find(
        (turn) =>
          turn.message.role === "assistant" || turn.message.role === "user",
      )?.message.role;
    if (next ? next === "assistant" : transcript.running) return null;
    const stats = responseStats(turns, messageIndex);
    if (!stats) return null;
    const userRecord =
      stats.userIndex === undefined ? undefined : turns[stats.userIndex];
    const user = userRecord?.message;
    return (
      <ResponseFooter
        sessionId={info.id}
        entryId={record.entryId}
        userEntryId={userRecord?.entryId}
        stats={stats}
        user={user?.role === "user" ? user : undefined}
        canRegenerate={!transcript.running}
      />
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Transcript changes require scrolling its updated DOM before paint.
  useLayoutEffect(() => {
    if (thread.current && followThread.current)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [transcript]);
  return (
    <div className="session-layout">
      <div
        className="chat-shell"
        style={{ "--chat-width": `${width}px` } as React.CSSProperties}
      >
        <ChatWidthHandles width={width} onChange={setWidth} />
        <header className="chat-header">
          <div className="chat-heading">
            <Folder size={14} />
            <span>{general ? t.Chats : basename(info.cwd)}</span>
            <small>{status?.title ?? info.title}</small>
          </div>
          <div className="chat-header-actions">
            <button
              type="button"
              aria-label={t["Reset chat width"]}
              title={t["Reset chat width (drag either edge to resize)"]}
              onClick={() => setWidth(DEFAULT_CHAT_WIDTH)}
            >
              <MoveHorizontal size={16} />
            </button>
            <button
              type="button"
              title={t["Close chat (history is kept)"]}
              aria-label={t["Close chat"]}
              onClick={() => {
                void rpc.request
                  .closeSession(snapshot.address)
                  .then(() => refreshSessions(), showError);
                navigate("chat", null);
              }}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div
          ref={thread}
          className="thread-scroll"
          onScroll={(event) => {
            followThread.current = isThreadAtBottom(event.currentTarget);
          }}
        >
          <div className="transcript">
            {!transcript.records.length && (
              <div className="chat-empty">
                <h1>{t["What shall we build?"]}</h1>
                <p className="muted">
                  {general
                    ? t["Chat without a project"]
                    : t.workingIn(info.cwd)}
                </p>
                {!models.length && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => navigate("providers")}
                  >
                    <Settings2 size={14} />{" "}
                    {available.length
                      ? t["Enable models"]
                      : t["Connect a provider"]}
                  </button>
                )}
              </div>
            )}
            {transcript.records.map((record, index) => {
              // Session metadata (model/thinking-level changes, hidden entries) is not conversation.
              if (customPresentation(record).hidden) return null;
              const range = work.get(index);
              const folded = range !== undefined && !openWork[range.key];
              const toggle = range?.first === index && (
                <WorkToggle
                  open={!folded}
                  tools={range.tools}
                  onToggle={() =>
                    setOpenWork((open) => ({
                      ...open,
                      [range.key]: !open[range.key],
                    }))
                  }
                />
              );
              if (folded && index !== range.final)
                return toggle ? (
                  <Fragment key={record.id}>{toggle}</Fragment>
                ) : null;
              if (record.kind !== "message" || record.message.role === "custom")
                return (
                  <Fragment key={record.id}>
                    {toggle}
                    <CustomRecord record={record} />
                  </Fragment>
                );
              const { id, message } = record;
              // Tool results render inside their tool call block.
              if (message.role === "toolResult") return null;
              const live =
                transcript.running && index === transcript.records.length - 1;
              return (
                <div key={id} className="response-turn">
                  {toggle}
                  <article className={`message ${message.role}`}>
                    {message.role === "user" ? (
                      <UserMessage
                        message={message}
                        sessionId={info.id}
                        entryId={record.entryId}
                        disabled={transcript.running || !snapshot.model}
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
                            <div key={`${content.type}-${start}`}>
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
                                  <Markdown text={content.text} />
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
                          );
                        })}
                        {message.errorMessage && (
                          <p
                            className={
                              message.stopReason === "aborted"
                                ? "muted"
                                : "error"
                            }
                          >
                            {t.responseError(
                              message.stopReason,
                              message.errorMessage,
                            )}
                          </p>
                        )}
                      </>
                    ) : (
                      <CustomRecord record={record} />
                    )}
                    {record.details !== undefined && (
                      <details>
                        <summary>Details</summary>
                        <pre>{dataText(record.details)}</pre>
                      </details>
                    )}
                  </article>
                  {footer(index)}
                </div>
              );
            })}
            {snapshot.failure && (
              <p className="error" role="alert">
                {snapshot.failure}
              </p>
            )}
            {transcript.running && (
              <p className="muted running" role="status">
                {workingLabel(status, t["Working…"])}
              </p>
            )}
          </div>
        </div>
        <SessionPanel
          key={addressKey(snapshot.address)}
          sessionId={snapshot.address.sessionId}
          state={snapshot.sessionUI}
          configError={snapshot.configError}
          onAction={(request) =>
            rpc.request.invokeSessionAction({ ...snapshot.address, ...request })
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
        <Composer snapshot={snapshot} />
      </div>
    </div>
  );
}
