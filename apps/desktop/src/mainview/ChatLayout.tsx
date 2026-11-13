import { ArrowDown, Settings2 } from "lucide-react";
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
  threadRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  onJumpToBottom?: () => void;
  onContentResize?: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const { width, setWidth } = useChatWidth();
  const thread = useRef<HTMLDivElement>(null);
  const resizeContent = useRef(onContentResize);
  resizeContent.current = onContentResize;
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  useImperativeHandle(threadRef, () => thread.current as HTMLDivElement, []);
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
        if (wasAtBottom) resizeContent.current?.();
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
        <div
          ref={thread}
          className="thread-scroll"
          onScroll={(event) => {
            setAwayFromBottom(!isThreadAtBottom(event.currentTarget));
            onScroll?.(event);
          }}
          aria-busy={loading}
        >
          <div className="transcript">{children}</div>
        </div>
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
  return (
    <div className="chat-empty">
      <h1>{t["What shall we build?"]}</h1>
      <p className="muted">
        {generalCwd === cwd
          ? t["Chat without a project"]
          : cwd
            ? t.workingIn(projectLabel(cwd, desktop.projects?.[cwd]))
            : t["Opening chat…"]}
      </p>
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
