import { Settings2 } from "lucide-react";
import type { ReactNode, Ref, UIEventHandler } from "react";
import { filterModels } from "../shared/models";
import { ChatWidthHandles, useChatWidth } from "./ChatWidth";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { useStore } from "./store";

export function ChatLayout({
  children,
  composer,
  panel,
  threadRef,
  onScroll,
  loading = false,
}: {
  children: ReactNode;
  composer: ReactNode;
  panel?: ReactNode;
  threadRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  loading?: boolean;
}) {
  const { width, setWidth } = useChatWidth();
  return (
    <div className="session-layout">
      <div
        className="chat-shell"
        style={{ "--chat-width": `${width}px` } as React.CSSProperties}
      >
        <ChatWidthHandles width={width} onChange={setWidth} />
        <div
          ref={threadRef}
          className="thread-scroll"
          onScroll={onScroll}
          aria-busy={loading}
        >
          <div className="transcript">{children}</div>
        </div>
        {panel}
        {composer}
      </div>
    </div>
  );
}

export function ChatEmpty({ cwd }: { cwd?: string }) {
  const t = useT();
  const { generalCwd, models, disabledModels } = useStore((s) => s.bootstrap);
  const enabled = filterModels(models, disabledModels);
  return (
    <div className="chat-empty">
      <h1>{t["What shall we build?"]}</h1>
      <p className="muted">
        {generalCwd === cwd
          ? t["Chat without a project"]
          : cwd
            ? t.workingIn(cwd)
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
