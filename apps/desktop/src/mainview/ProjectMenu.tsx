import {
  Archive,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ProjectFlags } from "../shared/projects";
import { ActionsMenu } from "./ActionsMenu";
import { ConfirmButton } from "./ConfirmButton";
import { useT } from "./i18n";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import { projectNames, updateFlag, waitPreferenceWrites } from "./ui-mutations";

export function ProjectMenu({
  cwd,
  displayName,
}: {
  cwd: string;
  displayName: string;
}) {
  const t = useT();
  const flags = useStore((s) => s.bootstrap.desktop.projects?.[cwd]);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!renaming) return;
    dialog.current?.showModal();
    input.current?.focus();
    input.current?.select();
  }, [renaming]);
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
    setBusy(true);
    try {
      await waitPreferenceWrites("projects", cwd);
      await rpc.request.removeProject({ cwd });
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    const desired = name.trim();
    dialog.current?.close();
    void projectNames.change(
      cwd,
      flags?.name ?? "",
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
  return (
    <>
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
                setName(flags?.name ?? "");
                setError(undefined);
                setRenaming(true);
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
              {flags?.archived ? (
                <RotateCcw size={13} />
              ) : (
                <Archive size={13} />
              )}
              {flags?.archived ? t["Unarchive project"] : t["Archive project"]}
            </button>
            <ConfirmButton
              role="menuitem"
              className="session-menu-delete"
              disabled={busy}
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
      <dialog
        ref={dialog}
        className="session-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          setRenaming(false);
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
            <h2 id={titleId}>{t["Edit name"]}</h2>
            <button
              type="button"
              aria-label={t.Close}
              onClick={() => dialog.current?.close()}
            >
              <X size={14} />
            </button>
          </div>
          <input
            ref={input}
            aria-label={t["Project name"]}
            placeholder={displayName}
            value={name}
            maxLength={512}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="muted">{t["Leave empty to use the folder name."]}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              {t.Cancel}
            </button>
            <button type="submit" className="primary">
              {t.Rename}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
