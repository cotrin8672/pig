import type { Meta } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "../../mainview/ModelPicker";
import { useStore } from "../../mainview/store";
import { TooltipLayer } from "../../mainview/Tooltip";

import { installPreview, previewDefaults } from "./fixtures";
import { PreviewTheme } from "./Previews";

export default {
  id: "component-model-picker",
  title: "Design System/Components/ModelPicker",
  parameters: { gallery: true },
  beforeEach: () => installPreview(previewDefaults),
} satisfies Meta;

function PickerExample() {
  const [paneWidth, setWidth] = useState<number>();
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
          <label>
            表示幅{" "}
            <select
              value={paneWidth ?? 0}
              onChange={(e) => setWidth(Number(e.target.value) || undefined)}
            >
              <option value={0}>通常</option>
              <option value={380}>380px</option>
              <option value={280}>280px</option>
            </select>
          </label>
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

export const Default = {
  name: "ModelPicker",
  render: () => (
    <PreviewTheme args={previewDefaults}>
      <PickerExample />
    </PreviewTheme>
  ),
};
