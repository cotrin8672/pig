import { ChevronRight, Folder, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "./i18n";
import { openChat, refresh, rpc } from "./rpc";
import { SessionList } from "./SessionList";
import {
  hasUnreadCompletion,
  sessionStatus,
  sessionStatusLabels,
} from "./session-status";
import { showError, useStore } from "./store";

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

export function SidebarSessions() {
  const t = useT();
  const projects = useStore((s) => s.bootstrap.projects);
  const generalCwd = useStore((s) => s.bootstrap.generalCwd);
  const opening = useStore((s) => s.opening);
  const chatsId = useId();
  const projectsId = useId();
  return (
    <div className="project-list">
      <section className="sidebar-section" aria-labelledby={chatsId}>
        <div className="sidebar-section-heading">
          <h2 id={chatsId}>{t.Chats}</h2>
          <button
            type="button"
            aria-label={t["New chat"]}
            title={t["New chat"]}
            disabled={opening || !generalCwd}
            onClick={() => void openChat(generalCwd)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {generalCwd && <SessionList cwd={generalCwd} />}
      </section>
      <section className="sidebar-section" aria-labelledby={projectsId}>
        <div className="sidebar-section-heading">
          <h2 id={projectsId}>{t.Projects}</h2>
          <button
            type="button"
            aria-label={t["Add project"]}
            title={t["Add project"]}
            onClick={() => rpc.send.addProject()}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {projects.map((cwd) => (
          <ProjectSessions key={cwd} cwd={cwd} />
        ))}
        {!projects.length && (
          <p className="sidebar-empty">{t["No projects yet"]}</p>
        )}
      </section>
    </div>
  );
}

function ProjectSessions({ cwd }: { cwd: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const opening = useStore((s) => s.opening);
  const sessions = useStore((s) => s.sessions[cwd]);
  const flags = useStore((s) => s.bootstrap.desktop.sessions);
  const snapshots = useStore((s) => s.snapshots);
  const dialogs = useStore((s) => s.dialogs);
  const active = useStore((s) => s.active);
  const modelPending = useStore((s) => s.modelPending);
  const counts = { waiting: 0, running: 0, completed: 0, failed: 0 };
  let unread = 0;
  for (const session of sessions ?? []) {
    if (flags[session.id]?.archived) continue;
    const status = sessionStatus(
      !!snapshots[session.id]?.transcript.running ||
        (modelPending && active === session.id),
      !!dialogs[session.id]?.length,
      flags[session.id],
    );
    if (status) counts[status]++;
    if (hasUnreadCompletion(flags[session.id])) unread++;
  }
  const leading = (["waiting", "running", "failed", "completed"] as const).find(
    (status) => counts[status],
  );
  return (
    <section className="project">
      <div className="project-heading">
        <button
          className="project-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          title={cwd}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            className="project-chevron"
            size={12}
            aria-hidden="true"
          />
          <Folder size={13} aria-hidden="true" />
          <span className="project-name">{basename(cwd)}</span>
        </button>
        {leading && (
          <span
            className="project-activity"
            role="img"
            aria-label={`${t[sessionStatusLabels[leading]]}: ${counts[leading]}`}
            title={`${t[sessionStatusLabels[leading]]}: ${counts[leading]}`}
          >
            <span className={`session-dot ${leading}`} />
            {counts[leading]}
          </span>
        )}
        {unread > 0 && leading !== "completed" && leading !== "failed" && (
          <span
            className="project-unread"
            role="img"
            aria-label={`${t["Unread chats"]}: ${unread}`}
            title={`${t["Unread chats"]}: ${unread}`}
          />
        )}
        <div className="project-actions">
          <button
            type="button"
            title={t["New chat"]}
            aria-label={t.newChatIn(basename(cwd))}
            disabled={opening}
            onClick={() => {
              setExpanded(true);
              void openChat(cwd);
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            title={t["Remove project from list"]}
            aria-label={t.removeProject(basename(cwd))}
            onClick={() => {
              void rpc.request
                .removeProject({ cwd })
                .then(() => refresh())
                .catch(showError);
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id={listId} className="project-threads" hidden={!expanded}>
        <SessionList cwd={cwd} />
      </div>
    </section>
  );
}
