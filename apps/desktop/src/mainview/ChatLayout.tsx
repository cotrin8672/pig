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
import { ChatWidthHandles, useChatWidth } from "./ChatWidth";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { useStore } from "./store";
import { isThreadAtBottom } from "./thread-scroll";

export function ChatLayout({
  children,
  composer,
  panel,
  threadRef,
  onScroll,
  onJumpToBottom,
  onContentResize,
  loading = false,
}: {
  children: ReactNode;
  composer: ReactNode;
  panel?: ReactNode;
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
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  useImperativeHandle(threadRef, () => thread.current as HTMLElement, []);
  useLayoutEffect(() => {
    const element = thread.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    let scrollHeight = element.scrollHeight;
    const measure = () => {
      const nextHeight = element.scrollHeight;
      if (nextHeight !== scrollHeight) {
        // Respect wheel/focus scrolling even before its scroll event is flushed.
        const wasAtBottom = isThreadAtBottom({
          scrollHeight,
          clientHeight: element.clientHeight,
          scrollTop: element.scrollTop,
        });
        scrollHeight = nextHeight;
        resizeContent.current?.(wasAtBottom);
      }
      setAwayFromBottom(!isThreadAtBottom(element));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="session-layout">
      <div
        className="chat-shell"
        style={{ "--chat-width": `${width}px` } as React.CSSProperties}
      >
        <ChatWidthHandles width={width} onChange={setWidth} />
        <section
          ref={thread}
          className="thread-scroll"
          aria-label={t.Chats}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region must support keyboard paging after removal of the manual load button.
          tabIndex={0}
          onScroll={(event) => {
            setAwayFromBottom(!isThreadAtBottom(event.currentTarget));
            onScroll?.(event);
          }}
          aria-busy={loading}
        >
          <div className="transcript">{children}</div>
        </section>
        {awayFromBottom && (
          <button
            type="button"
            className="thread-scroll-to-bottom"
            aria-label={t["Scroll to bottom"]}
            title={t["Scroll to bottom"]}
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
        {panel}
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
        <p className="muted chat-empty-project" title={t.workingIn(project)}>
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
        <button
          type="button"
          className="primary"
          onClick={() => navigate("providers")}
        >
          <Settings2 size={14} />
          {models.length ? t["Enable models"] : t["Connect a provider"]}
        </button>
      )}
    </div>
  );
}
