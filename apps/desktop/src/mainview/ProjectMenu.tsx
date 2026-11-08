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
import { useT } from "./i18n";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";

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
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<"rename" | "delete">();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!mode) return;
    dialog.current?.showModal();
    if (mode === "rename") {
      input.current?.focus();
      input.current?.select();
    } else cancel.current?.focus();
  }, [mode]);
  function openDialog(next: "rename" | "delete") {
    setName(flags?.name ?? "");
    setError(undefined);
    setMode(next);
  }
  async function setFlags(patch: ProjectFlags) {
    setBusy(true);
    try {
      await rpc.request.setProjectState({ cwd, ...patch });
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
      if (mode === "rename") await rpc.request.setProjectState({ cwd, name });
      else await rpc.request.removeProject({ cwd });
      dialog.current?.close();
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ActionsMenu
        label={`${t["Project actions"]}: ${displayName}`}
        disabled={busy}
      >
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
                openDialog("rename");
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
            <button
              type="button"
              role="menuitem"
              className="session-menu-delete"
              onClick={() => {
                close();
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
              {mode === "rename" ? t["Edit name"] : t["Delete project"]}
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
            <>
              <input
                ref={input}
                aria-label={t["Project name"]}
                placeholder={displayName}
                value={name}
                maxLength={512}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="muted">
                {t["Leave empty to use the folder name."]}
              </p>
            </>
          ) : (
            <>
              <p className="session-dialog-name">{displayName}</p>
              <p className="muted">
                {
                  t[
                    "Only removes this project from pig’s list. Files on disk and its chats are NOT deleted."
                  ]
                }
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
              disabled={busy}
            >
              {mode === "rename" ? t.Rename : t.Delete}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
