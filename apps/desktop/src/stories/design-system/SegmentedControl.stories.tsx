import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/SegmentedControl",
  component: SegmentedControl,
  parameters: { gallery: true },
} satisfies Meta<typeof SegmentedControl>;

const modes = [
  { value: "remaining", label: "残り" },
  { value: "used", label: "使用済み" },
] as const;

export const States = {
  name: "SegmentedControl",
  render: function Example() {
    const [backdrop, setBackdrop] = useState<"none" | "acrylic" | "mica">(
      "acrylic",
    );
    return (
      <PrimitiveSpecimen
        title="SegmentedControl"
        intro="少数の選択肢から1つを選びます。すべての選択肢を常に表示します。"
        context="外観の設定"
        variants={[
          {
            label: "2択",
            sample: (
              <SegmentedControl
                aria-label="2択"
                value="remaining"
                onChange={() => {}}
                options={modes}
              />
            ),
          },
          {
            label: "一部無効",
            sample: (
              <SegmentedControl
                aria-label="一部無効"
                value="remaining"
                onChange={() => {}}
                options={[modes[0], { ...modes[1], disabled: true }]}
              />
            ),
          },
        ]}
      >
        <div className="ds-specimen-line">
          <span id="ds-backdrop">ウィンドウの背景</span>
          <SegmentedControl
            aria-labelledby="ds-backdrop"
            value={backdrop}
            onChange={setBackdrop}
            options={[
              { value: "none", label: "なし" },
              { value: "acrylic", label: "Acrylic" },
              { value: "mica", label: "Mica" },
            ]}
          />
        </div>
      </PrimitiveSpecimen>
    );
  },
};
