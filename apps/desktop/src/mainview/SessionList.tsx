import {
  Archive,
  Check,
  ChevronUp,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SessionFlags } from "../shared/desktop-state";
import type { SessionInfo } from "../shared/rpc-schema";
import { sessionLink } from "../shared/session-links";
import { ActionsMenu } from "./ActionsMenu";
import { ConfirmButton } from "./ConfirmButton";
import { InlineRename } from "./InlineRename";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { IndicatorDot } from "./primitives/IndicatorDot";
import { openChat, refreshSessions, rpc, showPendingOpen } from "./rpc";
import { sessionStatusLabels } from "./session-status";
import { showError, useStore } from "./store";
import { clipTooltipText, type TooltipAnchor, useTooltip } from "./Tooltip";
import {
  publishSessionName,
  sessionNames,
  updateFlag,
  waitPreferenceWrites,
} from "./ui-mutations";
import {
  mergeLiveSessions,
  selectLiveSessions,
  selectSessionStatus,
  selectStartingChats,
} from "./ui-selectors";

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
/** `3 days ago` / `3日前`; under a minute reads as "now". */
export function relativeTime(time: number, language: string, now = Date.now()) {
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const elapsed = Math.max(0, now - time);
  for (const [unit, size] of units)
    if (elapsed >= size)
      return format.format(-Math.floor(elapsed / size), unit);
  return format.format(0, "second");
}

/** Unpinned chats, including the selected chat, shown before expanding. */
export const RECENT_CHAT_LIMIT = 5;

