import { FileUp } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";
import { frameTask, isThreadAtBottom } from "./thread-scroll";

const carriesFiles = (event: DragEvent) =>
  !!event.dataTransfer?.types.includes("Files");

export function ComposerFrame({
  children,
  onFiles,
}: {
  children: ReactNode;
  /** Files dropped anywhere on the chat pane. */
  onFiles?: (files: File[]) => void;
}) {
  const t = useT();
  const dockRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef(onFiles);
  filesRef.current = onFiles;
  const [shell, setShell] = useState<HTMLElement>();
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const shell = dock?.closest<HTMLElement>(".chat-shell");
    if (!dock || !shell) return;
    setShell(shell);
    let height: number | undefined;
    const measure = () => {
      const nextHeight = dock.getBoundingClientRect().height;
      if (nextHeight === height) return;
      height = nextHeight;
      const thread = shell.querySelector<HTMLElement>(".thread-scroll");
      const follow = thread && isThreadAtBottom(thread);
      shell.style.setProperty("--composer-height", `${height}px`);
      if (follow) thread.scrollTop = thread.scrollHeight;
    };
    measure();
    const resize = frameTask(measure);
    const observer = new ResizeObserver(resize.schedule);
    observer.observe(dock);
    const over = (event: DragEvent) => {
      if (!filesRef.current || !carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !shell.contains(next)) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      setDragging(false);
      if (!filesRef.current || !carriesFiles(event)) return;
      event.preventDefault();
      filesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    shell.addEventListener("dragenter", over);
    shell.addEventListener("dragover", over);
    shell.addEventListener("dragleave", leave);
    shell.addEventListener("drop", drop);
    return () => {
      observer.disconnect();
      resize.dispose();
      shell.removeEventListener("dragenter", over);
      shell.removeEventListener("dragover", over);
      shell.removeEventListener("dragleave", leave);
      shell.removeEventListener("drop", drop);
      shell.style.removeProperty("--composer-height");
    };
  }, []);
  return (
    <div className="composer-dock" ref={dockRef}>
      {children}
      {dragging &&
        shell &&
        createPortal(
          <div className="file-drop-overlay" aria-hidden="true">
            <FileUp size={32} />
            <span>{t["Drop files to attach"]}</span>
          </div>,
          shell,
        )}
    </div>
  );
}
