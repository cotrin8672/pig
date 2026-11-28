import { SquarePen, X } from "lucide-react";
import {
  type CSSProperties,
  type HTMLAttributes,
  memo,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { ChatOpening } from "./ChatOpening";
import type { ChatSnapshot } from "./chat-snapshot";
import { getT, useT } from "./i18n";
import {
  PaneDragGrip,
  PaneDropOverlay,
  paneRect,
  usePaneDrag,
} from "./PaneDrag";
import { type PaneNode, paneGeometry } from "./pane-layout";
import { closePane, dropPane, focusPane, newChatInPane } from "./pane-state";
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
  const [preview, setPreview] = useState<{ from: PaneNode; next: PaneNode }>();
  // Only settled splits belong in the store (its workspace cache writes synchronously).
  const layout = preview?.from === tree ? preview.next : tree;
  const geometry = useMemo(() => {
    const { panes, dividers } = paneGeometry(layout);
    return {
      // Re-inserting a pane's DOM resets its scroll position in Chromium.
      panes: panes
        // Keep every pane ahead of the dividers (reading-order: 0).
        .map((pane, index) => ({ ...pane, readingOrder: index - panes.length }))
        .sort((a, b) => a.id - b.id),
      dividers,
    };
  }, [layout]);
  const workspace = useRef<HTMLDivElement>(null);
  const { dragging, winbarProps } = usePaneDrag(tree, workspace, dropPane);
  const movable = geometry.panes.length > 1;
  return (
    <div className="pane-workspace" ref={workspace} data-dragging={!!dragging}>
      {geometry.panes.map(({ id, bounds, readingOrder }) => (
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
          style={
            {
              ...paneRect(bounds),
              "--pane-reading-order": readingOrder,
            } as CSSProperties
          }
        >
          <PaneWinbar paneId={id} {...winbarProps(id, movable)} />
          <PaneContent
            sessionId={panes[id]?.sessionId}
            openId={panes[id]?.openId}
            focused={active === id}
            renderChat={renderChat}
          >
            {active === id ? children : null}
          </PaneContent>
          <div className="pane-actions window-no-drag">
            <button
              type="button"
              className="pane-action pane-new-chat"
              aria-label={`${t["New chat"]}: Pane ${id}`}
              onClick={() => newChatInPane(id)}
            >
              <SquarePen size={14} aria-hidden="true" />
            </button>
            {geometry.panes.length > 1 && (
              <button
                type="button"
                className="pane-action pane-close"
                aria-label={`${t.paneClose}: Pane ${id}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => closePane(id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
      ))}
      {!dragging &&
        geometry.dividers.map((divider) => (
          <ResizeDivider
            key={`${divider.path.join(".")}:${divider.index}`}
            divider={divider}
            tree={tree}
            onPreview={(next, from) => setPreview({ from, next })}
            onChange={(paneTree, from) => {
              setPreview(undefined);
              const current = useStore.getState().paneTree;
              if ((!from || from === current) && paneTree !== current)
                useStore.setState({ paneTree });
            }}
          />
        ))}
      {dragging && (
        <PaneDropOverlay tree={tree} drag={dragging} label={paneLabel} />
      )}
    </div>
  );
}
function paneLabel(id: number) {
  const t = getT();
  const heading = selectPaneHeading(useStore.getState(), id);
  return {
    project: (heading.general ? t.Chats : heading.project) ?? "",
    title: heading.title ?? t["New chat"],
  };
}

const PaneWinbar = memo(function PaneWinbar({
  paneId,
  ...drag
}: { paneId: number } & HTMLAttributes<HTMLElement>) {
  const t = useT();
  const heading = useStore(useShallow((s) => selectPaneHeading(s, paneId)));
  const project = heading.general ? t.Chats : heading.project;
  const title = heading.title ?? t["New chat"];
  return (
    <header className="pane-winbar" {...drag}>
      {"data-draggable" in drag && <PaneDragGrip />}
      <span className="pane-winbar-project" aria-description={project}>
        {project}
      </span>
      <span className="pane-winbar-separator" aria-hidden="true">
        /
      </span>
      <span className="pane-winbar-title" aria-description={title}>
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