export const SessionList = memo(function SessionList({
  cwd,
  expanded = true,
}: {
  cwd: string;
  expanded?: boolean;
}) {
  const t = useT();
  const listed = useStore((s) => s.sessions[cwd]);
  const live = useStore(useShallow((s) => selectLiveSessions(s, cwd)));
  const deleting = useStore((s) => s.deletingSessions);
  const starting = useStore(
    useShallow((s) => selectStartingChats(s, cwd, t["New chat"])),
  );
  const desktop = useStore((s) => s.bootstrap.desktop);
  const activeId = useStore((s) => (s.page === "chat" ? s.active : undefined));
  const [archived, setArchived] = useState(false);
  const [extra, setExtra] = useState(0);
  if (!expanded) return null;
  const sessions = mergeLiveSessions(cwd, listed, live, deleting);
  const startingRows: { openId: string; title: string }[] = [];
  for (let index = 0; index < starting.length; index += 3) {
    const sessionId = starting[index + 2];
    // Once the host lists the session, its real row replaces the placeholder.
    if (sessionId && sessions.some((session) => session.id === sessionId))
      continue;
    const title = starting[index + 1];
    if (!archived) startingRows.push({ openId: starting[index], title });
  }
  const archivedCount = (sessions ?? []).filter(
    (session) => desktop.sessions[session.id]?.archived,
  ).length;
  const visible = (sessions ?? [])
    .filter(
      (session) => Boolean(desktop.sessions[session.id]?.archived) === archived,
    )
    .sort(
      (a, b) =>
        Number(!!desktop.sessions[b.id]?.pinned) -
          Number(!!desktop.sessions[a.id]?.pinned) || b.modified - a.modified,
    );
  // Selection uses a recent slot, never an extra row that resizes the sidebar.
  const unpinned = visible.filter(
    (session) => !desktop.sessions[session.id]?.pinned,
  );
  const recentLimit = Math.max(0, RECENT_CHAT_LIMIT - startingRows.length);
  const recent = unpinned.slice(0, recentLimit + extra);
  const selected = unpinned.find((session) => session.id === activeId);
  if (selected && recent.length && !recent.includes(selected))
    recent[recent.length - 1] = selected;
  const recentIds = new Set(recent.map((session) => session.id));
  const rows = visible.filter(
    (session) =>
      desktop.sessions[session.id]?.pinned || recentIds.has(session.id),
  );
  const hasMore = recent.length < unpinned.length;
  const showingExtra = recent.length > recentLimit;
  return (
    <>
      {startingRows.map((row) => (
        <StartingRow key={row.openId} {...row} />
      ))}
      {rows.map((session) => (
        <SessionRow key={session.id} session={session} cwd={cwd} />
      ))}
      {(hasMore || showingExtra) && (
        <button
          type="button"
          className="thread more-chats"
          aria-expanded={showingExtra}
          aria-label={hasMore ? t["Show older chats"] : t["Show fewer chats"]}
          onClick={() =>
            setExtra((count) => (hasMore ? count + RECENT_CHAT_LIMIT : 0))
          }
        >
          {hasMore ? (
            <MoreHorizontal size={14} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} aria-hidden="true" />
          )}
        </button>
      )}
      {(archivedCount > 0 || archived) && (
        <button
          type="button"
          className="archived-chats"
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived);
            setExtra(0);
          }}
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

/** A new chat still starting: selectable at once, actions wait for its ID. */
function StartingRow({ openId, title }: { openId: string; title: string }) {
  const t = useT();
  const active = useStore(
    (s) => s.page === "chat" && s.opening && s.openId === openId,
  );
  const tooltip = useTooltip();
  return (
    <div className={`thread-row ${active ? "active" : ""}`}>
      <button
        type="button"
        className="thread"
        aria-current={active ? "page" : undefined}
        onClick={() => showPendingOpen(openId)}
        {...tooltip({
          tier: "detail",
          side: "right",
          label: clipTooltipText(title),
        })}
      >
        <span className="session-status-slot" />
        <span className="thread-title">{title}</span>
      </button>
      <ActionsMenu label={`${t["Chat actions"]}: ${title}`} disabled>
        {() => null}
      </ActionsMenu>
    </div>
  );
}

function SessionRow({ session, cwd }: { session: SessionInfo; cwd: string }) {
  const t = useT();
  const active = useStore((s) => s.active === session.id && s.page === "chat");
  const flags = useStore((s) => s.bootstrap.desktop.sessions[session.id]);
  const status = useStore((s) => selectSessionStatus(s, session.id));
  const project = useStore((s) =>
    cwd === s.bootstrap.generalCwd
      ? undefined
      : s.bootstrap.desktop.projects?.[cwd]?.name || basename(cwd),
  );
  const language = useStore((s) => s.settings.language);
  const tooltip = useTooltip();
  // Computed at hover time so "3 days ago" never goes stale.
  const details = (): TooltipAnchor => {
    const rows: [string, string][] = [];
    if (session.modified > 0)
      rows.push([
        t["Last activity"],
        `${relativeTime(session.modified, language)} · ${new Date(
          session.modified,
        ).toLocaleString(language, {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      ]);
    if (project) rows.push([t.Project, project]);
    if (status) rows.push([t.Status, t[sessionStatusLabels[status]]]);
    return {
      tier: "rich",
      side: "right",
      label: clipTooltipText(session.title),
      rows,
    };
  };
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const target = { cwd, id: session.id };
  function setFlags(patch: SessionFlags) {
    for (const field of ["pinned", "archived"] as const) {
      const value = patch[field];
      if (value !== undefined)
        void updateFlag("sessions", session.id, field, value, () =>
          rpc.request.setSessionState({ ...target, [field]: value }),
        );
    }
  }
  function rename(title: string) {
    void sessionNames.change(
      session.id,
      session.title,
      title,
      (value) => publishSessionName(session.id, value),
      async () =>
        (await rpc.request.renameSession({ ...target, name: title })).title,
    );
  }
  async function remove() {
    const id = session.id;
    if (useStore.getState().deletingSessions[id]) return;
    // Hide at once; the row comes back only if the host refuses the deletion.
    const setDeleting = (deleting: boolean) =>
      useStore.setState((s) => {
        const deletingSessions = { ...s.deletingSessions };
        if (deleting) deletingSessions[id] = true;
        else delete deletingSessions[id];
        return { deletingSessions };
      });
    setDeleting(true);
    const state = useStore.getState();
    if (state.page === "chat" && state.active === id && !state.opening)
      navigate("chat", null);
    try {
      await waitPreferenceWrites("sessions", id);
      await rpc.request.deleteSession(target);
      useStore.setState((s) => {
        const snapshots = { ...s.snapshots };
        delete snapshots[id];
        return {
          snapshots,
          sessions: {
            ...s.sessions,
            [cwd]: (s.sessions[cwd] ?? []).filter((item) => item.id !== id),
          },
          ...(s.active === id ? { active: undefined } : {}),
        };
      });
      void refreshSessions(cwd).catch(showError);
    } catch (error) {
      showError(error);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className={`thread-row ${active ? "active" : ""}`}>
      {renaming ? (
        <InlineRename
          value={session.title}
          label={t["Chat name"]}
          onCommit={rename}
          onDone={() => setRenaming(false)}
        />
      ) : (
        <button
          type="button"
          className="thread"
          aria-current={active ? "page" : undefined}
          onClick={() => void openChat(cwd, session.id)}
          {...tooltip(details)}
        >
          <span className="session-status-slot">
            {status && (
              <IndicatorDot
                state={status}
                label={t[sessionStatusLabels[status]]}
              />
            )}
          </span>
          <span className="thread-title">{session.title}</span>
          {flags?.pinned && <Pin size={11} aria-label={t.Pin} />}
        </button>
      )}
      <ActionsMenu
        label={`${t["Chat actions"]}: ${session.title}`}
        onOpen={() => setCopied(false)}
      >
        {(closeMenu) => (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
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
              aria-description={
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
    </div>
  );
}
