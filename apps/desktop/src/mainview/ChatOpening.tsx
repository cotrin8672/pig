import { ArrowUp, Folder, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useT } from "./i18n";
import { cancelOpening } from "./rpc";
import { showError, useStore } from "./store";
import "./chat-opening.css";

export function ChatOpening({ cwd }: { cwd?: string }) {
  const t = useT();
  const message = useStore((s) => s.openMessage);
  const text = useStore((s) => (cwd ? (s.newChatDrafts[cwd] ?? "") : ""));
  const general = useStore((s) => s.bootstrap.generalCwd === cwd);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(
    () => () => {
      if (!input.current || document.activeElement !== input.current) return;
      const start = input.current.selectionStart;
      const end = input.current.selectionEnd;
      requestAnimationFrame(() => {
        const next = document.querySelector<HTMLTextAreaElement>(
          "main .composer textarea",
        );
        if (!next || document.activeElement !== document.body) return;
        next.focus();
        next.setSelectionRange(start, end);
      });
    },
    [],
  );
  const cancel = () => void cancelOpening().catch(showError);
  if (!cwd)
    return (
      <div className="chat-opening" role="status" aria-live="polite">
        <div className="chat-opening-heading" aria-hidden="true" />
        <div className="chat-opening-content" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="chat-opening-composer">
          <span>{message ?? t["Opening chat…"]}</span>
          <button type="button" onClick={cancel}>
            {t.Cancel}
          </button>
        </div>
      </div>
    );
  return (
    <div className="chat-shell">
      <header className="chat-header">
        <div className="chat-heading">
          <Folder size={14} />
          <span>
            {general
              ? t.Chats
              : cwd.split(/[\\/]/).filter(Boolean).pop() || cwd}
          </span>
          <small>{t["New chat"]}</small>
        </div>
        <button
          type="button"
          aria-label={t.Cancel}
          title={t.Cancel}
          onClick={cancel}
        >
          <X size={16} />
        </button>
      </header>
      <div className="thread-scroll">
        <div className="transcript chat-empty">
          <h1>{t["What shall we build?"]}</h1>
          <p className="muted">
            {general ? t["Chat without a project"] : t.workingIn(cwd)}
          </p>
        </div>
      </div>
      <div className="composer-dock">
        <div className="composer">
          <textarea
            ref={input}
            aria-label={t.Message}
            placeholder={t["Ask anything, or describe what to build…"]}
            rows={2}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              useStore.setState((s) => ({
                newChatDrafts: { ...s.newChatDrafts, [cwd]: value },
              }));
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              )
                event.preventDefault();
            }}
          />
          <div className="composer-toolbar">
            <span className="muted" role="status">
              {message ?? t["Opening chat…"]}
            </span>
            <button
              type="button"
              className="send-button"
              aria-label={t.Send}
              disabled
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
