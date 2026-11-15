import { useState } from "react";
import { SessionPanel } from "../../mainview/SessionPanel";
import { activityFixture } from "./fixtures";

export default function ActivityPreview() {
  const [state] = useState(() => activityFixture("standalone-activity"));
  return (
    <section className="current-ui-unit">
      <header>
        <h1>セッション活動パネル</h1>
        <p>本番のSessionPanelです。進捗・タスク・ログの開閉を確認できます。</p>
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
