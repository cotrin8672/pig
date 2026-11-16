import { useEffect, useRef } from "react";
import { ModelPicker } from "../../mainview/ModelPicker";
import { useStore } from "../../mainview/store";
import { TooltipLayer } from "../../mainview/Tooltip";

export default function ModelPickerPreview({
  paneWidth,
}: {
  paneWidth?: number;
}) {
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paneWidth) {
      const picker = anchor.current?.querySelector("details");
      if (picker) picker.open = true;
    }
  }, [paneWidth]);
  return (
    <TooltipLayer>
      <section className="current-ui-unit">
        <header>
          <h1>モデル選択</h1>
          <p>本番のModelPickerです。選択はサンプル内だけに反映します。</p>
          <code>mainview/ModelPicker.tsx</code>
          {paneWidth && (
            <p>Pane幅: {paneWidth}px（Providerアイコンにホバーで名前を表示）</p>
          )}
        </header>
        <div
          ref={anchor}
          className={`current-ui-model-anchor${paneWidth ? " pane-view" : ""}`}
          style={paneWidth ? { width: paneWidth, maxWidth: "100%" } : undefined}
        >
          <div className="composer">
            <div className="composer-toolbar">
              <ModelPicker snapshot={snapshot} />
            </div>
          </div>
        </div>
      </section>
    </TooltipLayer>
  );
}
