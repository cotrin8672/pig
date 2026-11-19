import { useState } from "react";
import { SessionPanel } from "../../mainview/SessionPanel";
import { activityFixture, supportedExtensionsFixture } from "./fixtures";

export default function ActivityPreview({
  supported = false,
}: {
  supported?: boolean;
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
            ? "@gotgenes/pi-subagents と pi-schedule-prompt を組込みAdapterが表示した状態です。"
            : "本番のSessionPanelです。進捗・タスク・ログの開閉を確認できます。"}
        </p>
        <code>mainview/SessionPanel.tsx</code>
      </header>
      <div className="current-ui-activity-anchor">
        <SessionPanel
          state={state}
          sessionId={state.generation}
          onAction={async () => {}}
          onReload={async () => {}}
        />
      </div>
    </section>
  );
}
