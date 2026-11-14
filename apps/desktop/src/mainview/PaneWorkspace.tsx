import { X } from "lucide-react";
import { memo, type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChatOpening } from "./ChatOpening";
import type { ChatSnapshot } from "./chat-snapshot";
import { useT } from "./i18n";
import { paneGeometry } from "./pane-layout";
import { closePane, focusPane } from "./pane-state";
import { ResizeDivider } from "./ResizeDivider";
import { useStore } from "./store";
import { selectPaneHeading } from "./ui-selectors";
import "./panes.css";

function isPaneCloseTarget(target: EventTarget) {
  return target instanceof Element && !!target.closest(".pane-close");
}

export function PaneWorkspace({
  children,
  renderChat,
}: {
  children: ReactNode;
  renderChat(snapshot: ChatSnapshot): ReactNode;
}) {
  const t = useT();
  const { tree, panes, active } = useStore(
    useShallow((s) => ({
      tree: s.paneTree,
      panes: s.panes,
      active: s.activePane,
    })),
  );
  const geometry = useMemo(() => paneGeometry(tree), [tree]);
  return (
    <div className="pane-workspace">
      {geometry.panes.map(({ id, bounds }) => (
        <section
          key={id}
          className="pane-view"
          data-pane-id={id}
          data-active={active === id}
          aria-label={`Pane ${id}`}
          onPointerDownCapture={(event) => {
            if (!isPaneCloseTarget(event.target)) focusPane(id);
          }}
          onFocusCapture={(event) => {
            if (!isPaneCloseTarget(event.target)) focusPane(id);
          }}
          style={{
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
          }}
        >
          <PaneWinbar paneId={id} />
          <PaneContent
            sessionId={panes[id]?.sessionId}
            openId={panes[id]?.openId}
            focused={active === id}
            renderChat={renderChat}
          >
            {active === id ? children : null}
          </PaneContent>
          {geometry.panes.length > 1 && (
            <button
              type="button"
              className="pane-close electrobun-webkit-app-region-no-drag"
              aria-label={`${t.paneClose}: Pane ${id}`}
              title={t.paneClose}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => closePane(id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      ))}
      {geometry.dividers.map((divider) => (
        <ResizeDivider
          key={`${divider.path.join(".")}:${divider.index}`}
          divider={divider}
          tree={tree}
          onChange={(paneTree) => useStore.setState({ paneTree })}
        />
      ))}
    </div>
  );
}
const PaneWinbar = memo(function PaneWinbar({ paneId }: { paneId: number }) {
  const t = useT();
  const heading = useStore(useShallow((s) => selectPaneHeading(s, paneId)));
  const project = heading.general ? t.Chats : heading.project;
  const title = heading.title ?? t["New chat"];
  return (
    <header className="pane-winbar">
      <span className="pane-winbar-project" title={project}>
        {project}
      </span>
      <span className="pane-winbar-separator" aria-hidden="true">
        /
      </span>
      <span className="pane-winbar-title" title={title}>
        {title}
      </span>
    </header>
  );
});

const PaneContent = memo(function PaneContent({
  sessionId,
  openId,
  focused,
  renderChat,
  children,
}: {
  sessionId?: string;
  openId?: string;
  focused: boolean;
  children: ReactNode;
  renderChat(snapshot: ChatSnapshot): ReactNode;
}) {
  const t = useT();
  const snapshot = useStore((s) =>
    sessionId ? s.snapshots[sessionId] : undefined,
  );
  const localDraft = useStore(
    (s) => !!(openId && s.pendingOpens[openId]?.draftId),
  );
  return (
    <div className="pane-content">
      {localDraft ? (
        <ChatOpening openId={openId} />
      ) : focused ? (
        children
      ) : snapshot && snapshot.ready !== false ? (
        renderChat(snapshot)
      ) : (
        <p className="muted">{t["Opening chat…"]}</p>
      )}
    </div>
  );
});
