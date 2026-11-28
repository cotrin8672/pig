import { ChevronRight, Folder, Pin, SquarePen } from "lucide-react";
import { memo, type ReactNode, useId, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { visibleProjects } from "../shared/projects";
import { ArchiveToggle } from "./ArchiveToggle";
import { IndicatorDot } from "./IndicatorDot";
import { useT } from "./i18n";
import { FolderPlusCorner } from "./icons";
import { ProjectMenu, renameProject } from "./ProjectMenu";
import { InlineRename } from "./patterns/InlineRename";
import { openChat, rpc } from "./rpc";
import { SessionList } from "./SessionList";
import { type SessionStatus, sessionStatusLabels } from "./session-status";
import { useStore } from "./store";
import {
  createProjectActivitySelector,
  selectProjectModified,
} from "./ui-selectors";

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

/** `after` holds sections that share the scroll area, e.g. remote PCs. */
export const SidebarSessions = memo(function SidebarSessions({
  after,
}: {
  after?: ReactNode;
}) {
  const t = useT();
  const projects = useStore((s) => s.bootstrap.projects);
  const projectFlags = useStore((s) => s.bootstrap.desktop.projects);
  const projectModified = useStore(useShallow(selectProjectModified));
  const [archived, setArchived] = useState(false);
  const archivedCount = projects.filter(
    (cwd) => projectFlags?.[cwd]?.archived,
  ).length;
  const generalCwd = useStore((s) => s.bootstrap.generalCwd);
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
            disabled={!generalCwd}
            onClick={() => void openChat(generalCwd)}
          >
            <SquarePen size={14} aria-hidden="true" />
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
            onClick={() => rpc.send.addProject()}
          >
            <FolderPlusCorner size={14} aria-hidden="true" />
          </button>
        </div>
        {visibleProjects(projects, projectFlags, archived, projectModified).map(
          (cwd) => (
            <ProjectSessions key={cwd} cwd={cwd} />
          ),
        )}
        <ArchiveToggle
          active={archived}
          count={archivedCount}
          archiveLabel={t["Archived projects"]}
          backLabel={t["Back to projects"]}
          onToggle={() => setArchived(!archived)}
        />
        {!projects.length && (
          <p className="sidebar-empty">{t["No projects yet"]}</p>
        )}
      </section>
      {after}
    </div>
  );
});

type Collapse = "open" | "opening" | "closing" | "closed";

export function ProjectSessions({ cwd }: { cwd: string }) {
  const t = useT();
  const projectFlags = useStore((s) => s.bootstrap.desktop.projects?.[cwd]);
  const displayName = projectFlags?.name || basename(cwd);
  // Rows stay mounted while the list closes, then unmount like a collapsed list;
  // they are clipped only while the height moves, so focus rings stay visible.
  const [motion, setMotion] = useState<Collapse>("open");
  const expanded = motion === "open" || motion === "opening";
  const expand = (next: boolean) =>
    setMotion(
      matchMedia("(prefers-reduced-motion: reduce)").matches
        ? next
          ? "open"
          : "closed"
        : next
          ? "opening"
          : "closing",
    );
  const [renaming, setRenaming] = useState(false);
  const listId = useId();
  const selectActivity = useMemo(createProjectActivitySelector, []);
  const activity = useStore(useShallow((s) => selectActivity(s, cwd)));
  const counts = { waiting: 0, running: 0, completed: 0, failed: 0 };
  let unread = 0;
  for (let index = 0; index < activity.length; index += 2) {
    const status = activity[index] as SessionStatus | undefined;
    if (status) counts[status]++;
    if (activity[index + 1]) unread++;
  }
  const leading = (["waiting", "failed", "running", "completed"] as const).find(
    (status) => counts[status],
  );
  return (
    <section className="project">
      <div className="project-heading">
        {renaming ? (
          <div
            className="project-toggle project-renaming"
            data-expanded={expanded || undefined}
          >
            <ChevronRight
              className="project-chevron"
              size={12}
              aria-hidden="true"
            />
            <Folder size={13} aria-hidden="true" />
            <InlineRename
              value={displayName}
              label={t["Project name"]}
              placeholder={basename(cwd)}
              allowEmpty
              selectAll={false}
              onCommit={(name) => renameProject(cwd, name)}
              onDone={() => setRenaming(false)}
            />
          </div>
        ) : (
          <button
            className="project-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-description={cwd}
            onClick={() => expand(!expanded)}
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
        )}
        {leading && (
          <span
            className="project-activity"
            role="img"
            aria-label={`${t[sessionStatusLabels[leading]]}: ${counts[leading]}`}
          >
            <IndicatorDot state={leading} />
            {counts[leading]}
          </span>
        )}
        {unread > 0 && leading !== "completed" && leading !== "failed" && (
          <span
            className="project-unread"
            role="img"
            aria-label={`${t["Unread chats"]}: ${unread}`}
          />
        )}
        <div className="project-actions">
          <button
            type="button"
            aria-label={t.newChatIn(displayName)}
            onClick={() => {
              expand(true);
              void openChat(cwd);
            }}
          >
            <SquarePen size={13} aria-hidden="true" />
          </button>
          <ProjectMenu
            cwd={cwd}
            displayName={displayName}
            onRename={() => setRenaming(true)}
          />
        </div>
      </div>
      <div
        id={listId}
        className="sidebar-collapse"
        data-motion={motion}
        inert={!expanded}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "grid-template-rows"
          )
            setMotion((state) =>
              state === "opening"
                ? "open"
                : state === "closing"
                  ? "closed"
                  : state,
            );
        }}
      >
        <div className="project-threads">
          <SessionList cwd={cwd} expanded={motion !== "closed"} />
        </div>
      </div>
    </section>
  );
}
