import { Archive, ChevronRight, Folder, Pin, Plus } from "lucide-react";
import { memo, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { visibleProjects } from "../shared/projects";
import { useT } from "./i18n";
import { ProjectMenu } from "./ProjectMenu";
import { openChat, rpc } from "./rpc";
import { SessionList } from "./SessionList";
import { type SessionStatus, sessionStatusLabels } from "./session-status";
import { useStore } from "./store";
import { selectProjectActivity } from "./ui-selectors";

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

export const SidebarSessions = memo(function SidebarSessions() {
  const t = useT();
  const projects = useStore((s) => s.bootstrap.projects);
  const projectFlags = useStore((s) => s.bootstrap.desktop.projects);
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const archivedCount = projects.filter(
    (cwd) => projectFlags?.[cwd]?.archived,
  ).length;
  const generalCwd = useStore((s) => s.bootstrap.generalCwd);
  const chatsId = useId();
  const projectsId = useId();
  return (
    <div className="project-list">
      <input
        type="search"
        aria-label={t.searchChats}
        placeholder={t.searchChats}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <section className="sidebar-section" aria-labelledby={chatsId}>
        <div className="sidebar-section-heading">
          <h2 id={chatsId}>{t.Chats}</h2>
          <button
            type="button"
            aria-label={t["New chat"]}
            title={t["New chat"]}
            disabled={!generalCwd}
            onClick={() => void openChat(generalCwd)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {generalCwd && <SessionList cwd={generalCwd} needle={needle} />}
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
        {visibleProjects(projects, projectFlags, archived).map((cwd) => (
          <ProjectSessions key={cwd} cwd={cwd} needle={needle} />
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
              ? t["Back to projects"]
              : `${t["Archived projects"]} (${archivedCount})`}
          </button>
        )}
        {!projects.length && (
          <p className="sidebar-empty">{t["No projects yet"]}</p>
        )}
      </section>
    </div>
  );
});

function ProjectSessions({ cwd, needle }: { cwd: string; needle: string }) {
  const t = useT();
  const projectFlags = useStore((s) => s.bootstrap.desktop.projects?.[cwd]);
  const displayName = projectFlags?.name || basename(cwd);
  const [opened, setExpanded] = useState(true);
  const expanded = opened || !!needle;
  const sessions = useStore((s) => (needle ? s.sessions[cwd] : undefined));
  const listId = useId();
  const activity = useStore(useShallow((s) => selectProjectActivity(s, cwd)));
  if (needle && !sessions?.some((s) => s.title.toLowerCase().includes(needle)))
    return null;
  const counts = { waiting: 0, running: 0, completed: 0, failed: 0 };
  let unread = 0;
  for (let index = 0; index < activity.length; index += 2) {
    const status = activity[index] as SessionStatus | undefined;
    if (status) counts[status]++;
    if (activity[index + 1]) unread++;
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
          disabled={!!needle}
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
          <span className="project-name">{displayName}</span>
          {projectFlags?.pinned && (
            <Pin size={11} aria-label={t["Pin project"]} />
          )}
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
            aria-label={t.newChatIn(displayName)}
            onClick={() => {
              setExpanded(true);
              void openChat(cwd);
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
          <ProjectMenu cwd={cwd} displayName={displayName} />
        </div>
      </div>
      <div id={listId} className="project-threads" hidden={!expanded}>
        <SessionList cwd={cwd} expanded={expanded} needle={needle} />
      </div>
    </section>
  );
}
