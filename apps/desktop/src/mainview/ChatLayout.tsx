import { ArrowDown, Folder, Settings2 } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  type UIEventHandler,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { filterModels } from "../shared/models";
import { projectLabel } from "../shared/projects";
import { ChatWidthHandles, registerChatShell, useChatWidth } from "./ChatWidth";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { Button } from "./primitives/Button";
import { useStore } from "./store";
import { isThreadAtBottom } from "./thread-scroll";

export function ChatLayout({
  children,
  composer,
  rail,
  threadRef,
  onScroll,
  onJumpToBottom,
  onContentResize,
  loading = false,
}: {
  children: ReactNode;
  composer: ReactNode;
  /** Overlay pinned beside the thread (turn index). */
  rail?: ReactNode;
  threadRef?: Ref<HTMLElement>;
  onScroll?: UIEventHandler<HTMLElement>;
  onJumpToBottom?: () => void;
  onContentResize?: (wasAtBottom: boolean) => void;
  loading?: boolean;
}) {
  const t = useT();
  const { width, setWidth } = useChatWidth();
  const thread = useRef<HTMLElement>(null);
  const resizeContent = useRef(onContentResize);
  resizeContent.current = onContentResize;
  const measureThread = useRef<() => void>(undefined);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  useImperativeHandle(threadRef, () => thread.current as HTMLElement, []);
  useLayoutEffect(() => {
    const element = thread.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    // The baseline comes from the observer's first callback, delivered before
    // paint: reading it here would force a second layout of a freshly mounted chat.
    let previous:
      | {
          scrollHeight: number;
          clientHeight: number;
          clientWidth: number;
          atBottom: boolean;
        }
      | undefined;
    const measure = () => {
      const scrollTop = element.scrollTop;
      const next = {
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
      };
      const before = previous;
      const viewportChanged =
        before &&
        (before.clientHeight !== next.clientHeight ||
          before.clientWidth !== next.clientWidth);
      if (
        before &&
        (viewportChanged || before.scrollHeight !== next.scrollHeight)
      ) {
        // Changing the viewport may clamp scrollTop before the event arrives.
        const wasAtBottom =
          (viewportChanged && before.atBottom) ||
          isThreadAtBottom({ ...before, scrollTop });
        resizeContent.current?.(wasAtBottom);
      }
      const atBottom = isThreadAtBottom(element);
      previous = { ...next, atBottom };
      setAwayFromBottom(!atBottom);
    };
    measureThread.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    return () => {
      measureThread.current = undefined;
      observer.disconnect();
    };
  }, []);
  return (
    <div className="session-layout">
      <div
        className="chat-shell"
        ref={registerChatShell}
        style={{ "--saved-chat-width": `${width}px` } as React.CSSProperties}
      >
        <ChatWidthHandles width={width} onChange={setWidth} />
        <section
          ref={thread}
          className="thread-scroll"
          aria-label={t.Chats}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region must support keyboard paging after removal of the manual load button.
          tabIndex={0}
          onScroll={(event) => {
            // A scroll caused by layout can arrive before the resize observer.
            measureThread.current?.();
            onScroll?.(event);
          }}
          aria-busy={loading}
        >
          <div className="transcript">{children}</div>
        </section>
        {rail}
        {awayFromBottom && (
          <button
            type="button"
            className="thread-scroll-to-bottom"
            aria-label={t["Scroll to bottom"]}
            onClick={() => {
              const element = thread.current;
              if (!element) return;
              onJumpToBottom?.();
              element.scrollTop = element.scrollHeight;
              setAwayFromBottom(false);
            }}
          >
            <ArrowDown size={18} aria-hidden="true" />
          </button>
        )}
        {composer}
      </div>
    </div>
  );
}

export function ChatEmpty({ cwd }: { cwd?: string }) {
  const t = useT();
  const { generalCwd, models, disabledModels, desktop } = useStore(
    (s) => s.bootstrap,
  );
  const enabled = filterModels(models, disabledModels);
  const project =
    cwd && generalCwd !== cwd
      ? projectLabel(cwd, desktop.projects?.[cwd])
      : undefined;
  return (
    <div className="chat-empty">
      <h1>{t["What shall we build?"]}</h1>
      {project ? (
        <p
          className="muted chat-empty-project"
          aria-description={t.workingIn(project)}
        >
          <Folder size={14} aria-hidden="true" />
          <span>{project}</span>
        </p>
      ) : (
        <p className="muted">
          {generalCwd === cwd
            ? t["Chat without a project"]
            : t["Opening chat…"]}
        </p>
      )}
      {!enabled.length && (
        <Button variant="primary" onClick={() => navigate("providers")}>
          <Settings2 size={14} />
          {models.length ? t["Enable models"] : t["Connect a provider"]}
        </Button>
      )}
    </div>
  );
}
