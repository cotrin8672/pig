import { type ReactNode, useLayoutEffect, useRef } from "react";
import { frameTask, isThreadAtBottom } from "./thread-scroll";

export function ComposerFrame({ children }: { children: ReactNode }) {
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const shell = dock?.closest<HTMLElement>(".chat-shell");
    if (!dock || !shell) return;
    const measure = () => {
      const thread = shell.querySelector<HTMLElement>(".thread-scroll");
      const follow = thread && isThreadAtBottom(thread);
      shell.style.setProperty(
        "--composer-height",
        `${dock.getBoundingClientRect().height}px`,
      );
      if (follow) thread.scrollTop = thread.scrollHeight;
    };
    measure();
    const resize = frameTask(measure);
    const observer = new ResizeObserver(resize.schedule);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      resize.dispose();
      shell.style.removeProperty("--composer-height");
    };
  }, []);
  return (
    <div className="composer-dock" ref={dockRef}>
      {children}
    </div>
  );
}
