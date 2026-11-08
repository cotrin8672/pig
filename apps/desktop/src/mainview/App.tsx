import {
  ArrowLeft,
  ArrowUp,
  Check,
  Circle,
  CircleAlert,
  Copy,
  ExternalLink,
  Folder,
  LoaderCircle,
  Minus,
  Plus,
  Puzzle,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Snapshot } from "../shared/rpc-schema";
import { Extensions } from "./Extensions";
import { ModelPicker } from "./ModelPicker";
import { ProviderIcon } from "./ProviderIcon";
import { openChat, refresh, refreshSessions, rpc } from "./rpc";
import { type LoginState, showError, useStore } from "./store";

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) rpc.send.openExternal({ url: href });
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
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
  const state = useStore();
  useEffect(() => {
    void refresh().catch(showError);
  }, []);
  const active = state.active ? state.snapshots[state.active] : undefined;
  const connected = state.bootstrap.providers.some((p) => p.loggedIn);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Native drag handles; maximize is also available as a keyboard-accessible button.
    <div
      className="app-shell"
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
        { "--window-opacity": state.appearance.opacity } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <header className="electrobun-webkit-app-region-drag">
          <strong>piris</strong>
          <button
            type="button"
            className="electrobun-webkit-app-region-no-drag"
            aria-label="Add project"
            title="Add project"
            onClick={() => rpc.send.addProject()}
          >
            <Plus size={18} />
          </button>
        </header>
        <div className="project-list">
          {state.bootstrap.projects.map((cwd) => (
            <section key={cwd} className="project">
              <div className="project-heading">
                <Folder size={15} />
                <span title={cwd}>{basename(cwd)}</span>
                <button
                  type="button"
                  title="New chat"
                  aria-label={`New chat in ${basename(cwd)}`}
                  disabled={state.opening}
                  onClick={() => void openChat(cwd)}
                >
                  <Plus size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${basename(cwd)}`}
                  title="Remove project from list"
                  onClick={() => {
                    void rpc.request
                      .removeProject({ cwd })
                      .then(() => refresh())
                      .catch(showError);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
              {(state.sessions[cwd] || []).map((s) => (
                <button
                  type="button"
                  key={s.id}
                  disabled={state.opening}
                  className={`thread ${state.active === s.id && state.page === "chat" ? "active" : ""}`}
                  title={s.title}
                  onClick={() => void openChat(cwd, s.path, s.id)}
                >
                  {s.title}
                </button>
              ))}
            </section>
          ))}
          {!state.bootstrap.projects.length && (
            <p className="muted empty-projects">
              Add a project folder to start a chat.
            </p>
          )}
        </div>
        <button
          type="button"
          className={`providers-nav ${state.page === "providers" ? "active" : ""}`}
          onClick={() => useStore.setState({ page: "providers" })}
        >
          <Settings2 size={16} />
          <span className="nav-label">
            Providers{" "}
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
                  ? "Signing in…"
                  : connected
                    ? "Connected"
                    : "Not connected")}
            </small>
          </span>
        </button>
        <button
          type="button"
          className={`providers-nav ${state.page === "extensions" ? "active" : ""}`}
          onClick={() => useStore.setState({ page: "extensions" })}
        >
          <Puzzle size={16} /> Extensions
        </button>
      </aside>
      <main>
        <div className="window-drag-strip electrobun-webkit-app-region-drag" />
        {state.page === "providers" ? (
          <Providers />
        ) : state.page === "extensions" ? (
          <Extensions />
        ) : active ? (
          <Chat key={active.info.id} snapshot={active} />
        ) : (
          <div className="welcome">
            <h1>What shall we build?</h1>
            <p className="muted">
              {connected
                ? "Choose a project and start a new chat."
                : "Connect your subscription to start building with pi."}
            </p>
            <button
              className="primary"
              type="button"
              onClick={() =>
                connected
                  ? rpc.send.addProject()
                  : useStore.setState({ page: "providers" })
              }
            >
              {connected ? <Plus size={16} /> : <Settings2 size={16} />}{" "}
              {connected ? "Add project" : "Connect a provider"}
            </button>
          </div>
        )}
      </main>
      {/* Mouse clicks must not leave a focus ring behind, like native caption buttons. */}
      <div
        className="window-controls electrobun-webkit-app-region-no-drag"
        role="toolbar"
        aria-label="Window controls"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => rpc.send.windowControl({ action: "minimize" })}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label={state.maximized ? "Restore" : "Maximize"}
          title={state.maximized ? "Restore" : "Maximize"}
          onClick={() => rpc.send.windowControl({ action: "toggleMaximize" })}
        >
          {state.maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close window"
          title="Close"
          onClick={() => rpc.send.windowControl({ action: "close" })}
        >
          <X size={15} />
        </button>
      </div>
      {state.login && (
        <OAuthLoginDialog key={state.login.loginId} login={state.login} />
      )}
      {state.opening && <div className="loading">Opening chat…</div>}
      {state.packageToast && (
        <div
          className={`toast package-toast ${state.packageToast.error ? "error" : "connected"}`}
          role={state.packageToast.error ? "alert" : "status"}
        >
          {state.packageToast.error ? (
            <CircleAlert size={16} />
          ) : (
            <Check size={16} />
          )}
          {state.packageToast.message}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => useStore.setState({ packageToast: undefined })}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {state.error && (
        <div className="toast" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {state.error}
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => useStore.setState({ error: undefined })}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Providers() {
  const { bootstrap, login } = useStore();
  const [loggingOut, setLoggingOut] = useState<string>();
  return (
    <div className="providers-page">
      <button
        className="back-button"
        type="button"
        onClick={() => useStore.setState({ page: "chat" })}
      >
        <ArrowLeft size={14} /> Back to chat
      </button>
      <h1>Providers</h1>
      <p className="muted page-description">
        Connect your subscription. Credentials are shared with the pi CLI.
      </p>
      {!bootstrap.providers.length && (
        <p className="status" role="status">
          <LoaderCircle className="spinner" size={14} /> Checking connections…
        </p>
      )}
      <div className="provider-list">
        {bootstrap.providers.map((p) => {
          const signingIn = login?.provider === p.id && !login.error;
          const error = login?.provider === p.id ? login.error : undefined;
          return (
            <section className="provider-card" key={p.id}>
              <div className={`provider-icon ${p.id}`} aria-hidden="true">
                <ProviderIcon provider={p.id} />
              </div>
              <div className="provider-info">
                <h2>{p.id === "anthropic" ? "Anthropic" : "OpenAI"}</h2>
                <p className="muted">
                  {p.id === "anthropic"
                    ? "Claude Pro/Max subscription"
                    : "ChatGPT Plus/Pro subscription"}
                </p>
              </div>
              <span
                className={`status provider-status ${error ? "error" : signingIn ? "muted" : p.loggedIn ? "connected" : "muted"}`}
                role="status"
              >
                {error ? (
                  <CircleAlert size={13} />
                ) : signingIn ? (
                  <LoaderCircle className="spinner" size={13} />
                ) : p.loggedIn ? (
                  <Check size={13} />
                ) : (
                  <Circle size={7} fill="currentColor" />
                )}
                {error
                  ? error
                  : signingIn
                    ? "Signing in…"
                    : p.loggedIn
                      ? "Connected"
                      : "Not connected"}
              </span>
              {p.loggedIn ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!login || !!loggingOut}
                  onClick={() => {
                    setLoggingOut(p.id);
                    void rpc.request
                      .logout({ provider: p.id })
                      .then(refresh)
                      .catch(showError)
                      .finally(() => setLoggingOut(undefined));
                  }}
                >
                  {loggingOut === p.id ? "Disconnecting…" : "Logout"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={!!login || !!loggingOut}
                  onClick={() => {
                    const loginId = crypto.randomUUID();
                    useStore.setState({ login: { loginId, provider: p.id } });
                    rpc.send.startLogin({ provider: p.id, loginId });
                  }}
                >
                  Login
                </button>
              )}
            </section>
          );
        })}
      </div>
      <AppearanceSettings />
    </div>
  );
}

function AppearanceSettings() {
  const appearance = useStore((s) => s.appearance);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current);
        rpc.send.setAppearance(useStore.getState().appearance);
      }
    },
    [],
  );
  function update(next: typeof appearance) {
    useStore.setState({ appearance: next });
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = undefined;
      rpc.send.setAppearance(useStore.getState().appearance);
    }, 120);
  }
  return (
    <section className="appearance-section" aria-labelledby="appearance-title">
      <h2 id="appearance-title">Appearance</h2>
      <p className="muted">Blue-gray Seamless</p>
      <div className="appearance-card">
        <div className="appearance-heading">
          <h3 id="backdrop-label">Window backdrop</h3>
          <fieldset
            className="segmented-control"
            aria-labelledby="backdrop-label"
          >
            {(["none", "acrylic", "mica"] as const).map((backdrop) => (
              <button
                key={backdrop}
                type="button"
                aria-pressed={appearance.backdrop === backdrop}
                onClick={() => update({ ...appearance, backdrop })}
              >
                {backdrop === "none"
                  ? "None"
                  : backdrop === "acrylic"
                    ? "Acrylic"
                    : "Mica"}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="opacity-control">
          <label htmlFor="window-opacity">Window opacity</label>
          <output htmlFor="window-opacity">
            {Math.round(appearance.opacity * 100)}%
          </output>
          <input
            id="window-opacity"
            type="range"
            min="30"
            max="100"
            step="1"
            value={Math.round(appearance.opacity * 100)}
            onChange={(e) =>
              update({ ...appearance, opacity: Number(e.target.value) / 100 })
            }
          />
        </div>
        <p className="field-hint muted">
          Acrylic/Mica need Windows 11. Lower opacity to see the desktop.
        </p>
      </div>
    </section>
  );
}

function OAuthLoginDialog({ login }: { login: LoginState }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const { prompt, authUrl, deviceCode, event } = login;
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
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setCopyError(undefined);
    } catch {
      setCopyError("Could not copy. Try opening the sign-in page again.");
    }
  }
  const status = event && "message" in event ? event.message : "Signing in…";
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
          Sign in to {login.provider === "anthropic" ? "Anthropic" : "OpenAI"}
        </h2>
        <button
          type="button"
          aria-label="Close sign-in dialog"
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
              <p>Browser opened — finish signing in there</p>
              <div className="inline-actions">
                <button type="button" onClick={() => void copy(authUrl.url)}>
                  {copied === authUrl.url ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  {copied === authUrl.url ? "Copied" : "Copy link"}
                </button>
                <button
                  className="accent-link"
                  type="button"
                  onClick={() => rpc.send.openExternal({ url: authUrl.url })}
                >
                  <ExternalLink size={13} /> Open again
                </button>
              </div>
            </div>
          )}
          {deviceCode && (
            <div className="oauth-block">
              <p>Enter this code on the verification page</p>
              <button
                type="button"
                className="device-code"
                aria-label={`Copy code ${deviceCode.userCode}`}
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
                    if (value.trim()) answer(value.trim());
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
                    disabled={!value.trim()}
                  >
                    Submit
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
                {link.label || "More information"}
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
          {login.error ? "Close" : "Cancel"}
        </button>
      </div>
    </dialog>
  );
}

function Chat({ snapshot }: { snapshot: Snapshot }) {
  const { info, transcript, model } = snapshot;
  const models = useStore((s) => s.bootstrap.models);
  const canSend = models.some(
    (m) => m.provider === model?.provider && m.id === model.id,
  );
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript) end.current?.scrollIntoView({ block: "end" });
  }, [transcript]);
  function send() {
    if (!text.trim() || !canSend) return;
    rpc.send.prompt({ sessionId: info.id, text: text.trim() });
    setText("");
  }
  return (
    <div className="chat-shell">
      <header className="chat-header">
        <span>{basename(info.cwd)}</span>
        <button
          type="button"
          title="Close chat (history is kept)"
          aria-label="Close chat"
          onClick={() => {
            rpc.send.closeSession({ sessionId: info.id });
            useStore.setState({ active: undefined });
            void refreshSessions().catch(showError);
          }}
        >
          <X size={17} />
        </button>
      </header>
      <div className="thread-scroll">
        <div className="transcript">
          {!transcript.turns.length && (
            <div className="chat-empty">
              <h1>What shall we build?</h1>
              <p className="muted">Working in {info.cwd}</p>
              {!models.length && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => useStore.setState({ page: "providers" })}
                >
                  <Settings2 size={14} /> Connect a provider
                </button>
              )}
            </div>
          )}
          {transcript.turns.map(({ id, message }) => (
            <article key={id} className={`message ${message.role}`}>
              {message.role === "user" ? (
                <div className="user-bubble">
                  {typeof message.content === "string"
                    ? message.content
                    : message.content
                        .filter((c) => c.type === "text")
                        .map((c) => c.text)
                        .join("\n")}
                </div>
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
                          <summary>Thinking</summary>
                          <Markdown text={content.thinking} />
                        </details>
                      ) : content.type === "toolCall" ? (
                        <details className="tool-card">
                          <summary>
                            <span>{content.name}</span>
                            <code>
                              {JSON.stringify(content.arguments).slice(0, 100)}
                            </code>
                            <small>
                              {transcript.tools[content.id]?.status ||
                                "pending"}
                            </small>
                          </summary>
                          <pre>
                            {JSON.stringify(content.arguments, null, 2)}
                          </pre>
                          <pre>
                            {JSON.stringify(
                              transcript.tools[content.id]?.result,
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                  {message.errorMessage && (
                    <p className="error">{message.errorMessage}</p>
                  )}
                </>
              ) : null}
            </article>
          ))}
          {transcript.running && (
            <p className="muted running" role="status">
              Working…
            </p>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="composer-dock">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label="Message"
            placeholder={
              transcript.running
                ? "Send a follow-up…"
                : "Ask pi to build something…"
            }
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-toolbar">
            <ModelPicker snapshot={snapshot} />
            <div className="send-controls">
              {transcript.running && (
                <button
                  type="button"
                  className="send-button"
                  title="Stop"
                  aria-label="Stop"
                  onClick={() => rpc.send.abort({ sessionId: info.id })}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              )}
              <button
                type="submit"
                className="send-button"
                aria-label={transcript.running ? "Queue follow-up" : "Send"}
                disabled={!text.trim() || !canSend}
              >
                <ArrowUp size={19} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
