import {
  Archive,
  Check,
  Link2,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SessionFlags } from "../shared/desktop-state";
import type { SessionInfo } from "../shared/rpc-schema";
import { sessionLink } from "../shared/session-links";
import { ActionsMenu } from "./ActionsMenu";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { openChat, refreshSessions, rpc } from "./rpc";
import { sessionStatus, sessionStatusLabels } from "./session-status";
import { showError, useStore } from "./store";

export function SessionList({ cwd }: { cwd: string }) {
  const t = useT();
  const sessions = useStore((s) => s.sessions[cwd]);
  const desktop = useStore((s) => s.bootstrap.desktop);
  const [archived, setArchived] = useState(false);
  const archivedCount = (sessions ?? []).filter(
    (session) => desktop.sessions[session.id]?.archived,
  ).length;
  const visible = (sessions ?? [])
    .filter((session) => !!desktop.sessions[session.id]?.archived === archived)
    .sort(
      (a, b) =>
        Number(!!desktop.sessions[b.id]?.pinned) -
          Number(!!desktop.sessions[a.id]?.pinned) || b.modified - a.modified,
    );
  return (
    <>
      {visible.map((session) => (
        <SessionRow key={session.id} session={session} cwd={cwd} />
      ))}
      {(archivedCount > 0 || archived) && (
        <button
          type="button"
          className="archived-chats"
          aria-pressed={archived}
          onClick={() => setArchived(!archived)}
        >
          <Archive size={12} />
          {archived
            ? t["Back to chats"]
            : `${t["Archived chats"]} (${archivedCount})`}
        </button>
      )}
    </>
  );
}

function SessionRow({ session, cwd }: { session: SessionInfo; cwd: string }) {
  const t = useT();
  const active = useStore((s) => s.active === session.id && s.page === "chat");
  const opening = useStore((s) => s.opening);
  const flags = useStore((s) => s.bootstrap.desktop.sessions[session.id]);
  const running = useStore(
    (s) =>
      !!s.snapshots[session.id]?.transcript.running ||
      (s.modelPending && s.active === session.id),
  );
  const waiting = useStore((s) =>
    s.pendingUI.some((request) => request.sessionId === session.id),
  );
  const status = sessionStatus(running, waiting, flags);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"rename" | "delete">();
  const [name, setName] = useState(session.title);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = { cwd, id: session.id };
  useEffect(() => {
    if (!mode) return;
    dialog.current?.showModal();
    if (mode === "rename") {
      input.current?.focus();
      input.current?.select();
    } else cancel.current?.focus();
  }, [mode]);
  function openDialog(next: "rename" | "delete") {
    setName(session.title);
    setError(undefined);
    setMode(next);
  }
  async function setFlags(patch: SessionFlags) {
    setBusy(true);
    try {
      await rpc.request.setSessionState({ ...target, ...patch });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      if (mode === "rename") {
        const info = await rpc.request.renameSession({ ...target, name });
        useStore.setState((s) => ({
          sessions: {
            ...s.sessions,
            [cwd]: (s.sessions[cwd] ?? []).map((item) =>
              item.id === info.id ? info : item,
            ),
          },
          snapshots: s.snapshots[info.id]
            ? { ...s.snapshots, [info.id]: { ...s.snapshots[info.id], info } }
            : s.snapshots,
        }));
        dialog.current?.close();
      } else {
        await rpc.request.deleteSession(target);
        dialog.current?.close();
        const wasActive = useStore.getState().active === session.id;
        useStore.setState((s) => {
          const snapshots = { ...s.snapshots };
          delete snapshots[session.id];
          return {
            snapshots,
            sessions: {
              ...s.sessions,
              [cwd]: (s.sessions[cwd] ?? []).filter(
                (item) => item.id !== session.id,
              ),
            },
            ...(s.active === session.id ? { active: undefined } : {}),
          };
        });
        if (wasActive && useStore.getState().page === "chat")
          navigate("chat", null);
      }
      void refreshSessions().catch(showError);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`thread-row ${active ? "active" : ""}`}>
      <button
        type="button"
        className="thread"
        title={
          status
            ? `${session.title} · ${t[sessionStatusLabels[status]]}`
            : session.title
        }
        disabled={opening}
        aria-current={active ? "page" : undefined}
        onClick={() => void openChat(cwd, session.id)}
      >
        <span className="session-status-slot">
          {status && (
            <span
              className={`session-dot ${status}`}
              role="img"
              aria-label={t[sessionStatusLabels[status]]}
            />
          )}
        </span>
        <span className="thread-title">{session.title}</span>
        {flags?.pinned && <Pin size={11} aria-label={t.Pin} />}
      </button>
      <ActionsMenu
        label={`${t["Chat actions"]}: ${session.title}`}
        disabled={busy || opening}
        onOpen={() => setCopied(false)}
      >
        {(closeMenu) => (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                openDialog("rename");
              }}
            >
              <Pencil size={13} />
              {t.Rename}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                void setFlags({ pinned: !flags?.pinned });
              }}
            >
              {flags?.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {flags?.pinned ? t.Unpin : t.Pin}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                void setFlags({ archived: !flags?.archived });
              }}
            >
              {flags?.archived ? (
                <RotateCcw size={13} />
              ) : (
                <Archive size={13} />
              )}
              {flags?.archived ? t["Restore chat"] : t.Archive}
            </button>
            <button
              type="button"
              role="menuitem"
              title={
                t["Paste in pig outside a text field to open this local link."]
              }
              onClick={() => {
                if (!navigator.clipboard) {
                  showError(t["Clipboard is unavailable."]);
                  return;
                }
                void navigator.clipboard
                  .writeText(sessionLink(session.id))
                  .then(() => setCopied(true))
                  .catch(showError);
              }}
            >
              {copied ? <Check size={13} /> : <Link2 size={13} />}
              {copied ? t.Copied : t["Copy link"]}
            </button>
            <button
              type="button"
              role="menuitem"
              className="session-menu-delete"
              disabled={running}
              onClick={() => {
                closeMenu();
                openDialog("delete");
              }}
            >
              <Trash2 size={13} />
              {t.Delete}
            </button>
          </>
        )}
      </ActionsMenu>
      <dialog
        ref={dialog}
        className="session-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => {
          setMode(undefined);
          setError(undefined);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="dialog-heading">
            <h2 id={titleId}>
              {mode === "rename" ? t["Rename chat"] : t["Delete chat"]}
            </h2>
            <button
              type="button"
              aria-label={t.Close}
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              <X size={14} />
            </button>
          </div>
          {mode === "rename" ? (
            <input
              ref={input}
              aria-label={t["Chat name"]}
              value={name}
              maxLength={512}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          ) : (
            <>
              <p className="session-dialog-name">{session.title}</p>
              <p className="muted">
                {t["This permanently deletes this chat’s local history."]}
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              ref={cancel}
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              {t.Cancel}
            </button>
            <button
              type="submit"
              className={mode === "rename" ? "primary" : "danger-button"}
              disabled={busy || (mode === "rename" && !name.trim())}
            >
              {mode === "rename" ? t.Rename : t.Delete}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
