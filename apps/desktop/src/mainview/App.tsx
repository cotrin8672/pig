import {
  Check,
  Circle,
  CircleAlert,
  Copy,
  ExternalLink,
  Folder,
  LoaderCircle,
  Minus,
  MoveHorizontal,
  Plus,
  Puzzle,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_WIDTH } from "../shared/chat-width";
import { filterModels } from "../shared/models";
import type { Snapshot } from "../shared/rpc-schema";
import { responseStats } from "../shared/transcript";
import { ChatWidthHandles, useChatWidth } from "./ChatWidth";
import { Composer } from "./Composer";
import { ExtensionDialogs } from "./ExtensionDialogs";
import { Extensions } from "./Extensions";
import { getT, useT } from "./i18n";
import {
  Markdown,
  MessageContent,
  ToolResultContent,
  UserMessage,
} from "./MessageContent";
import { NotificationCenter } from "./NotificationCenter";
import { Notifications } from "./Notifications";
import { initNavigation, navigate } from "./navigation";
import { ProviderIcon, useProviderName } from "./ProviderIcon";
import { Providers } from "./Providers";
import { ResponseFooter } from "./ResponseFooter";
import {
  initSessionLinks,
  initSessionReadTracking,
  openChat,
  refresh,
  refreshSessions,
  rpc,
} from "./rpc";
import { Settings } from "./Settings";
import { SidebarSessions } from "./SidebarSessions";
import { initShortcuts } from "./shortcuts";
import { type LoginState, showError, useStore } from "./store";
import { TerminalDialog } from "./TerminalDialog";

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
      className="app-shell"
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
      <aside className="sidebar">
        <header className="electrobun-webkit-app-region-drag">
          <strong>pig</strong>
          <div className="sidebar-actions">
            <NotificationCenter />
          </div>
        </header>
        <SidebarSessions />
        <button
          type="button"
          className={`providers-nav ${state.page === "providers" ? "active" : ""}`}
          onClick={() => navigate("providers")}
        >
          <Settings2 size={16} />
          <span className="nav-label">
            {t.Providers}{" "}
            <small
              className={
                state.login?.error
                  ? "error"
                  : state.login
                    ? "muted"
                    : connected
                      ? "connected"
                      : "muted"
              }
            >
              {state.login?.error ? (
                <CircleAlert size={12} />
              ) : state.login ? (
                <LoaderCircle size={12} className="spinner" />
              ) : (
                <Circle size={7} fill="currentColor" />
              )}
              {state.login?.error ||
                (state.login
                  ? t["Signing in…"]
                  : connected
                    ? t.Connected
                    : t["Not connected"])}
            </small>
          </span>
        </button>
        <button
          type="button"
          className={`providers-nav ${state.page === "extensions" ? "active" : ""}`}
          onClick={() => navigate("extensions")}
        >
          <Puzzle size={16} /> {t.Extensions}
        </button>
        <button
          type="button"
          className={`providers-nav ${state.page === "settings" ? "active" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings2 size={16} /> {t.Settings}
        </button>
      </aside>
      <main>
        <div className="window-drag-strip electrobun-webkit-app-region-drag" />
        {state.page === "providers" ? (
          <Providers />
        ) : state.page === "extensions" ? (
          <Extensions />
        ) : state.page === "settings" ? (
          <Settings />
        ) : active ? (
          <Chat key={active.info.id} snapshot={active} />
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
      {state.opening && <div className="loading">{t["Opening chat…"]}</div>}
      <Notifications />
      <TerminalDialog />
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

function Chat({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { info, transcript } = snapshot;
  const { models: available, disabledModels } = useStore((s) => s.bootstrap);
  const general = useStore((s) => s.bootstrap.generalCwd === info.cwd);
  const models = filterModels(available, disabledModels);
  const { width, setWidth } = useChatWidth();
  const thread = useRef<HTMLDivElement>(null);
  // A response ends where the next turn is not another assistant step.
  const footer = (index: number) => {
    const next = transcript.turns[index + 1]?.message.role;
    if (next ? next === "assistant" : transcript.running) return null;
    const stats = responseStats(transcript.turns, index);
    if (!stats) return null;
    const user =
      stats.userIndex === undefined
        ? undefined
        : transcript.turns[stats.userIndex].message;
    return (
      <ResponseFooter
        sessionId={info.id}
        stats={stats}
        user={user?.role === "user" ? user : undefined}
        // shortcut: only the latest reply regenerates; earlier ones would hide later turns with no tree UI.
        canRegenerate={
          index === transcript.turns.length - 1 && !transcript.running
        }
      />
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Transcript changes require scrolling its updated DOM before paint.
  useLayoutEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [transcript]);
  return (
    <div
      className="chat-shell"
      style={{ "--chat-width": `${width}px` } as React.CSSProperties}
    >
      <ChatWidthHandles width={width} onChange={setWidth} />
      <header className="chat-header">
        <div className="chat-heading">
          <Folder size={14} />
          <span>{general ? t.Chats : basename(info.cwd)}</span>
          <small>{info.title}</small>
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
              rpc.send.closeSession({ sessionId: info.id });
              useStore.setState((s) => {
                const snapshots = { ...s.snapshots };
                delete snapshots[info.id];
                const dialogs = { ...s.dialogs };
                delete dialogs[info.id];
                return { snapshots, dialogs };
              });
              navigate("chat", null);
              void refreshSessions().catch(showError);
            }}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div ref={thread} className="thread-scroll">
        <div className="transcript">
          {!transcript.turns.length && (
            <div className="chat-empty">
              <h1>{t["What shall we build?"]}</h1>
              <p className="muted">
                {general ? t["Chat without a project"] : t.workingIn(info.cwd)}
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
          {transcript.turns.map(({ id, message }, index) => (
            <div key={id} className="response-turn">
              <article className={`message ${message.role}`}>
                {message.role === "user" ? (
                  <UserMessage
                    message={message}
                    sessionId={info.id}
                    disabled={transcript.running || !snapshot.model}
                  />
                ) : message.role === "assistant" ? (
                  <>
                    {message.content.map((content, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Streaming content blocks retain their SDK indexes.
                      <div key={`${content.type}-${index}`}>
                        {content.type === "text" ? (
                          <div className="prose">
                            <Markdown text={content.text} />
                          </div>
                        ) : content.type === "thinking" ? (
                          <details className="thinking">
                            <summary>{t.Thinking}</summary>
                            <Markdown text={content.thinking} />
                          </details>
                        ) : content.type === "toolCall" ? (
                          <details className="tool-card">
                            <summary>
                              <span>{content.name}</span>
                              <code>
                                {JSON.stringify(content.arguments).slice(
                                  0,
                                  100,
                                )}
                              </code>
                              <small>
                                {t.toolStatus(
                                  transcript.tools[content.id]?.status ||
                                    "pending",
                                )}
                              </small>
                            </summary>
                            <pre>
                              {JSON.stringify(content.arguments, null, 2)}
                            </pre>
                            <ToolResultContent
                              result={transcript.tools[content.id]?.result}
                            />
                          </details>
                        ) : null}
                      </div>
                    ))}
                    {message.errorMessage && (
                      <p className="error">{message.errorMessage}</p>
                    )}
                  </>
                ) : message.role === "custom" && message.display ? (
                  <div className="tool-card custom-message">
                    <div className="muted">[{message.customType}]</div>
                    <MessageContent content={message.content} />
                  </div>
                ) : message.role === "bashExecution" ? (
                  <details
                    className={`tool-card bash-execution ${message.excludeFromContext ? "excluded" : ""}`}
                    open
                  >
                    <summary>
                      <code>$ {message.command}</code>
                    </summary>
                    <MessageContent content={message.output} markdown={false} />
                    {message.cancelled && (
                      <p className="muted">{t.Cancelled}</p>
                    )}
                    {message.exitCode !== undefined &&
                      message.exitCode !== 0 && (
                        <p className="error">
                          {t["Exit code"]}: {message.exitCode}
                        </p>
                      )}
                    {message.truncated && (
                      <p className="muted">
                        {t["Output truncated"]}
                        {message.fullOutputPath && (
                          <>
                            : <code>{message.fullOutputPath}</code>
                          </>
                        )}
                      </p>
                    )}
                  </details>
                ) : message.role === "compactionSummary" ||
                  message.role === "branchSummary" ? (
                  <details className="thinking summary-card">
                    <summary>
                      {message.role === "compactionSummary"
                        ? `[compaction] ${t.compactedFrom(message.tokensBefore)}`
                        : `[branch] ${t["Branch summary"]}`}
                    </summary>
                    <MessageContent content={message.summary} />
                  </details>
                ) : null}
              </article>
              {footer(index)}
            </div>
          ))}
          {transcript.running && (
            <p className="muted running" role="status">
              {t["Working…"]}
            </p>
          )}
        </div>
      </div>
      <ExtensionDialogs sessionId={info.id} />
      <Composer snapshot={snapshot} />
    </div>
  );
}
