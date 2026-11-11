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
import { memo, useEffect, useId, useRef, useState } from "react";
import type { SessionFlags } from "../shared/desktop-state";
import type { SessionInfo } from "../shared/rpc-schema";
import { sessionLink } from "../shared/session-links";
import { ActionsMenu } from "./ActionsMenu";
import { ConfirmButton } from "./ConfirmButton";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { openChat, refreshSessions, rpc } from "./rpc";
import { sessionStatusLabels } from "./session-status";
import { showError, useStore } from "./store";
import { selectSessionStatus } from "./ui-selectors";

export const SessionList = memo(function SessionList({
  cwd,
  expanded = true,
  needle = "",
}: {
  cwd: string;
  expanded?: boolean;
  needle?: string;
}) {
  const t = useT();
  const sessions = useStore((s) => s.sessions[cwd]);
  const desktop = useStore((s) => s.bootstrap.desktop);
  const [archived, setArchived] = useState(false);
  if (!expanded) return null;
  const archivedCount = (sessions ?? []).filter(
    (session) => desktop.sessions[session.id]?.archived,
  ).length;
  const visible = (sessions ?? [])
    .filter(
      (session) =>
        Boolean(desktop.sessions[session.id]?.archived) === archived &&
        session.title.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        Number(!!desktop.sessions[b.id]?.pinned) -
          Number(!!desktop.sessions[a.id]?.pinned) || b.modified - a.modified,
    );
  return (
    <>
      {needle && !visible.length && <span role="status">{t.noMatches}</span>}
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
});

function SessionRow({ session, cwd }: { session: SessionInfo; cwd: string }) {
  const t = useT();
  const active = useStore((s) => s.active === session.id && s.page === "chat");
  const opening = useStore(
    (s) =>
      (s.opening && !s.openingTarget && s.active === session.id) ||
      Object.values(s.pendingOpens).some(
        (pending) =>
          pending.cwd === cwd &&
          (pending.id === session.id ||
            pending.address?.sessionId === session.id),
      ),
  );
  const flags = useStore((s) => s.bootstrap.desktop.sessions[session.id]);
  const running = useStore(
    (s) =>
      !!s.snapshots[session.id]?.transcript.running ||
      (s.modelPending && s.active === session.id),
  );
  const status = useStore((s) => selectSessionStatus(s, session.id));
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.title);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = { cwd, id: session.id };
  useEffect(() => {
    if (!renaming) return;
    dialog.current?.showModal();
    input.current?.focus();
    input.current?.select();
  }, [renaming]);
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
  async function rename() {
    setBusy(true);
    setError(undefined);
    try {
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
      void refreshSessions(cwd).catch(showError);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || running || opening) return;
    setBusy(true);
    try {
      await rpc.request.deleteSession(target);
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
      void refreshSessions(cwd).catch(showError);
    } catch (error) {
      showError(error);
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
                setName(session.title);
                setError(undefined);
                setRenaming(true);
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
            <ConfirmButton
              role="menuitem"
              className="session-menu-delete"
              disabled={busy || running || opening}
              title={t["This permanently deletes this chat’s local history."]}
              aria-description={
                t["This permanently deletes this chat’s local history."]
              }
              onConfirm={() => {
                closeMenu();
                void remove();
              }}
            >
              <Trash2 size={13} />
              {t.Delete}
            </ConfirmButton>
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
          setRenaming(false);
          setError(undefined);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <div className="dialog-heading">
            <h2 id={titleId}>{t["Rename chat"]}</h2>
            <button
              type="button"
              aria-label={t.Close}
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              <X size={14} />
            </button>
          </div>
          <input
            ref={input}
            aria-label={t["Chat name"]}
            value={name}
            maxLength={512}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              {t.Cancel}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !name.trim()}
            >
              {t.Rename}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
