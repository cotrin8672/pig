import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { EffortSlider } from "../../mainview/EffortSlider";
import type { Effort } from "../../shared/rpc-schema";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/EffortSlider",
  component: EffortSlider,
  parameters: { gallery: true },
} satisfies Meta<typeof EffortSlider>;

const levels = ["low", "medium", "high", "xhigh"] as const;

function SliderExample({
  initial,
  disabled,
}: {
  initial: Effort;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <EffortSlider
      levels={levels}
      value={value}
      disabled={disabled}
      onCommit={async (next) => setValue(next)}
    />
  );
}

export const States = {
  name: "EffortSlider",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="EffortSlider"
      intro="モデルが選べる推論強度をスライダーで切り替えます。値のラベルが変わっても、操作する幅は変わりません。"
      context="モデルPickerの推論強度設定"
      variants={[
        { label: "最低", sample: <SliderExample initial="low" /> },
        { label: "最高", sample: <SliderExample initial="xhigh" /> },
        {
          label: "操作不可",
          sample: <SliderExample initial="high" disabled />,
        },
      ]}
    >
      <SliderExample initial="medium" />
    </PrimitiveSpecimen>
  ),
};
