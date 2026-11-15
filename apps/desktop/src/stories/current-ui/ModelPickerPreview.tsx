import { ModelPicker } from "../../mainview/ModelPicker";
import { useStore } from "../../mainview/store";

export default function ModelPickerPreview() {
  const snapshot = useStore((state) => state.snapshots[state.active ?? ""]);
  return (
    <section className="current-ui-unit">
      <header>
        <h1>モデル選択</h1>
        <p>本番のModelPickerです。選択はサンプル内だけに反映します。</p>
        <code>mainview/ModelPicker.tsx</code>
      </header>
      <div className="current-ui-model-anchor">
        <div className="composer">
          <div className="composer-toolbar">
            <ModelPicker snapshot={snapshot} />
          </div>
        </div>
      </div>
    </section>
  );
}
