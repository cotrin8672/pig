import {
  Archive,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { ProjectFlags } from "../shared/projects";
import { ActionsMenu } from "./ActionsMenu";
import { ConfirmButton } from "./ConfirmButton";
import { useT } from "./i18n";
import { refresh, refreshSessions, rpc } from "./rpc";
import { showError, useStore } from "./store";
import {
  overlayProjects,
  projectNames,
  removingProjects,
  updateFlag,
  waitPreferenceWrites,
} from "./ui-mutations";

/** Empty restores the folder name. */
export function renameProject(cwd: string, desired: string) {
  const current =
    useStore.getState().bootstrap.desktop.projects?.[cwd]?.name ?? "";
  void projectNames.change(
    cwd,
    current,
    desired,
    (value) => {
      useStore.setState((state) => ({
        bootstrap: {
          ...state.bootstrap,
          desktop: {
            ...state.bootstrap.desktop,
            projects: {
              ...state.bootstrap.desktop.projects,
              [cwd]: {
                ...state.bootstrap.desktop.projects?.[cwd],
                name: value,
              },
            },
          },
        },
      }));
    },
    async () => {
      await rpc.request.setProjectState({ cwd, name: desired });
      return desired;
    },
  );
}
export function ProjectMenu({
  cwd,
  displayName,
  onRename,
}: {
  cwd: string;
  displayName: string;
  onRename: () => void;
}) {
  const t = useT();
  const flags = useStore((s) => s.bootstrap.desktop.projects?.[cwd]);
  function setFlags(patch: ProjectFlags) {
    for (const field of ["pinned", "archived"] as const) {
      const value = patch[field];
      if (value !== undefined)
        void updateFlag("projects", cwd, field, value, () =>
          rpc.request.setProjectState({ cwd, [field]: value }),
        );
    }
  }
  async function remove() {
    if (removingProjects.has(cwd)) return;
    // The list only forgets the folder, so hide it now and restore on failure.
    const before = useStore.getState().bootstrap.projects;
    removingProjects.add(cwd);
    const publish = (projects: string[]) =>
      useStore.setState((s) => ({
        bootstrap: { ...s.bootstrap, projects: overlayProjects(projects) },
      }));
    publish(before);
    try {
      await waitPreferenceWrites("projects", cwd);
      const projects = await rpc.request.removeProject({ cwd });
      removingProjects.delete(cwd);
      publish(projects);
    } catch (error) {
      removingProjects.delete(cwd);
      showError(error);
      // The host's list is authoritative after a refused removal.
      void refresh().catch(showError);
      return;
    }
    void refreshSessions().catch(showError);
  }
  return (
    <ActionsMenu label={`${t["Project actions"]}: ${displayName}`}>
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void rpc.request
                .openProjectFolder({ cwd })
                .then((opened) => {
                  if (!opened) showError(t["Could not open folder."]);
                })
                .catch(showError);
            }}
          >
            <FolderOpen size={13} />
            {t["Open folder"]}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onRename();
            }}
          >
            <Pencil size={13} />
            {t["Edit name"]}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void setFlags({ pinned: !flags?.pinned });
            }}
          >
            {flags?.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            {flags?.pinned ? t["Unpin project"] : t["Pin project"]}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void setFlags({ archived: !flags?.archived });
            }}
          >
            {flags?.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
            {flags?.archived ? t["Unarchive project"] : t["Archive project"]}
          </button>
          <ConfirmButton
            role="menuitem"
            className="session-menu-delete"
            title={
              t[
                "Only removes this project from pig’s list. Files on disk and its chats are NOT deleted."
              ]
            }
            onConfirm={() => {
              close();
              void remove();
            }}
          >
            <Trash2 size={13} />
            {t.Delete}
          </ConfirmButton>
        </>
      )}
    </ActionsMenu>
  );
}
