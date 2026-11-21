import { useState } from "react";
import { SessionPanel } from "../../mainview/SessionPanel";
import type { DockTab } from "../../mainview/session-dock-state";
import { activityFixture, supportedExtensionsFixture } from "./fixtures";

export default function ActivityPreview({
  supported = false,
  initialTab,
}: {
  supported?: boolean;
  initialTab?: DockTab;
}) {
  const [state] = useState(() =>
    supported
      ? supportedExtensionsFixture("standalone-supported")
      : activityFixture("standalone-activity"),
  );
  return (
    <section className="current-ui-unit">
      <header>
        <h1>
          {supported ? "対応Extensionのセッション表示" : "セッション活動パネル"}
        </h1>
        <p>
          {supported
            ? "pi-subagents と pi-schedule-prompt を組込みAdapterが表示した状態です。Composer左下のChipから開きます。"
            : "本番のSessionPanelです。Composer左下のChip（進捗・実行・予約・情報）から開きます。"}
        </p>
        <code>mainview/SessionPanel.tsx</code>
      </header>
      <div className="current-ui-activity-anchor">
        <div className="composer current-ui-activity-composer">
          <div className="composer-toolbar">
            <div className="composer-session">
              <SessionPanel
                state={state}
                sessionId={state.generation}
                initialTab={initialTab}
                onAction={async () => {}}
                onReload={async () => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
