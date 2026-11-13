import { memo, type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ChatSnapshot } from "./chat-snapshot";
import { useT } from "./i18n";
import { paneGeometry } from "./pane-layout";
import { focusPane } from "./pane-state";
import { ResizeDivider } from "./ResizeDivider";
import { useStore } from "./store";
import "./panes.css";

export function PaneWorkspace({
  children,
  renderChat,
}: {
  children: ReactNode;
  renderChat(snapshot: ChatSnapshot): ReactNode;
}) {
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
          onPointerDownCapture={() => focusPane(id)}
          onFocusCapture={() => focusPane(id)}
          style={{
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
          }}
        >
          <PaneContent
            sessionId={panes[id]?.sessionId}
            focused={active === id}
            renderChat={renderChat}
          >
            {active === id ? children : null}
          </PaneContent>
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
const PaneContent = memo(function PaneContent({
  sessionId,
  focused,
  renderChat,
  children,
}: {
  sessionId?: string;
  focused: boolean;
  children: ReactNode;
  renderChat(snapshot: ChatSnapshot): ReactNode;
}) {
  const t = useT();
  const snapshot = useStore((s) =>
    sessionId ? s.snapshots[sessionId] : undefined,
  );
  return (
    <div className="pane-content">
      {focused ? (
        children
      ) : snapshot && snapshot.ready !== false ? (
        renderChat(snapshot)
      ) : (
        <p className="muted">{t["Opening chat…"]}</p>
      )}
    </div>
  );
});
